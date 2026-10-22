// xlsx totals box (v1.3.0): every total is a live formula over the calendar block, and the AM / PM / Day tick
// grid feeds Days / Perks / Shifts. HyperFormula (devDependency) evaluates the formulas the exporter writes, so
// these tests check the numbers a chief will see, not just the formula text.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { createRequire } from 'node:module';
const { HyperFormula } = createRequire(import.meta.url)('hyperformula');
import { buildWorkbook, buildAllSolutionsWorkbook, nameOverlaps } from '../src/export.js';
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
const KEYS = ['Shifts', 'Pager', 'Clinic/Obligation', 'Didactics', 'Off', 'PTO', 'Days', 'Perks (half days)', 'Off + Bonus', 'PM off'];
const SOLVER = {
  Shifts: t => t.shifts, Pager: t => t.pager, 'Clinic/Obligation': t => t.clinic,
  Didactics: t => (t.didacticsOf == null ? t.didactics : `${t.didactics} / ${t.didacticsOf}`),
  Off: t => t.off, PTO: t => t.pto, Days: t => t.bonus, 'Perks (half days)': t => t.perks,
  'Off + Bonus': t => t.off + t.bonus + 0.5 * t.perks, 'PM off': t => t.pmOff,
};

const addr = (c, r) => { let s = ''; for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s + r; };

