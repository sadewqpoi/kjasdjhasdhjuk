'use strict';
/** فهرس المشجرة في الذاكرة لحساب الأنساب والبحث وصلة القرابة بسرعة */
const { all } = require('../db');
const { nameTokens, normName } = require('./arabic');

let cache = null;

function invalidate() { cache = null; }

function index() {
  if (cache) return cache;
  const rows = all('SELECT id, code, name, name_norm, father_id, gender, generation, is_deceased, birth_date, death_date, sort_order FROM persons ORDER BY sort_order, id');
  const byId = new Map();
  const children = new Map();
  for (const r of rows) { byId.set(r.id, r); children.set(r.id, []); }
  const roots = [];
  for (const r of rows) {
    if (r.father_id && children.has(r.father_id)) children.get(r.father_id).push(r.id);
    else roots.push(r.id);
  }
  cache = { rows, byId, children, roots };
  return cache;
}

/** سلسلة الآباء من الشخص إلى الجذر (تشمل الشخص نفسه) */
function chain(id) {
  const { byId } = index();
  const out = [];
  let cur = byId.get(id);
  const seen = new Set();
  while (cur && !seen.has(cur.id)) { seen.add(cur.id); out.push(cur); cur = cur.father_id ? byId.get(cur.father_id) : null; }
  return out;
}

/** الاسم الكامل بالنسب: "أصيل بن محمد بن عبدالعزيز ..." */
function fullName(id, maxDepth = 50) {
  const c = chain(id).slice(0, maxDepth);
  if (!c.length) return '';
  return c.map((p, i) => (i === 0 ? p.name : `${c[i - 1].gender === 'female' ? 'بنت' : 'بن'} ${p.name}`)).join(' ');
}

/**
 * البحث بالاسم الثلاثي: يطابق الاسم الأول ثم الأب ثم الجد...
 * الدرجة = عدد الأجزاء المتطابقة على التوالي
 */
function searchByFullName(input, limit = 25) {
  const tokens = nameTokens(input).map(normName).filter(Boolean);
  if (!tokens.length) return [];
  const { rows, byId } = index();
  const results = [];
  for (const p of rows) {
    if (p.name_norm !== tokens[0] && !(tokens.length === 1 && p.name_norm.startsWith(tokens[0]))) continue;
    let score = 1;
    let cur = p;
    for (let i = 1; i < tokens.length; i++) {
      const f = cur.father_id ? byId.get(cur.father_id) : null;
      if (!f || f.name_norm !== tokens[i]) break;
      score++; cur = f;
    }
    results.push({ id: p.id, score });
  }
  results.sort((a, b) => b.score - a.score);
  const best = results.length ? results[0].score : 0;
  // عند وجود تطابق قوي، نعرض فقط النتائج الأقرب
  const minScore = Math.max(1, Math.min(best, tokens.length) - 1);
  return results.filter((r) => r.score >= minScore).slice(0, limit);
}

/** بحث عام بالاسم (جزء من الاسم أو النسب) */
function searchText(q, limit = 30) {
  const tokens = nameTokens(q).map(normName).filter(Boolean);
  if (!tokens.length) return [];
  const exact = searchByFullName(q, limit);
  if (exact.length) return exact.map((r) => r.id);
  const { rows } = index();
  return rows.filter((p) => p.name_norm.includes(tokens[0])).slice(0, limit).map((p) => p.id);
}

function descendants(id) {
  const { children } = index();
  const out = [];
  const stack = [...(children.get(id) || [])];
  while (stack.length) { const c = stack.pop(); out.push(c); stack.push(...(children.get(c) || [])); }
  return out;
}

/** أقرب جد مشترك ودرجات البعد */
function commonAncestor(a, b) {
  const ca = chain(a); const cb = chain(b);
  const posB = new Map(cb.map((p, i) => [p.id, i]));
  for (let i = 0; i < ca.length; i++) {
    if (posB.has(ca[i].id)) return { ancestor: ca[i], da: i, db: posB.get(ca[i].id) };
  }
  return null;
}

function isRelative(a, b, maxDegree = 3) {
  if (!a || !b) return false;
  const r = commonAncestor(a, b);
  return !!r && Math.max(r.da, r.db) <= maxDegree;
}

const ORD = ['', '', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع'];

/** وصف صلة القرابة: ماذا يكون (b) بالنسبة إلى (a) */
function describeRelation(aId, bId) {
  const { byId } = index();
  const a = byId.get(aId); const b = byId.get(bId);
  if (!a || !b) return null;
  if (aId === bId) return { text: 'نفس الشخص' };
  const r = commonAncestor(aId, bId);
  if (!r) return { text: 'لا توجد صلة قرابة مسجلة في المشجرة' };
  const { da, db, ancestor } = r;
  const f = b.gender === 'female';
  let text;
  if (db === 0) {
    text = da === 1 ? (f ? 'الأم' : 'الأب') : da === 2 ? (f ? 'الجدة' : 'الجد') : `${f ? 'الجدة' : 'الجد'} ${ORD[da - 1] || `(${da - 1})`}`;
  } else if (da === 0) {
    text = db === 1 ? (f ? 'البنت' : 'الابن') : db === 2 ? (f ? 'الحفيدة' : 'الحفيد') : `${f ? 'حفيدة' : 'حفيد'} من الجيل ${ORD[db - 1] || db - 1}`;
  } else if (da === 1 && db === 1) {
    text = f ? 'الأخت' : 'الأخ';
  } else if (db === 1) {
    // b أخ/أخت لأحد أجداد a
    text = da === 2 ? (f ? 'العمة' : 'العم') : `${f ? 'عمة' : 'عم'} ${da === 3 ? 'الأب' : `الجد ${ORD[da - 3] || ''}`}`.trim();
  } else if (da === 1) {
    text = db === 2 ? (f ? 'بنت الأخ' : 'ابن الأخ') : `من ذرية الأخ (الجيل ${db - 1})`;
  } else if (da === db) {
    text = da === 2 ? (f ? 'بنت العم' : 'ابن العم') : `${f ? 'بنت' : 'ابن'} عم من الدرجة ${ORD[da - 1] || da - 1}`;
  } else {
    text = `قريب يجتمع معه في الجد المشترك (${da} أجيال لك، ${db} أجيال له)`;
  }
  return { text, ancestor: { id: ancestor.id, name: fullName(ancestor.id, 3) }, da, db };
}

module.exports = { index, invalidate, chain, fullName, searchByFullName, searchText, descendants, commonAncestor, isRelative, describeRelation };
