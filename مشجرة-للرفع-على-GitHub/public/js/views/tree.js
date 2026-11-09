import { state, api, esc, $, $$, alertBox, hasFeature, initials, go, nextStep, date, icon } from '../core.js';

let T = null; // حالة الشجرة الحالية

// ميزة موقوفة من الإدارة لا يُعرض لها صندوق "ترقية"، وكذلك عند إيقاف الباقات
const FEATURE_OF = { 'تواريخ الميلاد والوفاة': 'person.dates', 'الصورة الشخصية': 'person.photos', 'رقم التواصل': 'person.contact', 'حاسبة صلة القرابة': 'tree.relationship', 'إحصائيات العائلة': 'tree.stats' };
const lockedBox = (text) => {
  const me = state.me || {};
  if ((me.disabled_features || []).includes(FEATURE_OF[text]) || me.plans_enabled === false) return '';
  return `<div class="locked">${icon('lock')} <span>${esc(text)} — <a href="#/plans">ترقية الباقة</a></span></div>`;
};

export async function render(root) {
  const me = state.me;
  if (!me || !me.user) { go('#/login'); return; }
  if (!me.tree_access.ok) { go(nextStep()); return; }
  if (!hasFeature('tree.view')) {
    root.innerHTML = `<div class="card narrow" style="margin-top:30px">${alertBox('مشاهدة المشجرة غير متاحة في باقتك الحالية', 'warn')}<a class="btn" href="#/plans">عرض الباقات</a></div>`;
    return;
  }
  root.innerHTML = `
    <div class="tree-page">
      <aside class="tree-side" id="side"></aside>
      <section class="tree-main" id="viewport">
        <div class="tree-toolbar">
          <div class="search">
            ${hasFeature('tree.search') ? `<input id="q" placeholder="ابحث عن فرد في العائلة…" autocomplete="off"><div class="search-results hidden" id="sr"></div>`
              : `<input disabled placeholder="البحث غير متاح في باقتك">`}
          </div>
          <div class="zoom">
            <button id="zin" title="تكبير">+</button><button id="zout" title="تصغير">−</button>
            <button id="zfit" title="الوسط">⌖</button><button id="zall" title="توسيع الكل">⇲</button><button id="zcol" title="طي الكل">⇱</button>
          </div>
        </div>
        <div class="tree-canvas" id="canvas"></div>
      </section>
    </div>`;

  const data = await api('/tree');
  const byId = new Map(); const kids = new Map(); const roots = [];
  for (const n of data.nodes) { byId.set(n.id, n); kids.set(n.id, []); }
  for (const n of data.nodes) { if (n.f && kids.has(n.f)) kids.get(n.f).push(n.id); else roots.push(n.id); }
  T = { byId, kids, roots, me: data.me, expanded: new Set(), x: 0, y: 0, s: 1, selected: null };

  // التوسيع المبدئي: أول جيلين + مسار المستخدم
  const depth = (id) => { let d = 0; let c = byId.get(id); while (c && c.f) { d++; c = byId.get(c.f); } return d; };
  for (const n of data.nodes) if (depth(n.id) < 2) T.expanded.add(n.id);
  if (T.me) expandPath(T.me);

  draw();
  setupPanZoom();
  focusNode(T.me || roots[0], false);
  showDefaultSide();
  if (T.me) selectPerson(T.me);
  // قادم من صفحة أخرى لعرض شخص محدد (مثل صاحب وصية)
  let tf = null;
  try { tf = Number(sessionStorage.getItem('treeFocus')); sessionStorage.removeItem('treeFocus'); } catch { /* ignore */ }
  if (tf && byId.has(tf)) revealAndSelect(tf);

  if (hasFeature('tree.search')) setupSearch();
  $('#zin').onclick = () => zoomBy(1.2);
  $('#zout').onclick = () => zoomBy(1 / 1.2);
  $('#zfit').onclick = () => focusNode(T.selected || T.me || T.roots[0]);
  $('#zall').onclick = () => { for (const [id, k] of T.kids) if (k.length) T.expanded.add(id); draw(); };
  $('#zcol').onclick = () => { T.expanded = new Set(T.roots); draw(); focusNode(T.roots[0]); };
}

function expandPath(id) {
  let c = T.byId.get(id);
  while (c && c.f) { T.expanded.add(c.f); c = T.byId.get(c.f); }
}

