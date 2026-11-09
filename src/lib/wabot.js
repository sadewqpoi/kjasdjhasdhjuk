'use strict';
/**
 * بوت واتساب غير رسمي (مكتبة Baileys) يرسل رموز التحقق تلقائيًا من رقم واتساب عادي
 * مربوط كـ "جهاز مرتبط" (مثل واتساب ويب).
 *
 * تنبيه: هذه الطريقة غير معتمدة من واتساب وقد يُحظر الرقم. استخدم رقمًا منفصلًا مخصصًا للبوت.
 * هي خيار احتياطي فقط؛ الطريقة الأساسية تبقى "العضو يرسل الرسالة إلى رقم الصندوق".
 *
 * WA_BOT_DRIVER=mock يستبدل الاتصال الحقيقي ببوت وهمي (للاختبارات).
 */
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { getSetting } = require('../db');

const AUTH_DIR = path.join(path.dirname(config.dbFile), 'wa-bot-auth');
const MOCK = process.env.WA_BOT_DRIVER === 'mock';

const st = {
  status: 'disabled',   // disabled | connecting | qr | connected | logged_out | error
  qr: null,             // رمز QR بصيغة صورة (data URL) أثناء الربط
  me: null,             // رقم البوت بعد الربط
  error: null,
  sock: null,
  sentToday: 0,
  day: null,
};
const mockOutbox = [];  // للاختبارات فقط
let reconnectTimer = null;
let starting = false;

/** البوت يعمل عندما يفعّل المدير طريقة "بوت واتساب" للتحقق، أو يفعّله لإرسال الرسائل الجماعية */
const enabled = () => require('./verify-methods').enabled().includes('wa_bot') || getSetting('wa_bot_broadcast', '0') === '1';

function status() {
  return { enabled: enabled(), status: st.status, qr: st.qr, me: st.me, error: st.error, sent_today: st.sentToday };
}
const available = () => enabled() && st.status === 'connected';

async function start() {
  if (starting || st.sock) return;
  clearTimeout(reconnectTimer);
  if (MOCK) { st.status = 'connected'; st.me = '966500000000'; st.sock = { mock: true }; return; }
  starting = true;
  st.status = 'connecting'; st.error = null;
  try {
    const B = await import('@whiskeysockets/baileys');
    const makeWASocket = B.makeWASocket || B.default;
    const QR = require('qrcode');
    const pino = require('pino');
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    const { state, saveCreds } = await B.useMultiFileAuthState(AUTH_DIR);
    let version;
    try { ({ version } = await B.fetchLatestBaileysVersion()); } catch { /* نستخدم الافتراضي */ }
    const sock = makeWASocket({
      auth: state,
      ...(version ? { version } : {}),
      logger: pino({ level: 'silent' }),
      browser: B.Browsers ? B.Browsers.ubuntu('Chrome') : ['Ubuntu', 'Chrome', '1.0'],
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    st.sock = sock;
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async (u) => {
      if (u.qr) {
        st.status = 'qr';
        try { st.qr = await QR.toDataURL(u.qr, { margin: 1, width: 280 }); } catch { st.qr = null; }
      }
      if (u.connection === 'open') {
        st.status = 'connected'; st.qr = null; st.error = null;
        st.me = String((sock.user && sock.user.id) || '').split(':')[0].split('@')[0] || null;
        console.log(`✔ بوت واتساب متصل (${st.me})`);
      }
      if (u.connection === 'close') {
        const code = u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.output && u.lastDisconnect.error.output.statusCode;
        const loggedOut = code === (B.DisconnectReason && B.DisconnectReason.loggedOut);
        st.sock = null; st.qr = null;
        if (loggedOut) {
          st.status = 'logged_out'; st.me = null;
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          console.log('بوت واتساب: تم فك الربط من الجوال');
          if (enabled()) reconnectTimer = setTimeout(start, 3000); // لعرض QR جديد
        } else if (enabled()) {
          st.status = 'connecting';
          reconnectTimer = setTimeout(start, 5000);
        } else {
          st.status = 'disabled';
        }
      }
    });
  } catch (e) {
    st.sock = null; st.status = 'error'; st.error = e.message;
    console.error('بوت واتساب: تعذر التشغيل:', e.message);
    if (enabled()) reconnectTimer = setTimeout(start, 30000);
  } finally {
    starting = false;
  }
}

async function stop() {
  clearTimeout(reconnectTimer);
  const s = st.sock; st.sock = null;
  if (s && !s.mock) { try { s.end(undefined); } catch { /* تجاهل */ } }
  st.status = 'disabled'; st.qr = null;
}

/** فك ربط رقم البوت نهائيًا (يحتاج مسح QR من جديد) */
async function logout() {
  clearTimeout(reconnectTimer);
  const s = st.sock; st.sock = null;
  if (s && !s.mock) { try { await s.logout(); } catch { /* تجاهل */ } }
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  st.me = null; st.qr = null; st.status = 'logged_out';
  if (enabled()) setTimeout(start, 1000);
}

/** إرسال رسالة نصية (أو صورة مع وصف) إلى رقم بالصيغة الدولية 9665XXXXXXXX */
async function send(phone, text, { image = null } = {}) {
  if (!available() || !st.sock) throw new Error('بوت واتساب غير متصل');
  const today = new Date().toISOString().slice(0, 10);
  if (st.day !== today) { st.day = today; st.sentToday = 0; }
  // حد يومي لتقليل خطر الحظر
  const max = Number(getSetting('wa_bot_daily_limit', '200')) || 200;
  if (st.sentToday >= max) throw new Error('تجاوز البوت الحد اليومي للرسائل');
  if (MOCK) {
    if (String(phone).endsWith('0000000')) { const e = new Error('هذا الرقم لا يملك حساب واتساب'); e.noAccount = true; throw e; }
    mockOutbox.push({ phone, text, image: !!image }); st.sentToday++; return;
  }
  const jid = `${String(phone).replace(/\D/g, '')}@s.whatsapp.net`;
  const [r] = await st.sock.onWhatsApp(jid).catch(() => [null]);
  if (r && r.exists === false) { const e = new Error('هذا الرقم لا يملك حساب واتساب'); e.noAccount = true; throw e; }
  await st.sock.sendMessage((r && r.jid) || jid, image && fs.existsSync(image) ? { image: fs.readFileSync(image), caption: text } : { text });
  st.sentToday++;
}

/** تشغيل البوت عند بدء الخادم إن كان مفعّلًا */
function boot() { if (enabled()) start(); }

module.exports = { status, available, start, stop, logout, send, boot, mockOutbox };
