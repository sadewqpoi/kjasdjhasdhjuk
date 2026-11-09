import { state, api, refreshMe, esc, $, $$, money, date, daysLeft, badge, LABELS, alertBox, toast, bindForm, go, confirmDialog, initials, icon, modal } from '../core.js';

// ============ صفحة الباقات والاشتراكات ============
export async function plans(root) {
  const d = await api('/plans');
  const me = state.me && state.me.user;
  if (!d.enabled) {
    root.innerHTML = `<div class="card narrow" style="text-align:center">
      <h1>الباقات والاشتراكات</h1>
      ${alertBox(d.off_mode === 'free_all' ? 'الباقات والاشتراكات متوقفة حاليًا، وجميع المميزات متاحة مجانًا للأعضاء.' : 'الباقات والاشتراكات متوقفة حاليًا، ولا يمكن الاشتراك أو التجديد في الوقت الحالي.', 'info')}
      <a class="btn" href="#/">العودة للرئيسية</a></div>`;
    return;
  }
  const actionLabel = { new: 'اشترك الآن', renew: 'تجديد الاشتراك', upgrade: 'ترقية إلى هذه الباقة', downgrade: 'الانتقال لهذه الباقة' };
  root.innerHTML = `
    <div style="text-align:center;margin-bottom:26px">
      <h1>الباقات والاشتراكات</h1>
      <p class="muted">اختر الباقة المناسبة لك. لا يُفعَّل أي اشتراك إلا بعد التأكد من الدفع.</p>
    </div>
    <div class="plans">
      ${d.plans.map((p) => {
        const isCur = d.current && d.current.plan_id === p.id;
        let btn = '';
        if (!me) btn = `<a class="btn block ${p.is_free ? 'secondary' : ''}" href="#/register">${p.is_free ? 'سجّل مجانًا' : 'سجّل ثم اشترك'}</a>`;
        else if (p.is_free) btn = isCur ? '<button class="btn block secondary" disabled>باقتك الحالية</button>' : '<button class="btn block secondary" disabled>الباقة الأساسية</button>';
        else if (p.action) btn = `<button class="btn block ${p.action === 'downgrade' ? 'secondary' : ''}" data-buy="${p.id}" data-action="${p.action}">${actionLabel[p.action]}</button>`;
        return `
        <div class="card plan ${isCur ? 'current' : ''}" style="--plan:${esc(p.color)}">
          ${isCur ? '<span class="badge ok ribbon">باقتك الحالية</span>' : ''}
          <h2 style="color:${esc(p.color)}">${esc(p.name)}</h2>
          <p class="muted small" style="min-height:3em">${esc(p.description || '')}</p>
          <div class="price">${p.is_free ? 'مجانية' : money(p.price_halalas, p.currency)} ${p.is_free ? '' : `<small>/ ${p.duration_days} يوم</small>`}</div>
          <ul>${d.features.map((f) => {
            const has = p.feature_ids.includes(f.id);
            return `<li class="${has ? 'yes' : 'no'}"><span class="ic">${icon(has ? 'check' : 'x')}</span><span>${esc(f.name)}</span></li>`;
          }).join('')}</ul>
          ${btn}
        </div>`;
      }).join('')}
    </div>
    ${d.current && d.current.end_at ? `<p class="muted small" style="text-align:center;margin-top:16px">اشتراكك الحالي ينتهي في ${date(d.current.end_at)}. التجديد يُضاف إلى نهاية المدة الحالية.</p>` : ''}`;

  $$('[data-buy]', root).forEach((b) => b.addEventListener('click', async () => {
    const plan = d.plans.find((p) => p.id === Number(b.dataset.buy));
    const action = b.dataset.action;
    const warn = action === 'downgrade' ? 'تنبيه: الانتقال لباقة أقل يبدأ اشتراكًا جديدًا الآن ويُنهي اشتراكك الحالي.' : action === 'upgrade' ? 'الترقية تبدأ اشتراكًا جديدًا بالمدة الكاملة من اليوم.' : '';
    try { await startPayment(plan, `${actionLabel[action]}: ${plan.name}`, warn); }
    catch (e) { toast(e.message); if (e.code === 'phone_unverified') go('#/verify'); }
  }));
}

