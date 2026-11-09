'use strict';
const path = require('node:path');
const fs = require('node:fs');

// تحميل ملف .env البسيط (بدون مكتبات خارجية)
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = process.env;
const ROOT = path.join(__dirname, '..');
// مجلد البيانات الدائم (قاعدة البيانات + الصور + ربط بوت واتساب). على Railway: قرص دائم مركّب على /data
const DATA_DIR = env.DATA_DIR || path.join(ROOT, 'data');

module.exports = {
  ROOT,
  DATA_DIR,
  port: Number(env.PORT || 3000),
  isProd: env.NODE_ENV === 'production',
  publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  dbFile: env.DB_FILE || path.join(DATA_DIR, 'family.db'),
  uploadsDir: env.UPLOADS_DIR || path.join(DATA_DIR, 'uploads'),
  // عدد الوسطاء أمام الخادم لمعرفة عنوان IP الحقيقي: Netlify ← Railway ← الخادم = 2
  trustProxy: Number(env.TRUST_PROXY || 1),
  sessionDays: Number(env.SESSION_DAYS || 30),
  // التحقق من الجوال
  sms: {
    provider: env.SMS_PROVIDER || 'console',        // console | unifonic
    unifonicAppSid: env.UNIFONIC_APP_SID || '',
    unifonicSender: env.UNIFONIC_SENDER_ID || '',
    // في وضع التطوير فقط: إرجاع الرمز في الاستجابة لتسهيل الاختبار
    exposeDevCode: env.NODE_ENV !== 'production' && env.SMS_PROVIDER !== 'unifonic',
  },
  // قناة التحقق من الجوال: whatsapp (العضو يرسل الرمز إلى رقم الصندوق) | sms
  otpChannel: env.OTP_CHANNEL || 'whatsapp',
  whatsapp: {
    number: (env.WHATSAPP_NUMBER || '').replace(/\D/g, ''),     // رقم واتساب الصندوق بالصيغة الدولية 9665XXXXXXXX
    verifyToken: env.WHATSAPP_VERIFY_TOKEN || '',                // كلمة تحقق الـ Webhook في لوحة Meta
    appSecret: env.WHATSAPP_APP_SECRET || '',                    // App Secret للتحقق من توقيع الرسائل الواردة
    token: env.WHATSAPP_TOKEN || '',                             // اختياري: لإرسال رد "تم التفعيل"
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',           // اختياري: مع token
    apiVersion: env.WHATSAPP_API_VERSION || 'v21.0',
  },
  // بوابة الدفع
  payment: {
    provider: env.PAYMENT_PROVIDER || 'mock',        // mock | moyasar
    moyasarSecretKey: env.MOYASAR_SECRET_KEY || '',
    moyasarWebhookSecret: env.MOYASAR_WEBHOOK_SECRET || '',
  },
};
