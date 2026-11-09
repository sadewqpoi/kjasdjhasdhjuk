'use strict';
const { one, getSetting, STAFF_PERMISSIONS } = require('../db');
const subs = require('./subscriptions');
const tree = require('./tree');
const wa = require('./whatsapp');
const vm = require('./verify-methods');

function isStaff(u) { return u && (u.role === 'admin' || u.role === 'moderator'); }

/** هل يحق للمستخدم الدخول إلى المشجرة (بغض النظر عن الباقة) */
function treeGate(u) {
  if (!u) return { ok: false, reason: 'auth_required' };
  if (isStaff(u)) return { ok: true };
  if (!u.phone_verified_at) return { ok: false, reason: 'phone_unverified' };
  if (getSetting('require_link_for_tree', '1') === '1' && !u.person_id) return { ok: false, reason: 'link_required' };
  return { ok: true };
}

function build(u) {
  const otp = { methods: vm.available(), wa_dev: wa.devMode() };
  const plans_enabled = subs.systemEnabled();
  const modules = require('./modules').states();
  if (!u) return { user: null, site_name: getSetting('site_name'), otp, plans_enabled, modules };
  const { plan, subscription } = subs.getEffectivePlan(u.id);
  const ent = subs.getEntitlements(u);
  return {
    otp,
    plans_enabled,
    modules,
    site_name: getSetting('site_name'),
    user: {
      id: u.id,
      membership_no: u.membership_no,
      full_name: u.full_name,
      phone: u.phone,
      phone_verified: !!u.phone_verified_at,
      verify_requested: !!u.verify_requested_at,
      has_photo: !!u.photo_file,
      role: u.role,
      person_id: u.person_id,
      person_full_name: u.person_id ? tree.fullName(u.person_id, 6) : null,
      privacy: { photo: u.privacy_photo, phone: u.privacy_phone, birth: u.privacy_birth },
    },
    link_request: one("SELECT id, person_id, status, admin_note, created_at FROM link_requests WHERE user_id = ? ORDER BY id DESC LIMIT 1", u.id) || null,
    addition_request: one("SELECT id, name, status, admin_note, created_at FROM addition_requests WHERE user_id = ? ORDER BY id DESC LIMIT 1", u.id) || null,
    plan: plan ? { id: plan.id, name: plan.name, tier: plan.tier, color: plan.color, is_free: !!plan.is_free } : null,
    subscription: subscription ? {
      id: subscription.id, status: subscription.status, start_at: subscription.start_at, end_at: subscription.end_at, plan_name: subscription.plan_name,
    } : null,
    features: [...ent],
    disabled_features: subs.disabledFeatures(),
    permissions: u.role === 'admin' ? Object.keys(STAFF_PERMISSIONS).concat('staff.manage', 'settings.manage')
      : u.role === 'moderator' ? [...(u.permissions || [])] : [],
    tree_access: treeGate(u),
  };
}

module.exports = { build, treeGate, isStaff };
