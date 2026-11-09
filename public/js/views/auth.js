import { state, api, refreshMe, esc, $, $$, bindForm, alertBox, toast, go, nextStep, modal, date, badge, icon } from '../core.js';

const STEPS = ['بياناتك', 'التحقق من الجوال', 'اختيار اسمك', 'دخول المشجرة'];
const steps = (cur) => `<div class="steps">${STEPS.map((s, i) => `<span class="${i < cur ? 'done' : i === cur ? 'on' : ''}">${i + 1}. ${s}</span>`).join('')}</div>`;

// ============ تسجيل الدخول ============
export async function login(root) {
  if (state.me && state.me.user) { location.replace(nextStep()); return; }
  root.innerHTML = `
    <div class="card narrow">
      <h2>تسجيل الدخول</h2>
      <form id="f">
        <div class="form-error"></div>
        <div class="field"><label>رقم الجوال</label><input name="phone" dir="ltr" inputmode="tel" placeholder="05XXXXXXXX" required autocomplete="username"></div>
        <div class="field"><label>كلمة المرور</label><input name="password" type="password" required autocomplete="current-password"></div>
        <button class="btn block" type="submit">دخول</button>
      </form>
      <div class="row between small" style="margin-top:14px"><a href="#/forgot">نسيت كلمة المرور؟</a><a href="#/register">ليس لديك حساب؟ سجّل الآن</a></div>
    </div>`;
  bindForm($('#f', root), async (fd) => {
    await api('/auth/login', { method: 'POST', body: Object.fromEntries(fd) });
    await refreshMe();
    go(nextStep());
  });
}

// ============ إنشاء الحساب ============
export async function register(root) {
  if (state.me && state.me.user) { location.replace(nextStep()); return; }
  root.innerHTML = `
    <div class="card narrow">
      ${steps(0)}
      <h2>إنشاء حساب جديد</h2>
      <p class="muted small">أسماء أفراد العائلة موجودة مسبقًا في المشجرة؛ بعد إنشاء الحساب ستختار اسمك من النتائج لربط حسابك به.</p>
      <form id="f" enctype="multipart/form-data">
        <div class="form-error"></div>
        <div class="field"><label>الاسم الثلاثي</label><input name="full_name" required minlength="5" placeholder="مثال: أصيل عبدالعزيز عبدالكريم"><div class="hint">الاسم، اسم الأب، اسم الجد</div></div>
        <div class="field"><label>رقم الجوال</label><input name="phone" dir="ltr" inputmode="tel" placeholder="05XXXXXXXX" required></div>
        <div class="field"><label>الصورة الشخصية</label>
          <div class="photo-pick"><div class="preview" id="pv">${icon('camera')}</div>
            <div><input type="file" name="photo" id="photo" accept="image/jpeg,image/png,image/webp" required><div class="hint">JPG أو PNG أو WEBP بحد أقصى 3 ميجابايت</div></div></div></div>
        <div class="field"><label>كلمة المرور</label><input name="password" type="password" required minlength="8" autocomplete="new-password"><div class="hint">8 أحرف على الأقل وتحتوي على حروف وأرقام</div></div>
        <div class="field"><label>تأكيد كلمة المرور</label><input name="password_confirm" type="password" required autocomplete="new-password"></div>
        <button class="btn block" type="submit">متابعة</button>
      </form>
      <p class="small" style="margin-top:12px">لديك حساب؟ <a href="#/login">سجّل الدخول</a></p>
    </div>`;
  $('#photo', root).onchange = (e) => {
    const f = e.target.files[0];
    if (f) { const url = URL.createObjectURL(f); $('#pv', root).innerHTML = `<img src="${url}" alt="">`; }
  };
  bindForm($('#f', root), async (fd) => {
    if (fd.get('password') !== fd.get('password_confirm')) throw new Error('كلمتا المرور غير متطابقتين');
    await api('/auth/register', { method: 'POST', form: fd });
    await refreshMe();
    go('#/verify');
  });
}

