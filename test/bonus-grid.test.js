// v1.2.0 xlsx bonus grid: AM / PM / Day tick boxes under the totals drive live Shifts / Bonus / Perks /
// Off + Bonus formulas. A tiny evaluator below re-computes the formulas after flipping ticks, so these tests
// check the arithmetic a chief will see, not just the formula text.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { buildWorkbook, buildAllSolutionsWorkbook } from '../src/export.js';
import { solve } from '../src/solve.js';
import { audit } from '../src/audit.js';
import { parseScenario, monthDates, onService } from '../src/model.js';

const load = f => parseScenario(JSON.parse(readFileSync(new URL(`../scenarios/${f}`, import.meta.url), 'utf8')));
const CASES = [
  '08-with-pins-medF.json',                    // pins
  '12-two-person-1s1i-medE.json',              // 2-person team
  '20-two-person-31day-sc1-golden.json',       // 31-day month
  '24-split-seat-intern-and-senior.json',      // split-seat on-service windows
  '25-heavy-staggered-pto-1s3i.json',          // 4-person team
  '27-every-pin-type-and-attending-days.json', // offFree + halfOff pins
];

const addr = (c, r) => { let s = ''; for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s + r; };
const ticked = v => v === true || v === 'x';
function cellsIn(ws, range) {
  const [a, b] = range.split(':').map(x => ws.getCell(x));
  const out = [];
  for (let r = a.row; r <= b.row; r++) for (let c = a.col; c <= b.col; c++) out.push(ws.getCell(r, c).value);
  return out;
}
// Evaluates the only shapes the exporter writes: numbers, + - *, parentheses, COUNTIF(range,TRUE|"x"), cell refs.
function evaluate(ws, ref) {
  const v = ws.getCell(ref).value;
  if (v == null || typeof v !== 'object' || !('formula' in v)) return v;
  const expr = v.formula
    .replace(/COUNTIF\(([A-Z]+\d+:[A-Z]+\d+),(TRUE|"x")\)/g, (_, rg, crit) =>
      String(cellsIn(ws, rg).filter(x => (crit === 'TRUE' ? x === true : x === 'x')).length))
    .replace(/\b[A-Z]{1,2}\d+\b/g, m => String(evaluate(ws, m)));
  return Function(`return (${expr})`)();
}
function locate(ws, top = 2) {
  let row = top;
  const header = {};
  for (let c = 10; c <= 20; c++) header[ws.getCell(top, c).value] = c;
  const residents = [];
  while (ws.getCell(++row, 10).value && ws.getCell(row, 10).value !== '') residents.push({ name: ws.getCell(row, 10).value, row });
  const head1 = top + residents.length + 3;
  return { header, residents, head1, first: head1 + 2 };
}

async function exportCase(file) {
  const s = load(file);
  s.lastSolution = null;
  const { schedule } = await solve(s);
  const wb = await buildWorkbook(s, schedule, audit(s, schedule), 'test');
  return { s, schedule, ws: wb.worksheets[0], wb };
}

