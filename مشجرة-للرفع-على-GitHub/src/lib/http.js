'use strict';

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const bad = (msg, code) => new HttpError(400, msg, code);
const forbidden = (msg = 'غير مصرح لك بهذا الإجراء', code = 'forbidden') => new HttpError(403, msg, code);
const notFound = (msg = 'غير موجود') => new HttpError(404, msg, 'not_found');
const conflict = (msg, code = 'conflict') => new HttpError(409, msg, code);

/** تغليف المعالجات حتى تصل الأخطاء غير المتزامنة إلى معالج الأخطاء */
const h = (fn) => (req, res, next) => {
  try {
    const r = fn(req, res, next);
    if (r && typeof r.catch === 'function') r.catch(next);
  } catch (e) { next(e); }
};

function int(v, name = 'القيمة') {
  const n = Number(v);
  if (!Number.isInteger(n)) throw bad(`${name} غير صالحة`);
  return n;
}
function str(v, name, { min = 1, max = 200, optional = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (optional) return null;
    throw bad(`${name} مطلوب`);
  }
  const s = String(v).trim();
  if (s.length < min) throw bad(`${name} قصير جدًا`);
  if (s.length > max) throw bad(`${name} طويل جدًا`);
  return s;
}
function oneOf(v, list, name) {
  if (!list.includes(v)) throw bad(`${name} غير صالح`);
  return v;
}
function dateStr(v, name, optional = true) {
  if (!v) { if (optional) return null; throw bad(`${name} مطلوب`); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw bad(`${name} غير صالح`);
  return v;
}

/** توحيد رقم الجوال السعودي إلى 9665XXXXXXXX */
function normalizePhone(p) {
  if (!p) throw bad('رقم الجوال مطلوب');
  let s = String(p).replace(/[\s\-()]/g, '')
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('00')) s = s.slice(2);
  if (s.startsWith('05')) s = '966' + s.slice(1);
  else if (s.startsWith('5') && s.length === 9) s = '966' + s;
  if (!/^9665\d{8}$/.test(s)) throw bad('رقم الجوال غير صحيح، استخدم صيغة 05XXXXXXXX');
  return s;
}

module.exports = { HttpError, bad, forbidden, notFound, conflict, h, int, str, oneOf, dateStr, normalizePhone };