/** اختيار طريقة الدفع ثم بدء العملية (تحويل للبوابة أو صفحة التحويل البنكي) */
export async function startPayment(plan, title, note = '') {
  const { items } = await api('/payments/gateways');
  if (!items.length) throw new Error('الدفع غير متاح حاليًا، تواصل مع الإدارة');
  const gatewayId = await new Promise((resolve) => {
    modal(`<h3>${esc(title)}</h3>
      <p>المبلغ: <b>${money(plan.price_halalas, plan.currency)}</b></p>
      ${note ? alertBox(note, 'info') : ''}
      <form id="pf">
        <p class="small muted" style="margin-bottom:8px">${items.length > 1 ? 'اختر طريقة الدفع:' : 'طريقة الدفع:'}</p>
        <div class="pay-choice">${items.map((g, i) => `<label class="pay-opt"><input type="radio" name="g" value="${g.id}" ${i === 0 ? 'checked' : ''}>
          <span>${icon(g.manual ? 'bank' : 'lock')}</span><span><b>${esc(g.name)}</b>${g.description ? `<br><span class="small muted">${esc(g.description)}</span>` : ''}</span></label>`).join('')}</div>
        <div class="actions"><button class="btn" type="submit">المتابعة</button><button class="btn secondary" type="button" data-close>إلغاء</button></div>
      </form>`, (m, close) => {
      $$('[data-close]', m).forEach((x) => x.addEventListener('click', () => resolve(null)));
      $('#pf', m).onsubmit = (e) => { e.preventDefault(); const v = new FormData(e.target).get('g'); close(); resolve(Number(v)); };
    });
  });
  if (!gatewayId) return;
  const r = await api('/payments/checkout', { method: 'POST', body: { plan_id: plan.id, gateway_id: gatewayId } });
  if (r.manual) go(`#/bank-transfer?pid=${r.payment_id}`);
  else location.href = r.redirect_url;
}

// ============ التحويل البنكي ============
export async function bankTransfer(root, { query }) {
  const pid = Number(query.get('pid'));
  const p = await api(`/payments/${pid}`);
  if (!p.manual) { go(`#/payment-result?pid=${pid}`); return; }
  const b = p.bank || {};
  const copy = (v) => `<button class="btn sm secondary" type="button" data-copy="${esc(v)}">نسخ</button>`;
  const head = `<p>${esc(p.plan_name)} — ${esc(LABELS.purpose[p.purpose])}</p><p style="font-size:1.6rem;font-weight:800;margin:4px 0 14px">${money(p.amount_halalas, p.currency)}</p>`;
  if (p.status === 'paid') {
    root.innerHTML = `<div class="card narrow" style="text-align:center"><div class="status-ic ok">${icon('check')}</div><h2>تم اعتماد تحويلك وتفعيل اشتراكك</h2>${head}<a class="btn" href="#/account">حسابي</a></div>`;
    return;
  }
  if (p.status === 'failed') {
    root.innerHTML = `<div class="card narrow" style="text-align:center"><div class="status-ic bad">${icon('x')}</div><h2>لم يُعتمد التحويل</h2>${head}
      ${p.failure_reason ? alertBox(p.failure_reason, 'warn') : ''}<a class="btn" href="#/plans">المحاولة مرة أخرى</a> <a class="btn secondary" href="#/feedback">تواصل مع الإدارة</a></div>`;
    return;
  }
  root.innerHTML = `
    <div class="card narrow">
      <h2>${icon('bank')} الدفع بالتحويل البنكي</h2>
      ${head}
      ${p.submitted_at ? alertBox('وصلت بيانات تحويلك للإدارة، وسيُفعَّل اشتراكك بعد التأكد من وصول المبلغ. يمكنك تعديلها إذا أخطأت.', 'ok') : ''}
      <div class="bank-box">
        <dl class="kv">
          <dt>البنك</dt><dd>${esc(b.bank_name)}</dd>
          <dt>اسم الحساب</dt><dd>${esc(b.account_name)}</dd>
          <dt>الآيبان</dt><dd><div class="copy-row"><span dir="ltr">${esc(b.iban)}</span>${copy(b.iban)}</div></dd>
          ${b.account_no ? `<dt>رقم الحساب</dt><dd><div class="copy-row"><span dir="ltr">${esc(b.account_no)}</span>${copy(b.account_no)}</div></dd>` : ''}
          <dt>الرقم المرجعي</dt><dd><div class="copy-row"><b dir="ltr">${esc(p.reference)}</b>${copy(p.reference)}</div></dd>
        </dl>
        <p class="small muted" style="margin:8px 0 0">اكتب الرقم المرجعي في وصف التحويل ليسهل التعرف عليه.</p>
        ${b.instructions ? `<p class="small" style="white-space:pre-line;margin:8px 0 0">${esc(b.instructions)}</p>` : ''}
      </div>
      <h3 style="margin-top:18px">بعد التحويل، أرسل بياناته:</h3>
      <form id="tf">
        <div class="form-error"></div>
        <div class="field"><label>اسم صاحب الحساب المحوَّل منه</label><input name="transfer_name" required maxlength="80" value="${esc(p.transfer_name || (state.me.user && state.me.user.full_name) || '')}"></div>
        <div class="field"><label>رقم عملية التحويل أو ملاحظة</label><input name="transfer_ref" maxlength="200" value="${esc(p.transfer_ref || '')}"></div>
        <div class="field"><label>صورة الإيصال ${p.has_receipt ? '(مرفوعة — ارفع صورة جديدة لاستبدالها)' : ''}</label><input type="file" name="receipt" accept="image/jpeg,image/png,image/webp"></div>
        <button class="btn block" type="submit">${p.submitted_at ? 'تحديث بيانات التحويل' : 'إرسال للمراجعة'}</button>
      </form>
    </div>`;
  $$('[data-copy]', root).forEach((x) => x.onclick = async () => { try { await navigator.clipboard.writeText(x.dataset.copy); toast('تم النسخ'); } catch { toast('انسخه يدويًا'); } });
  bindForm($('#tf', root), async (fd) => {
    if (!fd.get('receipt') || !fd.get('receipt').size) fd.delete('receipt');
    await api(`/payments/${pid}/transfer`, { method: 'POST', form: fd });
    toast('تم إرسال بيانات التحويل للمراجعة');
    bankTransfer(root, { query });
  });
}

