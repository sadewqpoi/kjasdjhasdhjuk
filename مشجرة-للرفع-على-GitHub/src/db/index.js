'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
// تطبيق نسخة احتياطية مرفوعة من لوحة الإدارة (إن وُجدت) قبل فتح قاعدة البيانات
require('../lib/backup').applyPending();

const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

// ---- ترقيات المخطط لقواعد البيانات الموجودة ----
function addColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
// هل رأى العضو آخر رد من الإدارة على رسالته (لإشعار الصفحة الرئيسية)
addColumn('feedback', 'user_seen', 'user_seen INTEGER NOT NULL DEFAULT 1');
// طلب التوثيق اليدوي للجوال من الإدارة
addColumn('users', 'verify_requested_at', 'verify_requested_at TEXT');
// بوابات الدفع المتعددة + التحويل البنكي
addColumn('payments', 'gateway_id', 'gateway_id INTEGER REFERENCES payment_gateways(id)');
addColumn('payments', 'transfer_name', 'transfer_name TEXT');      // اسم المحوِّل
addColumn('payments', 'transfer_ref', 'transfer_ref TEXT');        // رقم العملية / ملاحظة
addColumn('payments', 'receipt_file', 'receipt_file TEXT');        // صورة الإيصال
addColumn('payments', 'submitted_at', 'submitted_at TEXT');        // وقت إرسال بيانات التحويل للمراجعة
addColumn('payments', 'reviewed_by', 'reviewed_by INTEGER');
// إيقاف ميزة بالكامل لجميع الأعضاء (مثل وثيقة النسب) بغض النظر عن الباقات
addColumn('features', 'is_enabled', 'is_enabled INTEGER NOT NULL DEFAULT 1');
// وصايا الأجداد
db.exec(`CREATE TABLE IF NOT EXISTS wills (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  person_id    INTEGER REFERENCES persons(id) ON DELETE SET NULL,  -- الجد صاحب الوصية في المشجرة (اختياري)
  author_name  TEXT,                                                -- اسم صاحب الوصية إن لم يكن في المشجرة
  body         TEXT NOT NULL,
  source       TEXT,                                                -- الراوي أو المصدر
  will_date    TEXT,                                                -- تاريخ الوصية (نص حر: هجري أو ميلادي)
  image_file   TEXT,                                                -- صورة الوصية الأصلية (اختياري)
  is_published INTEGER NOT NULL DEFAULT 1,
  sort         INTEGER NOT NULL DEFAULT 0,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wills_person ON wills(person_id);`);
// الرسائل الجماعية (دعوات وإعلانات) تظهر في الموقع وتُرسل على واتساب
db.exec(`CREATE TABLE IF NOT EXISTS announcements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL DEFAULT 'general',   -- invitation | announcement | condolence | congrats | general
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  image_file   TEXT,
  audience     TEXT NOT NULL DEFAULT 'all',       -- all | linked
  send_whatsapp INTEGER NOT NULL DEFAULT 0,
  wa_cancelled INTEGER NOT NULL DEFAULT 0,        -- إيقاف ما تبقى من إرسال واتساب
  is_deleted   INTEGER NOT NULL DEFAULT 0,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS announcement_deliveries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone           TEXT,
  read_at         TEXT,
  wa_status       TEXT NOT NULL DEFAULT 'none',   -- none | pending | sent | failed | skipped | cancelled
  wa_channel      TEXT,
  wa_error        TEXT,
  wa_attempts     INTEGER NOT NULL DEFAULT 0,
  wa_sent_at      TEXT,
  UNIQUE (announcement_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ann_deliv_user ON announcement_deliveries(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_ann_deliv_wa ON announcement_deliveries(wa_status, id);`);
// العضو يستطيع إيقاف استقبال الرسائل الجماعية على واتساب (تبقى تظهر له في الموقع)
addColumn('users', 'wa_broadcast_opt_out', 'wa_broadcast_opt_out INTEGER NOT NULL DEFAULT 0');

// ---- أدوات مساعدة ----
const stmtCache = new Map();
function prep(sql) {
  let s = stmtCache.get(sql);
  if (!s) { s = db.prepare(sql); stmtCache.set(sql, s); }
  return s;
}
const one = (sql, ...p) => prep(sql).get(...p);
const all = (sql, ...p) => prep(sql).all(...p);
const run = (sql, ...p) => prep(sql).run(...p);

