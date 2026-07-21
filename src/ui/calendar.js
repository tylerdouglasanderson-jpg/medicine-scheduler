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
function clinicNames(scenario, date) {
  return scenario.residents
    .filter(r => (r.commitments ?? []).some(c => c.date === date))
    .map(r => r.name);
}
function ptoNames(scenario, date) {
  return scenario.residents.filter(r => (r.pto ?? []).includes(date)).map(r => r.name);
}
function offNames(scenario, dd, date) {
  if (!dd) return [];
  return dd.off.map(n => (isBonusOff(scenario, n, date) ? `${n} (bonus)` : n));
}
function didacticsNames(scenario, schedule, date, type) {
  if (type === 'call') return [];
  const dd = schedule.days[date];
  const dow = dowOf(date);
  return scenario.residents
    .filter(r => r.didactics && r.didactics.dow === dow && onService(r, date))
    .filter(r => !(dd.pager === r.name || dd.off.includes(r.name) || dd.sleeper === r.name || (r.pto ?? []).includes(date)))
    .map(r => r.name);
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
  ['Perks', 'perks'], ['Off + Bonus', 'offBonus'],
];

export function renderTotals(schedule) {
  const table = document.createElement('table');
  table.className = 'totals-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const [label] of TOTALS_COLS) {
    const th = document.createElement('th');
    th.textContent = label;
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
      td.textContent = col === 'name' ? name : row[col].toFixed(1);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

export function renderWarnings(auditResult) {
  const container = document.createElement('div');
  container.className = 'warnings-panel';

  const h = document.createElement('h2');
  h.textContent = 'Potential Issues';
  container.appendChild(h);

  const ul = document.createElement('ul');
  for (const w of auditResult.warnings) {
    const li = document.createElement('li');
    li.className = 'warning';
    if (w.date) {
      const [, m, d] = w.date.split('-').map(Number);
      li.textContent = `${MONTH_ABBR[m - 1]} ${d}: ${w.message}`;
    } else {
      li.textContent = w.message;
    }
    ul.appendChild(li);
  }
  container.appendChild(ul);
  return container;
}
