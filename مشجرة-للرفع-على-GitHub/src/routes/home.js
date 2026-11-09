'use strict';
/** محتوى الصفحة الرئيسية: اللافتات (بصور) والمربعات وأقسام العرض — كلها تُدار من لوحة الإدارة */
const express = require('express');
const { one, all, run, tx, getSetting } = require('../db');
const { h, bad, notFound, int, str, oneOf } = require('../lib/http');
const auth = require('../lib/auth');
const { audit } = require('../lib/audit');
const { uploadMedia, saveMedia, removeMedia, mediaPath } = require('../lib/uploads');

const r = express.Router();
const perm = auth.requirePermission('home.manage');

/** الأيقونات الجاهزة المسموح بها للمربعات (تُرسم في الواجهة) */
const ICONS = ['tree', 'events', 'feedback', 'certificate', 'kinship', 'plans', 'account', 'admin', 'link', 'scroll',
  'star', 'news', 'book', 'support', 'hall', 'gift', 'phone', 'bank', 'trophy', 'camera', 'video', 'map', 'walk', 'store', 'heart'];
const SECTION_KEYS = ['home_show_banners', 'home_show_stats', 'home_show_next_event'];

const mediaUrl = (f) => (f ? `/api/home/media/${f}` : null);
const flag = (v, dflt = 1) => (v === undefined || v === null || v === '' ? dflt : (v === true || v === 1 || v === '1' || v === 'true' || v === 'on') ? 1 : 0);
function link(v) {
  const s = str(v, 'الرابط', { optional: true, max: 500 });
  if (!s) return null;
  if (!/^(https:\/\/\S+|#\/\S*)$/i.test(s)) throw bad('الرابط يجب أن يبدأ بـ https:// أو يكون رابطًا داخليًا مثل #/events');
  return s;
}

/** محتوى الصفحة الرئيسية للعضو (يُدمج في GET /api/home) */
function homeContent(u) {
  const show = Object.fromEntries(SECTION_KEYS.map((k) => [k.replace('home_show_', ''), getSetting(k, '1') === '1']));
  const banners = show.banners
    ? all('SELECT id, image_file, title, text, link FROM home_banners WHERE is_active = 1 ORDER BY sort, id')
      .map(({ image_file, ...b }) => ({ ...b, image: mediaUrl(image_file) }))
    : [];
  const staff = u.role === 'admin' || u.role === 'moderator';
  const subsLib = require('../lib/subscriptions');
  const plansOn = subsLib.systemEnabled();
  const certOn = !subsLib.disabledFeatures().includes('tree.certificate');
  const mods = require('../lib/modules').states();
  const tiles = all('SELECT id, kind, key, label, icon, image_file, link FROM home_tiles WHERE is_visible = 1 ORDER BY sort, id')
    .filter((t) => !(t.key === 'admin' && !staff) && !(t.key === 'link' && (u.person_id || u.role !== 'member')) && !(t.key === 'plans' && !plansOn) && !(t.key === 'certificate' && !certOn) && !(t.key in mods && !mods[t.key]))
    .map(({ image_file, ...t }) => ({ ...t, image: mediaUrl(image_file) }));
  return { sections: show, banners, tiles };
}

// ===================== صور الصفحة الرئيسية =====================
r.get('/home/media/:name', auth.requireVerified, (req, res, next) => {
  const p = mediaPath(req.params.name);
  if (!p) return next(notFound());
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(p, (err) => err && next(notFound()));
});

// ===================== الإدارة =====================
// تشغيل/إيقاف أقسام الموقع (المناسبات، الاقتراحات، الوصايا)
r.put('/admin/modules', perm, h((req, res) => {
  const modules = require('../lib/modules');
  const b = req.body || {};
  for (const k of Object.keys(modules.MODULES)) if (b[k] !== undefined) modules.set(k, flag(b[k]) === 1);
  const st = modules.states();
  audit(req, 'modules.update', 'settings', null, st);
  res.json(st);
}));

r.get('/admin/home', perm, h((_req, res) => {
  const modules = require('../lib/modules');
  res.json({
    modules: Object.entries(modules.MODULES).map(([key, label]) => ({ key, label, enabled: modules.on(key) })),
    icons: ICONS,
    sections: Object.fromEntries(SECTION_KEYS.map((k) => [k, getSetting(k, '1') === '1'])),
    banners: all('SELECT * FROM home_banners ORDER BY sort, id').map((b) => ({ ...b, image: mediaUrl(b.image_file) })),
    tiles: all('SELECT * FROM home_tiles ORDER BY sort, id').map((t) => ({ ...t, image: mediaUrl(t.image_file) })),
  });
}));

r.put('/admin/home/sections', perm, h((req, res) => {
  for (const k of SECTION_KEYS) {
    if (req.body && req.body[k] !== undefined) {
      run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, flag(req.body[k]) ? '1' : '0');
    }
  }
  audit(req, 'home.sections', 'settings', null, req.body);
  res.json({ ok: true });
}));

/** ترتيب اللافتات أو المربعات: { type, ids: [..بالترتيب الجديد] } */
r.post('/admin/home/reorder', perm, h((req, res) => {
  const type = oneOf(req.body && req.body.type, ['banners', 'tiles'], 'النوع');
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map((x) => int(x)) : [];
  const table = type === 'banners' ? 'home_banners' : 'home_tiles';
  tx(() => ids.forEach((id, i) => run(`UPDATE ${table} SET sort = ? WHERE id = ?`, (i + 1) * 10, id)));
  res.json({ ok: true });
}));

// ---------- اللافتات ----------
function bannerFields(b, hasImage) {
  const title = str(b.title, 'العنوان', { optional: true, max: 200 });
  const text = str(b.text, 'النص', { optional: true, max: 300 });
  if (!hasImage && !title && !text) throw bad('أضف صورة للافتة أو اكتب عنوانًا أو نصًا');
  return { title, text, link: link(b.link), is_active: flag(b.is_active) };
}

r.post('/admin/home/banners', perm, uploadMedia.single('image'), h((req, res) => {
  const b = req.body || {};
  const fields = bannerFields(b, !!req.file);
  const image = saveMedia(req.file);
  const max = one('SELECT COALESCE(MAX(sort), 0) AS m FROM home_banners').m;
  const ins = run('INSERT INTO home_banners (image_file, title, text, link, is_active, sort) VALUES (?,?,?,?,?,?)',
    image, fields.title, fields.text, fields.link, fields.is_active, max + 10);
  audit(req, 'home.banner.create', 'home_banner', ins.lastInsertRowid);
  res.status(201).json({ ok: true, id: Number(ins.lastInsertRowid) });
}));

r.put('/admin/home/banners/:id', perm, uploadMedia.single('image'), h((req, res) => {
  const id = int(req.params.id);
  const cur = one('SELECT * FROM home_banners WHERE id = ?', id);
  if (!cur) throw notFound();
  const b = req.body || {};
  const dropImage = flag(b.remove_image, 0) === 1;
  const keepsImage = !!req.file || (!!cur.image_file && !dropImage);
  const fields = bannerFields(b, keepsImage);
  let image = cur.image_file;
  if (req.file) image = saveMedia(req.file);
  else if (dropImage) image = null;
  run('UPDATE home_banners SET image_file = ?, title = ?, text = ?, link = ?, is_active = ? WHERE id = ?',
    image, fields.title, fields.text, fields.link, fields.is_active, id);
  if (cur.image_file && cur.image_file !== image) removeMedia(cur.image_file);
  audit(req, 'home.banner.update', 'home_banner', id);
  res.json({ ok: true });
}));

r.delete('/admin/home/banners/:id', perm, h((req, res) => {
  const id = int(req.params.id);
  const cur = one('SELECT * FROM home_banners WHERE id = ?', id);
  if (!cur) throw notFound();
  run('DELETE FROM home_banners WHERE id = ?', id);
  removeMedia(cur.image_file);
  audit(req, 'home.banner.delete', 'home_banner', id);
  res.json({ ok: true });
}));

// ---------- المربعات ----------
function iconField(v) {
  if (v === undefined || v === null || v === '') return null;
  return oneOf(String(v), ICONS, 'الأيقونة');
}

r.post('/admin/home/tiles', perm, uploadMedia.single('image'), h((req, res) => {
  const b = req.body || {};
  const label = str(b.label, 'اسم المربع', { min: 2, max: 40 });
  const lnk = link(b.link);
  if (!lnk) throw bad('رابط المربع مطلوب');
  const icon = iconField(b.icon);
  if (!icon && !req.file) throw bad('اختر أيقونة أو ارفع صورة للمربع');
  const image = saveMedia(req.file);
  const max = one('SELECT COALESCE(MAX(sort), 0) AS m FROM home_tiles').m;
  const ins = run("INSERT INTO home_tiles (kind, label, icon, image_file, link, is_visible, sort) VALUES ('custom',?,?,?,?,?,?)",
    label, icon, image, lnk, flag(b.is_visible), max + 10);
  audit(req, 'home.tile.create', 'home_tile', ins.lastInsertRowid, { label });
  res.status(201).json({ ok: true, id: Number(ins.lastInsertRowid) });
}));

r.put('/admin/home/tiles/:id', perm, uploadMedia.single('image'), h((req, res) => {
  const id = int(req.params.id);
  const cur = one('SELECT * FROM home_tiles WHERE id = ?', id);
  if (!cur) throw notFound();
  const b = req.body || {};
  const label = str(b.label, 'اسم المربع', { min: 2, max: 40 });
  const visible = flag(b.is_visible);
  const dropImage = flag(b.remove_image, 0) === 1;
  let icon = b.icon !== undefined ? iconField(b.icon) : cur.icon;
  let image = cur.image_file;
  if (req.file) image = saveMedia(req.file);
  else if (dropImage) image = null;
  let lnk = cur.link;
  if (cur.kind === 'custom') {
    lnk = link(b.link);
    if (!lnk) throw bad('رابط المربع مطلوب');
    if (!icon && !image) throw bad('اختر أيقونة أو ارفع صورة للمربع');
  } else if (cur.key === 'members') {
    icon = null; // مربع الرقم لا يحتاج أيقونة
  } else if (!icon && !image) {
    icon = cur.icon || 'star';
  }
  run('UPDATE home_tiles SET label = ?, icon = ?, image_file = ?, link = ?, is_visible = ? WHERE id = ?', label, icon, image, lnk, visible, id);
  if (cur.image_file && cur.image_file !== image) removeMedia(cur.image_file);
  audit(req, 'home.tile.update', 'home_tile', id);
  res.json({ ok: true });
}));

r.delete('/admin/home/tiles/:id', perm, h((req, res) => {
  const id = int(req.params.id);
  const cur = one('SELECT * FROM home_tiles WHERE id = ?', id);
  if (!cur) throw notFound();
  if (cur.kind === 'system') throw bad('هذا مربع أساسي مرتبط بميزة في المنصة؛ يمكنك إخفاؤه بدل حذفه');
  run('DELETE FROM home_tiles WHERE id = ?', id);
  removeMedia(cur.image_file);
  audit(req, 'home.tile.delete', 'home_tile', id);
  res.json({ ok: true });
}));

module.exports = r;
module.exports.homeContent = homeContent;
