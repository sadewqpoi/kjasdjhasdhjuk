'use strict';
/**
 * المشجرة وبطاقات الأشخاص.
 * كل مسار محمي بميزة من الباقة (requireFeature) ويُرشِّح الحقول حسب الخصوصية في الخادم.
 */
const express = require('express');
const fs = require('node:fs');
const { one, all } = require('../db');
const { h, forbidden, notFound, int, str } = require('../lib/http');
const auth = require('../lib/auth');
const tree = require('../lib/tree');
const { requireFeature, getEntitlements } = require('../lib/subscriptions');
const { treeGate, isStaff } = require('../lib/me');
const { avatarPath } = require('../lib/uploads');

const r = express.Router();

r.use(['/tree', '/persons'], auth.requireAuth, (req, _res, next) => {
  const g = treeGate(req.user);
  if (!g.ok) {
    return next(forbidden(g.reason === 'link_required'
      ? 'يجب ربط حسابك باسمك في المشجرة واعتماده من الإدارة قبل الاطلاع على المشجرة'
      : 'يجب التحقق من رقم الجوال أولًا', g.reason));
  }
  req.entitlements = getEntitlements(req.user);
  next();
});

/** حسابات المستخدمين المرتبطة بالأشخاص (للصور والخصوصية) */
function accountsByPerson() {
  const m = new Map();
  for (const u of all("SELECT id, person_id, photo_file, phone, privacy_photo, privacy_phone, privacy_birth FROM users WHERE person_id IS NOT NULL AND status = 'active'")) {
    m.set(u.person_id, u);
  }
  return m;
}

function privacyAllows(level, viewer, personId) {
  if (level === 'members') return true;
  if (level === 'relatives') return tree.isRelative(viewer.person_id, personId);
  return false;
}

function canSeePhoto(viewer, ent, personId, acc) {
  if (!acc || !acc.photo_file) return false;
  if (isStaff(viewer) || viewer.person_id === personId) return true;
  return ent.has('person.photos') && privacyAllows(acc.privacy_photo, viewer, personId);
}

r.get('/tree', requireFeature('tree.view'), h((req, res) => {
  const { rows } = tree.index();
  const accs = accountsByPerson();
  const nodes = rows.map((p) => {
    const acc = accs.get(p.id);
    return {
      id: p.id, n: p.name, f: p.father_id, g: p.gender === 'female' ? 'f' : 'm', d: p.is_deceased ? 1 : 0,
      a: acc ? 1 : 0, ph: canSeePhoto(req.user, req.entitlements, p.id, acc) ? 1 : 0,
    };
  });
  res.json({ nodes, me: req.user.person_id, features: [...req.entitlements] });
}));

r.get('/tree/search', requireFeature('tree.search'), h((req, res) => {
  const q = str(req.query.q, 'كلمة البحث', { min: 2, max: 80 });
  const ids = tree.searchText(q, 40);
  res.json({ results: ids.map((id) => ({ id, full_name: tree.fullName(id, 5) })) });
}));

r.get('/persons/:id', requireFeature('person.basic'), h((req, res) => {
  const id = int(req.params.id);
  const p = one('SELECT * FROM persons WHERE id = ?', id);
  if (!p) throw notFound('الشخص غير موجود');
  const ent = req.entitlements;
  const acc = one("SELECT id, membership_no, photo_file, phone, privacy_photo, privacy_phone, privacy_birth FROM users WHERE person_id = ? AND status = 'active'", id);
  const { children } = tree.index();
  const staff = isStaff(req.user);
  const own = req.user.person_id === id;

  const card = {
    id: p.id,
    name: p.name,
    full_name: tree.fullName(id, 12),
    gender: p.gender,
    generation: p.generation,
    is_deceased: !!p.is_deceased,
    father: p.father_id ? { id: p.father_id, name: tree.fullName(p.father_id, 2) } : null,
    children: (children.get(id) || []).map((c) => {
      const cp = tree.index().byId.get(c);
      return { id: c, name: cp.name, gender: cp.gender, is_deceased: !!cp.is_deceased };
    }),
    has_account: !!acc,
    is_me: own,
    photo_url: canSeePhoto(req.user, ent, id, acc) ? `/api/persons/${id}/photo` : null,
    locked: [],
  };
  if (staff) card.code = p.code;

  // التواريخ: تتطلب ميزة الباقة + موافقة صاحب الحساب (إن وُجد)
  if (ent.has('person.dates')) {
    const birthOk = own || staff || !acc || privacyAllows(acc.privacy_birth, req.user, id);
    card.birth_date = birthOk ? p.birth_date : null;
    card.death_date = p.death_date;
  } else card.locked.push('person.dates');

  if (ent.has('person.contact')) {
    card.phone = acc && (own || staff || privacyAllows(acc.privacy_phone, req.user, id)) ? acc.phone : null;
  } else card.locked.push('person.contact');

  if (!ent.has('person.photos') && acc && acc.photo_file && !own) card.locked.push('person.photos');

  if (req.user.person_id && !own && ent.has('tree.relationship')) {
    card.relation = tree.describeRelation(req.user.person_id, id);
  }
  card.wills_count = !require('../lib/modules').on('wills') ? 0 : one('SELECT COUNT(*) c FROM wills WHERE person_id = ? AND is_published = 1', id).c;
  res.json(card);
}));

