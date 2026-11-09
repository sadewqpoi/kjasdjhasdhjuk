'use strict';
/** لوحة المدير العام والمشرفين - كل مسار محمي بصلاحية محددة */
const express = require('express');
const config = require('../config');
const { one, all, run, tx, getSetting, STAFF_PERMISSIONS } = require('../db');
const { h, bad, conflict, notFound, forbidden, int, str, oneOf, dateStr, normalizePhone } = require('../lib/http');
const { requirePermission: perm, requireAdmin, requireAuth, rateLimit } = require('../lib/auth');
const rateLimitAdmin = rateLimit('wabot-test', 10, 15 * 60e3);
const tree = require('../lib/tree');
const subs = require('../lib/subscriptions');
const payments = require('../lib/payments');
const { normName } = require('../lib/arabic');
const { audit } = require('../lib/audit');

const r = express.Router();
r.use(requireAuth, (req, _res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'moderator') return next(forbidden());
  next();
});

const page = (q) => {
  const p = Math.max(1, Number(q.page) || 1);
  const size = Math.min(100, Math.max(5, Number(q.size) || 25));
  return { limit: size, offset: (p - 1) * size, page: p, size };
};
const userBrief = (id) => one('SELECT id, membership_no, full_name, phone, role, status, person_id FROM users WHERE id = ?', id);
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

// =================== الإحصائيات ===================
r.get('/stats', perm('stats.view'), h((_req, res) => {
  subs.expireDue();
  const soonDays = Number(getSetting('expiring_days', '14'));
  const now = new Date().toISOString();
  const soon = subs.addDays(now, soonDays);
  res.json({
    persons: one('SELECT COUNT(*) c FROM persons').c,
    users: one('SELECT COUNT(*) c FROM users').c,
    users_verified: one('SELECT COUNT(*) c FROM users WHERE phone_verified_at IS NOT NULL').c,
    users_linked: one('SELECT COUNT(*) c FROM users WHERE person_id IS NOT NULL').c,
    pending_links: one("SELECT COUNT(*) c FROM link_requests WHERE status = 'pending'").c,
    pending_additions: one("SELECT COUNT(*) c FROM addition_requests WHERE status = 'pending'").c,
    pending_phone: one('SELECT COUNT(*) c FROM users WHERE phone_verified_at IS NULL AND verify_requested_at IS NOT NULL').c,
    pending_transfers: one("SELECT COUNT(*) c FROM payments WHERE status = 'initiated' AND submitted_at IS NOT NULL").c,
    subs_active: one("SELECT COUNT(*) c FROM subscriptions WHERE status = 'active'").c,
    subs_expiring: one("SELECT COUNT(*) c FROM subscriptions WHERE status = 'active' AND end_at <= ?", soon).c,
    subs_expired: one("SELECT COUNT(DISTINCT user_id) c FROM subscriptions s WHERE status = 'expired' AND NOT EXISTS (SELECT 1 FROM subscriptions x WHERE x.user_id = s.user_id AND x.status IN ('active','suspended'))").c,
    revenue_halalas: one("SELECT COALESCE(SUM(amount_halalas),0) s FROM payments WHERE status = 'paid'").s,
    revenue_30d_halalas: one("SELECT COALESCE(SUM(amount_halalas),0) s FROM payments WHERE status = 'paid' AND verified_at >= datetime('now','-30 days')").s,
    by_plan: all(`SELECT p.id, p.name, p.color, COUNT(s.id) c FROM plans p LEFT JOIN subscriptions s ON s.plan_id = p.id AND s.status = 'active'
                  WHERE p.is_deleted = 0 GROUP BY p.id ORDER BY p.tier`),
    signups_30d: all("SELECT date(created_at) d, COUNT(*) c FROM users WHERE created_at >= datetime('now','-30 days') GROUP BY d ORDER BY d"),
    expiring_days: soonDays,
  });
}));

// =================== أفراد المشجرة ===================
r.get('/persons', perm('tree.manage'), h((req, res) => {
  const { limit, offset, page: p } = page(req.query);
  const q = (req.query.q || '').trim();
  let ids;
  if (q) ids = tree.searchText(q, 200);
  const where = ids ? `WHERE p.id IN (${ids.map(Number).join(',') || 0})` : '';
  const rows = all(`SELECT p.*, u.id AS user_id, u.membership_no FROM persons p LEFT JOIN users u ON u.person_id = p.id ${where}
                    ORDER BY p.generation, p.id LIMIT ? OFFSET ?`, limit, offset);
  const total = one(`SELECT COUNT(*) c FROM persons p ${where}`).c;
  const { children } = tree.index();
  res.json({
    total, page: p,
    items: rows.map((x) => ({
      ...x, full_name: tree.fullName(x.id, 5), father_full_name: x.father_id ? tree.fullName(x.father_id, 5) : null, children_count: (children.get(x.id) || []).length,
    })),
  });
}));

function personInput(b, existing = {}) {
  return {
    name: str(b.name ?? existing.name, 'الاسم', { max: 40 }),
    gender: oneOf(b.gender ?? existing.gender ?? 'male', ['male', 'female'], 'الجنس'),
    birth_date: b.birth_date !== undefined ? dateStr(b.birth_date, 'تاريخ الميلاد') : existing.birth_date ?? null,
    death_date: b.death_date !== undefined ? dateStr(b.death_date, 'تاريخ الوفاة') : existing.death_date ?? null,
    is_deceased: b.is_deceased !== undefined ? bool(b.is_deceased) : existing.is_deceased ?? 0,
    notes: b.notes !== undefined ? str(b.notes, 'الملاحظات', { optional: true, max: 1000 }) : existing.notes ?? null,
  };
}

function createPerson(b) {
  const d = personInput(b);
  let fatherId = null; let gen = 0;
  if (b.father_id) {
    const f = one('SELECT id, generation FROM persons WHERE id = ?', int(b.father_id, 'الأب'));
    if (!f) throw notFound('الأب غير موجود');
    fatherId = f.id; gen = f.generation + 1;
  }
  const ins = run(`INSERT INTO persons (name, name_norm, father_id, gender, generation, birth_date, death_date, is_deceased, notes, sort_order)
                   VALUES (?,?,?,?,?,?,?,?,?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM persons))`,
  d.name, normName(d.name), fatherId, d.gender, gen, d.birth_date, d.death_date, d.is_deceased || (d.death_date ? 1 : 0), d.notes);
  const id = Number(ins.lastInsertRowid);
  run('UPDATE persons SET code = ? WHERE id = ? AND code IS NULL', `N${id}`, id);
  tree.invalidate();
  return id;
}

