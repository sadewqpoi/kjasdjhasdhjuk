import { state, api, esc, go, icon } from '../core.js';

function guard() {
  const me = state.me;
  if (!me || !me.user) { go('#/login'); return false; }
  if (!me.user.phone_verified) { go('#/verify'); return false; }
  return true;
}

const excerpt = (s, n = 180) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
const meta = (w) => [w.author ? `${icon('users')} ${esc(w.author)}` : '', w.will_date ? `${icon('calendar')} ${esc(w.will_date)}` : '']
  .filter(Boolean).map((x) => `<span>${x}</span>`).join('');

/** قائمة الوصايا (ويمكن تصفيتها بصاحبها: #/wills?person=ID) */
export async function list(root, { query }) {
  if (!guard()) return;
  const pid = query && query.get('person');
  const d = await api(`/wills${pid ? `?person_id=${Number(pid)}` : ''}`);
  const who = pid && d.items[0] ? d.items[0].author : null;
  root.innerHTML = `
    <div class="mid">
      <div class="wills-head">
        <h1>${icon('scroll')} وصايا الأجداد</h1>
        <p class="muted">${who ? `وصايا ${esc(who)} — <a href="#/wills">عرض كل الوصايا</a>` : 'ما تركه الآباء والأجداد من وصايا ونصائح لأبنائهم وأحفادهم.'}</p>
      </div>
      ${d.items.length ? `<div class="wills">${d.items.map((w) => `
        <a class="card will-card" href="#/wills/${w.id}">
          ${w.image ? `<img class="will-thumb" src="${esc(w.image)}" alt="" loading="lazy">` : ''}
          <div class="will-c">
            <h3>${esc(w.title)}</h3>
            <div class="will-meta">${meta(w)}</div>
            <p>${esc(excerpt(w.body))}</p>
            <span class="will-more">اقرأ الوصية ${icon('chevron')}</span>
          </div>
        </a>`).join('')}</div>`
        : `<div class="card empty">${icon('scroll')}<p>لا توجد وصايا منشورة بعد.</p></div>`}
    </div>`;
}

/** صفحة الوصية كاملة */
export async function show(root, { id }) {
  if (!guard()) return;
  const w = await api(`/wills/${Number(id)}`);
  root.innerHTML = `
    <div class="mid">
      <a class="back-link" href="#/wills">${icon('chevron')} كل الوصايا</a>
      <article class="card will-full">
        <div class="will-ornament" aria-hidden="true"></div>
        <h1>${esc(w.title)}</h1>
        <div class="will-meta">${meta(w)}${w.person_id && state.me.tree_access.ok ? `<span><a href="#/tree" data-person="${w.person_id}">${icon('tree')} في المشجرة</a></span>` : ''}</div>
        <div class="will-body">${esc(w.body)}</div>
        ${w.source ? `<p class="will-src">المصدر / الراوي: ${esc(w.source)}</p>` : ''}
        ${w.image ? `<figure class="will-img"><a href="${esc(w.image)}" target="_blank" rel="noopener"><img src="${esc(w.image)}" alt="صورة الوصية الأصلية"></a><figcaption class="small muted">صورة الوصية الأصلية</figcaption></figure>` : ''}
        <div class="row no-print" style="margin-top:18px"><button class="btn secondary sm" id="pr">طباعة</button></div>
      </article>
    </div>`;
  root.querySelector('#pr').onclick = () => window.print();
  const tp = root.querySelector('[data-person]');
  if (tp) tp.onclick = () => { sessionStorage.setItem('treeFocus', tp.dataset.person); };
}
