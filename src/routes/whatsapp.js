'use strict';
/** Webhook واتساب (WhatsApp Cloud API من Meta) لاستقبال رسائل التحقق */
const express = require('express');
const config = require('../config');
const { one } = require('../db');
const { h, bad, int, notFound } = require('../lib/http');
const wa = require('../lib/whatsapp');

const r = express.Router();

/** خطوة التحقق التي تطلبها Meta عند تسجيل رابط الـ Webhook */
r.get('/webhook', (req, res) => {
  const q = req.query;
  const token = require('../lib/verify-methods').wa().verifyToken;
  if (q['hub.mode'] === 'subscribe' && token && q['hub.verify_token'] === token) {
    return res.status(200).type('text/plain').send(String(q['hub.challenge'] || ''));
  }
  res.sendStatus(403);
});

/** الرسائل الواردة */
r.post('/webhook', (req, res) => {
  if (!wa.validSignature(req.rawBody, req.get('X-Hub-Signature-256'))) return res.sendStatus(401);
  res.sendStatus(200); // Meta تتوقع ردًا سريعًا
  try {
    for (const entry of (req.body && req.body.entry) || []) {
      for (const change of entry.changes || []) {
        for (const msg of (change.value && change.value.messages) || []) {
          const body = msg.type === 'text' ? msg.text && msg.text.body : msg.button ? msg.button.text : '';
          const row = wa.handleIncoming(msg.from, body);
          if (row) wa.reply(msg.from, row.purpose === 'reset_password'
            ? 'تم التحقق. ارجع إلى المنصة لتعيين كلمة مرور جديدة.'
            : 'تم تفعيل رقمك بنجاح. ارجع إلى المنصة لإكمال التسجيل.');
        }
      }
    }
  } catch (e) { console.error('WhatsApp webhook error:', e); }
});

/** محاكاة إرسال الرسالة — للتطوير فقط عندما لا يوجد رقم واتساب حقيقي */
r.post('/dev-simulate', h((req, res) => {
  if (!wa.devMode()) throw notFound();
  const row = one("SELECT * FROM wa_verifications WHERE id = ? AND status = 'pending'", int(req.body && req.body.rid, 'الطلب'));
  if (!row) throw bad('الطلب غير موجود أو انتهى');
  wa.markVerified(row);
  res.json({ ok: true });
}));

module.exports = r;
