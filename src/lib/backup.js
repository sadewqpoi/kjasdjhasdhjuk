'use strict';
/**
 * النسخ الاحتياطي والاستعادة (لنقل البيانات بين الأجهزة والخوادم، وللحماية من الفقد).
 * الملف: tar.gz يحوي نسخة متّسقة من قاعدة البيانات (family.db) وكل الصور (uploads/).
 * لا يشمل ربط بوت واتساب (سري ومرتبط بالجهاز) ولا ملف .env.
 *
 * الاستعادة: تُحفظ الملفات في مجلد انتظار، ثم تُطبَّق عند بدء تشغيل الخادم التالي
 * قبل فتح قاعدة البيانات (لا يمكن استبدال قاعدة بيانات مفتوحة بأمان).
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const config = require('../config');

const PENDING = path.join(config.DATA_DIR, 'restore-pending');
const NAME_RE = /^(family\.db|uploads\/(avatars|home|receipts)\/[A-Za-z0-9][A-Za-z0-9._-]{0,120})$/;
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');

// ===================== صيغة tar (ustar) بدون مكتبات =====================
function tarHeader(name, size, mtime) {
  const h = Buffer.alloc(512, 0);
  const put = (str, off, len) => h.write(str, off, len, 'utf8');
  const oct = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
  put(name, 0, 100);
  put(oct(0o644, 8), 100, 8);
  put(oct(0, 8), 108, 8); put(oct(0, 8), 116, 8);
  put(oct(size, 12), 124, 12);
  put(oct(Math.floor(mtime / 1000), 12), 136, 12);
  h.fill(0x20, 148, 156); // مكان المجموع الاختباري = مسافات أثناء الحساب
  put('0', 156, 1);
  put('ustar\0', 257, 6); put('00', 263, 2);
  let sum = 0; for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return h;
}

function* walk(dir, rel) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name); const r = `${rel}/${e.name}`;
    if (e.isDirectory()) yield* walk(full, r);
    else if (e.isFile()) yield { full, name: r };
  }
}

/** إنشاء نسخة احتياطية وكتابتها في مجرى (مثل استجابة HTTP). db: كائن DatabaseSync */
async function create(db, out) {
  const snap = path.join(config.DATA_DIR, `.backup-${process.pid}-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`); // نسخة متّسقة حتى أثناء العمل
  const gz = zlib.createGzip({ level: 6 });
  gz.pipe(out);
  const write = (buf) => new Promise((res) => { if (gz.write(buf)) res(); else gz.once('drain', res); });
  const addFile = async (full, name) => {
    const st = fs.statSync(full);
    await write(tarHeader(name, st.size, st.mtimeMs));
    await write(fs.readFileSync(full));
    const pad = (512 - (st.size % 512)) % 512;
    if (pad) await write(Buffer.alloc(pad, 0));
  };
  let files = 0;
  try {
    await addFile(snap, 'family.db'); files++;
    for (const f of walk(config.uploadsDir, 'uploads')) {
      if (NAME_RE.test(f.name)) { await addFile(f.full, f.name); files++; }
    }
    await write(Buffer.alloc(1024, 0)); // نهاية الأرشيف
  } finally {
    fs.rmSync(snap, { force: true });
  }
  await new Promise((res) => { gz.end(res); });
  return files;
}

/** قراءة أرشيف والتحقق منه، ثم حفظه في مجلد الانتظار ليُطبَّق عند إعادة التشغيل */
function stage(archivePath) {
  let tar;
  try { tar = zlib.gunzipSync(fs.readFileSync(archivePath)); } catch { throw new Error('الملف ليس نسخة احتياطية صالحة (tar.gz)'); }
  const entries = [];
  for (let off = 0; off + 512 <= tar.length;) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const name = h.toString('utf8', 0, 100).replace(/\0.*$/s, '');
    const size = parseInt(h.toString('latin1', 124, 136).replace(/\0.*$/s, '').trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    off += 512;
    if (!Number.isFinite(size) || size < 0 || off + size > tar.length) throw new Error('النسخة الاحتياطية تالفة');
    const data = tar.subarray(off, off + size);
    off += Math.ceil(size / 512) * 512;
    if (type !== '0' && type !== '\0') continue;
    if (!NAME_RE.test(name)) continue; // تجاهل أي مسار غير متوقع (حماية من الكتابة خارج المجلد)
    entries.push({ name, data });
  }
  const dbEntry = entries.find((e) => e.name === 'family.db');
  if (!dbEntry || !dbEntry.data.subarray(0, 16).equals(SQLITE_MAGIC)) throw new Error('النسخة الاحتياطية لا تحتوي على قاعدة بيانات صالحة');
  fs.rmSync(PENDING, { recursive: true, force: true });
  for (const e of entries) {
    const dest = path.join(PENDING, ...e.name.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, e.data);
  }
  fs.writeFileSync(path.join(PENDING, 'READY'), new Date().toISOString());
  return { files: entries.length, images: entries.length - 1 };
}

/** يُستدعى عند بدء التشغيل قبل فتح قاعدة البيانات */
function applyPending() {
  if (!fs.existsSync(path.join(PENDING, 'READY'))) return false;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const db = config.dbFile;
  if (fs.existsSync(db)) fs.renameSync(db, `${db}.before-restore-${stamp}`); // نحتفظ بالقديمة احتياطًا
  for (const ext of ['-wal', '-shm']) fs.rmSync(db + ext, { force: true });
  fs.mkdirSync(path.dirname(db), { recursive: true });
  fs.copyFileSync(path.join(PENDING, 'family.db'), db);
  for (const f of walk(path.join(PENDING, 'uploads'), 'uploads')) {
    const dest = path.join(config.uploadsDir, ...f.name.split('/').slice(1));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f.full, dest);
  }
  fs.rmSync(PENDING, { recursive: true, force: true });
  console.log('✔ تمت استعادة النسخة الاحتياطية (القاعدة السابقة محفوظة باسم family.db.before-restore-*)');
  return true;
}

const hasPending = () => fs.existsSync(path.join(PENDING, 'READY'));

module.exports = { create, stage, applyPending, hasPending, tarHeader };
