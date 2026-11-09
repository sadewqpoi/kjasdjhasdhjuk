import { state, api, esc, $, go, icon, can, hasFeature, evDate, evTime, modal, LABELS } from '../core.js';
import { KIND_ICON } from './announcements.js';

const NEW_LABEL = { invitation: 'دعوة جديدة', announcement: 'إعلان جديد', congrats: 'تهنئة جديدة', condolence: 'تعزية جديدة', general: 'رسالة جديدة' };

/** أيقونات المربعات: ثنائية اللون (ذهبي .g + أخضر .e) */
const TILE_ICONS = {
  tree: `<g class="e"><circle cx="24" cy="9" r="4"/><circle cx="12" cy="24" r="3.6"/><circle cx="36" cy="24" r="3.6"/><circle cx="7" cy="39" r="3.2"/><circle cx="18" cy="39" r="3.2"/><circle cx="30" cy="39" r="3.2"/><circle cx="41" cy="39" r="3.2"/></g>
    <g class="g"><path d="M24 13v5M12 18h24M12 18v2.4M36 18v2.4M12 27.6V31M36 27.6V31M7 31h11M30 31h11M7 31v4.8M18 31v4.8M30 31v4.8M41 31v4.8"/></g>`,
  events: `<g class="g"><rect x="7" y="10" width="34" height="31" rx="4"/><path d="M7 18h34M16 6v8M32 6v8"/></g>
    <g class="e"><path d="M17 29l5 5 9-10"/></g>`,
  feedback: `<g class="e"><path d="M6 10h24v17H15l-7 6v-6H6z"/><path d="M11 16h14M11 21h9"/></g>
    <g class="g"><path d="M36 13a7 7 0 0 0-4 12.7V29h8v-3.3A7 7 0 0 0 36 13z"/><path d="M33 33h6M34 37h4"/><path d="M36 8v-2M44 13h2M28 13h-2M41.7 7.3l1.4-1.4M30.3 7.3l-1.4-1.4"/></g>`,
  plans: `<g class="g"><path d="M12 10h24l7 10-19 21L5 20z"/><path d="M5 20h38M18 10l6 31 6-31"/></g>
    <g class="e"><path d="M18 10l-6 10M30 10l6 10"/></g>`,
  certificate: `<g class="g"><path d="M10 6h22l6 6v30H10z"/><path d="M32 6v6h6"/></g>
    <g class="e"><path d="M16 17h14M16 22h14M16 27h8"/><circle cx="30" cy="34" r="4.5"/><path d="M27.5 37.5L26 44l4-2 4 2-1.5-6.5"/></g>`,
  kinship: `<g class="e"><circle cx="13" cy="15" r="5"/><circle cx="35" cy="15" r="5"/><path d="M4 36a9 9 0 0 1 18 0M26 36a9 9 0 0 1 18 0"/></g>
    <g class="g"><path d="M18 15h12" stroke-dasharray="2.5 2.5"/><path d="M24 26v6M20 40h8M24 32l-4 8M24 32l4 8"/></g>`,
  account: `<g class="g"><circle cx="20" cy="15" r="7"/><path d="M6 40a14 14 0 0 1 22-11.5"/></g>
    <g class="e"><circle cx="35" cy="35" r="4"/><path d="M35 26.5v2.5M35 41v2.5M26.5 35h2.5M41 35h2.5M29 29l1.8 1.8M39.2 39.2L41 41M29 41l1.8-1.8M39.2 30.8L41 29"/></g>`,
  admin: `<g class="g"><path d="M24 5l16 6v11c0 10-7 17.5-16 21-9-3.5-16-11-16-21V11z"/></g>
    <g class="e"><path d="M17 24l5 5 9-10"/></g>`,
  link: `<g class="e"><path d="M20 28a7 7 0 0 0 10 0l6-6a7 7 0 0 0-10-10l-2 2"/></g>
    <g class="g"><path d="M28 20a7 7 0 0 0-10 0l-6 6a7 7 0 0 0 10 10l2-2"/></g>`,
  scroll: `<g class="g"><path d="M13 7h24a4 4 0 0 1 4 4v3h-8"/><path d="M33 14v23a5 5 0 0 1-5 5H11a5 5 0 0 1-5-5v-3h21v3a5 5 0 0 0 5 5"/><path d="M13 7a4 4 0 0 0-4 4v23"/></g>
    <g class="e"><path d="M15 17h12M15 23h12M15 29h7"/></g>`,
  // أيقونات إضافية للمربعات المخصصة
  star: `<g class="g"><path d="M24 5l5.6 11.6 12.8 1.8-9.3 9 2.3 12.6L24 34l-11.4 6 2.3-12.6-9.3-9 12.8-1.8z"/></g><g class="e"><circle cx="24" cy="24" r="3"/></g>`,
  news: `<g class="e"><path d="M6 20v8h6l14 9V11L12 20z"/><path d="M12 28l3 10h5l-2-8"/></g><g class="g"><path d="M33 18a8 8 0 0 1 0 12M38 13a15 15 0 0 1 0 22"/></g>`,
  book: `<g class="g"><path d="M24 12c-5-4-12-4-18-2v28c6-2 13-2 18 2 5-4 12-4 18-2V10c-6-2-13-2-18 2z"/></g><g class="e"><path d="M24 12v28"/></g>`,
  support: `<g class="e"><path d="M4 30h8l7 4h9a3 3 0 0 0 0-6h-6M12 30v11H4M28 34l10-5a3 3 0 0 1 3 5l-12 8H12"/></g><g class="g"><path d="M30 18c-3-3-8 0-6 4l6 6 6-6c2-4-3-7-6-4z"/></g>`,
  hall: `<g class="e"><path d="M6 42h36M9 42V22M39 42V22M6 22h36L24 8z"/><path d="M15 42V28h6v14M27 42V28h6v14"/></g><g class="g"><circle cx="24" cy="16" r="2.5"/></g>`,
  gift: `<g class="g"><rect x="7" y="18" width="34" height="9" rx="1.5"/><path d="M10 27v15h28V27"/></g><g class="e"><path d="M24 18v24M24 18c-3-6-12-8-12-2 0 3 6 2 12 2zM24 18c3-6 12-8 12-2 0 3-6 2-12 2z"/></g>`,
  phone: `<g class="g"><path d="M14 5h8l3 10-5 3a24 24 0 0 0 10 10l3-5 10 3v8c0 3-3 6-6 5C21 37 11 27 9 11c-1-3 2-6 5-6z"/></g>`,
  bank: `<g class="g"><path d="M24 4l9 5.2v10.4L24 25l-9-5.4V9.2z"/><path d="M15 19.6l-9 5.2v10.4L15 40.6l9-5.4"/><path d="M33 19.6l9 5.2v10.4L33 40.6l-9-5.4"/></g><g class="e"><path d="M24 25v10.2"/></g>`,
  trophy: `<g class="g"><path d="M15 6h18v10a9 9 0 0 1-18 0z"/><path d="M15 9H8c0 7 3 10 7 10M33 9h7c0 7-3 10-7 10"/></g><g class="e"><path d="M24 25v8M16 42h16M18 42l2-9h8l2 9"/></g>`,
  camera: `<g class="g"><path d="M5 15h9l3-5h14l3 5h9v25H5z"/></g><g class="e"><circle cx="24" cy="27" r="7"/></g>`,
  video: `<g class="g"><rect x="5" y="12" width="28" height="24" rx="4"/></g><g class="e"><path d="M33 20l10-6v20l-10-6z"/><path d="M16 19v10l8-5z"/></g>`,
  map: `<g class="g"><path d="M5 11l12-5 14 5 12-5v31l-12 5-14-5-12 5z"/><path d="M17 6v31M31 11v31"/></g><g class="e"><circle cx="24" cy="22" r="0.5"/></g>`,
  walk: `<g class="e"><circle cx="27" cy="7" r="3.5"/><path d="M23 15l-6 7 5 3M25 15l-3 13 6 5 2 11M22 28l-5 14"/></g><g class="g"><path d="M25 15l6 6 6 1"/></g>`,
  store: `<g class="g"><path d="M6 18l3-11h30l3 11"/><path d="M8 18v24h32V18"/></g><g class="e"><path d="M6 18a6 6 0 0 0 12 0 6 6 0 0 0 12 0 6 6 0 0 0 12 0"/><path d="M19 42V30h10v12"/></g>`,
  heart: `<g class="e"><path d="M24 41S6 30 6 17a9 9 0 0 1 18-3 9 9 0 0 1 18 3c0 13-18 24-18 24z"/></g><g class="g"><path d="M12 22h7l3-5 4 10 3-5h7"/></g>`,
};
export const ICON_NAMES = {
  tree: 'شجرة', events: 'تقويم', feedback: 'محادثة', certificate: 'وثيقة', kinship: 'أقارب', plans: 'جوهرة', account: 'حساب', admin: 'درع', link: 'ربط', scroll: 'وصية',
  star: 'نجمة', news: 'أخبار', book: 'كتاب', support: 'دعم', hall: 'قاعة', gift: 'هدية', phone: 'هاتف', bank: 'بنك', trophy: 'جائزة',
  camera: 'صور', video: 'فيديو', map: 'خريطة', walk: 'مشي', store: 'متجر', heart: 'صحة',
};
export const tileIcon = (name) => `<svg class="tile-ic" viewBox="0 0 48 48" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TILE_ICONS[name] || TILE_ICONS.star}</svg>`;
const num = (n) => Number(n || 0).toLocaleString('en-US');
const isExternal = (href) => /^https:\/\//i.test(href || '');
const linkAttrs = (href) => `href="${esc(href)}"${isExternal(href) ? ' target="_blank" rel="noopener noreferrer"' : ''}`;