// ============ التحقق عبر واتساب (مشترك بين التفعيل واستعادة كلمة المرور) ============
const WA_ICON = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 19.5l1.2-3.6A8 8 0 1 1 8.4 18.5z"/><path d="M9.2 8.6c.3-.6.9-.6 1.1-.1l.6 1.4c.1.3 0 .6-.2.8l-.4.4a5 5 0 0 0 2.6 2.6l.4-.4c.2-.2.5-.3.8-.2l1.4.6c.5.2.5.8-.1 1.1-1.6.9-4.3-.4-5.7-2.5-.9-1.4-1-2.9-.5-3.7z"/></svg>';
let waPoll = null;

/**
 * يعرض خطوات الإرسال عبر واتساب ويتابع الحالة حتى تصل الرسالة.
 * data: نتيجة بدء الطلب (rid, text, wa_link, wa_number, dev)، statusUrl: رابط متابعة الحالة
 */
function waBox(box, data, { phone, statusUrl, onVerified, onRestart }) {
  clearInterval(waPoll);
  box.innerHTML = `
    <div class="wa-box">
      <p>للتحقق من أن الرقم <b dir="ltr">+${esc(phone)}</b> لك، أرسل رسالة التفعيل إلى رقم الصندوق على واتساب <b>من نفس هذا الرقم</b>.</p>
      ${data.wa_link ? `<a class="btn block wa-btn" href="${esc(data.wa_link)}" target="_blank" rel="noopener">${WA_ICON} إرسال الرسالة عبر واتساب</a>`
        : data.dev ? alertBox('وضع التطوير: لا يوجد رقم واتساب مضبوط بعد. استخدم زر المحاكاة لتجربة الخطوات.', 'info') + `<button class="btn block wa-btn" id="waSim" type="button">${WA_ICON} محاكاة إرسال الرسالة</button>`
        : alertBox('خدمة التحقق عبر واتساب غير مهيأة بعد، تواصل مع الإدارة.', 'warn')}
      <details class="wa-manual">
        <summary>لم يفتح واتساب؟ أرسلها يدويًا</summary>
        ${data.wa_number ? `<p class="small">أرسل هذا النص إلى الرقم <b dir="ltr">+${esc(data.wa_number)}</b>:</p>` : ''}
        <pre class="wa-text">${esc(data.text)}</pre>
        <button class="btn sm secondary" id="waCopy" type="button">نسخ النص</button>
      </details>
      <div class="wa-status" id="waStatus"><span class="spin"></span> بانتظار وصول رسالتك…</div>
      <p class="small muted">الرمز صالح لمدة ${data.expires_minutes || 15} دقيقة. بعد الإرسال ارجع إلى هذه الصفحة وسيكتمل التحقق تلقائيًا.</p>
    </div>`;
  const st = $('#waStatus', box);
  const check = async () => {
    try {
      const r = await api(statusUrl);
      if (r.status === 'verified') { clearInterval(waPoll); st.className = 'wa-status ok'; st.innerHTML = `${icon('check')} تم التحقق بنجاح`; onVerified(); }
      else if (r.status === 'expired' || r.status === 'used') {
        clearInterval(waPoll); st.className = 'wa-status bad';
        st.innerHTML = `انتهت صلاحية الرمز. <button class="btn sm secondary" id="waAgain" type="button">رمز جديد</button>`;
        $('#waAgain', box).onclick = onRestart;
      }
    } catch { /* محاولة لاحقة */ }
  };
  waPoll = setInterval(() => { if (!document.body.contains(box)) { clearInterval(waPoll); return; } check(); }, 3000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && document.body.contains(box)) check(); }, { once: true });
  $('#waCopy', box).onclick = async () => { try { await navigator.clipboard.writeText(data.text); toast('تم النسخ'); } catch { toast('انسخ النص يدويًا'); } };
  const sim = $('#waSim', box);
  if (sim) sim.onclick = async () => { try { await api('/whatsapp/dev-simulate', { method: 'POST', body: { rid: data.rid } }); check(); } catch (e) { toast(e.message); } };
}

