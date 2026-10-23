// Phone team view (v1.15.0): the cards must say exactly what the xlsx calendar says, on every scenario.
// Both are built from cell-text.js; this test reads the finished workbook's calendar cells back and compares
// them to the phone payload day by day, so a future edit to either side that drifts fails here.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { buildWorkbook } from '../src/export.js';
import { buildPhonePayload, PHONE_ROWS } from '../src/phone.js';
import { phoneHtml } from '../src/phone-page.js';
import { solve } from '../src/solve.js';
import { audit } from '../src/audit.js';
import { parseScenario, monthDates } from '../src/model.js';

const here = p => new URL(`../${p}`, import.meta.url);
const SOURCES = [
  ...readdirSync(here('fixtures')).filter(f => f === 'feb-2026.json' || f === 'oct-2026-didactics.json'
    || f.startsWith('comp-') || f.startsWith('example-')).sort().map(f => `fixtures/${f}`),
  ...readdirSync(here('scenarios')).filter(f => f.endsWith('.json')).sort().map(f => `scenarios/${f}`),
];

// Read every day's cells out of the workbook calendar: { 'YYYY-MM-DD': { TYPE, ROUNDERS, ... } }.
function calendarCells(ws, scenario) {
  const dates = monthDates(scenario.month);
  const byDay = new Map(dates.map(d => [Number(d.slice(8)), d]));
  const out = {};
  for (let r = 1; r <= ws.rowCount; r++) {
    if (ws.getCell(r, 1).value !== 'DATE') continue;
    const labels = [];
    for (let k = 0; k < 8; k++) labels.push(ws.getCell(r + k, 1).value);
    for (let c = 2; c <= 8; c++) {
      const day = ws.getCell(r, c).value;
      if (day == null || day === '') continue;
      const date = byDay.get(Number(day));
      const cells = {};
      labels.forEach((label, k) => { cells[label] = String(ws.getCell(r + k, c).value ?? ''); });
      out[date] = cells;
    }
  }
  return out;
}

describe('phone cards match the xlsx calendar', () => {
  it('covers the 43 smoke scenarios', () => { expect(SOURCES.length).toBe(43); });

  for (const file of SOURCES) {
    it(file, async () => {
      const s = parseScenario(JSON.parse(readFileSync(here(file), 'utf8')));
      s.lastSolution = null;
      const { schedule } = await solve(s);
      const wb = await buildWorkbook(s, schedule, audit(s, schedule), 'test');
      const cells = calendarCells(wb.worksheets[0], s);
      const payload = buildPhonePayload(s, schedule, 'test');
      expect(payload.days.map(d => d.date)).toEqual(monthDates(s.month));
      expect(Object.keys(cells).sort()).toEqual(payload.days.map(d => d.date));
      for (const d of payload.days) {
        const x = cells[d.date];
        const mr = payload.morningReportDays.includes(d.date) ? '\nMORNING REPORT' : '';
        expect(d.type + mr, `${d.date} TYPE`).toBe(x.TYPE);
        for (const row of PHONE_ROWS.filter(r => r !== 'CLINIC')) {
          // the phone spells call shifts out: "Day call - X", "Night call - X"
          const want = row === 'ROUNDERS' ? x[row].replace(/^Day - /gm, 'Day call - ').replace(/^Night - /gm, 'Night call - ') : x[row];
          expect(d.rows[row], `${d.date} ${row}`).toBe(want);
        }
        // CLINIC: the phone adds each commitment's label; stripping it must leave the xlsx's name list
        const bare = d.rows.CLINIC.replace(/ \([^)]*\)/g, '');
        expect(bare.split(', ').filter(Boolean).sort(), `${d.date} CLINIC names`).toEqual(x.CLINIC.replace(/ \([^)]*\)/g, '').split(', ').filter(Boolean).sort());
      }
    }, 120000);
  }
});

describe('phone page', () => {
  const data = {
    v: 1, team: 'Med A', month: '2026-03', title: 'Med A - March 2026', version: '1.15.0', updated: '2026-03-01T12:00:00.000Z',
    residents: ['Ann', 'Anna'], morningReportDays: [], days: [{ date: '2026-03-01', type: 'CALL', rows: { ROUNDERS: 'Day - Ann', PAGER: '—', CLINIC: '', DIDACTICS: '', PTO: '', OFF: '' } }],
  };
  it('is self-contained and carries the version', () => {
    const html = phoneHtml(data);
    expect(html).toContain('built 1.15.0');
    expect(html.includes('rel="manifest"')).toBe(false);
    expect(html.includes('src="http')).toBe(false);
  });
  it('turns on install hooks only for a published link', () => {
    const html = phoneHtml(data, { words: 'pineapple-mango-dog' });
    expect(html).toContain('/pineapple-mango-dog.webmanifest');
    expect(html).toContain('/icon-180.png');
  });
  it('cannot be broken out of by a name containing script tags', () => {
    const html = phoneHtml({ ...data, residents: ['</script><b>x'] });
    expect(html.split('</scr' + 'ipt>').length - 1).toBe(1);
  });

  it('defines __name before the client runs (a bundler that keeps names injects calls to it)', () => {
    expect(phoneHtml(data)).toMatch(/<script>var __name=function\(f\)\{return f\};\(/);
  });
});

describe('phone commitments carry their labels', () => {
  it('names what each commitment is next to the resident, one entry per resident', async () => {
    const scenario = parseScenario(JSON.parse(readFileSync(here('fixtures/feb-2026.json'), 'utf8')));
    scenario.lastSolution = null;
    const { schedule } = await solve(scenario);
    const r = scenario.residents[0];
    const date = monthDates(scenario.month)[8];
    r.commitments = [{ date, half: 'PM', label: 'Clinic FHC' }, { date, half: 'AM', label: 'ITE' }];
    scenario.residents[1].commitments = [{ date, half: 'PM', label: '  ' }];
    for (const o of scenario.residents.slice(2)) o.commitments = [];
    const p = buildPhonePayload(scenario, schedule, 1);
    const row = p.days.find(d => d.date === date).rows.CLINIC;
    expect(row).toBe(`${r.name} (Clinic FHC + ITE), ${scenario.residents[1].name} (other commitment)`);
  });
});
