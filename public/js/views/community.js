import { state, api, esc, $, $$, date, badge, LABELS, alertBox, toast, bindForm, go, icon, evDate, evTime } from '../core.js';

function guard() {
  const me = state.me;
  if (!me || !me.user) { go('#/login'); return false; }
  if (!me.user.phone_verified) { go('#/verify'); return false; }
  return true;
}

/** "اليوم" / "غدًا" / "بعد 5 أيام" بالنسبة لتاريخ اليوم في السعودية */
function whenLabel(startsAt, now) {
  const days = Math.round((Date.parse(startsAt.slice(0, 10)) - Date.parse(now.slice(0, 10))) / 864e5);
  if (days < 0) return '';
  if (days === 0) return '<span class="badge ok">اليوم</span>';
  if (days === 1) return '<span class="badge warn">غدًا</span>';
  if (days === 2) return '<span class="badge">بعد يومين</span>';
  return `<span class="badge">بعد ${days} ${days <= 10 ? 'أيام' : 'يومًا'}</span>`;
}

export function eventCard(e, now, { past = false, admin = false } = {}) {
  const d = new Date(e.starts_at.slice(0, 10) + 'T00:00:00Z');
  const day = d.getUTCDate();
  const month = d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'UTC', month: 'short' });
  return `
    <article class="card event ${e.is_cancelled ? 'cancelled' : ''} ${past ? 'past' : ''}" data-id="${e.id}">
      <div class="ev-date"><b>${day}</b><span>${esc(month)}</span></div>
      <div class="ev-body">
        <div class="row between">
          <h3>${esc(e.title)}</h3>
          <div class="row">${e.is_cancelled ? '<span class="badge danger">ملغاة</span>' : past ? '<span class="badge info">انتهت</span>' : whenLabel(e.starts_at, now)}
            ${admin && !e.is_published ? '<span class="badge warn">مسودة</span>' : ''}</div>
        </div>
        <div class="ev-meta">
          <span>${icon('calendar')} ${esc(evDate(e.starts_at))} <span class="muted small">(${esc(evDate(e.starts_at, { weekday: false, hijri: true }))})</span></span>
          <span>${icon('clock')} ${esc(evTime(e.starts_at))}${e.ends_at ? ` – ${esc(e.ends_at.slice(0, 10) === e.starts_at.slice(0, 10) ? evTime(e.ends_at) : evDate(e.ends_at) + ' ' + evTime(e.ends_at))}` : ''}</span>
          ${e.location ? `<span>${icon('pin')} ${e.map_url ? `<a href="${esc(e.map_url)}" target="_blank" rel="noopener noreferrer">${esc(e.location)}</a>` : esc(e.location)}</span>`
            : e.map_url ? `<span>${icon('pin')} <a href="${esc(e.map_url)}" target="_blank" rel="noopener noreferrer">الموقع على الخريطة</a></span>` : ''}
        </div>
        ${e.description ? `<p class="ev-desc">${esc(e.description)}</p>` : ''}
        <div class="row between ev-foot">
          <span class="muted small">${icon('users')} سيحضر ${e.going}${e.maybe ? ` · ربما ${e.maybe}` : ''}${admin && e.not_going ? ` · لن يحضر ${e.not_going}` : ''}</span>
          ${!past && !e.is_cancelled && !admin ? `<div class="rsvp" role="group" aria-label="تأكيد الحضور">
            ${['yes', 'maybe', 'no'].map((s) => `<button class="btn sm ${e.my_rsvp === s ? '' : 'secondary'}" data-rsvp="${s}">${LABELS.rsvp[s]}</button>`).join('')}
          </div>` : ''}
          ${admin ? `<div class="row">
            <button class="btn sm secondary" data-att="${e.id}">${icon('users')} الحضور</button>
            <button class="btn sm secondary" data-edit="${e.id}">${icon('edit')} تعديل</button>
            <button class="btn sm danger" data-del="${e.id}">${icon('trash')} حذف</button></div>` : ''}
        </div>
      </div>
    </article>`;
}

