'use strict';
/**
 * بوابة دفع تجريبية لبيئة التطوير فقط.
 * تحاكي بوابة خارجية: لها سجلاتها الخاصة، والخادم يستعلم منها كما يستعلم من البوابة الحقيقية.
 */
const crypto = require('node:crypto');

const gateway = new Map(); // ref -> { status, amount, currency, metadata, method }

module.exports = {
  key: 'mock',
  label: 'بوابة تجريبية (للتطوير فقط)',
  desc: 'تحاكي الدفع دون خصم أي مبلغ. لا تعمل في التشغيل الفعلي.',
  defaultDescription: 'للتطوير فقط — لا يُخصم أي مبلغ',
  devOnly: true,
  fields: [],

  async createCheckout({ payment, returnUrl }) {
    const ref = 'mock_' + crypto.randomBytes(8).toString('hex');
    gateway.set(ref, {
      status: 'initiated', amount: payment.amount_halalas, currency: payment.currency,
      metadata: { payment_id: String(payment.id) }, returnUrl,
    });
    return { ref, url: `/mock-gateway.html?ref=${ref}` };
  },

  async fetchStatus(ref) {
    const g = gateway.get(ref);
    if (!g) return { status: 'unknown' };
    return { status: g.status, amount: g.amount, currency: g.currency, paymentId: g.metadata.payment_id, method: g.method, raw: { ref, ...g } };
  },

  // تُستخدم فقط من صفحة البوابة التجريبية
  _info(ref) { return gateway.get(ref); },
  _complete(ref, outcome, method) {
    const g = gateway.get(ref);
    if (!g || g.status !== 'initiated') return null;
    g.status = outcome === 'pay' ? 'paid' : 'failed';
    g.method = method || 'mada';
    return g;
  },
};
