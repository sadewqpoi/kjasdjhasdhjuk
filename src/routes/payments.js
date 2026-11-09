'use strict';
const express = require('express');
const config = require('../config');
const { one } = require('../db');
const { h, bad, notFound, int, str } = require('../lib/http');
const auth = require('../lib/auth');
const payments = require('../lib/payments');
const { audit } = require('../lib/audit');
const { uploadMedia, saveReceipt, receiptPath } = require('../lib/uploads');

const r = express.Router();

/** طرق الدفع المتاحة للعضو (البوابات المفعّلة والجاهزة) */
r.get('/gateways', auth.requireVerified, h((_req, res) => {
  res.json({ items: payments.activeGateways().map((g) => ({
    id: g.id, name: g.name, description: g.description, provider: g.provider, manual: !!payments.provider(g.provider).manual,
  })) });
}));

/** بدء الدفع: المبلغ من قاعدة البيانات، والنتيجة تُحدَّد بعد تحقق الخادم */
r.post('/checkout', auth.requireVerified, auth.rateLimit('checkout', 20, 60 * 60e3), h(async (req, res) => {
  const b = req.body || {};
  const planId = int(b.plan_id, 'الباقة');
  const out = await payments.startCheckout(req.user, planId, b.gateway_id ? int(b.gateway_id, 'طريقة الدفع') : null);
  audit(req, 'payment.checkout', 'payment', out.payment_id, { plan_id: planId, purpose: out.purpose, gateway_id: b.gateway_id || null });
  res.json(out);
}));

/** العودة من صفحة الدفع (GET أو POST حسب البوابة): لا نثق بأي معلمة، نستعلم من البوابة مباشرة */
const back = h(async (req, res) => {
  const pid = Number(req.query.pid);
  if (Number.isInteger(pid) && pid > 0) {
    try { await payments.verifyAndFulfill(pid); } catch (e) { console.error('verify error', e.message); }
  }
  res.redirect(303, `/#/payment-result?pid=${Number.isInteger(pid) ? pid : ''}`);
});
r.get('/return', back);
r.post('/return', express.urlencoded({ extended: false, limit: '50kb' }), back);

/** إشعارات البوابات (Webhook) — لكل بوابة رابطها الخاص */
r.post('/webhook/moyasar', h(async (req, res) => {   // توافق مع الرابط القديم
  const g = one("SELECT id FROM payment_gateways WHERE provider = 'moyasar' AND is_deleted = 0 ORDER BY id LIMIT 1");
  if (!g) throw notFound();
  if (!(await payments.handleWebhook(g.id, req.body))) return res.status(403).json({ error: 'invalid token' });
  res.json({ ok: true });
}));
r.post('/webhook/:gid', h(async (req, res) => {
  if (!(await payments.handleWebhook(int(req.params.gid), req.body))) return res.status(403).json({ error: 'invalid' });
  res.json({ ok: true });
}));

r.get('/:id', auth.requireAuth, h(async (req, res) => {
  const p = one('SELECT pay.*, pl.name AS plan_name FROM payments pay JOIN plans pl ON pl.id = pay.plan_id WHERE pay.id = ?', int(req.params.id));
  if (!p || p.user_id !== req.user.id) throw notFound();
  const gw = payments.gatewayForPayment(p);
  const prov = payments.providers[gw.provider] || {};
  let cur = p;
  if (p.status === 'initiated' && !prov.manual) {
    await payments.verifyAndFulfill(p.id);
    cur = { ...p, ...one('SELECT status, subscription_id, failure_reason FROM payments WHERE id = ?', p.id) };
  }
  res.json({
    id: cur.id, status: cur.status, plan_name: p.plan_name, purpose: p.purpose, amount_halalas: p.amount_halalas, currency: p.currency,
    failure_reason: cur.failure_reason, gateway_name: gw.name || null,
    manual: !!prov.manual,
    ...(prov.manual ? {
      reference: p.provider_ref, bank: prov.publicInfo(gw.cfg || {}),
      submitted_at: p.submitted_at, transfer_name: p.transfer_name, transfer_ref: p.transfer_ref, has_receipt: !!p.receipt_file,
    } : {}),
  });
}));

/** العضو يرسل بيانات التحويل البنكي (وصورة الإيصال اختياريًا) للمراجعة */
r.post('/:id/transfer', auth.requireVerified, auth.rateLimit('transfer', 20, 60 * 60e3), uploadMedia.single('receipt'), h((req, res) => {
  const b = req.body || {};
  const name = str(b.transfer_name, 'اسم المحوِّل', { min: 2, max: 80 });
  const ref = str(b.transfer_ref, 'رقم العملية أو ملاحظة', { optional: true, max: 200 });
  const receipt = saveReceipt(req.file);
  if (!receipt && !ref) throw bad('أرفق صورة الإيصال أو اكتب رقم عملية التحويل');
  const p = payments.submitTransfer(req.user, int(req.params.id), { name, ref, receipt });
  audit(req, 'payment.transfer_submitted', 'payment', p.id);
  res.json({ ok: true });
}));

/** صورة الإيصال: لصاحب العملية أو لمن يملك صلاحية المدفوعات */
r.get('/:id/receipt', auth.requireAuth, h((req, res) => {
  const p = one('SELECT user_id, receipt_file FROM payments WHERE id = ?', int(req.params.id));
  if (!p || (p.user_id !== req.user.id && !auth.hasPermission(req.user, 'payments.view'))) throw notFound();
  const f = receiptPath(p.receipt_file);
  if (!f) throw notFound();
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(f);
}));

// ---------- البوابة التجريبية (بيئة التطوير فقط) ----------
if (!config.isProd) {
  const mock = payments.providers.mock;
  r.get('/mock-gateway/:ref', h((req, res) => {
    const g = mock._info(req.params.ref);
    if (!g) throw notFound();
    res.json({ amount: g.amount, currency: g.currency, status: g.status });
  }));
  r.post('/mock-gateway/:ref', h((req, res) => {
    const outcome = req.body && req.body.outcome;
    if (!['pay', 'fail'].includes(outcome)) throw bad('نتيجة غير صالحة');
    const g = mock._complete(req.params.ref, outcome, req.body.method);
    if (!g) throw bad('العملية غير متاحة');
    res.json({ return_url: g.returnUrl });
  }));
}

module.exports = r;