r.post('/persons', perm('tree.manage'), h((req, res) => {
  const id = tx(() => createPerson(req.body || {}));
  audit(req, 'person.create', 'person', id, req.body);
  res.status(201).json({ id });
}));

r.put('/persons/:id', perm('tree.manage'), h((req, res) => {
  const id = int(req.params.id);
  const p = one('SELECT * FROM persons WHERE id = ?', id);
  if (!p) throw notFound();
  const b = req.body || {};
  const d = personInput(b, p);
  tx(() => {
    let fatherId = p.father_id;
    if (b.father_id !== undefined && (b.father_id ? Number(b.father_id) : null) !== p.father_id) {
      fatherId = b.father_id ? int(b.father_id, 'الأب') : null;
      if (fatherId) {
        if (fatherId === id || tree.descendants(id).includes(fatherId)) throw bad('لا يمكن جعل أحد الأبناء أبًا لنفس الشخص');
        if (!one('SELECT id FROM persons WHERE id = ?', fatherId)) throw notFound('الأب غير موجود');
      }
    }
    run(`UPDATE persons SET name = ?, name_norm = ?, father_id = ?, gender = ?, birth_date = ?, death_date = ?, is_deceased = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`,
      d.name, normName(d.name), fatherId, d.gender, d.birth_date, d.death_date, d.is_deceased, d.notes, id);
    if (fatherId !== p.father_id) {
      // إعادة حساب الأجيال للشخص وذريته
      tree.invalidate();
      const base = fatherId ? one('SELECT generation FROM persons WHERE id = ?', fatherId).generation + 1 : 0;
      const delta = base - p.generation;
      if (delta) for (const x of [id, ...tree.descendants(id)]) run('UPDATE persons SET generation = generation + ? WHERE id = ?', delta, x);
    }
  });
  tree.invalidate();
  audit(req, 'person.update', 'person', id, { before: p, after: b });
  res.json({ ok: true });
}));

r.delete('/persons/:id', perm('tree.manage'), h((req, res) => {
  const id = int(req.params.id);
  const p = one('SELECT * FROM persons WHERE id = ?', id);
  if (!p) throw notFound();
  if (one('SELECT id FROM persons WHERE father_id = ? LIMIT 1', id)) throw conflict('لا يمكن حذف شخص له أبناء في المشجرة');
  if (one('SELECT id FROM users WHERE person_id = ?', id)) throw conflict('الشخص مرتبط بحساب، قم بفك الربط أولًا');
  tx(() => {
    run('DELETE FROM link_requests WHERE person_id = ?', id);
    run('DELETE FROM persons WHERE id = ?', id);
  });
  tree.invalidate();
  audit(req, 'person.delete', 'person', id, p);
  res.json({ ok: true });
}));

r.post('/persons/:id/unlink', perm('tree.manage'), h((req, res) => {
  const id = int(req.params.id);
  const u = one('SELECT id FROM users WHERE person_id = ?', id);
  if (!u) throw notFound('لا يوجد حساب مرتبط');
  run('UPDATE users SET person_id = NULL, linked_at = NULL WHERE id = ?', u.id);
  audit(req, 'person.unlink', 'person', id, { user_id: u.id });
  res.json({ ok: true });
}));

// =================== طلبات الربط ===================
r.get('/link-requests', perm('requests.review'), h((req, res) => {
  const status = req.query.status || 'pending';
  const rows = all(`SELECT lr.*, u.full_name AS user_full_name, u.phone, u.membership_no, u.photo_file IS NOT NULL AS has_photo,
                      (SELECT id FROM users WHERE person_id = lr.person_id) AS person_linked_user
                    FROM link_requests lr JOIN users u ON u.id = lr.user_id
                    ${status === 'all' ? '' : 'WHERE lr.status = ?'} ORDER BY lr.id DESC LIMIT 200`, ...(status === 'all' ? [] : [status]));
  res.json({
    items: rows.map((x) => ({
      ...x,
      person_full_name: tree.fullName(x.person_id, 8),
      other_pending: one("SELECT COUNT(*) c FROM link_requests WHERE person_id = ? AND status = 'pending' AND id <> ?", x.person_id, x.id).c,
    })),
  });
}));

r.get('/users/:id/photo', perm('requests.review'), h((req, res) => {
  const u = one('SELECT photo_file FROM users WHERE id = ?', int(req.params.id));
  const f = u && require('../lib/uploads').avatarPath(u.photo_file);
  if (!f) throw notFound();
  res.sendFile(f);
}));

r.post('/link-requests/:id/approve', perm('requests.review'), h((req, res) => {
  const id = int(req.params.id);
  tx(() => {
    const lr = one('SELECT * FROM link_requests WHERE id = ?', id);
    if (!lr) throw notFound();
    if (lr.status !== 'pending') throw bad('الطلب ليس قيد المراجعة');
    const u = one('SELECT * FROM users WHERE id = ?', lr.user_id);
    if (u.person_id) throw conflict('حساب المستخدم مرتبط بشخص آخر بالفعل');
    if (one('SELECT id FROM users WHERE person_id = ?', lr.person_id)) throw conflict('هذا الشخص مرتبط بحساب آخر بالفعل');
    run("UPDATE users SET person_id = ?, linked_at = datetime('now') WHERE id = ?", lr.person_id, u.id);
    run("UPDATE link_requests SET status = 'approved', admin_note = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?",
      str(req.body && req.body.note, 'الملاحظة', { optional: true, max: 500 }), req.user.id, id);
    // رفض الطلبات الأخرى المعلقة على نفس الشخص تلقائيًا
    run(`UPDATE link_requests SET status = 'rejected', admin_note = 'تم ربط هذا الاسم بحساب آخر', reviewed_by = ?, reviewed_at = datetime('now')
         WHERE person_id = ? AND status = 'pending' AND id <> ?`, req.user.id, lr.person_id, id);
  });
  audit(req, 'link.approve', 'link_request', id);
  res.json({ ok: true });
}));

