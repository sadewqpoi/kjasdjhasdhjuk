import { state, api, refreshMe, esc, $, $$, money, date, badge, LABELS, alertBox, toast, bindForm, go, modal, confirmDialog, can, icon } from '../core.js';
import { eventCard } from './community.js';
import { tileIcon, ICON_NAMES } from './home.js';

const TABS = [
  ['overview', 'نظرة عامة', 'stats.view'],
  ['broadcast', 'الرسائل الجماعية', 'announcements.send'],
  ['requests', 'طلبات الربط والإضافة', 'requests.review'],
  ['persons', 'أفراد المشجرة', 'tree.manage'],
  ['plans', 'الباقات والمميزات', 'plans.manage'],
  ['subscriptions', 'الاشتراكات', 'subscriptions.manage'],
  ['payments', 'المدفوعات', 'payments.view'],
  ['gateways', 'بوابات الدفع', 'settings.manage'],
  ['home', 'الصفحة الرئيسية', 'home.manage'],
  ['events', 'المناسبات', 'events.manage'],
  ['wills', 'وصايا الأجداد', 'wills.manage'],
  ['feedback', 'الاقتراحات والاستفسارات', 'feedback.manage'],
  ['users', 'المستخدمون', 'users.manage'],
  ['staff', 'المشرفون والصلاحيات', 'staff.manage'],
  ['settings', 'الإعدادات', 'settings.manage'],
  ['audit', 'سجل العمليات', 'audit.view'],
];

export async function render(root, { tab }) {
  const me = state.me;
  if (!me || !me.user) { go('#/login'); return; }
  const allowed = TABS.filter(([, , p]) => can(p));
  if (!allowed.length) { root.innerHTML = alertBox('غير مصرح لك بالدخول إلى لوحة الإدارة'); return; }
  const cur = allowed.find((t) => t[0] === tab) || allowed[0];
  root.innerHTML = `<h1>لوحة الإدارة</h1>
    <nav class="tabs">${allowed.map(([k, t]) => `<a href="#/admin/${k}" class="${k === cur[0] ? 'on' : ''}" data-tab="${k}">${t}</a>`).join('')}</nav>
    <div id="panel"><p class="muted">جارٍ التحميل…</p></div>`;
  if (can('requests.review')) {
    api('/admin/stats').then((s) => {
      const n = s.pending_links + s.pending_additions;
      const a = $('[data-tab=requests]', root);
      if (n && a) a.insertAdjacentHTML('beforeend', `<span class="count">${n}</span>`);
      const pt = $('[data-tab=payments]', root);
      if (s.pending_transfers && pt) pt.insertAdjacentHTML('beforeend', `<span class="count" title="تحويلات بانتظار المراجعة">${s.pending_transfers}</span>`);
      const ut = $('[data-tab=users]', root);
      if (s.pending_phone && ut) ut.insertAdjacentHTML('beforeend', `<span class="count" title="طلبات توثيق الجوال">${s.pending_phone}</span>`);
    }).catch(() => {});
  }
  if (can('feedback.manage')) {
    api('/admin/feedback?status=new').then((d) => {
      const a = $('[data-tab=feedback]', root);
      if (d.counts.new && a) a.insertAdjacentHTML('beforeend', `<span class="count">${d.counts.new}</span>`);
    }).catch(() => {});
  }
  const panel = $('#panel', root);
  try { await PANELS[cur[0]](panel); } catch (e) { panel.innerHTML = alertBox(e.message); }
}

const pager = (total, page, size = 25) => {
  const pages = Math.ceil(total / size);
  if (pages <= 1) return '';
  return `<div class="row" style="margin-top:12px">${page > 1 ? `<button class="btn sm secondary" data-page="${page - 1}">السابق</button>` : ''}
    <span class="muted small">صفحة ${page} من ${pages} (${total})</span>${page < pages ? `<button class="btn sm secondary" data-page="${page + 1}">التالي</button>` : ''}</div>`;
};
/** تنبيه في تبويب قسم موقوف */
const modOff = (key, label) => (state.me.modules && state.me.modules[key] === false
  ? `<div class="alert warn">قسم ${label} متوقف حاليًا ولا يراه الأعضاء. ${can('home.manage') ? '<a href="#/admin/home">إعادة تشغيله</a>' : ''}</div>` : '');
const onPage = (box, fn) => $$('[data-page]', box).forEach((b) => b.onclick = () => fn(Number(b.dataset.page)));