const PASSWORD_FIELDS = `<div class="field"><label>كلمة المرور الجديدة</label><input name="password" type="password" required minlength="8" autocomplete="new-password"><div class="hint">8 أحرف على الأقل وتحتوي على حروف وأرقام</div></div>
  <div class="field"><label>تأكيد كلمة المرور</label><input name="password_confirm" type="password" required autocomplete="new-password"></div>`;

/**
 * طريقة "أرسل لي الرمز" (بوت واتساب أو رسالة نصية): زر الإرسال ثم حقل إدخال الرمز.
 * send(): يطلب إرسال الرمز (قد يُرجع dev_code في التطوير)، submit(code, password): يتحقق منه
 */
function codeSection(box, { button, sentMsg, send, submit, withPassword = false }) {
  box.innerHTML = `
    <button class="btn block secondary" type="button" data-send>${button}</button>
    <form class="hidden" style="margin-top:12px">
      <div class="form-error"></div>
      <div data-msg></div>
      <div class="field"><input name="code" dir="ltr" inputmode="numeric" maxlength="6" placeholder="••••••" required autocomplete="one-time-code" style="font-size:1.5rem;letter-spacing:.5em;text-align:center"></div>
      ${withPassword ? PASSWORD_FIELDS : ''}
      <button class="btn block" type="submit">${withPassword ? 'تعيين كلمة المرور' : 'تحقق'}</button>
      <button class="btn link small" type="button" data-resend style="margin-top:8px">إعادة إرسال الرمز</button>
    </form>`;
  const form = $('form', box);
  const doSend = async (btn) => {
    btn.disabled = true;
    try {
      const r = await send();
      $('[data-msg]', box).innerHTML = (r && r.dev_code ? alertBox(`وضع التطوير: الرمز هو ${r.dev_code}`, 'info') : '') + alertBox(sentMsg, 'ok');
      form.classList.remove('hidden'); $('[data-send]', box).classList.add('hidden'); $('[name=code]', box).focus();
    } catch (e) { toast(e.message); } finally { btn.disabled = false; }
  };
  $('[data-send]', box).onclick = (e) => doSend(e.currentTarget);
  $('[data-resend]', box).onclick = (e) => doSend(e.currentTarget);
  bindForm(form, async (fd) => {
    if (withPassword && fd.get('password') !== fd.get('password_confirm')) throw new Error('كلمتا المرور غير متطابقتين');
    await submit(fd.get('code'), fd.get('password'));
  });
}

/** عناوين الطرق كما تظهر للعضو */
const METHOD_UI = {
  wa_reverse: () => `${WA_ICON} التحقق عبر واتساب (أرسل رسالة التفعيل)`,
  wa_bot: () => `${WA_ICON} أرسل لي الرمز على واتساب`,
  sms: () => `${icon('chat')} أرسل لي رسالة نصية بالرمز`,
  manual: () => `${icon('user')} اطلب توثيق رقمي من الإدارة`,
};

/** يعرض الطريقة الأساسية كاملة، والبقية كخيارات قابلة للفتح تحتها */
function methodsUI(container, methods, renderers) {
  const list = methods.filter((m) => renderers[m]);
  if (!list.length) { container.innerHTML = alertBox('لا توجد طريقة تحقق متاحة حاليًا، تواصل مع الإدارة.', 'warn'); return; }
  const [first, ...rest] = list;
  container.innerHTML = `<div data-primary></div>
    ${rest.length ? `<div class="method-alts"><div class="or"><span>أو اختر طريقة أخرى</span></div>
      ${rest.map((m) => `<details data-m="${m}"><summary>${METHOD_UI[m]()}</summary><div data-body></div></details>`).join('')}</div>` : ''}`;
  renderers[first]($('[data-primary]', container));
  $$('details[data-m]', container).forEach((d) => d.addEventListener('toggle', () => {
    if (d.open && !d.dataset.init) { d.dataset.init = '1'; renderers[d.dataset.m]($('[data-body]', d)); }
  }));
}

