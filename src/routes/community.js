'use strict';
/** المناسبات العائلية القادمة + الاقتراحات والاستفسارات (للأعضاء والإدارة) */
const express = require('express');
const { one, all, run } = require('../db');
const { h, bad, notFound, int, str, oneOf } = require('../lib/http');
const auth = require('../lib/auth');
const { audit } = require('../lib/audit');
const modules = require('../lib/modules');

const r = express.Router();
const perm = auth.requirePermission;

// ===================== أدوات =====================
/** الوقت الحالي بتوقيت السعودية (UTC+3) بصيغة YYYY-MM-DDTHH:MM */
function riyadhNow() {
  return new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 16);
}
function dateTime(v, label, { optional = false } = {}) {
  if (v == null || v === '') { if (optional) return null; throw bad(`${label} مطلوب`); }
  const s = String(v).trim().replace(' ', 'T').slice(0, 16);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) || Number.isNaN(Date.parse(s + ':00Z'))) throw bad(`${label} غير صحيح`);
  return s;
}
function mapUrl(v) {
  const s = str(v, 'رابط الموقع', { optional: true, max: 500 });
  if (!s) return null;
  if (!/^https:\/\/\S+$/i.test(s)) throw bad('رابط الموقع يجب أن يبدأ بـ https://');
  return s;
}
/** المناسبة تُعدّ قادمة حتى نهاية يومه (أو حتى وقت انتهائه إن تجاوز اليوم) */
const UPCOMING = `(substr(e.starts_at, 1, 10) >= substr(?, 1, 10) OR COALESCE(e.ends_at, '') >= ?)`;

function eventRows(where, params, userId, order) {
  return all(`
    SELECT e.*,
      (SELECT COUNT(*) FROM event_rsvps x WHERE x.event_id = e.id AND x.status = 'yes')   AS going,
      (SELECT COUNT(*) FROM event_rsvps x WHERE x.event_id = e.id AND x.status = 'maybe') AS maybe,
      (SELECT COUNT(*) FROM event_rsvps x WHERE x.event_id = e.id AND x.status = 'no')    AS not_going,
      (SELECT status FROM event_rsvps x WHERE x.event_id = e.id AND x.user_id = ?)          AS my_rsvp
    FROM events e WHERE ${where} ORDER BY e.starts_at ${order} LIMIT 100`, userId, ...params);
}

// ===================== الأعضاء: المناسبات =====================
r.get('/events', auth.requireVerified, modules.requireModule('events'), h((req, res) => {
  const scope = oneOf(req.query.scope || 'upcoming', ['upcoming', 'past'], 'النطاق');
  const now = riyadhNow();
  const items = scope === 'upcoming'
    ? eventRows(`e.is_published = 1 AND ${UPCOMING}`, [now, now], req.user.id, 'ASC')
    : eventRows(`e.is_published = 1 AND NOT ${UPCOMING}`, [now, now], req.user.id, 'DESC');
  res.json({ now, items: items.map(({ created_by, ...e }) => e) });
}));

r.put('/events/:id/rsvp', auth.requireVerified, modules.requireModule('events'), h((req, res) => {
  const id = int(req.params.id);
  const now = riyadhNow();
  const ev = one(`SELECT e.* FROM events e WHERE e.id = ? AND e.is_published = 1`, id);
  if (!ev) throw notFound('المناسبة غير موجودة');
  if (ev.is_cancelled) throw bad('هذه المناسبة ملغاة');
  if (!one(`SELECT 1 FROM events e WHERE e.id = ? AND ${UPCOMING}`, id, now, now)) throw bad('انتهت هذه المناسبة');
  const status = oneOf(req.body && req.body.status, ['yes', 'maybe', 'no'], 'الرد');
  run(`INSERT INTO event_rsvps (event_id, user_id, status) VALUES (?,?,?)
       ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status, updated_at = datetime('now')`, id, req.user.id, status);
  const [row] = eventRows('e.id = ?', [id], req.user.id, 'ASC');
  res.json({ ok: true, going: row.going, maybe: row.maybe, not_going: row.not_going, my_rsvp: row.my_rsvp });
}));

// ===================== الأعضاء: الاقتراحات والاستفسارات =====================
r.get('/feedback', auth.requireVerified, modules.requireModule('feedback'), h((req, res) => {
  const items = all('SELECT id, type, subject, message, status, reply, replied_at, created_at, user_seen FROM feedback WHERE user_id = ? ORDER BY id DESC LIMIT 100', req.user.id);
  run('UPDATE feedback SET user_seen = 1 WHERE user_id = ? AND user_seen = 0', req.user.id);
  res.json({ items });
}));