r.post('/link-requests/:id/reject', perm('requests.review'), h((req, res) => {
  const id = int(req.params.id);
  const lr = one('SELECT * FROM link_requests WHERE id = ?', id);
  if (!lr) throw notFound();
  if (lr.status !== 'pending') throw bad('الطلب ليس قيد المراجعة');
  run("UPDATE link_requests SET status = 'rejected', admin_note = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?",
    str(req.body && req.body.note, 'سبب الرفض', { optional: true, max: 500 }), req.user.id, id);
  audit(req, 'link.reject', 'link_request', id);
  res.json({ ok: true });
}));

// =================== طلبات إضافة الأسماء ===================
r.get('/addition-requests', perm('requests.review'), h((req, res) => {
  const status = req.query.status || 'pending';
  const rows = all(`SELECT a.*, u.full_name AS user_full_name, u.phone, u.membership_no FROM addition_requests a JOIN users u ON u.id = a.user_id
                    ${status === 'all' ? '' : 'WHERE a.status = ?'} ORDER BY a.id DESC LIMIT 200`, ...(status === 'all' ? [] : [status]));
  res.json({ items: rows.map((x) => ({ ...x, father_full_name: x.father_id ? tree.fullName(x.father_id, 6) : null })) });
}));

r.post('/addition-requests/:id/approve', perm('requests.review'), h((req, res) => {
  const id = int(req.params.id);
  const b = req.body || {};
  const personId = tx(() => {
    const a = one('SELECT * FROM addition_requests WHERE id = ?', id);
    if (!a) throw notFound();
    if (a.status !== 'pending') throw bad('الطلب ليس قيد المراجعة');
    const fatherId = b.father_id || a.father_id;
    if (!fatherId) throw bad('حدد الأب في المشجرة قبل الموافقة');
    const pid = createPerson({ name: b.name || a.name, father_id: fatherId, gender: b.gender || a.gender, birth_date: b.birth_date ?? a.birth_date });
    const u = one('SELECT person_id FROM users WHERE id = ?', a.user_id);
    if (!u.person_id) run("UPDATE users SET person_id = ?, linked_at = datetime('now') WHERE id = ?", pid, a.user_id);
    run("UPDATE addition_requests SET status = 'approved', created_person_id = ?, admin_note = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?",
      pid, str(b.note, 'الملاحظة', { optional: true, max: 500 }), req.user.id, id);
    return pid;
  });
  audit(req, 'addition.approve', 'addition_request', id, { person_id: personId });
  res.json({ ok: true, person_id: personId });
}));

r.post('/addition-requests/:id/reject', perm('requests.review'), h((req, res) => {
  const id = int(req.params.id);
  const a = one('SELECT * FROM addition_requests WHERE id = ?', id);
  if (!a) throw notFound();
  if (a.status !== 'pending') throw bad('الطلب ليس قيد المراجعة');
  run("UPDATE addition_requests SET status = 'rejected', admin_note = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?",
    str(req.body && req.body.note, 'سبب الرفض', { optional: true, max: 500 }), req.user.id, id);
  audit(req, 'addition.reject', 'addition_request', id);
  res.json({ ok: true });
}));

// =================== المميزات ===================
r.get('/features', perm('plans.manage'), h((_req, res) => {
  res.json({ items: all('SELECT * FROM features ORDER BY sort_order, id') });
}));

r.post('/features', perm('plans.manage'), h((req, res) => {
  const b = req.body || {};
  const key = str(b.key, 'المفتاح', { max: 50 });
  if (!/^[a-z][a-z0-9_.-]{1,49}$/.test(key)) throw bad('المفتاح يجب أن يكون بأحرف إنجليزية صغيرة');
  if (one('SELECT id FROM features WHERE key = ?', key)) throw conflict('المفتاح مستخدم');
  const ins = run('INSERT INTO features (key, name, description, is_system, sort_order) VALUES (?,?,?,0,?)',
    key, str(b.name, 'الاسم', { max: 80 }), str(b.description, 'الوصف', { optional: true, max: 300 }), Number(b.sort_order) || 100);
  audit(req, 'feature.create', 'feature', ins.lastInsertRowid, b);
  res.status(201).json({ id: Number(ins.lastInsertRowid) });
}));

r.put('/features/:id', perm('plans.manage'), h((req, res) => {
  const id = int(req.params.id);
  const f = one('SELECT * FROM features WHERE id = ?', id);
  if (!f) throw notFound();
  const b = req.body || {};
  const enabled = b.is_enabled !== undefined ? (b.is_enabled === true || b.is_enabled === 1 || b.is_enabled === '1' ? 1 : 0) : f.is_enabled;
  run('UPDATE features SET name = ?, description = ?, sort_order = ?, is_enabled = ? WHERE id = ?',
    str(b.name ?? f.name, 'الاسم', { max: 80 }), b.description !== undefined ? str(b.description, 'الوصف', { optional: true, max: 300 }) : f.description,
    b.sort_order !== undefined ? Number(b.sort_order) || 0 : f.sort_order, enabled, id);
  if (enabled !== f.is_enabled) audit(req, enabled ? 'feature.enable' : 'feature.disable', 'feature', id, { key: f.key });
  audit(req, 'feature.update', 'feature', id, b);
  res.json({ ok: true });
}));

r.delete('/features/:id', perm('plans.manage'), h((req, res) => {
  const id = int(req.params.id);
  const f = one('SELECT * FROM features WHERE id = ?', id);
  if (!f) throw notFound();
  if (f.is_system) throw forbidden('لا يمكن حذف ميزة نظامية مرتبطة بالخادم، يمكنك إزالتها من الباقات');
  run('DELETE FROM features WHERE id = ?', id);
  audit(req, 'feature.delete', 'feature', id, f);
  res.json({ ok: true });
}));

// =================== الباقات ===================
r.get('/plans', perm('plans.manage'), h((_req, res) => {
  const plans = all(`SELECT p.*, (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id = p.id AND s.status = 'active') AS active_subscribers
                     FROM plans p WHERE is_deleted = 0 ORDER BY tier, price_halalas`);
  const pf = all('SELECT plan_id, feature_id FROM plan_features');
  res.json({
    items: plans.map((p) => ({ ...p, feature_ids: pf.filter((x) => x.plan_id === p.id).map((x) => x.feature_id) })),
    features: all('SELECT * FROM features ORDER BY sort_order, id'),
  });
}));