function nodeHtml(id) {
  const n = T.byId.get(id);
  const k = T.kids.get(id);
  const open = T.expanded.has(id);
  const cls = ['node', n.g === 'f' ? 'f' : '', n.d ? 'd' : '', id === T.me ? 'me' : ''].join(' ');
  const av = n.ph ? `<img src="/api/persons/${id}/photo" alt="" loading="lazy">` : initials(n.n);
  const li = `<li><div class="${cls}" data-id="${id}">
      ${n.a ? '<span class="acc" title="لديه حساب"></span>' : ''}
      <div class="av">${av}</div><div class="nm">${esc(n.n)}</div>${n.d ? '<div class="dc">رحمه الله</div>' : ''}
      ${k.length ? `<span class="tg" data-tg="${id}" title="${open ? 'طي' : 'عرض الأبناء'}">${open ? '−' : k.length}</span>` : ''}
    </div>`;
  return li + (k.length && open ? `<ul>${k.map(nodeHtml).join('')}</ul>` : '') + '</li>';
}

function draw() {
  const c = $('#canvas');
  c.innerHTML = `<ul class="org">${T.roots.map(nodeHtml).join('')}</ul>`;
  applyTransform();
}

function applyTransform() {
  const c = $('#canvas');
  if (c) c.style.transform = `translate(${T.x}px, ${T.y}px) scale(${T.s})`;
}

function zoomBy(f, cx, cy) {
  const vp = $('#viewport').getBoundingClientRect();
  const px = cx ?? vp.width / 2; const py = cy ?? vp.height / 2;
  const ns = Math.min(2.5, Math.max(0.15, T.s * f));
  T.x = px - (px - T.x) * (ns / T.s);
  T.y = py - (py - T.y) * (ns / T.s);
  T.s = ns;
  applyTransform();
}

/** تحريك العرض ليكون الشخص في المنتصف */
function focusNode(id, highlight = true) {
  const el = $(`.node[data-id="${id}"]`);
  if (!el) return;
  const vp = $('#viewport').getBoundingClientRect();
  const r = el.getBoundingClientRect();
  T.x += vp.left + vp.width / 2 - (r.left + r.width / 2);
  T.y += vp.top + vp.height / 3 - (r.top + r.height / 2);
  applyTransform();
  if (highlight) { el.classList.remove('hl'); void el.offsetWidth; el.classList.add('hl'); }
}

function setupPanZoom() {
  const vp = $('#viewport');
  // canvas يبدأ من الزاوية العلوية اليسرى لتسهيل الحسابات
  $('#canvas').style.right = 'auto'; $('#canvas').style.left = '0';
  // السحب بإصبع واحد، والتكبير والتصغير بإصبعين (Pinch) حول نقطة المنتصف
  const pts = new Map();
  let drag = null; let pinch = null; let moved = false; let nodeStart = null;
  const pair = () => { const [a, b] = [...pts.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
  const startDrag = (p) => { drag = { x: p.x, y: p.y, ox: T.x, oy: T.y }; vp.classList.add('dragging'); };
  vp.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.tree-toolbar')) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      moved = false; nodeStart = null;
      if (!e.target.closest('.node')) { startDrag(pts.get(e.pointerId)); vp.setPointerCapture(e.pointerId); }
      else nodeStart = { x: e.clientX, y: e.clientY };
    } else if (pts.size === 2) {
      drag = null; moved = true;
      const r = vp.getBoundingClientRect(); const p = pair();
      pinch = { d: p.d, s: T.s, mx: p.mx - r.left, my: p.my - r.top, x: T.x, y: T.y };
    }
  });
  vp.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size >= 2) {
      const r = vp.getBoundingClientRect(); const p = pair();
      const ns = Math.min(2.5, Math.max(0.15, pinch.s * (p.d / pinch.d)));
      const mx = p.mx - r.left; const my = p.my - r.top;
      // النقطة التي كانت تحت منتصف الإصبعين تبقى تحتهما (تكبير + تحريك معًا)
      T.x = mx - (pinch.mx - pinch.x) * (ns / pinch.s);
      T.y = my - (pinch.my - pinch.y) * (ns / pinch.s);
      T.s = ns; applyTransform();
      return;
    }
    if (!drag) {
      // بدأ اللمس على بطاقة شخص: يتحول إلى سحب إذا تحرك الإصبع بوضوح
      if (pts.size === 1 && nodeStart && e.pointerType !== 'mouse' && Math.hypot(e.clientX - nodeStart.x, e.clientY - nodeStart.y) > 8) {
        startDrag(prev); moved = true;
      }
      if (!drag) return;
    }
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 6) moved = true;
    T.x = drag.ox + e.clientX - drag.x; T.y = drag.oy + e.clientY - drag.y; applyTransform();
  });
  const end = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 1) { startDrag([...pts.values()][0]); } // أكمل بالسحب بالإصبع المتبقي
    else if (!pts.size) { drag = null; vp.classList.remove('dragging'); }
  };
  vp.addEventListener('pointerup', end); vp.addEventListener('pointercancel', end);
  // منع فتح بطاقة الشخص إذا كانت الحركة سحبًا أو تكبيرًا
  vp.addEventListener('click', (e) => { if (moved && e.target.closest('.node')) { e.stopPropagation(); e.preventDefault(); } moved = false; }, true);
  // Safari: منع تكبير الصفحة كلها بالإيماءة داخل منطقة الشجرة
  vp.addEventListener('gesturestart', (e) => e.preventDefault());
  vp.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  $('#canvas').addEventListener('click', (e) => {
    const tg = e.target.closest('[data-tg]');
    if (tg) {
      const id = Number(tg.dataset.tg);
      const before = $(`.node[data-id="${id}"]`).getBoundingClientRect();
      if (T.expanded.has(id)) T.expanded.delete(id); else T.expanded.add(id);
      draw();
      // تثبيت موضع العقدة بعد إعادة الرسم
      const after = $(`.node[data-id="${id}"]`).getBoundingClientRect();
      T.x += before.left - after.left; T.y += before.top - after.top; applyTransform();
      return;
    }
    const node = e.target.closest('.node');
    if (node) selectPerson(Number(node.dataset.id));
  });
}

