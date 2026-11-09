'use strict';
/**
 * تجهيز استعادة نسخة احتياطية من سطر الأوامر. تُطبَّق عند تشغيل الخادم التالي.
 *   node scripts/restore.js ملف.tar.gz
 * (لا يفتح قاعدة البيانات، فيمكن تشغيله والخادم متوقف)
 */
const backup = require('../src/lib/backup');
const file = process.argv[2];
if (!file) { console.error('الاستخدام: node scripts/restore.js ملف.tar.gz'); process.exit(1); }
try {
  const info = backup.stage(file);
  console.log(`✔ جُهّزت الاستعادة (${info.images} صورة). ستُطبَّق عند تشغيل الخادم التالي.`);
} catch (e) { console.error('✖', e.message); process.exit(1); }
