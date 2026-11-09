'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const config = require('../config');
const { bad } = require('./http');

const AVATARS = path.join(config.uploadsDir, 'avatars');
fs.mkdirSync(AVATARS, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 } });

/** فحص نوع الصورة من محتواها الفعلي (وليس من الامتداد) */
function detectImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function saveAvatar(file) {
  if (!file) throw bad('الصورة الشخصية مطلوبة');
  const ext = detectImage(file.buffer);
  if (!ext) throw bad('صيغة الصورة غير مدعومة (JPG أو PNG أو WEBP)');
  const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(AVATARS, name), file.buffer);
  return name;
}

function removeAvatar(name) {
  if (!name || !/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(name)) return;
  fs.rm(path.join(AVATARS, name), { force: true }, () => {});
}

function avatarPath(name) {
  if (!name || !/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(name)) return null;
  return path.join(AVATARS, name);
}

// ---- صور الصفحة الرئيسية (اللافتات وأيقونات المربعات) ----
const HOME = path.join(config.uploadsDir, 'home');
fs.mkdirSync(HOME, { recursive: true });
const uploadMedia = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024, files: 1 } });
const MEDIA_RE = /^[a-f0-9]{32}\.(jpg|png|webp)$/;

function saveMedia(file) {
  if (!file) return null;
  const ext = detectImage(file.buffer);
  if (!ext) throw bad('صيغة الصورة غير مدعومة (JPG أو PNG أو WEBP)');
  const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(HOME, name), file.buffer);
  return name;
}
function removeMedia(name) {
  if (name && MEDIA_RE.test(name)) fs.rm(path.join(HOME, name), { force: true }, () => {});
}
function mediaPath(name) {
  return name && MEDIA_RE.test(name) ? path.join(HOME, name) : null;
}

// ---- إيصالات التحويل البنكي (لا تُعرض إلا لصاحبها وللإدارة) ----
const RECEIPTS = path.join(config.uploadsDir, 'receipts');
fs.mkdirSync(RECEIPTS, { recursive: true });
function saveReceipt(file) {
  if (!file) return null;
  const ext = detectImage(file.buffer);
  if (!ext) throw bad('صيغة الإيصال غير مدعومة (JPG أو PNG أو WEBP)');
  const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(RECEIPTS, name), file.buffer);
  return name;
}
const receiptPath = (name) => (name && MEDIA_RE.test(name) ? path.join(RECEIPTS, name) : null);

module.exports = { upload, saveAvatar, removeAvatar, avatarPath, uploadMedia, saveMedia, removeMedia, mediaPath, saveReceipt, receiptPath };