function planInput(b, ex = {}) {
  const price = b.price !== undefined ? Math.round(Number(b.price) * 100) : ex.price_halalas;
  if (!Number.isFinite(price) || price < 0) throw bad('السعر غير صالح');
  const days = b.duration_days !== undefined ? Number(b.duration_days) : ex.duration_days;
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw bad('مدة الاشتراك غير صالحة');
  const color = b.color ?? ex.color ?? '#8a6d3b';
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw bad('اللون غير صالح');
  return {
    name: str(b.name ?? ex.name, 'اسم الباقة', { max: 60 }),
    description: b.description !== undefined ? str(b.description, 'الوصف', { optional: true, max: 500 }) : ex.description ?? null,
    price_halalas: price,
    duration_days: days,
    is_free: b.is_free !== undefined ? bool(b.is_free) : ex.is_free ?? 0,
    is_active: b.is_active !== undefined ? bool(b.is_active) : ex.is_active ?? 1,
    tier: b.tier !== undefined ? int(b.tier, 'المستوى') : ex.tier ?? 0,
    color,
  };
}

function setPlanFeatures(planId, ids) {
  if (!Array.isArray(ids)) return;
  run('DELETE FROM plan_features WHERE plan_id = ?', planId);
  for (const fid of ids) {
    if (one('SELECT id FROM features WHERE id = ?', int(fid))) run('INSERT INTO plan_features (plan_id, feature_id) VALUES (?,?)', planId, int(fid));
  }
}

r.post('/plans', perm('plans.manage'), h((req, res) => {
  const b = req.body || {};
  const d = planInput({ duration_days: 365, price: 0, ...b });
  const id = tx(() => {
    if (d.is_free) run('UPDATE plans SET is_free = 0');
    const ins = run('INSERT INTO plans (name, description, price_halalas, duration_days, is_free, is_active, tier, color) VALUES (?,?,?,?,?,?,?,?)',
      d.name, d.description, d.is_free ? 0 : d.price_halalas, d.duration_days, d.is_free, d.is_active, d.tier, d.color);
    setPlanFeatures(Number(ins.lastInsertRowid), b.feature_ids || []);
    return Number(ins.lastInsertRowid);
  });
  audit(req, 'plan.create', 'plan', id, b);
  res.status(201).json({ id });
}));

r.put('/plans/:id', perm('plans.manage'), h((req, res) => {
  const id = int(req.params.id);
  const p = one('SELECT * FROM plans WHERE id = ? AND is_deleted = 0', id);
  if (!p) throw notFound();
  const b = req.body || {};
  const d = planInput(b, p);
  tx(() => {
    if (d.is_free && !p.is_free) run('UPDATE plans SET is_free = 0');
    run(`UPDATE plans SET name = ?, description = ?, price_halalas = ?, duration_days = ?, is_free = ?, is_active = ?, tier = ?, color = ?, updated_at = datetime('now') WHERE id = ?`,
      d.name, d.description, d.is_free ? 0 : d.price_halalas, d.duration_days, d.is_free, d.is_active, d.tier, d.color, id);
    setPlanFeatures(id, b.feature_ids);
  });
  audit(req, 'plan.update', 'plan', id, { before: p, after: b });
  res.json({ ok: true });
}));

r.delete('/plans/:id', perm('plans.manage'), h((req, res) => {
  const id = int(req.params.id);
  const p = one('SELECT * FROM plans WHERE id = ? AND is_deleted = 0', id);
  if (!p) throw notFound();
  const active = one("SELECT COUNT(*) c FROM subscriptions WHERE plan_id = ? AND status IN ('active','suspended')", id).c;
  if (active) throw conflict(`لا يمكن حذف باقة عليها ${active} اشتراك فعّال؛ أوقف الباقة أو انقل المشتركين أولًا`);
  const used = one('SELECT COUNT(*) c FROM subscriptions WHERE plan_id = ?', id).c + one('SELECT COUNT(*) c FROM payments WHERE plan_id = ?', id).c;
  if (used) run("UPDATE plans SET is_deleted = 1, is_active = 0, is_free = 0, updated_at = datetime('now') WHERE id = ?", id); // حذف ناعم يحفظ السجل
  else run('DELETE FROM plans WHERE id = ?', id);
  audit(req, 'plan.delete', 'plan', id, p);
  res.json({ ok: true });
}));

// =================== تشغيل/إيقاف نظام الباقات والاشتراكات ===================
r.get('/plans-system', perm('plans.manage'), h((_req, res) => res.json(subs.systemState())));

r.put('/plans-system', perm('plans.manage'), h((req, res) => {
  const b = req.body || {};
  const before = subs.systemState();
  if (b.off_mode !== undefined) {
    if (!subs.OFF_MODES.includes(b.off_mode)) throw bad('خيار غير صالح');
    setSetting('subscriptions_off_mode', b.off_mode);
  }
  let extended = 0;
  if (b.enabled !== undefined) {
    const on = b.enabled === true || b.enabled === 1 || b.enabled === '1';
    if (!on && before.enabled) {
      setSetting('subscriptions_enabled', '0');
      setSetting('subscriptions_paused_at', new Date().toISOString());
    } else if (on && !before.enabled) {
      if (b.extend && before.paused_at) extended = subs.extendForPause(before.paused_at);
      setSetting('subscriptions_enabled', '1');
      setSetting('subscriptions_paused_at', '');
    }
  }
  const after = subs.systemState();
  audit(req, after.enabled ? 'plans_system.on' : 'plans_system.off', 'settings', null, { off_mode: after.off_mode, extended });
  res.json({ ...after, extended });
}));

