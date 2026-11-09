'use strict';
// فحص سريع لبيانات المشجرة بعد الاستيراد
const { all, one } = require('../src/db');
const t = require('../src/lib/tree');

console.log(all('SELECT generation g, COUNT(*) c, SUM(is_deceased) d FROM persons GROUP BY generation'));
const p = one("SELECT id FROM persons WHERE code = '70590'");
if (p) console.log(t.fullName(p.id));
const q = process.argv[2] || 'أصيل محمد عبد العزيز';
console.log(q, '→', t.searchByFullName(q).map((r) => [t.fullName(r.id, 4), r.score]));
const a = one("SELECT id FROM persons WHERE code = '70590'"); const b = one("SELECT id FROM persons WHERE code = '43693'");
if (a && b) console.log('relation:', t.describeRelation(a.id, b.id));
