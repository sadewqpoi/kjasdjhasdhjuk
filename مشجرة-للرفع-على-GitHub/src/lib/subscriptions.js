'use strict';
/**
 * منطق الاشتراكات والصلاحيات (Entitlements)
 * جميع قرارات الوصول للمميزات تُتخذ هنا اعتمادًا على قاعدة البيانات فقط.
 */
const { one, all, run, tx, getSetting } = require('../db');
const { bad, notFound, conflict, forbidden } = require('./http');

/**
 * تشغيل/إيقاف نظام الباقات والاشتراكات بالكامل (من لوحة الإدارة)
 * عند الإيقاف: لا شراء ولا تجديد، والأعضاء يحصلون إما على كل المميزات مجانًا (free_all)
 * أو على مميزات الباقة المجانية فقط (free_plan).
 */
const OFF_MODES = ['free_all', 'free_plan'];
function systemEnabled() { return getSetting('subscriptions_enabled', '1') !== '0'; }
function offMode() { const m = getSetting('subscriptions_off_mode', 'free_all'); return OFF_MODES.includes(m) ? m : 'free_all'; }
function systemState() {
  return { enabled: systemEnabled(), off_mode: offMode(), paused_at: getSetting('subscriptions_paused_at', '') || null };
}
function assertSystemEnabled() {
  if (!systemEnabled()) throw forbidden('الباقات والاشتراكات متوقفة حاليًا', 'subscriptions_disabled');
}

/**
 * عند إعادة التشغيل: تمديد الاشتراكات التي كانت سارية لحظة الإيقاف بمدة الإيقاف نفسها
 * (حتى لا يخسر المشترك الأيام التي توقف فيها النظام). يُعيد عدد الاشتراكات الممددة.
 */
function extendForPause(pausedAt, resumedAt = nowIso()) {
  const ms = new Date(resumedAt).getTime() - new Date(pausedAt).getTime();
  if (!(ms > 0)) return 0;
  return tx(() => {
    const rows = all(`SELECT id, user_id, status, end_at FROM subscriptions
                      WHERE status IN ('active','suspended','expired') AND end_at > ? AND start_at <= ?`, pausedAt, pausedAt);
    let n = 0;
    for (const s of rows) {
      const end = new Date(new Date(s.end_at).getTime() + ms).toISOString();
      if (s.status === 'expired') {
        // انتهى أثناء الإيقاف: يُعاد تفعيله فقط إن لم يكن للعضو اشتراك آخر قائم
        const other = one("SELECT id FROM subscriptions WHERE user_id = ? AND status IN ('active','suspended') AND id <> ?", s.user_id, s.id);
        if (other) continue;
        run("UPDATE subscriptions SET end_at = ?, status = 'active', updated_at = datetime('now') WHERE id = ?", end, s.id);
      } else {
        run("UPDATE subscriptions SET end_at = ?, updated_at = datetime('now') WHERE id = ?", end, s.id);
      }
      n++;
    }
    return n;
  });
}

const nowIso = () => new Date().toISOString();
const addDays = (iso, days) => new Date(new Date(iso).getTime() + days * 864e5).toISOString();

/** تحويل الاشتراكات المنتهية إلى حالة expired (يُستدعى دوريًا وعند كل قراءة) */
function expireDue() {
  return run("UPDATE subscriptions SET status = 'expired', updated_at = datetime('now') WHERE status = 'active' AND end_at <= ?", nowIso()).changes;
}

function getActiveSubscription(userId) {
  const s = one(`SELECT s.*, p.name AS plan_name, p.tier, p.color, p.duration_days, p.price_halalas
                 FROM subscriptions s JOIN plans p ON p.id = s.plan_id
                 WHERE s.user_id = ? AND s.status IN ('active','suspended') ORDER BY s.id DESC LIMIT 1`, userId);
  if (s && s.status === 'active' && s.end_at <= nowIso()) {
    run("UPDATE subscriptions SET status = 'expired', updated_at = datetime('now') WHERE id = ?", s.id);
    return null;
  }
  return s || null;
}

function getFreePlan() {
  return one('SELECT * FROM plans WHERE is_free = 1 AND is_active = 1 AND is_deleted = 0 ORDER BY tier LIMIT 1') || null;
}

/** الباقة الفعلية للمستخدم: الاشتراك الفعّال أو الباقة المجانية الافتراضية */
function getEffectivePlan(userId) {
  const sub = getActiveSubscription(userId);
  if (sub && sub.status === 'active') {
    const plan = one('SELECT * FROM plans WHERE id = ?', sub.plan_id);
    return { plan, subscription: sub };
  }
  return { plan: getFreePlan(), subscription: sub }; // sub قد يكون موقوفًا
}

function planFeatureKeys(planId) {
  if (!planId) return [];
  return all(`SELECT f.key FROM plan_features pf JOIN features f ON f.id = pf.feature_id WHERE pf.plan_id = ? AND f.is_enabled = 1`, planId).map((r) => r.key);
}

/** المميزات الموقوفة من الإدارة (لا يحصل عليها أحد مهما كانت باقته) */
function disabledFeatures() { return all('SELECT key FROM features WHERE is_enabled = 0').map((r) => r.key); }
const enabledFeatureKeys = () => all('SELECT key FROM features WHERE is_enabled = 1').map((r) => r.key);

