'use strict';
// تطبيع النص العربي لأغراض البحث والمطابقة

const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

function normalize(s) {
  if (!s) return '';
  return String(s)
    .replace(TASHKEEL, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

// دمج "عبد الله" → "عبدالله" وما شابه حتى يتطابق الاسم المركب
function joinCompound(s) {
  return s.replace(/(^|\s)(عبد|ابو)\s+(?=\S)/g, '$1$2');
}

// تقسيم الاسم الكامل إلى أجزاء مع حذف "بن / بنت / ابن"
function nameTokens(fullName) {
  const n = joinCompound(normalize(fullName));
  return n.split(' ').filter((t) => t && !['بن', 'بنت', 'ابن', 'ال'].includes(t));
}

function normName(name) {
  return joinCompound(normalize(name)).replace(/\s+/g, '');
}

module.exports = { normalize, nameTokens, normName };
