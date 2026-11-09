'use strict';
/**
 * إنشاء حساب المدير العام أو ترقية حساب موجود
 *   node scripts/create-admin.js 05XXXXXXXX "كلمة المرور" "الاسم الثلاثي"
 */
const { one, run } = require('../src/db');
const { hashPassword, validatePassword } = require('../src/lib/auth');
const { normalizePhone } = require('../src/lib/http');

const [phoneArg, password, name = 'المدير العام'] = process.argv.slice(2);
if (!phoneArg || !password) { console.error('الاستخدام: node scripts/create-admin.js 05XXXXXXXX "كلمة المرور" "الاسم"'); process.exit(1); }
try {
  const phone = normalizePhone(phoneArg);
  validatePassword(password);
  const ex = one('SELECT id FROM users WHERE phone = ?', phone);
  if (ex) {
    run("UPDATE users SET role = 'admin', status = 'active', password_hash = ?, phone_verified_at = COALESCE(phone_verified_at, datetime('now')) WHERE id = ?", hashPassword(password), ex.id);
    console.log('✔ تمت ترقية الحساب إلى مدير عام');
  } else {
    const r = run("INSERT INTO users (membership_no, full_name, phone, password_hash, role, phone_verified_at) VALUES (?,?,?,?,'admin',datetime('now'))",
      `TMP-${Date.now()}`, name, phone, hashPassword(password));
    run('UPDATE users SET membership_no = ? WHERE id = ?', `AL-${10000 + Number(r.lastInsertRowid)}`, r.lastInsertRowid);
    console.log('✔ تم إنشاء حساب المدير العام');
  }
} catch (e) { console.error('✖', e.message); process.exit(1); }