// ============ التحقق من الجوال ============
export async function verify(root) {
  const me = state.me;
  if (!me || !me.user) { go('#/login'); return; }
  if (me.user.phone_verified) { location.replace(nextStep()); return; }
  root.innerHTML = `<div class="card narrow">${steps(1)}<h2>التحقق من رقم الجوال</h2>
    <p class="muted small">رقمك: <b dir="ltr">+${esc(me.user.phone)}</b></p><div id="methods"></div></div>`;
  const done = async () => {
    await refreshMe(); window.dispatchEvent(new Event('me-changed'));
    toast('تم التحقق من رقم الجوال'); setTimeout(() => go(nextStep()), 600);
  };
  const verifyCode = async (code) => { await api('/auth/otp/verify', { method: 'POST', body: { code } }); await done(); };

  methodsUI($('#methods', root), (me.otp && me.otp.methods) || [], {
    wa_reverse(box) {
      const startWa = async () => {
        box.innerHTML = '<p class="muted">جارٍ التجهيز…</p>';
        try {
          const d = await api('/auth/otp/whatsapp/start', { method: 'POST' });
          if (d.verified) { await done(); return; }
          waBox(box, d, { phone: me.user.phone, statusUrl: `/auth/otp/whatsapp/status?rid=${d.rid}`, onVerified: done, onRestart: startWa });
        } catch (e) { box.innerHTML = alertBox(e.message) + '<button class="btn secondary" type="button" data-retry>إعادة المحاولة</button>'; $('[data-retry]', box).onclick = startWa; }
      };
      startWa();
    },
    wa_bot: (box) => codeSection(box, {
      button: METHOD_UI.wa_bot(), sentMsg: 'أرسلنا الرمز إلى واتساب رقمك. اكتبه هنا:',
      send: () => api('/auth/otp/send', { method: 'POST', body: { via: 'bot' } }), submit: verifyCode,
    }),
    sms: (box) => codeSection(box, {
      button: METHOD_UI.sms(), sentMsg: 'أرسلنا رسالة نصية بالرمز إلى جوالك. اكتبه هنا:',
      send: () => api('/auth/otp/send', { method: 'POST', body: { via: 'sms' } }), submit: verifyCode,
    }),
    manual(box) {
      const waiting = () => {
        box.innerHTML = `<div class="wa-status"><span class="spin"></span> طلبك وصل للإدارة، وسيُوثَّق رقمك قريبًا. هذه الصفحة تتحدث تلقائيًا.</div>`;
        const t = setInterval(async () => {
          if (!document.body.contains(box)) { clearInterval(t); return; }
          try { await refreshMe(); if (state.me.user && state.me.user.phone_verified) { clearInterval(t); await done(); } } catch { /* لاحقًا */ }
        }, 10000);
      };
      if (me.user.verify_requested) { waiting(); return; }
      box.innerHTML = `<p class="small muted">يتأكد المشرف من رقمك ثم يوثّقه. قد يستغرق ذلك بعض الوقت.</p>
        <button class="btn block secondary" type="button" data-req>${METHOD_UI.manual()}</button>`;
      $('[data-req]', box).onclick = async () => {
        try { await api('/auth/otp/manual/request', { method: 'POST' }); me.user.verify_requested = true; waiting(); } catch (e) { toast(e.message); }
      };
    },
  });
}

