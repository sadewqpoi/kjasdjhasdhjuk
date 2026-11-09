'use strict';
const express = require('express');
const { one, run, tx } = require('../db');
const { h, bad, conflict, str, int, oneOf, normalizePhone, HttpError } = require('../lib/http');
const wa = require('../lib/whatsapp');
const vm = require('../lib/verify-methods');
const auth = require('../lib/auth');
const otp = require('../lib/otp');
const { upload, saveAvatar, removeAvatar } = require('../lib/uploads');
const { audit } = require('../lib/audit');
const { nameTokens } = require('../lib/arabic');
const me = require('../lib/me');

const r = express.Router();

/** 1) إنشاء الحساب: الاسم الثلاثي + الجوال + الصورة + كلمة المرور */
r.post('/register', auth.rateLimit('register', 10, 60 * 60e3), upload.single('photo'), h(async (req, res) => {
  const b = req.body || {};
  const fullName = str(b.full_name, 'الاسم الثلاثي', { min: 5, max: 80 });
  if (nameTokens(fullName).length < 3) throw bad('اكتب اسمك الثلاثي كاملًا (الاسم واسم الأب واسم الجد)');
  const phone = normalizePhone(b.phone);
  auth.validatePassword(b.password);
  if (b.password !== b.password_confirm) throw bad('كلمتا المرور غير متطابقتين');
  if (one('SELECT id FROM users WHERE phone = ?', phone)) throw conflict('رقم الجوال مسجل مسبقًا، قم بتسجيل الدخول', 'phone_taken');

  const photo = saveAvatar(req.file);
  let user;
  try {
    user = tx(() => {
      const ins = run('INSERT INTO users (membership_no, full_name, phone, password_hash, photo_file) VALUES (?,?,?,?,?)',
        `TMP-${Date.now()}-${Math.random()}`, fullName, phone, auth.hashPassword(b.password), photo);
      const id = Number(ins.lastInsertRowid);
      run('UPDATE users SET membership_no = ? WHERE id = ?', `AL-${String(10000 + id)}`, id);
      return one('SELECT * FROM users WHERE id = ?', id);
    });
  } catch (e) { removeAvatar(photo); throw e; }

  auth.createSession(res, user.id, req.ip);
  req.user = user;
  audit(req, 'user.register', 'user', user.id);
  // العضو يختار طريقة التحقق في الصفحة التالية (من الطرق التي فعّلها المدير)
  res.status(201).json({ ok: true, membership_no: user.membership_no });
}));

/** واتساب (العضو يرسل الرسالة): إنشاء رمز ورابط الإرسال إلى رقم الصندوق */
r.post('/otp/whatsapp/start', auth.requireAuth, auth.rateLimit('wa-start', 10, 15 * 60e3), h((req, res) => {
  if (req.user.phone_verified_at) return res.json({ ok: true, verified: true });
  vm.require('wa_reverse');
  res.json({ ok: true, ...wa.start(req.user.phone, 'verify_phone') });
}));

/** إرسال رمز للعضو: via = sms | bot، ثم يُدخَل في /otp/verify */
r.post('/otp/send', auth.requireAuth, auth.rateLimit('otp-send', 6, 15 * 60e3), h(async (req, res) => {
  if (req.user.phone_verified_at) return res.json({ ok: true, verified: true });
  const via = oneOf(req.body && req.body.via, ['sms', 'bot'], 'الطريقة');
  vm.require(via === 'bot' ? 'wa_bot' : 'sms');
  const devCode = await otp.issue(req.user.phone, 'verify_phone', { via });
  res.json({ ok: true, dev_code: devCode });
}));

/** التوثيق اليدوي: العضو يطلب، والإدارة توثّق الرقم من قائمة المستخدمين */
r.post('/otp/manual/request', auth.requireAuth, auth.rateLimit('manual-verify', 5, 60 * 60e3), h((req, res) => {
  if (req.user.phone_verified_at) return res.json({ ok: true, verified: true });
  vm.require('manual');
  run("UPDATE users SET verify_requested_at = datetime('now') WHERE id = ?", req.user.id);
  audit(req, 'user.verify_requested', 'user', req.user.id);
  res.json({ ok: true });
}));

