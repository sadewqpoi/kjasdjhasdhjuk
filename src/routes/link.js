'use strict';
/** ربط حساب المستخدم بشخص موجود في المشجرة، أو طلب إضافة اسم جديد */
const express = require('express');
const { one, all, run, tx } = require('../db');
const { h, bad, conflict, forbidden, notFound, int, str, oneOf, dateStr } = require('../lib/http');
const auth = require('../lib/auth');
const tree = require('../lib/tree');
const { audit } = require('../lib/audit');

const r = express.Router();
r.use(auth.requireVerified);

function linkedPersonIds() {
  return new Set(all('SELECT person_id FROM users WHERE person_id IS NOT NULL').map((x) => x.person_id));
}

/** نتائج الأسماء المطابقة للاسم الثلاثي */
r.get('/candidates', h((req, res) => {
  const q = str(req.query.name || req.user.full_name, 'الاسم', { min: 2, max: 80 });
  const linked = linkedPersonIds();
  const { byId, children } = tree.index();
  const results = tree.searchByFullName(q, 25).map(({ id, score }) => {
    const p = byId.get(id);
    return {
      id,
      full_name: tree.fullName(id, 6),
      generation: p.generation,
      gender: p.gender,
      children_count: (children.get(id) || []).length,
      score,
      available: !linked.has(id) && !p.is_deceased,
      unavailable_reason: linked.has(id) ? 'مرتبط بحساب آخر' : p.is_deceased ? 'متوفى' : null,
    };
  });
  res.json({ query: q, results });
}));

/** بحث عن الأب عند طلب إضافة اسم جديد */
r.get('/father-search', h((req, res) => {
  const q = str(req.query.q, 'الاسم', { min: 2, max: 80 });
  const { byId } = tree.index();
  const ids = tree.searchText(q, 20).filter((id) => byId.get(id).gender === 'male');
  res.json({ results: ids.map((id) => ({ id, full_name: tree.fullName(id, 5) })) });
}));

r.get('/status', h((req, res) => {
  const links = all('SELECT id, person_id, status, user_note, admin_note, created_at, reviewed_at FROM link_requests WHERE user_id = ? ORDER BY id DESC LIMIT 10', req.user.id)
    .map((l) => ({ ...l, person_full_name: tree.fullName(l.person_id, 6) }));
  const additions = all('SELECT id, name, father_id, father_text, gender, status, admin_note, created_at, reviewed_at FROM addition_requests WHERE user_id = ? ORDER BY id DESC LIMIT 10', req.user.id)
    .map((a) => ({ ...a, father_full_name: a.father_id ? tree.fullName(a.father_id, 5) : a.father_text }));
  res.json({ linked_person_id: req.user.person_id, links, additions });
}));

/**
 * ربط الحساب بالشخص فورًا (بدون موافقة الإدارة).
 * يبقى منع ربط الاسم بأكثر من حساب مطبّقًا (قيد UNIQUE على users.person_id)،
 * ويُسجَّل الربط في link_requests بحالة approved وفي سجل العمليات، وتستطيع الإدارة فك الربط عند الحاجة.
 */
