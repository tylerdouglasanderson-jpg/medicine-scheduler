// Compare view: your working draft against what a team link was last published from (the private snapshot).
// diffMonths() is pure (no DOM); showCompare() draws it in a native <dialog id="compare-dialog">.
// A "month" here is the scenario JSON the app saves: the schedule is lastSolution (or alternatives[activeSolution]),
// shaped { days: { 'YYYY-MM-DD': { working, off, sleeper, pager, night, dayCall: { senior, intern } } }, totals }.

const COUNTS = [['calls', 'Calls'], ['nights', 'Nights'], ['weekends', 'Weekends'], ['offs', 'Offs'], ['pager', 'Pager'], ['didactics', 'Didactics']];
const asList = v => (v == null || v === '' ? [] : Array.isArray(v) ? [...v].sort() : [v]);
const SLOTS = [
  ['Night', d => asList(d.night)],
  ['Pager', d => asList(d.pager)],
  ['Day call (senior)', d => asList(d.dayCall?.senior)],
  ['Day call (intern)', d => asList(d.dayCall?.intern)],
  ['Post-call', d => asList(d.sleeper)],
  ['Off', d => asList(d.off)],
];
const parseMonth = m => (typeof m === 'string' ? JSON.parse(m) : m);

export function scheduleOf(month) {
  if (!month) return null;
  return month.lastSolution ?? month.alternatives?.[month.activeSolution ?? 0] ?? null;
}

// Per-person counts, derived from the day grid (didactics comes from the stored totals).
function countsFor(sch) {
  const out = {};
  const get = n => (out[n] ??= { calls: 0, nights: 0, weekends: 0, offs: 0, pager: 0, didactics: 0 });
  for (const [date, d] of Object.entries(sch?.days ?? {})) {
    const weekend = [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
    if (weekend) for (const n of d.working ?? []) get(n).weekends++;
    if (d.night) get(d.night).nights++;
    for (const n of [d.dayCall?.senior, d.dayCall?.intern]) if (n) get(n).calls++;
    for (const n of d.off ?? []) get(n).offs++;
    if (d.pager && d.pager !== 'ATTENDING') get(d.pager).pager++;
  }
  for (const [n, t] of Object.entries(sch?.totals ?? {})) get(n).didactics = t.didactics ?? 0;
  return out;
}

const ZERO = () => Object.fromEntries(COUNTS.map(([k]) => [k, 0]));

export function diffMonths(pubMonth, draftMonth) {
  const a = scheduleOf(pubMonth), b = scheduleOf(draftMonth);
  const dates = [...new Set([...Object.keys(a?.days ?? {}), ...Object.keys(b?.days ?? {})])].sort();
  const days = [];
  const touched = new Set();
  for (const date of dates) {
    const da = a?.days?.[date] ?? {}, db = b?.days?.[date] ?? {};
    const changes = [];
    for (const [slot, get] of SLOTS) {
      const before = get(da), after = get(db);
      if (before.join('\u0001') === after.join('\u0001')) continue;
      changes.push({ slot, before: before.join(', ') || null, after: after.join(', ') || null });
      for (const n of before) if (!after.includes(n)) touched.add(n);
      for (const n of after) if (!before.includes(n)) touched.add(n);
    }
    if (changes.length) days.push({ date, changes });
  }
  const ca = countsFor(a), cb = countsFor(b);
  const people = [...new Set([...Object.keys(ca), ...Object.keys(cb)])].map(name => {
    const before = { ...ZERO(), ...ca[name] }, after = { ...ZERO(), ...cb[name] };
    const delta = Object.fromEntries(COUNTS.map(([k]) => [k, after[k] - before[k]]));
    const changed = touched.has(name) || Object.values(delta).some(v => v !== 0);
    return { name, before, after, delta, changed };
  }).sort((x, y) => (y.changed - x.changed) || x.name.localeCompare(y.name));
  return { days, people, dayCount: days.length, personCount: people.filter(p => p.changed).length, hasPublished: !!a, hasDraft: !!b };
}

// ---------- DOM ----------
const STYLE_ID = 'compare-style';
const CSS = `
#compare-dialog { max-width: min(760px, 96vw); }
.cmp-banner { font-weight: 600; padding: 8px 12px; border-radius: 8px; margin: 0 0 10px; background: var(--accent-weak); color: var(--ink); border: 1px solid var(--border); }
.cmp-banner.cmp-warn { background: var(--warn-bg); border-color: var(--warn-border); }
.cmp-days { list-style: none; margin: 0 0 12px; padding: 0; max-height: 36vh; overflow: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
.cmp-days li { padding: 6px 10px; border-bottom: 1px solid var(--border); color: var(--ink); }
.cmp-days li:last-child { border-bottom: 0; }
.cmp-date { font-weight: 600; margin-right: 8px; }
.cmp-slot { color: var(--ink-2); }
.cmp-change { display: block; margin-left: 8px; }
.cmp-table-wrap { overflow: auto; max-height: 30vh; margin-bottom: 12px; }
.cmp-table { border-collapse: collapse; width: 100%; font-size: 0.9em; color: var(--ink); }
.cmp-table th, .cmp-table td { border: 1px solid var(--border); padding: 4px 8px; text-align: center; background: var(--surface); }
.cmp-table th { background: var(--panel); color: var(--ink-2); }
.cmp-table td:first-child, .cmp-table th:first-child { text-align: left; }
.cmp-table td.cmp-changed { background: var(--warn-bg); border-color: var(--warn-border); font-weight: 600; }
.cmp-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.publish-chip { border-radius: 999px; padding: 4px 12px; font-size: 0.85em; cursor: default; border: 1px solid var(--border); background: var(--panel); color: var(--muted); }
.publish-chip-ok { border-color: #2e7d32; color: #2e7d32; background: var(--surface); cursor: pointer; }
.publish-chip-stale { border-color: var(--warn-border); background: var(--warn-bg); color: var(--ink); cursor: pointer; font-weight: 600; }
`;
export function ensureCompareStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID; s.textContent = CSS;
  document.head.appendChild(s);
}

