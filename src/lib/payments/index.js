'use strict';
/**
 * طبقة الدفع الإلكتروني — بوابات متعددة يديرها المدير من اللوحة.
 * - المبلغ يُحدد دائمًا من قاعدة البيانات (لا يُقبل من المتصفح).
 * - لا يُفعَّل الاشتراك إلا بعد استعلام الخادم من البوابة مباشرة والتأكد من:
 *   الحالة = مدفوع، المبلغ والعملة مطابقان، ومرجع العملية يعود لنفس سجل الدفع.
 * - التحويل البنكي: لا يُفعَّل إلا باعتماد المسؤول.
 * - التفعيل idempotent: تكرار الاستدعاء (callback + webhook) لا يُنشئ اشتراكًا مكررًا.
 */
const config = require('../../config');
const { one, all, run, tx } = require('../../db');
const { bad, notFound } = require('../http');
const subs = require('../subscriptions');

/** أنواع البوابات المدعومة في المنصة */
const providers = {
  moyasar: require('./moyasar'),
  tap: require('./tap'),
  paytabs: require('./paytabs'),
  bank_transfer: require('./bank_transfer'),
  mock: require('./mock'),
};

function provider(key) {
  const p = providers[key];
  if (!p) throw new Error(`نوع بوابة غير معروف: ${key}`);
  return p;
}

// ---------- البوابات ----------
const parseCfg = (g) => { try { return JSON.parse(g.config || '{}'); } catch { return {}; } };

function getGateway(id) {
  const g = one('SELECT * FROM payment_gateways WHERE id = ? AND is_deleted = 0', id);
  return g ? { ...g, cfg: parseCfg(g) } : null;
}

/** هل البوابة جاهزة (الحقول المطلوبة مكتملة، والتجريبية في التطوير فقط) */
function isReady(g) {
  const p = providers[g.provider];
  if (!p) return false;
  if (p.devOnly && config.isProd) return false;
  const cfg = g.cfg || parseCfg(g);
  return p.fields.every((f) => !f.required || String(cfg[f.key] || '').trim());
}

/** البوابات المتاحة للأعضاء الآن، بالترتيب */
function activeGateways() {
  return all('SELECT * FROM payment_gateways WHERE is_active = 1 AND is_deleted = 0 ORDER BY sort, id')
    .map((g) => ({ ...g, cfg: parseCfg(g) }))
    .filter(isReady);
}

/** للبيانات القديمة (قبل البوابات المتعددة): أول بوابة من نفس النوع */
function gatewayForPayment(payment) {
  if (payment.gateway_id) {
    const g = one('SELECT * FROM payment_gateways WHERE id = ?', payment.gateway_id);
    if (g) return { ...g, cfg: parseCfg(g) };
  }
  const g = one('SELECT * FROM payment_gateways WHERE provider = ? ORDER BY is_deleted, id LIMIT 1', payment.provider);
  return g ? { ...g, cfg: parseCfg(g) } : { provider: payment.provider, cfg: {} };
}

// ---------- الدفع ----------
/** إنشاء عملية دفع: يُرجع رابط صفحة البوابة، أو بيانات التحويل البنكي */
async function startCheckout(user, planId, gatewayId) {
  subs.assertSystemEnabled();
  const plan = subs.getPlan(planId, { mustBeActive: true });
  if (plan.is_free || plan.price_halalas <= 0) throw bad('هذه الباقة مجانية ولا تتطلب دفعًا');
  const list = activeGateways();
  if (!list.length) throw bad('الدفع الإلكتروني غير متاح حاليًا، تواصل مع الإدارة', 'no_gateway');
  const gw = gatewayId ? list.find((g) => g.id === Number(gatewayId)) : list[0];
  if (!gw) throw bad('طريقة الدفع المختارة غير متاحة', 'gateway_unavailable');
  const prov = provider(gw.provider);
  const purpose = subs.purposeFor(user.id, plan);

  const r = run(`INSERT INTO payments (user_id, plan_id, purpose, amount_halalas, currency, provider, gateway_id)
                 VALUES (?,?,?,?,?,?,?)`, user.id, plan.id, purpose, plan.price_halalas, plan.currency, gw.provider, gw.id);
  const payment = one('SELECT * FROM payments WHERE id = ?', r.lastInsertRowid);

  if (prov.manual) {
    // تحويل بنكي: رقم مرجعي يكتبه العضو في وصف التحويل
    const ref = `BT-${payment.id}`;
    run('UPDATE payments SET provider_ref = ? WHERE id = ?', ref, payment.id);
    return { payment_id: payment.id, purpose, manual: true, reference: ref };
  }

  try {
    const out = await prov.createCheckout({
      payment, plan, user, cfg: gw.cfg,
      returnUrl: `${config.publicUrl}/api/payments/return?pid=${payment.id}`,
      webhookUrl: `${config.publicUrl}/api/payments/webhook/${gw.id}`,
      description: `${plan.name} - عضوية ${user.membership_no}`,
    });
    run('UPDATE payments SET provider_ref = ? WHERE id = ?', out.ref, payment.id);
    return { payment_id: payment.id, redirect_url: out.url, purpose };
  } catch (e) {
    run("UPDATE payments SET status = 'failed', failure_reason = ? WHERE id = ?", String(e.message).slice(0, 300), payment.id);
    throw bad('تعذر بدء عملية الدفع، حاول لاحقًا أو اختر طريقة دفع أخرى');
  }
}

