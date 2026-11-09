'use strict';
/**
 * إنشاء نسخة احتياطية من سطر الأوامر (قاعدة البيانات + الصور) في ملف tar.gz
 *   node scripts/backup.js [مسار-الملف.tar.gz]
 * تُستخدم في النسخ اليومي على الخادم، وعند نقل البيانات أول مرة.
 */
const fs = require('node:fs');
const path = require('node:path');
const { db } = require('../src/db');
const backup = require('../src/lib/backup');

const out = process.argv[2] || path.join(process.cwd(), `alallat-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.tar.gz`);
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
const stream = fs.createWriteStream(out);
backup.create(db, stream)
  .then((n) => stream.on('close', () => console.log(`✔ نسخة احتياطية: ${out} (${n} ملف، ${(fs.statSync(out).size / 1048576).toFixed(1)} ميجابايت)`)))
  .catch((e) => { console.error('✖', e.message); process.exit(1); });
