import { state, api, refreshMe, esc, $, go, nextStep, icon } from './core.js';
import * as authViews from './views/auth.js';
import * as treeView from './views/tree.js';
import * as accountViews from './views/account.js';
import * as adminView from './views/admin.js';
import * as communityViews from './views/community.js';
import * as homeView from './views/home.js';
import * as willsViews from './views/wills.js';
import * as annViews from './views/announcements.js';

const app = document.getElementById('app');

const routes = [
  ['/', home],
  ['/login', authViews.login],
  ['/register', authViews.register],
  ['/verify', authViews.verify],
  ['/forgot', authViews.forgot],
  ['/link', authViews.link],
  ['/tree', treeView.render, { wide: true }],
  ['/plans', accountViews.plans],
  ['/account', accountViews.dashboard],
  ['/payment-result', accountViews.paymentResult],
  ['/bank-transfer', accountViews.bankTransfer],
  ['/certificate/:id', accountViews.certificate],
  ['/events', communityViews.events],
  ['/feedback', communityViews.feedback],
  ['/announcements', annViews.list],
  ['/announcements/:id', annViews.show],
  ['/wills', willsViews.list],
  ['/wills/:id', willsViews.show],
  ['/admin', adminView.render],
  ['/admin/:tab', adminView.render],
];

function match(path) {
  for (const [pattern, fn, opts] of routes) {
    const pp = pattern.split('/'); const ap = path.split('/');
    if (pp.length !== ap.length) continue;
    const params = {};
    if (pp.every((seg, i) => (seg.startsWith(':') ? (params[seg.slice(1)] = decodeURIComponent(ap[i]), true) : seg === ap[i]))) return { fn, params, opts: opts || {} };
  }
  return null;
}

function renderHeader() {
  const me = state.me;
  const u = me && me.user;
  if (me && me.site_name) { $('#siteName').textContent = me.site_name; document.title = me.site_name; }
  const member = !!(u && u.phone_verified);
  const links = [];
  if (member) links.push(['#/', 'الرئيسية']);
  if (u && me.tree_access.ok) links.push(['#/tree', 'المشجرة']);
  if (u && !u.person_id && u.role === 'member') links.push(['#/link', 'ربط الحساب']);
  const mod = (k) => !me || !me.modules || me.modules[k] !== false;
  if (member) links.push(['#/announcements', 'الدعوات والإعلانات']);
  if (member && mod('events')) links.push(['#/events', 'المناسبات']);
  if (member && mod('wills')) links.push(['#/wills', 'وصايا الأجداد']);
  if (member && mod('feedback')) links.push(['#/feedback', 'الاقتراحات والاستفسارات']);
  if (!me || me.plans_enabled !== false) links.push(['#/plans', 'الباقات والاشتراكات']);
  if (u) links.push(['#/account', 'حسابي']);
  if (u && (u.role === 'admin' || u.role === 'moderator')) links.push(['#/admin', 'لوحة الإدارة']);
  const cur = location.hash.split('?')[0] || '#/';
  const isActive = (h) => (h === '#/' ? cur === '#/' || cur === '#' : cur.startsWith(h));
  $('#nav').innerHTML = links.map(([h, t]) => `<a href="${h}" class="${isActive(h) ? 'active' : ''}">${t}</a>`).join('');
  const n = state.home ? state.home.notifications.count : 0;
  $('#userBox').innerHTML = u
    ? `${member ? `<button class="inbox-btn" id="inboxBtn" aria-label="الإشعارات${n ? ` (${n})` : ''}">${icon('inbox')}${n ? '<i class="dot"></i>' : ''}</button>` : ''}
       ${u.has_photo ? `<img class="hide-m" src="/api/account/photo?v=${Date.now() % 1e5}" alt="">` : ''}<span class="uname small hide-m">${esc(u.full_name)}</span>
       <button class="btn sm secondary hide-m" id="logoutBtn">خروج</button>`
    : `<a class="btn sm secondary" href="#/login">دخول</a><a class="btn sm gold" href="#/register">تسجيل</a>`;
  const lo = $('#logoutBtn');
  if (lo) lo.onclick = async () => { await api('/auth/logout', { method: 'POST' }); state.home = null; await refreshMe(); go('#/'); };
  const ib = $('#inboxBtn');
  if (ib) ib.onclick = () => homeView.openInbox();

  // شريط التبويبات السفلي (يظهر في الجوال فقط)
  document.body.classList.toggle('has-tabbar', member);
  const tabs = [['#/', 'home', 'الرئيسية'], [me.tree_access && me.tree_access.ok ? '#/tree' : '#/link', 'tree', 'المشجرة'],
    mod('events') ? ['#/events', 'calendar', 'المناسبات'] : mod('wills') ? ['#/wills', 'scroll', 'الوصايا'] : null,
    mod('feedback') ? ['#/feedback', 'chat', 'رسائلي'] : null, ['#/account', 'gear', 'الإعدادات']].filter(Boolean);
  $('#tabbar').innerHTML = member ? tabs.map(([h, ic, t]) => `<a href="${h}" class="${isActive(h) ? 'on' : ''}">${icon(ic)}<span>${t}</span></a>`).join('') : '';

  // تحديث الإشعارات في الخلفية (مرة كل 60 ثانية كحد أقصى)
  if (member && (!state.homeAt || Date.now() - state.homeAt > 60e3)) {
    state.homeAt = Date.now();
    api('/home').then((h) => { state.home = h; renderHeader(); }).catch(() => {});
  }
}

