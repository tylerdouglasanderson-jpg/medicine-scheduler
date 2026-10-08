// Calendar render: week blocks (Sun-Sat), totals table, warnings panel.
// Rendering spec ground truth: fixtures/aug-2025-sheet-week.md (format only).
import { deriveCycle, monthDates, onService } from '../model.js';

const ROWS = ['DATE', 'TYPE', 'ROUNDERS', 'PAGER', 'CLINIC', 'DIDACTICS', 'PTO', 'OFF'];
const ROW_CLASS = {
  TYPE: 'type', ROUNDERS: 'rounders', PAGER: 'pager', CLINIC: 'clinic',
  DIDACTICS: 'didactics', PTO: 'pto', OFF: 'off',
};
const TYPE_LABEL = { precall: 'PRECALL', call: 'CALL', postcall: 'PC', ppc: 'PPC', sc1: 'SC1', sc2: 'SC2' };
const DOW_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ANCHOR_LABEL = { precall: 'Pre-Call', call: 'Call', postcall: 'Post-Call', ppc: 'Post-Post-Call', sc1: 'Short Call 1', sc2: 'Short Call 2' };

const dowOf = date => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };

function hasHalfOff(scenario, person, date) {
  return (scenario.pins ?? []).some(p => p.type === 'halfOff' && p.person === person && p.date === date);
}
function isBonusOff(scenario, person, date) {
  return (scenario.pins ?? []).some(p => p.type === 'offFree' && p.person === person && p.date === date);
}
// v1.1.0: the CLINIC row also carries non-clinic commitments (ITE, …). Any label that doesn't start with
// "clinic" is named inline with its own label — "Smith (ITE)", "Smith (Conference)" — the same way DIDACTICS
// tags "(pager)". No new row. A blank label reads "(other commitment)".
function clinicLabel(r, date) {
  const cs = (r.commitments ?? []).filter(c => c.date === date);
  const name = c => (c.label ?? '').trim() || 'other commitment';
  const other = [...new Set(cs.map(name).filter(l => !/^clinic/i.test(l)))];
  if (!other.length) return r.name;
  const hasClinic = cs.some(c => /^clinic/i.test(name(c)));
  return `${r.name} (${hasClinic ? 'clinic + ' : ''}${other.join(', ')})`;
}
function clinicNames(scenario, date) {
  return scenario.residents
    .filter(r => (r.commitments ?? []).some(c => c.date === date))
    .map(r => clinicLabel(r, date));
}
function ptoNames(scenario, date) {
  return scenario.residents.filter(r => (r.pto ?? []).includes(date)).map(r => r.name);
}
function offNames(scenario, dd, date) {
  if (!dd) return [];
  return dd.off.map(n => (isBonusOff(scenario, n, date) ? `${n} (bonus)` : n));
}
// The pager holder still goes to didactics and steps out if something happens (program rule, 2026-08),
// so they stay on this row, tagged. Off / post-call sleep / PTO genuinely lose the half-day.
function didacticsNames(scenario, schedule, date, type) {
  if (type === 'call' || type === 'postcall') return [];   // nobody attends on those days
  const dd = schedule.days[date];
  const dow = dowOf(date);
  return scenario.residents
    .filter(r => r.didactics && r.didactics.dow === dow && onService(r, date))
    .filter(r => !(dd.off.includes(r.name) || (r.pto ?? []).includes(date)))
    .filter(r => !(scenario.pins ?? []).some(p => p.type === 'halfOff' && p.person === r.name
      && p.date === date && p.half === (r.didactics.half ?? 'PM')))
    .map(r => (dd.pager === r.name ? `${r.name} (pager)` : r.name));
}

function renderRounders(td, date, type, dd, scenario) {
  const lines = [];
  if (type === 'call') {
    for (const n of dd.working.filter(n => n !== dd.night)) lines.push(`Day - ${n}`);
    if (dd.night) lines.push(`Night - ${dd.night}`);
  } else if (type === 'postcall') {
    for (const n of dd.working) lines.push(`${n} (postcall)`);
  } else {
    for (const n of dd.working) lines.push(hasHalfOff(scenario, n, date) ? `${n} - 1/2 off` : n);
  }
  for (const note of scenario.notes ?? [])
    if (note.date === date) lines.push(note.text);

  for (const line of lines) {
    const div = document.createElement('div');
    div.textContent = line;
    td.appendChild(div);
  }
}

