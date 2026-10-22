// Styled xlsx export (mirrors the calendar.js week-block sheet) + browser download wrapper.
// Independent cell-text logic (small duplication of calendar.js's per-row rules is deliberate —
// this module targets an ExcelJS workbook, not the DOM, and Task 9's scope is export.js only).
/* global __BUILD_VERSION__ */
import ExcelJS from 'exceljs';
import { deriveCycle, didacticsOn, monthDates, onService } from './model.js';

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
  ['Resident', 'name'], ['Shifts', 'shifts'], ['Pager', 'pager'], ['Clinic/Obligation', 'clinic'],
  ['Didactics', 'didactics'], ['Off', 'off'], ['PTO', 'pto'], ['Days', 'bonus'],   // v1.3.0: Bonus -> Days
  ['Perks (half days)', 'perks'], ['Off + Bonus', 'offBonus'], ['PM off', 'pmOff'],   // PM off: v1.1.0
];
const TOTALS_START_COL = 10; // column J
const MR_FONT = 'FF7030A0';  // Morning-Report label — matches the app's --cal-mr
// Row height follows the text: the bonus-tick grid shares these rows, so fixed tall heights made the grid (and
// Google Sheets, which keeps them verbatim) look stretched. One line = 20, each extra wrapped line adds 15.
const ROW_MIN = 20, LINE_H = 15, CHARS_PER_LINE = 22;
const textLines = text => String(text ?? '').split('\n')
  .reduce((n, part) => n + Math.max(1, Math.ceil(part.length / CHARS_PER_LINE)), 0);
const heightFor = lines => Math.max(ROW_MIN, lines * LINE_H + 5);

const dowOf = date => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };

function fill(cell, argb) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
  cell.alignment = { vertical: 'top', wrapText: true };
}

