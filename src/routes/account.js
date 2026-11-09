'use strict';
/** لوحة تحكم المستخدم */
const express = require('express');
const fs = require('node:fs');
const { one, all, run } = require('../db');
const { h, bad, notFound, oneOf } = require('../lib/http');
const auth = require('../lib/auth');
const tree = require('../lib/tree');
const subs = require('../lib/subscriptions');
const { upload, saveAvatar, removeAvatar, avatarPath } = require('../lib/uploads');
const { audit } = require('../lib/audit');

const r = express.Router();
r.use(auth.requireAuth);

r.get('/', h((req, res) => {
  const u = req.user;
  const { plan, subscription } = subs.getEffectivePlan(u.id);
  let daysLeft = null;
  if (subscription) daysLeft = Math.max(0, Math.ceil((Date.parse(subscription.end_at) - Date.now()) / 864e5));
  const lastSub = subscription || one(`SELECT s.*, p.name AS plan_name FROM subscriptions s JOIN plans p ON p.id = s.plan_id
                                       WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 1`, u.id);
  res.json({
    user: {
      membership_no: u.membership_no, full_name: u.full_name, phone: u.phone, phone_verified: !!u.phone_verified_at,
      photo_url: u.photo_file ? '/api/account/photo' : null, created_at: u.created_at,
      privacy: { photo: u.privacy_photo, phone: u.privacy_phone, birth: u.privacy_birth },
      wa_broadcast: !u.wa_broadcast_opt_out,
    },
    person: u.person_id ? { id: u.person_id, full_name: tree.fullName(u.person_id, 8), linked_at: u.linked_at } : null,
    plan: plan && { id: plan.id, name: plan.name, color: plan.color, tier: plan.tier, is_free: !!plan.is_free },
    subscription: subscription ? { ...subscription, days_left: daysLeft } : null,
    last_subscription: lastSub && lastSub.status !== 'active' ? { id: lastSub.id, plan_id: lastSub.plan_id, plan_name: lastSub.plan_name, status: lastSub.status, end_at: lastSub.end_at } : null,
    subscriptions: all(`SELECT s.id, s.status, s.start_at, s.end_at, s.source, p.name AS plan_name FROM subscriptions s
                        JOIN plans p ON p.id = s.plan_id WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 50`, u.id),
    payments: all(`SELECT pay.id, pay.purpose, pay.amount_halalas, pay.currency, pay.status, pay.method, pay.created_at, pay.verified_at, p.name AS plan_name
                   FROM payments pay JOIN plans p ON p.id = pay.plan_id WHERE pay.user_id = ? ORDER BY pay.id DESC LIMIT 50`, u.id),
  });
}));

r.get('/photo', h((req, res) => {
  const f = avatarPath(req.user.photo_file);
  if (!f || !fs.existsSync(f)) throw notFound();
  res.setHeader('Cache-Control', 'private, no-cache');
  res.sendFile(f);
}));

r.post('/photo', upload.single('photo'), h((req, res) => {
  const name = saveAvatar(req.file);
  const old = req.user.photo_file;
  run('UPDATE users SET photo_file = ? WHERE id = ?', name, req.user.id);
  removeAvatar(old);
  audit(req, 'user.photo_changed', 'user', req.user.id);
  res.json({ ok: true });
}));

r.put('/privacy', h((req, res) => {
  const b = req.body || {};
  const levels = ['members', 'relatives', 'none'];
  run('UPDATE users SET privacy_photo = ?, privacy_phone = ?, privacy_birth = ? WHERE id = ?',
    oneOf(b.photo, levels, 'خصوصية الصورة'), oneOf(b.phone, levels, 'خصوصية الجوال'), oneOf(b.birth, levels, 'خصوصية تاريخ الميلاد'), req.user.id);
  if (b.wa_broadcast !== undefined) {
    const on = b.wa_broadcast === true || b.wa_broadcast === 1 || b.wa_broadcast === '1' || b.wa_broadcast === 'on';
    run('UPDATE users SET wa_broadcast_opt_out = ? WHERE id = ?', on ? 0 : 1, req.user.id);
    // إيقاف ما لم يُرسل بعد من الرسائل الجماعية لهذا العضو
    if (!on) run("UPDATE announcement_deliveries SET wa_status = 'skipped', wa_error = 'أوقف العضو استقبال الرسائل الجماعية على واتساب' WHERE user_id = ? AND wa_status = 'pending'", req.user.id);
  }
  res.json({ ok: true });
}));

r.post('/password', h((req, res) => {
  const b = req.body || {};
  if (!auth.checkPassword(String(b.current || ''), req.user.password_hash)) throw bad('كلمة المرور الحالية غير صحيحة');
  auth.validatePassword(b.password);
  if (b.password !== b.password_confirm) throw bad('كلمتا المرور غير متطابقتين');
  run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(b.password), req.user.id);
  audit(req, 'user.password_changed', 'user', req.user.id);
  res.json({ ok: true });
}));

module.exports = r;
