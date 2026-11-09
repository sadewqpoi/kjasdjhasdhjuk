'use strict';
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { one, all, run } = require('../db');
const { HttpError, forbidden } = require('./http');

const COOKIE = 'sid';
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function hashPassword(pw) { return bcrypt.hashSync(pw, 11); }
function checkPassword(pw, hash) { return bcrypt.compareSync(pw, hash); }

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'كلمة المرور يجب ألا تقل عن 8 أحرف');
  if (pw.length > 128) throw new HttpError(400, 'كلمة المرور طويلة جدًا');
  if (!/[A-Za-z؀-ۿ]/.test(pw) || !/\d/.test(pw)) throw new HttpError(400, 'كلمة المرور يجب أن تحتوي على حروف وأرقام');
}

function createSession(res, userId, ip) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 864e5);
  run('INSERT INTO sessions (token_hash, user_id, expires_at, ip) VALUES (?,?,?,?)', sha256(token), userId, expires.toISOString(), ip || null);
  run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", userId);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${config.isProd ? '; Secure' : ''}`);
}

function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** يحمّل المستخدم الحالي من الجلسة (إن وُجد) */
function loadUser(req, _res, next) {
  req.user = null;
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const row = one(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                     WHERE s.token_hash = ? AND s.expires_at > ?`, sha256(token), new Date().toISOString());
    if (row && row.status === 'active') {
      req.user = row;
      req.user.permissions = row.role === 'admin'
        ? null // null = كل الصلاحيات
        : new Set(all('SELECT permission FROM staff_permissions WHERE user_id = ?', row.id).map((r) => r.permission));
    }
  }
  next();
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'يجب تسجيل الدخول', 'auth_required'));
  next();
}

function requireVerified(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'يجب تسجيل الدخول', 'auth_required'));
  if (!req.user.phone_verified_at) return next(forbidden('يجب التحقق من رقم الجوال أولًا', 'phone_unverified'));
  next();
}

function hasPermission(user, perm) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role !== 'moderator') return false;
  return user.permissions && user.permissions.has(perm);
}

/** حماية مسارات الإدارة بصلاحية محددة */
function requirePermission(perm) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'يجب تسجيل الدخول', 'auth_required'));
    if (!hasPermission(req.user, perm)) return next(forbidden());
    next();
  };
}
function requireAdmin(req, _res, next) {
  if (!req.user || req.user.role !== 'admin') return next(forbidden('هذا الإجراء للمدير العام فقط'));
  next();
}

// محدد معدّل بسيط في الذاكرة لحماية تسجيل الدخول ورموز التحقق
const buckets = new Map();
function rateLimit(name, max, windowMs) {
  return (req, _res, next) => {
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
    if (++b.n > max) return next(new HttpError(429, 'محاولات كثيرة، حاول لاحقًا', 'rate_limited'));
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 60e3).unref();

module.exports = {
  sha256, hashPassword, checkPassword, validatePassword, createSession, destroySession,
  loadUser, requireAuth, requireVerified, requirePermission, requireAdmin, hasPermission, rateLimit,
};