function setupSearch() {
  const q = $('#q'); const sr = $('#sr');
  let t;
  q.addEventListener('input', () => {
    clearTimeout(t);
    const v = q.value.trim();
    if (v.length < 2) { sr.classList.add('hidden'); return; }
    t = setTimeout(async () => {
      try {
        const r = await api(`/tree/search?q=${encodeURIComponent(v)}`);
        sr.innerHTML = r.results.length ? r.results.map((x) => `<div data-id="${x.id}">${esc(x.full_name)}</div>`).join('') : '<div class="muted">لا توجد نتائج</div>';
        sr.classList.remove('hidden');
      } catch (e) { sr.innerHTML = `<div>${esc(e.message)}</div>`; sr.classList.remove('hidden'); }
    }, 250);
  });
  sr.addEventListener('click', (e) => {
    const d = e.target.closest('[data-id]');
    if (!d) return;
    sr.classList.add('hidden'); q.value = '';
    revealAndSelect(Number(d.dataset.id));
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) sr.classList.add('hidden'); });
}

function revealAndSelect(id) {
  expandPath(id); draw(); focusNode(id); selectPerson(id);
}

function showDefaultSide() {
  $('#side').innerHTML = '<p class="muted">اختر شخصًا من المشجرة لعرض بطاقته.</p>';
}

async function selectPerson(id) {
  T.selected = id;
  const side = $('#side');
  side.innerHTML = '<p class="muted">جارٍ التحميل…</p>';
  let p;
  try { p = await api(`/persons/${id}`); } catch (e) { side.innerHTML = alertBox(e.message); return; }
  const f = p.gender === 'female';
  side.innerHTML = `
    <div class="person-card stack">
      <div class="row">
        ${p.photo_url ? `<img class="ph" src="${p.photo_url}" alt="">` : `<div class="ph">${initials(p.name)}</div>`}
        <div><h2 style="margin:0">${esc(p.name)}</h2>
          ${p.is_me ? '<span class="badge ok">أنت</span>' : ''} ${p.has_account ? '<span class="badge info">عضو مسجل</span>' : ''}
          ${p.is_deceased ? `<span class="badge">${f ? 'رحمها الله' : 'رحمه الله'}</span>` : ''}</div>
      </div>
      <p style="margin:0">${esc(p.full_name)}</p>
      <dl class="kv">
        <dt>الجيل</dt><dd>${p.generation}</dd>
        <dt>الجنس</dt><dd>${f ? 'أنثى' : 'ذكر'}</dd>
        ${p.father ? `<dt>${'الأب'}</dt><dd><a href="#" data-go="${p.father.id}">${esc(p.father.name)}</a></dd>` : ''}
        ${'birth_date' in p ? `<dt>تاريخ الميلاد</dt><dd>${p.birth_date ? esc(p.birth_date) : '<span class="muted">غير متاح</span>'}</dd>` : ''}
        ${'death_date' in p && p.is_deceased ? `<dt>تاريخ الوفاة</dt><dd>${esc(p.death_date || '—')}</dd>` : ''}
        ${'phone' in p ? `<dt>الجوال</dt><dd dir="ltr" style="text-align:right">${p.phone ? '+' + esc(p.phone) : '<span class="muted">غير متاح</span>'}</dd>` : ''}
        ${p.code ? `<dt>الرقم المرجعي</dt><dd>${esc(p.code)}</dd>` : ''}
      </dl>
      ${p.relation ? `<div class="alert ok" style="margin:0">صلة القرابة: <b>${esc(p.relation.text)}</b>${p.relation.ancestor ? `<br><span class="small">الجد المشترك: ${esc(p.relation.ancestor.name)}</span>` : ''}</div>` : ''}
      ${p.locked.includes('person.dates') ? lockedBox('تواريخ الميلاد والوفاة') : ''}
      ${p.locked.includes('person.photos') ? lockedBox('الصورة الشخصية') : ''}
      ${p.locked.includes('person.contact') && p.has_account ? lockedBox('رقم التواصل') : ''}
      ${!p.relation && !p.is_me && state.me.user.person_id && !hasFeature('tree.relationship') ? lockedBox('حاسبة صلة القرابة') : ''}
      ${p.children.length ? `<div><h3>الأبناء (${p.children.length})</h3><div class="chips">${p.children.map((c) => `<span class="chip ${c.gender === 'female' ? 'f' : ''}" data-go="${c.id}">${esc(c.name)}</span>`).join('')}</div></div>` : ''}
      <div class="row">
        ${p.wills_count ? `<a class="btn sm gold" href="#/wills?person=${p.id}">${icon('scroll')} ${p.wills_count > 1 ? `وصاياه (${p.wills_count})` : f ? 'وصيتها' : 'وصيته'}</a>` : ''}
        ${hasFeature('tree.certificate') ? `<a class="btn sm secondary" href="#/certificate/${p.id}">${icon('doc')} وثيقة النسب</a>` : ''}
        ${hasFeature('tree.export') && p.children.length ? `<a class="btn sm secondary" href="/api/persons/${p.id}/export.csv">⬇ تصدير الذرية</a>` : ''}
      </div>
      <hr style="border:0;border-top:1px solid var(--line);width:100%">
      <div id="tools"></div>
    </div>`;
  $$('[data-go]', side).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); revealAndSelect(Number(a.dataset.go)); }));
  renderTools();
}

