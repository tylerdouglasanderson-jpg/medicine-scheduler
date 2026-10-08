// @vitest-environment jsdom
// Afternoons off (program rule, 2026-10): a reported number, never solved for. See model.js afternoonsOffDates.
import { describe, it, expect, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';
import { parseScenario, afternoonsOffDates } from '../src/model.js';
import { solve } from '../src/solve.js';
import { audit } from '../src/audit.js';
import { buildWorkbook } from '../src/export.js';
import { renderTotals } from '../src/ui/calendar.js';
import feb from '../fixtures/feb-2026.json';

// Oct 2026 starts on a Thursday with a call day: 1 call, 2 postcall, 3 ppc (Sat), 4 sc1 (Sun),
// 5 sc2 (Mon), 6 precall (Tue).
const day = (type, working, extra = {}) => ({ type, working, off: [], sleeper: null, pager: null, night: null, dayCall: null, ...extra });
function scenario(pins = []) {
  return parseScenario({
    team: 'T', month: '2026-10', anchorType: 'call', pins,
    residents: [
      { name: 'S', role: 'senior', serviceStart: '2026-10-01', serviceEnd: '2026-10-31',
        didactics: { dow: 2, half: 'PM', hard: false },
        commitments: [{ date: '2026-10-05', half: 'PM', label: 'ITE' }, { date: '2026-10-03', half: 'AM', label: 'Clinic' }] },
      { name: 'I', role: 'intern', serviceStart: '2026-10-01', serviceEnd: '2026-10-31' },
    ],
  });
}
const schedule = {
  days: {
    '2026-10-01': day('call', ['S', 'I'], { night: 'I' }),
    '2026-10-02': day('postcall', ['S'], { sleeper: 'I', pager: 'S' }),
    '2026-10-03': day('ppc', ['S', 'I'], { pager: 'I' }),    // S: AM clinic only, afternoon free (weekend)
    '2026-10-04': day('sc1', ['S', 'I'], { pager: 'S' }),    // I free
    '2026-10-05': day('sc2', ['S', 'I'], { pager: 'I' }),    // S has a PM ITE
    '2026-10-06': day('precall', ['S', 'I'], { pager: 'I' }), // S Tuesday PM didactics
  },
  totals: { S: {}, I: {} },
};

describe('afternoonsOffDates', () => {
  it('counts rounded-and-free afternoons; never call/post-call, pager, PM commitment or PM didactics', () => {
    const s = scenario();
    expect(afternoonsOffDates(s, schedule, 'S')).toEqual(['2026-10-03']);
    expect(afternoonsOffDates(s, schedule, 'I')).toEqual(['2026-10-04']);
  });
  it('a PM half day off counts as an afternoon off; an AM half day off does not', () => {
    const s = scenario([
      { person: 'S', date: '2026-10-06', type: 'halfOff', half: 'PM' },
      { person: 'S', date: '2026-10-03', type: 'halfOff', half: 'AM' },
    ]);
    expect(afternoonsOffDates(s, schedule, 'S')).toEqual(['2026-10-06']);
  });
  it('load-time backfill fills pmOff for a schedule saved before the count existed', () => {
    const json = { ...scenario(), lastSolution: null };
    const full = {};
    for (let i = 1; i <= 31; i++) {
      const d = `2026-10-${String(i).padStart(2, '0')}`;
      full[d] = schedule.days[d] ?? day('sc1', ['S', 'I'], { pager: 'S' });
    }
    const s = parseScenario(JSON.parse(JSON.stringify({ ...json, lastSolution: { days: full, totals: { S: { off: 0 }, I: { off: 0 } } } })));
    expect(s.lastSolution.totals.S.pmOff).toBe(1);
    expect(s.lastSolution.totals.I.pmOff).toBe(afternoonsOffDates(s, s.lastSolution, 'I').length);
  });
});

describe('afternoons off on a solved month (feb-2026)', () => {
  let s, sched;
  beforeAll(async () => { s = parseScenario(feb); ({ schedule: sched } = await solve(s)); });

  it('solve totals carry pmOff, equal to the independent date list', () => {
    for (const r of s.residents) {
      expect(Number.isInteger(sched.totals[r.name].pmOff)).toBe(true);
      expect(sched.totals[r.name].pmOff).toBe(afternoonsOffDates(s, sched, r.name).length);
    }
  });
  it('totals table shows a PM off column with a tooltip', () => {
    const t = renderTotals(sched);
    const th = [...t.querySelectorAll('thead th')].find(h => h.textContent.startsWith('PM off'));
    expect(th.title).toMatch(/Afternoons off/);
    const r = s.residents[0].name;
    expect(t.querySelector(`[data-name="${r}"][data-col="pmOff"]`).textContent).toBe(String(sched.totals[r].pmOff));
  });
  it('totals table shows an em-dash when pmOff is missing', () => {
    const r = s.residents[0].name;
    const t = renderTotals({ ...sched, totals: { [r]: { ...sched.totals[r], pmOff: undefined } } });
    expect(t.querySelector(`[data-col="pmOff"]`).textContent).toBe('—');
  });
  it('xlsx totals block carries the PM off column', async () => {
    const wb = await buildWorkbook(s, sched, audit(s, sched), 'test');
    const ws = wb.worksheets[0];
    let hit = null;
    ws.eachRow((row, n) => row.eachCell((c, col) => { if (c.value === 'PM off') hit = { n, col }; }));
    expect(hit).not.toBeNull();
    const r = s.residents[0].name;
    expect(ws.getCell(hit.n + 1, hit.col).value).toBe(sched.totals[r].pmOff);
  });
});

describe('CLINIC row names non-clinic commitments inline (v1.1.0)', () => {
  it('calendar and xlsx read "Name (ITE)" for an ITE, plain name for clinic', async () => {
    const { renderCalendar } = await import('../src/ui/calendar.js');
    const s = parseScenario(feb);
    const [a, b] = s.residents;
    const d = '2026-02-03';
    a.commitments = [{ date: d, half: 'PM', label: 'ITE' }];
    b.commitments = [{ date: d, half: 'PM', label: 'Clinic FHC' }];
    const { schedule: sched } = await solve(s);
    const cell = renderCalendar(s, sched).querySelector(`td[data-row="CLINIC"][data-date="${d}"]`);
    expect(cell.textContent).toContain(`${a.name} (ITE)`);
    expect(cell.textContent).not.toContain(`${b.name} (`);
    const ws = (await buildWorkbook(s, sched, audit(s, sched), 'test')).worksheets[0];
    let txt = null;
    ws.eachRow(row => row.eachCell(c => { if (typeof c.value === 'string' && c.value.includes(`${a.name} (ITE)`)) txt = c.value; }));
    expect(txt).toContain(b.name);
  });
});

describe('CLINIC row: a blank commitment label reads "(other commitment)" (v1.1.0)', () => {
  it('names it generically; a clinic label stays plain', async () => {
    const { renderCalendar } = await import('../src/ui/calendar.js');
    const s = parseScenario(feb);
    const [a, b] = s.residents;
    const d = '2026-02-03';
    a.commitments = [{ date: d, half: 'PM', label: '' }];
    b.commitments = [{ date: d, half: 'PM', label: 'clinic' }];
    const { schedule: sched } = await solve(s);
    const txt = renderCalendar(s, sched).querySelector(`td[data-row="CLINIC"][data-date="${d}"]`).textContent;
    expect(txt).toContain(`${a.name} (other commitment)`);
    expect(txt).not.toContain(`${b.name} (`);
  });
});
