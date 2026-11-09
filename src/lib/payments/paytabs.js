'use strict';
/**
 * بوابة PayTabs — مدى، Apple Pay، فيزا، ماستركارد.
 * Hosted Payment Page: الخادم يطلب صفحة دفع بالمبلغ من قاعدة البيانات، ثم يستعلم عن العملية
 * بمفتاح الخادم (Server Key) للتحقق قبل تفعيل الاشتراك.
 * ملاحظة: كُتب وفق توثيق PayTabs العام ولم يُختبر بحساب حقيقي؛ جرّبه بحساب الاختبار أولًا.
 */
const REGIONS = {
  SAU: 'https://secure.paytabs.sa',
  ARE: 'https://secure.paytabs.com',
  EGY: 'https://secure-egypt.paytabs.com',
  OMN: 'https://secure-oman.paytabs.com',
  JOR: 'https://secure-jordan.paytabs.com',
  GLOBAL: 'https://secure-global.paytabs.com',
};

async function call(cfg, path, body) {
  if (!cfg.server_key || !cfg.profile_id) throw new Error('بيانات PayTabs غير مكتملة');
  const base = REGIONS[cfg.region || 'SAU'] || REGIONS.SAU;
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { authorization: cfg.server_key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile_id: Number(cfg.profile_id), ...body }),
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.code) throw new Error(`PayTabs ${res.status}: ${json.message || 'error'}`);
  return json;
}

module.exports = {
  key: 'paytabs',
  label: 'PayTabs',
  desc: 'بوابة عربية: مدى، Apple Pay، فيزا، ماستركارد. التسجيل من paytabs.com.',
  defaultDescription: 'مدى، Apple Pay، فيزا، ماستركارد',
  fields: [
    { key: 'profile_id', label: 'رقم الملف (Profile ID)', required: true },
    { key: 'server_key', label: 'مفتاح الخادم (Server Key)', secret: true, required: true },
    { key: 'region', label: 'المنطقة', type: 'select', options: Object.keys(REGIONS), required: true, default: 'SAU' },
  ],

  async createCheckout({ payment, description, returnUrl, webhookUrl, cfg }) {
    const r = await call(cfg, '/payment/request', {
      tran_type: 'sale',
      tran_class: 'ecom',
      cart_id: String(payment.id),
      cart_description: description,
      cart_currency: payment.currency,
      cart_amount: payment.amount_halalas / 100,
      callback: webhookUrl,
      return: returnUrl,
      hide_shipping: true,
    });
    if (!r.redirect_url) throw new Error('لم تُرجع PayTabs رابط الدفع');
    return { ref: r.tran_ref, url: r.redirect_url };
  },

  async fetchStatus(ref, cfg) {
    const q = await call(cfg, '/payment/query', { tran_ref: ref });
    const rs = q.payment_result && q.payment_result.response_status;
    const status = rs === 'A' ? 'paid' : ['D', 'E', 'V', 'X'].includes(rs) ? 'failed' : 'initiated';
    return {
      status,
      amount: Math.round(Number(q.cart_amount) * 100),
      currency: q.cart_currency,
      paymentId: q.cart_id,
      method: (q.payment_info && q.payment_info.payment_method) || null,
      raw: q,
    };
  },

  webhookRef(body) {
    return body && typeof body.tran_ref === 'string' ? body.tran_ref : null;
  },
};