// ===================== الصفحة الرئيسية للعضو =====================
r.get('/home', auth.requireVerified, h((req, res) => {
  const u = req.user;
  const now = riyadhNow();
  const person = u.person_id ? one('SELECT gender FROM persons WHERE id = ?', u.person_id) : null;
  const counts = one(`SELECT
      (SELECT COUNT(*) FROM persons) AS persons,
      (SELECT COALESCE(MAX(generation), 0) FROM persons) AS generations,
      (SELECT COUNT(*) FROM persons WHERE is_deceased = 0) AS living,
      (SELECT COUNT(*) FROM users WHERE phone_verified_at IS NOT NULL AND status = 'active') AS members,
      (SELECT COUNT(*) FROM users WHERE person_id IS NOT NULL) AS linked`);
  const evOn = modules.on('events');
  const [next] = evOn ? eventRows(`e.is_published = 1 AND e.is_cancelled = 0 AND ${UPCOMING}`, [now, now], u.id, 'ASC') : [];
  const upcoming = evOn ? one(`SELECT COUNT(*) AS c FROM events e WHERE e.is_published = 1 AND e.is_cancelled = 0 AND ${UPCOMING}`, now, now).c : 0;
  const pendingRsvp = evOn ? one(`SELECT COUNT(*) AS c FROM events e WHERE e.is_published = 1 AND e.is_cancelled = 0 AND ${UPCOMING}
      AND NOT EXISTS (SELECT 1 FROM event_rsvps x WHERE x.event_id = e.id AND x.user_id = ?)`, now, now, u.id).c : 0;
  const replies = modules.on('feedback')
    ? all(`SELECT id, subject, replied_at FROM feedback WHERE user_id = ? AND user_seen = 0 AND reply IS NOT NULL ORDER BY replied_at DESC`, u.id) : [];
  const announcements = all(`SELECT a.id, a.kind, a.title, a.created_at FROM announcement_deliveries d JOIN announcements a ON a.id = d.announcement_id
                             WHERE d.user_id = ? AND d.read_at IS NULL AND a.is_deleted = 0 ORDER BY a.id DESC LIMIT 10`, u.id);
  res.json({
    ...require('./home').homeContent(u),
    now,
    gender: person ? person.gender : null,
    stats: { ...counts, upcoming_events: upcoming },
    next_event: next ? { id: next.id, title: next.title, starts_at: next.starts_at, location: next.location, going: next.going, my_rsvp: next.my_rsvp } : null,
    notifications: {
      replies,
      events_pending: pendingRsvp,
      announcements,
      count: replies.length + pendingRsvp + announcements.length,
    },
  });
}));

r.post('/feedback', auth.requireVerified, modules.requireModule('feedback'), auth.rateLimit('feedback', 10, 60 * 60e3), h((req, res) => {
  const b = req.body || {};
  const type = oneOf(b.type, ['suggestion', 'inquiry'], 'النوع');
  const subject = str(b.subject, 'العنوان', { min: 3, max: 120 });
  const message = str(b.message, 'النص', { min: 5, max: 3000 });
  const ins = run('INSERT INTO feedback (user_id, type, subject, message) VALUES (?,?,?,?)', req.user.id, type, subject, message);
  audit(req, 'feedback.create', 'feedback', ins.lastInsertRowid, { type });
  res.status(201).json({ ok: true, id: Number(ins.lastInsertRowid) });
}));

// ===================== الإدارة: المناسبات =====================
function eventBody(b) {
  b = b || {};
  const starts = dateTime(b.starts_at, 'موعد البداية');
  const ends = dateTime(b.ends_at, 'موعد الانتهاء', { optional: true });
  if (ends && ends <= starts) throw bad('موعد الانتهاء يجب أن يكون بعد موعد البداية');
  return {
    title: str(b.title, 'العنوان', { min: 3, max: 120 }),
    description: str(b.description, 'التفاصيل', { optional: true, max: 3000 }),
    starts_at: starts,
    ends_at: ends,
    location: str(b.location, 'المكان', { optional: true, max: 200 }),
    map_url: mapUrl(b.map_url),
    is_published: b.is_published === false || b.is_published === 0 || b.is_published === '0' ? 0 : 1,
    is_cancelled: b.is_cancelled === true || b.is_cancelled === 1 || b.is_cancelled === '1' ? 1 : 0,
  };
}

