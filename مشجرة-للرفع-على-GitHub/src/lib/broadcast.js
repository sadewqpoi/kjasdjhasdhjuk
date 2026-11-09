'use strict';
/**
 * الرسائل الجماعية: تُحفظ لكل عضو (تظهر في الموقع فورًا) وتُرسل على واتساب عبر طابور بطيء.
 *
 * قنوات واتساب (تُختار تلقائيًا):
 *  - bot:   بوت واتساب المربوط بـ QR (غير رسمي، مجاني، يدعم الصور) — رسالة كل عدة ثوانٍ وبحد يومي لتقليل خطر الحظر.
 *  - cloud: واتساب الرسمي (Meta Cloud API) بقالب معتمد فيه متغير واحد {{1}} — لا يمكن إرسال نص حر لعضو لم يراسلك خلال 24 ساعة.
 */
const config = require('../config');
const { one, all, run, tx, getSetting } = require('../db');
const { bad } = require('./http');
const vm = require('./verify-methods');
const wabot = require('./wabot');
const { mediaPath } = require('./uploads');

const KINDS = { invitation: 'دعوة', announcement: 'إعلان', congrats: 'تهنئة', condolence: 'تعزية', general: 'رسالة عامة' };
const AUDIENCES = { all: 'جميع الأعضاء الموثّقين', linked: 'المرتبطون بالمشجرة فقط' };

// ثوانٍ بين كل رسالة وأخرى (البوت أبطأ لتقليل خطر الحظر)
const DELAY_MS = { bot: Number(process.env.BROADCAST_BOT_DELAY_MS || 7000), cloud: Number(process.env.BROADCAST_CLOUD_DELAY_MS || 1200) };
const MAX_ATTEMPTS = 3;

function cloudCfg() {
  const w = vm.wa();
  return { ...w, template: getSetting('wa_broadcast_template', '') || '', lang: getSetting('wa_broadcast_lang', 'ar') || 'ar' };
}
const cloudReady = () => { const c = cloudCfg(); return !!(c.token && c.phoneNumberId && c.template); };

/** القناة المتاحة الآن لإرسال واتساب (أو null) */
function channel() {
  if (wabot.available()) return 'bot';
  if (cloudReady()) return 'cloud';
  return null;
}

function channelInfo() {
  const bot = wabot.status();
  return {
    active: channel(),
    bot: { enabled: bot.enabled, for_broadcast: getSetting('wa_bot_broadcast', '0') === '1', for_otp: vm.enabled().includes('wa_bot'), status: bot.status, me: bot.me, sent_today: bot.sent_today,
      daily_limit: Number(getSetting('wa_bot_daily_limit', '200')) || 200 },
    cloud: { ready: cloudReady(), has_token: !!cloudCfg().token, template: cloudCfg().template, lang: cloudCfg().lang },
  };
}

const recipientsSql = (audience) => `SELECT id, phone, wa_broadcast_opt_out FROM users
  WHERE status = 'active' AND phone_verified_at IS NOT NULL ${audience === 'linked' ? 'AND person_id IS NOT NULL' : ''}`;
const countRecipients = (audience) => {
  const rows = all(recipientsSql(audience));
  return { total: rows.length, whatsapp: rows.filter((r) => !r.wa_broadcast_opt_out).length };
};

/** إنشاء الرسالة وتسجيلها لكل المستلمين */
function create({ kind, title, body, image, audience, sendWhatsapp, userId }) {
  if (!KINDS[kind]) throw bad('نوع الرسالة غير صالح');
  if (!AUDIENCES[audience]) throw bad('المستلمون غير صالحين');
  return tx(() => {
    const ins = run('INSERT INTO announcements (kind, title, body, image_file, audience, send_whatsapp, created_by) VALUES (?,?,?,?,?,?,?)',
      kind, title, body, image, audience, sendWhatsapp ? 1 : 0, userId);
    const id = Number(ins.lastInsertRowid);
    for (const u of all(recipientsSql(audience))) {
      const wa = !sendWhatsapp ? 'none' : u.wa_broadcast_opt_out ? 'skipped' : 'pending';
      run('INSERT INTO announcement_deliveries (announcement_id, user_id, phone, wa_status, wa_error, read_at) VALUES (?,?,?,?,?,?)',
        id, u.id, u.phone, wa, wa === 'skipped' ? 'أوقف العضو استقبال الرسائل الجماعية على واتساب' : null,
        u.id === userId ? new Date().toISOString() : null); // المرسل قرأها
    }
    return id;
  });
}

function stats(id) {
  const r = one(`SELECT COUNT(*) AS recipients,
      SUM(read_at IS NOT NULL) AS read,
      SUM(wa_status = 'sent') AS wa_sent, SUM(wa_status = 'pending') AS wa_pending,
      SUM(wa_status = 'failed') AS wa_failed, SUM(wa_status = 'skipped') AS wa_skipped, SUM(wa_status = 'cancelled') AS wa_cancelled
    FROM announcement_deliveries WHERE announcement_id = ?`, id);
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v || 0]));
}