export function tileHtml({ href, label, icon: ic, image, dot }) {
  const pic = image ? `<img class="tile-img" src="${esc(image)}" alt="">` : tileIcon(ic);
  return `<a class="tile" ${linkAttrs(href || '#/')}>${dot ? '<i class="dot"></i>' : ''}${pic}<span>${esc(label)}</span></a>`;
}

function slideHtml(b) {
  const tag = b.link ? 'a' : 'div';
  const attrs = b.link ? linkAttrs(b.link) : '';
  const txt = (b.title || b.text) ? `<div class="banner-txt">
      ${b.title ? `<div class="banner-title">${esc(b.title)}</div>` : ''}
      ${b.text ? `<div class="banner-sub">${esc(b.text)}</div>` : ''}</div>` : '';
  if (b.image) {
    return `<${tag} class="banner has-img" ${attrs}><img class="banner-img" src="${esc(b.image)}" alt="${esc(b.title || '')}" loading="lazy">${txt ? `<div class="banner-cap">${txt}</div>` : ''}</${tag}>`;
  }
  return `<${tag} class="banner" ${attrs}>${txt}<div class="banner-seal"><img src="/img/logo-dark.png?v=2" alt=""></div></${tag}>`;
}

function sliderHtml(banners) {
  return `<div class="slider" id="slider">
    <div class="slides">${banners.map(slideHtml).join('')}</div>
    ${banners.length > 1 ? `<div class="slider-dots">${banners.map((_, i) => `<button type="button" data-i="${i}" class="${i ? '' : 'on'}" aria-label="اللافتة ${i + 1}"></button>`).join('')}</div>` : ''}
  </div>`;
}