let txDepth = 0;
/** تنفيذ دالة داخل معاملة ذرّية (تدعم التداخل عبر SAVEPOINT) */
function tx(fn) {
  const sp = `sp${txDepth}`;
  db.exec(txDepth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  txDepth++;
  try {
    const r = fn();
    txDepth--;
    db.exec(txDepth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return r;
  } catch (e) {
    txDepth--;
    db.exec(txDepth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw e;
  }
}

// ---- بيانات أولية ----
// المميزات المرتبطة بحماية فعلية في الخادم. يمكن للمدير تعديل الاسم والوصف وتوزيعها على الباقات.
const SYSTEM_FEATURES = [
  ['tree.view', 'مشاهدة المشجرة', 'عرض المشجرة التفاعلية لكامل الفرع'],
  ['tree.search', 'البحث عن أفراد العائلة', 'البحث بالاسم داخل المشجرة'],
  ['person.basic', 'بيانات الأقارب الأساسية', 'الاسم والنسب الكامل والأبناء وحالة الحياة'],
  ['person.photos', 'مشاهدة الصور الشخصية', 'رؤية صور الأعضاء المسموح بعرضها في بطاقاتهم'],
  ['person.dates', 'تواريخ الميلاد والوفاة', 'عرض التواريخ المسموح بعرضها حسب الخصوصية'],
  ['tree.stats', 'إحصائيات العائلة', 'أعداد الأجيال والذكور والإناث والأحياء'],
  ['tree.relationship', 'حاسبة صلة القرابة', 'معرفة صلة القرابة بين أي شخصين في المشجرة'],
  ['tree.export', 'تصدير بيانات الفرع', 'تنزيل ذرية أي شخص كملف CSV'],
  ['person.contact', 'أرقام تواصل الأقارب', 'رؤية أرقام الأعضاء الذين سمحوا بعرضها'],
  ['tree.certificate', 'وثيقة النسب', 'وثيقة نسب قابلة للطباعة لأي فرد'],
];

const STAFF_PERMISSIONS = {
  'tree.manage': 'إدارة أفراد المشجرة',
  'requests.review': 'مراجعة طلبات الربط والإضافة',
  'plans.manage': 'إدارة الباقات والمميزات والأسعار',
  'subscriptions.manage': 'إدارة الاشتراكات',
  'payments.view': 'إدارة المدفوعات',
  'users.manage': 'إدارة المستخدمين',
  'events.manage': 'إدارة المناسبات العائلية',
  'home.manage': 'إدارة محتوى الصفحة الرئيسية (اللافتات والمربعات)',
  'feedback.manage': 'الرد على الاقتراحات والاستفسارات',
  'wills.manage': 'إدارة وصايا الأجداد',
  'announcements.send': 'إرسال الرسائل الجماعية (الموقع وواتساب)',
  'stats.view': 'مشاهدة الإحصائيات',
  'audit.view': 'سجل العمليات',
};

/** مربعات الصفحة الرئيسية المدمجة: [المفتاح، الاسم الافتراضي، الأيقونة] */
const SYSTEM_TILES = [
  ['link', 'ربط حسابي بالمشجرة', 'link'],
  ['tree', 'المشجرة الإلكترونية', 'tree'],
  ['members', 'الأعضاء المسجلون', null],
  ['events', 'المناسبات', 'events'],
  ['announcements', 'الدعوات والإعلانات', 'news'],
  ['feedback', 'الاقتراحات والاستفسارات', 'feedback'],
  ['certificate', 'وثيقة النسب', 'certificate'],
  ['wills', 'وصايا الأجداد', 'scroll'],
  ['kinship', 'حاسبة القرابة', 'kinship'],
  ['plans', 'الباقات والاشتراكات', 'plans'],
  ['account', 'حسابي', 'account'],
  ['admin', 'لوحة الإدارة', 'admin'],
];

function seed() {
  tx(() => {
    SYSTEM_FEATURES.forEach(([key, name, desc], i) => {
      if (!one('SELECT id FROM features WHERE key = ?', key)) {
        run('INSERT INTO features (key, name, description, is_system, sort_order) VALUES (?,?,?,1,?)', key, name, desc, i + 1);
      } else {
        run('UPDATE features SET is_system = 1 WHERE key = ?', key);
      }
    });

    if (!one('SELECT id FROM plans LIMIT 1')) {
      const plans = [
        ['الباقة المجانية', 'المميزات الأساسية لجميع أفراد العائلة', 0, 365, 1, 0, '#6b7280',
          ['tree.view', 'tree.search', 'person.basic']],
        ['الباقة الفضية', 'جميع مميزات المجانية مع تفاصيل أكثر', 9900, 365, 0, 1, '#9ca3af',
          ['tree.view', 'tree.search', 'person.basic', 'person.photos', 'person.dates', 'tree.stats']],
        ['الباقة الذهبية', 'مميزات حصرية وأدوات إضافية', 19900, 365, 0, 2, '#c9a227',
          ['tree.view', 'tree.search', 'person.basic', 'person.photos', 'person.dates', 'tree.stats', 'tree.relationship', 'tree.export']],
        ['الباقة الماسية', 'جميع المميزات المتقدمة والحصرية', 34900, 365, 0, 3, '#3b82f6',
          SYSTEM_FEATURES.map((f) => f[0])],
      ];
      for (const [name, desc, price, days, isFree, tier, color, feats] of plans) {
        const r = run('INSERT INTO plans (name, description, price_halalas, duration_days, is_free, tier, color) VALUES (?,?,?,?,?,?,?)',
          name, desc, price, days, isFree, tier, color);
        for (const k of feats) {
          run('INSERT INTO plan_features (plan_id, feature_id) SELECT ?, id FROM features WHERE key = ?', r.lastInsertRowid, k);
        }
      }
    }

    const defaults = {
      site_name: 'مشجرة آل العلاط',
      require_link_for_tree: '1',   // لا تُعرض المشجرة إلا لحساب مرتبط ومعتمد
      expiring_days: '14',          // اعتبار الاشتراك "قارب على الانتهاء" قبل هذا العدد من الأيام
      // لافتة الصفحة الرئيسية (تُعدَّل من الإعدادات)
      home_banner_title: 'وَجَعَلْنَاكُمْ شُعُوبًا وَقَبَائِلَ لِتَعَارَفُوا',
      home_banner_text: 'مشجرة تحفظ نسب العائلة وتجمع أبناءها',
      home_banner_link: '',
      // أقسام الصفحة الرئيسية
      home_show_banners: '1',
      home_show_stats: '1',
      home_show_next_event: '1',
    };
    for (const [k, v] of Object.entries(defaults)) {
      run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', k, v);
    }

    // المربعات المدمجة (تُضاف مرة واحدة، ويبقى تعديل المدير عليها محفوظًا)
    SYSTEM_TILES.forEach(([key, label, icon], i) => {
      run("INSERT OR IGNORE INTO home_tiles (kind, key, label, icon, sort) VALUES ('system', ?, ?, ?, ?)", key, label, icon, (i + 1) * 10);
    });
    // بوابة الدفع الأولى من إعدادات .env (مرة واحدة فقط عند عدم وجود أي بوابة)
    if (!one('SELECT id FROM payment_gateways LIMIT 1')) {
      const p = config.payment;
      if (p.provider === 'moyasar') {
        run("INSERT INTO payment_gateways (provider, name, description, config, is_active, sort) VALUES ('moyasar', 'ميسّر', 'مدى، Apple Pay، فيزا، ماستركارد', ?, 1, 10)",
          JSON.stringify({ secret_key: p.moyasarSecretKey || '', webhook_secret: p.moyasarWebhookSecret || '' }));
      } else if (!config.isProd) {
        run("INSERT INTO payment_gateways (provider, name, description, config, is_active, sort) VALUES ('mock', 'بوابة تجريبية', 'للتطوير فقط — لا يُخصم أي مبلغ', '{}', 1, 10)");
      }
    }
    // لافتة افتراضية (من الإعداد القديم) إذا لم توجد أي لافتة
    if (!one('SELECT id FROM home_banners LIMIT 1')) {
      const g = (k) => (one('SELECT value FROM settings WHERE key = ?', k) || {}).value || null;
      run('INSERT INTO home_banners (title, text, link, sort) VALUES (?,?,?,10)', g('home_banner_title'), g('home_banner_text'), g('home_banner_link'));
    }
  });
}
seed();

function getSetting(key, fallback = null) {
  const r = one('SELECT value FROM settings WHERE key = ?', key);
  return r ? r.value : fallback;
}

module.exports = { db, one, all, run, tx, getSetting, SYSTEM_FEATURES, STAFF_PERMISSIONS, SYSTEM_TILES };