// ============ استعادة كلمة المرور ============
export async function forgot(root) {
  root.innerHTML = `
    <div class="card narrow">
      <h2>استعادة كلمة المرور</h2>
      <form id="f1">
        <div class="form-error"></div>
        <div class="field"><label>رقم الجوال المسجل</label><input name="phone" dir="ltr" inputmode="tel" placeholder="05XXXXXXXX" required></div>
        <button class="btn block" type="submit">متابعة</button>
      </form>
      <div id="methods"></div>
    </div>`;
  const methods = ((state.me && state.me.otp && state.me.otp.methods) || []).filter((m) => m !== 'manual');
  bindForm($('#f1', root), async (fd) => {
    const phone = fd.get('phone').trim();
    if (!/^(\+?966|0)?5\d{8}$/.test(phone.replace(/[\s-]/g, ''))) throw new Error('رقم الجوال غير صحيح');
    $('#f1', root).classList.add('hidden');
    const box = $('#methods', root);
    if (!methods.length) { box.innerHTML = alertBox('لاستعادة كلمة المرور تواصل مع الإدارة.', 'info'); return; }
    box.innerHTML = `<p class="muted small">الرقم: <b dir="ltr">${esc(phone)}</b> · <a href="#/forgot" id="chg">تغيير</a></p><div id="mlist"></div>`;
    $('#chg', root).onclick = (e) => { e.preventDefault(); forgot(root); };
    const finish = async (body) => {
      await api('/auth/password/reset', { method: 'POST', body: { phone, ...body } });
      toast('تم تغيير كلمة المرور، سجّل الدخول'); go('#/login');
    };
    methodsUI($('#mlist', root), methods, {
      wa_reverse(b) {
        const startWa = async () => {
          b.innerHTML = '<p class="muted">جارٍ التجهيز…</p>';
          try {
            const d = await api('/auth/password/forgot', { method: 'POST', body: { phone, via: 'wa_reverse' } });
            const wrap = document.createElement('div');
            b.innerHTML = ''; b.appendChild(wrap);
            const pf = document.createElement('form'); pf.className = 'hidden'; pf.style.marginTop = '14px';
            pf.innerHTML = `<div class="form-error"></div>${PASSWORD_FIELDS}<button class="btn block" type="submit">تعيين كلمة المرور</button>`;
            b.appendChild(pf);
            bindForm(pf, async (fd2) => {
              if (fd2.get('password') !== fd2.get('password_confirm')) throw new Error('كلمتا المرور غير متطابقتين');
              await finish({ rid: d.rid, password: fd2.get('password') });
            });
            waBox(wrap, d, {
              phone: d.phone, statusUrl: `/auth/password/whatsapp-status?rid=${d.rid}&phone=${encodeURIComponent(phone)}`,
              onVerified: () => { pf.classList.remove('hidden'); $('[name=password]', pf).focus(); }, onRestart: startWa,
            });
          } catch (e) { b.innerHTML = alertBox(e.message); }
        };
        startWa();
      },
      wa_bot: (b) => codeSection(b, {
        button: METHOD_UI.wa_bot(), sentMsg: 'إذا كان الرقم مسجلًا فسيصلك الرمز على واتساب. اكتبه هنا:', withPassword: true,
        send: () => api('/auth/password/forgot', { method: 'POST', body: { phone, via: 'bot' } }),
        submit: (code, password) => finish({ code, password }),
      }),
      sms: (b) => codeSection(b, {
        button: METHOD_UI.sms(), sentMsg: 'إذا كان الرقم مسجلًا فستصلك رسالة نصية بالرمز. اكتبه هنا:', withPassword: true,
        send: () => api('/auth/password/forgot', { method: 'POST', body: { phone, via: 'sms' } }),
        submit: (code, password) => finish({ code, password }),
      }),
    });
  });
}

