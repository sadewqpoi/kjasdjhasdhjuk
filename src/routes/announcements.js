'use strict';
/** الرسائل الجماعية: يرسلها المدير أو المشرف المخوَّل، وتظهر للأعضاء في الموقع وتصلهم على واتساب */
const express = require('express');
const { one, all, run } = require('../db');
const { h, bad, notFound, int, str, oneOf } = require('../lib/http');
const auth = require('../lib/auth');
const { audit } = require('../lib/audit');
const bc = require('../lib/broadcast');
const wabot = require('../lib/wabot');
const { uploadMedia, saveMedia } = require('../lib/uploads');

const r = express.Router();
const perm = auth.requirePermission('announcements.send');
const mediaUrl = (f) => (f ? `/api/home/media/${f}` : null);
const flag = (v) => v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
const setSetting = (k, v) => run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, String(v));

const memberView = (a) => ({
  id: a.id, kind: a.kind, kind_label: bc.KINDS[a.kind], title: a.title, body: a.body, image: mediaUrl(a.image_file),
  created_at: a.created_at, sender: a.sender_name || null, read: !!a.read_at,
});

// ===================== الأعضاء =====================
r.get('/announcements', auth.requireVerified, h((req, res) => {
  const items = all(`SELECT a.*, d.read_at, u.full_name AS sender_name FROM announcement_deliveries d
                     JOIN announcements a ON a.id = d.announcement_id LEFT JOIN users u ON u.id = a.created_by
                     WHERE d.user_id = ? AND a.is_deleted = 0 ORDER BY a.id DESC LIMIT 200`, req.user.id);
  res.json({ items: items.map(memberView), unread: items.filter((x) => !x.read_at).length });
}));

r.get('/announcements/:id', auth.requireVerified, h((req, res) => {
  const id = int(req.params.id);
  const a = one(`SELECT a.*, d.read_at, d.id AS did, u.full_name AS sender_name FROM announcement_deliveries d
                 JOIN announcements a ON a.id = d.announcement_id LEFT JOIN users u ON u.id = a.created_by
                 WHERE d.user_id = ? AND a.id = ? AND a.is_deleted = 0`, req.user.id, id);
  if (!a) throw notFound('الرسالة غير موجودة');
  if (!a.read_at) run("UPDATE announcement_deliveries SET read_at = datetime('now') WHERE id = ?", a.did);
  res.json(memberView({ ...a, read_at: a.read_at || 'now' }));
}));

r.post('/announcements/read-all', auth.requireVerified, h((req, res) => {
  run("UPDATE announcement_deliveries SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL", req.user.id);
  res.json({ ok: true });
}));

// ===================== الإدارة =====================
r.get('/admin/announcements', perm, h((req, res) => {
  const items = all(`SELECT a.*, u.full_name AS sender_name FROM announcements a LEFT JOIN users u ON u.id = a.created_by
                     WHERE a.is_deleted = 0 ORDER BY a.id DESC LIMIT 100`);
  res.json({
    kinds: bc.KINDS,
    audiences: Object.entries(bc.AUDIENCES).map(([key, label]) => ({ key, label, ...bc.countRecipients(key) })),
    channel: bc.channelInfo(),
    queue: { waiting_reason: bc.state.waiting_reason, last_error: bc.state.last_error },
    can_configure: req.user.role === 'admin',
    items: items.map((a) => ({
      id: a.id, kind: a.kind, title: a.title, body: a.body, image: mediaUrl(a.image_file), audience: a.audience,
      send_whatsapp: !!a.send_whatsapp, wa_cancelled: !!a.wa_cancelled, created_at: a.created_at, sender: a.sender_name, stats: bc.stats(a.id),
    })),
  });
}));

r.post('/admin/announcements', perm, auth.rateLimit('broadcast', 20, 60 * 60e3), uploadMedia.single('image'), h((req, res) => {
  const b = req.body || {};
  const kind = oneOf(b.kind || 'general', Object.keys(bc.KINDS), 'نوع الرسالة');
  const audience = oneOf(b.audience || 'all', Object.keys(bc.AUDIENCES), 'المستلمون');
  const title = str(b.title, 'العنوان', { max: 120 });
  const body = str(b.body, 'نص الرسالة', { max: 3000 }).replace(/\r\n?/g, '\n');
  const sendWhatsapp = flag(b.send_whatsapp);
  const image = saveMedia(req.file);
  const id = bc.create({ kind, title, body, image, audience, sendWhatsapp, userId: req.user.id });
  const st = bc.stats(id);
  if (!st.recipients) throw bad('لا يوجد أعضاء موثّقون يستقبلون هذه الرسالة');
  audit(req, 'announcement.send', 'announcement', id, { kind, title, audience, whatsapp: sendWhatsapp, recipients: st.recipients });
  if (sendWhatsapp) bc.kick();
  res.status(201).json({ id, stats: st, channel: bc.channel() });
}));