/** مجموعة مفاتيح المميزات المتاحة للمستخدم */
function getEntitlements(user) {
  if (!user) return new Set();
  // الإدارة ترى كل المميزات المفعّلة
  if (user.role === 'admin' || user.role === 'moderator') {
    return new Set(enabledFeatureKeys());
  }
  if (!systemEnabled()) {
    if (offMode() === 'free_all') return new Set(enabledFeatureKeys());
    const free = getFreePlan();
    return new Set(planFeatureKeys(free && free.id));
  }
  const { plan } = getEffectivePlan(user.id);
  return new Set(planFeatureKeys(plan && plan.id));
}

/** Middleware: يتحقق من امتلاك المستخدم ميزة معينة من الخادم */
function requireFeature(key) {
  return (req, _res, next) => {
    req.entitlements = req.entitlements || getEntitlements(req.user);
    if (!req.entitlements.has(key)) {
      const f = one('SELECT name, is_enabled FROM features WHERE key = ?', key);
      if (f && !f.is_enabled) return next(forbidden(`ميزة (${f.name}) متوقفة حاليًا`, 'feature_disabled'));
      return next(forbidden(`هذه الميزة (${f ? f.name : key}) غير متاحة في باقتك الحالية، قم بالترقية للاستفادة منها`, 'feature_locked'));
    }
    next();
  };
}

function getPlan(planId, { mustBeActive = false } = {}) {
  const p = one('SELECT * FROM plans WHERE id = ? AND is_deleted = 0', planId);
  if (!p) throw notFound('الباقة غير موجودة');
  if (mustBeActive && !p.is_active) throw bad('هذه الباقة غير متاحة حاليًا');
  return p;
}

/**
 * تحديد نوع العملية المسموحة للمستخدم على باقة معينة
 * new: لا يوجد اشتراك فعّال | renew: نفس الباقة | upgrade/downgrade: باقة مختلفة
 */
function purposeFor(userId, plan) {
  const cur = getActiveSubscription(userId);
  if (cur && cur.status === 'suspended') throw forbidden('اشتراكك موقوف، تواصل مع الإدارة');
  if (!cur) return 'new';
  if (cur.plan_id === plan.id) return 'renew';
  const curPlan = one('SELECT tier FROM plans WHERE id = ?', cur.plan_id);
  return plan.tier > (curPlan ? curPlan.tier : -1) ? 'upgrade' : 'downgrade';
}

/**
 * تطبيق اشتراك (بعد دفع موثّق أو بشكل يدوي من الإدارة) - داخل معاملة ذرية
 * - تجديد: يمدد تاريخ الانتهاء من نهاية الاشتراك الحالي
 * - ترقية/تخفيض/جديد: يبدأ اشتراك جديد الآن ويُغلق السابق بحالة replaced
 */
function applySubscription({ userId, planId, purpose, source, paymentId = null, createdBy = null, days = null, notes = null, startAt = null }) {
  return tx(() => {
    const plan = getPlan(planId);
    if (plan.is_free) throw bad('لا حاجة للاشتراك في الباقة المجانية');
    const duration = days || plan.duration_days;
    const cur = getActiveSubscription(userId);

    if (purpose === 'renew' && cur && cur.plan_id === plan.id) {
      const base = cur.end_at > nowIso() ? cur.end_at : nowIso();
      const newEnd = addDays(base, duration);
      run("UPDATE subscriptions SET end_at = ?, status = 'active', updated_at = datetime('now'), payment_id = COALESCE(?, payment_id), notes = COALESCE(?, notes) WHERE id = ?",
        newEnd, paymentId, notes, cur.id);
      return one('SELECT * FROM subscriptions WHERE id = ?', cur.id);
    }

    const start = startAt || nowIso();
    if (cur) run("UPDATE subscriptions SET status = 'replaced', updated_at = datetime('now') WHERE id = ?", cur.id);
    const r = run(`INSERT INTO subscriptions (user_id, plan_id, status, start_at, end_at, source, payment_id, created_by, notes)
                   VALUES (?,?,'active',?,?,?,?,?,?)`,
      userId, plan.id, start, addDays(start, duration), source, paymentId, createdBy, notes);
    if (cur) run('UPDATE subscriptions SET replaced_by = ? WHERE id = ?', r.lastInsertRowid, cur.id);
    return one('SELECT * FROM subscriptions WHERE id = ?', r.lastInsertRowid);
  });
}

function setSubscriptionStatus(subId, status) {
  const s = one('SELECT * FROM subscriptions WHERE id = ?', subId);
  if (!s) throw notFound('الاشتراك غير موجود');
  if (!['active', 'suspended', 'cancelled'].includes(status)) throw bad('حالة غير صالحة');
  if (status === 'active') {
    if (s.end_at <= nowIso()) throw bad('الاشتراك منتهٍ، استخدم التجديد');
    const other = one("SELECT id FROM subscriptions WHERE user_id = ? AND status IN ('active','suspended') AND id <> ?", s.user_id, s.id);
    if (other) throw conflict('لدى المستخدم اشتراك آخر فعّال');
  }
  run("UPDATE subscriptions SET status = ?, updated_at = datetime('now') WHERE id = ?", status, subId);
  return one('SELECT * FROM subscriptions WHERE id = ?', subId);
}

module.exports = {
  nowIso, addDays, expireDue, getActiveSubscription, getEffectivePlan, getFreePlan, planFeatureKeys,
  getEntitlements, requireFeature, getPlan, purposeFor, applySubscription, setSubscriptionStatus,
  disabledFeatures, OFF_MODES, systemEnabled, offMode, systemState, assertSystemEnabled, extendForPause,
};