describe('xlsx bonus grid', () => {
  for (const file of CASES) {
    it(`${file}: untouched grid reproduces the solved totals; ticks move them correctly`, async () => {
      const { s, schedule, ws } = await exportCase(file);
      const dates = monthDates(s.month);
      const { header, residents, head1, first } = locate(ws);
      const names = Object.keys(schedule.totals);
      expect(residents.map(r => r.name)).toEqual(names);

      // shape: one row per date, 3 columns per resident + date + helper
      expect(ws.getCell(head1, 10).value).toBe('Date');
      expect(ws.getCell(head1, 11 + 3 * names.length).value).toBe('Already off / PTO');
      expect(String(ws.getCell(first + dates.length - 1, 10).value)).toMatch(new RegExp(` ${Number(dates.at(-1).slice(5, 7))}/${Number(dates.at(-1).slice(8))}$`));
      expect(ws.getCell(first + dates.length, 10).value).toBeNull();

      for (const [k, { name, row }] of residents.entries()) {
        const t = schedule.totals[name];
        const r = s.residents.find(x => x.name === name);
        const get = key => evaluate(ws, addr(header[key], row));
        // untouched sheet == solver numbers (pins pre-ticked, added back into the Shifts base)
        expect(get('Shifts')).toBeCloseTo(t.shifts, 9);
        expect(get('Bonus')).toBe(t.bonus);
        expect(get('Perks')).toBe(t.perks);
        expect(get('Off + Bonus')).toBe(t.off + t.bonus);
        expect(ws.getCell(row, header.Shifts).value.result).toBe(t.shifts);

        // off-service cells are blank + grey; on-service ones hold a boolean
        dates.forEach((d, i) => {
          const v = ws.getCell(first + i, 11 + 3 * k).value;
          if (onService(r, d)) expect(typeof v).toBe('boolean');
        });

        // tick a free Day box and a free PM box on service days; untick a pre-ticked one if any
        const freeRow = dates.findIndex((d, i) => onService(r, d) && [0, 1, 2].every(j => ws.getCell(first + i, 11 + 3 * k + j).value === false));
        if (freeRow < 0) continue;
        ws.getCell(first + freeRow, 13 + 3 * k).value = true;           // Day
        const freeRow2 = dates.findIndex((d, i) => i !== freeRow && onService(r, d) && ws.getCell(first + i, 12 + 3 * k).value === false);
        ws.getCell(first + freeRow2, 12 + 3 * k).value = 'x';            // PM, typed as x
        expect(get('Shifts')).toBeCloseTo(t.shifts - 1.5, 9);
        expect(get('Bonus')).toBe(t.bonus + 1);
        expect(get('Perks')).toBe(t.perks + 1);
        expect(get('Off + Bonus')).toBe(t.off + t.bonus + 1);
        expect(get('Off')).toBe(t.off);                                  // half days never count toward Off
      }
    }, 60000);
  }

  it('pins are pre-ticked on the right half, and pinned bonus days are not flagged as already off', async () => {
    const { s, schedule, ws } = await exportCase('27-every-pin-type-and-attending-days.json');
    const { first } = locate(ws);
    const names = Object.keys(schedule.totals);
    const dates = monthDates(s.month);
    const pins = s.pins.filter(p => p.type === 'offFree' || p.type === 'halfOff');
    expect(pins.length).toBeGreaterThan(0);
    for (const p of pins) {
      const k = names.indexOf(p.person), i = dates.indexOf(p.date);
      const j = p.type === 'offFree' ? 2 : (p.half ?? 'PM') === 'AM' ? 0 : 1;
      expect(ws.getCell(first + i, 11 + 3 * k + j).value).toBe(true);
      if (p.type === 'offFree') {
        const key = ws.getCell(first + i, 12 + 3 * names.length).value;
        expect(key).not.toContain(`|${p.person}|`);
      }
    }
  }, 60000);

  it('conflict rules, merges and styling survive an xlsx round trip', async () => {
    const { schedule, wb } = await exportCase('25-heavy-staggered-pto-1s3i.json');
    const copy = new ExcelJS.Workbook();
    await copy.xlsx.load(await wb.xlsx.writeBuffer());
    const ws = copy.worksheets[0];
    const n = Object.keys(schedule.totals).length;
    const { head1, header } = locate(ws);
    expect(ws.conditionalFormattings.length).toBe(n);
    expect(ws.conditionalFormattings[0].rules.map(r => r.type)).toEqual(['expression', 'expression']);
    expect(ws.conditionalFormattings[0].rules[0].formulae[0]).toContain('SEARCH("|');
    expect(ws.getCell(head1, 12).isMerged && ws.getCell(head1, 13).isMerged).toBe(true);
    expect(ws.getColumn(12 + 3 * n).hidden).toBe(true);                    // the "|A|B|" key column
    expect(ws.getCell(2, header.Shifts).fill.fgColor.argb).toBe('FFC6E0B4');   // live header = green
    expect(ws.getCell(2, header.Pager).fill.fgColor.argb).toBe('FF9DC3E6');
    expect(ws.getCell(3, header.Shifts).value.formula).toMatch(/COUNTIF/);
    // ExcelJS doesn't read calcPr back, so check the written XML for "recalculate on open"
    const zip = await JSZip.loadAsync(await wb.xlsx.writeBuffer());
    expect(await zip.file('xl/workbook.xml').async('string')).toMatch(/<calcPr[^>]*fullCalcOnLoad="1"/);
  }, 60000);

  it('all-solutions workbook: each sheet carries its own grid below its own header lines', async () => {
    const s = load('12-two-person-1s1i-medE.json');
    s.lastSolution = null;
    const { schedule } = await solve(s);
    const wb = await buildAllSolutionsWorkbook(s, [
      { schedule, auditResult: audit(s, schedule), headerLines: [] },
      { schedule, auditResult: audit(s, schedule), headerLines: ['Differs: x'] },
    ], 'test');
    const [a, b] = wb.worksheets;
    expect(locate(a).residents.length).toBe(2);
    const lb = locate(b, 3);
    expect(lb.residents.length).toBe(2);
    expect(b.getCell(lb.head1, 10).value).toBe('Date');
    expect(evaluate(b, addr(lb.header.Shifts, lb.residents[0].row))).toBeCloseTo(schedule.totals[lb.residents[0].name].shifts, 9);
  }, 60000);
});