let sliderTimer = null;
function startSlider(root) {
  clearInterval(sliderTimer);
  const s = $('#slider', root);
  if (!s) return;
  const track = $('.slides', s);
  const n = track.children.length;
  if (n < 2) return;
  let i = 0;
  const go2 = (k) => {
    i = (k + n) % n;
    track.style.transform = `translateX(${i * 100}%)`; // الاتجاه من اليمين لليسار
    s.querySelectorAll('.slider-dots button').forEach((d, j) => d.classList.toggle('on', j === i));
  };
  const auto = () => { clearInterval(sliderTimer); sliderTimer = setInterval(() => { if (!document.body.contains(s)) { clearInterval(sliderTimer); return; } go2(i + 1); }, 5000); };
  s.querySelectorAll('.slider-dots button').forEach((d) => d.onclick = () => { go2(Number(d.dataset.i)); auto(); });
  let x0 = null;
  s.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  s.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 40) { go2(i + (dx > 0 ? 1 : -1)); auto(); }
  });
  auto();
}

export async function render(root) {
  const me = state.me;
  const u = me.user;
  const h = await api('/home');
  state.home = h; state.homeAt = Date.now();
  window.dispatchEvent(new Event('home-loaded'));

  const firstName = (u.full_name || '').trim().split(/\s+/)[0] || '';
  const hello = h.gender === 'female' ? 'أهلًا بنت العم' : h.gender === 'male' ? 'أهلًا ابن العم' : 'أهلًا بك';
  const sub = me.subscription;
  const plan = me.plans_enabled === false ? null : me.plan; // لا معنى لاسم الباقة أثناء إيقاف الباقات
  const memberState = sub && sub.status === 'suspended' ? ['موقوفة', 'bad'] : ['نشطة', 'ok'];
  const linked = !!u.person_id;
  const treeHref = me.tree_access.ok ? '#/tree' : '#/link';
  const isStaff = u.role === 'admin' || u.role === 'moderator';

  const ne = h.next_event;
  const days = ne ? Math.round((Date.parse(ne.starts_at.slice(0, 10)) - Date.parse(h.now.slice(0, 10))) / 864e5) : null;
  const daysTxt = days === 0 ? 'اليوم' : days === 1 ? 'غدًا' : days === 2 ? 'بعد يومين' : `بعد ${days} ${days <= 10 ? 'أيام' : 'يومًا'}`;

  // روابط المربعات المدمجة (تعتمد على حالة العضو)
  const SYS = {
    link: { href: '#/link' },
    tree: { href: treeHref },
    events: { href: '#/events', dot: h.notifications.events_pending > 0 },
    feedback: { href: '#/feedback', dot: h.notifications.replies.length > 0 },
    certificate: { href: linked && hasFeature('tree.certificate') ? `#/certificate/${u.person_id}` : '#/plans' },
    wills: { href: '#/wills' },
    announcements: { href: '#/announcements', dot: (h.notifications.announcements || []).length > 0 },
    kinship: { href: treeHref },
    plans: { href: '#/plans' },
    account: { href: '#/account' },
    admin: { href: '#/admin' },
  };
  const tiles = h.tiles.map((t) => {
    if (t.key === 'members') return `<div class="tile tile-num"><b>${num(h.stats.members)}</b><span>${esc(t.label)}</span></div>`;
    const sys = t.kind === 'system' ? SYS[t.key] : null;
    if (t.kind === 'system' && !sys) return '';
    return tileHtml({ href: sys ? sys.href : t.link, label: t.label, icon: t.icon, image: t.image, dot: sys && sys.dot });
  });

  root.innerHTML = `
    <div class="home">
      <section class="hello">
        <div class="hello-1">${hello}</div>
        <div class="hello-2">${esc(firstName)}</div>
        <div class="hello-3">العضوية: <b class="${memberState[1]}">${memberState[0]}</b>${plan ? ` <span class="sep">·</span> <span style="color:${esc(plan.color)}">${esc(plan.name)}</span>` : ''}</div>
      </section>

      ${!linked && u.role === 'member' ? `<a class="home-alert" href="#/link">${icon('link')} لم تربط حسابك باسمك في المشجرة بعد — اربطه الآن ${icon('chevron')}</a>` : ''}

      ${(h.notifications.announcements || []).slice(0, 2).map((a) => `<a class="ann-alert k-${esc(a.kind)}" href="#/announcements/${a.id}">
        ${icon(KIND_ICON[a.kind] || 'chat')}<div><span class="ann-kind">${esc(NEW_LABEL[a.kind] || NEW_LABEL.general)}</span><b>${esc(a.title)}</b></div>${icon('chevron')}</a>`).join('')}

      ${h.banners.length ? sliderHtml(h.banners) : ''}

      ${h.sections.stats ? `<a class="stats-card" href="${treeHref}">
        <div class="row between stats-head"><span>العائلة في أرقام</span>${icon('chevron')}</div>
        <div class="stats-main">
          <div class="st">${icon('users', 'st-ic')}<div><div class="st-k">أفراد المشجرة</div><div class="st-v">${num(h.stats.persons)} <small>فرد</small></div></div></div>
          <div class="st">${icon('layers', 'st-ic')}<div><div class="st-k">عدد الأجيال</div><div class="st-v">${num(h.stats.generations)} <small>جيل</small></div></div></div>
        </div>
        <div class="row between stats-foot">
          <span>الحسابات المرتبطة <b>${num(h.stats.linked)}</b></span>
          ${me.modules && me.modules.events === false ? `<span>الأعضاء المسجلون <b>${num(h.stats.members)}</b></span>` : `<span>المناسبات القادمة <b>${num(h.stats.upcoming_events)}</b></span>`}
        </div>
      </a>` : ''}

      ${ne && h.sections.next_event ? `<a class="next-ev" href="#/events">
        <div class="ne-date"><b>${new Date(ne.starts_at.slice(0, 10) + 'T00:00:00Z').getUTCDate()}</b><span>${esc(new Date(ne.starts_at.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'UTC', month: 'short' }))}</span></div>
        <div class="ne-body">
          <div class="ne-k">المناسبة القادمة · <b>${daysTxt}</b></div>
          <div class="ne-t">${esc(ne.title)}</div>
          <div class="ne-m">${esc(evDate(ne.starts_at))} · ${esc(evTime(ne.starts_at))}${ne.location ? ` · ${esc(ne.location)}` : ''}</div>
        </div>
        <span class="ne-r">${ne.my_rsvp ? esc(LABELS.rsvp[ne.my_rsvp]) : 'أكّد حضورك'}</span>
      </a>` : ''}

      <section class="tiles">${tiles.join('')}</section>
    </div>`;
  startSlider(root);
}

