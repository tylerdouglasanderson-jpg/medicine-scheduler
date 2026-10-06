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
const MR_FONT = 'FF7030A0';  // Morning-Report label — matches the app's --cal-mr
const ROW_HEIGHTS = { DATE: 20, TYPE: 36, ROUNDERS: 72, PAGER: 34, CLINIC: 42, DIDACTICS: 42, PTO: 42, OFF: 42 };

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

function writeCalendar(ws, scenario, schedule, types, dates, firstDow, mrDays, top) {
  let row = top;
  for (const week of buildWeeks(dates, firstDow)) {
    for (const label of ROWS) {
      const rowIdx = row++;
      ws.getRow(rowIdx).height = ROW_HEIGHTS[label];
      ws.getCell(rowIdx, 1).value = label;
      week.forEach((date, ci) => {
        const cell = ws.getCell(rowIdx, ci + 2);
        if (date == null) { fill(cell, FILLS.BLANK); return; }
        const type = types.get(date);
        const dd = schedule.days[date];
        cell.value = cellText(label, date, type, dd, scenario, schedule);
        const fillKey = label === 'TYPE' && type === 'call' ? 'CALL' : label;
        if (FILLS[fillKey]) fill(cell, FILLS[fillKey]);
        // Morning Report: this team presents (pre-call team on Tue/Thu).
        if (label === 'TYPE' && mrDays.has(date)) {
          cell.value = `${cell.value}\nMORNING REPORT`;
          cell.font = { bold: true, color: { argb: MR_FONT } };
        }
      });
    }
  }
  return row; // first row after the calendar
}

function writeTotals(ws, schedule, top) {
  TOTALS_COLS.forEach(([label], i) => { ws.getCell(top, TOTALS_START_COL + i).value = label; });
  let row = top + 1;
  for (const [name, t] of Object.entries(schedule.totals)) {
    const data = { ...t, name, offBonus: t.off + t.bonus };
    TOTALS_COLS.forEach(([, col], i) => {
      ws.getCell(row, TOTALS_START_COL + i).value = col === 'didactics'
        ? (t.didacticsOf == null ? t.didactics : `${t.didactics} / ${t.didacticsOf}`) : data[col];
    });
    row++;
  }
}

function writeNotes(ws, scenario, auditResult, startRow) {
  let row = startRow + 1;
  const line = (value, bold = false) => {
    ws.mergeCells(row, 1, row, 8);
    const cell = ws.getCell(row, 1);
    cell.value = value;
    cell.font = bold ? { bold: true } : undefined;
    ws.getRow(row).height = bold ? 24 : 36;
    row++;
  };
  line('Notes', true);
  line('MORNING REPORT = this team presents (pre-call team, Tue & Thu).');
  for (const r of scenario.residents) {
    if (!r.didactics) continue;
    const stop = r.didactics.hard ? 'hard stop' : 'soft stop';
    line(`${r.name}: ${DOW_NAMES[r.didactics.dow]} didactics (${stop})`);
  }
  row++;
  line('Potential Issues', true);
  for (const w of auditResult.warnings)
    line(w.date ? `${w.date}: ${w.message}` : w.message);
}

function formatSheet(ws) {
  ws.getColumn(1).width = 14;
  for (let col = 2; col <= 8; col++) ws.getColumn(col).width = 22;
  ws.getColumn(9).width = 2;
  const totalsWidths = [20, 10, 10, 10, 14, 10, 10, 10, 10, 14];
  totalsWidths.forEach((width, i) => { ws.getColumn(TOTALS_START_COL + i).width = width; });

  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1, topLeftCell: 'B2', activeCell: 'B2' }];
  ws.pageSetup = {
    orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    paperSize: 9, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };
  ws.getRow(1).height = 24;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.eachRow(row => row.eachCell(cell => {
    cell.alignment = { ...cell.alignment, vertical: 'top', wrapText: true };
  }));
}

// One schedule onto one worksheet. `headerLines` (an alternative's "how it differs from Solution 1")
// sit between the title row and the calendar; with none, the sheet is exactly the single export.
function fillSheet(ws, scenario, schedule, auditResult, version, headerLines = []) {
  const { types, morningReportDays } = deriveCycle(scenario.anchorType, scenario.month);
  const dates = monthDates(scenario.month);
  const [Y, M] = scenario.month.split('-').map(Number);
  const firstDow = new Date(Y, M - 1, 1).getDay();

  ws.getCell(1, 1).value = `${MONTH_NAMES[M - 1]} ${Y}  ${DOW_NAMES[firstDow].toUpperCase()}  —  built ${version}`;
  ws.mergeCells('A1:H1');
  headerLines.forEach((text, i) => {
    ws.mergeCells(2 + i, 1, 2 + i, 8);
    ws.getCell(2 + i, 1).value = text;
    ws.getCell(2 + i, 1).font = { italic: true };
    ws.getRow(2 + i).height = 20;
  });
  const top = 2 + headerLines.length;

  const afterCalendar = writeCalendar(ws, scenario, schedule, types, dates, firstDow,
    new Set(morningReportDays), top);
  writeTotals(ws, schedule, top);
  writeNotes(ws, scenario, auditResult, afterCalendar);
  formatSheet(ws);
}

export async function buildWorkbook(scenario, schedule, auditResult, version) {
  const wb = new ExcelJS.Workbook();
  fillSheet(wb.addWorksheet(scenario.anchorType || 'Schedule'), scenario, schedule, auditResult, version);
  return wb;
}

// Every solution in one workbook, a sheet each ("Solution 1".."Solution N"), in tab order.
// entries: [{ schedule, auditResult, headerLines }] — headerLines empty for Solution 1.
export async function buildAllSolutionsWorkbook(scenario, entries, version) {
  const wb = new ExcelJS.Workbook();
  entries.forEach(({ schedule, auditResult, headerLines }, i) =>
    fillSheet(wb.addWorksheet(`Solution ${i + 1}`), scenario, schedule, auditResult, version, headerLines));
  return wb;
}

async function downloadWorkbook(wb, filename) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const baseName = scenario => `${scenario.team || 'schedule'}-${scenario.month || 'unset'}`;

export async function downloadXlsx(scenario, schedule, auditResult) {
  await downloadWorkbook(await buildWorkbook(scenario, schedule, auditResult, __BUILD_VERSION__),
    `${baseName(scenario)}.xlsx`);
}

export async function downloadAllXlsx(scenario, entries) {
  await downloadWorkbook(await buildAllSolutionsWorkbook(scenario, entries, __BUILD_VERSION__),
    `${baseName(scenario)}-all-solutions.xlsx`);
}