r.get('/admin/announcements/:id/deliveries', perm, h((req, res) => {
  const id = int(req.params.id);
  const status = req.query.status && req.query.status !== 'all' ? oneOf(req.query.status, ['pending', 'sent', 'failed', 'skipped', 'cancelled', 'unread'], 'الحالة') : null;
  const cond = status === 'unread' ? 'AND d.read_at IS NULL' : status ? 'AND d.wa_status = ?' : '';
  const items = all(`SELECT d.user_id, d.phone, d.read_at, d.wa_status, d.wa_error, d.wa_sent_at, u.full_name, u.membership_no
                     FROM announcement_deliveries d JOIN users u ON u.id = d.user_id
                     WHERE d.announcement_id = ? ${cond} ORDER BY u.full_name LIMIT 2000`, ...(status && status !== 'unread' ? [id, status] : [id]));
  res.json({ items });
}));

r.post('/admin/announcements/:id/cancel-whatsapp', perm, h((req, res) => {
  const id = int(req.params.id);
  if (!one('SELECT id FROM announcements WHERE id = ?', id)) throw notFound();
  const n = bc.cancelWhatsapp(id);
  audit(req, 'announcement.wa_cancel', 'announcement', id, { cancelled: n });
  res.json({ ok: true, cancelled: n });
}));

r.post('/admin/announcements/:id/retry', perm, h((req, res) => {
  const id = int(req.params.id);
  const a = one('SELECT * FROM announcements WHERE id = ? AND is_deleted = 0', id);
  if (!a) throw notFound();
  if (!a.send_whatsapp) throw bad('هذه الرسالة لم تُرسل على واتساب');
  run('UPDATE announcements SET wa_cancelled = 0 WHERE id = ?', id);
  const n = run("UPDATE announcement_deliveries SET wa_status = 'pending', wa_attempts = 0, wa_error = NULL WHERE announcement_id = ? AND wa_status IN ('failed','cancelled')", id).changes;
  bc.kick();
  audit(req, 'announcement.wa_retry', 'announcement', id, { retried: n });
  res.json({ ok: true, retried: n });
}));

r.delete('/admin/announcements/:id', perm, h((req, res) => {
  const id = int(req.params.id);
  if (!one('SELECT id FROM announcements WHERE id = ?', id)) throw notFound();
  bc.cancelWhatsapp(id);
  run('UPDATE announcements SET is_deleted = 1 WHERE id = ?', id);
  audit(req, 'announcement.delete', 'announcement', id);
  res.json({ ok: true });
}));

/** إعداد قناة واتساب للرسائل الجماعية (المدير العام فقط) */
r.put('/admin/announcements/channel', auth.requireAdmin, h(async (req, res) => {
  const b = req.body || {};
  if (b.bot_for_broadcast !== undefined) setSetting('wa_bot_broadcast', flag(b.bot_for_broadcast) ? '1' : '0');
  if (b.template !== undefined) {
    const t = String(b.template || '').trim();
    if (t && !/^[a-z0-9_]{1,512}$/.test(t)) throw bad('اسم القالب بأحرف إنجليزية صغيرة وأرقام و _ فقط كما هو في Meta');
    setSetting('wa_broadcast_template', t);
  }
  if (b.lang !== undefined) {
    const l = String(b.lang || 'ar').trim();
    if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(l)) throw bad('رمز اللغة غير صالح (مثل ar أو en_US)');
    setSetting('wa_broadcast_lang', l);
  }
  if (wabot.status().enabled) await wabot.start(); else await wabot.stop();
  audit(req, 'announcement.channel', 'settings', null, { bot: b.bot_for_broadcast, template: b.template });
  bc.kick();
  res.json(bc.channelInfo());
}));

module.exports = r;