r.post('/requests', h((req, res) => {
  const personId = int(req.body && req.body.person_id, 'الشخص');
  const note = str(req.body.note, 'الملاحظة', { optional: true, max: 500 });
  let id;
  tx(() => {
    const u = one('SELECT person_id FROM users WHERE id = ?', req.user.id);
    if (u.person_id) throw conflict('حسابك مرتبط بالفعل بشخص في المشجرة');
    const person = one('SELECT * FROM persons WHERE id = ?', personId);
    if (!person) throw notFound('الشخص غير موجود');
    if (person.is_deceased) throw bad('لا يمكن الربط بشخص متوفى');
    if (one('SELECT id FROM users WHERE person_id = ?', personId)) throw conflict('هذا الاسم مرتبط بحساب آخر. إن كان اسمك فتواصل مع الإدارة', 'person_taken');
    if (one("SELECT id FROM addition_requests WHERE user_id = ? AND status = 'pending'", req.user.id)) throw conflict('لديك طلب إضافة اسم قيد المراجعة، ألغه أولًا');
    // أي طلب ربط قديم معلّق لهذا المستخدم يُلغى
    run("UPDATE link_requests SET status = 'cancelled' WHERE user_id = ? AND status = 'pending'", req.user.id);
    run("UPDATE users SET person_id = ?, linked_at = datetime('now') WHERE id = ?", personId, req.user.id);
    const ins = run("INSERT INTO link_requests (user_id, person_id, user_note, status, admin_note, reviewed_at) VALUES (?,?,?,'approved','ربط تلقائي',datetime('now'))",
      req.user.id, personId, note);
    id = Number(ins.lastInsertRowid);
    // طلبات قديمة معلّقة من آخرين على نفس الاسم تُرفض لأن الاسم صار مرتبطًا
    run(`UPDATE link_requests SET status = 'rejected', admin_note = 'تم ربط هذا الاسم بحساب آخر', reviewed_at = datetime('now')
         WHERE person_id = ? AND status = 'pending'`, personId);
  });
  audit(req, 'link.auto', 'link_request', id, { person_id: personId });
  res.status(201).json({ ok: true, id, linked: true });
}));

r.delete('/requests/:id', h((req, res) => {
  const lr = one('SELECT * FROM link_requests WHERE id = ?', int(req.params.id));
  if (!lr || lr.user_id !== req.user.id) throw notFound();
  if (lr.status !== 'pending') throw bad('لا يمكن إلغاء طلب تمت مراجعته');
  run("UPDATE link_requests SET status = 'cancelled' WHERE id = ?", lr.id);
  res.json({ ok: true });
}));

/** طلب إضافة اسم غير موجود في المشجرة */
r.post('/additions', h((req, res) => {
  if (req.user.person_id) throw conflict('حسابك مرتبط بالفعل بشخص في المشجرة');
  if (one("SELECT id FROM addition_requests WHERE user_id = ? AND status = 'pending'", req.user.id)) throw conflict('لديك طلب إضافة قيد المراجعة بالفعل');
  const b = req.body || {};
  const name = str(b.name, 'الاسم', { max: 40 });
  let fatherId = null;
  if (b.father_id) {
    fatherId = int(b.father_id, 'الأب');
    if (!one('SELECT id FROM persons WHERE id = ?', fatherId)) throw notFound('الأب غير موجود');
  }
  const fatherText = str(b.father_text, 'وصف الأب', { optional: true, max: 200 });
  if (!fatherId && !fatherText) throw bad('حدد الأب من المشجرة أو اكتب نسبك كاملًا');
  const ins = run(`INSERT INTO addition_requests (user_id, name, father_id, father_text, gender, birth_date, user_note) VALUES (?,?,?,?,?,?,?)`,
    req.user.id, name, fatherId, fatherText, oneOf(b.gender || 'male', ['male', 'female'], 'الجنس'),
    dateStr(b.birth_date, 'تاريخ الميلاد'), str(b.note, 'الملاحظة', { optional: true, max: 500 }));
  audit(req, 'addition.request', 'addition_request', ins.lastInsertRowid);
  res.status(201).json({ ok: true, id: Number(ins.lastInsertRowid) });
}));

r.delete('/additions/:id', h((req, res) => {
  const a = one('SELECT * FROM addition_requests WHERE id = ?', int(req.params.id));
  if (!a || a.user_id !== req.user.id) throw notFound();
  if (a.status !== 'pending') throw forbidden('لا يمكن إلغاء طلب تمت مراجعته');
  run("UPDATE addition_requests SET status = 'cancelled' WHERE id = ?", a.id);
  res.json({ ok: true });
}));

module.exports = r;
