-- =====================================================================
--  مخطط قاعدة بيانات منصة مشجرة العلاط
--  الفصل التام بين:  الشخص في المشجرة (persons)
--                    حساب المستخدم   (users)
--                    الاشتراك        (subscriptions)
-- =====================================================================
PRAGMA foreign_keys = ON;

-- ---------- السجل العائلي (مستقل عن الحسابات) ----------
CREATE TABLE IF NOT EXISTS persons (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT UNIQUE,                 -- الرقم المرجعي (من ملف المشجرة)
  name            TEXT NOT NULL,
  name_norm       TEXT NOT NULL,               -- الاسم بعد التطبيع للبحث
  father_id       INTEGER REFERENCES persons(id) ON DELETE RESTRICT,
  gender          TEXT NOT NULL DEFAULT 'male' CHECK (gender IN ('male','female')),
  generation      INTEGER NOT NULL DEFAULT 0,
  birth_date      TEXT,
  death_date      TEXT,
  is_deceased     INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_persons_father ON persons(father_id);
CREATE INDEX IF NOT EXISTS idx_persons_name_norm ON persons(name_norm);

-- ---------- حسابات المستخدمين ----------
CREATE TABLE IF NOT EXISTS users (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  membership_no     TEXT NOT NULL UNIQUE,
  full_name         TEXT NOT NULL,             -- الاسم الثلاثي كما كتبه المستخدم
  phone             TEXT NOT NULL UNIQUE,      -- بصيغة 9665XXXXXXXX
  phone_verified_at TEXT,
  password_hash     TEXT NOT NULL,
  photo_file        TEXT,
  role              TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','moderator','admin')),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  -- ربط الحساب بالشخص: UNIQUE يمنع ربط نفس الشخص بأكثر من حساب على مستوى القاعدة
  person_id         INTEGER UNIQUE REFERENCES persons(id) ON DELETE SET NULL,
  linked_at         TEXT,
  privacy_photo     TEXT NOT NULL DEFAULT 'members' CHECK (privacy_photo IN ('members','relatives','none')),
  privacy_phone     TEXT NOT NULL DEFAULT 'none'    CHECK (privacy_phone IN ('members','relatives','none')),
  privacy_birth     TEXT NOT NULL DEFAULT 'members' CHECK (privacy_birth IN ('members','relatives','none')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at     TEXT
);

-- صلاحيات المشرفين التفصيلية (المدير العام role=admin يملك كل شيء)
CREATE TABLE IF NOT EXISTS staff_permissions (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (user_id, permission)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- رموز التحقق من الجوال
CREATE TABLE IF NOT EXISTS otp_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  phone       TEXT NOT NULL,
  purpose     TEXT NOT NULL,                   -- verify_phone | reset_password
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone, purpose);

-- ---------- طلبات ربط الحساب بالشخص ----------
CREATE TABLE IF NOT EXISTS link_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_id    INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  user_note    TEXT,
  admin_note   TEXT,
  reviewed_by  INTEGER REFERENCES users(id),
  reviewed_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
-- طلب معلّق واحد فقط لكل مستخدم
CREATE UNIQUE INDEX IF NOT EXISTS uq_link_pending_user ON link_requests(user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_link_status ON link_requests(status);

-- ---------- طلبات إضافة اسم غير موجود ----------
CREATE TABLE IF NOT EXISTS addition_requests (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  father_id          INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  father_text        TEXT,                     -- وصف نصي للأب إن لم يُحدد
  gender             TEXT NOT NULL DEFAULT 'male' CHECK (gender IN ('male','female')),
  birth_date         TEXT,
  user_note          TEXT,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  admin_note         TEXT,
  created_person_id  INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  reviewed_by        INTEGER REFERENCES users(id),
  reviewed_at        TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_add_pending_user ON addition_requests(user_id) WHERE status = 'pending';

-- ---------- المميزات والباقات ----------
-- المميزات ذات is_system=1 مرتبطة بحماية فعلية في الخادم (المفتاح ثابت، الاسم قابل للتعديل)
CREATE TABLE IF NOT EXISTS features (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  is_system   INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plans (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  description   TEXT,
  price_halalas INTEGER NOT NULL DEFAULT 0 CHECK (price_halalas >= 0),   -- السعر بالهللة
  currency      TEXT NOT NULL DEFAULT 'SAR',
  duration_days INTEGER NOT NULL DEFAULT 365 CHECK (duration_days > 0),
  is_free       INTEGER NOT NULL DEFAULT 0,     -- الباقة الافتراضية لمن لا يملك اشتراكًا
  is_active     INTEGER NOT NULL DEFAULT 1,
  is_deleted    INTEGER NOT NULL DEFAULT 0,     -- حذف ناعم للحفاظ على سجل الاشتراكات
  tier          INTEGER NOT NULL DEFAULT 0,     -- ترتيب المستوى (للترقية/التخفيض)
  color         TEXT NOT NULL DEFAULT '#8a6d3b',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plan_features (
  plan_id    INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  PRIMARY KEY (plan_id, feature_id)
);

-- ---------- الاشتراكات ----------
CREATE TABLE IF NOT EXISTS subscriptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id     INTEGER NOT NULL REFERENCES plans(id),
  status      TEXT NOT NULL CHECK (status IN ('active','expired','cancelled','suspended','replaced')),
  start_at    TEXT NOT NULL,
  end_at      TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('payment','manual')),
  payment_id  INTEGER REFERENCES payments(id),
  replaced_by INTEGER REFERENCES subscriptions(id),
  created_by  INTEGER REFERENCES users(id),
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
-- اشتراك فعّال واحد فقط لكل مستخدم
CREATE UNIQUE INDEX IF NOT EXISTS uq_sub_active_user ON subscriptions(user_id) WHERE status IN ('active','suspended');
CREATE INDEX IF NOT EXISTS idx_sub_end ON subscriptions(status, end_at);

-- ---------- المدفوعات ----------
CREATE TABLE IF NOT EXISTS payments (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id            INTEGER NOT NULL REFERENCES plans(id),
  purpose            TEXT NOT NULL CHECK (purpose IN ('new','renew','upgrade','downgrade')),
  amount_halalas     INTEGER NOT NULL,
  currency           TEXT NOT NULL DEFAULT 'SAR',
  status             TEXT NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated','paid','failed','refunded','cancelled')),
  provider           TEXT NOT NULL,
  provider_ref       TEXT,                     -- رقم العملية لدى بوابة الدفع
  provider_payload   TEXT,                     -- آخر استجابة تحقق من البوابة (JSON)
  method             TEXT,                     -- mada / creditcard / applepay ...
  subscription_id    INTEGER REFERENCES subscriptions(id),
  failure_reason     TEXT,
  verified_at        TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pay_user ON payments(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pay_provider_ref ON payments(provider, provider_ref) WHERE provider_ref IS NOT NULL;

-- ---------- الإعدادات وسجل العمليات ----------
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   INTEGER,
  details     TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

-- ---------- المناسبات العائلية ----------
-- التاريخ والوقت يُحفظان بتوقيت السعودية كما أدخلهما المشرف: 'YYYY-MM-DDTHH:MM'
CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  description  TEXT,
  starts_at    TEXT NOT NULL,
  ends_at      TEXT,
  location     TEXT,
  map_url      TEXT,
  is_published INTEGER NOT NULL DEFAULT 1,
  is_cancelled INTEGER NOT NULL DEFAULT 0,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(starts_at);

CREATE TABLE IF NOT EXISTS event_rsvps (
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('yes','maybe','no')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_id, user_id)
);

-- ---------- الاقتراحات والاستفسارات ----------
CREATE TABLE IF NOT EXISTS feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('suggestion','inquiry')),
  subject     TEXT NOT NULL,
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','answered','closed')),
  reply       TEXT,
  replied_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  replied_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);

-- ---------- بوابات الدفع (يضيفها المدير ويشغّلها ويوقفها من اللوحة) ----------
CREATE TABLE IF NOT EXISTS payment_gateways (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  provider     TEXT NOT NULL,              -- moyasar | tap | paytabs | bank_transfer | mock
  name         TEXT NOT NULL,              -- الاسم الظاهر للعضو
  description  TEXT,                       -- مثل: مدى، Apple Pay، فيزا
  config       TEXT NOT NULL DEFAULT '{}', -- مفاتيح البوابة (JSON) — لا تُعرض القيم السرية أبدًا
  is_active    INTEGER NOT NULL DEFAULT 0,
  is_deleted   INTEGER NOT NULL DEFAULT 0,
  sort         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- التحقق عبر واتساب (العضو يرسل الرمز إلى رقم الصندوق) ----------
CREATE TABLE IF NOT EXISTS wa_verifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  phone        TEXT NOT NULL,
  purpose      TEXT NOT NULL CHECK (purpose IN ('verify_phone','reset_password')),
  code_hash    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','used','expired')),
  expires_at   TEXT NOT NULL,
  verified_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wa_phone ON wa_verifications(phone, status);

-- ---------- محتوى الصفحة الرئيسية (يُدار من لوحة الإدارة) ----------
CREATE TABLE IF NOT EXISTS home_banners (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  image_file  TEXT,                 -- صورة اللافتة (اختيارية)
  title       TEXT,
  text        TEXT,
  link        TEXT,                 -- #/... أو https://...
  sort        INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- المربعات: system = مربع مدمج يعمل بميزة في المنصة (يُخفى ولا يُحذف)، custom = مربع يضيفه المدير برابط
CREATE TABLE IF NOT EXISTS home_tiles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL CHECK (kind IN ('system','custom')),
  key         TEXT UNIQUE,          -- للمربعات المدمجة فقط
  label       TEXT NOT NULL,
  icon        TEXT,                 -- اسم أيقونة من المجموعة الجاهزة
  image_file  TEXT,                 -- أو صورة مرفوعة بدل الأيقونة
  link        TEXT,                 -- للمربعات المخصصة
  sort        INTEGER NOT NULL DEFAULT 0,
  is_visible  INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