// ============ ربط الحساب بالاسم في المشجرة ============
export async function link(root) {
  const me = state.me;
  if (!me || !me.user) { go('#/login'); return; }
  if (!me.user.phone_verified) { go('#/verify'); return; }
  const st = await api('/link/status');
  if (st.linked_person_id) {
    root.innerHTML = `<div class="card narrow">${steps(4)}<h2>حسابك مرتبط</h2><p>${esc(me.user.person_full_name || '')}</p><a class="btn" href="#/tree">الذهاب إلى المشجرة</a></div>`;
    return;
  }
  const lastLink = st.links[0];
  const lastAdd = st.additions[0];
  const pendingLink = lastLink && lastLink.status === 'pending' ? lastLink : null;
  const pendingAdd = lastAdd && lastAdd.status === 'pending' ? lastAdd : null;

  if (pendingLink || pendingAdd) {
    root.innerHTML = `
      <div class="card narrow">
        ${steps(3)}
        <h2>طلب إضافة اسمك قيد مراجعة الإدارة</h2>
        ${pendingLink ? `<p>طلب ربط حسابك بالاسم:</p><p><b>${esc(pendingLink.person_full_name)}</b></p><p class="muted small">أُرسل في ${date(pendingLink.created_at, true)}</p>`
          : `<p>طلب إضافة اسم جديد: <b>${esc(pendingAdd.name)}</b></p><p class="muted small">الأب: ${esc(pendingAdd.father_full_name || '—')}</p>`}
        <p class="muted">سيُضاف اسمك ويُربط بحسابك فور موافقة الإدارة على الطلب.</p>
        <div class="row"><button class="btn secondary" id="cancel">إلغاء الطلب</button><a class="btn secondary" href="#/account">حسابي</a></div>
      </div>`;
    $('#cancel', root).onclick = async () => {
      try {
        await api(pendingLink ? `/link/requests/${pendingLink.id}` : `/link/additions/${pendingAdd.id}`, { method: 'DELETE' });
        toast('تم إلغاء الطلب'); link(root);
      } catch (e) { toast(e.message); }
    };
    return;
  }

  const rejected = [lastLink, lastAdd].filter((x) => x && x.status === 'rejected').sort((a, b) => (b.reviewed_at || '').localeCompare(a.reviewed_at || ''))[0];
  root.innerHTML = `
    <div class="card mid">
      ${steps(2)}
      <h2>اختر اسمك من المشجرة</h2>
      ${rejected ? alertBox(`تم رفض طلبك السابق${rejected.admin_note ? ': ' + rejected.admin_note : ''}`, 'warn') : ''}
      <p class="muted">هذه الأسماء الموجودة في المشجرة والمطابقة لاسمك. اختر اسمك الصحيح وسيُربط حسابك به مباشرة.</p>
      <form id="sf" class="row" style="margin-bottom:14px">
        <input name="name" value="${esc(me.user.full_name)}" style="flex:1;min-width:200px" placeholder="الاسم الثلاثي أو الرباعي">
        <button class="btn secondary" type="submit">بحث</button>
      </form>
      <div id="results"><p class="muted">جارٍ البحث…</p></div>
      <div class="row between" style="margin-top:18px">
        <button class="btn" id="send" disabled>ربط حسابي بهذا الاسم</button>
        <button class="btn link" id="notFound">لم أجد اسمي — طلب إضافة</button>
      </div>
    </div>`;

  let selected = null;
  const search = async (name) => {
    selected = null; $('#send', root).disabled = true;
    const box = $('#results', root);
    box.innerHTML = '<p class="muted">جارٍ البحث…</p>';
    try {
      const r = await api(`/link/candidates?name=${encodeURIComponent(name)}`);
      if (!r.results.length) { box.innerHTML = alertBox('لم نجد أسماء مطابقة. جرّب كتابة الاسم بطريقة أخرى أو اطلب إضافة اسمك.', 'info'); return; }
      const maxScore = Math.max(...r.results.map((x) => x.score));
      box.innerHTML = (maxScore < 3 ? alertBox('نتائج تقريبية — تأكد من النسب قبل الاختيار', 'info') : '') + r.results.map((c) => `
        <div class="cand ${c.available ? '' : 'disabled'}" data-id="${c.id}" data-ok="${c.available ? 1 : 0}">
          <span class="muted">${icon('user')}</span>
          <span class="nm">${esc(c.full_name)}</span>
          ${c.available ? `<span class="badge">الجيل ${c.generation}</span>` : `<span class="badge danger">${esc(c.unavailable_reason)}</span>`}
        </div>`).join('');
      $$('.cand', box).forEach((el) => el.addEventListener('click', () => {
        if (el.dataset.ok !== '1') return;
        $$('.cand', box).forEach((x) => x.classList.remove('selected'));
        el.classList.add('selected');
        selected = { id: Number(el.dataset.id), name: $('.nm', el).textContent };
        $('#send', root).disabled = false;
      }));
    } catch (e) { box.innerHTML = alertBox(e.message); }
  };
  bindForm($('#sf', root), async (fd) => search(fd.get('name')));
  search(me.user.full_name);

  $('#send', root).onclick = () => {
    if (!selected) return;
    modal(`<h3>تأكيد الربط</h3>
      <p>سيُربط حسابك بالاسم:</p><p><b>${esc(selected.name)}</b></p>
      <p class="muted small">تأكد أنه اسمك فعلًا. لا يمكنك تغيير الاسم أو تعديل نسبك بنفسك بعد الربط، ولا يمكن ربط هذا الاسم بحساب آخر.</p>
      <div class="form-error"></div>
      <div class="actions"><button class="btn" id="ok">تأكيد الربط</button><button class="btn secondary" data-close>إلغاء</button></div>`,
    (m, close) => {
      $('#ok', m).onclick = async () => {
        try {
          await api('/link/requests', { method: 'POST', body: { person_id: selected.id } });
          close(); toast('تم ربط حسابك بنجاح'); await refreshMe();
          window.dispatchEvent(new Event('me-changed')); go('#/tree');
        } catch (e) { $('.form-error', m).innerHTML = alertBox(e.message); }
      };
    });
  };

  $('#notFound', root).onclick = () => additionForm(root);
}

