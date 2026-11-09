'use strict';
/** رموز التحقق من الجوال (OTP) وإرسال الرسائل النصية */
const crypto = require('node:crypto');
const config = require('../config');
const { one, run, getSetting } = require('../db');
const { bad, HttpError } = require('./http');
const { sha256 } = require('./auth');
const wabot = require('./wabot');
const vm = require('./verify-methods');

const TTL_MIN = 5;
const MAX_ATTEMPTS = 5;
const RESEND_SECONDS = 60;

async function sendSms(phone, text) {
  const s = vm.sms();
  if (s.provider === 'unifonic' && vm.smsConfigured()) {
    const body = new URLSearchParams({
      AppSid: s.unifonicAppSid, SenderID: s.unifonicSender, Recipient: phone, Body: text,
    });
    const r = await fetch('https://el.cloud.unifonic.com/rest/SMS/messages', {
      method: 'POST', body, signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error('SMS provider error ' + r.status);
    return;
  }
  console.log(`[SMS → ${phone}] ${text}`);
}

/** إنشاء رمز وإرساله (via: 'sms' أو 'bot' لبوت واتساب). يُرجع الرمز فقط في بيئة التطوير مع SMS */
async function issue(phone, purpose, { via = 'sms' } = {}) {
  if (via === 'sms' && config.isProd && !vm.smsConfigured()) throw new HttpError(503, 'خدمة الرسائل النصية غير مضبوطة', 'sms_unconfigured');
  if (via === 'bot' && !wabot.available()) throw new HttpError(503, 'خدمة إرسال الرمز عبر واتساب غير متاحة الآن، استخدم الطريقة الأخرى', 'bot_unavailable');
  const last = one('SELECT created_at FROM otp_codes WHERE phone = ? AND purpose = ? ORDER BY id DESC LIMIT 1', phone, purpose);
  if (last && Date.now() - Date.parse(last.created_at + 'Z') < RESEND_SECONDS * 1000) {
    throw new HttpError(429, 'انتظر دقيقة قبل طلب رمز جديد', 'otp_wait');
  }
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  run("UPDATE otp_codes SET consumed_at = datetime('now') WHERE phone = ? AND purpose = ? AND consumed_at IS NULL", phone, purpose);
  run('INSERT INTO otp_codes (phone, purpose, code_hash, expires_at) VALUES (?,?,?,?)',
    phone, purpose, sha256(`${phone}:${code}`), new Date(Date.now() + TTL_MIN * 60e3).toISOString());
  const text = `رمز التحقق لـ${getSetting('site_name', 'مشجرة آل العلاط')}: ${code}\nصالح لمدة ${TTL_MIN} دقائق. لا تشارك هذا الرمز مع أحد.`;
  if (via === 'bot') {
    try { await wabot.send(phone, text); } catch (e) {
      // حذف الرمز الذي لم يُرسل حتى لا يُحسب في مهلة إعادة الإرسال
      run('DELETE FROM otp_codes WHERE phone = ? AND purpose = ? AND consumed_at IS NULL', phone, purpose);
      throw new HttpError(e.noAccount ? 400 : 503, e.noAccount ? 'هذا الرقم لا يملك حساب واتساب' : 'تعذر إرسال الرمز عبر واتساب الآن، استخدم الطريقة الأخرى', 'bot_failed');
    }
    return undefined;
  }
  await sendSms(phone, text);
  // في التطوير فقط وبدون مزوّد مضبوط: يُعاد الرمز ليظهر على الشاشة
  return !config.isProd && !vm.smsConfigured() ? code : undefined;
}

function verify(phone, purpose, code) {
  const row = one(`SELECT * FROM otp_codes WHERE phone = ? AND purpose = ? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1`, phone, purpose);
  if (!row || row.expires_at < new Date().toISOString()) throw bad('رمز التحقق منتهي، اطلب رمزًا جديدًا', 'otp_expired');
  if (row.attempts >= MAX_ATTEMPTS) throw bad('تجاوزت عدد المحاولات، اطلب رمزًا جديدًا', 'otp_locked');
  const ok = crypto.timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(sha256(`${phone}:${String(code || '').trim()}`)));
  if (!ok) {
    run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', row.id);
    throw bad('رمز التحقق غير صحيح', 'otp_invalid');
  }
  run("UPDATE otp_codes SET consumed_at = datetime('now') WHERE id = ?", row.id);
  return true;
}

module.exports = { issue, verify, sendSms };