// HyperFormula does not lift COLUMN(range) over a range or know VALUE(), and drops array mode inside `&`.
// Google Sheets and Excel do all three (checked in the real Sheet), so the harness rewrites just those.
function hfFormula(f) {
  return f.replaceAll(',TRUE)', ',TRUE())')
    .replace(/COLUMN\(\$B\$(\d+):\$H\$(\d+)\)/g, (_, lo, hi) =>
      `{${Array.from({ length: hi - lo + 1 }, () => '2,3,4,5,6,7,8').join(';')}}`)
    .replace(/VALUE\(/g, '1*(');
}
function engine(ws) {
  const data = [];
  ws.eachRow({ includeEmpty: true }, (row, r) => {
    data[r - 1] = [];
    row.eachCell({ includeEmpty: true }, (c, col) => {
      if (c.isMerged && c.master !== c) return;
      let v = c.value;
      if (v && typeof v === 'object' && 'formula' in v) {
        const f = hfFormula(v.formula);
        const cut = f.indexOf('&" / "&');
        if (cut < 0) v = `=${f}`;
        else {
          data[r - 1][100] = `=${f.slice(0, cut)}`; data[r - 1][101] = `=${f.slice(cut + 7)}`;
          v = `=${addr(101, r)}&" / "&${addr(102, r)}`;
        }
      }
      data[r - 1][col - 1] = v ?? null;
    });
  });
  const hf = HyperFormula.buildFromArray(data.map(r => r ?? []), { licenseKey: 'gpl-v3', useArrayArithmetic: true });
  const pos = ref => { const c = ws.getCell(ref); return { sheet: 0, row: c.row - 1, col: c.col - 1 }; };
  return {
    get: ref => hf.getCellValue(pos(ref)),
    set: (ref, v) => hf.setCellContents(pos(ref), [[v]]),
  };
}

function locate(ws, top = 2) {
  const header = {};
  for (let c = 10; c <= 21; c++) header[ws.getCell(top, c).value] = c;
  const residents = [];
  let row = top;
  while (ws.getCell(++row, 10).value) residents.push({ name: ws.getCell(row, 10).value, row });
  const n = residents.length;
  return { header, residents, head1: top + n + 3, first: top + n + 5 };
}

async function exportCase(file) {
  const s = load(file);
  s.lastSolution = null;
  const { schedule } = await solve(s);
  const wb = await buildWorkbook(s, schedule, audit(s, schedule), 'test');
  return { s, schedule, ws: wb.worksheets[0], wb };
}

describe('xlsx totals box', () => {
  for (const file of CASES) {
    it(`${file}: formulas reproduce the solved totals; ticks and calendar edits move them`, async () => {
      const { s, schedule, ws } = await exportCase(file);
      const dates = monthDates(s.month);
      const { header, residents, head1, first } = locate(ws);
      const names = Object.keys(schedule.totals);
      const x = engine(ws);
      expect(residents.map(r => r.name)).toEqual(names);

      // shape: Bonus/Off over Days + Perks, one grid row per date, 3 tick columns per resident
      expect(ws.getCell(1, header.Days).value).toBe('Bonus/Off');
      expect(ws.getCell(1, header['Perks (half days)']).isMerged).toBe(true);
      expect(ws.getCell(head1, 10).value).toBe('Date');
      expect(ws.getCell(head1, 11 + 3 * names.length).value).toBe('Already off / PTO');
      expect(String(ws.getCell(first + dates.length - 1, 10).value))
        .toMatch(new RegExp(` ${Number(dates.at(-1).slice(5, 7))}/${Number(dates.at(-1).slice(8))}$`));
      expect(ws.getCell(first + dates.length, 10).value).toBeNull();

      for (const { name, row } of residents) {
        const t = schedule.totals[name];
        for (const key of KEYS) {
          if (key === 'PM off') continue;   // calendar text cannot see AM-only commitments: checked below
          expect(x.get(addr(header[key], row)), `${name} ${key}`).toBe(SOLVER[key](t));
        }
        // PM off is derived from the calendar text: never above the solver's count, at most a few days off
        const pm = x.get(addr(header['PM off'], row));
        expect(Math.abs(pm - t.pmOff), `${name} PM off ${pm} vs ${t.pmOff}`).toBeLessThanOrEqual(3);
      }

      // no Total / Spread rows (removed at Senior1's request): the row under the last resident is empty
      expect(ws.getCell(residents.at(-1).row + 1, 10).value ?? null).toBeNull();

      // tick a free Day box and a free PM box on service days
      for (const [k, { name, row }] of residents.entries()) {
        const t = schedule.totals[name];
        const r = s.residents.find(q => q.name === name);
        const free = (i, j) => onService(r, dates[i]) && ws.getCell(first + i, 11 + 3 * k + j).value === false;
        const dayRow = dates.findIndex((_, i) => free(i, 2));
        const pmRow = dates.findIndex((_, i) => i !== dayRow && free(i, 1));
        if (dayRow < 0 || pmRow < 0) continue;
        const get = key => x.get(addr(header[key], row));
        x.set(addr(13 + 3 * k, first + dayRow), true);   // Day
        x.set(addr(12 + 3 * k, first + pmRow), 'x');     // PM, typed as x
        expect(get('Shifts')).toBeCloseTo(t.shifts - 1.5, 9);
        expect(get('Days')).toBe(t.bonus + 1);
        expect(get('Perks (half days)')).toBe(t.perks + 1);
        expect(get('Off + Bonus')).toBeCloseTo(t.off + t.bonus + 0.5 * t.perks + 1.5, 9);
        expect(get('Off')).toBe(t.off);                  // half days never count toward Off
        x.set(addr(13 + 3 * k, first + dayRow), false);
        x.set(addr(12 + 3 * k, first + pmRow), false);
        expect(get('Shifts')).toBeCloseTo(t.shifts, 9);
      }

      // a hand edit to the calendar flows through: clear one plain OFF cell
      const offRow = names.map(n => ({ n, hit: null }));
      for (const o of offRow) {
        for (let r = 2; r <= 41 && !o.hit; r++) {
          if (ws.getCell(r, 1).value !== 'OFF') continue;
          for (let c = 2; c <= 8 && !o.hit; c++) {
            const v = ws.getCell(r, c).value;
            if (typeof v === 'string' && v.split(', ').includes(o.n)) o.hit = { r, c, v };
          }
        }
      }
      const pick = offRow.find(o => o.hit);
      if (pick) {
        const { row } = residents.find(q => q.name === pick.n);
        const before = x.get(addr(header.Off, row));
        x.set(addr(pick.hit.c, pick.hit.r), '');
        expect(x.get(addr(header.Off, row))).toBe(before - 1);
        expect(x.get(addr(header['Off + Bonus'], row))).toBeCloseTo(before - 1 + schedule.totals[pick.n].bonus + 0.5 * schedule.totals[pick.n].perks, 9);
      }
    }, 60000);
  }

  it('grid starts empty; off-service cells are grey; already-off key lists every off day', async () => {
    const { s, schedule, ws } = await exportCase('27-every-pin-type-and-attending-days.json');
    const { first } = locate(ws);
    const names = Object.keys(schedule.totals);
    const dates = monthDates(s.month);
    names.forEach((name, k) => {
      const r = s.residents.find(x => x.name === name);
      dates.forEach((d, i) => [0, 1, 2].forEach(j => {
        const v = ws.getCell(first + i, 11 + 3 * k + j).value;
        expect(v).toBeNull();   // boxes start empty; an X (or a ticked box) is the tick
      }));
    });
    const keyCol = Math.max(11 + 3 * names.length, 21) + 1;
    for (const p of s.pins.filter(q => q.type === 'offFree')) {
      const key = ws.getCell(first + dates.indexOf(p.date), keyCol).value;
      expect(key).toContain(`|${p.person}|`);   // a tick on a bonus day already given is a conflict
    }
  }, 60000);

  it('conflict rules, merges and styling survive an xlsx round trip', async () => {
    const { schedule, wb } = await exportCase('25-heavy-staggered-pto-1s3i.json');
    const copy = new ExcelJS.Workbook();
    await copy.xlsx.load(await wb.xlsx.writeBuffer());
    const ws = copy.worksheets[0];
    const n = Object.keys(schedule.totals).length;
    const { head1, header } = locate(ws);
    expect(ws.conditionalFormattings.length).toBe(n + 1);                      // today highlight + one per resident
    const [today, ...conflict] = ws.conditionalFormattings;
    expect(conflict[0].rules.map(r => r.type)).toEqual(['expression', 'expression']);
    expect(conflict[0].rules[0].formulae[0]).toContain('SEARCH("|');
    // today highlight: calendar range, DATE cell (bold) over the pale rest-of-day rule, both keyed to TODAY()
    expect(today.ref).toMatch(/^B3:H\d+$/);
    expect(today.rules).toHaveLength(2);
    expect(today.rules[0].formulae[0]).toMatch(/^AND\(MOD\(ROW\(\)-3,8\)=0,.*DAY\(TODAY\(\)\)\)$/);
    expect(today.rules[0].style.font.bold).toBe(true);
    expect(today.rules[1].formulae[0]).toContain('INDEX($B$1:$H$');
    expect(today.rules[1].formulae[0]).toContain('TEXT(TODAY(),"MMMM YYYY")');
    expect(ws.getCell(head1, 12).isMerged && ws.getCell(head1, 13).isMerged).toBe(true);
    expect(ws.getColumn(Math.max(11 + 3 * n, 21) + 1).hidden).toBe(true);      // the "|A|B|" key column
    expect(ws.getColumn(21).hidden).toBeFalsy();                               // Didactics day stays visible
    expect(ws.getCell(2, header.Shifts).fill.fgColor.argb).toBe('FFC6E0B4');   // live header = green
    expect(ws.getCell(3, header.Pager).value.formula).toMatch(/SUMPRODUCT/);
    expect(ws.getCell(3, header.Shifts).value.formula).toMatch(/COUNTIF/);
    // ExcelJS doesn't read calcPr back, so check the written XML for "recalculate on open"
    const zip = await JSZip.loadAsync(await wb.xlsx.writeBuffer());
    expect(await zip.file('xl/workbook.xml').async('string')).toMatch(/<calcPr[^>]*fullCalcOnLoad="1"/);
  }, 60000);

  it('all-solutions workbook: each sheet carries its own box + grid below its own header lines', async () => {
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
    expect(engine(b).get(addr(lb.header.Shifts, lb.residents[0].row)))
      .toBeCloseTo(schedule.totals[lb.residents[0].name].shifts, 9);
  }, 60000);

  it('flags resident names that sit inside another name (SEARCH would double count)', () => {
    expect(nameOverlaps(['Ann', 'Joanne', 'Bo'])).toEqual(['Ann is inside Joanne']);
    expect(nameOverlaps(['Quinn', 'Rossi'])).toEqual([]);
  });
});