const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.filter(k => k != null));
  return n;
};
const dayLabel = date => {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
};

// published / draft: month JSON (object or text). onUpdate / onRevert: run after the dialog closes.
export function showCompare({ published, draft, onUpdate, onRevert } = {}) {
  ensureCompareStyle();
  const diff = diffMonths(parseMonth(published), parseMonth(draft));
  document.getElementById('compare-dialog')?.remove();
  const dlg = el('dialog', { id: 'compare-dialog', className: 'app-dialog' });
  const close = () => dlg.close();
  dlg.append(el('div', { className: 'guide-dialog-header' }, el('h2', { textContent: 'Draft vs team link' }),
    el('button', { type: 'button', className: 'btn-ghost', textContent: '×', title: 'Closes this box.', onclick: close })));
  const body = el('div', { className: 'app-dialog-body' });
  dlg.append(body);

  const same = diff.dayCount === 0 && diff.personCount === 0;
  const bannerText = !diff.hasDraft ? 'Your draft has no solved schedule yet'
    : !diff.hasPublished ? 'The team link has no schedule to compare with'
      : same ? 'No differences — the team link matches your draft'
        : `${diff.dayCount} ${diff.dayCount === 1 ? 'day differs' : 'days differ'} · ${diff.personCount} ${diff.personCount === 1 ? 'person' : 'people'} affected`;
  body.append(el('p', { className: `cmp-banner${diff.hasDraft && diff.hasPublished && !same ? ' cmp-warn' : ''}`, id: 'compare-banner', textContent: bannerText }));

  if (diff.dayCount) {
    const list = el('ul', { className: 'cmp-days', id: 'compare-days' });
    for (const d of diff.days) {
      const li = el('li', {}, el('span', { className: 'cmp-date', textContent: dayLabel(d.date), title: d.date }));
      for (const c of d.changes) {
        li.append(el('span', { className: 'cmp-change' },
          el('span', { className: 'cmp-slot', textContent: `${c.slot}: ` }),
          `${c.before ?? '—'} → ${c.after ?? '—'}`));
      }
      list.append(li);
    }
    body.append(list);
  }

  const affected = diff.people.filter(p => p.changed);
  if (affected.length) {
    const table = el('table', { className: 'cmp-table', id: 'compare-people' });
    table.append(el('thead', {}, el('tr', {}, el('th', { scope: 'col', textContent: 'Name' }),
      ...COUNTS.map(([, label]) => el('th', { scope: 'col', textContent: label })))));
    table.append(el('tbody', {}, ...affected.map(p => el('tr', {}, el('td', { textContent: p.name }),
      ...COUNTS.map(([k]) => el('td', p.delta[k] ? { className: 'cmp-changed', textContent: `${p.before[k]} → ${p.after[k]}` } : { textContent: String(p.after[k]) }))))));
    body.append(el('div', { className: 'cmp-table-wrap' }, table));
  }

  const actions = el('div', { className: 'cmp-actions' });
  if (onUpdate) actions.append(el('button', { type: 'button', id: 'compare-update', className: 'btn-primary dialog-link', textContent: 'Update team schedule',
    onclick: () => { close(); onUpdate(); } }));
  if (onRevert) actions.append(el('button', { type: 'button', id: 'compare-revert', className: 'btn-secondary dialog-link', textContent: 'Revert draft to this link',
    onclick: () => { close(); onRevert(); } }));
  actions.append(el('button', { type: 'button', id: 'compare-close', className: 'btn-ghost dialog-link', textContent: 'Close', onclick: close }));
  body.append(actions);

  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.appendChild(dlg);
  dlg.showModal();
  return dlg;
}
