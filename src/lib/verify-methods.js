'use strict';
/**
 * طرق التحقق من رقم الجوال — يختارها المدير ويرتبها ويضبطها من لوحة الإدارة.
 *   wa_reverse : العضو يرسل رسالة جاهزة إلى رقم واتساب الصندوق (رسمي ومجاني)
 *   wa_bot     : بوت واتساب يرسل الرمز تلقائيًا (غير رسمي، احتياطي)
 *   sms        : رسالة نصية عبر مزوّد (مدفوع)
 *   manual     : العضو يطلب، والإدارة توثّق الرقم يدويًا (مجاني)
 * الإعدادات تُحفظ في جدول settings، وقيم .env تُستخدم إذا لم تُضبط من اللوحة.
 */
const config = require('../config');
const { getSetting } = require('../db');
const { HttpError } = require('./http');

const METHODS = ['wa_reverse', 'wa_bot', 'sms', 'manual'];
const LABELS = {
  wa_reverse: 'واتساب: العضو يرسل الرسالة إلى رقم الصندوق',
  wa_bot: 'واتساب: بوت يرسل الرمز تلقائيًا',
  sms: 'رسالة نصية (SMS)',
  manual: 'توثيق يدوي من الإدارة',
};

/** قيمة إعداد من اللوحة، وإلا من .env */
function cfg(key, fallback) {
  const v = getSetting(key, null);
  return v !== null && v !== '' ? v : (fallback || '');
}

const wa = () => ({
  number: cfg('wa_number', config.whatsapp.number).replace(/\D/g, ''),
  verifyToken: cfg('wa_verify_token', config.whatsapp.verifyToken),
  appSecret: cfg('wa_app_secret', config.whatsapp.appSecret),
  token: cfg('wa_token', config.whatsapp.token),
  phoneNumberId: cfg('wa_phone_number_id', config.whatsapp.phoneNumberId),
  apiVersion: config.whatsapp.apiVersion,
});
const sms = () => ({
  provider: cfg('sms_provider', config.sms.provider) || 'console',
  unifonicAppSid: cfg('sms_unifonic_app_sid', config.sms.unifonicAppSid),
  unifonicSender: cfg('sms_unifonic_sender', config.sms.unifonicSender),
});
const smsConfigured = () => { const s = sms(); return s.provider === 'unifonic' && !!s.unifonicAppSid && !!s.unifonicSender; };

/** الطرق المفعّلة بالترتيب الذي اختاره المدير */
function enabled() {
  let raw = getSetting('otp_methods', null);
  if (raw === null) raw = config.otpChannel === 'sms' ? 'sms' : 'wa_reverse';
  return raw.split(',').map((s) => s.trim()).filter((m, i, a) => METHODS.includes(m) && a.indexOf(m) === i);
}

/** هل الطريقة جاهزة فعليًا للاستخدام الآن */
function ready(m) {
  if (m === 'wa_reverse') return !!wa().number || !config.isProd; // في التطوير: زر المحاكاة
  if (m === 'wa_bot') return require('./wabot').available();
  if (m === 'sms') return smsConfigured() || !config.isProd;     // في التطوير: الرمز يظهر على الشاشة
  if (m === 'manual') return true;
  return false;
}

/** الطرق المتاحة للأعضاء الآن (مفعّلة وجاهزة) بالترتيب */
const available = () => enabled().filter(ready);

function require_(m) {
  if (!enabled().includes(m) || !ready(m)) throw new HttpError(400, 'طريقة التحقق هذه غير متاحة حاليًا', 'method_unavailable');
}

module.exports = { METHODS, LABELS, enabled, ready, available, require: require_, wa, sms, smsConfigured };