/** الصورة الشخصية - تُقدَّم عبر الخادم بعد فحص الصلاحية والخصوصية (ليست ملفًا عامًا) */
r.get('/persons/:id/photo', h((req, res) => {
  const id = int(req.params.id);
  const acc = one("SELECT photo_file, privacy_photo FROM users WHERE person_id = ? AND status = 'active'", id);
  if (!canSeePhoto(req.user, req.entitlements, id, acc)) throw forbidden('الصورة غير متاحة');
  const file = avatarPath(acc.photo_file);
  if (!file || !fs.existsSync(file)) throw notFound();
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.sendFile(file);
}));

r.get('/tree/stats', requireFeature('tree.stats'), h((_req, res) => {
  const { rows } = tree.index();
  const gens = {};
  let male = 0; let female = 0; let living = 0;
  for (const p of rows) {
    gens[p.generation] = (gens[p.generation] || 0) + 1;
    if (p.gender === 'female') female++; else male++;
    if (!p.is_deceased) living++;
  }
  const linked = one('SELECT COUNT(*) c FROM users WHERE person_id IS NOT NULL').c;
  res.json({ total: rows.length, male, female, living, deceased: rows.length - living, generations: gens, linked_accounts: linked });
}));

r.get('/tree/relationship', requireFeature('tree.relationship'), h((req, res) => {
  const a = int(req.query.a, 'الشخص الأول');
  const b = int(req.query.b, 'الشخص الثاني');
  const rel = tree.describeRelation(a, b);
  if (!rel) throw notFound('الشخص غير موجود');
  res.json({ a: { id: a, name: tree.fullName(a, 4) }, b: { id: b, name: tree.fullName(b, 4) }, ...rel });
}));

r.get('/persons/:id/export.csv', requireFeature('tree.export'), h((req, res) => {
  const id = int(req.params.id);
  const { byId } = tree.index();
  if (!byId.has(id)) throw notFound();
  const dates = req.entitlements.has('person.dates');
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const lines = [['الرقم', 'الاسم', 'النسب', 'الجيل', 'الجنس', 'الحالة'].concat(dates ? ['تاريخ الوفاة'] : []).map(esc).join(',')];
  for (const pid of [id, ...tree.descendants(id)]) {
    const p = byId.get(pid);
    lines.push([pid, p.name, tree.fullName(pid, 8), p.generation, p.gender === 'female' ? 'أنثى' : 'ذكر', p.is_deceased ? 'متوفى' : 'حي']
      .concat(dates ? [p.death_date] : []).map(esc).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="branch-${id}.csv"`);
  res.send('﻿' + lines.join('\r\n'));
}));

r.get('/persons/:id/certificate', requireFeature('tree.certificate'), h((req, res) => {
  const id = int(req.params.id);
  const c = tree.chain(id);
  if (!c.length) throw notFound();
  res.json({
    person: { id, name: c[0].name, gender: c[0].gender },
    full_name: tree.fullName(id),
    lineage: c.map((p) => ({ id: p.id, name: p.name, gender: p.gender, generation: p.generation })),
    issued_at: new Date().toISOString(),
    issued_to: req.user.membership_no,
  });
}));

module.exports = r;