// ============ نتيجة الدفع ============
export async function paymentResult(root, { query }) {
  const pid = Number(query.get('pid'));
  root.innerHTML = '<div class="card narrow"><h2>جارٍ التحقق من عملية الدفع…</h2><p class="muted">يتم التأكد من الدفع لدى بوابة الدفع قبل تفعيل الاشتراك.</p></div>';
  if (!pid) { root.innerHTML = `<div class="card narrow">${alertBox('عملية غير معروفة')}</div>`; return; }
  let p;
  for (let i = 0; i < 6; i++) {
    p = await api(`/payments/${pid}`);
    if (p.manual) { go(`#/bank-transfer?pid=${pid}`); return; }
    if (p.status !== 'initiated') break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  await refreshMe();
  window.dispatchEvent(new Event('me-changed'));
  const ok = p.status === 'paid';
  root.innerHTML = `
    <div class="card narrow" style="text-align:center">
      <div class="status-ic ${ok ? 'ok' : p.status === 'initiated' ? '' : 'bad'}">${icon(ok ? 'check' : p.status === 'initiated' ? 'clock' : 'x')}</div>
      <h2>${ok ? 'تم الدفع وتفعيل اشتراكك بنجاح' : p.status === 'initiated' ? 'لم يكتمل الدفع بعد' : 'لم تتم عملية الدفع'}</h2>
      <p>${esc(p.plan_name)} — ${money(p.amount_halalas, p.currency)} (${esc(LABELS.purpose[p.purpose])})</p>
      ${!ok && p.failure_reason ? `<p class="muted small">${esc(p.failure_reason)}</p>` : ''}
      <div class="row" style="justify-content:center"><a class="btn" href="#/account">حسابي</a><a class="btn secondary" href="#/plans">الباقات</a></div>
    </div>`;
}

// ============ لوحة تحكم المستخدم ============
export async function dashboard(root) {
  if (!state.me || !state.me.user) { go('#/login'); return; }
  const d = await api('/account');
  const s = d.subscription;
  const u = d.user;
  const days = s ? daysLeft(s.end_at) : null;
  const subStatus = s ? s.status : d.last_subscription ? d.last_subscription.status : null;
  root.innerHTML = `
    <div class="card">
      <div class="profile-head">
        ${u.photo_url ? `<img src="${u.photo_url}?t=${Date.now()}" alt="">` : `<div class="ph" style="display:grid;place-items:center;font-size:2.4rem">${initials(u.full_name)}</div>`}
        <div style="flex:1;min-width:220px">
          <h1 style="margin:0">${esc(u.full_name)}</h1>
          <div class="muted">رقم العضوية: <b dir="ltr">${esc(u.membership_no)}</b></div>
          <div class="small" style="margin-top:4px">${d.person ? `اسمك في المشجرة: <b>${esc(d.person.full_name)}</b>` : `<span class="badge warn">غير مرتبط بالمشجرة</span> <a href="#/link">ربط الحساب</a>`}</div>
        </div>
        <div class="row"><label class="btn sm secondary" style="margin:0">تغيير الصورة<input type="file" id="ph" accept="image/*" hidden></label>
          <button class="btn sm secondary" id="acctLogout">تسجيل الخروج</button></div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      ${!state.me.plans_enabled ? `<div class="card"><h2>الاشتراك</h2>
        ${alertBox('الباقات والاشتراكات متوقفة حاليًا من الإدارة، ولا يلزمك أي اشتراك في هذه الفترة.', 'info')}
        ${s ? `<p class="small muted">اشتراكك (${esc(s.plan_name || (d.plan && d.plan.name) || '')}) محفوظ، وينتهي في ${date(s.end_at)}.</p>` : ''}</div>` : `<div class="card">
        <h2>الاشتراك</h2>
        <dl class="kv">
          <dt>الباقة الحالية</dt><dd><b style="color:${esc(d.plan ? d.plan.color : '')}">${esc(d.plan ? d.plan.name : 'لا توجد')}</b></dd>
          <dt>حالة الاشتراك</dt><dd>${subStatus ? badge('sub', subStatus) : '<span class="badge">مجاني</span>'}</dd>
          <dt>تاريخ البداية</dt><dd>${s ? date(s.start_at) : '—'}</dd>
          <dt>تاريخ الانتهاء</dt><dd>${s ? date(s.end_at) : d.last_subscription ? date(d.last_subscription.end_at) : '—'}</dd>
          ${s ? `<dt>المتبقي</dt><dd>${days} يوم ${days <= 14 ? '<span class="badge warn">قارب على الانتهاء</span>' : ''}</dd>` : ''}
        </dl>
        ${s && s.status === 'suspended' ? alertBox('اشتراكك موقوف من الإدارة', 'warn') : ''}
        <div class="row" style="margin-top:16px">
          <a class="btn gold" href="#/plans">ترقية الباقة</a>
          ${s || d.last_subscription ? '<button class="btn secondary" id="renew">تجديد الاشتراك</button>' : ''}
        </div>
      </div>`}
      <div class="card">
        <h2>الخصوصية</h2>
        <p class="muted small">حدد من يستطيع رؤية بياناتك في بطاقتك داخل المشجرة (ضمن صلاحيات باقته).</p>
        <form id="pf">
          ${[['photo', 'الصورة الشخصية'], ['birth', 'تاريخ الميلاد'], ['phone', 'رقم الجوال']].map(([k, l]) => `
            <div class="field"><label>${l}</label><select name="${k}">${Object.entries(LABELS.privacy).map(([v, t]) => `<option value="${v}" ${u.privacy[k] === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`).join('')}
          <label class="check"><input type="checkbox" name="wa_broadcast" ${u.wa_broadcast ? 'checked' : ''}> استقبال الرسائل الجماعية (الدعوات والإعلانات) على واتساب</label>
          <p class="small muted" style="margin:-4px 0 10px">تبقى الرسائل ظاهرة لك في الموقع في كل الأحوال.</p>
          <button class="btn sm" type="submit">حفظ</button>
        </form>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <h2>سجل المدفوعات</h2>
      ${d.payments.length ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>الباقة</th><th>العملية</th><th>المبلغ</th><th>الحالة</th><th>وسيلة الدفع</th><th>التاريخ</th></tr></thead><tbody>
        ${d.payments.map((p) => `<tr><td>${p.id}</td><td>${esc(p.plan_name)}</td><td>${esc(LABELS.purpose[p.purpose])}</td><td>${money(p.amount_halalas, p.currency)}</td><td>${badge('pay', p.status)}</td><td>${esc(p.method || '—')}</td><td>${date(p.created_at, true)}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">لا توجد مدفوعات</p>'}
    </div>

    <div class="card">
      <h2>سجل الاشتراكات</h2>
      ${d.subscriptions.length ? `<div class="table-wrap"><table><thead><tr><th>الباقة</th><th>الحالة</th><th>البداية</th><th>النهاية</th><th>المصدر</th></tr></thead><tbody>
        ${d.subscriptions.map((x) => `<tr><td>${esc(x.plan_name)}</td><td>${badge('sub', x.status)}</td><td>${date(x.start_at)}</td><td>${date(x.end_at)}</td><td>${esc(LABELS.source[x.source])}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">لا توجد اشتراكات سابقة</p>'}
    </div>

    <div class="card">
      <h2>تغيير كلمة المرور</h2>
      <form id="pw" class="grid grid-3">
        <div class="form-error" style="grid-column:1/-1"></div>
        <div><label>الحالية</label><input type="password" name="current" required></div>
        <div><label>الجديدة</label><input type="password" name="password" required minlength="8"></div>
        <div><label>تأكيد الجديدة</label><input type="password" name="password_confirm" required></div>
        <div><button class="btn sm" type="submit">تحديث</button></div>
      </form>
    </div>`;

  bindForm($('#pf', root), async (fd) => {
    await api('/account/privacy', { method: 'PUT', body: { ...Object.fromEntries(fd), wa_broadcast: fd.get('wa_broadcast') ? 1 : 0 } });
    toast('تم حفظ الإعدادات');
  });
  bindForm($('#pw', root), async (fd) => { await api('/account/password', { method: 'POST', body: Object.fromEntries(fd) }); toast('تم تغيير كلمة المرور'); $('#pw', root).reset(); });
  $('#acctLogout', root).onclick = async () => {
    await api('/auth/logout', { method: 'POST' }); await refreshMe();
    window.dispatchEvent(new Event('me-changed')); go('#/');
  };
  $('#ph', root).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('photo', f);
    try { await api('/account/photo', { method: 'POST', form: fd }); toast('تم تحديث الصورة'); await refreshMe(); window.dispatchEvent(new Event('me-changed')); dashboard(root); } catch (err) { toast(err.message); }
  };
  const rn = $('#renew', root);
  if (rn) rn.onclick = async () => {
    const planId = s ? s.plan_id : d.last_subscription.plan_id;
    const plan = (await api('/plans')).plans.find((x) => x.id === planId);
    if (!plan) { toast('الباقة غير متاحة'); return; }
    try { await startPayment(plan, `تجديد الاشتراك: ${plan.name}`, 'ستُضاف المدة إلى نهاية اشتراكك الحالي.'); } catch (e) { toast(e.message); }
  };
}

// ============ وثيقة النسب ============
export async function certificate(root, { id }) {
  const c = await api(`/persons/${Number(id)}/certificate`);
  root.innerHTML = `
    <div class="row no-print" style="margin-bottom:14px"><button class="btn" id="pr">${icon('print')} طباعة</button><a class="btn secondary" href="#/tree">العودة للمشجرة</a></div>
    <div class="certificate">
      <img class="cert-logo" src="/img/logo-light.png?v=2" alt="">
      <h1>وثيقة نسب</h1>
      <p>${esc(state.me.site_name || '')}</p>
      <p style="font-size:1.4rem;margin-top:24px"><b>${esc(c.person.name)}</b></p>
      <div class="chain">${c.lineage.map((p, i) => `${i ? `<span>${c.lineage[i - 1].gender === 'female' ? 'بنت' : 'بن'}</span>` : ''}<b>${esc(p.name)}</b>`).join(' ')}</div>
      <p style="line-height:2">${esc(c.full_name)}</p>
      <p class="small" style="margin-top:30px">صدرت بتاريخ ${date(c.issued_at)} — للعضو ${esc(c.issued_to)}</p>
    </div>`;
  $('#pr', root).onclick = () => window.print();
}