function buildCell(row, date, scenario, schedule, types, mrDays) {
  const td = document.createElement('td');
  if (date == null) {
    td.className = 'blank';
    return td;
  }
  td.dataset.date = date;
  td.dataset.row = row;
  if (ROW_CLASS[row]) td.classList.add(ROW_CLASS[row]);

  const type = types.get(date);
  const dd = schedule.days[date];

  switch (row) {
    case 'DATE':
      td.textContent = String(Number(date.slice(8)));
      break;
    case 'TYPE':
      td.textContent = TYPE_LABEL[type];
      if (type === 'call') td.classList.add('type-call');
      // Morning Report: this team presents (pre-call team, Tue/Thu) — flag it on the calendar.
      if (mrDays.has(date)) {
        td.classList.add('type-mr');
        td.dataset.morningReport = 'true';
        td.title = 'Morning Report — this team presents today.';
        const tag = document.createElement('div');
        tag.className = 'mr-tag';
        tag.textContent = 'MORNING REPORT';
        td.appendChild(tag);
      }
      break;
    case 'ROUNDERS':
      renderRounders(td, date, type, dd, scenario);
      break;
    case 'PAGER':
      td.textContent = type === 'call' ? '—' : (dd.pager ?? '—');
      if (dd.pager === 'ATTENDING') td.classList.add('attending-pager');
      break;
    case 'CLINIC':
      td.textContent = clinicNames(scenario, date).join(', ');
      break;
    case 'DIDACTICS':
      td.textContent = didacticsNames(scenario, schedule, date, type).join(', ');
      break;
    case 'PTO':
      td.textContent = ptoNames(scenario, date).join(', ');
      break;
    case 'OFF':
      td.textContent = offNames(scenario, dd, date).join(', ');
      break;
  }
  return td;
}

function buildWeeks(dates, firstDow) {
  const padded = [...Array(firstDow).fill(null), ...dates];
  while (padded.length % 7 !== 0) padded.push(null);
  const weeks = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));
  return weeks;
}

function renderWeek(week, scenario, schedule, types, mrDays) {
  const table = document.createElement('table');
  table.className = 'week';
  for (const row of ROWS) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = row;
    tr.appendChild(th);
    for (const date of week) tr.appendChild(buildCell(row, date, scenario, schedule, types, mrDays));
    table.appendChild(tr);
  }
  return table;
}

export function renderCalendar(scenario, schedule) {
  const { types, morningReportDays } = deriveCycle(scenario.anchorType, scenario.month);
  const mrDays = new Set(morningReportDays);
  const dates = monthDates(scenario.month);
  const [Y, M] = scenario.month.split('-').map(Number);
  const firstDow = new Date(Y, M - 1, 1).getDay();

  const container = document.createElement('div');
  container.className = 'calendar';

  const header = document.createElement('h2');
  header.textContent = `${MONTH_NAMES[M - 1]} ${Y} — ${DOW_NAMES[firstDow]} (${ANCHOR_LABEL[scenario.anchorType]})`;
  container.appendChild(header);

  const weeksWrap = document.createElement('div');
  weeksWrap.className = 'weeks';
  for (const week of buildWeeks(dates, firstDow))
    weeksWrap.appendChild(renderWeek(week, scenario, schedule, types, mrDays));
  container.appendChild(weeksWrap);

  return container;
}

const TOTALS_COLS = [
  ['Resident', 'name'], ['Shifts', 'shifts'], ['Pager', 'pager'], ['Clinic', 'clinic'],
  ['Didactics', 'didactics'], ['Off', 'off'], ['PTO', 'pto'], ['Bonus', 'bonus'],
  ['Perks', 'perks'], ['Off + Bonus', 'offBonus'], ['PM off', 'pmOff'],   // PM off: v1.1.0
];
// Plain-words meaning of each column (mirrors solve.js totals and the guide's "Totals table").
export const TOTALS_HELP = {
  name: 'The resident.',
  shifts: 'Days they worked on the team this month. A day with a half day off counts as half a shift.',
  pager: 'Days they held the team pager.',
  clinic: 'Clinic commitments that fell on a day they were working, so they went.',
  didactics: 'Didactics sessions attended out of the sessions they could attend. Call, post-call and PTO days ' +
    'are left out. Holding the pager still counts as attending.',
  off: 'Whole days off that count toward their quota. Bonus days and half days are not in this number.',
  pto: 'Leave days that fall while they are on the team.',
  bonus: 'Extra free whole days off (pinned as free / bonus). They do not count toward the quota.',
  perks: 'Half days off. Each one is an extra freebie: never counted in Off, and two halves do not make a day off.',
  offBonus: 'All whole days off: counted offs plus bonus days. Half days are not included.',
  pmOff: 'Afternoons off: days they rounded in the morning with nothing in the afternoon (no pager, clinic, ' +
    'didactics or other PM block). Weekends count; call and post-call days never do. For information only.',
};
const NO_DIDACTICS_TIP = 'No didactics sessions they could attend this month (call, post-call, PTO or off service)';