const PANELS = {
  // ================= نظرة عامة =================
  async overview(box) {
    const s = await api('/admin/stats');
    const tile = (v, k, href) => `<a class="card stat" ${href ? `href="${href}"` : ''} style="text-decoration:none;color:inherit"><div class="v">${v}</div><div class="k">${k}</div></a>`;
    box.innerHTML = `
      <div class="grid grid-4">
        ${tile(s.persons, 'أفراد المشجرة')}
        ${tile(s.users, 'الحسابات المسجلة', '#/admin/users')}
        ${tile(s.users_linked, 'حسابات مرتبطة بالمشجرة')}
        ${tile(s.pending_links + s.pending_additions, 'طلبات بانتظار المراجعة', '#/admin/requests')}
        ${tile(s.subs_active, 'اشتراكات فعّالة', '#/admin/subscriptions')}
        ${tile(s.subs_expiring, `تنتهي خلال ${s.expiring_days} يوم`, '#/admin/subscriptions')}
        ${tile(s.subs_expired, 'اشتراكات منتهية')}
        ${tile(money(s.revenue_30d_halalas), 'إيرادات آخر 30 يوم', '#/admin/payments')}
      </div>
      <div class="grid grid-2" style="margin-top:16px">
        <div class="card"><h3>المشتركون حسب الباقة</h3>
          ${s.by_plan.map((p) => { const max = Math.max(1, ...s.by_plan.map((x) => x.c)); return `<div style="margin:8px 0"><div class="row between small"><span>${esc(p.name)}</span><b>${p.c}</b></div>
            <div style="height:8px;background:var(--surface-2);border-radius:4px"><div style="height:8px;width:${(p.c / max) * 100}%;background:${esc(p.color)};border-radius:4px"></div></div></div>`; }).join('')}
        </div>
        <div class="card"><h3>التسجيلات خلال 30 يومًا</h3>
          ${s.signups_30d.length ? `<div style="display:flex;align-items:flex-end;gap:3px;height:120px">${s.signups_30d.map((x) => { const max = Math.max(...s.signups_30d.map((y) => y.c)); return `<div title="${x.d}: ${x.c}" style="flex:1;background:var(--brand-2);border-radius:3px 3px 0 0;height:${(x.c / max) * 100}%"></div>`; }).join('')}</div>` : '<p class="muted">لا توجد تسجيلات</p>'}
          <p class="small muted">إجمالي الإيرادات: ${money(s.revenue_halalas)} — أرقام موثّقة: ${s.users_verified}</p>
        </div>
      </div>`;
  },

  // ================= الطلبات =================
  async requests(box, status = 'pending') {
    const [l, a] = await Promise.all([api(`/admin/link-requests?status=${status}`), api(`/admin/addition-requests?status=${status}`)]);
    box.innerHTML = `
      <div class="row" style="margin-bottom:12px">${['pending', 'approved', 'rejected', 'all'].map((s) => `<button class="btn sm ${s === status ? '' : 'secondary'}" data-st="${s}">${s === 'all' ? 'الكل' : LABELS.req[s][0]}</button>`).join('')}</div>
      <div class="card"><h2>طلبات ربط الحسابات (${l.items.length})</h2>
        ${l.items.length ? `<div class="table-wrap"><table><thead><tr><th>الصورة</th><th>المستخدم</th><th>الاسم المطلوب في المشجرة</th><th>ملاحظة</th><th>الحالة</th><th>التاريخ</th><th></th></tr></thead><tbody>
        ${l.items.map((x) => `<tr>
          <td>${x.has_photo ? `<img class="avatar-sm" src="/api/admin/users/${x.user_id}/photo" style="width:44px;height:44px">` : '—'}</td>
          <td><b>${esc(x.user_full_name)}</b><br><span class="small muted" dir="ltr">+${esc(x.phone)}</span> · <span class="small">${esc(x.membership_no)}</span></td>
          <td>${esc(x.person_full_name)}${x.person_linked_user ? '<br><span class="badge danger">مرتبط بحساب آخر</span>' : ''}${x.other_pending ? `<br><span class="badge warn">${x.other_pending} طلبات أخرى على نفس الاسم</span>` : ''}</td>
          <td class="small">${esc(x.user_note || '')}${x.admin_note ? `<br><i class="muted">${esc(x.admin_note)}</i>` : ''}</td>
          <td>${badge('req', x.status)}</td><td class="small">${date(x.created_at, true)}</td>
          <td>${x.status === 'pending' ? `<div class="row"><button class="btn sm" data-ap="${x.id}">موافقة</button><button class="btn sm danger" data-rj="${x.id}">رفض</button></div>` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted">لا توجد طلبات</p>'}
      </div>
      <div class="card"><h2>طلبات إضافة أسماء (${a.items.length})</h2>
        ${a.items.length ? `<div class="table-wrap"><table><thead><tr><th>المستخدم</th><th>الاسم</th><th>الأب</th><th>الجنس</th><th>ملاحظة</th><th>الحالة</th><th></th></tr></thead><tbody>
        ${a.items.map((x) => `<tr><td><b>${esc(x.user_full_name)}</b><br><span class="small muted" dir="ltr">+${esc(x.phone)}</span></td><td>${esc(x.name)}</td>
          <td class="small">${esc(x.father_full_name || x.father_text || '—')}</td><td>${x.gender === 'female' ? 'أنثى' : 'ذكر'}</td><td class="small">${esc(x.user_note || '')}</td>
          <td>${badge('req', x.status)}</td>
          <td>${x.status === 'pending' ? `<div class="row"><button class="btn sm" data-aap="${x.id}">موافقة وإضافة</button><button class="btn sm danger" data-arj="${x.id}">رفض</button></div>` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted">لا توجد طلبات</p>'}
      </div>`;
    const reload = () => PANELS.requests(box, status);
    $$('[data-st]', box).forEach((b) => b.onclick = () => PANELS.requests(box, b.dataset.st));
    $$('[data-ap]', box).forEach((b) => b.onclick = async () => {
      const note = await confirmDialog('الموافقة على ربط الحساب بهذا الاسم؟', { ok: 'موافقة', input: 'ملاحظة (اختياري)' });
      if (note === null) return;
      try { await api(`/admin/link-requests/${b.dataset.ap}/approve`, { method: 'POST', body: { note } }); toast('تم ربط الحساب'); reload(); } catch (e) { toast(e.message); }
    });
    $$('[data-rj]', box).forEach((b) => b.onclick = async () => {
      const note = await confirmDialog('رفض طلب الربط؟', { ok: 'رفض', danger: true, input: 'سبب الرفض (يظهر للمستخدم)' });
      if (note === null) return;
      try { await api(`/admin/link-requests/${b.dataset.rj}/reject`, { method: 'POST', body: { note } }); toast('تم الرفض'); reload(); } catch (e) { toast(e.message); }
    });
    $$('[data-aap]', box).forEach((b) => b.onclick = () => {
      const x = a.items.find((i) => i.id === Number(b.dataset.aap));
      personForm({ name: x.name, gender: x.gender, father_id: x.father_id, father_label: x.father_full_name, birth_date: x.birth_date }, async (body) => {
        await api(`/admin/addition-requests/${x.id}/approve`, { method: 'POST', body });
        toast('تمت إضافة الاسم وربط الحساب'); reload();
      }, 'الموافقة وإضافة الاسم للمشجرة' + (x.father_text ? ` — النسب المكتوب: ${x.father_text}` : ''));
    });
    $$('[data-arj]', box).forEach((b) => b.onclick = async () => {
      const note = await confirmDialog('رفض طلب الإضافة؟', { ok: 'رفض', danger: true, input: 'سبب الرفض' });
      if (note === null) return;
      try { await api(`/admin/addition-requests/${b.dataset.arj}/reject`, { method: 'POST', body: { note } }); reload(); } catch (e) { toast(e.message); }
    });
  },

  // ================= أفراد المشجرة =================
  async persons(box, q = '', page = 1) {
    const d = await api(`/admin/persons?q=${encodeURIComponent(q)}&page=${page}`);
    box.innerHTML = `
      <div class="row between" style="margin-bottom:12px">
        <form id="sf" class="row"><input name="q" value="${esc(q)}" placeholder="بحث بالاسم أو النسب" style="width:260px"><button class="btn sm secondary">بحث</button></form>
        <button class="btn sm" id="add">+ إضافة فرد</button>
      </div>
      <div class="card"><div class="table-wrap"><table><thead><tr><th>#</th><th>الاسم والنسب</th><th>الجيل</th><th>الجنس</th><th>الأبناء</th><th>الحالة</th><th>الحساب</th><th></th></tr></thead><tbody>
      ${d.items.map((p) => `<tr><td class="small">${esc(p.code || p.id)}</td><td>${esc(p.full_name)}</td><td>${p.generation}</td><td>${p.gender === 'female' ? 'أنثى' : 'ذكر'}</td>
        <td>${p.children_count}</td><td>${p.is_deceased ? 'متوفى' : 'حي'}</td><td>${p.user_id ? `<span class="badge ok">${esc(p.membership_no)}</span>` : '—'}</td>
        <td><div class="row"><button class="btn sm secondary" data-ed="${p.id}">تعديل</button><button class="btn sm secondary" data-ch="${p.id}">+ ابن/ابنة</button>
          ${p.user_id ? `<button class="btn sm secondary" data-ul="${p.id}">فك الربط</button>` : ''}
          ${!p.children_count && !p.user_id ? `<button class="btn sm danger" data-del="${p.id}">حذف</button>` : ''}</div></td></tr>`).join('')}
      </tbody></table></div>${pager(d.total, d.page)}</div>`;
    const reload = () => PANELS.persons(box, q, page);
    bindForm($('#sf', box), async (fd) => PANELS.persons(box, fd.get('q'), 1));
    onPage(box, (p) => PANELS.persons(box, q, p));
    $('#add', box).onclick = () => personForm({}, async (body) => { await api('/admin/persons', { method: 'POST', body }); toast('تمت الإضافة'); reload(); }, 'إضافة فرد');
    $$('[data-ch]', box).forEach((b) => b.onclick = () => {
      const p = d.items.find((x) => x.id === Number(b.dataset.ch));
      personForm({ father_id: p.id, father_label: p.full_name }, async (body) => { await api('/admin/persons', { method: 'POST', body }); toast('تمت الإضافة'); reload(); }, 'إضافة ابن/ابنة');
    });
    $$('[data-ed]', box).forEach((b) => b.onclick = () => {
      const p = d.items.find((x) => x.id === Number(b.dataset.ed));
      personForm({ ...p, father_label: p.father_full_name }, async (body) => {
        await api(`/admin/persons/${p.id}`, { method: 'PUT', body }); toast('تم الحفظ'); reload();
      }, 'تعديل بيانات الفرد', true);
    });
    $$('[data-del]', box).forEach((b) => b.onclick = async () => {
      if (!await confirmDialog('حذف هذا الفرد نهائيًا من المشجرة؟', { ok: 'حذف', danger: true })) return;
      try { await api(`/admin/persons/${b.dataset.del}`, { method: 'DELETE' }); toast('تم الحذف'); reload(); } catch (e) { toast(e.message); }
    });
    $$('[data-ul]', box).forEach((b) => b.onclick = async () => {
      if (!await confirmDialog('فك ربط الحساب عن هذا الفرد؟', { ok: 'فك الربط', danger: true })) return;
      try { await api(`/admin/persons/${b.dataset.ul}/unlink`, { method: 'POST' }); reload(); } catch (e) { toast(e.message); }
    });
  },

  // ================= الباقات والمميزات =================
  async plans(box) {
    const [d, sys] = await Promise.all([api('/admin/plans'), api('/admin/plans-system')]);
    box.innerHTML = `
      <div class="card sys-card ${sys.enabled ? '' : 'off'}">
        <div class="row between">
          <div><h2 style="margin:0">نظام الباقات والاشتراكات</h2>
            <p class="small muted" style="margin:4px 0 0">${sys.enabled
              ? 'يعمل الآن: صفحة الباقات ظاهرة، ويمكن للأعضاء الاشتراك والتجديد والدفع.'
              : `متوقف منذ ${date(sys.paused_at, true)}: صفحة الباقات مخفية، ولا يمكن الاشتراك أو التجديد أو الدفع.`}</p></div>
          <label class="switch" title="${sys.enabled ? 'إيقاف' : 'تشغيل'}"><input type="checkbox" id="sysTg" ${sys.enabled ? 'checked' : ''}><span></span></label>
        </div>
        <div class="sys-mode">
          <b class="small">عند الإيقاف يحصل الأعضاء على:</b>
          <label class="check"><input type="radio" name="offm" value="free_all" ${sys.off_mode === 'free_all' ? 'checked' : ''}> كل المميزات مجانًا للجميع</label>
          <label class="check"><input type="radio" name="offm" value="free_plan" ${sys.off_mode === 'free_plan' ? 'checked' : ''}> مميزات الباقة المجانية فقط</label>
        </div>
      </div>
      <div class="row between" style="margin-bottom:12px"><h2 style="margin:0">الباقات</h2><button class="btn sm" id="np">+ باقة جديدة</button></div>
      <div class="card"><div class="table-wrap"><table><thead><tr><th>الباقة</th><th>السعر</th><th>المدة</th><th>المستوى</th><th>المميزات</th><th>المشتركون</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${d.items.map((p) => `<tr><td><b style="color:${esc(p.color)}">${esc(p.name)}</b>${p.is_free ? ' <span class="badge info">الافتراضية المجانية</span>' : ''}</td>
        <td>${p.is_free ? 'مجانية' : money(p.price_halalas, p.currency)}</td><td>${p.duration_days} يوم</td><td>${p.tier}</td><td>${p.feature_ids.length}</td>
        <td>${p.active_subscribers}</td><td>${p.is_active ? '<span class="badge ok">مفعّلة</span>' : '<span class="badge">موقوفة</span>'}</td>
        <td><div class="row"><button class="btn sm secondary" data-ed="${p.id}">تعديل</button><button class="btn sm secondary" data-tg="${p.id}">${p.is_active ? 'إيقاف' : 'تفعيل'}</button><button class="btn sm danger" data-del="${p.id}">حذف</button></div></td></tr>`).join('')}
      </tbody></table></div></div>

      <div class="card"><div class="row between"><h2 style="margin:0">مصفوفة المميزات</h2><button class="btn sm" id="nf">+ ميزة جديدة</button></div>
        <p class="muted small">حدد المميزات المتاحة لكل باقة ثم احفظ. المميزات "النظامية" محمية فعليًا في الخادم؛ والمميزات المخصصة للعرض والتوسع المستقبلي.
          زر <b>التشغيل</b> يوقف الميزة عن الجميع مهما كانت باقاتهم (مثل إيقاف وثيقة النسب) ويعيدها متى شئت.</p>
        <div class="table-wrap"><table><thead><tr><th>تشغيل</th><th>الميزة</th>${d.items.map((p) => `<th style="text-align:center;color:${esc(p.color)}">${esc(p.name)}</th>`).join('')}<th></th></tr></thead><tbody>
        ${d.features.map((f) => `<tr class="${f.is_enabled ? '' : 'feat-off'}"><td><label class="switch" title="${f.is_enabled ? 'إيقاف الميزة للجميع' : 'تشغيل الميزة'}"><input type="checkbox" data-fon="${f.id}" ${f.is_enabled ? 'checked' : ''}><span></span></label></td>
          <td><b>${esc(f.name)}</b> ${f.is_system ? '<span class="badge info">نظامية</span>' : '<span class="badge">مخصصة</span>'}${f.is_enabled ? '' : ' <span class="badge warn">متوقفة للجميع</span>'}<br><span class="small muted">${esc(f.description || '')} · <code>${esc(f.key)}</code></span></td>
          ${d.items.map((p) => `<td style="text-align:center"><input type="checkbox" data-pf="${p.id}:${f.id}" ${p.feature_ids.includes(f.id) ? 'checked' : ''}></td>`).join('')}
          <td><div class="row"><button class="btn sm secondary" data-fe="${f.id}">تعديل</button>${f.is_system ? '' : `<button class="btn sm danger" data-fd="${f.id}">حذف</button>`}</div></td></tr>`).join('')}
        </tbody></table></div>
        <button class="btn" id="saveMatrix" style="margin-top:12px">حفظ مصفوفة المميزات</button>
      </div>`;
    const reload = () => PANELS.plans(box);
    const sysChanged = async () => { state.home = null; state.homeAt = 0; await refreshMe(); window.dispatchEvent(new Event('me-changed')); };
    $('#sysTg', box).onchange = async (e) => {
      const on = e.target.checked;
      let body = { enabled: on };
      if (!on) {
        const ok = await confirmDialog('إيقاف الباقات والاشتراكات؟ ستُخفى صفحة الباقات ويتوقف الشراء والتجديد، ويحصل الأعضاء على ما حددته بالأسفل حتى تعيد التشغيل.', { ok: 'إيقاف', danger: true });
        if (!ok) { e.target.checked = true; return; }
      } else {
        const ext = await confirmDialog('تشغيل الباقات والاشتراكات؟', { ok: 'تشغيل', check: 'تمديد الاشتراكات التي كانت سارية بنفس مدة الإيقاف' });
        if (ext === null || ext === false) { e.target.checked = false; return; }
        body.extend = ext === 'checked';
      }
      try {
        const r = await api('/admin/plans-system', { method: 'PUT', body });
        toast(r.enabled ? `تم تشغيل الباقات والاشتراكات${r.extended ? ` — مُدّد ${r.extended} اشتراك` : ''}` : 'تم إيقاف الباقات والاشتراكات');
        await sysChanged(); reload();
      } catch (err) { toast(err.message); e.target.checked = !on; }
    };
    $$('[name=offm]', box).forEach((rb) => rb.onchange = async () => {
      try { await api('/admin/plans-system', { method: 'PUT', body: { off_mode: rb.value } }); toast('تم الحفظ'); await sysChanged(); } catch (err) { toast(err.message); }
    });
    $$('[data-fon]', box).forEach((c) => c.onchange = async () => {
      const f = d.features.find((x) => x.id === Number(c.dataset.fon));
      if (!c.checked && !(await confirmDialog(`إيقاف ميزة "${f.name}" لجميع الأعضاء؟ تختفي أزرارها ولا يصل إليها أحد حتى تعيد تشغيلها.`, { ok: 'إيقاف', danger: true }))) { c.checked = true; return; }
      try {
        await api(`/admin/features/${f.id}`, { method: 'PUT', body: { is_enabled: c.checked } });
        toast(c.checked ? `تم تشغيل: ${f.name}` : `تم إيقاف: ${f.name}`);
        await sysChanged(); reload();
      } catch (e) { toast(e.message); c.checked = !c.checked; }
    });
    $('#np', box).onclick = () => planForm(null, d.features, reload);
    $$('[data-ed]', box).forEach((b) => b.onclick = () => planForm(d.items.find((p) => p.id === Number(b.dataset.ed)), d.features, reload));
    $$('[data-tg]', box).forEach((b) => b.onclick = async () => {
      const p = d.items.find((x) => x.id === Number(b.dataset.tg));
      try { await api(`/admin/plans/${p.id}`, { method: 'PUT', body: { is_active: !p.is_active } }); reload(); } catch (e) { toast(e.message); }
    });
    $$('[data-del]', box).forEach((b) => b.onclick = async () => {
      if (!await confirmDialog('حذف الباقة؟ (تُحفظ في السجل إن كانت لها اشتراكات سابقة)', { ok: 'حذف', danger: true })) return;
      try { await api(`/admin/plans/${b.dataset.del}`, { method: 'DELETE' }); toast('تم الحذف'); reload(); } catch (e) { toast(e.message); }
    });
    $('#saveMatrix', box).onclick = async () => {
      try {
        for (const p of d.items) {
          const ids = $$(`[data-pf^="${p.id}:"]`, box).filter((c) => c.checked).map((c) => Number(c.dataset.pf.split(':')[1]));
          await api(`/admin/plans/${p.id}`, { method: 'PUT', body: { feature_ids: ids } });
        }
        toast('تم حفظ المميزات'); reload();
      } catch (e) { toast(e.message); }
    };
    $('#nf', box).onclick = () => featureForm(null, reload);
    $$('[data-fe]', box).forEach((b) => b.onclick = () => featureForm(d.features.find((f) => f.id === Number(b.dataset.fe)), reload));
    $$('[data-fd]', box).forEach((b) => b.onclick = async () => {
      if (!await confirmDialog('حذف الميزة من جميع الباقات؟', { ok: 'حذف', danger: true })) return;
      try { await api(`/admin/features/${b.dataset.fd}`, { method: 'DELETE' }); reload(); } catch (e) { toast(e.message); }
    });
  },

  // ================= الاشتراكات =================
  async subscriptions(box, filter = 'active', q = '', page = 1) {
    const [d, plans] = await Promise.all([api(`/admin/subscriptions?filter=${filter}&q=${encodeURIComponent(q)}&page=${page}`), api('/admin/plans').catch(() => null)]);
    const planList = plans ? plans.items.filter((p) => !p.is_free) : [];
    const filters = { active: 'الفعّالة', expiring: 'قاربت على الانتهاء', expired: 'المنتهية', suspended: 'الموقوفة', cancelled: 'الملغاة', all: 'الكل' };
    box.innerHTML = `
      ${state.me.plans_enabled === false ? `<div class="alert warn">نظام الباقات والاشتراكات متوقف حاليًا. ${can('plans.manage') ? '<a href="#/admin/plans">إعادة التشغيل</a>' : ''}</div>` : ''}
      <div class="row between" style="margin-bottom:12px">
        <div class="row">${Object.entries(filters).map(([k, t]) => `<button class="btn sm ${k === filter ? '' : 'secondary'}" data-f="${k}">${t}</button>`).join('')}</div>
        <div class="row"><form id="sf" class="row"><input name="q" value="${esc(q)}" placeholder="اسم، جوال، رقم عضوية" style="width:200px"><button class="btn sm secondary">بحث</button></form>
          <button class="btn sm" id="manual">+ اشتراك يدوي</button></div>
      </div>
      <div class="card"><div class="table-wrap"><table><thead><tr><th>المشترك</th><th>الباقة</th><th>الحالة</th><th>البداية</th><th>النهاية</th><th>المتبقي</th><th>المصدر</th><th></th></tr></thead><tbody>
      ${d.items.map((s) => { const left = Math.ceil((Date.parse(s.end_at) - Date.now()) / 864e5); return `<tr>
        <td><b>${esc(s.full_name)}</b><br><span class="small muted">${esc(s.membership_no)} · <span dir="ltr">+${esc(s.phone)}</span></span></td>
        <td style="color:${esc(s.color)}"><b>${esc(s.plan_name)}</b></td><td>${badge('sub', s.status)}</td><td class="small">${date(s.start_at)}</td><td class="small">${date(s.end_at)}</td>
        <td>${s.status === 'active' ? `<span class="badge ${left <= 14 ? 'warn' : ''}">${left} يوم</span>` : '—'}</td><td class="small">${esc(LABELS.source[s.source])}</td>
        <td><div class="row">
          ${['active', 'expired', 'suspended'].includes(s.status) ? `<button class="btn sm secondary" data-rn="${s.id}">تجديد</button>` : ''}
          ${['active', 'suspended'].includes(s.status) ? `<button class="btn sm secondary" data-cp="${s.id}">ترقية/تخفيض</button>` : ''}
          ${s.status === 'active' ? `<button class="btn sm secondary" data-ss="${s.id}:suspended">إيقاف</button>` : ''}
          ${s.status === 'suspended' ? `<button class="btn sm secondary" data-ss="${s.id}:active">تفعيل</button>` : ''}
          ${['active', 'suspended'].includes(s.status) ? `<button class="btn sm danger" data-ss="${s.id}:cancelled">إلغاء</button>` : ''}
        </div></td></tr>`; }).join('') || '<tr><td colspan="8" class="muted">لا توجد اشتراكات</td></tr>'}
      </tbody></table></div>${pager(d.total, d.page)}</div>`;
    const reload = () => PANELS.subscriptions(box, filter, q, page);
    $$('[data-f]', box).forEach((b) => b.onclick = () => PANELS.subscriptions(box, b.dataset.f, q, 1));
    bindForm($('#sf', box), async (fd) => PANELS.subscriptions(box, filter, fd.get('q'), 1));
    onPage(box, (p) => PANELS.subscriptions(box, filter, q, p));
    $$('[data-rn]', box).forEach((b) => b.onclick = async () => {
      const days = await confirmDialog('تجديد الاشتراك (يُضاف إلى تاريخ الانتهاء)', { ok: 'تجديد', input: 'عدد الأيام (اتركه فارغًا لمدة الباقة الافتراضية)' });
      if (days === null) return;
      try { await api(`/admin/subscriptions/${b.dataset.rn}/renew`, { method: 'POST', body: { days: days ? Number(days) : undefined } }); toast('تم التجديد'); reload(); } catch (e) { toast(e.message); }
    });
    $$('[data-cp]', box).forEach((b) => b.onclick = () => {
      const s = d.items.find((x) => x.id === Number(b.dataset.cp));
      modal(`<h3>تغيير باقة ${esc(s.full_name)}</h3><p class="muted small">يُحتفظ بنفس تاريخ الانتهاء (${date(s.end_at)}).</p>
        <div class="field"><select id="pl">${planList.filter((p) => p.id !== s.plan_id).map((p) => `<option value="${p.id}">${esc(p.name)} (المستوى ${p.tier})</option>`).join('')}</select></div>
        <div class="form-error"></div><div class="actions"><button class="btn" id="ok">تطبيق</button><button class="btn secondary" data-close>إلغاء</button></div>`, (m, close) => {
        $('#ok', m).onclick = async () => {
          try { await api(`/admin/subscriptions/${s.id}/change-plan`, { method: 'POST', body: { plan_id: Number($('#pl', m).value) } }); close(); toast('تم تغيير الباقة'); reload(); } catch (e) { $('.form-error', m).innerHTML = alertBox(e.message); }
        };
      });
    });
    $$('[data-ss]', box).forEach((b) => b.onclick = async () => {
      const [id, st] = b.dataset.ss.split(':');
      if (!await confirmDialog(`تغيير حالة الاشتراك إلى: ${LABELS.sub[st][0]}؟`, { ok: 'تأكيد', danger: st !== 'active' })) return;
      try { await api(`/admin/subscriptions/${id}/status`, { method: 'POST', body: { status: st } }); reload(); } catch (e) { toast(e.message); }
    });
    $('#manual', box).onclick = () => manualSubscription(planList, reload);
  },

  // ================= المدفوعات =================
  async payments(box, status = '', q = '', page = 1) {
    const d = await api(`/admin/payments?status=${status}&q=${encodeURIComponent(q)}&page=${page}`);
    box.innerHTML = `
      <div class="row between" style="margin-bottom:12px">
        <div class="row">${[['', 'الكل'], ['review', 'تحويلات بانتظار المراجعة'], ...Object.entries(LABELS.pay).map(([k, v]) => [k, v[0]])].map(([k, t]) => `<button class="btn sm ${k === status ? '' : 'secondary'}" data-f="${k}">${t}</button>`).join('')}</div>
        <form id="sf" class="row"><input name="q" value="${esc(q)}" placeholder="اسم، جوال، مرجع البوابة" style="width:220px"><button class="btn sm secondary">بحث</button></form>
      </div>
      <div class="card"><p>إجمالي المدفوع ضمن النتائج: <b>${money(d.sum_paid_halalas)}</b></p>
      <div class="table-wrap"><table><thead><tr><th>#</th><th>المستخدم</th><th>الباقة</th><th>العملية</th><th>المبلغ</th><th>الحالة</th><th>البوابة / المرجع</th><th>التاريخ</th><th></th></tr></thead><tbody>
      ${d.items.map((p) => `<tr><td>${p.id}</td><td><b>${esc(p.full_name)}</b><br><span class="small muted">${esc(p.membership_no)}</span></td><td>${esc(p.plan_name)}</td>
        <td>${esc(LABELS.purpose[p.purpose])}</td><td>${money(p.amount_halalas, p.currency)}</td><td>${badge('pay', p.status)}${p.failure_reason ? `<br><span class="small muted">${esc(p.failure_reason)}</span>` : ''}</td>
        <td class="small">${esc(p.gateway_name || p.provider)}<br><code>${esc(p.provider_ref || '')}</code>${p.method ? ` · ${esc(p.method)}` : ''}
          ${p.submitted_at ? `<div class="transfer-info">المحوِّل: <b>${esc(p.transfer_name || '')}</b>${p.transfer_ref ? `<br>${esc(p.transfer_ref)}` : ''}<br>أُرسل ${date(p.submitted_at, true)}
            ${p.has_receipt ? `<br><button class="btn link small" type="button" data-rc="${p.id}">عرض الإيصال</button>` : ''}</div>` : ''}</td><td class="small">${date(p.created_at, true)}</td>
        <td><div class="row">${p.status === 'initiated' && p.provider === 'bank_transfer'
            ? (p.submitted_at ? `<button class="btn sm" data-ap="${p.id}">اعتماد التحويل</button><button class="btn sm danger" data-rj="${p.id}">رفض</button>` : '<span class="small muted">بانتظار بيانات التحويل من العضو</span>')
            : p.status === 'initiated' ? `<button class="btn sm secondary" data-rv="${p.id}">إعادة التحقق</button>` : ''}
          ${p.status === 'paid' ? `<button class="btn sm secondary" data-rf="${p.id}">تسجيل استرداد</button>` : ''}</div></td></tr>`).join('') || '<tr><td colspan="9" class="muted">لا توجد مدفوعات</td></tr>'}
      </tbody></table></div>${pager(d.total, d.page)}</div>`;
    const reload = () => PANELS.payments(box, status, q, page);
    $$('[data-f]', box).forEach((b) => b.onclick = () => PANELS.payments(box, b.dataset.f, q, 1));
    bindForm($('#sf', box), async (fd) => PANELS.payments(box, status, fd.get('q'), 1));
    onPage(box, (p) => PANELS.payments(box, status, q, p));
    $$('[data-rv]', box).forEach((b) => b.onclick = async () => {
      try { const r = await api(`/admin/payments/${b.dataset.rv}/reverify`, { method: 'POST' }); toast(`الحالة: ${LABELS.pay[r.status][0]}`); reload(); } catch (e) { toast(e.message); }
    });
    $$('[data-rc]', box).forEach((b) => b.onclick = () => modal(`<h3>إيصال التحويل</h3><img class="receipt-img" src="/api/payments/${b.dataset.rc}/receipt" alt="إيصال التحويل">
      <div class="actions"><button class="btn secondary" data-close>إغلاق</button></div>`, null, { large: true }));
    $$('[data-ap]', box).forEach((b) => b.onclick = async () => {
      const p = d.items.find((x) => x.id === Number(b.dataset.ap));
      if (!(await confirmDialog(`اعتماد تحويل ${money(p.amount_halalas, p.currency)} من ${p.full_name}؟ تأكد من وصول المبلغ إلى حساب الصندوق. سيُفعَّل الاشتراك فورًا.`, { ok: 'اعتماد وتفعيل' }))) return;
      try { await api(`/admin/payments/${p.id}/approve`, { method: 'POST' }); toast('تم اعتماد التحويل وتفعيل الاشتراك'); reload(); } catch (e) { toast(e.message); }
    });
    $$('[data-rj]', box).forEach((b) => b.onclick = async () => {
      const reason = await confirmDialog('رفض هذا التحويل؟', { ok: 'رفض', danger: true, input: 'سبب الرفض (يظهر للعضو)' });
      if (reason === null) return;
      try { await api(`/admin/payments/${b.dataset.rj}/reject`, { method: 'POST', body: { reason } }); toast('تم رفض التحويل'); reload(); } catch (e) { toast(e.message); }
    });
    $$('[data-rf]', box).forEach((b) => b.onclick = () => {
      modal(`<h3>تسجيل استرداد المبلغ</h3><p class="muted small">يُسجَّل الاسترداد في النظام. نفّذ الاسترداد الفعلي من لوحة بوابة الدفع.</p>
        <label class="check"><input type="checkbox" id="cs" checked> إلغاء الاشتراك المرتبط</label>
        <div class="actions"><button class="btn danger" id="ok">تسجيل</button><button class="btn secondary" data-close>إلغاء</button></div>`, (m, close) => {
        $('#ok', m).onclick = async () => {
          try { await api(`/admin/payments/${b.dataset.rf}/refund`, { method: 'POST', body: { cancel_subscription: $('#cs', m).checked } }); close(); reload(); } catch (e) { toast(e.message); }
        };
      });
    });
  },

  // ================= المستخدمون =================
  async users(box, q = '', page = 1, verify = '') {
    const d = await api(`/admin/users?q=${encodeURIComponent(q)}&page=${page}&verify=${verify}`);
    box.innerHTML = `
      <form id="sf" class="row" style="margin-bottom:12px"><input name="q" value="${esc(q)}" placeholder="اسم، جوال، رقم عضوية" style="width:260px">
        <select name="verify" style="width:auto"><option value="">كل المستخدمين</option>
          <option value="pending" ${verify === 'pending' ? 'selected' : ''}>طلبات توثيق الجوال</option>
          <option value="unverified" ${verify === 'unverified' ? 'selected' : ''}>جوال غير موثق</option></select>
        <button class="btn sm secondary">بحث</button></form>
      <div class="card"><div class="table-wrap"><table><thead><tr><th>العضوية</th><th>الاسم</th><th>الجوال</th><th>الاسم في المشجرة</th><th>الباقة</th><th>الدور</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${d.items.map((u) => `<tr><td>${esc(u.membership_no)}</td><td>${esc(u.full_name)}</td><td dir="ltr" style="text-align:right">+${esc(u.phone)} ${u.phone_verified_at ? `<span style="color:var(--ok)">${icon('check')}</span>`
        : `<span class="badge warn">${u.verify_requested_at ? 'طلب توثيق' : 'غير موثق'}</span> <button class="btn sm" data-vp="${u.id}">توثيق الجوال</button>`}</td>
        <td class="small">${esc(u.person_full_name || '—')}</td><td>${esc(u.plan_name || 'مجانية')}</td><td>${esc(LABELS.role[u.role])}</td>
        <td>${u.status === 'active' ? '<span class="badge ok">نشط</span>' : '<span class="badge danger">موقوف</span>'}</td>
        <td><div class="row">${u.id !== state.me.user.id ? `<button class="btn sm secondary" data-st="${u.id}:${u.status === 'active' ? 'suspended' : 'active'}">${u.status === 'active' ? 'إيقاف' : 'تفعيل'}</button>` : ''}
          ${can('subscriptions.manage') ? `<button class="btn sm secondary" data-sub="${u.id}">اشتراك يدوي</button>` : ''}</div></td></tr>`).join('')}
      </tbody></table></div>${pager(d.total, d.page)}</div>`;
    const reload = () => PANELS.users(box, q, page, verify);
    bindForm($('#sf', box), async (fd) => PANELS.users(box, fd.get('q'), 1, fd.get('verify')));
    onPage(box, (p) => PANELS.users(box, q, p, verify));
    $$('[data-vp]', box).forEach((b) => b.onclick = async () => {
      const u = d.items.find((x) => x.id === Number(b.dataset.vp));
      if (!(await confirmDialog(`توثيق رقم الجوال +${u.phone} للعضو ${u.full_name}؟ تأكد أن الرقم يخصه فعلًا.`, { ok: 'توثيق' }))) return;
      try { await api(`/admin/users/${u.id}/verify-phone`, { method: 'POST' }); toast('تم توثيق الجوال'); reload(); } catch (e) { toast(e.message); }
    });
    $$('[data-st]', box).forEach((b) => b.onclick = async () => {
      const [id, st] = b.dataset.st.split(':');
      try { await api(`/admin/users/${id}/status`, { method: 'PUT', body: { status: st } }); reload(); } catch (e) { toast(e.message); }
    });
    $$('[data-sub]', box).forEach((b) => b.onclick = async () => {
      const plans = (await api('/admin/plans').catch(() => ({ items: [] }))).items.filter((p) => !p.is_free);
      const u = d.items.find((x) => x.id === Number(b.dataset.sub));
      manualSubscription(plans, reload, u);
    });
  },

  // ================= المشرفون =================
  async staff(box) {
    const d = await api('/admin/staff');
    box.innerHTML = `
      <div class="card"><div class="row between"><h2 style="margin:0">المشرفون</h2><button class="btn sm" id="add">+ تعيين مشرف</button></div>
      <div class="table-wrap"><table><thead><tr><th>الاسم</th><th>الدور</th><th>الصلاحيات</th><th></th></tr></thead><tbody>
      ${d.items.map((s) => `<tr><td><b>${esc(s.full_name)}</b><br><span class="small muted">${esc(s.membership_no)}</span></td><td>${esc(LABELS.role[s.role])}</td>
        <td class="small">${s.role === 'admin' ? 'جميع الصلاحيات' : s.permissions.map((p) => esc(d.catalog[p] || p)).join('، ') || '—'}</td>
        <td>${s.id !== state.me.user.id ? `<button class="btn sm secondary" data-ed="${s.id}">تعديل</button>` : '<span class="muted small">أنت</span>'}</td></tr>`).join('')}
      </tbody></table></div></div>`;
    const reload = () => PANELS.staff(box);
    const editor = (u) => modal(`<h3>صلاحيات: ${esc(u.full_name)}</h3>
      <div class="field"><label>الدور</label><select id="role">${Object.entries(LABELS.role).map(([k, t]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div id="perms">${Object.entries(d.catalog).map(([k, t]) => `<label class="check"><input type="checkbox" value="${k}" ${(u.permissions || []).includes(k) ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div>
      <div class="form-error"></div><div class="actions"><button class="btn" id="ok">حفظ</button><button class="btn secondary" data-close>إلغاء</button></div>`, (m, close) => {
      const sync = () => { $('#perms', m).style.opacity = $('#role', m).value === 'moderator' ? 1 : 0.4; };
      $('#role', m).onchange = sync; sync();
      $('#ok', m).onclick = async () => {
        try {
          await api(`/admin/staff/${u.id}`, { method: 'PUT', body: { role: $('#role', m).value, permissions: $$('#perms input:checked', m).map((c) => c.value) } });
          close(); toast('تم الحفظ'); reload();
        } catch (e) { $('.form-error', m).innerHTML = alertBox(e.message); }
      };
    });
    $$('[data-ed]', box).forEach((b) => b.onclick = () => editor(d.items.find((x) => x.id === Number(b.dataset.ed))));
    $('#add', box).onclick = () => userPicker('اختر المستخدم لتعيينه مشرفًا', (u) => editor({ ...u, role: 'moderator', permissions: [] }));
  },

  // ================= الإعدادات =================
  async settings(box) {
    const s = await api('/admin/settings');
    box.innerHTML = `<div class="card mid"><form id="f">
      <div class="form-error"></div>
      <div class="field"><label>اسم المنصة</label><input name="site_name" value="${esc(s.site_name)}"></div>
      <div class="field"><label class="check"><input type="checkbox" name="require_link_for_tree" ${s.require_link_for_tree === '1' ? 'checked' : ''}> لا تُعرض المشجرة إلا للحسابات المرتبطة والمعتمدة</label></div>
      <div class="field"><label>تنبيه "قارب على الانتهاء" قبل (يوم)</label><input type="number" name="expiring_days" min="1" max="90" value="${esc(s.expiring_days)}"></div>
      <p class="small muted">اللافتات ومربعات الصفحة الرئيسية تُدار من تبويب <a href="#/admin/home">الصفحة الرئيسية</a>.</p>
      <button class="btn" type="submit">حفظ</button></form></div>
      <div class="card mid" id="otpCard"><p class="muted">جارٍ تحميل طرق التحقق…</p></div>
      <div class="card mid">
        <h3>${icon('layers')} النسخ الاحتياطي ونقل البيانات</h3>
        <p class="small muted">ملف واحد يحوي قاعدة البيانات كاملة (الحسابات، المشجرة، الاشتراكات، الوصايا، الرسائل…) وكل الصور. احتفظ بنسخة دورية في مكان آمن، واستخدمه لنقل الموقع إلى خادم جديد.</p>
        <a class="btn" href="/api/admin/backup" download>${icon('doc')} تنزيل نسخة احتياطية الآن</a>
        <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
        <b>استعادة نسخة احتياطية</b>
        <p class="small muted">تستبدل البيانات الحالية بالكامل بما في الملف (تُحفظ القاعدة الحالية احتياطًا على الخادم)، ثم يُعاد تشغيل الخادم تلقائيًا. ربط بوت واتساب لا يُنقل، ويُعاد ربطه بمسح QR.</p>
        <form id="rf" class="row"><input type="file" name="backup" accept=".gz,.tar.gz,application/gzip" required style="max-width:320px"><button class="btn danger" type="submit">استعادة</button></form>
        <div id="rmsg"></div>
      </div>`;
    renderOtpCard($('#otpCard', box));
    $('#rf', box).onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      if (!fd.get('backup') || !fd.get('backup').size) return;
      if (!(await confirmDialog('استبدال كل بيانات الموقع الحالية بالنسخة الاحتياطية؟ لا يمكن التراجع من هنا.', { ok: 'استعادة', danger: true }))) return;
      const msg = $('#rmsg', box);
      msg.innerHTML = '<div class="alert info">جارٍ رفع النسخة…</div>';
      try {
        const r = await api('/admin/restore', { method: 'POST', form: fd });
        msg.innerHTML = `<div class="alert ok">تم استلام النسخة (${r.images} صورة). يُعاد تشغيل الخادم الآن…</div>`;
        // انتظار عودة الخادم ثم إعادة تحميل الصفحة
        const t0 = Date.now();
        const wait = async () => {
          try { const h = await fetch('/api/health', { cache: 'no-store' }); if (h.ok && Date.now() - t0 > 3000) { location.reload(); return; } } catch { /* ما زال يعيد التشغيل */ }
          if (Date.now() - t0 > 120000) { msg.innerHTML = '<div class="alert warn">لم يعد الخادم بعد. إذا كان يعمل على جهازك فأعد تشغيله يدويًا (npm start).</div>'; return; }
          setTimeout(wait, 2000);
        };
        setTimeout(wait, 2500);
      } catch (err) { msg.innerHTML = alertBox(err.message); }
    };
    bindForm($('#f', box), async (fd) => {
      await api('/admin/settings', { method: 'PUT', body: {
        site_name: fd.get('site_name'), expiring_days: fd.get('expiring_days'), require_link_for_tree: fd.get('require_link_for_tree') ? '1' : '0',
      } });
      toast('تم الحفظ');
    });
  },

  // ================= سجل العمليات =================
  async audit(box, page = 1) {
    const d = await api(`/admin/audit?page=${page}&size=50`);
    box.innerHTML = `<div class="card"><div class="table-wrap"><table><thead><tr><th>الوقت</th><th>المنفّذ</th><th>العملية</th><th>العنصر</th><th>التفاصيل</th></tr></thead><tbody>
      ${d.items.map((a) => `<tr><td class="small">${date(a.created_at, true)}</td><td>${esc(a.actor_name || '—')}</td><td><code>${esc(a.action)}</code></td><td class="small">${esc(a.entity || '')} ${esc(a.entity_id ?? '')}</td>
        <td class="small" style="max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(a.details || '')}">${esc(a.details || '')}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="row" style="margin-top:12px">${page > 1 ? `<button class="btn sm secondary" data-page="${page - 1}">الأحدث</button>` : ''}${d.items.length === 50 ? `<button class="btn sm secondary" data-page="${page + 1}">الأقدم</button>` : ''}</div></div>`;
    onPage(box, (p) => PANELS.audit(box, p));
  },

  // ================= بوابات الدفع =================
  async gateways(box) {
    const d = await api('/admin/gateways');
    const reload = () => PANELS.gateways(box);
    const live = d.items.filter((g) => g.is_active && g.ready);
    box.innerHTML = `
      <div class="row between" style="margin-bottom:12px">
        <p class="muted" style="margin:0">أضف طرق الدفع التي تريدها، وشغّلها أو أوقفها متى شئت. الأعضاء يختارون من الطرق المفعّلة عند الاشتراك، بالترتيب الظاهر هنا.</p>
        <button class="btn" id="addG">${icon('plus')} إضافة بوابة دفع</button>
      </div>
      ${!live.length ? alertBox('لا توجد بوابة دفع مفعّلة الآن، فلن يستطيع الأعضاء الاشتراك في الباقات المدفوعة.', 'warn') : ''}
      <div class="gw-list">${d.items.length ? d.items.map((g, i) => `
        <div class="card gw-row ${g.is_active ? '' : 'off'}">
          <div class="gw-info">
            <div class="row"><b style="font-size:1.08rem">${esc(g.name)}</b>
              ${g.is_active ? (g.ready ? '<span class="badge ok">مفعّلة</span>' : '<span class="badge warn">مفعّلة لكن غير مكتملة</span>') : '<span class="badge">متوقفة</span>'}
              ${i === d.items.findIndex((x) => x.is_active && x.ready) && g.is_active && g.ready ? '<span class="badge info">الأولى</span>' : ''}</div>
            <div class="small muted">${esc(g.provider_label)}${g.description ? ` · ${esc(g.description)}` : ''}${g.payments_count ? ` · ${g.payments_count} عملية` : ''}</div>
          </div>
          <label class="switch" title="${g.is_active ? 'إيقاف' : 'تشغيل'}"><input type="checkbox" data-tg="${g.id}" ${g.is_active ? 'checked' : ''}><span></span></label>
          <div class="row">
            <button class="btn sm secondary" data-mv="${i}:-1" ${i === 0 ? 'disabled' : ''} aria-label="تقديم">▲</button>
            <button class="btn sm secondary" data-mv="${i}:1" ${i === d.items.length - 1 ? 'disabled' : ''} aria-label="تأخير">▼</button>
            <button class="btn sm secondary" data-ed="${g.id}">${icon('edit')} إعدادات</button>
            <button class="btn sm danger" data-del="${g.id}" aria-label="حذف">${icon('trash')}</button>
          </div>
        </div>`).join('') : `<div class="card empty">${icon('gem')}<p>لم تُضف أي بوابة دفع بعد.</p></div>`}</div>`;

    $('#addG', box).onclick = () => chooseProvider(d.catalog, (prov) => gatewayForm(prov, null, reload));
    $$('[data-ed]', box).forEach((b) => b.onclick = () => {
      const g = d.items.find((x) => String(x.id) === b.dataset.ed);
      gatewayForm(d.catalog.find((c) => c.key === g.provider), g, reload);
    });
    $$('[data-tg]', box).forEach((c) => c.onchange = async () => {
      try { await api(`/admin/gateways/${c.dataset.tg}`, { method: 'PUT', body: { is_active: c.checked } }); toast(c.checked ? 'تم تشغيل البوابة' : 'تم إيقاف البوابة'); reload(); }
      catch (e) { c.checked = !c.checked; toast(e.message); }
    });
    $$('[data-mv]', box).forEach((b) => b.onclick = async () => {
      const [i, dir] = b.dataset.mv.split(':').map(Number); const ids = d.items.map((g) => g.id);
      [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
      try { await api('/admin/gateways/reorder', { method: 'POST', body: { ids } }); reload(); } catch (e) { toast(e.message); }
    });
    $$('[data-del]', box).forEach((b) => b.onclick = async () => {
      const g = d.items.find((x) => String(x.id) === b.dataset.del);
      const msg = g.payments_count ? `حذف "${g.name}"؟ لها ${g.payments_count} عملية سابقة، لذلك ستُخفى وتبقى سجلاتها محفوظة.` : `حذف "${g.name}" نهائيًا؟`;
      if (!(await confirmDialog(msg, { ok: 'حذف', danger: true }))) return;
      try { await api(`/admin/gateways/${g.id}`, { method: 'DELETE' }); toast('تم الحذف'); reload(); } catch (e) { toast(e.message); }
    });
  },

  // ================= الصفحة الرئيسية =================
  async home(box) {
    const d = await api('/admin/home');
    const reload = () => PANELS.home(box);
    const thumb = (b) => b.image ? `<img class="hb-thumb" src="${esc(b.image)}" alt="">` : `<div class="hb-thumb hb-plain">نص فقط</div>`;
    const tIcon = (t) => t.key === 'members' ? '<b class="ht-num">123</b>' : t.image ? `<img class="ht-img" src="${esc(t.image)}" alt="">` : tileIcon(t.icon);
    const moveBtns = (type, i, len) => `<button class="btn sm secondary" data-mv="${type}:${i}:-1" ${i === 0 ? 'disabled' : ''} aria-label="تقديم">▲</button><button class="btn sm secondary" data-mv="${type}:${i}:1" ${i === len - 1 ? 'disabled' : ''} aria-label="تأخير">▼</button>`;

    box.innerHTML = `
      <div class="row between" style="margin-bottom:14px">
        <p class="muted" style="margin:0">كل ما يظهر في الصفحة الرئيسية للأعضاء يُعدَّل من هنا مباشرة.</p>
        <a class="btn secondary" href="#/">${icon('home')} عرض الصفحة الرئيسية</a>
      </div>

      <div class="card">
        <h3>تشغيل وإيقاف أقسام الموقع</h3>
        <p class="muted small" style="margin-top:0">القسم الموقوف يختفي من الصفحة الرئيسية والقائمة والشريط السفلي، ولا يستطيع الأعضاء فتحه. تبقى بياناته محفوظة، وتستطيع الإدارة تجهيز محتواه، ويعود كما كان عند تشغيله.</p>
        <div class="mod-list">${d.modules.map((m) => `
          <div class="mod-row ${m.enabled ? '' : 'off'}">
            <div><b>${esc(m.label)}</b> ${m.enabled ? '<span class="badge ok">يعمل</span>' : '<span class="badge warn">متوقف</span>'}</div>
            <label class="switch" title="${m.enabled ? 'إيقاف' : 'تشغيل'}"><input type="checkbox" data-mod="${m.key}" ${m.enabled ? 'checked' : ''}><span></span></label>
          </div>`).join('')}</div>
      </div>

      <div class="card">
        <h3>الأقسام الظاهرة</h3>
        <div class="row" style="gap:22px">
          <label class="check"><input type="checkbox" data-sec="home_show_banners" ${d.sections.home_show_banners ? 'checked' : ''}> اللافتات</label>
          <label class="check"><input type="checkbox" data-sec="home_show_stats" ${d.sections.home_show_stats ? 'checked' : ''}> بطاقة "العائلة في أرقام"</label>
          <label class="check"><input type="checkbox" data-sec="home_show_next_event" ${d.sections.home_show_next_event ? 'checked' : ''}> المناسبة القادمة</label>
        </div>
      </div>

      <div class="card">
        <div class="row between"><h3 style="margin:0">اللافتات (${d.banners.length})</h3><button class="btn" id="addB">${icon('plus')} إضافة لافتة</button></div>
        <p class="small muted">تظهر أعلى الصفحة وتتبدّل تلقائيًا إذا كانت أكثر من واحدة. المقاس المناسب للصورة: 1600×700 بكسل.</p>
        <div class="hb-list">${d.banners.length ? d.banners.map((b, i) => `
          <div class="hb-row">
            ${thumb(b)}
            <div class="hb-info"><b>${esc(b.title || '(بدون عنوان)')}</b><div class="muted small">${esc(b.text || '')}</div>
              <div class="small">${b.is_active ? '<span class="badge ok">ظاهرة</span>' : '<span class="badge">مخفية</span>'} ${b.link ? `<span class="muted" dir="ltr">${esc(b.link)}</span>` : ''}</div></div>
            <div class="row">${moveBtns('banners', i, d.banners.length)}
              <button class="btn sm secondary" data-eb="${b.id}">${icon('edit')} تعديل</button>
              <button class="btn sm danger" data-db="${b.id}">${icon('trash')}</button></div>
          </div>`).join('') : '<p class="muted">لا توجد لافتات.</p>'}</div>
      </div>

      <div class="card">
        <div class="row between"><h3 style="margin:0">المربعات (${d.tiles.length})</h3><button class="btn" id="addT">${icon('plus')} إضافة مربع</button></div>
        <p class="small muted">المربعات "الأساسية" مرتبطة بميزات المنصة: تستطيع تغيير اسمها وأيقونتها وترتيبها وإخفاءها. المربعات "المخصصة" تضيفها برابط داخلي أو خارجي وتحذفها متى شئت.
          مربع "ربط حسابي" يظهر فقط لمن لم يربط حسابه، و"لوحة الإدارة" للمشرفين فقط.</p>
        <div class="ht-list">${d.tiles.map((t, i) => `
          <div class="ht-row ${t.is_visible ? '' : 'off'}">
            <div class="ht-ic">${tIcon(t)}</div>
            <div class="ht-info"><b>${esc(t.label)}</b>
              <div class="small">${t.kind === 'system' ? '<span class="badge info">أساسي</span>' : `<span class="badge">مخصص</span> <span class="muted" dir="ltr">${esc(t.link || '')}</span>`}</div></div>
            <label class="check small"><input type="checkbox" data-vis="${t.id}" ${t.is_visible ? 'checked' : ''}> ظاهر</label>
            <div class="row">${moveBtns('tiles', i, d.tiles.length)}
              <button class="btn sm secondary" data-et="${t.id}">${icon('edit')} تعديل</button>
              ${t.kind === 'custom' ? `<button class="btn sm danger" data-dt="${t.id}">${icon('trash')}</button>` : ''}</div>
          </div>`).join('')}</div>
      </div>`;

    $$('[data-sec]', box).forEach((c) => c.onchange = async () => {
      try { await api('/admin/home/sections', { method: 'PUT', body: { [c.dataset.sec]: c.checked ? 1 : 0 } }); toast('تم الحفظ'); } catch (e) { toast(e.message); c.checked = !c.checked; }
    });
    $$('[data-mv]', box).forEach((b) => b.onclick = async () => {
      const [type, i, dir] = b.dataset.mv.split(':'); const list = [...d[type]]; const a = Number(i), z = a + Number(dir);
      [list[a], list[z]] = [list[z], list[a]];
      try { await api('/admin/home/reorder', { method: 'POST', body: { type, ids: list.map((x) => x.id) } }); reload(); } catch (e) { toast(e.message); }
    });
    $('#addB', box).onclick = () => bannerForm({}, reload);
    $$('[data-eb]', box).forEach((b) => b.onclick = () => bannerForm(d.banners.find((x) => String(x.id) === b.dataset.eb), reload));
    $$('[data-db]', box).forEach((b) => b.onclick = async () => {
      if (!(await confirmDialog('حذف هذه اللافتة نهائيًا؟', { ok: 'حذف', danger: true }))) return;
      try { await api(`/admin/home/banners/${b.dataset.db}`, { method: 'DELETE' }); toast('تم الحذف'); reload(); } catch (e) { toast(e.message); }
    });
    $$('[data-mod]', box).forEach((c) => c.onchange = async () => {
      const m = d.modules.find((x) => x.key === c.dataset.mod);
      if (!c.checked && !(await confirmDialog(`إيقاف قسم "${m.label}"؟ سيختفي من الصفحة الرئيسية والقوائم حتى تعيد تشغيله.`, { ok: 'إيقاف', danger: true }))) { c.checked = true; return; }
      try {
        await api('/admin/modules', { method: 'PUT', body: { [m.key]: c.checked } });
        toast(c.checked ? `تم تشغيل: ${m.label}` : `تم إيقاف: ${m.label}`);
        state.home = null; state.homeAt = 0; await refreshMe(); window.dispatchEvent(new Event('me-changed'));
        reload();
      } catch (e) { toast(e.message); c.checked = !c.checked; }
    });
    $('#addT', box).onclick =() => tileForm({ kind: 'custom', is_visible: 1, icon: 'star' }, d.icons, reload);
    $$('[data-et]', box).forEach((b) => b.onclick = () => tileForm(d.tiles.find((x) => String(x.id) === b.dataset.et), d.icons, reload));
    $$('[data-dt]', box).forEach((b) => b.onclick = async () => {
      if (!(await confirmDialog('حذف هذا المربع نهائيًا؟', { ok: 'حذف', danger: true }))) return;
      try { await api(`/admin/home/tiles/${b.dataset.dt}`, { method: 'DELETE' }); toast('تم الحذف'); reload(); } catch (e) { toast(e.message); }
    });
    $$('[data-vis]', box).forEach((c) => c.onchange = async () => {
      const t = d.tiles.find((x) => String(x.id) === c.dataset.vis);
      const fd = new FormData();
      fd.append('label', t.label); fd.append('icon', t.icon || ''); fd.append('is_visible', c.checked ? '1' : '0'); if (t.link) fd.append('link', t.link);
      try { await api(`/admin/home/tiles/${t.id}`, { method: 'PUT', form: fd }); reload(); } catch (e) { toast(e.message); c.checked = !c.checked; }
    });
  },

  // ================= المناسبات =================
  async events(box, scope = 'upcoming') {
    const d = await api(`/admin/events?scope=${scope}`);
    box.innerHTML = `${modOff('events', 'المناسبات')}
      <div class="row between" style="margin-bottom:12px">
        <div class="row">${[['upcoming', 'القادمة'], ['past', 'السابقة']].map(([k, t]) => `<button class="btn sm ${k === scope ? '' : 'secondary'}" data-sc="${k}">${t}</button>`).join('')}</div>
        <button class="btn" id="add">${icon('plus')} إضافة مناسبة</button>
      </div>
      <div class="mid">${d.items.length ? d.items.map((e) => eventCard(e, d.now, { past: scope === 'past', admin: true })).join('')
        : `<div class="card empty">${icon('calendar')}<p>لا توجد مناسبات ${scope === 'upcoming' ? 'قادمة' : 'سابقة'}.</p></div>`}</div>`;
    const reload = () => PANELS.events(box, scope);
    $$('[data-sc]', box).forEach((b) => b.onclick = () => PANELS.events(box, b.dataset.sc));
    $('#add', box).onclick = () => eventForm({}, async (body) => { await api('/admin/events', { method: 'POST', body }); toast('تمت إضافة المناسبة'); reload(); });
    $$('[data-edit]', box).forEach((b) => b.onclick = () => {
      const e = d.items.find((x) => String(x.id) === b.dataset.edit);
      eventForm(e, async (body) => { await api(`/admin/events/${e.id}`, { method: 'PUT', body }); toast('تم الحفظ'); reload(); });
    });
    $$('[data-del]', box).forEach((b) => b.onclick = async () => {
      if (!(await confirmDialog('حذف هذه المناسبة نهائيًا مع ردود الحضور؟ (لإبلاغ الأعضاء بالإلغاء استخدم "ملغاة" من التعديل بدلًا من الحذف)', { ok: 'حذف', danger: true }))) return;
      try { await api(`/admin/events/${b.dataset.del}`, { method: 'DELETE' }); toast('تم الحذف'); reload(); } catch (e) { toast(e.message); }
    });
    $$('[data-att]', box).forEach((b) => b.onclick = async () => {
      const r = await api(`/admin/events/${b.dataset.att}/rsvps`);
      modal(`<h3>ردود الحضور (${r.items.length})</h3>
        ${r.items.length ? `<div class="table-wrap"><table><thead><tr><th>العضو</th><th>رقم العضوية</th><th>الجوال</th><th>الرد</th></tr></thead><tbody>
          ${r.items.map((x) => `<tr><td>${esc(x.full_name)}</td><td>${esc(x.membership_no)}</td><td dir="ltr" style="text-align:right">+${esc(x.phone)}</td>
            <td><span class="badge ${x.status === 'yes' ? 'ok' : x.status === 'maybe' ? 'warn' : 'danger'}">${LABELS.rsvp[x.status]}</span></td></tr>`).join('')}
          </tbody></table></div>` : '<p class="muted">لم يرد أحد بعد.</p>'}
        <div class="actions"><button class="btn secondary" data-close>إغلاق</button></div>`, null, { large: true });
    });
  },

  // ================= الرسائل الجماعية =================
  async broadcast(box) {
    clearTimeout(bcTimer);
    const d = await api('/admin/announcements');
    const ch = d.channel;
    const chLabel = ch.active === 'bot' ? `بوت واتساب${ch.bot.me ? ` (<span dir="ltr">+${esc(ch.bot.me)}</span>)` : ''}` : ch.active === 'cloud' ? 'واتساب الرسمي (قالب معتمد)' : null;
    const pendingAll = d.items.reduce((s, a) => s + a.stats.wa_pending, 0);
    const waitNote = pendingAll && d.queue.waiting_reason === 'no_channel' ? 'الرسائل بانتظار تجهيز قناة واتساب، وستُرسل تلقائيًا عند ربطها.'
      : pendingAll && d.queue.waiting_reason === 'daily_limit' ? 'وصل البوت للحد اليومي، وسيكمل الإرسال لاحقًا تلقائيًا.' : '';
    box.innerHTML = `
      <div class="row between" style="margin-bottom:12px">
        <p class="muted" style="margin:0">رسالة واحدة تصل لجميع الأعضاء: تظهر في الموقع فورًا، وتُرسل على واتساب تدريجيًا.</p>
        <button class="btn" id="newB">${icon('send')} رسالة جماعية جديدة</button>
      </div>

      <div class="card">
        <div class="row between">
          <div class="wa-ch">${icon('whatsapp')}<div><b>قناة واتساب</b><div class="small">${chLabel ? `<span class="badge ok">جاهزة</span> ${chLabel}` : '<span class="badge warn">غير جاهزة</span> الرسائل تظهر في الموقع فقط حتى تُجهَّز قناة واتساب'}</div></div></div>
          ${ch.active === 'bot' ? `<span class="small muted">أُرسل اليوم ${ch.bot.sent_today} من ${ch.bot.daily_limit}</span>` : ''}
        </div>
        ${waitNote ? `<div class="alert warn" style="margin-top:10px">${esc(waitNote)}</div>` : ''}
        ${d.can_configure ? `<details style="margin-top:10px" ${ch.active ? '' : 'open'}><summary class="small"><b>إعداد قناة واتساب</b></summary>
          <div class="grid grid-2" style="margin-top:10px">
            <div>
              <label class="check"><input type="checkbox" id="botB" ${ch.bot.for_broadcast || ch.bot.for_otp ? 'checked' : ''} ${ch.bot.for_otp ? 'disabled' : ''}> استخدام <b>بوت واتساب</b> (مجاني، بمسح QR)</label>
              ${ch.bot.for_otp ? '<p class="small muted" style="margin-top:-4px">البوت يعمل حاليًا لأنه مفعّل كطريقة تحقق (الإعدادات ← طرق التحقق)، ويُستخدم للرسائل الجماعية تلقائيًا.</p>' : ''}
              <p class="small muted">يرسل نصًا وصورًا من رقم واتساب عادي. غير معتمد من واتساب وقد يُحظر الرقم، فاستخدم رقمًا مخصصًا، وأبقِ الحد اليومي معقولًا (يُضبط من الإعدادات). يرسل رسالة كل 5 إلى 9 ثوانٍ تقريبًا.</p>
              <div id="botBox"></div>
            </div>
            <div>
              <b class="small">أو واتساب الرسمي (Meta)</b>
              <p class="small muted">يحتاج مفتاح واتساب الرسمي (من الإعدادات ← طرق التحقق) و<b>قالب رسالة معتمد</b> من Meta فيه متغير واحد {{1}} يوضع فيه نص الرسالة. ${ch.cloud.has_token ? '' : '<b>مفتاح واتساب الرسمي غير مضبوط بعد.</b>'}</p>
              <div class="field"><label class="small">اسم القالب</label><input id="tplN" dir="ltr" value="${esc(ch.cloud.template)}" placeholder="family_broadcast"></div>
              <div class="field"><label class="small">لغة القالب</label><input id="tplL" dir="ltr" value="${esc(ch.cloud.lang)}" placeholder="ar" style="max-width:120px"></div>
              <button class="btn sm secondary" id="tplS">حفظ القالب</button>
            </div>
          </div></details>` : ''}
      </div>

      ${d.items.length ? d.items.map((a) => {
        const s = a.stats;
        const waTxt = !a.send_whatsapp ? '<span class="muted">في الموقع فقط</span>'
          : `واتساب: <b>${s.wa_sent}</b> أُرسلت${s.wa_pending ? ` · <b>${s.wa_pending}</b> بالانتظار` : ''}${s.wa_failed ? ` · <b style="color:var(--danger)">${s.wa_failed}</b> تعذّرت` : ''}${s.wa_skipped ? ` · ${s.wa_skipped} أوقفوا الاستقبال` : ''}${s.wa_cancelled ? ` · ${s.wa_cancelled} أُلغيت` : ''}`;
        return `<div class="card">
          <div class="row between">
            <div style="min-width:0"><span class="ann-kind">${esc(d.kinds[a.kind])}</span> <b>${esc(a.title)}</b>
              <div class="small muted">${date(a.created_at, true)}${a.sender ? ` · ${esc(a.sender)}` : ''} · ${a.audience === 'linked' ? 'المرتبطون بالمشجرة' : 'جميع الأعضاء'}</div></div>
            <div class="row">
              <button class="btn sm secondary" data-dv="${a.id}">التفاصيل</button>
              ${s.wa_pending ? `<button class="btn sm secondary" data-cx="${a.id}">إيقاف واتساب</button>` : ''}
              ${a.send_whatsapp && (s.wa_failed || s.wa_cancelled) ? `<button class="btn sm secondary" data-rt="${a.id}">إعادة المحاولة</button>` : ''}
              <button class="btn sm danger" data-del="${a.id}" title="حذف من الموقع">${icon('trash')}</button>
            </div>
          </div>
          <div class="ann-stats"><span>المستلمون <b>${s.recipients}</b></span><span>قرأها في الموقع <b>${s.read}</b></span><span>${waTxt}</span></div>
        </div>`;
      }).join('') : `<div class="card empty">${icon('send')}<p>لم تُرسل أي رسالة جماعية بعد.</p></div>`}`;

    const reload = () => PANELS.broadcast(box);
    $('#newB', box).onclick = () => broadcastForm(d, reload);
    if (d.can_configure) {
      if (ch.bot.enabled) renderBotBox($('#botBox', box), true);
      else $('#botBox', box).innerHTML = '<p class="small muted">فعّل الخيار أعلاه ليظهر رمز QR لربط رقم البوت.</p>';
      $('#botB', box).onchange = async (e) => {
        try { await api('/admin/announcements/channel', { method: 'PUT', body: { bot_for_broadcast: e.target.checked } }); toast(e.target.checked ? 'تم تشغيل البوت للرسائل الجماعية' : 'تم إيقاف البوت للرسائل الجماعية'); reload(); } catch (err) { toast(err.message); }
      };
      $('#tplS', box).onclick = async () => {
        try { await api('/admin/announcements/channel', { method: 'PUT', body: { template: $('#tplN', box).value, lang: $('#tplL', box).value } }); toast('تم حفظ القالب'); reload(); } catch (err) { toast(err.message); }
      };
    }
    $$('[data-dv]', box).forEach((b) => b.onclick = () => broadcastDetails(d.items.find((x) => x.id === Number(b.dataset.dv))));
    $$('[data-cx]', box).forEach((b) => b.onclick = async () => {
      if (!(await confirmDialog('إيقاف إرسال ما تبقى من هذه الرسالة على واتساب؟ (تبقى ظاهرة في الموقع)', { ok: 'إيقاف', danger: true }))) return;
      try { const r = await api(`/admin/announcements/${b.dataset.cx}/cancel-whatsapp`, { method: 'POST' }); toast(`أُلغي إرسال ${r.cancelled} رسالة`); reload(); } catch (e) { toast(e.message); }
    });
    $$('[data-rt]', box).forEach((b) => b.onclick = async () => {
      try { const r = await api(`/admin/announcements/${b.dataset.rt}/retry`, { method: 'POST' }); toast(`أُعيدت ${r.retried} رسالة للإرسال`); reload(); } catch (e) { toast(e.message); }
    });
    $$('[data-del]', box).forEach((b) => b.onclick = async () => {
      if (!(await confirmDialog('حذف هذه الرسالة من الموقع وإيقاف ما تبقى من إرسالها؟ (ما وصل على واتساب لا يمكن سحبه)', { ok: 'حذف', danger: true }))) return;
      try { await api(`/admin/announcements/${b.dataset.del}`, { method: 'DELETE' }); toast('تم الحذف'); reload(); } catch (e) { toast(e.message); }
    });
    // تحديث تلقائي لعدّاد الإرسال أثناء وجود رسائل بالانتظار
    const autoR = () => {
      if (!document.body.contains(box)) return;
      if (document.querySelector('.modal-bg')) { bcTimer = setTimeout(autoR, 6000); return; }
      reload();
    };
    if (pendingAll) bcTimer = setTimeout(autoR, 6000);
  },

  // ================= وصايا الأجداد =================
  async wills(box) {
    const d = await api('/admin/wills');
    box.innerHTML = `${modOff('wills', 'وصايا الأجداد')}
      <div class="row between" style="margin-bottom:12px">
        <p class="muted small" style="margin:0">الوصايا المنشورة تظهر للأعضاء في صفحة "وصايا الأجداد"، وفي بطاقة صاحبها داخل المشجرة.</p>
        <button class="btn" id="add">${icon('plus')} إضافة وصية</button>
      </div>
      ${d.items.length ? `<div class="gw-list">${d.items.map((w, i) => `
        <div class="card gw-row ${w.is_published ? '' : 'off'}">
          <div class="row between">
            <div style="min-width:0">
              <b>${esc(w.title)}</b> ${w.is_published ? '<span class="badge ok">منشورة</span>' : '<span class="badge">مسودة</span>'} ${w.image ? '<span class="badge info">مع صورة</span>' : ''}
              <div class="small muted">${esc(w.author || '')}${w.will_date ? ` · ${esc(w.will_date)}` : ''}</div>
            </div>
            <div class="row">
              <button class="btn sm secondary" data-up="${i}" ${i ? '' : 'disabled'} title="أعلى">▲</button>
              <button class="btn sm secondary" data-dn="${i}" ${i < d.items.length - 1 ? '' : 'disabled'} title="أسفل">▼</button>
              <button class="btn sm secondary" data-ed="${w.id}">${icon('edit')} تعديل</button>
              <button class="btn sm danger" data-del="${w.id}">${icon('trash')}</button>
            </div>
          </div>
        </div>`).join('')}</div>`
        : `<div class="card empty">${icon('scroll')}<p>لم تُضف أي وصية بعد.</p></div>`}`;
    const reload = () => PANELS.wills(box);
    const save = (w) => async (fd) => {
      await api(w ? `/admin/wills/${w.id}` : '/admin/wills', { method: w ? 'PUT' : 'POST', form: fd });
      toast(w ? 'تم الحفظ' : 'تمت إضافة الوصية'); reload();
    };
    $('#add', box).onclick = () => willForm(null, save(null));
    $$('[data-ed]', box).forEach((b) => b.onclick = () => { const w = d.items.find((x) => x.id === Number(b.dataset.ed)); willForm(w, save(w)); });
    $$('[data-del]', box).forEach((b) => b.onclick = async () => {
      if (!(await confirmDialog('حذف هذه الوصية نهائيًا؟', { ok: 'حذف', danger: true }))) return;
      try { await api(`/admin/wills/${b.dataset.del}`, { method: 'DELETE' }); toast('تم الحذف'); reload(); } catch (e) { toast(e.message); }
    });
    const move = async (i, j) => {
      const ids = d.items.map((x) => x.id); [ids[i], ids[j]] = [ids[j], ids[i]];
      try { await api('/admin/wills/reorder', { method: 'POST', body: { ids } }); reload(); } catch (e) { toast(e.message); }
    };
    $$('[data-up]', box).forEach((b) => b.onclick = () => move(Number(b.dataset.up), Number(b.dataset.up) - 1));
    $$('[data-dn]', box).forEach((b) => b.onclick = () => move(Number(b.dataset.dn), Number(b.dataset.dn) + 1));
  },

  // ================= الاقتراحات والاستفسارات =================
  async feedback(box, status = 'new', type = 'all') {
    const d = await api(`/admin/feedback?status=${status}&type=${type}`);
    box.innerHTML = `${modOff('feedback', 'الاقتراحات والاستفسارات')}
      <div class="row between" style="margin-bottom:12px">
        <div class="row">${['new', 'answered', 'closed', 'all'].map((s) => `<button class="btn sm ${s === status ? '' : 'secondary'}" data-st="${s}">${s === 'all' ? 'الكل' : LABELS.fb[s][0]}${s !== 'all' && d.counts[s] ? ` (${d.counts[s]})` : ''}</button>`).join('')}</div>
        <select id="ty" style="width:auto"><option value="all">كل الأنواع</option><option value="suggestion" ${type === 'suggestion' ? 'selected' : ''}>الاقتراحات</option><option value="inquiry" ${type === 'inquiry' ? 'selected' : ''}>الاستفسارات</option></select>
      </div>
      <div class="mid">${d.items.length ? d.items.map((f) => `
        <div class="card fb">
          <div class="row between"><div class="row"><span class="badge">${LABELS.fbType[f.type]}</span><b>${esc(f.subject)}</b></div>${badge('fb', f.status)}</div>
          <div class="muted small">${esc(f.full_name)} · ${esc(f.membership_no)} · <span dir="ltr">+${esc(f.phone)}</span> · ${date(f.created_at, true)}</div>
          <p class="fb-msg">${esc(f.message)}</p>
          ${f.reply ? `<div class="fb-reply"><div class="small"><b>الرد</b> <span class="muted">— ${esc(f.replied_by_name || '')} · ${date(f.replied_at, true)}</span></div><p>${esc(f.reply)}</p></div>` : ''}
          <div class="row" style="margin-top:10px">
            <button class="btn sm" data-reply="${f.id}">${f.reply ? 'تعديل الرد' : 'رد'}</button>
            ${f.status !== 'closed' ? `<button class="btn sm secondary" data-close-fb="${f.id}">إغلاق</button>` : `<button class="btn sm secondary" data-open-fb="${f.id}">إعادة فتح</button>`}
          </div>
        </div>`).join('') : `<div class="card empty">${icon('chat')}<p>لا توجد رسائل.</p></div>`}</div>`;
    const reload = () => PANELS.feedback(box, status, type);
    $$('[data-st]', box).forEach((b) => b.onclick = () => PANELS.feedback(box, b.dataset.st, type));
    $('#ty', box).onchange = (e) => PANELS.feedback(box, status, e.target.value);
    $$('[data-reply]', box).forEach((b) => b.onclick = () => {
      const f = d.items.find((x) => String(x.id) === b.dataset.reply);
      modal(`<h3>الرد على: ${esc(f.subject)}</h3><p class="fb-msg muted">${esc(f.message)}</p>
        <form id="rf"><div class="form-error"></div>
          <div class="field"><label>الرد (سيظهر للعضو في صفحة الاقتراحات والاستفسارات)</label><textarea name="reply" rows="5" required>${esc(f.reply || '')}</textarea></div>
          <div class="actions"><button class="btn" type="submit">إرسال الرد</button><button class="btn secondary" type="button" data-close>إلغاء</button></div></form>`, (m, close) => {
        bindForm($('#rf', m), async (fd) => { await api(`/admin/feedback/${f.id}/reply`, { method: 'POST', body: { reply: fd.get('reply') } }); close(); toast('تم إرسال الرد'); reload(); });
      });
    });
    const setSt = (id, st) => api(`/admin/feedback/${id}/status`, { method: 'POST', body: { status: st } }).then(reload).catch((e) => toast(e.message));
    $$('[data-close-fb]', box).forEach((b) => b.onclick = () => setSt(b.dataset.closeFb, 'closed'));
    $$('[data-open-fb]', box).forEach((b) => b.onclick = () => setSt(b.dataset.openFb, 'new'));
  },
};

// ================= طرق التحقق من الجوال =================
const METHOD_INFO = {
  wa_reverse: { cost: 'مجاني · رسمي', desc: 'العضو يضغط زرًا فيفتح واتساب برسالة جاهزة، ويرسلها من رقمه إلى رقم الصندوق، فيتحقق النظام تلقائيًا. يحتاج حساب Meta وموقعًا منشورًا.' },
  wa_bot: { cost: 'مجاني · غير رسمي', desc: 'بوت يرسل الرمز للعضو على واتساب تلقائيًا من رقم مربوط بمسح QR. قد يُحظر رقم البوت؛ استخدم رقمًا منفصلًا.' },
  sms: { cost: 'مدفوع لكل رسالة', desc: 'رسالة نصية بالرمز عبر مزوّد رسائل (Unifonic). يحتاج حسابًا وتسجيل اسم مرسل.' },
  manual: { cost: 'مجاني', desc: 'العضو يضغط "اطلب التوثيق"، ويوثّق المشرف رقمه من قائمة المستخدمين. مناسب إذا كانت الإدارة تعرف الأعضاء.' },
};
const BOT_STATES = {
  disabled: 'متوقف', connecting: 'جارٍ الاتصال…', qr: 'بانتظار مسح رمز QR', connected: 'متصل', logged_out: 'غير مربوط', error: 'خطأ',
};
let botTimer = null;
let bcTimer = null;

// ================= الرسائل الجماعية: النموذج والتفاصيل =================
function broadcastForm(d, onDone) {
  const ch = d.channel.active;
  modal(`<h3>رسالة جماعية جديدة</h3><form id="f">
    <div class="form-error"></div>
    <div class="grid grid-2">
      <div class="field"><label>النوع</label><select name="kind">${Object.entries(d.kinds).map(([k, t]) => `<option value="${k}" ${k === 'invitation' ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
      <div class="field"><label>المستلمون</label><select name="audience">${d.audiences.map((a) => `<option value="${a.key}">${esc(a.label)} (${a.total})</option>`).join('')}</select></div>
    </div>
    <div class="field"><label>العنوان</label><input name="title" required maxlength="120" placeholder="مثال: دعوة لحضور حفل زواج ابننا محمد"></div>
    <div class="field"><label>نص الرسالة</label><textarea name="body" rows="7" required maxlength="3000" placeholder="يتشرف … بدعوتكم لحضور حفل زواج …&#10;الزمان: …&#10;المكان: …"></textarea></div>
    <div class="field"><label>صورة (اختياري) — مثل بطاقة الدعوة</label><input type="file" name="image" accept="image/jpeg,image/png,image/webp"></div>
    <label class="check"><input type="checkbox" name="send_whatsapp" ${ch ? 'checked' : ''}> إرسالها على واتساب أيضًا</label>
    <p class="small muted" id="waHint" style="margin-top:-4px">${ch === 'bot' ? 'تُرسل عبر بوت واتساب مع الصورة، رسالة كل بضع ثوانٍ.' : ch === 'cloud' ? 'تُرسل عبر واتساب الرسمي بالقالب المعتمد (نص فقط مع رابط الرسالة في الموقع).' : 'قناة واتساب غير جاهزة: ستبقى رسائل واتساب بالانتظار وتُرسل تلقائيًا عند تجهيز القناة.'}</p>
    <div class="actions"><button class="btn" type="submit">${icon('send')} إرسال</button><button class="btn secondary" type="button" data-close>إلغاء</button></div></form>`, (m, close) => {
    bindForm($('#f', m), async (fd) => {
      const aud = d.audiences.find((a) => a.key === fd.get('audience'));
      const wa = !!fd.get('send_whatsapp');
      const msg = `إرسال "${fd.get('title')}" إلى ${aud.total} عضو في الموقع${wa ? `، وعلى واتساب إلى ${aud.whatsapp} عضو` : ''}؟`;
      if (!(await confirmDialog(msg, { ok: 'إرسال' }))) return;
      fd.set('send_whatsapp', wa ? '1' : '0');
      const file = fd.get('image');
      if (!file || !file.size) fd.delete('image');
      const r = await api('/admin/announcements', { method: 'POST', form: fd });
      toast(`تم الإرسال إلى ${r.stats.recipients} عضو${wa ? ' — جارٍ الإرسال على واتساب' : ''}`);
      close(); onDone();
    });
  }, { large: true });
}

async function broadcastDetails(a) {
  const ST = { sent: ['أُرسلت', 'ok'], pending: ['بالانتظار', 'warn'], failed: ['تعذّرت', 'danger'], skipped: ['أوقف الاستقبال', ''], cancelled: ['أُلغيت', ''], none: ['الموقع فقط', ''] };
  const draw = async (m, status) => {
    const r = await api(`/admin/announcements/${a.id}/deliveries?status=${status}`);
    $('#dl', m).innerHTML = r.items.length ? `<div class="table-wrap"><table><thead><tr><th>العضو</th><th>الجوال</th><th>في الموقع</th><th>واتساب</th></tr></thead><tbody>
      ${r.items.map((x) => `<tr><td>${esc(x.full_name)}<br><span class="small muted">${esc(x.membership_no)}</span></td><td dir="ltr" style="text-align:right">+${esc(x.phone)}</td>
        <td>${x.read_at ? '<span class="badge ok">قرأها</span>' : '<span class="badge">لم يقرأها</span>'}</td>
        <td><span class="badge ${ST[x.wa_status][1]}">${ST[x.wa_status][0]}</span>${x.wa_error ? `<div class="small muted">${esc(x.wa_error)}</div>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">لا يوجد</p>';
  };
  modal(`<h3>${esc(a.title)}</h3>
    ${a.image ? `<img src="${esc(a.image)}" alt="" style="max-height:160px;border-radius:10px;display:block;margin-bottom:10px">` : ''}
    <div class="ann-body" style="margin:0 0 12px;font-size:1rem">${esc(a.body)}</div>
    <div class="row" style="margin-bottom:10px">${[['all', 'الكل'], ['unread', 'لم يقرأها'], ...(a.send_whatsapp ? [['sent', 'أُرسلت واتساب'], ['pending', 'بالانتظار'], ['failed', 'تعذّرت']] : [])]
      .map(([k, t], i) => `<button class="btn sm ${i ? 'secondary' : ''}" data-f="${k}">${t}</button>`).join('')}</div>
    <div id="dl"><p class="muted">جارٍ التحميل…</p></div>
    <div class="actions"><button class="btn secondary" data-close>إغلاق</button></div>`, (m) => {
    $$('[data-f]', m).forEach((b) => b.onclick = () => { $$('[data-f]', m).forEach((x) => x.classList.toggle('secondary', x !== b)); draw(m, b.dataset.f); });
    draw(m, 'all');
  }, { large: true });
}

async function renderOtpCard(card) {
  let d;
  try { d = await api('/admin/otp-settings'); } catch (e) { card.innerHTML = alertBox(e.message); return; }
  const c = d.config;
  let order = d.methods.map((m) => m.key);
  const isOn = Object.fromEntries(d.methods.map((m) => [m.key, m.enabled]));
  const secret = (name, has, label) => `<div class="field"><label>${label}</label>
      <input name="${name}" type="password" autocomplete="off" dir="ltr" placeholder="${has ? 'مضبوط — اتركه فارغًا للإبقاء عليه' : 'غير مضبوط'}">
      ${has ? `<label class="check small" style="margin-top:4px"><input type="checkbox" name="clear_${name}"> مسح القيمة الحالية</label>` : ''}</div>`;

  const draw = () => {
    card.innerHTML = `
      <h3>${icon('lock')} طرق التحقق من رقم الجوال</h3>
      <p class="small muted">فعّل الطرق التي تريدها ورتّبها. الطريقة الأولى تظهر للعضو أولًا، والبقية تظهر تحتها كخيارات بديلة. الطريقة غير الجاهزة لا تظهر للأعضاء حتى تكتمل إعداداتها.</p>
      <form id="of">
        <div class="form-error"></div>
        <div class="vm-list">${order.map((k, i) => {
          const m = d.methods.find((x) => x.key === k);
          return `<div class="vm-row ${isOn[k] ? '' : 'off'}">
            <label class="check vm-main"><input type="checkbox" data-on="${k}" ${isOn[k] ? 'checked' : ''}>
              <span><b>${esc(m.label)}</b> <span class="badge">${METHOD_INFO[k].cost}</span>
                ${isOn[k] ? (m.ready ? '<span class="badge ok">جاهزة</span>' : '<span class="badge warn">تحتاج إعداد</span>') : ''}
                ${isOn[k] && i === order.findIndex((x) => isOn[x]) ? '<span class="badge info">الأساسية</span>' : ''}
                <div class="small muted">${METHOD_INFO[k].desc}</div></span></label>
            <div class="row"><button type="button" class="btn sm secondary" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="تقديم">▲</button>
              <button type="button" class="btn sm secondary" data-down="${i}" ${i === order.length - 1 ? 'disabled' : ''} aria-label="تأخير">▼</button></div>
          </div>`;
        }).join('')}</div>

        <details class="vm-cfg" ${isOn.wa_reverse ? 'open' : ''}><summary>إعدادات واتساب (العضو يرسل الرسالة)</summary>
          <div class="field"><label>رقم واتساب الصندوق (بالصيغة الدولية)</label><input name="wa_number" dir="ltr" value="${esc(c.wa_number)}" placeholder="9665XXXXXXXX"></div>
          <div class="field"><label>رابط الـ Webhook (ضعه في لوحة Meta)</label><input readonly dir="ltr" value="${esc(d.webhook_url)}"></div>
          <div class="field"><label>كلمة تحقق الـ Webhook (Verify Token)</label><input name="wa_verify_token" dir="ltr" value="${esc(c.wa_verify_token)}" placeholder="كلمة تختارها وتضعها في Meta"></div>
          ${secret('wa_app_secret', c.has_wa_app_secret, 'App Secret (من إعدادات التطبيق في Meta)')}
          <p class="small muted">اختياري — لإرسال رد "تم التفعيل" للعضو:</p>
          ${secret('wa_token', c.has_wa_token, 'Access Token')}
          <div class="field"><label>Phone Number ID</label><input name="wa_phone_number_id" dir="ltr" value="${esc(c.wa_phone_number_id)}"></div>
        </details>

        <details class="vm-cfg" ${isOn.wa_bot ? 'open' : ''}><summary>بوت واتساب</summary>
          ${alertBox('غير معتمد رسميًا من واتساب وقد يُحظر الرقم. استخدم رقمًا منفصلًا مخصصًا للبوت، وليس رقم الصندوق الأساسي.', 'warn')}
          <div class="field"><label>الحد اليومي للرسائل</label><input type="number" name="daily_limit" min="1" max="2000" value="${d.daily_limit}" style="max-width:140px"></div>
          <div id="botBox"></div>
        </details>

        <details class="vm-cfg" ${isOn.sms ? 'open' : ''}><summary>إعدادات الرسائل النصية (SMS)</summary>
          <div class="field"><label>المزوّد</label><select name="sms_provider">
            <option value="console" ${c.sms_provider !== 'unifonic' ? 'selected' : ''}>بدون مزوّد (تجربة: الرمز يظهر على الشاشة في وضع التطوير فقط)</option>
            <option value="unifonic" ${c.sms_provider === 'unifonic' ? 'selected' : ''}>Unifonic</option></select></div>
          ${secret('sms_unifonic_app_sid', c.has_sms_unifonic_app_sid, 'Unifonic AppSid')}
          <div class="field"><label>اسم المرسل المعتمد (Sender ID)</label><input name="sms_unifonic_sender" dir="ltr" value="${esc(c.sms_unifonic_sender)}"></div>
        </details>

        <details class="vm-cfg"><summary>التوثيق اليدوي</summary>
          <p class="small">طلبات التوثيق تظهر في تبويب <a href="#/admin/users">المستخدمون</a> مع زر "توثيق الجوال". ويمكنك توثيق أي عضو هناك حتى لو لم يطلب.</p>
        </details>

        <button class="btn" type="submit" style="margin-top:14px">حفظ إعدادات التحقق</button>
      </form>`;

    $$('[data-on]', card).forEach((cb) => cb.onchange = () => { isOn[cb.dataset.on] = cb.checked; keepInputs(); draw(); });
    $$('[data-up]', card).forEach((b) => b.onclick = () => { const i = Number(b.dataset.up); [order[i - 1], order[i]] = [order[i], order[i - 1]]; keepInputs(); draw(); });
    $$('[data-down]', card).forEach((b) => b.onclick = () => { const i = Number(b.dataset.down); [order[i + 1], order[i]] = [order[i], order[i + 1]]; keepInputs(); draw(); });
    restoreInputs();
    bindForm($('#of', card), async (fd) => {
      const cfg = {};
      for (const k of ['wa_number', 'wa_verify_token', 'wa_phone_number_id', 'sms_provider', 'sms_unifonic_sender']) cfg[k] = fd.get(k) || '';
      for (const k of ['wa_app_secret', 'wa_token', 'sms_unifonic_app_sid']) { if (fd.get(k)) cfg[k] = fd.get(k); if (fd.get(`clear_${k}`)) cfg[`clear_${k}`] = true; }
      d = await api('/admin/otp-settings', { method: 'PUT', body: { methods: order.filter((k) => isOn[k]), config: cfg, daily_limit: Number(fd.get('daily_limit')) } });
      draft = null;
      toast('تم حفظ إعدادات التحقق');
      Object.assign(c, d.config);
      d.methods.forEach((m) => { isOn[m.key] = m.enabled; });
      order = d.methods.map((m) => m.key);
      draw();
    });
    renderBotBox($('#botBox', card), isOn.wa_bot);
  };
  // الحفاظ على ما كتبه المدير عند إعادة الرسم (تغيير الترتيب/التفعيل)
  let draft = null;
  const keepInputs = () => { const f = $('#of', card); draft = f ? Object.fromEntries([...f.querySelectorAll('input[name],select[name]')].map((i) => [i.name, i.type === 'checkbox' ? i.checked : i.value])) : null; };
  const restoreInputs = () => { if (!draft) return; for (const [k, v] of Object.entries(draft)) { const i = card.querySelector(`[name="${k}"]`); if (i) { if (i.type === 'checkbox') i.checked = v; else i.value = v; } } };
  draw();
}

async function renderBotBox(box, enabled) {
  clearTimeout(botTimer);
  if (!box || !document.body.contains(box)) return;
  if (!enabled) { box.innerHTML = '<p class="small muted">فعّل طريقة "بوت واتساب" واحفظ، ليظهر رمز QR لربط الرقم.</p>'; return; }
  let s;
  try { s = await api('/admin/wa-bot'); } catch (e) { box.innerHTML = alertBox(e.message); return; }
  box.innerHTML = `
    <div class="row between" style="margin:6px 0">
      <span class="bot-state ${s.status}"><i></i>${BOT_STATES[s.status] || s.status}${s.me ? ` — <span dir="ltr">+${esc(s.me)}</span>` : ''}</span>
      <span class="small muted">أُرسل اليوم: ${s.sent_today}</span>
    </div>
    ${s.error ? alertBox(s.error) : ''}
    ${s.status === 'qr' && s.qr ? `<div style="text-align:center">
        <img class="bot-qr" src="${s.qr}" alt="رمز QR لربط البوت">
        <p class="small">من جوال رقم البوت: افتح واتساب ← الإعدادات ← <b>الأجهزة المرتبطة</b> ← ربط جهاز، ثم امسح الرمز.</p></div>` : ''}
    ${s.status === 'connected' ? `<div class="row" style="margin-top:10px">
        <input id="btPhone" dir="ltr" placeholder="05XXXXXXXX" style="max-width:180px">
        <button class="btn sm secondary" type="button" id="btSend">إرسال رسالة تجربة</button></div>` : ''}
    ${s.me || s.status === 'connected' || s.status === 'qr' ? '<button class="btn sm danger" type="button" id="bl" style="margin-top:12px">فك ربط رقم البوت</button>' : ''}`;
  const bs = $('#btSend', box);
  if (bs) bs.onclick = async () => { try { await api('/admin/wa-bot/test', { method: 'POST', body: { phone: $('#btPhone', box).value } }); toast('تم إرسال رسالة التجربة'); } catch (e) { toast(e.message); } };
  const bl = $('#bl', box);
  if (bl) bl.onclick = async () => {
    if (!(await confirmDialog('فك ربط رقم البوت؟ ستحتاج مسح رمز QR من جديد.', { ok: 'فك الربط', danger: true }))) return;
    try { await api('/admin/wa-bot/logout', { method: 'POST' }); toast('تم فك الربط'); renderBotBox(box, true); } catch (e) { toast(e.message); }
  };
  if (s.status !== 'connected') botTimer = setTimeout(() => renderBotBox(box, true), 3000);
}

// ================= نماذج بوابات الدفع =================
function chooseProvider(catalog, onPick) {
  modal(`<h3>اختر نوع بوابة الدفع</h3>
    <div class="prov-grid">${catalog.map((p) => `<button type="button" class="prov-card" data-p="${p.key}">
      <b>${esc(p.label)}</b><span class="small muted">${esc(p.desc)}</span>
      ${p.manual ? '<span class="badge ok">بدون رسوم بوابة</span>' : p.dev_only ? '<span class="badge warn">للتطوير فقط</span>' : '<span class="badge">دفع إلكتروني</span>'}</button>`).join('')}</div>
    <p class="small muted" style="margin-top:12px">تحتاج بوابة أخرى غير موجودة هنا (مثل HyperPay)؟ يمكن إضافتها برمجيًا كنوع جديد.</p>
    <div class="actions"><button class="btn secondary" data-close>إلغاء</button></div>`, (m, close) => {
    $$('[data-p]', m).forEach((b) => b.onclick = () => { close(); onPick(catalog.find((p) => p.key === b.dataset.p)); });
  }, { large: true });
}

function gatewayForm(prov, g, reload) {
  const cfg = (g && g.config) || {};
  const set = (g && g.secrets_set) || {};
  const field = (f) => {
    if (f.secret) {
      return `<div class="field"><label>${esc(f.label)}${f.required ? ' *' : ''}</label>
        <input name="c_${f.key}" type="password" dir="ltr" autocomplete="off" placeholder="${set[f.key] ? 'مضبوط — اتركه فارغًا للإبقاء عليه' : esc(f.placeholder || '')}">
        ${set[f.key] ? `<label class="check small" style="margin-top:4px"><input type="checkbox" name="clear_${f.key}"> مسح القيمة الحالية</label>` : ''}</div>`;
    }
    if (f.type === 'select') {
      return `<div class="field"><label>${esc(f.label)}</label><select name="c_${f.key}">${f.options.map((o) => `<option ${String(cfg[f.key] || 'SAU') === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
    }
    if (f.type === 'textarea') return `<div class="field"><label>${esc(f.label)}</label><textarea name="c_${f.key}" rows="3">${esc(cfg[f.key] || '')}</textarea></div>`;
    return `<div class="field"><label>${esc(f.label)}${f.required ? ' *' : ''}</label><input name="c_${f.key}" ${/iban|key|id|account_no/i.test(f.key) ? 'dir="ltr"' : ''} value="${esc(cfg[f.key] || '')}" placeholder="${esc(f.placeholder || '')}"></div>`;
  };
  modal(`<h3>${g ? 'إعدادات' : 'إضافة'}: ${esc(prov.label)}</h3>
    <p class="small muted">${esc(prov.desc)}</p>
    <form id="gf">
      <div class="form-error"></div>
      <div class="grid grid-2">
        <div class="field"><label>الاسم الظاهر للأعضاء *</label><input name="name" required maxlength="60" value="${esc(g ? g.name : prov.label.replace(/\s*\(.*\)/, ''))}"></div>
        <div class="field"><label>وصف قصير</label><input name="description" maxlength="120" value="${esc(g ? g.description || '' : prov.default_description)}"></div>
      </div>
      ${prov.fields.map(field).join('')}
      ${g && g.webhook_url ? `<div class="field"><label>رابط الإشعارات (Webhook) — ضعه في لوحة البوابة</label><input readonly dir="ltr" value="${esc(g.webhook_url)}"></div>` : ''}
      ${!g && !prov.manual && !prov.dev_only ? '<p class="small muted">بعد الحفظ يظهر رابط الإشعارات (Webhook) الخاص بهذه البوابة في إعداداتها.</p>' : ''}
      <label class="check"><input type="checkbox" name="is_active" ${!g || g.is_active ? 'checked' : ''}> مفعّلة (تظهر للأعضاء)</label>
      <p class="small muted">القيم السرية تُحفظ ولا تُعرض مرة أخرى. جرّب البوابة أولًا بمفاتيح الاختبار ثم استبدلها بالمفاتيح الحقيقية.</p>
      <div class="actions"><button class="btn" type="submit">حفظ</button><button class="btn secondary" type="button" data-close>إلغاء</button></div>
    </form>`, (m, close) => {
    bindForm($('#gf', m), async (fd) => {
      const config = {};
      for (const f of prov.fields) {
        const v = fd.get(`c_${f.key}`);
        if (!f.secret || v) config[f.key] = v || '';
        if (fd.get(`clear_${f.key}`)) config[`clear_${f.key}`] = true;
      }
      const body = { name: fd.get('name'), description: fd.get('description'), is_active: !!fd.get('is_active'), config };
      if (g) await api(`/admin/gateways/${g.id}`, { method: 'PUT', body });
      else await api('/admin/gateways', { method: 'POST', body: { ...body, provider: prov.key } });
      close(); toast('تم الحفظ'); reload();
    });
  }, { large: true });
}

/** معاينة صورة مختارة داخل النموذج */
function previewFile(input, img) {
  input.addEventListener('change', () => {
    const f = input.files[0];
    if (!f) return;
    img.src = URL.createObjectURL(f); img.hidden = false;
  });
}

function bannerForm(b, reload) {
  modal(`<h3>${b.id ? 'تعديل اللافتة' : 'إضافة لافتة'}</h3><form id="f">
    <div class="form-error"></div>
    <div class="field"><label>صورة اللافتة (اختيارية — JPG أو PNG أو WEBP حتى 6 ميجابايت)</label>
      <img id="pv" class="hb-preview" ${b.image ? `src="${esc(b.image)}"` : 'hidden'} alt="">
      <input type="file" name="image" accept="image/jpeg,image/png,image/webp">
      ${b.image ? '<label class="check small" style="margin-top:6px"><input type="checkbox" name="remove_image"> حذف الصورة الحالية</label>' : ''}
      <div class="hint">بدون صورة تظهر اللافتة بالخلفية الكحلية والشعار. المقاس المناسب 1600×700.</div></div>
    <div class="field"><label>العنوان (اختياري)</label><input name="title" maxlength="200" value="${esc(b.title || '')}"></div>
    <div class="field"><label>النص (اختياري)</label><input name="text" maxlength="300" value="${esc(b.text || '')}"></div>
    <div class="field"><label>الرابط عند الضغط (اختياري)</label><input name="link" dir="ltr" maxlength="500" value="${esc(b.link || '')}" placeholder="#/events أو https://…"></div>
    <label class="check"><input type="checkbox" name="is_active" ${b.is_active === 0 ? '' : 'checked'}> ظاهرة للأعضاء</label>
    <div class="actions"><button class="btn" type="submit">حفظ</button><button class="btn secondary" type="button" data-close>إلغاء</button></div></form>`, (m, close) => {
    previewFile($('[name=image]', m), $('#pv', m));
    bindForm($('#f', m), async (fd) => {
      fd.set('is_active', fd.get('is_active') ? '1' : '0');
      fd.set('remove_image', fd.get('remove_image') ? '1' : '0');
      if (!fd.get('image') || !fd.get('image').size) fd.delete('image');
      await api(b.id ? `/admin/home/banners/${b.id}` : '/admin/home/banners', { method: b.id ? 'PUT' : 'POST', form: fd });
      close(); toast('تم الحفظ'); reload();
    });
  }, { large: true });
}

function tileForm(t, icons, reload) {
  const custom = t.kind === 'custom';
  const numTile = t.key === 'members';
  modal(`<h3>${t.id ? 'تعديل المربع' : 'إضافة مربع'}</h3><form id="f">
    <div class="form-error"></div>
    <div class="field"><label>اسم المربع</label><input name="label" required maxlength="40" value="${esc(t.label || '')}"></div>
    ${custom ? `<div class="field"><label>الرابط</label><input name="link" dir="ltr" required maxlength="500" value="${esc(t.link || '')}" placeholder="https://… أو #/events">
      <div class="hint">رابط خارجي (يفتح في صفحة جديدة) مثل حساب بنكي أو متجر أو مجموعة واتساب، أو صفحة داخل المنصة.</div></div>`
      : `<p class="small muted">مربع أساسي مرتبط بميزة في المنصة، لذلك رابطه ثابت.</p>`}
    ${numTile ? '<p class="small muted">هذا المربع يعرض عدد الأعضاء المسجلين، فلا يحتاج أيقونة.</p>' : `
    <div class="field"><label>الأيقونة</label>
      <div class="icon-pick">${icons.map((k) => `<label title="${esc(ICON_NAMES[k] || k)}"><input type="radio" name="icon" value="${k}" ${t.icon === k ? 'checked' : ''}><span>${tileIcon(k)}<small>${esc(ICON_NAMES[k] || k)}</small></span></label>`).join('')}</div></div>
    <div class="field"><label>أو ارفع صورة بدل الأيقونة (اختياري)</label>
      <img id="pv" class="ht-preview" ${t.image ? `src="${esc(t.image)}"` : 'hidden'} alt="">
      <input type="file" name="image" accept="image/jpeg,image/png,image/webp">
      ${t.image ? '<label class="check small" style="margin-top:6px"><input type="checkbox" name="remove_image"> حذف الصورة والعودة للأيقونة</label>' : ''}
      <div class="hint">يُفضّل صورة مربعة بخلفية شفافة (PNG).</div></div>`}
    <label class="check"><input type="checkbox" name="is_visible" ${t.is_visible === 0 ? '' : 'checked'}> ظاهر في الصفحة الرئيسية</label>
    <div class="actions"><button class="btn" type="submit">حفظ</button><button class="btn secondary" type="button" data-close>إلغاء</button></div></form>`, (m, close) => {
    const fi = $('[name=image]', m);
    if (fi) previewFile(fi, $('#pv', m));
    bindForm($('#f', m), async (fd) => {
      fd.set('is_visible', fd.get('is_visible') ? '1' : '0');
      fd.set('remove_image', fd.get('remove_image') ? '1' : '0');
      if (!fd.get('icon')) fd.set('icon', '');
      if (!fd.get('image') || !fd.get('image').size) fd.delete('image');
      await api(t.id ? `/admin/home/tiles/${t.id}` : '/admin/home/tiles', { method: t.id ? 'PUT' : 'POST', form: fd });
      close(); toast('تم الحفظ'); reload();
    });
  }, { large: true });
}

function eventForm(e, onSave) {
  modal(`<h3>${e.id ? 'تعديل المناسبة' : 'إضافة مناسبة'}</h3><form id="f">
    <div class="form-error"></div>
    <div class="field"><label>العنوان</label><input name="title" value="${esc(e.title || '')}" required maxlength="120" placeholder="مثال: اللقاء السنوي للعائلة، حفل زواج"></div>
    <div class="grid grid-2">
      <div class="field"><label>موعد البداية</label><input type="datetime-local" name="starts_at" value="${esc(e.starts_at || '')}" required></div>
      <div class="field"><label>موعد الانتهاء (اختياري)</label><input type="datetime-local" name="ends_at" value="${esc(e.ends_at || '')}"></div>
    </div>
    <div class="hint small muted" style="margin:-8px 0 12px">الأوقات بتوقيت السعودية.</div>
    <div class="field"><label>المكان</label><input name="location" value="${esc(e.location || '')}" maxlength="200" placeholder="مثال: استراحة العائلة — بريدة"></div>
    <div class="field"><label>رابط الموقع على الخريطة (اختياري)</label><input name="map_url" dir="ltr" value="${esc(e.map_url || '')}" placeholder="https://maps.google.com/…"></div>
    <div class="field"><label>التفاصيل</label><textarea name="description" rows="4" maxlength="3000">${esc(e.description || '')}</textarea></div>
    <label class="check"><input type="checkbox" name="is_published" ${e.is_published === 0 ? '' : 'checked'}> منشور (يظهر للأعضاء)</label>
    <label class="check"><input type="checkbox" name="is_cancelled" ${e.is_cancelled ? 'checked' : ''}> ملغاة (تبقى ظاهرة للأعضاء مع علامة "ملغاة")</label>
    <div class="actions"><button class="btn" type="submit">حفظ</button><button class="btn secondary" type="button" data-close>إلغاء</button></div></form>`, (m, close) => {
    bindForm($('#f', m), async (fd) => {
      await onSave({
        title: fd.get('title'), starts_at: fd.get('starts_at'), ends_at: fd.get('ends_at') || null,
        location: fd.get('location') || null, map_url: fd.get('map_url') || null, description: fd.get('description') || null,
        is_published: fd.get('is_published') ? 1 : 0, is_cancelled: fd.get('is_cancelled') ? 1 : 0,
      });
      close();
    });
  }, { large: true });
}

function willForm(w, onSave) {
  const v = w || { is_published: 1 };
  modal(`<h3>${w ? 'تعديل الوصية' : 'إضافة وصية'}</h3><form id="f">
    <div class="form-error"></div>
    <div class="field"><label>عنوان الوصية</label><input name="title" value="${esc(v.title || '')}" required maxlength="150" placeholder="مثال: وصية الجد سليمان لأبنائه"></div>
    <div class="field"><label>صاحب الوصية</label>
      <div class="small" id="pl">${v.person_id ? esc(v.author || '') : '<span class="muted">لم يُختر من المشجرة</span>'}</div>
      <input id="pq" placeholder="ابحث عنه في المشجرة…" style="margin-top:6px" autocomplete="off"><div id="pr" class="small"></div>
      <input type="hidden" name="person_id" value="${v.person_id || ''}">
      <button type="button" class="btn sm secondary" id="pclr" style="margin-top:6px" ${v.person_id ? '' : 'hidden'}>إزالة الاختيار</button>
      <div id="anw" ${v.person_id ? 'hidden' : ''} style="margin-top:8px"><label class="small">أو اكتب اسمه (إن لم يكن في المشجرة)</label><input name="author_name" value="${esc(v.author_name || '')}" maxlength="120"></div>
    </div>
    <div class="field"><label>نص الوصية</label><textarea name="body" rows="9" required maxlength="20000">${esc(v.body || '')}</textarea></div>
    <div class="grid grid-2">
      <div class="field"><label>تاريخ الوصية (اختياري)</label><input name="will_date" value="${esc(v.will_date || '')}" maxlength="60" placeholder="مثال: 1385 هـ"></div>
      <div class="field"><label>المصدر أو الراوي (اختياري)</label><input name="source" value="${esc(v.source || '')}" maxlength="200" placeholder="مثال: رواها ابنه عبدالله"></div>
    </div>
    <div class="field"><label>صورة الوصية الأصلية (اختياري)</label>
      ${v.image ? `<img src="${esc(v.image)}" alt="" style="max-height:120px;border-radius:8px;display:block;margin-bottom:6px"><label class="check"><input type="checkbox" name="remove_image"> حذف الصورة الحالية</label>` : ''}
      <input type="file" name="image" accept="image/jpeg,image/png,image/webp"></div>
    <label class="check"><input type="checkbox" name="is_published" ${v.is_published ? 'checked' : ''}> منشورة (تظهر للأعضاء)</label>
    <div class="actions"><button class="btn" type="submit">حفظ</button><button class="btn secondary" type="button" data-close>إلغاء</button></div></form>`, (m, close) => {
    const pid = m.querySelector('[name=person_id]');
    const setPerson = (id, label) => {
      pid.value = id || '';
      $('#pl', m).innerHTML = id ? esc(label) : '<span class="muted">لم يُختر من المشجرة</span>';
      $('#pclr', m).hidden = !id; $('#anw', m).hidden = !!id;
    };
    $('#pclr', m).onclick = () => setPerson(null);
    let t;
    $('#pq', m).oninput = (e) => {
      clearTimeout(t);
      const q = e.target.value.trim();
      if (q.length < 2) { $('#pr', m).innerHTML = ''; return; }
      t = setTimeout(async () => {
        const r = await api(`/admin/persons?q=${encodeURIComponent(q)}&size=10`).catch(() => ({ items: [] }));
        $('#pr', m).innerHTML = r.items.map((x) => `<div class="cand" data-id="${x.id}" style="padding:6px 10px"><span class="nm">${esc(x.full_name)}</span></div>`).join('') || 'لا نتائج';
        $$('.cand', $('#pr', m)).forEach((el) => el.onclick = () => { setPerson(el.dataset.id, $('.nm', el).textContent); $('#pr', m).innerHTML = ''; $('#pq', m).value = ''; });
      }, 300);
    };
    bindForm($('#f', m), async (fd) => {
      fd.set('is_published', fd.get('is_published') ? '1' : '0');
      fd.set('remove_image', fd.get('remove_image') ? '1' : '0');
      if (pid.value) fd.delete('author_name');
      const file = fd.get('image');
      if (!file || !file.size) fd.delete('image');
      await onSave(fd);
      close();
    });
  }, { large: true });
}

// ================= نماذج مساعدة =================
function personForm(p, onSave, title, isEdit = false) {
  modal(`<h3>${esc(title)}</h3><form id="f">
    <div class="form-error"></div>
    <div class="grid grid-2">
      <div class="field"><label>الاسم</label><input name="name" value="${esc(p.name || '')}" required maxlength="40"></div>
      <div class="field"><label>الجنس</label><select name="gender"><option value="male">ذكر</option><option value="female" ${p.gender === 'female' ? 'selected' : ''}>أنثى</option></select></div>
    </div>
    <div class="field"><label>الأب</label><div class="small" id="fl">${esc(p.father_label || 'بدون أب (جذر)')}</div>
      <input id="fq" placeholder="ابحث لتغيير الأب…" style="margin-top:6px"><div id="fr" class="small"></div><input type="hidden" name="father_id" value="${p.father_id || ''}"></div>
    <div class="grid grid-2">
      <div class="field"><label>تاريخ الميلاد</label><input type="date" name="birth_date" value="${esc(p.birth_date || '')}"></div>
      <div class="field"><label>تاريخ الوفاة</label><input type="date" name="death_date" value="${esc(p.death_date || '')}"></div>
    </div>
    <label class="check"><input type="checkbox" name="is_deceased" ${p.is_deceased ? 'checked' : ''}> متوفى</label>
    <div class="field" style="margin-top:10px"><label>ملاحظات</label><textarea name="notes" rows="2">${esc(p.notes || '')}</textarea></div>
    <div class="actions"><button class="btn" type="submit">حفظ</button><button class="btn secondary" type="button" data-close>إلغاء</button></div></form>`, (m, close) => {
    let t;
    $('#fq', m).oninput = (e) => {
      clearTimeout(t);
      const q = e.target.value.trim();
      if (q.length < 2) { $('#fr', m).innerHTML = ''; return; }
      t = setTimeout(async () => {
        const r = await api(`/admin/persons?q=${encodeURIComponent(q)}&size=10`).catch(() => ({ items: [] }));
        $('#fr', m).innerHTML = r.items.filter((x) => x.id !== p.id).map((x) => `<div class="cand" data-id="${x.id}" style="padding:6px 10px"><span class="nm">${esc(x.full_name)}</span></div>`).join('') || 'لا نتائج';
        $$('.cand', $('#fr', m)).forEach((el) => el.onclick = () => {
          m.querySelector('[name=father_id]').value = el.dataset.id;
          $('#fl', m).textContent = $('.nm', el).textContent; $('#fr', m).innerHTML = ''; $('#fq', m).value = '';
        });
      }, 300);
    };
    bindForm($('#f', m), async (fd) => {
      const body = Object.fromEntries(fd);
      body.is_deceased = fd.get('is_deceased') ? 1 : 0;
      body.father_id = body.father_id ? Number(body.father_id) : null;
      if (!isEdit && !body.father_id) delete body.father_id;
      await onSave(body);
      close();
    });
  }, { large: true });
}

function planForm(p, features, reload) {
  const v = p || { name: '', description: '', price_halalas: 0, duration_days: 365, tier: 1, color: '#c9a227', is_active: 1, is_free: 0, feature_ids: [] };
  modal(`<h3>${p ? 'تعديل الباقة' : 'باقة جديدة'}</h3><form id="f">
    <div class="form-error"></div>
    <div class="grid grid-2">
      <div class="field"><label>اسم الباقة</label><input name="name" value="${esc(v.name)}" required></div>
      <div class="field"><label>اللون</label><input type="color" name="color" value="${esc(v.color)}" style="height:42px"></div>
      <div class="field"><label>السعر (ريال)</label><input type="number" name="price" min="0" step="0.01" value="${v.price_halalas / 100}"></div>
      <div class="field"><label>مدة الاشتراك (يوم)</label><input type="number" name="duration_days" min="1" value="${v.duration_days}"></div>
      <div class="field"><label>المستوى (للترقية/التخفيض)</label><input type="number" name="tier" value="${v.tier}"><div class="hint">رقم أعلى = باقة أعلى</div></div>
    </div>
    <div class="field"><label>الوصف</label><textarea name="description" rows="2">${esc(v.description || '')}</textarea></div>
    <label class="check"><input type="checkbox" name="is_active" ${v.is_active ? 'checked' : ''}> الباقة مفعّلة ومتاحة للاشتراك</label>
    <label class="check"><input type="checkbox" name="is_free" ${v.is_free ? 'checked' : ''}> الباقة المجانية الافتراضية (لمن ليس لديه اشتراك)</label>
    <h3 style="margin-top:14px">المميزات</h3>
    <div class="grid grid-2">${features.map((f) => `<label class="check"><input type="checkbox" name="f" value="${f.id}" ${v.feature_ids.includes(f.id) ? 'checked' : ''}> ${esc(f.name)}</label>`).join('')}</div>
    <div class="actions"><button class="btn" type="submit">حفظ</button><button class="btn secondary" type="button" data-close>إلغاء</button></div></form>`, (m, close) => {
    bindForm($('#f', m), async (fd) => {
      const body = {
        name: fd.get('name'), color: fd.get('color'), price: Number(fd.get('price')), duration_days: Number(fd.get('duration_days')), tier: Number(fd.get('tier')),
        description: fd.get('description'), is_active: !!fd.get('is_active'), is_free: !!fd.get('is_free'), feature_ids: fd.getAll('f').map(Number),
      };
      await api(p ? `/admin/plans/${p.id}` : '/admin/plans', { method: p ? 'PUT' : 'POST', body });
      close(); toast('تم الحفظ'); reload();
    });
  }, { large: true });
}

function featureForm(f, reload) {
  modal(`<h3>${f ? 'تعديل الميزة' : 'ميزة جديدة'}</h3><form id="f">
    <div class="form-error"></div>
    ${f ? `<p class="small muted">المفتاح: <code>${esc(f.key)}</code></p>` : '<div class="field"><label>المفتاح (إنجليزي)</label><input name="key" dir="ltr" required pattern="[a-z][a-z0-9_.-]+" placeholder="custom.feature"></div>'}
    <div class="field"><label>الاسم</label><input name="name" value="${esc(f ? f.name : '')}" required></div>
    <div class="field"><label>الوصف</label><textarea name="description" rows="2">${esc(f ? f.description || '' : '')}</textarea></div>
    <div class="field"><label>الترتيب</label><input type="number" name="sort_order" value="${f ? f.sort_order : 100}"></div>
    <div class="actions"><button class="btn" type="submit">حفظ</button><button class="btn secondary" type="button" data-close>إلغاء</button></div></form>`, (m, close) => {
    bindForm($('#f', m), async (fd) => {
      await api(f ? `/admin/features/${f.id}` : '/admin/features', { method: f ? 'PUT' : 'POST', body: Object.fromEntries(fd) });
      close(); reload();
    });
  });
}

function userPicker(title, onPick) {
  modal(`<h3>${esc(title)}</h3><input id="uq" placeholder="اسم، جوال، رقم عضوية"><div id="ur" style="margin-top:8px"></div>
    <div class="actions"><button class="btn secondary" data-close>إلغاء</button></div>`, (m, close) => {
    let t;
    $('#uq', m).oninput = (e) => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const r = await api(`/admin/users?q=${encodeURIComponent(e.target.value)}&size=10`).catch(() => ({ items: [] }));
        $('#ur', m).innerHTML = r.items.map((u) => `<div class="cand" data-id="${u.id}"><span class="nm">${esc(u.full_name)}</span><span class="small muted">${esc(u.membership_no)}</span></div>`).join('');
        $$('.cand', m).forEach((el) => el.onclick = () => { close(); onPick(r.items.find((u) => u.id === Number(el.dataset.id))); });
      }, 300);
    };
  });
}

function manualSubscription(plans, reload, user = null) {
  const open = (u) => modal(`<h3>اشتراك يدوي: ${esc(u.full_name)}</h3><form id="f">
    <div class="form-error"></div>
    <div class="field"><label>الباقة</label><select name="plan_id">${plans.map((p) => `<option value="${p.id}">${esc(p.name)} — ${p.duration_days} يوم</option>`).join('')}</select></div>
    <div class="field"><label>عدد الأيام (اختياري)</label><input type="number" name="days" min="1" placeholder="مدة الباقة الافتراضية"></div>
    <div class="field"><label>ملاحظات</label><input name="notes" placeholder="مثال: دفع نقدي / هدية"></div>
    <p class="small muted">إن كان لديه اشتراك فعّال في نفس الباقة يتم تمديده، وإلا يبدأ اشتراك جديد ويُستبدل الحالي.</p>
    <div class="actions"><button class="btn" type="submit">إضافة</button><button class="btn secondary" type="button" data-close>إلغاء</button></div></form>`, (m, close) => {
    bindForm($('#f', m), async (fd) => {
      await api('/admin/subscriptions', { method: 'POST', body: { user_id: u.id, plan_id: Number(fd.get('plan_id')), days: fd.get('days') ? Number(fd.get('days')) : undefined, notes: fd.get('notes') } });
      close(); toast('تمت إضافة الاشتراك'); reload();
    });
  });
  if (user) open(user); else userPicker('اختر المستخدم', open);
}
