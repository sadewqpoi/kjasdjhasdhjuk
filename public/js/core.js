// أدوات مشتركة للواجهة

export const state = { me: null };

export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' };
  if (form) opts.body = form;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const res = await fetch('/api' + path, opts);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const e = new Error((data && data.error) || 'حدث خطأ غير متوقع');
    e.status = res.status; e.code = data && data.code;
    throw e;
  }
  return data;
}

export async function refreshMe() {
  state.me = await api('/auth/me');
  return state.me;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => (v == null ? '' : String(v).replace(/[&<>"']/g, (c) => ESC[c]));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function money(halalas, currency = 'SAR') {
  const v = (Number(halalas) || 0) / 100;
  return `${v.toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })} ${currency === 'SAR' ? 'ر.س' : currency}`;
}

export function date(iso, withTime = false) {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { year: 'numeric', month: 'short', day: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) });
}

export function daysLeft(iso) {
  return Math.ceil((Date.parse(iso) - Date.now()) / 864e5);
}

export const LABELS = {
  sub: { active: ['فعّال', 'ok'], expired: ['منتهي', 'danger'], cancelled: ['ملغي', 'danger'], suspended: ['موقوف', 'warn'], replaced: ['مستبدل', 'info'] },
  pay: { initiated: ['بانتظار الدفع', 'warn'], paid: ['مدفوع', 'ok'], failed: ['فشل', 'danger'], refunded: ['مسترد', 'info'], cancelled: ['ملغي', 'danger'] },
  req: { pending: ['قيد المراجعة', 'warn'], approved: ['مقبول', 'ok'], rejected: ['مرفوض', 'danger'], cancelled: ['ملغي', 'info'] },
  purpose: { new: 'اشتراك جديد', renew: 'تجديد', upgrade: 'ترقية', downgrade: 'تخفيض' },
  source: { payment: 'دفع إلكتروني', manual: 'يدوي من الإدارة' },
  privacy: { members: 'جميع أعضاء العائلة', relatives: 'الأقارب المقربون فقط', none: 'لا أحد' },
  role: { member: 'عضو', moderator: 'مشرف', admin: 'مدير عام' },
  fb: { new: ['جديد', 'warn'], answered: ['تم الرد', 'ok'], closed: ['مغلق', 'info'] },
  fbType: { suggestion: 'اقتراح', inquiry: 'استفسار' },
  rsvp: { yes: 'سأحضر', maybe: 'ربما', no: 'لن أحضر' },
};
export function badge(group, key) {
  const v = LABELS[group][key] || [key, ''];
  return `<span class="badge ${v[1]}">${esc(v[0])}</span>`;
}

export function toast(msg, ms = 2800) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export function alertBox(msg, type = 'error') {
  return msg ? `<div class="alert ${type}">${esc(msg)}</div>` : '';
}

/** نافذة منبثقة: content = HTML، onMount(root, close) */
export function modal(html, onMount, { large = false, onClose = null } = {}) {
  const root = document.getElementById('modalRoot');
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${large ? 'lg' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  document.addEventListener('keydown', onKey);
  root.appendChild(bg);
  $$('[data-close]', bg).forEach((b) => b.addEventListener('click', close));
  if (onMount) onMount(bg.firstElementChild, close);
  return close;
}

/** نافذة تأكيد. تُرجع null عند الإلغاء أو الإغلاق؛ ومع check تُرجع 'checked' أو true حسب حالة الخيار */
export function confirmDialog(message, { ok = 'تأكيد', danger = false, input = null, check = null } = {}) {
  return new Promise((resolve) => {
    let result = null;
    modal(`<h3>${esc(message)}</h3>
      ${input ? `<div class="field"><label>${esc(input)}</label><textarea rows="3" id="cdIn"></textarea></div>` : ''}
      ${check ? `<label class="check"><input type="checkbox" id="cdChk" checked> ${esc(check)}</label>` : ''}
      <div class="actions"><button class="btn ${danger ? 'danger' : ''}" id="cdOk">${esc(ok)}</button><button class="btn secondary" data-close>إلغاء</button></div>`,
    (m, close) => {
      $('#cdOk', m).onclick = () => {
        result = input ? $('#cdIn', m).value : check ? ($('#cdChk', m).checked ? 'checked' : true) : true;
        close();
      };
    }, { onClose: () => resolve(result) });
  });
}

/** ربط نموذج بمعالج إرسال مع عرض الأخطاء وتعطيل الزر */
export function bindForm(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    const errBox = form.querySelector('.form-error');
    if (errBox) errBox.innerHTML = '';
    if (btn) btn.disabled = true;
    try { await handler(new FormData(form)); } catch (err) {
      if (errBox) errBox.innerHTML = alertBox(err.message); else toast(err.message);
    } finally { if (btn) btn.disabled = false; }
  });
}