function halfOffPins(scenario, person, date) {
  return (scenario.pins ?? []).filter(p => p.type === 'halfOff' && p.person === person && p.date === date);
}
// AM and PM both pinned the same day: one line, tagged so the Perks formula can count the second half.
const BOTH_HALVES = ' (AM+PM)';
function halfOffTag(scenario, person, date) {
  const halves = new Set(halfOffPins(scenario, person, date).map(p => p.half ?? 'PM'));
  return halves.size === 0 ? '' : ` - 1/2 off${halves.size > 1 ? BOTH_HALVES : ''}`;
}
function isBonusOff(scenario, person, date) {
  return (scenario.pins ?? []).some(p => p.type === 'offFree' && p.person === person && p.date === date)
    || (scenario.singleDays ?? []).some(x => x.date === date);
}
function rounderLines(date, type, dd, scenario) {
  const lines = [];
  if (type === 'call') {
    for (const n of dd.working.filter(n => n !== dd.night)) lines.push(`Day - ${n}`);
    if (dd.night) lines.push(`Night - ${dd.night}`);
  } else if (type === 'postcall') {
    for (const n of dd.working) lines.push(`${n} (postcall)`);
  } else {
    for (const n of dd.working) lines.push(`${n}${halfOffTag(scenario, n, date)}`);
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
  return scenario.residents
    .filter(r => didacticsOn(r, date) && onService(r, date))
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
  // Weekday header above the weeks (columns B..H are always Sun..Sat); the calendar proper starts one row down.
  ws.getRow(top).height = 20;
  DOW_NAMES.forEach((name, ci) => {
    const cell = ws.getCell(top, ci + 2);
    cell.value = name;
    cell.font = { bold: true };
    fill(cell, FILLS.TYPE);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  top += 1;
  let row = top;
  for (const week of buildWeeks(dates, firstDow)) {
    for (const label of ROWS) {
      const rowIdx = row++;
      let lines = 1;
      ws.getCell(rowIdx, 1).value = label;
      week.forEach((date, ci) => {
        const cell = ws.getCell(rowIdx, ci + 2);
        if (date == null) { fill(cell, FILLS.BLANK); return; }
        const type = types.get(date);
        const dd = schedule.days[date];
        cell.value = cellText(label, date, type, dd, scenario, schedule);
        lines = Math.max(lines, textLines(cell.value));
        const fillKey = label === 'TYPE' && type === 'call' ? 'CALL' : label;
        if (FILLS[fillKey]) fill(cell, FILLS[fillKey]);
        // Morning Report: this team presents (pre-call team on Tue/Thu).
        if (label === 'TYPE' && mrDays.has(date)) {
          cell.value = `${cell.value}\nMORNING REPORT`;
          lines = Math.max(lines, textLines(cell.value));
          cell.font = { bold: true, color: { argb: MR_FONT } };
        }
      });
      ws.getRow(rowIdx).height = heightFor(lines);
    }
  }
  return row; // first row after the calendar
}

// v1.3.0: every number in the totals box is a live formula. Counts read the calendar block above (so a hand
// edit to a cell moves them) and the Days / Perks columns also add the AM / PM / Day tick boxes in the grid.
// Resident names are matched with SEARCH, so one name inside another would double count; fillSheet warns.
const LIVE_FILL = 'FFC6E0B4';
const INPUT_FILL = 'FFFFE699';
const BAND_FILL = 'FFD6E7F5';
const CONFLICT_FILL = 'FFFF0000';
const TODAY_DATE_FILL = 'FFB4A7D6';  // today's DATE cell (lavender, bold; echoes the Morning Report purple)
const TODAY_DAY_FILL = 'FFD9D2E9';   // the rest of today's column (pale, keeps the text legible)
const THIN = { style: 'thin', color: { argb: 'FF7F7F7F' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LIST = '{"Sun","Mon","Tue","Wed","Thu","Fri","Sat"}';
const DAY_HELPER_COL = TOTALS_START_COL + TOTALS_COLS.length;   // "Didactics day" input, one past PM off
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

// Where the grid sits: under the header, one row per resident and a blank row.
function gridGeometry(n, top, nDates) {
  const titleRow = top + n + 2;
  const first = titleRow + 3;
  return { titleRow, head1: titleRow + 1, head2: titleRow + 2, first, last: first + nDates - 1 };
}
const tickCol = (k, j) => TOTALS_START_COL + 1 + 3 * k + j;   // j: 0 AM, 1 PM, 2 Day

// Names that sit inside another name (SEARCH would count them twice).
export function nameOverlaps(names) {
  const out = [];
  for (const a of names) for (const b of names)
    if (a !== b && a.trim() && a.toLowerCase().includes(b.trim().toLowerCase())) out.push(`${b} is inside ${a}`);
  return out;
}

// Formulas for one resident's row. `cal` is the calendar's first / last row; calendar rows run
// DATE TYPE ROUNDERS PAGER CLINIC DIDACTICS PTO OFF, so TYPE = a+1 ... and the other rows are fixed offsets.
function residentFormulas(cal, geo, row, k, { hasDidactics, didacticsOf = null }) {
  const { a, z } = cal;
  const name = `$${colLetter(TOTALS_START_COL)}${row}`;
  const day = `$${colLetter(DAY_HELPER_COL)}${row}`;
  const labels = `$A$${a}:$A$${z}`;
  const rng = (lo, hi) => `$B$${lo}:$H$${hi}`;
  const count = (label, tag = '') =>
    `SUMPRODUCT((${labels}="${label}")*ISNUMBER(SEARCH(${name}${tag ? `&"${tag}"` : ''},${rng(a, z)})))`;
  const ticks = j => {
    const L = colLetter(tickCol(k, j));
    const rg = `${L}$${geo.first}:${L}$${geo.last}`;
    return `(COUNTIF(${rg},"?*")+COUNTIF(${rg},TRUE))`;   // any text, or a ticked checkbox
  };
  const dayIs = (lo, hi) => `COLUMN(${rng(lo, hi)})-1`;
  const dayIdx = `MATCH(${day},${DAY_LIST},0)`;
  const typeRows = [a + 1, z - 6];                       // TYPE rows, B..H
  const typeCell = `${rng(...typeRows)}`;
  const notCall = `(${typeCell}<>"CALL")*(${typeCell}<>"PC")`;
  const attended = count('DIDACTICS');
  // The "of N" counts the weekday's days on service; the calendar cannot show a split-seat window, so a
  // resident who is not on service all month gets the solver's N as a constant.
  const didactics = !hasDidactics ? attended : didacticsOf != null
    ? `${attended}&" / "&${didacticsOf}`
    : `${attended}&" / "&SUMPRODUCT(($A$${a + 1}:$A$${z - 6}="TYPE")`
      + `*(${typeCell}<>"")*${notCall}*(${dayIs(...typeRows)}=${dayIdx})`
      + `*(1-ISNUMBER(SEARCH(${name},${rng(a + 6, z - 1)}))))`;
  const pmOff = `SUMPRODUCT((${`$A$${a + 2}:$A$${z - 5}`}="ROUNDERS")*ISNUMBER(SEARCH(${name},${rng(a + 2, z - 5)}))`
    + `*${notCall}*(1-ISNUMBER(SEARCH(${name},${rng(a + 3, z - 4)})))*(1-ISNUMBER(SEARCH(${name},${rng(a + 4, z - 3)})))`
    + `${hasDidactics ? `*(${dayIs(a + 2, z - 5)}<>${dayIdx})` : ''})`;
  const offCol = colRef(totalsCol('off'), row), bonusCol = colRef(totalsCol('bonus'), row), perksCol = colRef(totalsCol('perks'), row);
  return {
    shifts: `${count('ROUNDERS')}-0.5*${count('ROUNDERS', ' - 1/2 off')}-${ticks(2)}-0.5*(${ticks(0)}+${ticks(1)})`,
    pager: count('PAGER'),
    clinic: count('CLINIC'),
    didactics,
    off: `${count('OFF')}-${count('OFF', ' (bonus)')}`,
    pto: count('PTO'),
    bonus: `${ticks(2)}+${count('OFF', ' (bonus)')}`,
    perks: `${ticks(0)}+${ticks(1)}+${count('ROUNDERS', ' - 1/2 off')}+${count('ROUNDERS', ` - 1/2 off${BOTH_HALVES}`)}`,
    offBonus: `${offCol}+${bonusCol}+0.5*${perksCol}`,   // a half day counts as half
    pmOff,
  };
}

function writeTotals(ws, scenario, schedule, dates, top, cal, geo) {
  TOTALS_COLS.forEach(([label, key], i) => {
    const cell = ws.getCell(top, TOTALS_START_COL + i);
    cell.value = label;
    styleBox(cell, { bold: true, argb: key === 'name' ? FILLS.TYPE : LIVE_FILL });
  });
  // "Bonus/Off" sits over the two columns that come from the grid (Days = full days, Perks = half days).
  ws.mergeCells(top - 1, totalsCol('bonus'), top - 1, totalsCol('perks'));
  const over = ws.getCell(top - 1, totalsCol('bonus'));
  over.value = 'Bonus/Off';
  styleBox(over, { bold: true, argb: FILLS.TYPE });
  const dh = ws.getCell(top, DAY_HELPER_COL);
  dh.value = 'Didactics day';
  styleBox(dh, { bold: true, argb: INPUT_FILL });

  const byName = new Map(scenario.residents.map(r => [r.name, r]));
  const names = Object.keys(schedule.totals);
  names.forEach((name, k) => {
    const t = schedule.totals[name];
    const r = byName.get(name);
    const row = top + 1 + k;
    const fullMonth = !r || (r.serviceStart <= dates[0] && r.serviceEnd >= dates.at(-1));
    const f = residentFormulas(cal, geo, row, k,
      { hasDidactics: !!r?.didactics, didacticsOf: fullMonth ? null : t.didacticsOf });
    ws.getCell(row, TOTALS_START_COL).value = name;
    styleBox(ws.getCell(row, TOTALS_START_COL), { bold: true, align: 'left' });
    const values = {
      shifts: t.shifts, pager: t.pager, clinic: t.clinic, off: t.off, pto: t.pto, bonus: t.bonus,
      perks: t.perks, offBonus: t.off + t.bonus + 0.5 * t.perks, pmOff: t.pmOff ?? 0,
      didactics: t.didacticsOf == null ? t.didactics : `${t.didactics} / ${t.didacticsOf}`,
    };
    for (const [key, formula] of Object.entries(f)) {
      const cell = ws.getCell(row, totalsCol(key));
      cell.value = { formula, result: values[key] };
      styleBox(cell);
    }
    const day = ws.getCell(row, DAY_HELPER_COL);
    day.value = r?.didactics ? DOW3[r.didactics.dow] + (r.didactics.alt ? ' (alt)' : '') : '';
    styleBox(day, { argb: INPUT_FILL });
  });
}

// Bonus grid: one row per date, AM / PM / Day tick boxes per resident, under the totals. Boxes start empty;
// any entry (an "x", or a checkbox ticked TRUE) counts. A Day tick adds
// a Days (bonus day off) and takes a Shift; an AM/PM tick adds a Perk (half day) and takes half a Shift. The
// grid starts empty: days already given are in the calendar as "(bonus)" / "1/2 off" and counted from there.
function writeBonusGrid(ws, scenario, schedule, dates, geo) {
  const names = Object.keys(schedule.totals);
  const byName = new Map(scenario.residents.map(r => [r.name, r]));
  const { titleRow, head1, head2, first } = geo;
  const dateCol = TOTALS_START_COL;
  const helperCol = dateCol + 1 + 3 * names.length;
  const keyCol = Math.max(helperCol, DAY_HELPER_COL) + 1;   // hidden "|A|B|" list the conflict rule searches
  const tick = ref => `AND(${ref}<>"",${ref}<>FALSE)`;

  ws.mergeCells(titleRow, dateCol, titleRow, helperCol);
  const title = ws.getCell(titleRow, dateCol);
  title.value = 'Bonus days: put an X in each box where a day or half day was given. Totals update.';
  title.font = { bold: true };
  title.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  ws.getRow(titleRow).height = 22;

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
    const off = schedule.days[date]?.off ?? [];
    const pto = ptoNames(scenario, date);
    const helper = ws.getCell(row, helperCol);
    helper.value = [...off, ...pto.map(n => `PTO: ${n}`)].join(', ');
    styleBox(helper, { align: 'left' });
    helper.font = { italic: true, color: { argb: 'FF595959' } };
    ws.getCell(row, keyCol).value = `|${[...off, ...pto].join('|')}|`;
  });
  ws.getColumn(keyCol).hidden = true;

  names.forEach((name, k) => {
    const c0 = tickCol(k, 0);                                        // AM, PM, Day
    const band = k % 2 === 1 ? BAND_FILL : null;
    ws.mergeCells(head1, c0, head1, c0 + 2);
    ws.getCell(head1, c0).value = name;
    ['AM', 'PM', 'Day'].forEach((h, j) => { ws.getCell(head2, c0 + j).value = h; });

    const r = byName.get(name);
    dates.forEach((date, i) => {
      const row = first + i;
      const on = !r || onService(r, date);
      for (let j = 0; j < 3; j++) {
        const cell = ws.getCell(row, c0 + j);
        styleBox(cell, { argb: on ? band : FILLS.BLANK });
      }
    });

    // Red flag: a tick on a day this resident is already off / on PTO, or Day plus a half day on one date.
    const tl = colRef(c0, first);
    const key = `$${colLetter(keyCol)}${first}`;
    const lit = `"|${name.replace(/"/g, '""')}|"`;
    const [am, pm, day] = [0, 1, 2].map(j => `$${colLetter(c0 + j)}${first}`);
    const style = { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: CONFLICT_FILL } } };
    ws.addConditionalFormatting({
      ref: `${tl}:${colRef(c0 + 2, geo.last)}`,
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

function writeNotes(ws, scenario, auditResult, startRow, overlaps = []) {
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
    line(r.didactics.alt ? `${r.name}: Wednesday didactics, every other week (${(r.didactics.dates ?? []).length} picked, ${stop})` : `${r.name}: ${DOW_NAMES[r.didactics.dow]} didactics (${stop})`);
  }
  if (overlaps.length) line(`Name overlap (the live totals match names as text and will double count): ${overlaps.join('; ')}`);
  // Potential Issues stay on the solution page only (program rule, 2026-10); the spreadsheet carries no flags.
}

function formatSheet(ws, grid) {
  ws.getColumn(1).width = 14;
  for (let col = 2; col <= 8; col++) ws.getColumn(col).width = 22;
  ws.getColumn(9).width = 2;
  const totalsWidths = [20, 10, 10, 14, 14, 10, 10, 10, 14, 14, 10, 12];
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

// Conditional format: today's day in the calendar (the DATE cell darker and bold, the rest of that day's
// 8-row column pale). Live formulas, so the highlight moves each day; only the month shown in A1 lights up.
// Excel and Google Sheets both ignore a conditional border here, so shading is the only marker.
function highlightToday(ws, top, last) {
  const thisMonth = 'LEFT($A$1,LEN(TEXT(TODAY(),"MMMM YYYY")))=TEXT(TODAY(),"MMMM YYYY")';
  const dayOf = `IFERROR(VALUE(INDEX($B$1:$H$${last},ROW()-MOD(ROW()-${top},8),COLUMN()-1)&""),0)=DAY(TODAY())`;
  const style = argb => ({ fill: { type: 'pattern', pattern: 'solid', bgColor: { argb } } });
  ws.addConditionalFormatting({
    ref: `B${top}:H${last}`,
    rules: [
      { type: 'expression', priority: 1, formulae: [`AND(MOD(ROW()-${top},8)=0,${thisMonth},${dayOf})`],
        style: { ...style(TODAY_DATE_FILL), font: { bold: true } } },
      { type: 'expression', priority: 2, formulae: [`AND(${thisMonth},${dayOf})`], style: style(TODAY_DAY_FILL) },
    ],
  });
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
  const cal = { a: top + 1, z: afterCalendar - 1 };   // +1: the weekday header row sits at `top`
  highlightToday(ws, top + 1, afterCalendar - 1);
  const geo = gridGeometry(Object.keys(schedule.totals).length, top, dates.length);
  writeTotals(ws, scenario, schedule, dates, top, cal, geo);
  const grid = writeBonusGrid(ws, scenario, schedule, dates, geo);
  writeNotes(ws, scenario, auditResult, afterCalendar, nameOverlaps(Object.keys(schedule.totals)));
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