function cancelWhatsapp(id) {
  run('UPDATE announcements SET wa_cancelled = 1 WHERE id = ?', id);
  return run("UPDATE announcement_deliveries SET wa_status = 'cancelled' WHERE announcement_id = ? AND wa_status = 'pending'", id).changes;
}

/** نص رسالة واتساب */
function waText(a) {
  const site = getSetting('site_name', 'مشجرة آل العلاط');
  return `*${KINDS[a.kind]}: ${a.title}*\n\n${a.body}\n\n— ${site}\n${config.publicUrl}/#/announcements/${a.id}`;
}

async function sendCloud(phone, a) {
  const c = cloudCfg();
  // متغيرات القوالب لا تقبل الأسطر الجديدة ولا المسافات المتكررة
  const param = `${KINDS[a.kind]}: ${a.title} — ${a.body}`.replace(/\s*\n+\s*/g, ' - ').replace(/\s{2,}/g, ' ').slice(0, 1000);
  const r = await fetch(`https://graph.facebook.com/${c.apiVersion}/${c.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'template',
      template: { name: c.template, language: { code: c.lang }, components: [{ type: 'body', parameters: [{ type: 'text', text: param }] }] } }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    let msg = `رفض واتساب الرسمي الإرسال (${r.status})`;
    try { const j = await r.json(); if (j.error && j.error.message) msg += `: ${j.error.message}`; } catch { /* ignore */ }
    throw new Error(msg);
  }
}

// ===================== طابور الإرسال =====================
let timer = null; let busy = false;
const state = { last_error: null, waiting_reason: null };

async function tick() {
  timer = null;
  if (busy) return;
  busy = true;
  let delay = 15000; // انتظار افتراضي عند عدم وجود عمل أو قناة
  try {
    const d = one(`SELECT d.*, a.kind, a.title, a.body, a.image_file, a.id AS aid FROM announcement_deliveries d
                   JOIN announcements a ON a.id = d.announcement_id
                   WHERE d.wa_status = 'pending' AND a.wa_cancelled = 0 AND a.is_deleted = 0 ORDER BY d.id LIMIT 1`);
    if (!d) { state.waiting_reason = null; return; }
    const ch = channel();
    if (!ch) { state.waiting_reason = 'no_channel'; return; }
    state.waiting_reason = null;
    const a = { id: d.aid, kind: d.kind, title: d.title, body: d.body };
    run('UPDATE announcement_deliveries SET wa_attempts = wa_attempts + 1 WHERE id = ?', d.id);
    try {
      if (ch === 'bot') await wabot.send(d.phone, waText(a), { image: d.image_file ? mediaPath(d.image_file) : null });
      else await sendCloud(d.phone, a);
      run("UPDATE announcement_deliveries SET wa_status = 'sent', wa_channel = ?, wa_error = NULL, wa_sent_at = datetime('now') WHERE id = ?", ch, d.id);
      delay = DELAY_MS[ch] * (0.75 + Math.random() * 0.5); // فاصل غير منتظم
    } catch (e) {
      state.last_error = e.message;
      if (/الحد اليومي/.test(e.message)) {
        run('UPDATE announcement_deliveries SET wa_attempts = wa_attempts - 1 WHERE id = ?', d.id);
        state.waiting_reason = 'daily_limit'; delay = 30 * 60e3; // نكمل لاحقًا
      } else if (e.noAccount || d.wa_attempts + 1 >= MAX_ATTEMPTS) {
        run("UPDATE announcement_deliveries SET wa_status = 'failed', wa_channel = ?, wa_error = ? WHERE id = ?", ch, e.message.slice(0, 300), d.id);
        delay = DELAY_MS[ch];
      } else {
        run('UPDATE announcement_deliveries SET wa_error = ? WHERE id = ?', e.message.slice(0, 300), d.id);
        delay = 20000;
      }
    }
  } catch (e) {
    console.error('الرسائل الجماعية:', e.message);
  } finally {
    busy = false;
    schedule(delay);
  }
}

function schedule(ms = 0) {
  if (timer) { if (ms > 0) return; clearTimeout(timer); }
  timer = setTimeout(tick, ms);
  if (timer.unref) timer.unref();
}

/** تشغيل الطابور (عند بدء الخادم وبعد كل رسالة جديدة) */
function kick() { if (!busy) schedule(0); }

/** للاختبارات: تشغيل الطابور حتى يفرغ */
async function drain(max = 500) {
  for (let i = 0; i < max; i++) {
    const before = one("SELECT COUNT(*) c FROM announcement_deliveries d JOIN announcements a ON a.id = d.announcement_id WHERE d.wa_status = 'pending' AND a.wa_cancelled = 0 AND a.is_deleted = 0").c;
    if (!before || !channel()) return;
    clearTimeout(timer); timer = null;
    await tick();
  }
}

module.exports = { KINDS, AUDIENCES, channel, channelInfo, countRecipients, create, stats, cancelWhatsapp, waText, kick, drain, state, cloudReady };
