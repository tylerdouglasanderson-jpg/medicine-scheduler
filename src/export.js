// Styled xlsx export (mirrors the calendar.js week-block sheet) + browser download wrapper.
// Independent cell-text logic (small duplication of calendar.js's per-row rules is deliberate —
// this module targets an ExcelJS workbook, not the DOM, and Task 9's scope is export.js only).
/* global __BUILD_VERSION__ */
import ExcelJS from 'exceljs';
import { deriveCycle, monthDates, onService } from './model.js';

const ROWS = ['DATE', 'TYPE', 'ROUNDERS', 'PAGER', 'CLINIC', 'DIDACTICS', 'PTO', 'OFF'];
const TYPE_LABEL = { precall: 'PRECALL', call: 'CALL', postcall: 'PC', ppc: 'PPC', sc1: 'SC1', sc2: 'SC2' };
const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const FILLS = {
  TYPE: 'FF9DC3E6', CALL: 'FFFF9999', ROUNDERS: 'FFD6E7F5', PAGER: 'FFC6E0B4',
  CLINIC: 'FFFFE699', DIDACTICS: 'FFF8CBAD', PTO: 'FFFFC000', OFF: 'FFF4B8C1', BLANK: 'FF595959',
};
const TOTALS_COLS = [
  ['Resident', 'name'], ['Shifts', 'shifts'], ['Pager', 'pager'], ['Clinic', 'clinic'],
  ['Didactics', 'didactics'], ['Off', 'off'], ['PTO', 'pto'], ['Bonus', 'bonus'],
  ['Perks', 'perks'], ['Off + Bonus', 'offBonus'],
];
const TOTALS_START_COL = 10; // column J

const dowOf = date => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };

function fill(cell, argb) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
  cell.alignment = { vertical: 'top', wrapText: true };
}

function hasHalfOff(scenario, person, date) {
  return (scenario.pins ?? []).some(p => p.type === 'halfOff' && p.person === person && p.date === date);
}
function isBonusOff(scenario, person, date) {
  return (scenario.pins ?? []).some(p => p.type === 'offFree' && p.person === person && p.date === date);
}
function rounderLines(date, type, dd, scenario) {
  const lines = [];
  if (type === 'call') {
    for (const n of dd.working.filter(n => n !== dd.night)) lines.push(`Day - ${n}`);
    if (dd.night) lines.push(`Night - ${dd.night}`);
  } else if (type === 'postcall') {
    for (const n of dd.working) lines.push(`${n} (postcall)`);
  } else {
    for (const n of dd.working) lines.push(hasHalfOff(scenario, n, date) ? `${n} - 1/2 off` : n);
  }
  for (const note of scenario.notes ?? []) if (note.date === date) lines.push(note.text);
  return lines;
}
function clinicNames(scenario, date) {
  return scenario.residents.filter(r => (r.commitments ?? []).some(c => c.date === date)).map(r => r.name);
}
function ptoNames(scenario, date) {
  return scenario.residents.filter(r => (r.pto ?? []).includes(date)).map(r => r.name);
}
function offNames(scenario, dd, date) {
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

function cellText(row, date, type, dd, scenario, schedule) {
  switch (row) {
    case 'DATE': return String(Number(date.slice(8)));
    case 'TYPE': return TYPE_LABEL[type];
    case 'ROUNDERS': return rounderLines(date, type, dd, scenario).join('\n');
    case 'PAGER': return type === 'call' ? '—' : (dd.pager ?? '—');
    case 'CLINIC': return clinicNames(scenario, date).join(', ');
    case 'DIDACTICS': return didacticsNames(scenario, schedule, date, type).join(', ');
    case 'PTO': return ptoNames(scenario, date).join(', ');
    case 'OFF': return offNames(scenario, dd, date).join(', ');
    default: return '';
  }
}

function buildWeeks(dates, firstDow) {
  const padded = [...Array(firstDow).fill(null), ...dates];
  while (padded.length % 7 !== 0) padded.push(null);
  const weeks = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));
  return weeks;
}

function writeCalendar(ws, scenario, schedule, types, dates, firstDow) {
  let row = 2;
  for (const week of buildWeeks(dates, firstDow)) {
    for (const label of ROWS) {
      const rowIdx = row++;
      ws.getCell(rowIdx, 1).value = label;
      week.forEach((date, ci) => {
        const cell = ws.getCell(rowIdx, ci + 2);
        if (date == null) { fill(cell, FILLS.BLANK); return; }
        const type = types.get(date);
        const dd = schedule.days[date];
        cell.value = cellText(label, date, type, dd, scenario, schedule);
        const fillKey = label === 'TYPE' && type === 'call' ? 'CALL' : label;
        if (FILLS[fillKey]) fill(cell, FILLS[fillKey]);
      });
    }
  }
  return row; // first row after the calendar
}

function writeTotals(ws, schedule) {
  TOTALS_COLS.forEach(([label], i) => { ws.getCell(2, TOTALS_START_COL + i).value = label; });
  let row = 3;
  for (const [name, t] of Object.entries(schedule.totals)) {
    const data = { ...t, name, offBonus: t.off + t.bonus };
    TOTALS_COLS.forEach(([, col], i) => { ws.getCell(row, TOTALS_START_COL + i).value = data[col]; });
    row++;
  }
}

function writeNotes(ws, scenario, auditResult, startRow) {
  let row = startRow + 1;
  ws.getCell(row++, 1).value = 'Notes';
  for (const r of scenario.residents) {
    if (!r.didactics) continue;
    const stop = r.didactics.hard ? 'hard stop' : 'soft stop';
    ws.getCell(row++, 1).value = `${r.name}: ${DOW_NAMES[r.didactics.dow]} didactics (${stop})`;
  }
  row++;
  ws.getCell(row++, 1).value = 'Potential Issues';
  for (const w of auditResult.warnings)
    ws.getCell(row++, 1).value = w.date ? `${w.date}: ${w.message}` : w.message;
}

export async function buildWorkbook(scenario, schedule, auditResult, version) {
  const { types } = deriveCycle(scenario.anchorType, scenario.month);
  const dates = monthDates(scenario.month);
  const [Y, M] = scenario.month.split('-').map(Number);
  const firstDow = new Date(Y, M - 1, 1).getDay();

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(scenario.anchorType || 'Schedule');

  ws.getCell(1, 1).value = `${MONTH_NAMES[M - 1]} ${Y}  ${DOW_NAMES[firstDow].toUpperCase()}  —  built ${version}`;

  const afterCalendar = writeCalendar(ws, scenario, schedule, types, dates, firstDow);
  writeTotals(ws, schedule);
  writeNotes(ws, scenario, auditResult, afterCalendar);

  return wb;
}

export async function downloadXlsx(scenario, schedule, auditResult) {
  const wb = await buildWorkbook(scenario, schedule, auditResult, __BUILD_VERSION__);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${scenario.team || 'schedule'}-${scenario.month || 'unset'}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
