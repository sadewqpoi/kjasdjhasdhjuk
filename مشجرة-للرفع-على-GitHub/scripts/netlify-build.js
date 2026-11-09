'use strict';
// يعمل على Netlify وقت النشر فقط (أمر البناء في netlify.toml).
// يقرأ رابط الخادم من متغير البيئة API_URL في لوحة Netlify، ويكتب public/_redirects
// حتى تُحوَّل كل طلبات /api إلى الخادم، بدون الحاجة لتعديل أي ملف في المشروع.
const fs = require('node:fs');
const path = require('node:path');

const raw = (process.env.API_URL || '').trim();
let url;
try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { url = null; }

if (!raw || !url || !url.hostname.includes('.')) {
  console.error('\n✖ لم يُضبط رابط الخادم.');
  console.error('  في Netlify: Site configuration ← Environment variables ← Add a variable');
  console.error('  الاسم: API_URL   القيمة: رابط خادمك على Railway، مثل https://alallat-production.up.railway.app');
  console.error('  ثم: Deploys ← Trigger deploy ← Deploy site\n');
  process.exit(1);
}

const target = `https://${url.host}`;
const rules = `/api/*  ${target}/api/:splat  200!\n`;
fs.writeFileSync(path.join(__dirname, '..', 'public', '_redirects'), rules);
console.log(`✔ طلبات /api ستُحوَّل إلى ${target}`);