r.get('/admin/events', perm('events.manage'), h((req, res) => {
  const scope = oneOf(req.query.scope || 'upcoming', ['upcoming', 'past'], 'النطاق');
  const now = riyadhNow();
  const items = scope === 'upcoming'
    ? eventRows(UPCOMING, [now, now], req.user.id, 'ASC')
    : eventRows(`NOT ${UPCOMING}`, [now, now], req.user.id, 'DESC');
  res.json({ now, items });
}));

r.post('/admin/events', perm('events.manage'), h((req, res) => {
  const e = eventBody(req.body);
  const ins = run(`INSERT INTO events (title, description, starts_at, ends_at, location, map_url, is_published, is_cancelled, created_by)
    VALUES (?,?,?,?,?,?,?,?,?)`, e.title, e.description, e.starts_at, e.ends_at, e.location, e.map_url, e.is_published, e.is_cancelled, req.user.id);
  audit(req, 'event.create', 'event', ins.lastInsertRowid, { title: e.title });
  res.status(201).json({ ok: true, id: Number(ins.lastInsertRowid) });
}));

r.put('/admin/events/:id', perm('events.manage'), h((req, res) => {
  const id = int(req.params.id);
  if (!one('SELECT id FROM events WHERE id = ?', id)) throw notFound();
  const e = eventBody(req.body);
  run(`UPDATE events SET title=?, description=?, starts_at=?, ends_at=?, location=?, map_url=?, is_published=?, is_cancelled=?, updated_at=datetime('now') WHERE id=?`,
    e.title, e.description, e.starts_at, e.ends_at, e.location, e.map_url, e.is_published, e.is_cancelled, id);
  audit(req, 'event.update', 'event', id);
  res.json({ ok: true });
}));

r.delete('/admin/events/:id', perm('events.manage'), h((req, res) => {
  const id = int(req.params.id);
  if (!run('DELETE FROM events WHERE id = ?', id).changes) throw notFound();
  audit(req, 'event.delete', 'event', id);
  res.json({ ok: true });
}));

/** قائمة الحضور لمناسبة */
r.get('/admin/events/:id/rsvps', perm('events.manage'), h((req, res) => {
  const id = int(req.params.id);
  if (!one('SELECT id FROM events WHERE id = ?', id)) throw notFound();
  res.json({ items: all(`SELECT r.status, r.updated_at, u.id AS user_id, u.full_name, u.membership_no, u.phone
    FROM event_rsvps r JOIN users u ON u.id = r.user_id WHERE r.event_id = ? ORDER BY r.status, u.full_name`, id) });
}));

// ===================== الإدارة: الاقتراحات والاستفسارات =====================
r.get('/admin/feedback', perm('feedback.manage'), h((req, res) => {
  const status = oneOf(req.query.status || 'new', ['new', 'answered', 'closed', 'all'], 'الحالة');
  const type = oneOf(req.query.type || 'all', ['suggestion', 'inquiry', 'all'], 'النوع');
  const where = []; const params = [];
  if (status !== 'all') { where.push('f.status = ?'); params.push(status); }
  if (type !== 'all') { where.push('f.type = ?'); params.push(type); }
  const items = all(`SELECT f.*, u.full_name, u.membership_no, u.phone, a.full_name AS replied_by_name
    FROM feedback f JOIN users u ON u.id = f.user_id LEFT JOIN users a ON a.id = f.replied_by
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY f.id DESC LIMIT 200`, ...params);
  const counts = one(`SELECT SUM(status='new') AS new, SUM(status='answered') AS answered, SUM(status='closed') AS closed FROM feedback`);
  res.json({ items, counts: { new: counts.new || 0, answered: counts.answered || 0, closed: counts.closed || 0 } });
}));

r.post('/admin/feedback/:id/reply', perm('feedback.manage'), h((req, res) => {
  const id = int(req.params.id);
  if (!one('SELECT id FROM feedback WHERE id = ?', id)) throw notFound();
  const reply = str(req.body && req.body.reply, 'الرد', { min: 2, max: 3000 });
  run("UPDATE feedback SET reply = ?, status = 'answered', replied_by = ?, replied_at = datetime('now'), user_seen = 0 WHERE id = ?", reply, req.user.id, id);
  audit(req, 'feedback.reply', 'feedback', id);
  res.json({ ok: true });
}));

r.post('/admin/feedback/:id/status', perm('feedback.manage'), h((req, res) => {
  const id = int(req.params.id);
  const status = oneOf(req.body && req.body.status, ['new', 'answered', 'closed'], 'الحالة');
  if (!run('UPDATE feedback SET status = ? WHERE id = ?', status, id).changes) throw notFound();
  audit(req, 'feedback.status', 'feedback', id, { status });
  res.json({ ok: true });
}));

module.exports = r;
module.exports.riyadhNow = riyadhNow;
