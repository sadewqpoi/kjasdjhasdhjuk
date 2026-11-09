'use strict';
/**
 * اختبار شامل للتدفقات الرئيسية عبر HTTP على قاعدة بيانات مؤقتة.
 *   node scripts/smoke-test.js "مسار ملف المشجرة.xlsx"
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-test-'));
const PORT = 3999;
Object.assign(process.env, {
  DATA_DIR: tmp, DB_FILE: path.join(tmp, 'test.db'), UPLOADS_DIR: path.join(tmp, 'uploads'), PORT: String(PORT),
  PUBLIC_URL: `http://localhost:${PORT}`, NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock', SMS_PROVIDER: 'console',
  OTP_CHANNEL: 'whatsapp', WHATSAPP_NUMBER: '966500000099', WHATSAPP_APP_SECRET: 'test-app-secret', WHATSAPP_VERIFY_TOKEN: 'test-verify',
  WA_BOT_DRIVER: 'mock',
});
const crypto = require('node:crypto');
const intl = (p) => '966' + p.replace(/^0/, '');
/** إرسال رسالة واتساب واردة موقّعة كما ترسلها Meta */
async function waIncoming(from, text, secret = 'test-app-secret') {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messages: [{ from, type: 'text', text: { body: text } }] } }] }] });
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  const r = await fetch(`${BASE}/api/whatsapp/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body });
  await new Promise((ok) => setTimeout(ok, 30));
  return r.status;
}
const xlsx = process.argv[2] || 'E:\\mjr\\شجرة فرع سليمان العلاط.xlsx';
execFileSync(process.execPath, [path.join(__dirname, 'import-excel.js'), xlsx], { env: process.env, stdio: 'inherit' });
execFileSync(process.execPath, [path.join(__dirname, 'create-admin.js'), '0500000001', 'Admin12345', 'مدير النظام'], { env: process.env, stdio: 'inherit' });

const origLog = console.log;
console.log = (...a) => { if (!String(a[0]).startsWith('[SMS')) origLog(...a); };
const app = require('../src/server');
const { one, run } = require('../src/db');

const BASE = `http://localhost:${PORT}`;
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201e2b0a0e10000000049454e44ae426082', 'hex');

function client() {
  let cookie = '';
  async function call(method, p, { body, form, raw = false, headers = {} } = {}) {
    const h = { 'X-Requested-With': 'fetch', ...headers };
    if (cookie) h.Cookie = cookie;
    let payload;
    if (form) payload = form; else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const res = await fetch(BASE + p, { method, headers: h, body: payload, redirect: 'manual' });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    if (raw) return res;
    const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  }
  return { call, get: (p, o) => call('GET', p, o), post: (p, b, o) => call('POST', p, { body: b, ...o }), put: (p, b) => call('PUT', p, { body: b }), del: (p) => call('DELETE', p) };
}

async function register(c, name, phone) {
  const fd = new FormData();
  fd.append('full_name', name); fd.append('phone', phone);
  fd.append('password', 'Test12345'); fd.append('password_confirm', 'Test12345');
  fd.append('photo', new Blob([PNG], { type: 'image/png' }), 'me.png');
  const r = await c.call('POST', '/api/auth/register', { form: fd });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  // التحقق عبر واتساب: العضو يرسل الرسالة الجاهزة من رقمه إلى رقم الصندوق
  const s = await c.post('/api/auth/otp/whatsapp/start');
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.ok(s.data.wa_link.startsWith('https://wa.me/966500000099?text='));
  assert.equal(await waIncoming(intl(phone), s.data.text), 200);
  assert.equal((await c.get(`/api/auth/otp/whatsapp/status?rid=${s.data.rid}`)).data.status, 'verified');
  return r.data;
}

async function pay(c, planId, outcome = 'pay') {
  const co = await c.post('/api/payments/checkout', { plan_id: planId });
  assert.equal(co.status, 200, JSON.stringify(co.data));
  const ref = new URL(co.data.redirect_url, BASE).searchParams.get('ref');
  const g = await c.post(`/api/payments/mock-gateway/${ref}`, { outcome, method: 'mada' });
  const ret = await c.call('GET', new URL(g.data.return_url).pathname + new URL(g.data.return_url).search, { raw: true });
  assert.equal(ret.status, 303);
  return (await c.get(`/api/payments/${co.data.payment_id}`)).data;
}

let passed = 0;
const ok = (msg) => { passed++; origLog('  ✔', msg); };

(async () => {
  const server = app.listen(PORT);
  try {
    const A = client(); const B = client(); const ADM = client();
    const target = one("SELECT id FROM persons WHERE code = '70590'"); // أصيل بن عبدالعزيز

    // ---------- CSRF ----------
    const csrf = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(csrf.status, 403); ok('رفض الطلبات بدون ترويسة الحماية (CSRF)');

    // ---------- التسجيل والتحقق ----------
    // ---------- التحقق عبر واتساب: الحالات الخاطئة ----------
    const W = client();
    const fdW = new FormData();
    for (const [k, v] of Object.entries({ full_name: 'خالد عبدالعزيز عبدالكريم', phone: '0554444444', password: 'Test12345', password_confirm: 'Test12345' })) fdW.append(k, v);
    fdW.append('photo', new Blob([PNG], { type: 'image/png' }), 'me.png');
    assert.equal((await W.call('POST', '/api/auth/register', { form: fdW })).status, 201);
    const ws = (await W.post('/api/auth/otp/whatsapp/start')).data;
    assert.equal(await waIncoming(intl('0559999999'), ws.text), 200);           // من رقم آخر
    assert.equal(await waIncoming(intl('0554444444'), 'الرمز: 000000'), 200);   // رمز خاطئ
    assert.equal(await waIncoming(intl('0554444444'), ws.text, 'wrong-secret'), 401); // توقيع مزوّر
    assert.equal((await W.get('/api/auth/me')).data.user.phone_verified, false);
    assert.equal((await W.post('/api/whatsapp/dev-simulate', { rid: ws.rid })).status, 404);
    const chal = await fetch(`${BASE}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=abc123`);
    assert.equal(await chal.text(), 'abc123');
    assert.equal((await fetch(`${BASE}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1`)).status, 403);
    ok('واتساب: رفض رقم مرسل مختلف ورمز خاطئ وتوقيع مزوّر، وتسجيل الـ Webhook');

    const regA = await register(A, 'أصيل عبدالعزيز عبدالكريم', '0551111111');
    assert.match(regA.membership_no, /^AL-\d+$/); ok(`تسجيل المستخدم والتحقق من الجوال (${regA.membership_no})`);
    const dup = await client().call('POST', '/api/auth/register', { form: (() => { const f = new FormData(); f.append('full_name', 'س ص ع ل'); f.append('phone', '0551111111'); f.append('password', 'Test12345'); f.append('password_confirm', 'Test12345'); f.append('photo', new Blob([PNG]), 'a.png'); return f; })() });
    assert.equal(dup.status, 409); ok('منع تكرار رقم الجوال');

    // ---------- الربط ----------
    const cand = await A.get('/api/link/candidates?name=' + encodeURIComponent('أصيل عبدالعزيز عبدالكريم'));
    assert.equal(cand.data.results[0].id, target.id); assert.equal(cand.data.results[0].score, 3); ok('ظهور الاسم الصحيح أولًا في نتائج المطابقة');
    let t = await A.get('/api/tree');
    assert.equal(t.status, 403); assert.equal(t.data.code, 'link_required'); ok('منع الوصول للمشجرة قبل اعتماد الربط');
    const lr = await A.post('/api/link/requests', { person_id: target.id });
    assert.equal(lr.status, 201); assert.equal(lr.data.linked, true);
    assert.equal((await A.get('/api/auth/me')).data.user.person_id, target.id); ok('الربط فوري بدون انتظار موافقة الإدارة');
    assert.equal((await A.post('/api/link/requests', { person_id: target.id })).status, 409); ok('لا يمكن الربط مرة ثانية بعد ربط الحساب');

    await register(B, 'أصيل عبدالعزيز عبدالكريم', '0552222222');
    const lrB = await B.post('/api/link/requests', { person_id: target.id });
    assert.equal(lrB.status, 409); assert.equal(lrB.data.code, 'person_taken');
    assert.equal((await B.get('/api/auth/me')).data.user.person_id, null); ok('منع ربط نفس الاسم بأكثر من حساب');

    // ---------- الإدارة ----------
    assert.equal((await ADM.post('/api/auth/login', { phone: '0500000001', password: 'Admin12345' })).status, 200);
    assert.equal((await A.get('/api/admin/stats')).status, 403); ok('منع المستخدم العادي من لوحة الإدارة');
    const done = (await ADM.get('/api/admin/link-requests?status=approved')).data.items;
    assert.ok(done.some((x) => x.id === lr.data.id)); ok('الربط التلقائي مسجّل ويظهر للإدارة');

    // ---------- الباقة المجانية ----------
    t = await A.get('/api/tree');
    assert.equal(t.status, 200); assert.ok(t.data.nodes.length > 500); assert.equal(t.data.me, target.id); ok(`عرض المشجرة بعد الربط (${t.data.nodes.length} فرد)`);
    let card = (await A.get(`/api/persons/${target.id}`)).data;
    assert.ok(card.locked.includes('person.dates')); assert.equal(card.birth_date, undefined); ok('إخفاء التواريخ في الباقة المجانية من الخادم');
    assert.equal((await A.get('/api/tree/stats')).data.code, 'feature_locked'); ok('حجب الإحصائيات (ميزة مدفوعة) من الخادم');

    // ---------- الدفع ----------
    const plans = (await A.get('/api/plans')).data.plans;
    const silver = plans.find((p) => p.tier === 1); const gold = plans.find((p) => p.tier === 2);
    assert.equal(silver.action, 'new');
    const failed = await pay(A, silver.id, 'fail');
    assert.equal(failed.status, 'failed'); assert.equal((await A.get('/api/tree/stats')).status, 403); ok('فشل الدفع لا يفعّل الاشتراك');
    const co = await A.post('/api/payments/checkout', { plan_id: silver.id });
    const r0 = await A.get(`/api/payments/${co.data.payment_id}`);
    assert.equal(r0.data.status, 'initiated'); ok('الضغط على زر الدفع وحده لا يفعّل الاشتراك');
    const paid = await pay(A, silver.id);
    assert.equal(paid.status, 'paid');
    assert.equal((await A.get('/api/tree/stats')).status, 200); ok('تفعيل الباقة الفضية بعد تحقق الخادم من الدفع');
    card = (await A.get(`/api/persons/${target.id}`)).data;
    assert.ok(!card.locked.includes('person.dates')); assert.equal((await A.get(`/api/tree/relationship?a=1&b=2`)).status, 403); ok('صلاحيات الفضية: تواريخ نعم، حاسبة القرابة لا');

    let acc = (await A.get('/api/account')).data;
    const end1 = acc.subscription.end_at;
    assert.equal((await A.get('/api/plans')).data.plans.find((p) => p.id === silver.id).action, 'renew');
    await pay(A, silver.id);
    acc = (await A.get('/api/account')).data;
    assert.ok(Date.parse(acc.subscription.end_at) - Date.parse(end1) > 364 * 864e5); ok('التجديد يمدد تاريخ الانتهاء');
    const up = await pay(A, gold.id);
    assert.equal(up.purpose, 'upgrade'); assert.equal((await A.get(`/api/tree/relationship?a=${target.id}&b=2`)).status, 200); ok('الترقية للذهبية تفتح حاسبة القرابة');
    acc = (await A.get('/api/account')).data;
    assert.equal(acc.subscriptions.filter((s) => s.status === 'active').length, 1); assert.equal(acc.payments.filter((p) => p.status === 'paid').length, 3); ok('اشتراك فعّال واحد وسجل مدفوعات صحيح');

    // ---------- التحكم بالمميزات من لوحة الإدارة ----------
    const feats = (await ADM.get('/api/admin/plans')).data;
    const goldPlan = feats.items.find((p) => p.id === gold.id);
    const relId = feats.features.find((f) => f.key === 'tree.relationship').id;
    await ADM.put(`/api/admin/plans/${gold.id}`, { feature_ids: goldPlan.feature_ids.filter((x) => x !== relId), price: 250, name: 'الذهبية المحدّثة' });
    assert.equal((await A.get(`/api/tree/relationship?a=${target.id}&b=2`)).status, 403);
    const g2 = (await A.get('/api/plans')).data.plans.find((p) => p.id === gold.id);
    assert.equal(g2.price_halalas, 25000); assert.equal(g2.name, 'الذهبية المحدّثة'); ok('تعديل مميزات/سعر/اسم الباقة من الإدارة يُطبَّق فورًا في الخادم');

    // ---------- إدارة الاشتراكات ----------
    const bUser = one("SELECT id FROM users WHERE phone = '966552222222'");
    const man = await ADM.post('/api/admin/subscriptions', { user_id: bUser.id, plan_id: silver.id, days: 10, notes: 'اختبار' });
    assert.equal(man.status, 201);
    const exp = (await ADM.get('/api/admin/subscriptions?filter=expiring')).data;
    assert.ok(exp.items.some((s) => s.user_id === bUser.id)); ok('اشتراك يدوي + ظهوره في "قاربت على الانتهاء"');
    const ch = await ADM.post(`/api/admin/subscriptions/${man.data.id}/change-plan`, { plan_id: gold.id });
    assert.equal(ch.status, 200); assert.equal(ch.data.end_at, man.data.end_at); ok('ترقية يدوية مع الاحتفاظ بتاريخ الانتهاء');
    const sus = await ADM.post(`/api/admin/subscriptions/${ch.data.id}/status`, { status: 'suspended' });
    assert.equal(sus.data.status, 'suspended'); ok('إيقاف الاشتراك');
    assert.equal((await ADM.del(`/api/admin/plans/${gold.id}`)).status, 409); ok('منع حذف باقة عليها مشتركون');

    // ---------- طلب إضافة اسم ----------
    const C = client(); await register(C, 'مازن عبدالعزيز عبدالكريم', '0553333333');
    const father = one("SELECT father_id FROM persons WHERE id = ?", target.id).father_id;
    const ad = await C.post('/api/link/additions', { name: 'مازن', father_id: father, gender: 'male' });
    assert.equal(ad.status, 201);
    const apr = await ADM.post(`/api/admin/addition-requests/${ad.data.id}/approve`, {});
    assert.equal(apr.status, 200);
    const cMe = (await C.get('/api/auth/me')).data;
    assert.equal(cMe.user.person_id, apr.data.person_id); assert.match(cMe.user.person_full_name, /^مازن بن عبدالعزيز/); ok('طلب إضافة اسم جديد والموافقة عليه وربطه');

    // ---------- الخصوصية والصور ----------
    assert.equal((await C.get(`/api/persons/${target.id}/photo`)).status, 403); ok('حجب الصور عن الباقة المجانية');
    await A.put('/api/account/privacy', { photo: 'none', phone: 'none', birth: 'none' });
    assert.equal((await ADM.get(`/api/persons/${target.id}/photo`)).status, 200);
    ok('الإدارة ترى الصور؛ المستخدم يتحكم بخصوصيته');

    // ---------- المشرفون ----------
    await ADM.put(`/api/admin/staff/${bUser.id}`, { role: 'moderator', permissions: ['requests.review'] });
    assert.equal((await B.get('/api/admin/link-requests')).status, 200);
    assert.equal((await B.get('/api/admin/payments')).status, 403); ok('صلاحيات المشرف محدودة بما منحه المدير');

    // ---------- الاجتماعات ----------
    const dt = (days) => new Date(Date.now() + 3 * 3600e3 + days * 864e5).toISOString().slice(0, 16);
    assert.equal((await B.post('/api/admin/events', { title: 'اختبار', starts_at: dt(5) })).status, 403);
    assert.equal((await A.post('/api/admin/events', { title: 'اختبار', starts_at: dt(5) })).status, 403);
    const ev = await ADM.post('/api/admin/events', { title: 'اجتماع العائلة السنوي', starts_at: dt(5), location: 'بريدة', map_url: 'https://maps.google.com/?q=1' });
    assert.equal(ev.status, 201);
    await ADM.post('/api/admin/events', { title: 'مسودة لم تُنشر', starts_at: dt(6), is_published: 0 });
    const evPast = await ADM.post('/api/admin/events', { title: 'اجتماع سابق', starts_at: dt(-10) });
    assert.equal((await ADM.post('/api/admin/events', { title: 'رابط خطير', starts_at: dt(3), map_url: 'javascript:alert(1)' })).status, 400);
    let evs = (await C.get('/api/events')).data.items;
    assert.equal(evs.length, 1); assert.equal(evs[0].title, 'اجتماع العائلة السنوي'); ok('الأعضاء يرون الاجتماعات القادمة المنشورة فقط');
    assert.equal((await C.get('/api/events?scope=past')).data.items[0].id, evPast.data.id);
    const rs = await C.put(`/api/events/${ev.data.id}/rsvp`, { status: 'yes' });
    assert.equal(rs.data.going, 1); assert.equal(rs.data.my_rsvp, 'yes');
    await A.put(`/api/events/${ev.data.id}/rsvp`, { status: 'maybe' });
    await C.put(`/api/events/${ev.data.id}/rsvp`, { status: 'no' });
    evs = (await A.get('/api/events')).data.items;
    assert.equal(evs[0].going, 0); assert.equal(evs[0].maybe, 1); assert.equal(evs[0].my_rsvp, 'maybe');
    assert.equal((await ADM.get(`/api/admin/events/${ev.data.id}/rsvps`)).data.items.length, 2); ok('تأكيد الحضور وتغييره وقائمة الحضور للإدارة');
    assert.equal((await C.put(`/api/events/${evPast.data.id}/rsvp`, { status: 'yes' })).status, 400); ok('لا يمكن تأكيد حضور اجتماع منتهٍ');

    // ---------- الاقتراحات والاستفسارات ----------
    const fb = await C.post('/api/feedback', { type: 'inquiry', subject: 'موعد الاجتماع', message: 'هل الاجتماع للعائلات أيضًا؟' });
    assert.equal(fb.status, 201);
    assert.equal((await C.post('/api/feedback', { type: 'other', subject: 'xxx', message: 'yyyyy' })).status, 400);
    assert.equal((await C.get('/api/admin/feedback')).status, 403);
    const fbList = (await ADM.get('/api/admin/feedback?status=new')).data;
    assert.ok(fbList.items.some((x) => x.id === fb.data.id)); assert.equal(fbList.counts.new, 1);
    assert.equal((await ADM.post(`/api/admin/feedback/${fb.data.id}/reply`, { reply: 'نعم، الدعوة عامة للجميع' })).status, 200);
    const mine = (await C.get('/api/feedback')).data.items;
    assert.equal(mine[0].status, 'answered'); assert.equal(mine[0].reply, 'نعم، الدعوة عامة للجميع');
    assert.equal((await A.get('/api/feedback')).data.items.length, 0); ok('إرسال استفسار والرد عليه، وكل عضو يرى رسائله فقط');

    // ---------- الصفحة الرئيسية ----------
    const fb2 = await C.post('/api/feedback', { type: 'suggestion', subject: 'اقتراح نشاط', message: 'رحلة عائلية في الربيع' });
    await ADM.post(`/api/admin/feedback/${fb2.data.id}/reply`, { reply: 'فكرة جميلة' });
    let home = (await C.get('/api/home')).data;
    assert.equal(home.gender, 'male'); assert.ok(home.stats.persons > 500); assert.ok(home.stats.generations >= 6);
    assert.equal(home.next_event.id, ev.data.id); assert.equal(home.notifications.replies.length, 1);
    await C.get('/api/feedback');
    home = (await C.get('/api/home')).data;
    assert.equal(home.notifications.replies.length, 0); ok('الصفحة الرئيسية: الإحصائيات والاجتماع القادم والإشعارات');
    // ---------- إدارة الصفحة الرئيسية ----------
    assert.equal((await C.get('/api/admin/home')).status, 403);
    const form = (o, img) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); if (img) f.append('image', new Blob([img]), 'x.png'); return f; };
    const call = (cl, method, p, o, img) => cl.call(method, p, { form: form(o, img) });
    assert.equal((await call(ADM, 'POST', '/api/admin/home/banners', { title: 'x', link: 'javascript:alert(1)' })).status, 400);
    const bn = await call(ADM, 'POST', '/api/admin/home/banners', { title: 'لافتة بصورة', link: '#/events' }, PNG);
    assert.equal(bn.status, 201);
    home = (await C.get('/api/home')).data;
    const myBanner = home.banners.find((b) => b.id === bn.data.id);
    assert.ok(myBanner && myBanner.image.startsWith('/api/home/media/'));
    assert.equal((await C.get(myBanner.image)).status, 200);
    assert.equal((await client().get(myBanner.image)).status, 401); ok('رفع صورة لافتة وعرضها للأعضاء فقط');
    const tl = await call(ADM, 'POST', '/api/admin/home/tiles', { label: 'الحسابات البنكية', icon: 'bank', link: 'https://example.com/bank' });
    assert.equal(tl.status, 201);
    const adminHome = (await ADM.get('/api/admin/home')).data;
    const treeTile = adminHome.tiles.find((t) => t.key === 'tree');
    await call(ADM, 'PUT', `/api/admin/home/tiles/${treeTile.id}`, { label: 'شجرة العائلة', icon: 'tree', is_visible: '1' });
    const evTile = adminHome.tiles.find((t) => t.key === 'events');
    await call(ADM, 'PUT', `/api/admin/home/tiles/${evTile.id}`, { label: evTile.label, icon: 'events', is_visible: '0' });
    assert.equal((await ADM.del(`/api/admin/home/tiles/${treeTile.id}`)).status, 400);
    const ids = adminHome.tiles.map((t) => t.id).concat(tl.data.id);
    await ADM.post('/api/admin/home/reorder', { type: 'tiles', ids: [tl.data.id, ...ids.filter((x) => x !== tl.data.id)] });
    home = (await C.get('/api/home')).data;
    assert.equal(home.tiles[0].label, 'الحسابات البنكية');
    assert.ok(home.tiles.some((t) => t.label === 'شجرة العائلة'));
    assert.ok(!home.tiles.some((t) => t.key === 'events'));
    assert.ok(!home.tiles.some((t) => t.key === 'admin') && !home.tiles.some((t) => t.key === 'link'));
    assert.equal((await ADM.del(`/api/admin/home/tiles/${tl.data.id}`)).status, 200);
    await ADM.put('/api/admin/home/sections', { home_show_stats: 0 });
    assert.equal((await C.get('/api/home')).data.sections.stats, false);
    ok('إضافة وتعديل وإخفاء وترتيب وحذف مربعات الرئيسية وأقسامها');

    // ---------- استعادة كلمة المرور عبر واتساب ----------
    const R = client();
    const fg = (await R.post('/api/auth/password/forgot', { phone: '0553333333' })).data;
    assert.equal(fg.channel, 'wa_reverse');
    assert.equal((await R.post('/api/auth/password/reset', { phone: '0553333333', rid: fg.rid, password: 'NewPass123' })).status, 400);
    await waIncoming(intl('0553333333'), fg.text);
    assert.equal((await R.get(`/api/auth/password/whatsapp-status?rid=${fg.rid}&phone=0553333333`)).data.status, 'verified');
    assert.equal((await R.post('/api/auth/password/reset', { phone: '0553333333', rid: fg.rid, password: 'NewPass123' })).status, 200);
    assert.equal((await R.post('/api/auth/password/reset', { phone: '0553333333', rid: fg.rid, password: 'Other1234' })).status, 400);
    assert.equal((await R.post('/api/auth/login', { phone: '0553333333', password: 'NewPass123' })).status, 200);
    ok('استعادة كلمة المرور عبر واتساب (والطلب يُستخدم مرة واحدة)');

    // ---------- بوت واتساب الاحتياطي (وهمي في الاختبار) ----------
    const { mockOutbox } = require('../src/lib/wabot');
    const lastCode = () => (mockOutbox[mockOutbox.length - 1].text.match(/\d{6}/) || [])[0];
    const BT = client();
    const fdB = new FormData();
    for (const [k, v] of Object.entries({ full_name: 'فهد عبدالعزيز عبدالكريم', phone: '0556666666', password: 'Test12345', password_confirm: 'Test12345' })) fdB.append(k, v);
    fdB.append('photo', new Blob([PNG], { type: 'image/png' }), 'me.png');
    await BT.call('POST', '/api/auth/register', { form: fdB });
    assert.ok(!(await BT.get('/api/auth/me')).data.otp.methods.includes('wa_bot'));
    assert.equal((await BT.post('/api/auth/otp/send', { via: 'bot' })).status, 400);
    assert.equal((await B.get('/api/admin/wa-bot')).status, 403);
    assert.equal((await B.get('/api/admin/otp-settings')).status, 403);
    const en = await ADM.put('/api/admin/otp-settings', { methods: ['wa_reverse', 'wa_bot'], daily_limit: 50 });
    assert.equal(en.status, 200);
    assert.equal((await ADM.get('/api/admin/wa-bot')).data.status, 'connected');
    assert.deepEqual((await BT.get('/api/auth/me')).data.otp.methods, ['wa_reverse', 'wa_bot']);
    assert.equal((await BT.post('/api/auth/otp/send', { via: 'bot' })).status, 200);
    assert.equal(mockOutbox[mockOutbox.length - 1].phone, '966556666666');
    assert.equal((await BT.post('/api/auth/otp/verify', { code: '000000' })).status, 400);
    assert.equal((await BT.post('/api/auth/otp/verify', { code: lastCode() })).status, 200);
    assert.equal((await BT.get('/api/auth/me')).data.user.phone_verified, true);
    ok('بوت واتساب: تفعيله من الإدارة وإرسال الرمز تلقائيًا والتحقق به');
    const n0 = mockOutbox.length;
    await client().post('/api/auth/password/forgot', { phone: '0557777777', via: 'bot' }); // رقم غير مسجل: لا يُرسل شيء
    assert.equal(mockOutbox.length, n0);
    const RB = client();
    assert.equal((await RB.post('/api/auth/password/forgot', { phone: '0556666666', via: 'bot' })).data.channel, 'bot');
    assert.equal((await RB.post('/api/auth/password/reset', { phone: '0556666666', code: lastCode(), password: 'BotPass123' })).status, 200);
    assert.equal((await RB.post('/api/auth/login', { phone: '0556666666', password: 'BotPass123' })).status, 200);
    await ADM.put('/api/admin/otp-settings', { methods: ['wa_reverse'] });
    assert.ok(!(await RB.get('/api/auth/me')).data.otp.methods.includes('wa_bot'));
    assert.equal((await ADM.get('/api/admin/wa-bot')).data.status, 'disabled');
    ok('بوت واتساب: استعادة كلمة المرور، ولا إرسال لرقم غير مسجل، وإيقافه من الإدارة');

    // ---------- اختيار طرق التحقق من الإعدادات ----------
    const mkUser = async (name, phone) => {
      const c = client(); const f = new FormData();
      for (const [k, v] of Object.entries({ full_name: name, phone, password: 'Test12345', password_confirm: 'Test12345' })) f.append(k, v);
      f.append('photo', new Blob([PNG], { type: 'image/png' }), 'me.png');
      assert.equal((await c.call('POST', '/api/auth/register', { form: f })).status, 201);
      return c;
    };
    // رسالة نصية: معطلة ثم مفعّلة
    const S = await mkUser('سعد عبدالعزيز عبدالكريم', '0558888888');
    assert.equal((await S.post('/api/auth/otp/send', { via: 'sms' })).status, 400);
    await ADM.put('/api/admin/otp-settings', { methods: ['sms', 'manual', 'wa_reverse'] });
    assert.deepEqual((await S.get('/api/auth/me')).data.otp.methods, ['sms', 'manual', 'wa_reverse']);
    const sm = await S.post('/api/auth/otp/send', { via: 'sms' });
    assert.equal(sm.status, 200); assert.match(sm.data.dev_code, /^\d{6}$/);
    assert.equal((await S.post('/api/auth/otp/verify', { code: sm.data.dev_code })).status, 200);
    ok('اختيار الطرق وترتيبها من الإعدادات، والتحقق برسالة نصية');
    // توثيق يدوي من الإدارة
    const M = await mkUser('ماجد عبدالعزيز عبدالكريم', '0551212121');
    assert.equal((await M.post('/api/auth/otp/manual/request')).status, 200);
    assert.equal((await M.get('/api/auth/me')).data.user.verify_requested, true);
    const pend = (await ADM.get('/api/admin/users?verify=pending')).data.items;
    const mu = pend.find((x) => x.phone === '966551212121');
    assert.ok(mu);
    assert.equal((await ADM.get('/api/admin/stats')).data.pending_phone >= 1, true);
    assert.equal((await M.post(`/api/admin/users/${mu.id}/verify-phone`)).status, 403);
    assert.equal((await ADM.post(`/api/admin/users/${mu.id}/verify-phone`)).status, 200);
    assert.equal((await M.get('/api/auth/me')).data.user.phone_verified, true);
    ok('التوثيق اليدوي: طلب العضو ثم توثيق الإدارة');
    // طريقة معطلة مرفوضة من الخادم
    await ADM.put('/api/admin/otp-settings', { methods: ['manual'] });
    const X = await mkUser('ناصر عبدالعزيز عبدالكريم', '0553434343');
    assert.equal((await X.post('/api/auth/otp/whatsapp/start')).status, 400);
    assert.equal((await X.post('/api/auth/otp/send', { via: 'sms' })).status, 400);
    assert.equal((await client().post('/api/auth/password/forgot', { phone: '0553434343' })).status, 400);
    assert.equal((await ADM.put('/api/admin/otp-settings', { methods: [] })).status, 400);
    // القيم السرية لا تُعاد أبدًا
    await ADM.put('/api/admin/otp-settings', { methods: ['wa_reverse'], config: { wa_number: '966500000088', wa_app_secret: 'super-secret-x' } });
    const os = (await ADM.get('/api/admin/otp-settings')).data;
    assert.equal(os.config.wa_number, '966500000088'); assert.equal(os.config.has_wa_app_secret, true);
    assert.ok(!JSON.stringify(os).includes('super-secret-x'));
    // الرقم الجديد والسر الجديد يُستخدمان فورًا
    const s2 = (await X.post('/api/auth/otp/whatsapp/start')).data;
    assert.ok(s2.wa_link.startsWith('https://wa.me/966500000088'));
    assert.equal(await waIncoming(intl('0553434343'), s2.text, 'test-app-secret'), 401);
    assert.equal(await waIncoming(intl('0553434343'), s2.text, 'super-secret-x'), 200);
    assert.equal((await X.get('/api/auth/me')).data.user.phone_verified, true);
    ok('الطرق المعطلة مرفوضة من الخادم، والإعدادات السرية تُحفظ ولا تُعرض وتُطبَّق فورًا');

    // ---------- بوابات الدفع من لوحة الإدارة ----------
    assert.equal((await B.get('/api/admin/gateways')).status, 403);
    const gws = (await ADM.get('/api/admin/gateways')).data;
    assert.deepEqual(gws.catalog.map((c) => c.key).sort(), ['bank_transfer', 'mock', 'moyasar', 'paytabs', 'tap']);
    const mockGw = gws.items.find((g) => g.provider === 'mock');
    // بوابة ناقصة لا تُفعَّل
    assert.equal((await ADM.post('/api/admin/gateways', { provider: 'bank_transfer', name: 'تحويل بنكي', is_active: true, config: { bank_name: 'الراجحي' } })).status, 400);
    const bank = (await ADM.post('/api/admin/gateways', { provider: 'bank_transfer', name: 'تحويل بنكي', is_active: true,
      config: { bank_name: 'مصرف الراجحي', account_name: 'صندوق سليمان التويجري', iban: 'SA0380000000608010167519' } })).data;
    assert.equal(bank.ready, true);
    // المفاتيح السرية لا تُعاد أبدًا
    const moy = (await ADM.post('/api/admin/gateways', { provider: 'moyasar', name: 'ميسّر', is_active: false, config: { secret_key: 'sk_test_TOPSECRET' } })).data;
    assert.equal(moy.secrets_set.secret_key, true);
    assert.ok(!JSON.stringify((await ADM.get('/api/admin/gateways')).data).includes('TOPSECRET'));
    assert.ok(moy.webhook_url.endsWith(`/api/payments/webhook/${moy.id}`));
    // ما يراه العضو: المفعّل والجاهز فقط وبالترتيب
    let mg = (await M.get('/api/payments/gateways')).data.items;
    assert.deepEqual(mg.map((g) => g.provider), ['mock', 'bank_transfer']);
    await ADM.post('/api/admin/gateways/reorder', { ids: [bank.id, mockGw.id, moy.id] });
    await ADM.put(`/api/admin/gateways/${mockGw.id}`, { is_active: false });
    mg = (await M.get('/api/payments/gateways')).data.items;
    assert.deepEqual(mg.map((g) => g.provider), ['bank_transfer']);
    assert.equal((await M.post('/api/payments/checkout', { plan_id: silver.id, gateway_id: mockGw.id })).status, 400);
    ok('بوابات الدفع: إضافة وتفعيل وإيقاف وترتيب، والمفاتيح السرية لا تُعرض');

    // ---------- التحويل البنكي ----------
    const bt = (await M.post('/api/payments/checkout', { plan_id: silver.id, gateway_id: bank.id })).data;
    assert.equal(bt.manual, true); assert.equal(bt.reference, `BT-${bt.payment_id}`);
    let bp = (await M.get(`/api/payments/${bt.payment_id}`)).data;
    assert.equal(bp.manual, true); assert.equal(bp.bank.iban, 'SA0380000000608010167519'); assert.equal(bp.status, 'initiated');
    const tform = (o, img) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); if (img) f.append('receipt', new Blob([img]), 'r.png'); return f; };
    assert.equal((await M.call('POST', `/api/payments/${bt.payment_id}/transfer`, { form: tform({ transfer_name: 'ماجد' }) })).status, 400);
    assert.equal((await A.call('POST', `/api/payments/${bt.payment_id}/transfer`, { form: tform({ transfer_name: 'أصيل', transfer_ref: 'محاولة' }) })).status, 404);
    assert.equal((await M.call('POST', `/api/payments/${bt.payment_id}/transfer`, { form: tform({ transfer_name: 'ماجد عبدالعزيز', transfer_ref: 'TRX-778' }, PNG) })).status, 200);
    assert.equal((await M.get(`/api/payments/${bt.payment_id}/receipt`)).status, 200);
    assert.equal((await A.get(`/api/payments/${bt.payment_id}/receipt`)).status, 404);
    assert.equal((await ADM.get(`/api/payments/${bt.payment_id}/receipt`)).status, 200);
    assert.equal((await ADM.post(`/api/admin/payments/${bt.payment_id}/reverify`)).data.status, 'initiated'); // لا تفعيل بدون اعتماد
    const rev = (await ADM.get('/api/admin/payments?status=review')).data.items;
    assert.ok(rev.some((x) => x.id === bt.payment_id && x.transfer_ref === 'TRX-778'));
    assert.equal((await M.post(`/api/admin/payments/${bt.payment_id}/approve`)).status, 403);
    assert.equal((await ADM.post(`/api/admin/payments/${bt.payment_id}/approve`)).data.status, 'paid');
    assert.equal((await ADM.post(`/api/admin/payments/${bt.payment_id}/approve`)).status, 400); // مرة واحدة فقط
    assert.equal((await M.get('/api/auth/me')).data.plan.name, (await M.get('/api/plans')).data.plans.find((p) => p.id === silver.id).name);
    // رفض تحويل آخر
    const bt2 = (await M.post('/api/payments/checkout', { plan_id: silver.id, gateway_id: bank.id })).data;
    await M.call('POST', `/api/payments/${bt2.payment_id}/transfer`, { form: tform({ transfer_name: 'ماجد', transfer_ref: 'خطأ' }) });
    await ADM.post(`/api/admin/payments/${bt2.payment_id}/reject`, { reason: 'لم يصل المبلغ' });
    bp = (await M.get(`/api/payments/${bt2.payment_id}`)).data;
    assert.equal(bp.status, 'failed'); assert.equal(bp.failure_reason, 'لم يصل المبلغ');
    ok('التحويل البنكي: إرسال الإيصال، واعتماد الإدارة يفعّل الاشتراك مرة واحدة، والرفض يظهر للعضو');

    // حذف البوابات: المستخدمة تُخفى، وغير المستخدمة تُحذف
    assert.equal((await ADM.del(`/api/admin/gateways/${bank.id}`)).status, 200);
    assert.equal((await ADM.del(`/api/admin/gateways/${moy.id}`)).status, 200);
    const left = (await ADM.get('/api/admin/gateways')).data.items.map((g) => g.id);
    assert.ok(!left.includes(bank.id) && !left.includes(moy.id));
    assert.ok(one('SELECT id FROM payment_gateways WHERE id = ? AND is_deleted = 1', bank.id));
    assert.ok(!one('SELECT id FROM payment_gateways WHERE id = ?', moy.id));
    assert.equal((await M.get(`/api/payments/${bt.payment_id}`)).data.status, 'paid'); // السجل القديم سليم
    ok('حذف البوابات مع حفظ سجل المدفوعات السابقة');

    // ---------- إيقاف/تشغيل نظام الباقات والاشتراكات ----------
    const allFeats = (await ADM.get('/api/admin/plans')).data.features.length;
    const subFeats = (await M.get('/api/auth/me')).data.features.length;
    const subBefore = one("SELECT * FROM subscriptions WHERE user_id = (SELECT id FROM users WHERE phone = ?) AND status = 'active'", (await M.get('/api/auth/me')).data.user.phone);
    assert.ok(subBefore);
    assert.equal((await M.put('/api/admin/plans-system', { enabled: false })).status, 403);
    let sys = (await ADM.put('/api/admin/plans-system', { enabled: false, off_mode: 'free_all' })).data;
    assert.equal(sys.enabled, false); assert.ok(sys.paused_at);
    assert.equal((await M.get('/api/plans')).data.enabled, false);
    let mme = (await M.get('/api/auth/me')).data;
    assert.equal(mme.plans_enabled, false); assert.equal(mme.features.length, allFeats);
    assert.equal((await M.post('/api/payments/checkout', { plan_id: silver.id, gateway_id: mockGw.id })).status, 403);
    assert.ok(!(await M.get('/api/home')).data.tiles.some((t) => t.key === 'plans'));
    await ADM.put('/api/admin/plans-system', { off_mode: 'free_plan' });
    const freeFeats = (await ADM.get('/api/admin/plans')).data.items.find((p) => p.is_free).feature_ids.length;
    assert.equal((await M.get('/api/auth/me')).data.features.length, freeFeats);
    assert.equal((await ADM.put('/api/admin/plans-system', { off_mode: 'bogus' })).status, 400);
    // محاكاة إيقاف دام 10 أيام ثم إعادة التشغيل مع التمديد
    run("UPDATE settings SET value = ? WHERE key = 'subscriptions_paused_at'", new Date(Date.now() - 10 * 864e5).toISOString());
    run('UPDATE subscriptions SET start_at = ? WHERE id = ?', new Date(Date.now() - 20 * 864e5).toISOString(), subBefore.id);
    sys = (await ADM.put('/api/admin/plans-system', { enabled: true, extend: true })).data;
    assert.equal(sys.enabled, true); assert.ok(sys.extended >= 1);
    const subAfter = one('SELECT end_at FROM subscriptions WHERE id = ?', subBefore.id);
    const addedDays = (Date.parse(subAfter.end_at) - Date.parse(subBefore.end_at)) / 864e5;
    assert.ok(addedDays > 9.9 && addedDays < 10.1, `extended ${addedDays}`);
    mme = (await M.get('/api/auth/me')).data;
    assert.equal(mme.plans_enabled, true); assert.equal(mme.features.length, subFeats);
    assert.equal((await M.get('/api/plans')).data.enabled, true);
    ok('إيقاف الباقات والاشتراكات وتشغيلها: إخفاء وحظر الدفع، وخيارا المميزات، وتمديد الاشتراكات بمدة الإيقاف');

    // ---------- إيقاف ميزة للجميع (وثيقة النسب) ----------
    const myPid = one('SELECT id FROM persons ORDER BY id LIMIT 1').id;
    const certF = (await ADM.get('/api/admin/plans')).data.features.find((f) => f.key === 'tree.certificate');
    assert.equal((await ADM.get(`/api/persons/${myPid}/certificate`)).status, 200);
    assert.equal((await M.put(`/api/admin/features/${certF.id}`, { is_enabled: false })).status, 403);
    await ADM.put(`/api/admin/features/${certF.id}`, { is_enabled: false });
    const cr = await ADM.get(`/api/persons/${myPid}/certificate`);
    assert.equal(cr.status, 403); assert.equal(cr.data.code, 'feature_disabled'); // حتى الإدارة
    mme = (await M.get('/api/auth/me')).data;
    assert.ok(mme.disabled_features.includes('tree.certificate')); assert.ok(!mme.features.includes('tree.certificate'));
    assert.ok(!(await M.get('/api/home')).data.tiles.some((t) => t.key === 'certificate'));
    assert.ok(!(await M.get('/api/plans')).data.features.some((f) => f.key === 'tree.certificate'));
    await ADM.put(`/api/admin/features/${certF.id}`, { is_enabled: true });
    assert.equal((await ADM.get(`/api/persons/${myPid}/certificate`)).status, 200);
    ok('إيقاف ميزة (وثيقة النسب) لجميع الأعضاء والإدارة ثم إعادتها');

    // ---------- وصايا الأجداد ----------
    const wform = (o, img) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); if (img) f.append('image', new Blob([img]), 'w.png'); return f; };
    assert.equal((await M.call('POST', '/api/admin/wills', { form: wform({ title: 'وصية', body: 'نص', author_name: 'فلان' }) })).status, 403);
    assert.equal((await ADM.call('POST', '/api/admin/wills', { form: wform({ title: 'وصية', body: 'نص' }) })).status, 400); // بدون صاحب
    const w1 = (await ADM.call('POST', '/api/admin/wills', { form: wform({ title: 'وصية الجد لأبنائه', body: 'أوصيكم بتقوى الله\nوصلة الرحم', person_id: myPid, will_date: '1385 هـ', source: 'رواها ابنه' }, PNG) })).data;
    const w2 = (await ADM.call('POST', '/api/admin/wills', { form: wform({ title: 'وصية مسودة', body: 'نص', author_name: 'جد من خارج المشجرة', is_published: '0' }) })).data;
    let wl = (await M.get('/api/wills')).data.items;
    assert.equal(wl.length, 1); assert.equal(wl[0].id, w1.id); assert.ok(wl[0].author); assert.ok(wl[0].image);
    assert.equal((await M.get(`/api/wills/${w2.id}`)).status, 404); // المسودة لا تظهر
    assert.equal((await M.get(`/api/wills/${w1.id}`)).data.body, 'أوصيكم بتقوى الله\nوصلة الرحم');
    assert.equal((await M.get(`/api/wills?person_id=${myPid}`)).data.items.length, 1);
    assert.equal((await ADM.get(`/api/persons/${myPid}`)).data.wills_count, 1);
    assert.equal((await M.get(wl[0].image)).status, 200);
    assert.ok((await M.get('/api/home')).data.tiles.some((t) => t.key === 'wills'));
    assert.equal((await ADM.call('PUT', `/api/admin/wills/${w2.id}`, { form: wform({ title: 'وصية منشورة', body: 'نص', author_name: 'جد', is_published: '1' }) })).status, 200);
    await ADM.post('/api/admin/wills/reorder', { ids: [w2.id, w1.id] });
    wl = (await M.get('/api/wills')).data.items;
    assert.deepEqual(wl.map((x) => x.id), [w2.id, w1.id]);
    assert.equal((await ADM.del(`/api/admin/wills/${w1.id}`)).status, 200);
    assert.equal((await M.get('/api/wills')).data.items.length, 1);
    ok('وصايا الأجداد: إضافة مع صورة وصاحب من المشجرة، مسودات، ترتيب، وحذف');

    // ---------- تشغيل/إيقاف أقسام الموقع ----------
    assert.equal((await M.put('/api/admin/modules', { events: false })).status, 403);
    const keysOf = async () => (await M.get('/api/home')).data.tiles.map((t) => t.key);
    run("UPDATE home_tiles SET is_visible = 1 WHERE key IN ('events','feedback','wills')");
    const hkBefore = await keysOf();
    assert.ok(hkBefore.includes('events'));
    let mods = (await ADM.put('/api/admin/modules', { events: false, feedback: false, wills: false })).data;
    assert.deepEqual(mods, { events: false, feedback: false, wills: false });
    let hk = await keysOf();
    assert.ok(!hk.includes('events') && !hk.includes('feedback') && !hk.includes('wills'));
    const hm = (await M.get('/api/home')).data;
    assert.equal(hm.next_event, null); assert.equal(hm.notifications.count, 0);
    assert.equal((await M.get('/api/events')).data.code, 'module_disabled');
    assert.equal((await M.get('/api/feedback')).status, 403);
    assert.equal((await M.post('/api/feedback', { type: 'suggestion', subject: 'اقتراح', message: 'نص الاقتراح هنا' })).status, 403);
    assert.equal((await M.get('/api/wills')).status, 403);
    assert.equal((await ADM.get('/api/admin/events')).status, 200); // الإدارة تجهّز المحتوى أثناء الإيقاف
    assert.deepEqual((await M.get('/api/auth/me')).data.modules, { events: false, feedback: false, wills: false });
    await ADM.put('/api/admin/modules', { events: true, feedback: true, wills: true });
    assert.deepEqual(await keysOf(), hkBefore);
    assert.equal((await M.get('/api/events')).status, 200);
    ok('إيقاف أقسام الموقع (المناسبات، الاقتراحات، الوصايا): تختفي من الرئيسية وتُحظر، وتعود عند التشغيل');

    // ---------- الرسائل الجماعية (الموقع + واتساب) ----------
    const bc = require('../src/lib/broadcast');
    const aform = (o, img) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); if (img) f.append('image', new Blob([img]), 'card.png'); return f; };
    const mPhone = (await M.get('/api/auth/me')).data.user.phone;
    assert.equal((await M.call('POST', '/api/admin/announcements', { form: aform({ title: 'x', body: 'y' }) })).status, 403);
    // 1) في الموقع فقط
    const a1 = (await ADM.call('POST', '/api/admin/announcements', { form: aform({ kind: 'announcement', title: 'إعلان عام', body: 'نص الإعلان\nسطر ثان', send_whatsapp: '0' }) })).data;
    assert.ok(a1.stats.recipients >= 2); assert.equal(a1.stats.wa_pending, 0);
    let ml = (await M.get('/api/announcements')).data;
    assert.equal(ml.items[0].id, a1.id); assert.equal(ml.items[0].read, false); assert.ok(ml.unread >= 1);
    assert.ok((await M.get('/api/home')).data.notifications.announcements.some((x) => x.id === a1.id));
    const a1v = (await M.get(`/api/announcements/${a1.id}`)).data;
    assert.equal(a1v.body, 'نص الإعلان\nسطر ثان');
    assert.ok(!(await M.get('/api/home')).data.notifications.announcements.some((x) => x.id === a1.id)); // صارت مقروءة
    // 2) مع واتساب عبر البوت + صورة الدعوة
    assert.equal((await M.put('/api/admin/announcements/channel', { bot_for_broadcast: true })).status, 403);
    const chi = (await ADM.put('/api/admin/announcements/channel', { bot_for_broadcast: true })).data;
    assert.equal(chi.active, 'bot');
    const out0 = mockOutbox.length;
    const a2 = (await ADM.call('POST', '/api/admin/announcements', { form: aform({ kind: 'invitation', title: 'دعوة زواج', body: 'يتشرف آل العلاط بدعوتكم', send_whatsapp: '1' }, PNG) })).data;
    assert.ok(a2.stats.wa_pending >= 1);
    await bc.drain();
    const sent = mockOutbox.slice(out0);
    const toM = sent.find((x) => x.phone === mPhone);
    assert.ok(toM, 'وصلت للعضو على واتساب'); assert.ok(toM.text.includes('دعوة زواج')); assert.equal(toM.image, true);
    let st2 = (await ADM.get('/api/admin/announcements')).data.items.find((x) => x.id === a2.id).stats;
    assert.equal(st2.wa_pending, 0); assert.equal(st2.wa_sent + st2.wa_failed, a2.stats.wa_pending);
    assert.ok((await ADM.get(`/api/admin/announcements/${a2.id}/deliveries?status=sent`)).data.items.some((x) => x.phone === mPhone));
    // 3) العضو يوقف استقبال واتساب
    await M.put('/api/account/privacy', { photo: 'members', phone: 'members', birth: 'members', wa_broadcast: 0 });
    assert.equal((await M.get('/api/account')).data.user.wa_broadcast, false);
    const a3 = (await ADM.call('POST', '/api/admin/announcements', { form: aform({ title: 'تهنئة', body: 'نص', kind: 'congrats', send_whatsapp: '1' }) })).data;
    assert.equal(one('SELECT wa_status FROM announcement_deliveries WHERE announcement_id = ? AND phone = ?', a3.id, mPhone).wa_status, 'skipped');
    await bc.drain();
    await M.put('/api/account/privacy', { photo: 'members', phone: 'members', birth: 'members', wa_broadcast: 1 });
    // 4) بدون قناة: تبقى بالانتظار، ثم إيقاف الإرسال
    await ADM.put('/api/admin/announcements/channel', { bot_for_broadcast: false });
    assert.equal(bc.channel(), null);
    const a4 = (await ADM.call('POST', '/api/admin/announcements', { form: aform({ title: 'إعلان', body: 'نص', send_whatsapp: '1' }) })).data;
    assert.equal(a4.channel, null);
    await bc.drain();
    assert.ok((await ADM.get('/api/admin/announcements')).data.items.find((x) => x.id === a4.id).stats.wa_pending >= 1);
    const cx = (await ADM.post(`/api/admin/announcements/${a4.id}/cancel-whatsapp`)).data;
    assert.ok(cx.cancelled >= 1);
    // 5) الحذف يخفيها من الموقع
    await ADM.del(`/api/admin/announcements/${a4.id}`);
    assert.ok(!(await M.get('/api/announcements')).data.items.some((x) => x.id === a4.id));
    assert.equal((await M.get(`/api/announcements/${a4.id}`)).status, 404);
    ok('الرسائل الجماعية: تظهر في الموقع، وتُرسل على واتساب بالصورة، وإيقاف العضو للاستقبال، والانتظار والإلغاء والحذف');

    // واتساب الرسمي: قالب معتمد بمتغير واحد (طلب Meta محاكى)
    run("INSERT INTO settings (key, value) VALUES ('wa_token','tok'),('wa_phone_number_id','12345') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    assert.equal((await ADM.put('/api/admin/announcements/channel', { template: 'Bad Name!' })).status, 400);
    assert.equal((await ADM.put('/api/admin/announcements/channel', { template: 'family_broadcast', lang: 'ar' })).data.active, 'cloud');
    const realFetch = global.fetch; const metaCalls = [];
    global.fetch = async (url, opts) => {
      if (String(url).startsWith('https://graph.facebook.com/')) { metaCalls.push({ url, body: JSON.parse(opts.body) }); return new Response('{}', { status: 200 }); }
      return realFetch(url, opts);
    };
    try {
      const a5 = (await ADM.call('POST', '/api/admin/announcements', { form: aform({ kind: 'condolence', title: 'تعزية', body: 'انتقل إلى رحمة الله\nفلان', send_whatsapp: '1' }) })).data;
      await bc.drain();
      assert.ok(metaCalls.length >= 1);
      const mc = metaCalls.find((c) => c.body.to === mPhone);
      assert.ok(mc.url.endsWith('/12345/messages'));
      assert.equal(mc.body.type, 'template'); assert.equal(mc.body.template.name, 'family_broadcast');
      const p = mc.body.template.components[0].parameters[0].text;
      assert.ok(!p.includes('\n') && p.includes('تعزية') && p.includes('فلان'));
      assert.equal((await ADM.get('/api/admin/announcements')).data.items.find((x) => x.id === a5.id).stats.wa_pending, 0);
    } finally {
      global.fetch = realFetch;
      run("UPDATE settings SET value = '' WHERE key IN ('wa_token','wa_phone_number_id','wa_broadcast_template')");
    }
    ok('الرسائل الجماعية عبر واتساب الرسمي بقالب معتمد (بدون أسطر جديدة في المتغير)');

    // ---------- النسخ الاحتياطي والاستعادة ----------
    assert.equal((await M.get('/api/admin/backup')).status, 403);
    assert.equal((await fetch(`${BASE}/api/health`)).status, 200);
    const br = await ADM.call('GET', '/api/admin/backup', { raw: true });
    assert.equal(br.status, 200); assert.match(br.headers.get('content-disposition'), /\.tar\.gz/);
    const bfile = path.join(tmp, 'b.tar.gz');
    fs.writeFileSync(bfile, Buffer.from(await br.arrayBuffer()));
    const backupLib = require('../src/lib/backup');
    const stInfo = backupLib.stage(bfile);
    assert.ok(stInfo.images >= 1, 'الصور ضمن النسخة');
    assert.ok(backupLib.hasPending());
    // ملف ضار يحاول الكتابة خارج المجلد يُتجاهل، وملف بلا قاعدة بيانات يُرفض
    const zlib = require('node:zlib');
    const evil = Buffer.concat([backupLib.tarHeader('../evil.txt', 3, Date.now()), Buffer.alloc(512, 0x41), Buffer.alloc(1024)]);
    fs.writeFileSync(path.join(tmp, 'evil.tar.gz'), zlib.gzipSync(evil));
    assert.throws(() => backupLib.stage(path.join(tmp, 'evil.tar.gz')), /قاعدة بيانات/);
    assert.ok(!fs.existsSync(path.join(tmp, 'evil.txt')));
    assert.throws(() => backupLib.stage(bfile.replace('b.tar', 'none')));
    // التطبيق عند الإقلاع: نطبّقه على نسخة منفصلة للتأكد
    backupLib.stage(bfile);
    const pendDb = path.join(tmp, 'restore-pending', 'family.db');
    assert.ok(fs.existsSync(pendDb));
    const { DatabaseSync } = require('node:sqlite');
    const chk = new DatabaseSync(pendDb, { readOnly: true });
    assert.ok(chk.prepare('SELECT COUNT(*) c FROM persons').get().c > 100); chk.close();
    fs.rmSync(path.join(tmp, 'restore-pending'), { recursive: true, force: true });
    ok('النسخ الاحتياطي: تنزيل للمدير فقط، وقاعدة بيانات وصور سليمة، ورفض الملفات الضارة');

    origLog(`\n✅ نجحت جميع الاختبارات (${passed})`);
  } catch (e) {
    origLog('\n❌ فشل:', e.message); origLog(e.stack);
    process.exitCode = 1;
  } finally {
    server.close();
    setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } process.exit(); }, 100);
  }
})();
