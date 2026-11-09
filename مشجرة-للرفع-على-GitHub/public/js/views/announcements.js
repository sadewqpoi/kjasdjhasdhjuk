import { state, api, esc, go, icon, date } from '../core.js';

function guard() {
  const me = state.me;
  if (!me || !me.user) { go('#/login'); return false; }
  if (!me.user.phone_verified) { go('#/verify'); return false; }
  return true;
}

export const KIND_ICON = { invitation: 'gift', announcement: 'news', congrats: 'star', condolence: 'heart', general: 'chat' };
const excerpt = (s, n = 160) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
const refreshBadges = () => { state.homeAt = 0; window.dispatchEvent(new Event('me-changed')); };

export async function list(root) {
  if (!guard()) return;
  const d = await api('/announcements');
  root.innerHTML = `
    <div class="mid">
      <div class="row between" style="margin-bottom:14px">
        <h1 style="margin:0">الدعوات والإعلانات</h1>
        ${d.unread ? '<button class="btn sm secondary" id="ra">تحديد الكل كمقروء</button>' : ''}
      </div>
      ${d.items.length ? `<div class="ann-list">${d.items.map((a) => `
        <a class="card ann-card ${a.read ? '' : 'unread'} k-${esc(a.kind)}" href="#/announcements/${a.id}">
          ${a.image ? `<img class="ann-thumb" src="${esc(a.image)}" alt="" loading="lazy">` : `<span class="ann-ic">${icon(KIND_ICON[a.kind] || 'chat')}</span>`}
          <div class="ann-c">
            <div class="row between"><span class="ann-kind">${esc(a.kind_label)}</span><span class="small muted">${date(a.created_at, true)}</span></div>
            <h3>${a.read ? '' : '<i class="dot"></i>'}${esc(a.title)}</h3>
            <p>${esc(excerpt(a.body))}</p>
          </div>
        </a>`).join('')}</div>`
        : `<div class="card empty">${icon('inbox')}<p>لا توجد رسائل بعد.</p></div>`}
    </div>`;
  const ra = root.querySelector('#ra');
  if (ra) ra.onclick = async () => { await api('/announcements/read-all', { method: 'POST' }); refreshBadges(); list(root); };
}

export async function show(root, { id }) {
  if (!guard()) return;
  const a = await api(`/announcements/${Number(id)}`);
  refreshBadges();
  root.innerHTML = `
    <div class="mid">
      <a class="back-link" href="#/announcements">${icon('chevron')} كل الرسائل</a>
      <article class="card ann-full k-${esc(a.kind)}">
        <span class="ann-kind">${icon(KIND_ICON[a.kind] || 'chat')} ${esc(a.kind_label)}</span>
        <h1>${esc(a.title)}</h1>
        <div class="small muted">${date(a.created_at, true)}${a.sender ? ` · من: ${esc(a.sender)}` : ''}</div>
        ${a.image ? `<figure class="ann-img"><a href="${esc(a.image)}" target="_blank" rel="noopener"><img src="${esc(a.image)}" alt="${esc(a.title)}"></a></figure>` : ''}
        <div class="ann-body">${esc(a.body)}</div>
      </article>
    </div>`;
}
