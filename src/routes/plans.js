'use strict';
/** صفحة الباقات والاشتراكات (عامة) */
const express = require('express');
const { all } = require('../db');
const { h } = require('../lib/http');
const subs = require('../lib/subscriptions');

const r = express.Router();

r.get('/', h((req, res) => {
  const system = subs.systemState();
  if (!system.enabled) return res.json({ enabled: false, off_mode: system.off_mode, plans: [], features: [], current: null });
  const plans = all('SELECT id, name, description, price_halalas, currency, duration_days, is_free, tier, color FROM plans WHERE is_active = 1 AND is_deleted = 0 ORDER BY tier, price_halalas');
  const features = all('SELECT id, key, name, description FROM features WHERE is_enabled = 1 ORDER BY sort_order, id');
  const pf = all('SELECT plan_id, feature_id FROM plan_features');
  let current = null;
  if (req.user) {
    const { plan, subscription } = subs.getEffectivePlan(req.user.id);
    current = { plan_id: plan ? plan.id : null, subscription_status: subscription ? subscription.status : null, end_at: subscription ? subscription.end_at : null };
  }
  res.json({
    enabled: true,
    plans: plans.map((p) => {
      const out = { ...p, feature_ids: pf.filter((x) => x.plan_id === p.id).map((x) => x.feature_id) };
      if (req.user && !p.is_free) {
        try { out.action = subs.purposeFor(req.user.id, p); } catch { out.action = null; }
      }
      return out;
    }),
    features,
    current,
  });
}));

module.exports = r;