export function renderTotals(schedule) {
  const table = document.createElement('table');
  table.className = 'totals-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const [label, col] of TOTALS_COLS) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    th.title = TOTALS_HELP[col];
    if (col !== 'name') th.className = 'num';
    // A hidden description the header points at: a title alone is never read on touch devices.
    const desc = document.createElement('span');
    desc.id = `totals-help-${col}`;
    desc.hidden = true;
    desc.textContent = TOTALS_HELP[col];
    th.setAttribute('aria-describedby', desc.id);
    th.appendChild(desc);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const [name, t] of Object.entries(schedule.totals)) {
    const row = { ...t, name, offBonus: t.off + t.bonus };
    const tr = document.createElement('tr');
    for (const [, col] of TOTALS_COLS) {
      const td = document.createElement('td');
      td.dataset.name = name;
      td.dataset.col = col;
      if (col !== 'name') td.className = 'num';
      // Didactics reads as a fraction of the sessions this month could actually offer them
      // (call days and PTO are excluded from the denominator — nothing can be done about those).
      if (col === 'name') td.textContent = name;
      else if (col === 'didactics') {
        // A schedule saved before the denominator existed shows the bare old count — inventing
        // `n / n` there would read as a perfect score for a schedule that was nothing of the kind.
        if (t.didacticsOf === 0) {
          td.textContent = '—';
          td.title = NO_DIDACTICS_TIP;
          td.setAttribute('aria-label', NO_DIDACTICS_TIP);
        } else {
          td.textContent = t.didacticsOf == null ? String(t.didactics) : `${t.didactics} / ${t.didacticsOf}`;
          if (t.didacticsPager) td.title = `${t.didacticsPager} of those attended while holding the pager`;
        }
      } else if (row[col] == null) td.textContent = '—';
      else td.textContent = Number.isInteger(row[col]) ? String(row[col]) : row[col].toFixed(1);   // half-days keep one decimal
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

// onAttendingCover(date) — optional. When a resident is tethered to the pager on their own
// didactics day and nobody else on the team is free to take it, the only remedy is handing that
// afternoon to the attending; the row offers it as a one-click re-solve rather than a rule change.
export function renderWarnings(auditResult, onAttendingCover) {
  const container = document.createElement('div');
  container.className = 'warnings-panel';

  const h = document.createElement('h2');
  h.textContent = 'Potential Issues';
  container.appendChild(h);

  const ul = document.createElement('ul');
  for (const w of auditResult.warnings) {
    const li = document.createElement('li');
    li.className = 'warning';
    const text = document.createElement('span');
    if (w.date) {
      const [, m, d] = w.date.split('-').map(Number);
      text.textContent = `${MONTH_ABBR[m - 1]} ${d}: ${w.message}`;
    } else {
      text.textContent = w.message;
    }
    li.appendChild(text);
    if ((w.attendingCanCover || w.attendingChosen) && onAttendingCover) {
      const undo = !!w.attendingChosen;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost warning-action';
      btn.textContent = undo ? 'Give it back to the team' : 'Attending covers the pager';
      btn.dataset.attendingDate = w.date;
      btn.title = undo
        ? `Take ${w.date} back off the attending and solve again.`
        : `Hand the pager on ${w.date} to the attending and solve again — the rest of the month is held steady.`;
      btn.addEventListener('click', () => onAttendingCover(w.date, undo));
      li.appendChild(btn);
    }
    ul.appendChild(li);
  }
  container.appendChild(ul);
  return container;
}
