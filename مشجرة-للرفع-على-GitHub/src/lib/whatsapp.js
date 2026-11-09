'use strict';
/**
 * التحقق من رقم الجوال عبر واتساب بطريقة "الرسالة العكسية":
 * 1) المنصة تُنشئ رمزًا وتعطي العضو رابط wa.me فيه رسالة جاهزة إلى رقم واتساب الصندوق.
 * 2) العضو يرسلها من واتساب رقمه المسجَّل.
 * 3) تصل الرسالة إلى الخادم عبر Webhook من WhatsApp Cloud API (استقبال الرسائل مجاني)،
 *    فيتأكد الخادم أن الرمز صحيح وأن المرسِل هو نفس الرقم المسجَّل، ثم يوثّق الرقم.
 */
const crypto = require('node:crypto');
const config = require('../config');
const { one, run, getSetting } = require('../db');
const { HttpError, notFound } = require('./http');
const { sha256 } = require('./auth');

const TTL_MIN = 15;
const RESEND_SECONDS = 30;

const vm = require('./verify-methods');
const configured = () => !!vm.wa().number;
/** وضع المحاكاة: للتطوير فقط، عندما لا يوجد رقم واتساب حقيقي */
const devMode = () => !config.isProd && !configured();
// ملاحظة: إعدادات واتساب تُقرأ من لوحة الإدارة (verify-methods.wa) وإلا من .env

function messageText(code, purpose) {
  const site = getSetting('site_name', 'مشجرة آل العلاط');
  return purpose === 'reset_password'
    ? `استعادة كلمة المرور في ${site}\nالرمز: ${code}`
    : `تفعيل حسابي في ${site}\nالرمز: ${code}`;
}

/** بدء تحقق جديد: يُرجع رقم الطلب ورابط واتساب */
function start(phone, purpose) {
  const last = one("SELECT created_at FROM wa_verifications WHERE phone = ? AND purpose = ? ORDER BY id DESC LIMIT 1", phone, purpose);
  if (last && Date.now() - Date.parse(last.created_at + 'Z') < RESEND_SECONDS * 1000) {
    throw new HttpError(429, 'انتظر قليلًا قبل طلب رمز جديد', 'otp_wait');
  }
  run("UPDATE wa_verifications SET status = 'expired' WHERE phone = ? AND purpose = ? AND status = 'pending'", phone, purpose);
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  const ins = run('INSERT INTO wa_verifications (phone, purpose, code_hash, expires_at) VALUES (?,?,?,?)',
    phone, purpose, sha256(`${phone}:${code}`), new Date(Date.now() + TTL_MIN * 60e3).toISOString());
  const text = messageText(code, purpose);
  return {
    rid: Number(ins.lastInsertRowid),
    phone,
    text,
    wa_link: configured() ? `https://wa.me/${vm.wa().number}?text=${encodeURIComponent(text)}` : null,
    wa_number: vm.wa().number || null,
    dev: devMode(),
    expires_minutes: TTL_MIN,
  };
}

/** توثيق الطلب بعد وصول الرسالة الصحيحة */
function markVerified(row) {
  run("UPDATE wa_verifications SET status = 'verified', verified_at = datetime('now') WHERE id = ? AND status = 'pending'", row.id);
  if (row.purpose === 'verify_phone') {
    run("UPDATE users SET phone_verified_at = COALESCE(phone_verified_at, datetime('now')) WHERE phone = ?", row.phone);
  }
}

/** معالجة رسالة واردة: from بالصيغة الدولية بدون + ، body نص الرسالة */
function handleIncoming(from, body) {
  const phone = String(from || '').replace(/\D/g, '');
  const m = String(body || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).match(/(\d{6})/);
  if (!phone || !m) return null;
  const code = m[1];
  const row = one(`SELECT * FROM wa_verifications WHERE phone = ? AND status = 'pending' AND code_hash = ? AND expires_at > ? ORDER BY id DESC LIMIT 1`,
    phone, sha256(`${phone}:${code}`), new Date().toISOString());
  if (!row) return null;
  markVerified(row);
  return row;
}

function status(rid, phone) {
  const row = one('SELECT * FROM wa_verifications WHERE id = ? AND phone = ?', rid, phone);
  if (!row) throw notFound();
  if (row.status === 'pending' && row.expires_at < new Date().toISOString()) return 'expired';
  return row.status;
}

/** استهلاك طلب موثَّق (لاستعادة كلمة المرور) */
function consume(rid, phone, purpose) {
  const row = one('SELECT * FROM wa_verifications WHERE id = ? AND phone = ? AND purpose = ?', rid, phone, purpose);
  const fresh = row && row.verified_at && Date.now() - Date.parse(row.verified_at + 'Z') < TTL_MIN * 60e3;
  if (!row || row.status !== 'verified' || !fresh) throw new HttpError(400, 'لم يكتمل التحقق عبر واتساب، أعد المحاولة', 'wa_not_verified');
  run("UPDATE wa_verifications SET status = 'used' WHERE id = ?", row.id);
}

/** التحقق من توقيع Meta على الرسالة الواردة */
function validSignature(rawBody, header) {
  const secret = vm.wa().appSecret;
  if (!secret) return !config.isProd; // في الإنتاج التوقيع إلزامي
  if (!rawBody || !header || !header.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected); const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** رد اختياري للعضو داخل نافذة المحادثة (يحتاج WHATSAPP_TOKEN و WHATSAPP_PHONE_NUMBER_ID) */
async function reply(to, text) {
  const w = vm.wa();
  if (!w.token || !w.phoneNumberId) return;
  try {
    await fetch(`https://graph.facebook.com/${w.apiVersion}/${w.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${w.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) { console.error('WhatsApp reply failed:', e.message); }
}

module.exports = { start, handleIncoming, status, consume, validSignature, reply, configured, devMode, markVerified, TTL_MIN };
