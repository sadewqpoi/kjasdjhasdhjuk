'use strict';
/**
 * استيراد المشجرة من ملف Excel بالتنسيق:
 *   الأعمدة A..F = الجيل 0..5 ، G = الجنس ، H = متوفي؟
 *   كل خلية: "الاسم\n(الرقم)\n[تاريخ الميلاد | توفي التاريخ]"
 *   الشخص في كل صف هو أعمق خلية غير فارغة، وأسلافه هم آخر من ظهر في الأعمدة السابقة.
 *
 * الاستخدام:
 *   node scripts/import-excel.js "مسار الملف.xlsx" [--root "سليمان العلاط"]
 * الاستيراد آمن للتكرار: يحدّث الأشخاص حسب الرقم المرجعي ولا يحذف أحدًا.
 */
const fs = require('node:fs');
const zlib = require('node:zlib');
const { one, run, tx } = require('../src/db');
const { normName } = require('../src/lib/arabic');

function unzip(buf) {
  // قراءة الدليل المركزي لملف ZIP
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('ملف xlsx غير صالح');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28); const xlen = buf.readUInt16LE(p + 30); const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    files[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    p += 46 + nlen + xlen + clen;
  }
  return files;
}

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&amp;/g, '&');

function readSheet(file) {
  const z = unzip(fs.readFileSync(file));
  const shared = [];
  if (z['xl/sharedStrings.xml']) {
    for (const si of z['xl/sharedStrings.xml'].toString('utf8').match(/<si>[\s\S]*?<\/si>/g) || []) {
      shared.push(decode((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
    }
  }
  const sheetName = Object.keys(z).find((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const xml = z[sheetName].toString('utf8');
  const rows = [];
  for (const rowXml of xml.match(/<row[\s\S]*?<\/row>/g) || []) {
    const row = {};
    for (const c of rowXml.match(/<c [^>]*?(\/>|>[\s\S]*?<\/c>)/g) || []) {
      const ref = c.match(/r="([A-Z]+)\d+"/)[1];
      const t = (c.match(/ t="(\w+)"/) || [])[1];
      let v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (t === 's' && v !== undefined) v = shared[Number(v)];
      else if (t === 'inlineStr') v = decode((c.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '');
      else if (v !== undefined) v = decode(v);
      if (v !== undefined && String(v).trim() !== '') row[ref] = String(v).trim();
    }
    rows.push(row);
  }
  return rows;
}

function parseCell(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const name = lines[0];
  let code = null; let birth = null; let death = null; let deceased = false;
  for (const l of lines.slice(1)) {
    const m = l.match(/^\((\d+)\)$/);
    if (m) { code = m[1]; continue; }
    const d = l.match(/(\d{4}-\d{2}-\d{2})/);
    if (/توفي|متوفى|توفيت/.test(l)) { deceased = true; if (d) death = d[1]; } else if (d) birth = d[1];
  }
  return { name, code, birth, death, deceased };
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file || !fs.existsSync(file)) { console.error('حدد مسار ملف Excel'); process.exit(1); }
  const ri = args.indexOf('--root');
  const rootName = ri >= 0 ? args[ri + 1] : 'سليمان العلاط';

  const rows = readSheet(file);
  const COLS = ['A', 'B', 'C', 'D', 'E', 'F'];
  const header = rows.shift();
  if (!header || !/الجيل/.test(header.A || '')) console.warn('تنبيه: لم يتم العثور على ترويسة "الجيل" في الصف الأول');

  const stats = { created: 0, updated: 0 };
  let order = 0;

  tx(() => {
    // رأس الفرع (والد الجيل 0)
    let root = one("SELECT id FROM persons WHERE code = 'ROOT'");
    if (!root) {
      const r = run(`INSERT INTO persons (code, name, name_norm, gender, generation, is_deceased, notes, sort_order) VALUES ('ROOT', ?, ?, 'male', 0, 1, 'رأس الفرع', 0)`,
        rootName, normName(rootName.split(' ')[0]));
      root = { id: Number(r.lastInsertRowid) };
      stats.created++;
    }

    const stack = []; // stack[g] = id للشخص الأخير في الجيل g
    rows.forEach((row, idx) => {
      let deepest = -1;
      COLS.forEach((c, g) => { if (row[c]) deepest = g; });
      if (deepest < 0) return;
      for (let g = 0; g <= deepest; g++) {
        const c = COLS[g];
        if (!row[c]) { if (stack[g] === undefined) throw new Error(`الصف ${idx + 2}: لا يوجد أب في الجيل ${g}`); continue; }
        const cell = parseCell(row[c]);
        const isLeaf = g === deepest;
        const gender = isLeaf && row.G ? (/أنثى/.test(row.G) ? 'female' : 'male') : 'male';
        const deceased = cell.deceased || (isLeaf && /نعم/.test(row.H || '')) ? 1 : 0;
        const fatherId = g === 0 ? root.id : stack[g - 1];
        const code = cell.code || `X${idx}-${g}`;
        const ex = one('SELECT id FROM persons WHERE code = ?', code);
        if (ex) {
          run(`UPDATE persons SET name = ?, name_norm = ?, father_id = ?, gender = ?, generation = ?, birth_date = COALESCE(?, birth_date),
               death_date = COALESCE(?, death_date), is_deceased = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?`,
          cell.name, normName(cell.name), fatherId, gender, g + 1, cell.birth, cell.death, deceased, ++order, ex.id);
          stack[g] = ex.id; stats.updated++;
        } else {
          const r = run(`INSERT INTO persons (code, name, name_norm, father_id, gender, generation, birth_date, death_date, is_deceased, sort_order)
                         VALUES (?,?,?,?,?,?,?,?,?,?)`,
          code, cell.name, normName(cell.name), fatherId, gender, g + 1, cell.birth, cell.death, deceased, ++order);
          stack[g] = Number(r.lastInsertRowid); stats.created++;
        }
        stack.length = g + 1;
      }
    });
  });
  const total = one('SELECT COUNT(*) c FROM persons').c;
  console.log(`✔ تم الاستيراد: ${stats.created} جديد، ${stats.updated} محدّث. إجمالي الأفراد: ${total}`);
}

main();