async function home() {
  const me = state.me;
  if (me && me.user) {
    if (!me.user.phone_verified) { location.replace('#/verify'); return; }
    await homeView.render(app);
    renderHeader();
    return;
  }
  app.innerHTML = `
    <section class="hero">
      <picture class="hero-logo">
        <source srcset="/img/logo-dark.png?v=2" media="(prefers-color-scheme: dark)">
        <img src="/img/logo-light.png?v=2" alt="شعار آل العلاط">
      </picture>
      <h1>${esc((me && me.site_name) || 'مشجرة آل العلاط')}</h1>
      <p>منصة عائلية تفاعلية تحفظ نسب فرع سليمان العلاط وتربط أفراد العائلة ببعضهم. سجّل واربط حسابك باسمك في المشجرة مباشرة.</p>
      <div class="row" style="justify-content:center">
        <a class="btn" href="#/register">إنشاء حساب</a>
        <a class="btn secondary" href="#/login">تسجيل الدخول</a>
        ${me && me.plans_enabled === false ? '' : '<a class="btn secondary" href="#/plans">الباقات والاشتراكات</a>'}
      </div>
      <div class="feature-tiles">
        <div class="card"><h3>${icon('tree')} مشجرة تفاعلية</h3><p class="muted small">تصفح الأجيال، ابحث عن الأقارب، واعرض بطاقة كل فرد.</p></div>
        <div class="card"><h3>${icon('link')} ربط موثّق</h3><p class="muted small">يُربط كل حساب باسم واحد فقط بعد التحقق من الجوال، ولا يُربط الاسم بحسابين.</p></div>
        <div class="card"><h3>${icon('lock')} خصوصية</h3><p class="muted small">أنت تحدد من يرى صورتك ورقمك وتاريخ ميلادك.</p></div>
        ${me && me.plans_enabled === false ? '' : `<div class="card"><h3>${icon('gem')} باقات مرنة</h3><p class="muted small">مميزات إضافية مثل حاسبة القرابة ووثيقة النسب.</p></div>`}
      </div>
    </section>`;
}

async function router() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const m = match(path) || { fn: notFound, params: {}, opts: {} };
  document.querySelector('main').className = m.opts.wide ? 'wide' : '';
  $('#nav').classList.remove('open');
  renderHeader();
  try {
    await m.fn(app, { ...m.params, query: new URLSearchParams(qs || '') });
  } catch (e) {
    if (e.status === 401) { go('#/login'); return; }
    app.innerHTML = `<div class="card narrow"><div class="alert error">${esc(e.message)}</div><a class="btn secondary" href="#/">العودة</a></div>`;
  }
}

function notFound(root) { root.innerHTML = '<div class="card narrow"><h2>الصفحة غير موجودة</h2><a href="#/">العودة للرئيسية</a></div>'; }

window.addEventListener('hashchange', router);
document.getElementById('menuBtn').onclick = () => $('#nav').classList.toggle('open');
window.addEventListener('me-changed', renderHeader);

(async () => {
  try { await refreshMe(); } catch { state.me = { user: null }; }
  router();
})();