// ============ المناسبات القادمة ============
export async function events(root, params = {}) {
  if (!guard()) return;
  const scope = params.query && params.query.get('scope') === 'past' ? 'past' : 'upcoming';
  root.innerHTML = `
    <div class="mid">
      <div class="row between"><h1>${icon('calendar')} المناسبات العائلية</h1></div>
      <nav class="tabs">
        <a href="#/events" class="${scope === 'upcoming' ? 'on' : ''}">القادمة</a>
        <a href="#/events?scope=past" class="${scope === 'past' ? 'on' : ''}">السابقة</a>
      </nav>
      <div id="list"><p class="muted">جارٍ التحميل…</p></div>
    </div>`;
  const list = $('#list', root);
  try {
    const d = await api(`/events?scope=${scope}`);
    if (!d.items.length) {
      list.innerHTML = `<div class="card empty">${icon('calendar')}<p>${scope === 'upcoming' ? 'لا توجد مناسبات قادمة حاليًا. ستظهر هنا أي مناسبة تعلن عنها الإدارة.' : 'لا توجد مناسبات سابقة.'}</p></div>`;
      return;
    }
    list.innerHTML = d.items.map((e) => eventCard(e, d.now, { past: scope === 'past' })).join('');
    $$('[data-rsvp]', list).forEach((b) => b.onclick = async () => {
      const card = b.closest('.event');
      try {
        await api(`/events/${card.dataset.id}/rsvp`, { method: 'PUT', body: { status: b.dataset.rsvp } });
        toast('تم تسجيل ردّك');
        state.homeAt = 0; window.dispatchEvent(new Event('me-changed'));
        events(root, params);
      } catch (err) { toast(err.message); }
    });
  } catch (e) { list.innerHTML = alertBox(e.message); }
}

// ============ الاقتراحات والاستفسارات ============
export async function feedback(root) {
  if (!guard()) return;
  root.innerHTML = `
    <div class="mid">
      <h1>${icon('chat')} الاقتراحات والاستفسارات</h1>
      <p class="muted">شاركنا اقتراحك لتطوير المشجرة أو أنشطة العائلة، أو أرسل استفسارك وسترد عليك الإدارة هنا.</p>
      <div class="card">
        <form id="ff">
          <div class="form-error"></div>
          <div class="field"><label>النوع</label>
            <div class="seg">
              <label class="seg-opt"><input type="radio" name="type" value="suggestion" checked><span>${icon('bulb')} اقتراح</span></label>
              <label class="seg-opt"><input type="radio" name="type" value="inquiry"><span>${icon('question')} استفسار</span></label>
            </div>
          </div>
          <div class="field"><label for="fs">العنوان</label><input id="fs" name="subject" required minlength="3" maxlength="120"></div>
          <div class="field"><label for="fm">التفاصيل</label><textarea id="fm" name="message" rows="5" required minlength="5" maxlength="3000"></textarea></div>
          <button class="btn" type="submit">إرسال</button>
        </form>
      </div>
      <h2 style="margin-top:26px">رسائلي</h2>
      <div id="mine"><p class="muted">جارٍ التحميل…</p></div>
    </div>`;

  const loadMine = async () => {
    const box = $('#mine', root);
    try {
      const d = await api('/feedback');
      if (d.items.some((f) => f.user_seen === 0)) { state.homeAt = 0; window.dispatchEvent(new Event('me-changed')); }
      box.innerHTML = d.items.length ? d.items.map((f) => `
        <div class="card fb">
          <div class="row between"><div class="row"><span class="badge">${LABELS.fbType[f.type]}</span><b>${esc(f.subject)}</b></div>${badge('fb', f.status)}</div>
          <p class="fb-msg">${esc(f.message)}</p>
          <div class="muted small">أُرسل في ${date(f.created_at, true)}</div>
          ${f.reply ? `<div class="fb-reply"><div class="small"><b>رد الإدارة</b> <span class="muted">— ${date(f.replied_at, true)}</span></div><p>${esc(f.reply)}</p></div>` : ''}
        </div>`).join('') : '<p class="muted">لم ترسل أي اقتراح أو استفسار بعد.</p>';
    } catch (e) { box.innerHTML = alertBox(e.message); }
  };

  bindForm($('#ff', root), async (fd) => {
    await api('/feedback', { method: 'POST', body: { type: fd.get('type'), subject: fd.get('subject'), message: fd.get('message') } });
    $('#ff', root).reset();
    toast('تم الإرسال، شكرًا لك');
    loadMine();
  });
  loadMine();
}