/** نافذة الإشعارات (زر صندوق الوارد في الأعلى) */
export function openInbox() {
  const h = state.home;
  const n = h ? h.notifications : { replies: [], events_pending: 0, announcements: [] };
  const items = [
    ...(n.announcements || []).map((a) => `<a class="nt" href="#/announcements/${a.id}">${icon(KIND_ICON[a.kind] || 'chat')}<div><b>${esc(NEW_LABEL[a.kind] || NEW_LABEL.general)}</b><div class="muted small">${esc(a.title)}</div></div></a>`),
    ...n.replies.map((r) => `<a class="nt" href="#/feedback">${icon('chat')}<div><b>رد جديد من الإدارة</b><div class="muted small">${esc(r.subject)}</div></div></a>`),
    n.events_pending ? `<a class="nt" href="#/events">${icon('calendar')}<div><b>${n.events_pending === 1 ? 'مناسبة قادمة بانتظار ردّك' : `${n.events_pending} مناسبات قادمة بانتظار ردّك`}</b><div class="muted small">أكّد حضورك ليعرف المنظمون العدد</div></div></a>` : '',
  ].filter(Boolean);
  modal(`<h3>الإشعارات</h3>
    <div class="nts">${items.length ? items.join('') : `<div class="empty">${icon('inbox')}<p>لا توجد إشعارات جديدة</p></div>`}</div>
    <div class="actions"><button class="btn secondary" data-close>إغلاق</button></div>`, (m, close) => {
    m.querySelectorAll('a.nt').forEach((a) => a.addEventListener('click', close));
  });
}
