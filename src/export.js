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
  ['Perks', 'perks'], ['Off + Bonus', 'offBonus'], ['PM off', 'pmOff'],   // PM off: v1.1.0
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
  return scenario.residents.filter(r => (r.commitments ?? []).some(c => c.date === date)).map(r => clinicLabel(r, date));
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

// Totals sit on top of the bonus grid (v1.2.0). Shifts / Bonus / Perks / Off + Bonus are live formulas over
// the grid's tick boxes (green headers); every other column is the solved, static number.
const LIVE_COLS = new Set(['shifts', 'bonus', 'perks', 'offBonus']);
const LIVE_FILL = 'FFC6E0B4';
const BAND_FILL = 'FFD6E7F5';
const CONFLICT_FILL = 'FFFF0000';
const THIN = { style: 'thin', color: { argb: 'FF7F7F7F' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const totalsCol = key => TOTALS_START_COL + TOTALS_COLS.findIndex(([, k]) => k === key);
function colLetter(col) {
  let s = '';
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
const colRef = (col, row) => `${colLetter(col)}${row}`;
function styleBox(cell, { bold = false, argb = null, align = 'center' } = {}) {
  cell.border = BORDER;
  cell.alignment = { horizontal: align, vertical: 'middle', wrapText: true };
  if (bold) cell.font = { ...(cell.font ?? {}), bold: true };
  if (argb) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function writeTotals(ws, schedule, top) {
  TOTALS_COLS.forEach(([label, key], i) => {
    const cell = ws.getCell(top, TOTALS_START_COL + i);
    cell.value = label;
    styleBox(cell, { bold: true, argb: LIVE_COLS.has(key) ? LIVE_FILL : FILLS.TYPE });
  });
  let row = top + 1;
  for (const [name, t] of Object.entries(schedule.totals)) {
    const data = { ...t, name, offBonus: t.off + t.bonus };
    TOTALS_COLS.forEach(([, col], i) => {
      const cell = ws.getCell(row, TOTALS_START_COL + i);
      cell.value = col === 'didactics'
        ? (t.didacticsOf == null ? t.didactics : `${t.didactics} / ${t.didacticsOf}`) : data[col] ?? '—';
      styleBox(cell, col === 'name' ? { bold: true, align: 'left' } : {});
    });
    row++;
  }
}

// v1.2.0 bonus grid: one row per date, AM / PM / Day tick boxes per resident, under the totals. Ticks are
// booleans (Google Sheets: select them, Insert > Checkbox); "x" also counts so Excel users can type it.
// A Day tick = Bonus +1, Shifts -1; an AM/PM tick = Perks +1, Shifts -0.5. Existing offFree / halfOff pins
// are pre-ticked and added back into the Shifts base, so the untouched sheet shows exactly the solved totals.
function writeBonusGrid(ws, scenario, schedule, dates, top) {
  const names = Object.keys(schedule.totals);
  const byName = new Map(scenario.residents.map(r => [r.name, r]));
  const pins = scenario.pins ?? [];
  const titleRow = top + names.length + 2;
  const head1 = titleRow + 1, head2 = titleRow + 2, first = titleRow + 3, last = first + dates.length - 1;
  const dateCol = TOTALS_START_COL;
  const helperCol = dateCol + 1 + 3 * names.length;
  const keyCol = helperCol + 1;   // hidden "|A|B|" list the conflict rule searches
  const tick = ref => `OR(${ref}=TRUE,${ref}="x")`;
  const count = range => `(COUNTIF(${range},TRUE)+COUNTIF(${range},"x"))`;

  ws.mergeCells(titleRow, dateCol, titleRow, helperCol);
  const title = ws.getCell(titleRow, dateCol);
  title.value = 'Bonus days given: tick Day = bonus day off, AM / PM = half day (perk). '
    + 'Totals above update. Google Sheets: select the boxes, Insert > Checkbox.';
  title.font = { bold: true };
  title.alignment = { vertical: 'middle', wrapText: true };

  ws.mergeCells(head1, dateCol, head2, dateCol);
  ws.getCell(head1, dateCol).value = 'Date';
  ws.mergeCells(head1, helperCol, head2, helperCol);
  ws.getCell(head1, helperCol).value = 'Already off / PTO';

  dates.forEach((date, i) => {
    const row = first + i;
    const dow = dowOf(date);
    const cell = ws.getCell(row, dateCol);
    cell.value = `${DOW3[dow]} ${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
    styleBox(cell, { align: 'left' });
    if (dow === 0 || dow === 6) cell.font = { bold: true, italic: true };
    // Pinned bonus days are pre-ticked below, so they are not "already off" (that tick is the day off itself).
    const off = (schedule.days[date]?.off ?? []).filter(n => !isBonusOff(scenario, n, date));
    const pto = ptoNames(scenario, date);
    const helper = ws.getCell(row, helperCol);
    helper.value = [...off, ...pto.map(n => `PTO: ${n}`)].join(', ');
    styleBox(helper, { align: 'left' });
    helper.font = { italic: true, color: { argb: 'FF595959' } };
    ws.getCell(row, keyCol).value = `|${[...off, ...pto].join('|')}|`;
  });
  ws.getColumn(keyCol).hidden = true;

  names.forEach((name, k) => {
    const c0 = dateCol + 1 + 3 * k;                                  // AM, PM, Day
    const band = k % 2 === 1 ? BAND_FILL : null;
    ws.mergeCells(head1, c0, head1, c0 + 2);
    ws.getCell(head1, c0).value = name;
    ['AM', 'PM', 'Day'].forEach((h, j) => { ws.getCell(head2, c0 + j).value = h; });

    const r = byName.get(name);
    let ticked = 0;                                                  // shift-equivalents pre-ticked from pins
    dates.forEach((date, i) => {
      const row = first + i;
      const mine = pins.filter(p => p.person === name && p.date === date);
      const on = !r || onService(r, date);
      const marks = [
        mine.some(p => p.type === 'halfOff' && (p.half ?? 'PM') === 'AM'),
        mine.some(p => p.type === 'halfOff' && (p.half ?? 'PM') === 'PM'),
        mine.some(p => p.type === 'offFree'),
      ];
      marks.forEach((m, j) => {
        const cell = ws.getCell(row, c0 + j);
        const live = on || m;
        styleBox(cell, { argb: live ? band : FILLS.BLANK });
        if (live) cell.value = m;
        if (m) ticked += j === 2 ? 1 : 0.5;
      });
    });

    const range = j => `${colRef(c0 + j, first)}:${colRef(c0 + j, last)}`;
    const t = schedule.totals[name];
    const row = top + 1 + k;
    ws.getCell(row, totalsCol('shifts')).value = {
      formula: `${t.shifts + ticked}-${count(range(2))}-0.5*(${count(range(0))}+${count(range(1))})`,
      result: t.shifts,
    };
    ws.getCell(row, totalsCol('bonus')).value = { formula: count(range(2)), result: t.bonus };
    ws.getCell(row, totalsCol('perks')).value =
      { formula: `${count(range(0))}+${count(range(1))}`, result: t.perks };
    ws.getCell(row, totalsCol('offBonus')).value = {
      formula: `${colRef(totalsCol('off'), row)}+${colRef(totalsCol('bonus'), row)}`, result: t.off + t.bonus,
    };

    // Red flag: a tick on a day this resident is already off / on PTO, or Day plus a half day on one date.
    const tl = colRef(c0, first);
    const key = `$${colLetter(keyCol)}${first}`;
    const lit = `"|${name.replace(/"/g, '""')}|"`;
    const [am, pm, day] = [0, 1, 2].map(j => `$${colLetter(c0 + j)}${first}`);
    const style = { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: CONFLICT_FILL } } };
    ws.addConditionalFormatting({
      ref: `${tl}:${colRef(c0 + 2, last)}`,
      rules: [
        { type: 'expression', priority: 1, formulae: [`AND(${tick(tl)},ISNUMBER(SEARCH(${lit},${key})))`], style },
        { type: 'expression', priority: 2,
          formulae: [`AND(${tick(tl)},${tick(day)},OR(${tick(am)},${tick(pm)}))`], style },
      ],
    });
  });
  for (let c = dateCol; c <= helperCol; c++) for (const r of [head1, head2]) {
    const cell = ws.getCell(r, c);
    styleBox(cell, { bold: true, argb: FILLS.TYPE });
  }
  return { helperCol, keyCol };
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

function formatSheet(ws, grid) {
  ws.getColumn(1).width = 14;
  for (let col = 2; col <= 8; col++) ws.getColumn(col).width = 22;
  ws.getColumn(9).width = 2;
  const totalsWidths = [20, 10, 10, 10, 14, 10, 10, 10, 10, 14, 10];
  totalsWidths.forEach((width, i) => { ws.getColumn(TOTALS_START_COL + i).width = width; });
  for (let col = TOTALS_START_COL + totalsWidths.length; col < grid.helperCol; col++) ws.getColumn(col).width = 8;
  ws.getColumn(grid.helperCol).width = 22;

  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1, topLeftCell: 'B2', activeCell: 'B2' }];
  ws.pageSetup = {
    orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    paperSize: 9, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };
  ws.getRow(1).height = 24;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.eachRow(row => row.eachCell((cell, col) => {
    if (col >= TOTALS_START_COL) return;   // totals + bonus grid set their own centred alignment
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
  const grid = writeBonusGrid(ws, scenario, schedule, dates, top);
  writeNotes(ws, scenario, auditResult, afterCalendar);
  formatSheet(ws, grid);
}

// The live totals carry cached results; still have Excel recompute them on open.
function newWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.calcProperties = { ...wb.calcProperties, fullCalcOnLoad: true };
  return wb;
}

export async function buildWorkbook(scenario, schedule, auditResult, version) {
  const wb = newWorkbook();
  fillSheet(wb.addWorksheet(scenario.anchorType || 'Schedule'), scenario, schedule, auditResult, version);
  return wb;
}

// Every solution in one workbook, a sheet each ("Solution 1".."Solution N"), in tab order.
// entries: [{ schedule, auditResult, headerLines }] — headerLines empty for Solution 1.
export async function buildAllSolutionsWorkbook(scenario, entries, version) {
  const wb = newWorkbook();
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
