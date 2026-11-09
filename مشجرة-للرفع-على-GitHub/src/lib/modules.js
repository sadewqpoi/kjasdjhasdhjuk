'use strict';
/**
 * أقسام الموقع التي يمكن للإدارة إيقافها بالكامل (تختفي من الصفحة الرئيسية والقوائم، ويرفض الخادم طلبات الأعضاء لها).
 * عمل الإدارة على القسم (الإضافة والتعديل) يبقى متاحًا أثناء الإيقاف لتجهيز المحتوى.
 */
const { getSetting, run } = require('../db');
const { forbidden } = require('./http');

const MODULES = {
  events: 'المناسبات',
  feedback: 'الاقتراحات والاستفسارات',
  wills: 'وصايا الأجداد',
};

const on = (key) => getSetting(`module_${key}`, '1') !== '0';
const states = () => Object.fromEntries(Object.keys(MODULES).map((k) => [k, on(k)]));

function set(key, enabled) {
  if (!MODULES[key]) return false;
  run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', `module_${key}`, enabled ? '1' : '0');
  return true;
}

/** Middleware: يرفض طلبات الأعضاء لقسم موقوف */
const requireModule = (key) => (_req, _res, next) => (on(key) ? next() : next(forbidden(`قسم (${MODULES[key]}) متوقف حاليًا`, 'module_disabled')));

module.exports = { MODULES, on, states, set, requireModule };