export function initials(name) { return esc((name || '?').trim().charAt(0)); }

export function can(perm) {
  const me = state.me;
  return !!(me && me.user && (me.user.role === 'admin' || (me.permissions || []).includes(perm)));
}
export function hasFeature(key) { return !!(state.me && (state.me.features || []).includes(key)); }

/** توجيه المستخدم للخطوة التالية في رحلة التسجيل */
export function nextStep() {
  const me = state.me;
  if (!me || !me.user) return '#/login';
  if (!me.user.phone_verified) return '#/verify';
  if (me.tree_access && me.tree_access.ok) return '#/';
  return '#/link';
}

/** أيقونات خطية بسيطة (SVG) تأخذ لون النص الحالي */
const ICONS = {
  tree: '<path d="M12 21v-8M12 13l-5-4M12 11l5-5"/><circle cx="7" cy="8" r="2.2"/><circle cx="17" cy="5" r="2.2"/><circle cx="12" cy="13" r="2.2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  gem: '<path d="M6 4h12l3 5-9 11L3 9z"/><path d="M3 9h18M9 4l3 16 3-16"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  print: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="7" rx="2"/><path d="M7 14h10v6H7z"/>',
  doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
  scroll: '<path d="M7 4h11a2 2 0 0 1 2 2v1h-4"/><path d="M16 7v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1h10v1a2 2 0 0 0 2 2"/><path d="M7 4a2 2 0 0 0-2 2v11M9 9h4M9 13h4"/>',
  chart: '<path d="M4 20h16M7 16v-5M12 16V7M17 16v-8"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  gift: '<rect x="4" y="9" width="16" height="4" rx="1"/><path d="M5.5 13v7h13v-7M12 9v11M12 9c-1.5-3-6-4-6-1 0 1.5 3 1 6 1zM12 9c1.5-3 6-4 6-1 0 1.5-3 1-6 1z"/>',
  news: '<path d="M3 10v4h3l7 4V6L6 10z"/><path d="M6 14l1.5 5h2.5l-1-4.5M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.8L12 16.8l-5.3 2.8 1.1-5.8-4.3-4.1 5.9-.8z"/>',
  heart: '<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"/>',
  send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
  whatsapp: '<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 1c-1 0-2.5-1.5-2.5-2.5l1-1-1-2z"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.6M12 16.6v.4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  inbox: '<path d="M3.5 13.5l2.5-8h12l2.5 8V19H3.5z"/><path d="M3.5 13.5h5l1 2h5l1-2h5"/>',
  chevron: '<path d="M14.5 6l-6 6 6 6"/>',
  bank: '<path d="M3.5 9.5L12 4l8.5 5.5"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3.5 20h17"/>',
  layers: '<path d="M12 4l8.5 4.5L12 13 3.5 8.5z"/><path d="M3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5"/>',
};

/** تنسيق موعد محلي (YYYY-MM-DDTHH:MM بتوقيت السعودية) دون تحويل منطقة زمنية */
export function evDate(s, { weekday = true, hijri = false } = {}) {
  if (!s) return '—';
  const d = new Date(s.slice(0, 16) + ':00Z');
  if (Number.isNaN(d.getTime())) return s;
  const cal = hijri ? 'islamic-umalqura' : 'gregory';
  return d.toLocaleDateString(`ar-SA-u-ca-${cal}-nu-latn`, { timeZone: 'UTC', ...(weekday ? { weekday: 'long' } : {}), year: 'numeric', month: 'long', day: 'numeric' });
}
export function evTime(s) {
  if (!s) return '';
  const d = new Date(s.slice(0, 16) + ':00Z');
  return d.toLocaleTimeString('ar-SA-u-nu-latn', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
}
export function icon(name, cls = '') {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

export function go(hash) { if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = hash; }
