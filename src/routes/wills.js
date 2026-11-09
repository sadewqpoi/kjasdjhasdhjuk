'use strict';
/** وصايا الأجداد: يضيفها المشرفون، ويقرؤها الأعضاء الموثّقون */
const express = require('express');
const { one, all, run } = require('../db');
const { h, bad, notFound, int, str } = require('../lib/http');
const auth = require('../lib/auth');
const { audit } = require('../lib/audit');
const tree = require('../lib/tree');
const modules = require('../lib/modules');
const { uploadMedia, saveMedia, removeMedia } = require('../lib/uploads');

const r = express.Router();
const perm = auth.requirePermission('wills.manage');

const mediaUrl = (f) => (f ? `/api/home/media/${f}` : null); // نفس مخزن صور الصفحة الرئيسية (للأعضاء الموثّقين فقط)
const flag = (v, dflt = 1) => (v === undefined || v === null || v === '' ? dflt : (v === true || v === 1 || v === '1' || v === 'true' || v === 'on') ? 1 : 0);

function view(w, { admin = false } = {}) {
  const out = {
    id: w.id, title: w.title, body: w.body, source: w.source, will_date: w.will_date,
    person_id: w.person_id,
    author: w.person_id ? tree.fullName(w.person_id, 5) : w.author_name,
    image: mediaUrl(w.image_file),
    updated_at: w.updated_at,
  };
  if (admin) Object.assign(out, { author_name: w.author_name, is_published: w.is_published, sort: w.sort });
  return out;
}

function fields(b) {
  const personId = b.person_id ? int(b.person_id, 'صاحب الوصية') : null;
  if (personId && !one('SELECT id FROM persons WHERE id = ?', personId)) throw bad('الشخص المختار غير موجود في المشجرة');
  const authorName = str(b.author_name, 'اسم صاحب الوصية', { optional: true, max: 120 });
  if (!personId && !authorName) throw bad('اختر صاحب الوصية من المشجرة أو اكتب اسمه');
  return {
    title: str(b.title, 'العنوان', { max: 150 }),
    person_id: personId,
    author_name: personId ? null : authorName,
    body: str(b.body, 'نص الوصية', { max: 20000 }).replace(/\r\n?/g, '\n'),
    source: str(b.source, 'المصدر', { optional: true, max: 200 }),
    will_date: str(b.will_date, 'التاريخ', { optional: true, max: 60 }),
    is_published: flag(b.is_published),
  };
}

// ===================== الأعضاء =====================
r.get('/wills', auth.requireVerified, modules.requireModule('wills'), h((req, res) => {
  const conds = ['is_published = 1']; const params = [];
  if (req.query.person_id) { conds.push('person_id = ?'); params.push(int(req.query.person_id)); }
  const items = all(`SELECT * FROM wills WHERE ${conds.join(' AND ')} ORDER BY sort, id`, ...params);
  res.json({ items: items.map((w) => view(w)) });
}));

r.get('/wills/:id', auth.requireVerified, modules.requireModule('wills'), h((req, res) => {
  const w = one('SELECT * FROM wills WHERE id = ? AND is_published = 1', int(req.params.id));
  if (!w) throw notFound('الوصية غير موجودة');
  res.json(view(w));
}));

// ===================== الإدارة =====================
r.get('/admin/wills', perm, h((_req, res) => {
  res.json({ items: all('SELECT * FROM wills ORDER BY sort, id').map((w) => view(w, { admin: true })) });
}));

r.post('/admin/wills', perm, uploadMedia.single('image'), h((req, res) => {
  const f = fields(req.body || {});
  const image = saveMedia(req.file);
  const max = one('SELECT COALESCE(MAX(sort), 0) AS m FROM wills').m;
  const ins = run(`INSERT INTO wills (title, person_id, author_name, body, source, will_date, image_file, is_published, sort, created_by)
                   VALUES (?,?,?,?,?,?,?,?,?,?)`,
    f.title, f.person_id, f.author_name, f.body, f.source, f.will_date, image, f.is_published, max + 10, req.user.id);
  audit(req, 'will.create', 'will', ins.lastInsertRowid, { title: f.title });
  res.status(201).json({ ok: true, id: Number(ins.lastInsertRowid) });
}));

r.put('/admin/wills/:id', perm, uploadMedia.single('image'), h((req, res) => {
  const id = int(req.params.id);
  const cur = one('SELECT * FROM wills WHERE id = ?', id);
  if (!cur) throw notFound();
  const b = req.body || {};
  const f = fields(b);
  let image = cur.image_file;
  if (req.file) image = saveMedia(req.file);
  else if (flag(b.remove_image, 0)) image = null;
  run(`UPDATE wills SET title = ?, person_id = ?, author_name = ?, body = ?, source = ?, will_date = ?, image_file = ?, is_published = ?,
       updated_at = datetime('now') WHERE id = ?`,
    f.title, f.person_id, f.author_name, f.body, f.source, f.will_date, image, f.is_published, id);
  if (cur.image_file && cur.image_file !== image) removeMedia(cur.image_file);
  audit(req, 'will.update', 'will', id, { title: f.title });
  res.json({ ok: true });
}));

r.post('/admin/wills/reorder', perm, h((req, res) => {
  const ids = (req.body && Array.isArray(req.body.ids) ? req.body.ids : []).map((x) => int(x));
  ids.forEach((id, i) => run('UPDATE wills SET sort = ? WHERE id = ?', (i + 1) * 10, id));
  res.json({ ok: true });
}));

r.delete('/admin/wills/:id', perm, h((req, res) => {
  const id = int(req.params.id);
  const cur = one('SELECT * FROM wills WHERE id = ?', id);
  if (!cur) throw notFound();
  run('DELETE FROM wills WHERE id = ?', id);
  removeMedia(cur.image_file);
  audit(req, 'will.delete', 'will', id, { title: cur.title });
  res.json({ ok: true });
}));

module.exports = r;