// =================== الاشتراكات ===================
r.get('/subscriptions',perm('subscriptions.manage'), h((req, res) => {
  subs.expireDue();
  const { limit, offset, page: pg } = page(req.query);
  const filter = req.query.filter || 'active';
  const now = new Date().toISOString();
  const soon = subs.addDays(now, Number(req.query.days || getSetting('expiring_days', '14')));
  const conds = []; const params = [];
  if (filter === 'active') conds.push("s.status = 'active'");
  else if (filter === 'expiring') { conds.push("s.status = 'active' AND s.end_at <= ?"); params.push(soon); }
  else if (filter === 'expired') conds.push("s.status = 'expired' AND NOT EXISTS (SELECT 1 FROM subscriptions x WHERE x.user_id = s.user_id AND x.id > s.id)");
  else if (filter === 'suspended') conds.push("s.status = 'suspended'");
  else if (filter === 'cancelled') conds.push("s.status = 'cancelled'");
  if (req.query.plan_id) { conds.push('s.plan_id = ?'); params.push(int(req.query.plan_id)); }
  if (req.query.q) { conds.push('(u.full_name LIKE ? OR u.phone LIKE ? OR u.membership_no LIKE ?)'); const q = `%${req.query.q}%`; params.push(q, q, q); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const base = `FROM subscriptions s JOIN users u ON u.id = s.user_id JOIN plans p ON p.id = s.plan_id ${where}`;
  const items = all(`SELECT s.*, u.full_name, u.phone, u.membership_no, p.name AS plan_name, p.color ${base} ORDER BY s.end_at ASC LIMIT ? OFFSET ?`, ...params, limit, offset);
  res.json({ total: one(`SELECT COUNT(*) c ${base}`, ...params).c, page: pg, items });
}));

/** إضافة اشتراك يدوي لمستخدم */
r.post('/subscriptions', perm('subscriptions.manage'), h((req, res) => {
  const b = req.body || {};
  const userId = int(b.user_id, 'المستخدم');
  if (!userBrief(userId)) throw notFound('المستخدم غير موجود');
  const plan = subs.getPlan(int(b.plan_id, 'الباقة'));
  const cur = subs.getActiveSubscription(userId);
  const purpose = cur && cur.plan_id === plan.id ? 'renew' : 'new';
  const days = b.days ? int(b.days, 'عدد الأيام') : null;
  const s = subs.applySubscription({ userId, planId: plan.id, purpose, source: 'manual', createdBy: req.user.id, days,
    notes: str(b.notes, 'الملاحظات', { optional: true, max: 300 }) });
  audit(req, 'subscription.manual', 'subscription', s.id, b);
  res.status(201).json(s);
}));

r.post('/subscriptions/:id/renew', perm('subscriptions.manage'), h((req, res) => {
  const s = one('SELECT * FROM subscriptions WHERE id = ?', int(req.params.id));
  if (!s) throw notFound();
  const days = req.body && req.body.days ? int(req.body.days, 'عدد الأيام') : null;
  const cur = subs.getActiveSubscription(s.user_id);
  if (cur && cur.id !== s.id) throw conflict('لدى المستخدم اشتراك أحدث، جدد الاشتراك الحالي');
  const out = cur
    ? subs.applySubscription({ userId: s.user_id, planId: s.plan_id, purpose: 'renew', source: 'manual', createdBy: req.user.id, days })
    : subs.applySubscription({ userId: s.user_id, planId: s.plan_id, purpose: 'new', source: 'manual', createdBy: req.user.id, days, notes: 'تجديد يدوي' });
  audit(req, 'subscription.renew', 'subscription', out.id, { from: s.id, days });
  res.json(out);
}));

/** ترقية أو تخفيض الباقة */
r.post('/subscriptions/:id/change-plan', perm('subscriptions.manage'), h((req, res) => {
  const s = one('SELECT * FROM subscriptions WHERE id = ?', int(req.params.id));
  if (!s) throw notFound();
  if (!['active', 'suspended'].includes(s.status)) throw bad('يمكن تغيير باقة الاشتراك الفعّال فقط');
  const plan = subs.getPlan(int(req.body && req.body.plan_id, 'الباقة'));
  if (plan.id === s.plan_id) throw bad('نفس الباقة الحالية');
  // الاحتفاظ بنفس تاريخ الانتهاء عند التغيير اليدوي
  const out = tx(() => {
    run("UPDATE subscriptions SET status = 'replaced', updated_at = datetime('now') WHERE id = ?", s.id);
    const ins = run(`INSERT INTO subscriptions (user_id, plan_id, status, start_at, end_at, source, created_by, notes) VALUES (?,?,'active',?,?,'manual',?,?)`,
      s.user_id, plan.id, new Date().toISOString(), s.end_at, req.user.id, 'تغيير باقة يدوي');
    run('UPDATE subscriptions SET replaced_by = ? WHERE id = ?', ins.lastInsertRowid, s.id);
    return one('SELECT * FROM subscriptions WHERE id = ?', ins.lastInsertRowid);
  });
  audit(req, 'subscription.change_plan', 'subscription', out.id, { from: s.id, plan_id: plan.id });
  res.json(out);
}));

r.post('/subscriptions/:id/status', perm('subscriptions.manage'), h((req, res) => {
  const out = subs.setSubscriptionStatus(int(req.params.id), req.body && req.body.status);
  audit(req, 'subscription.status', 'subscription', out.id, { status: out.status });
  res.json(out);
}));

// =================== المدفوعات ===================
// =================== بوابات الدفع (المدير العام فقط لأنها تحوي مفاتيح سرية) ===================
const pcatalog = () => Object.values(payments.providers)
  .filter((p) => !(p.devOnly && config.isProd))
  .map((p) => ({ key: p.key, label: p.label, desc: p.desc, manual: !!p.manual, dev_only: !!p.devOnly, default_description: p.defaultDescription || '',
    fields: p.fields.map(({ key, label, secret, required, placeholder, type, options }) => ({ key, label, secret: !!secret, required: !!required, placeholder: placeholder || '', type: type || 'text', options: options || null })) }));

function gatewayView(g) {
  const prov = payments.providers[g.provider];
  const cfg = payments.parseCfg(g);
  const pub = {}; const secretsSet = {};
  for (const f of (prov ? prov.fields : [])) {
    if (f.secret) secretsSet[f.key] = !!cfg[f.key]; else pub[f.key] = cfg[f.key] !== undefined ? cfg[f.key] : (f.default || '');
  }
  return {
    id: g.id, provider: g.provider, provider_label: prov ? prov.label : g.provider, manual: !!(prov && prov.manual),
    name: g.name, description: g.description, is_active: !!g.is_active, ready: payments.isReady(g), sort: g.sort,
    config: pub, secrets_set: secretsSet, webhook_url: prov && prov.webhookRef ? `${config.publicUrl}/api/payments/webhook/${g.id}` : null,
    payments_count: one('SELECT COUNT(*) c FROM payments WHERE gateway_id = ?', g.id).c,
  };
}

/** دمج الإعدادات: القيم السرية تُستبدل فقط عند إرسال قيمة جديدة، وتُمسح بطلب صريح */
function mergeGatewayConfig(prov, oldCfg, input) {
  const cfg = { ...oldCfg };
  input = input || {};
  for (const f of prov.fields) {
    const v = input[f.key];
    if (f.secret) {
      if (v) cfg[f.key] = String(v).trim().slice(0, 500);
      if (input[`clear_${f.key}`]) delete cfg[f.key];
    } else if (v !== undefined) {
      if (f.type === 'select' && v && !f.options.includes(v)) throw bad(`قيمة غير صالحة: ${f.label}`);
      cfg[f.key] = String(v).trim().slice(0, f.type === 'textarea' ? 1000 : 300);
    }
  }
  return cfg;
}

r.get('/gateways', requireAdmin, h((_req, res) => {
  res.json({
    catalog: pcatalog(),
    items: all('SELECT * FROM payment_gateways WHERE is_deleted = 0 ORDER BY sort, id').map(gatewayView),
  });
}));

r.post('/gateways', requireAdmin, h((req, res) => {
  const b = req.body || {};
  const prov = payments.providers[b.provider];
  if (!prov || (prov.devOnly && config.isProd)) throw bad('نوع البوابة غير مدعوم');
  const name = str(b.name, 'اسم طريقة الدفع', { min: 2, max: 60 });
  const cfg = mergeGatewayConfig(prov, {}, b.config);
  const active = b.is_active ? 1 : 0;
  if (active && !payments.isReady({ provider: b.provider, cfg })) throw bad('أكمل الحقول المطلوبة قبل تفعيل البوابة');
  const max = one('SELECT COALESCE(MAX(sort), 0) m FROM payment_gateways').m;
  const ins = run('INSERT INTO payment_gateways (provider, name, description, config, is_active, sort) VALUES (?,?,?,?,?,?)',
    b.provider, name, str(b.description, 'الوصف', { optional: true, max: 120 }), JSON.stringify(cfg), active, max + 10);
  audit(req, 'gateway.create', 'payment_gateway', ins.lastInsertRowid, { provider: b.provider, name });
  res.status(201).json(gatewayView(one('SELECT * FROM payment_gateways WHERE id = ?', ins.lastInsertRowid)));
}));

r.put('/gateways/:id', requireAdmin, h((req, res) => {
  const id = int(req.params.id);
  const g = one('SELECT * FROM payment_gateways WHERE id = ? AND is_deleted = 0', id);
  if (!g) throw notFound();
  const prov = payments.provider(g.provider);
  const b = req.body || {};
  const cfg = mergeGatewayConfig(prov, payments.parseCfg(g), b.config);
  const name = b.name !== undefined ? str(b.name, 'اسم طريقة الدفع', { min: 2, max: 60 }) : g.name;
  const description = b.description !== undefined ? str(b.description, 'الوصف', { optional: true, max: 120 }) : g.description;
  const active = b.is_active !== undefined ? (b.is_active ? 1 : 0) : g.is_active;
  if (active && !payments.isReady({ provider: g.provider, cfg })) throw bad('أكمل الحقول المطلوبة قبل تفعيل البوابة');
  run("UPDATE payment_gateways SET name = ?, description = ?, config = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?",
    name, description, JSON.stringify(cfg), active, id);
  audit(req, 'gateway.update', 'payment_gateway', id, { is_active: !!active });
  res.json(gatewayView(one('SELECT * FROM payment_gateways WHERE id = ?', id)));
}));

r.post('/gateways/reorder', requireAdmin, h((req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map((x) => int(x)) : [];
  tx(() => ids.forEach((id, i) => run('UPDATE payment_gateways SET sort = ? WHERE id = ?', (i + 1) * 10, id)));
  res.json({ ok: true });
}));

r.delete('/gateways/:id', requireAdmin, h((req, res) => {
  const id = int(req.params.id);
  const g = one('SELECT * FROM payment_gateways WHERE id = ? AND is_deleted = 0', id);
  if (!g) throw notFound();
  // البوابة المستخدمة في مدفوعات سابقة تُخفى فقط حتى يبقى سجل المدفوعات قابلًا للتحقق
  if (one('SELECT id FROM payments WHERE gateway_id = ? LIMIT 1', id)) {
    run("UPDATE payment_gateways SET is_deleted = 1, is_active = 0, updated_at = datetime('now') WHERE id = ?", id);
  } else {
    run('DELETE FROM payment_gateways WHERE id = ?', id);
  }
  audit(req, 'gateway.delete', 'payment_gateway', id);
  res.json({ ok: true });
}));

// ---------- مراجعة التحويلات البنكية ----------
r.post('/payments/:id/approve', perm('payments.view'), h((req, res) => {
  const p = payments.approveTransfer(int(req.params.id), req.user.id);
  audit(req, 'payment.transfer_approved', 'payment', p.id);
  res.json({ status: p.status });
}));

r.post('/payments/:id/reject', perm('payments.view'), h((req, res) => {
  const reason = str(req.body && req.body.reason, 'سبب الرفض', { optional: true, max: 300 });
  const p = payments.rejectTransfer(int(req.params.id), req.user.id, reason);
  audit(req, 'payment.transfer_rejected', 'payment', p.id, { reason });
  res.json({ status: p.status });
}));

r.get('/payments', perm('payments.view'), h((req, res) => {
  const { limit, offset, page: pg } = page(req.query);
  const conds = []; const params = [];
  if (req.query.status === 'review') conds.push("pay.status = 'initiated' AND pay.submitted_at IS NOT NULL");
  else if (req.query.status) { conds.push('pay.status = ?'); params.push(req.query.status); }
  if (req.query.q) { conds.push('(u.full_name LIKE ? OR u.phone LIKE ? OR u.membership_no LIKE ? OR pay.provider_ref LIKE ?)'); const q = `%${req.query.q}%`; params.push(q, q, q, q); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const base = `FROM payments pay JOIN users u ON u.id = pay.user_id JOIN plans p ON p.id = pay.plan_id LEFT JOIN payment_gateways g ON g.id = pay.gateway_id ${where}`;
  res.json({
    total: one(`SELECT COUNT(*) c ${base}`, ...params).c,
    page: pg,
    sum_paid_halalas: one(`SELECT COALESCE(SUM(pay.amount_halalas),0) s ${base} ${where ? 'AND' : 'WHERE'} pay.status = 'paid'`, ...params).s,
    items: all(`SELECT pay.id, pay.purpose, pay.amount_halalas, pay.currency, pay.status, pay.provider, pay.provider_ref, pay.method, pay.failure_reason,
                       pay.subscription_id, pay.created_at, pay.verified_at, u.full_name, u.membership_no, u.phone, p.name AS plan_name,
                       g.name AS gateway_name, pay.transfer_name, pay.transfer_ref, pay.submitted_at, (pay.receipt_file IS NOT NULL) AS has_receipt
                ${base} ORDER BY pay.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset),
  });
}));

/** إعادة التحقق من عملية دفع لدى البوابة */
r.post('/payments/:id/reverify', perm('payments.view'), h(async (req, res) => {
  const p = await payments.verifyAndFulfill(int(req.params.id));
  audit(req, 'payment.reverify', 'payment', p.id, { status: p.status });
  res.json({ status: p.status });
}));

r.post('/payments/:id/refund', perm('payments.view'), h((req, res) => {
  const p = one('SELECT * FROM payments WHERE id = ?', int(req.params.id));
  if (!p) throw notFound();
  if (p.status !== 'paid') throw bad('يمكن تسجيل الاسترداد للعمليات المدفوعة فقط');
  tx(() => {
    run("UPDATE payments SET status = 'refunded' WHERE id = ?", p.id);
    if (req.body && req.body.cancel_subscription && p.subscription_id) {
      run("UPDATE subscriptions SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status IN ('active','suspended')", p.subscription_id);
    }
  });
  audit(req, 'payment.refund', 'payment', p.id, req.body);
  res.json({ ok: true });
}));

// =================== المستخدمون ===================
r.get('/users', perm('users.manage'), h((req, res) => {
  const { limit, offset, page: pg } = page(req.query);
  const conds = []; const params = [];
  if (req.query.q) { conds.push('(u.full_name LIKE ? OR u.phone LIKE ? OR u.membership_no LIKE ?)'); const q = `%${req.query.q}%`; params.push(q, q, q); }
  if (req.query.role) { conds.push('u.role = ?'); params.push(req.query.role); }
  if (req.query.linked === '1') conds.push('u.person_id IS NOT NULL');
  if (req.query.linked === '0') conds.push('u.person_id IS NULL');
  if (req.query.verify === 'pending') conds.push('u.phone_verified_at IS NULL AND u.verify_requested_at IS NOT NULL');
  if (req.query.verify === 'unverified') conds.push('u.phone_verified_at IS NULL');
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const items = all(`SELECT u.id, u.membership_no, u.full_name, u.phone, u.role, u.status, u.person_id, u.phone_verified_at, u.verify_requested_at, u.created_at, u.last_login_at,
                       (SELECT p.name FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.user_id = u.id AND s.status = 'active' LIMIT 1) AS plan_name
                     FROM users u ${where} ORDER BY u.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  res.json({
    total: one(`SELECT COUNT(*) c FROM users u ${where}`, ...params).c, page: pg,
    items: items.map((u) => ({ ...u, person_full_name: u.person_id ? tree.fullName(u.person_id, 5) : null })),
  });
}));

r.put('/users/:id/status', perm('users.manage'), h((req, res) => {
  const id = int(req.params.id);
  const u = userBrief(id);
  if (!u) throw notFound();
  if (u.role === 'admin' && req.user.role !== 'admin') throw forbidden();
  if (id === req.user.id) throw bad('لا يمكنك إيقاف حسابك');
  const status = oneOf(req.body && req.body.status, ['active', 'suspended'], 'الحالة');
  run('UPDATE users SET status = ? WHERE id = ?', status, id);
  if (status === 'suspended') run('DELETE FROM sessions WHERE user_id = ?', id);
  audit(req, 'user.status', 'user', id, { status });
  res.json({ ok: true });
}));

// =================== المشرفون وصلاحياتهم (المدير العام فقط) ===================
r.get('/staff', requireAdmin, h((_req, res) => {
  const staff = all("SELECT id, membership_no, full_name, phone, role, status FROM users WHERE role IN ('admin','moderator') ORDER BY role, id");
  res.json({
    catalog: STAFF_PERMISSIONS,
    items: staff.map((s) => ({ ...s, permissions: all('SELECT permission FROM staff_permissions WHERE user_id = ?', s.id).map((x) => x.permission) })),
  });
}));

r.put('/staff/:id', requireAdmin, h((req, res) => {
  const id = int(req.params.id);
  const u = userBrief(id);
  if (!u) throw notFound();
  if (id === req.user.id) throw bad('لا يمكنك تعديل صلاحياتك بنفسك');
  const role = oneOf(req.body && req.body.role, ['member', 'moderator', 'admin'], 'الدور');
  const perms = Array.isArray(req.body.permissions) ? req.body.permissions.filter((p) => STAFF_PERMISSIONS[p]) : [];
  tx(() => {
    run('UPDATE users SET role = ? WHERE id = ?', role, id);
    run('DELETE FROM staff_permissions WHERE user_id = ?', id);
    if (role === 'moderator') for (const p of perms) run('INSERT INTO staff_permissions (user_id, permission) VALUES (?,?)', id, p);
  });
  audit(req, 'staff.update', 'user', id, { role, perms });
  res.json({ ok: true });
}));

// =================== الإعدادات وسجل العمليات ===================
r.get('/settings', requireAdmin, h((_req, res) => {
  res.json(Object.fromEntries(all('SELECT key, value FROM settings').map((x) => [x.key, x.value])));
}));
r.put('/settings', requireAdmin, h((req, res) => {
  const allowed = ['site_name', 'require_link_for_tree', 'expiring_days', 'home_banner_title', 'home_banner_text', 'home_banner_link'];
  const link = req.body && req.body.home_banner_link;
  if (link && !/^(https:\/\/\S+|#\/\S*)$/i.test(String(link).trim())) throw bad('رابط اللافتة يجب أن يبدأ بـ https:// أو يكون رابطًا داخليًا مثل #/events');
  for (const k of allowed) {
    if (req.body && req.body[k] !== undefined) run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, String(req.body[k]).slice(0, 200));
  }
  audit(req, 'settings.update', 'settings', null, req.body);
  res.json({ ok: true });
}));

// ---------- بوت واتساب غير الرسمي (احتياطي) ----------
const wabot = require('../lib/wabot');
const setSetting = (k, v) => run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, String(v));

r.get('/wa-bot', requireAdmin, h((_req, res) => {
  res.json({ ...wabot.status(), daily_limit: Number(getSetting('wa_bot_daily_limit', '200')) });
}));

// ---------- طرق التحقق من الجوال (يختارها المدير ويرتبها ويضبطها) ----------
const vm = require('../lib/verify-methods');
const SECRET_KEYS = ['wa_app_secret', 'wa_token', 'sms_unifonic_app_sid'];
const PLAIN_KEYS = ['wa_number', 'wa_verify_token', 'wa_phone_number_id', 'sms_provider', 'sms_unifonic_sender'];

function otpSettings() {
  const on = vm.enabled();
  const w = vm.wa(); const s = vm.sms();
  return {
    methods: [...on, ...vm.METHODS.filter((m) => !on.includes(m))].map((key) => ({
      key, label: vm.LABELS[key], enabled: on.includes(key), ready: vm.ready(key),
    })),
    config: {
      wa_number: w.number, wa_verify_token: w.verifyToken, wa_phone_number_id: w.phoneNumberId,
      has_wa_app_secret: !!w.appSecret, has_wa_token: !!w.token,
      sms_provider: s.provider, sms_unifonic_sender: s.unifonicSender, has_sms_unifonic_app_sid: !!s.unifonicAppSid,
      sms_configured: vm.smsConfigured(),
    },
    webhook_url: `${config.publicUrl}/api/whatsapp/webhook`,
    is_prod: config.isProd,
    daily_limit: Number(getSetting('wa_bot_daily_limit', '200')),
  };
}

r.get('/otp-settings', requireAdmin, h((_req, res) => res.json(otpSettings())));

r.put('/otp-settings', requireAdmin, h(async (req, res) => {
  const b = req.body || {};
  if (Array.isArray(b.methods)) {
    const list = b.methods.filter((m, i, a) => vm.METHODS.includes(m) && a.indexOf(m) === i);
    if (!list.length) throw bad('فعّل طريقة تحقق واحدة على الأقل');
    setSetting('otp_methods', list.join(','));
  }
  const c = b.config || {};
  if (c.wa_number !== undefined && c.wa_number !== '' && !/^\d{10,15}$/.test(String(c.wa_number).replace(/\D/g, ''))) throw bad('رقم واتساب الصندوق غير صحيح (بالصيغة الدولية مثل 9665XXXXXXXX)');
  if (c.sms_provider !== undefined && !['console', 'unifonic'].includes(c.sms_provider)) throw bad('مزوّد الرسائل غير صالح');
  for (const k of PLAIN_KEYS) {
    if (c[k] !== undefined) setSetting(k, k === 'wa_number' ? String(c[k]).replace(/\D/g, '') : String(c[k]).trim().slice(0, 300));
  }
  // القيم السرية: لا تُعرض أبدًا، وتُستبدل فقط إذا أُرسلت قيمة جديدة، وتُمسح بطلب صريح
  for (const k of SECRET_KEYS) {
    if (c[k]) setSetting(k, String(c[k]).trim().slice(0, 500));
    if (c[`clear_${k}`]) setSetting(k, '');
  }
  if (b.daily_limit !== undefined) {
    const n = int(b.daily_limit, 'الحد اليومي');
    if (n < 1 || n > 2000) throw bad('الحد اليومي بين 1 و 2000');
    setSetting('wa_bot_daily_limit', n);
  }
  // تشغيل بوت واتساب أو إيقافه حسب تفعيل طريقته
  if (vm.enabled().includes('wa_bot')) await wabot.start(); else await wabot.stop();
  audit(req, 'otp.settings', 'settings', null, { methods: vm.enabled() });
  res.json({ ok: true, ...otpSettings() });
}));

/** توثيق رقم جوال عضو يدويًا */
r.post('/users/:id/verify-phone', perm('users.manage'), h((req, res) => {
  const id = int(req.params.id);
  if (!one('SELECT id FROM users WHERE id = ?', id)) throw notFound();
  run("UPDATE users SET phone_verified_at = COALESCE(phone_verified_at, datetime('now')), verify_requested_at = NULL WHERE id = ?", id);
  audit(req, 'user.phone_verified_manual', 'user', id);
  res.json({ ok: true });
}));

r.post('/wa-bot/logout', requireAdmin, h(async (req, res) => {
  await wabot.logout();
  audit(req, 'wabot.logout', 'settings', null);
  res.json({ ok: true });
}));

r.post('/wa-bot/test', requireAdmin, rateLimitAdmin, h(async (req, res) => {
  const phone = normalizePhone(req.body && req.body.phone);
  try { await wabot.send(phone, `رسالة تجربة من ${getSetting('site_name', 'المنصة')}. البوت يعمل بنجاح.`); } catch (e) { throw bad(e.message); }
  res.json({ ok: true });
}));

// =================== النسخ الاحتياطي والاستعادة (المدير العام فقط) ===================
const backup = require('../lib/backup');
const os = require('node:os');
const fs = require('node:fs');
const uploadBackup = require('multer')({ dest: os.tmpdir(), limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 1 } });

r.get('/backup', requireAdmin, async (req, res, next) => {
  try {
    const name = `alallat-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.tar.gz`;
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');
    audit(req, 'backup.download', 'settings', null);
    await backup.create(require('../db').db, res);
  } catch (e) {
    if (!res.headersSent) next(e); else res.destroy(e);
  }
});

r.get('/backup/status', requireAdmin, h((_req, res) => res.json({ pending: backup.hasPending(), data_dir: config.DATA_DIR })));

r.post('/restore', requireAdmin, uploadBackup.single('backup'), h((req, res) => {
  if (!req.file) throw bad('اختر ملف النسخة الاحتياطية');
  let info;
  try { info = backup.stage(req.file.path); } catch (e) { throw bad(e.message); } finally { fs.rm(req.file.path, { force: true }, () => {}); }
  audit(req, 'backup.restore', 'settings', null, info);
  res.json({ ok: true, ...info, restarting: true });
  // إعادة تشغيل الخادم لتطبيق الاستعادة (Railway يعيد تشغيله تلقائيًا)
  setTimeout(() => process.exit(75), 800);
}));

r.get('/audit', perm('audit.view'), h((req, res) => {
  const { limit, offset } = page(req.query);
  res.json({
    items: all(`SELECT a.*, u.full_name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT ? OFFSET ?`, limit, offset),
  });
}));

module.exports = r;
