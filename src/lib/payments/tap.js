'use strict';
/**
 * بوابة تاب (Tap Payments) — مدى، Apple Pay، فيزا، ماستركارد، STC Pay.
 * Charges API: الخادم ينشئ عملية بالمبلغ من قاعدة البيانات، والعضو يدفع في صفحة تاب،
 * ثم يستعلم الخادم عن العملية بالمفتاح السري (لا يُعتمد على أي بيانات من المتصفح).
 * ملاحظة: كُتب وفق توثيق Tap العام ولم يُختبر بحساب حقيقي؛ جرّبه بمفاتيح الاختبار أولًا.
 */
const API = 'https://api.tap.company/v2';

async function call(cfg, method, path, body) {
  if (!cfg.secret_key) throw new Error('المفتاح السري لتاب غير مضبوط');
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${cfg.secret_key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Tap ${res.status}: ${(json.errors && json.errors[0] && json.errors[0].description) || 'error'}`);
  return json;
}

const STATUS = { CAPTURED: 'paid', AUTHORIZED: 'initiated', INITIATED: 'initiated', IN_PROGRESS: 'initiated',
  FAILED: 'failed', DECLINED: 'failed', CANCELLED: 'cancelled', ABANDONED: 'cancelled', VOID: 'cancelled', TIMEDOUT: 'expired', RESTRICTED: 'failed', UNKNOWN: 'initiated' };

module.exports = {
  key: 'tap',
  label: 'تاب (Tap Payments)',
  desc: 'بوابة خليجية: مدى، Apple Pay، فيزا، ماستركارد، STC Pay. التسجيل من tap.company.',
  defaultDescription: 'مدى، Apple Pay، فيزا، ماستركارد',
  fields: [
    { key: 'secret_key', label: 'المفتاح السري (Secret Key)', secret: true, required: true, placeholder: 'sk_live_… أو sk_test_…' },
  ],

  async createCheckout({ payment, user, description, returnUrl, webhookUrl, cfg }) {
    const local = String(user.phone || '').replace(/^966/, '');
    const ch = await call(cfg, 'POST', '/charges', {
      amount: payment.amount_halalas / 100,     // تاب تستخدم الريال (عشري)
      currency: payment.currency,
      threeDSecure: true,
      save_card: false,
      description,
      metadata: { payment_id: String(payment.id) },
      reference: { transaction: `pay_${payment.id}`, order: String(payment.id) },
      customer: { first_name: String(user.full_name || 'عضو').split(' ')[0], phone: { country_code: '966', number: local } },
      source: { id: 'src_all' },
      post: { url: webhookUrl },
      redirect: { url: returnUrl },
    });
    if (!ch.transaction || !ch.transaction.url) throw new Error('لم تُرجع تاب رابط الدفع');
    return { ref: ch.id, url: ch.transaction.url };
  },

  async fetchStatus(ref, cfg) {
    const ch = await call(cfg, 'GET', `/charges/${encodeURIComponent(ref)}`);
    return {
      status: STATUS[String(ch.status || '').toUpperCase()] || 'initiated',
      amount: Math.round(Number(ch.amount) * 100),
      currency: ch.currency,
      paymentId: ch.metadata && ch.metadata.payment_id,
      method: (ch.source && (ch.source.payment_method || ch.source.payment_type)) || null,
      raw: ch,
    };
  },

  /** إشعار تاب: نأخذ رقم العملية فقط، ثم نتحقق منها بالاستعلام المباشر */
  webhookRef(body) {
    return body && typeof body.id === 'string' && body.id.startsWith('chg_') ? body.id : null;
  },
};