function additionForm(root) {
  modal(`<h3>طلب إضافة اسمك إلى المشجرة</h3>
    <form id="af">
      <div class="form-error"></div>
      <div class="field"><label>اسمك (الاسم الأول فقط)</label><input name="name" required maxlength="40"></div>
      <div class="field"><label>الجنس</label><select name="gender"><option value="male">ذكر</option><option value="female">أنثى</option></select></div>
      <div class="field"><label>ابحث عن والدك في المشجرة</label><input id="fq" placeholder="اسم الأب واسم الجد">
        <div id="fr" class="stack small" style="margin-top:6px"></div><input type="hidden" name="father_id"></div>
      <div class="field"><label>أو اكتب نسبك كاملًا إن لم تجد والدك</label><input name="father_text" maxlength="200"></div>
      <div class="field"><label>تاريخ الميلاد (اختياري)</label><input type="date" name="birth_date"></div>
      <div class="field"><label>ملاحظات</label><textarea name="note" rows="2"></textarea></div>
      <div class="actions"><button class="btn" type="submit">إرسال الطلب</button><button class="btn secondary" type="button" data-close>إلغاء</button></div>
    </form>`, (m, close) => {
    let t;
    $('#fq', m).oninput = (e) => {
      clearTimeout(t);
      const q = e.target.value.trim();
      if (q.length < 2) { $('#fr', m).innerHTML = ''; return; }
      t = setTimeout(async () => {
        try {
          const r = await api(`/link/father-search?q=${encodeURIComponent(q)}`);
          $('#fr', m).innerHTML = r.results.map((x) => `<div class="cand" data-id="${x.id}"><span class="nm">${esc(x.full_name)}</span></div>`).join('') || '<span class="muted">لا نتائج</span>';
          $$('.cand', $('#fr', m)).forEach((el) => el.onclick = () => {
            $$('.cand', $('#fr', m)).forEach((x) => x.classList.remove('selected'));
            el.classList.add('selected');
            m.querySelector('[name=father_id]').value = el.dataset.id;
          });
        } catch (err) { $('#fr', m).innerHTML = esc(err.message); }
      }, 300);
    };
    bindForm($('#af', m), async (fd) => {
      const body = Object.fromEntries(fd);
      if (!body.father_id) delete body.father_id;
      await api('/link/additions', { method: 'POST', body });
      close(); toast('تم إرسال طلب الإضافة'); link(root);
    });
  }, { large: true });
}
