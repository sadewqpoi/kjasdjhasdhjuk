'use strict';
const path = require('node:path');
const express = require('express');
const config = require('./config');
require('./db');
const { loadUser } = require('./lib/auth');
const { HttpError } = require('./lib/http');
const { expireDue } = require('./lib/subscriptions');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

// ترويسات أمان أساسية
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; frame-ancestors 'none'; form-action 'self' https://*.moyasar.com");
  next();
});

// نحتفظ بالنص الخام للتحقق من توقيع Webhook واتساب
app.use(express.json({ limit: '200kb', verify: (req, _res, buf) => { if (req.url.startsWith('/api/whatsapp/')) req.rawBody = buf; } }));
app.use(loadUser);

// حماية من CSRF: الطلبات المغيّرة للحالة يجب أن تأتي من نفس الموقع
app.use('/api', (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path.startsWith('/payments/webhook/') || req.path === '/payments/return' || req.path === '/whatsapp/webhook') return next();
  if (req.get('X-Requested-With') !== 'fetch') return next(new HttpError(403, 'طلب غير مسموح', 'csrf'));
  next();
});

// فحص صحة الخادم (تستخدمه Railway لمعرفة أن الخادم يعمل)
app.get('/api/health', (_req, res) => {
  try { require('./db').one('SELECT 1 AS ok'); res.json({ ok: true }); } catch { res.status(500).json({ ok: false }); }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/whatsapp', require('./routes/whatsapp'));
app.use('/api/link', require('./routes/link'));
app.use('/api/account', require('./routes/account'));
app.use('/api/plans', require('./routes/plans'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api', require('./routes/community'));
app.use('/api', require('./routes/home'));
app.use('/api', require('./routes/wills'));
app.use('/api', require('./routes/announcements'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', require('./routes/tree'));

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'المسار غير موجود', 'not_found')));

app.use(express.static(path.join(config.ROOT, 'public'), { extensions: ['html'], maxAge: config.isProd ? '1h' : 0 }));

// معالج الأخطاء الموحد
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') err = new HttpError(400, req.path.includes('/home/') ? 'حجم الصورة يتجاوز 6 ميجابايت' : 'حجم الصورة يتجاوز 3 ميجابايت');
  if (err && /UNIQUE constraint failed: users\.person_id/.test(err.message)) err = new HttpError(409, 'هذا الشخص مرتبط بحساب آخر بالفعل');
  if (err && /UNIQUE constraint failed: link_requests/.test(err.message)) err = new HttpError(409, 'لديك طلب قيد المراجعة بالفعل');
  const status = err instanceof HttpError ? err.status : (err.status && err.status < 500 ? err.status : 500);
  const expected = err instanceof HttpError;
  if (status >= 500 && !expected) console.error(err);
  res.status(status).json({ error: status >= 500 && !expected ? 'حدث خطأ في الخادم' : err.message, code: err.code || null });
});

// تحديث حالة الاشتراكات المنتهية كل ساعة
expireDue();
setInterval(() => { try { expireDue(); } catch (e) { console.error(e); } }, 60 * 60e3).unref();

/**
 * أول تشغيل على خادم جديد: إنشاء حساب المدير من متغيرات البيئة إذا لم يوجد أي مدير بعد
 * (BOOTSTRAP_ADMIN_PHONE و BOOTSTRAP_ADMIN_PASSWORD). لا يفعل شيئًا إذا كان هناك مدير.
 */
function bootstrapAdmin() {
  const phone = process.env.BOOTSTRAP_ADMIN_PHONE; const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!phone || !password) return;
  const { one, run } = require('./db');
  if (one("SELECT id FROM users WHERE role = 'admin' LIMIT 1")) return;
  try {
    const { hashPassword, validatePassword } = require('./lib/auth');
    const p = require('./lib/http').normalizePhone(phone);
    validatePassword(password);
    const r = run("INSERT INTO users (membership_no, full_name, phone, password_hash, role, phone_verified_at) VALUES (?,?,?,?,'admin',datetime('now'))",
      `TMP-${Date.now()}`, process.env.BOOTSTRAP_ADMIN_NAME || 'المدير العام', p, hashPassword(password));
    run('UPDATE users SET membership_no = ? WHERE id = ?', `AL-${10000 + Number(r.lastInsertRowid)}`, r.lastInsertRowid);
    console.log('✔ أُنشئ حساب المدير الأول من متغيرات البيئة');
  } catch (e) { console.error('تعذر إنشاء المدير الأول:', e.message); }
}

if (require.main === module) {
  bootstrapAdmin();
  require('./lib/wabot').boot(); // تشغيل بوت واتساب إن كان مفعّلًا من الإعدادات
  require('./lib/broadcast').kick(); // متابعة إرسال الرسائل الجماعية المتبقية
  app.listen(config.port, () => console.log(`✔ المنصة تعمل على ${config.publicUrl}  (الدفع: ${config.payment.provider}، الرسائل: ${config.sms.provider})`));
}

module.exports = app;
