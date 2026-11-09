'use strict';
/**
 * بوابة ميسّر (Moyasar) — مدى، Apple Pay، فيزا، ماستركارد.
 * يُستخدم API الفواتير (Invoices): الخادم ينشئ فاتورة بالمبلغ من قاعدة البيانات،
 * والعضو يدفع في صفحة ميسّر، ثم يتحقق الخادم من الفاتورة بالمفتاح السري.
 */
const crypto = require('node:crypto');

const API = 'https://api.moyasar.com/v1';

async function call(cfg, method, path, body) {
  if (!cfg.secret_key) throw new Error('المفتاح السري لميسّر غير مضبوط');
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: 'Basic ' + Buffer.from(cfg.secret_key + ':').toString('base64'), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Moyasar ${res.status}: ${json.message || 'error'}`);
  return json;
}

module.exports = {
  key: 'moyasar',
  label: 'ميسّر (Moyasar)',
  desc: 'بوابة سعودية: مدى، Apple Pay، فيزا، ماستركارد. التسجيل من moyasar.com.',
  defaultDescription: 'مدى، Apple Pay، فيزا، ماستركارد',
  fields: [
    { key: 'secret_key', label: 'المفتاح السري (Secret Key)', secret: true, required: true, placeholder: 'sk_live_… أو sk_test_…' },
    { key: 'webhook_secret', label: 'كلمة سر الـ Webhook (Secret Token)', secret: true, required: false, placeholder: 'نفس القيمة في لوحة ميسّر' },
  ],

  async createCheckout({ payment, description, returnUrl, webhookUrl, cfg }) {
    const inv = await call(cfg, 'POST', '/invoices', {
      amount: payment.amount_halalas,          // ميسّر يستخدم الهللة
      currency: payment.currency,
      description,
      callback_url: webhookUrl,
      success_url: returnUrl,
      back_url: returnUrl,
      metadata: { payment_id: String(payment.id) },
    });
    return { ref: inv.id, url: inv.url };
  },

  async fetchStatus(ref, cfg) {
    const inv = await call(cfg, 'GET', `/invoices/${encodeURIComponent(ref)}`);
    const paidTx = (inv.payments || []).find((p) => p.status === 'paid');
    return {
      status: inv.status,                       // initiated | paid | failed | expired | canceled
      amount: inv.amount,
      currency: inv.currency,
      paymentId: inv.metadata && inv.metadata.payment_id,
      method: paidTx && paidTx.source ? paidTx.source.type || paidTx.source.company : null,
      raw: inv,
    };
  },

  /** استخراج مرجع العملية من إشعار ميسّر بعد التحقق من الرمز السري */
  webhookRef(body, cfg) {
    const secret = cfg.webhook_secret || '';
    const given = String((body && body.secret_token) || '');
    if (!secret || given.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret))) return null;
    const data = body.data || {};
    return data.invoice_id || data.id || null;
  },
};