r.get('/otp/whatsapp/status', auth.requireAuth, h((req, res) => {
  if (req.user.phone_verified_at) return res.json({ status: 'verified' });
  res.json({ status: wa.status(int(req.query.rid, 'الطلب'), req.user.phone) });
}));

/** 2) التحقق من رقم الجوال */
r.post('/otp/verify', auth.requireAuth, auth.rateLimit('otp', 20, 15 * 60e3), h((req, res) => {
  if (req.user.phone_verified_at) return res.json({ ok: true });
  otp.verify(req.user.phone, 'verify_phone', req.body && req.body.code);
  run("UPDATE users SET phone_verified_at = datetime('now') WHERE id = ?", req.user.id);
  audit(req, 'user.phone_verified', 'user', req.user.id);
  res.json({ ok: true });
}));

r.post('/login', auth.rateLimit('login', 15, 15 * 60e3), h((req, res) => {
  const b = req.body || {};
  let phone;
  try { phone = normalizePhone(b.phone); } catch { throw bad('رقم الجوال أو كلمة المرور غير صحيحة'); }
  const u = one('SELECT * FROM users WHERE phone = ?', phone);
  if (!u || !auth.checkPassword(String(b.password || ''), u.password_hash)) throw bad('رقم الجوال أو كلمة المرور غير صحيحة');
  if (u.status !== 'active') throw new HttpError(403, 'الحساب موقوف، تواصل مع الإدارة', 'suspended');
  auth.createSession(res, u.id, req.ip);
  res.json({ ok: true });
}));

r.post('/logout', h((req, res) => {
  auth.destroySession(req, res);
  res.json({ ok: true });
}));

/**
 * استعادة كلمة المرور. via = wa_reverse | bot | sms (من الطرق التي فعّلها المدير)
 * نفس الاستجابة سواء وُجد الرقم أم لا لمنع كشف الأرقام المسجلة
 */
r.post('/password/forgot', auth.rateLimit('forgot', 5, 15 * 60e3), h(async (req, res) => {
  const phone = normalizePhone(req.body && req.body.phone);
  const toVia = { wa_reverse: 'wa_reverse', wa_bot: 'bot', sms: 'sms' };
  const first = vm.available().map((m) => toVia[m]).filter(Boolean)[0];
  if (!req.body.via && !first) throw bad('لا توجد طريقة متاحة لاستعادة كلمة المرور حاليًا، تواصل مع الإدارة', 'no_method');
  const via = oneOf(req.body.via || first, ['wa_reverse', 'bot', 'sms'], 'الطريقة');
  vm.require(via === 'bot' ? 'wa_bot' : via);
  if (via === 'wa_reverse') return res.json({ ok: true, channel: 'wa_reverse', ...wa.start(phone, 'reset_password') });
  const u = one('SELECT id FROM users WHERE phone = ? AND phone_verified_at IS NOT NULL', phone);
  let devCode;
  if (u) devCode = await otp.issue(phone, 'reset_password', { via });
  res.json({ ok: true, channel: via, dev_code: devCode });
}));

r.get('/password/whatsapp-status', auth.rateLimit('wa-status', 120, 15 * 60e3), h((req, res) => {
  res.json({ status: wa.status(int(req.query.rid, 'الطلب'), normalizePhone(req.query.phone)) });
}));

r.post('/password/reset', auth.rateLimit('reset', 10, 15 * 60e3), h((req, res) => {
  const b = req.body || {};
  const phone = normalizePhone(b.phone);
  auth.validatePassword(b.password);
  const u = one('SELECT id FROM users WHERE phone = ?', phone);
  if (b.rid) {
    wa.consume(int(b.rid, 'الطلب'), phone, 'reset_password');
    if (!u) throw bad('لا يوجد حساب بهذا الرقم');
  } else {
    if (!u) throw bad('رمز التحقق غير صحيح');
    otp.verify(phone, 'reset_password', b.code);
  }
  run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(b.password), u.id);
  run('DELETE FROM sessions WHERE user_id = ?', u.id);
  res.json({ ok: true });
}));

r.get('/me', h((req, res) => {
  res.json(me.build(req.user));
}));

module.exports = r;