async function renderTools() {
  const box = $('#tools');
  if (!box) return;
  let html = '';
  if (hasFeature('tree.stats')) {
    try {
      const s = await api('/tree/stats');
      html += `<h3>${icon('chart')} إحصائيات العائلة</h3><dl class="kv small">
        <dt>عدد الأفراد</dt><dd>${s.total}</dd><dt>الذكور</dt><dd>${s.male}</dd><dt>الإناث</dt><dd>${s.female}</dd>
        <dt>الأحياء</dt><dd>${s.living}</dd><dt>الأجيال</dt><dd>${Object.keys(s.generations).length}</dd><dt>حسابات مرتبطة</dt><dd>${s.linked_accounts}</dd></dl>`;
    } catch { /* ignore */ }
  } else html += lockedBox('إحصائيات العائلة');
  if (hasFeature('tree.relationship')) {
    html += `<h3 style="margin-top:16px">${icon('compass')} حاسبة القرابة</h3>
      <p class="small muted">احسب صلة القرابة بين الشخص المحدد وأي شخص آخر.</p>
      <div class="search" style="position:relative"><input id="rq" placeholder="ابحث عن الشخص الآخر"><div class="search-results hidden" id="rr"></div></div>
      <div id="rout" style="margin-top:8px"></div>`;
  } else html += lockedBox('حاسبة صلة القرابة');
  box.innerHTML = html;
  const rq = $('#rq');
  if (rq) {
    let t;
    rq.oninput = () => {
      clearTimeout(t);
      const v = rq.value.trim();
      if (v.length < 2) return $('#rr').classList.add('hidden');
      t = setTimeout(async () => {
        const r = await api(`/tree/search?q=${encodeURIComponent(v)}`).catch(() => ({ results: [] }));
        $('#rr').innerHTML = r.results.map((x) => `<div data-id="${x.id}">${esc(x.full_name)}</div>`).join('') || '<div class="muted">لا نتائج</div>';
        $('#rr').classList.remove('hidden');
      }, 250);
    };
    $('#rr').onclick = async (e) => {
      const d = e.target.closest('[data-id]'); if (!d) return;
      $('#rr').classList.add('hidden');
      try {
        const r = await api(`/tree/relationship?a=${Number(d.dataset.id)}&b=${T.selected}`);
        $('#rout').innerHTML = `<div class="alert ok small">${esc(r.b.name)} هو/هي <b>${esc(r.text)}</b> بالنسبة إلى ${esc(r.a.name)}${r.ancestor ? `<br>الجد المشترك: ${esc(r.ancestor.name)}` : ''}</div>`;
      } catch (err) { $('#rout').innerHTML = alertBox(err.message); }
    };
  }
}