/** تفعيل الاشتراك لعملية دفع (داخل معاملة، ومرة واحدة فقط) */
function fulfill(payment, { payload = null, method = null, reviewer = null } = {}) {
  return tx(() => {
    const upd = run(`UPDATE payments SET status = 'paid', provider_payload = COALESCE(?, provider_payload), method = COALESCE(?, method),
                       verified_at = datetime('now'), reviewed_by = COALESCE(?, reviewed_by) WHERE id = ? AND status = 'initiated'`,
      payload, method, reviewer, payment.id);
    if (upd.changes === 1) {
      const sub = subs.applySubscription({
        userId: payment.user_id, planId: payment.plan_id, purpose: payment.purpose, source: 'payment', paymentId: payment.id,
      });
      run('UPDATE payments SET subscription_id = ? WHERE id = ?', sub.id, payment.id);
    }
    return one('SELECT * FROM payments WHERE id = ?', payment.id);
  });
}

/** التحقق من الدفع لدى البوابة ثم تفعيل الاشتراك */
async function verifyAndFulfill(paymentId) {
  const payment = one('SELECT * FROM payments WHERE id = ?', paymentId);
  if (!payment) throw bad('عملية دفع غير موجودة');
  if (payment.status === 'paid') return payment;
  if (payment.status !== 'initiated' || !payment.provider_ref) return payment;
  const gw = gatewayForPayment(payment);
  const prov = provider(gw.provider);
  if (prov.manual) return payment; // التحويل البنكي يُعتمد يدويًا

  const remote = await prov.fetchStatus(payment.provider_ref, gw.cfg);
  const payload = JSON.stringify(remote.raw || remote).slice(0, 8000);

  const valid = remote.status === 'paid'
    && Number(remote.amount) === payment.amount_halalas
    && String(remote.currency).toUpperCase() === payment.currency
    && String(remote.paymentId) === String(payment.id);

  if (!valid) {
    if (['failed', 'expired', 'canceled', 'cancelled', 'voided'].includes(remote.status) || remote.status === 'paid') {
      // paid لكن غير مطابق = تلاعب أو خطأ → يُسجّل كفشل ليراجعه المدير
      run("UPDATE payments SET status = 'failed', provider_payload = ?, failure_reason = ?, verified_at = datetime('now') WHERE id = ? AND status = 'initiated'",
        payload, remote.status === 'paid' ? 'عدم تطابق المبلغ أو المرجع' : `حالة البوابة: ${remote.status}`, payment.id);
    } else {
      run('UPDATE payments SET provider_payload = ? WHERE id = ?', payload, payment.id);
    }
    return one('SELECT * FROM payments WHERE id = ?', payment.id);
  }
  return fulfill(payment, { payload, method: remote.method || null });
}

/** إشعار من بوابة (Webhook): نأخذ المرجع فقط ونتحقق بالاستعلام المباشر */
async function handleWebhook(gatewayId, body) {
  const gw = getGateway(gatewayId) || one('SELECT * FROM payment_gateways WHERE id = ?', gatewayId);
  if (!gw) throw notFound();
  const cfg = gw.cfg || parseCfg(gw);
  const prov = provider(gw.provider);
  if (!prov.webhookRef) throw notFound();
  const ref = prov.webhookRef(body, cfg);
  if (!ref) return false;
  const p = one('SELECT id FROM payments WHERE gateway_id = ? AND provider_ref = ?', gw.id, String(ref));
  if (p) await verifyAndFulfill(p.id);
  return true;
}

// ---------- التحويل البنكي ----------
function submitTransfer(user, paymentId, { name, ref, receipt }) {
  const p = one('SELECT * FROM payments WHERE id = ?', paymentId);
  if (!p || p.user_id !== user.id) throw notFound();
  subs.assertSystemEnabled();
  if (!provider(gatewayForPayment(p).provider).manual) throw bad('هذه العملية ليست تحويلًا بنكيًا');
  if (p.status !== 'initiated') throw bad('تمت مراجعة هذه العملية مسبقًا');
  run(`UPDATE payments SET transfer_name = ?, transfer_ref = ?, receipt_file = COALESCE(?, receipt_file), submitted_at = datetime('now') WHERE id = ?`,
    name, ref, receipt, p.id);
  return one('SELECT * FROM payments WHERE id = ?', p.id);
}

function approveTransfer(paymentId, reviewerId) {
  const p = one('SELECT * FROM payments WHERE id = ?', paymentId);
  if (!p) throw notFound();
  if (!provider(gatewayForPayment(p).provider).manual) throw bad('الاعتماد اليدوي للتحويلات البنكية فقط');
  if (p.status !== 'initiated') throw bad('العملية ليست بانتظار المراجعة');
  return fulfill(p, { method: 'bank_transfer', reviewer: reviewerId });
}

function rejectTransfer(paymentId, reviewerId, reason) {
  const p = one('SELECT * FROM payments WHERE id = ?', paymentId);
  if (!p) throw notFound();
  if (p.status !== 'initiated') throw bad('العملية ليست بانتظار المراجعة');
  run("UPDATE payments SET status = 'failed', failure_reason = ?, reviewed_by = ?, verified_at = datetime('now') WHERE id = ? AND status = 'initiated'",
    reason || 'رُفض التحويل من الإدارة', reviewerId, p.id);
  return one('SELECT * FROM payments WHERE id = ?', p.id);
}

module.exports = {
  providers, provider, parseCfg, getGateway, isReady, activeGateways, gatewayForPayment,
  startCheckout, verifyAndFulfill, handleWebhook, submitTransfer, approveTransfer, rejectTransfer,
};
