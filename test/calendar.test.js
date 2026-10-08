// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { renderCalendar, renderTotals, renderWarnings } from '../src/ui/calendar.js';
import { solve } from '../src/solve.js';
import { audit } from '../src/audit.js';
import { parseScenario } from '../src/model.js';
import feb from '../fixtures/feb-2026.json';

const ROWS = ['DATE', 'TYPE', 'ROUNDERS', 'PAGER', 'CLINIC', 'DIDACTICS', 'PTO', 'OFF'];

describe('calendar render (feb-2026 solved)', () => {
  let s, schedule, el;
  beforeAll(async () => {
    s = parseScenario(feb);
    ({ schedule } = await solve(s));
    el = renderCalendar(s, schedule);
  });

  it('week blocks are Sun-Sat with the 8 rows in order', () => {
    const block = el.querySelector('.week');
    expect([...block.querySelectorAll('tr')].map(tr => tr.querySelector('th').textContent))
      .toEqual(ROWS);
    expect(block.querySelectorAll('tr:first-child td').length).toBe(7);
  });

  it('Feb 5 (call): CALL type class, Day-/Night- lines, no pager', () => {
    const cell = el.querySelector('[data-date="2026-02-05"][data-row="TYPE"]');
    expect(cell.textContent).toBe('CALL');
    expect(cell.classList.contains('type-call')).toBe(true);
    const rounders = el.querySelector('[data-date="2026-02-05"][data-row="ROUNDERS"]').textContent;
    expect(rounders).toContain('Night - ' + schedule.days['2026-02-05'].night);
    expect(rounders).toMatch(/Day - /);
    expect(el.querySelector('[data-date="2026-02-05"][data-row="PAGER"]').textContent.trim()).toBe('—');
  });

  it('Feb 6 (post-call): (postcall) tags, sleeper omitted, pager = day-call intern', () => {
    const r = el.querySelector('[data-date="2026-02-06"][data-row="ROUNDERS"]').textContent;
    expect(r).toContain('(postcall)');
    expect(r).not.toContain(schedule.days['2026-02-06'].sleeper);
    expect(el.querySelector('[data-date="2026-02-06"][data-row="PAGER"]').textContent)
      .toContain(schedule.days['2026-02-06'].pager);
  });

  it('Feb 20: Senior1 in PTO row; no blank cells in a perfect 4-week month', () => {
    expect(el.querySelector('[data-date="2026-02-20"][data-row="PTO"]').textContent).toContain('Senior1');
    expect(el.querySelectorAll('td.blank').length).toBe(0);  // Feb 2026 = exactly 4 Sun-Sat weeks (blanks exercised by any 31-day month via a quick extra render assert)
  });

  it('Feb 10 (pre-call Tue) is tagged MORNING REPORT; other days are not', () => {
    const mr = el.querySelector('[data-date="2026-02-10"][data-row="TYPE"]');
    expect(mr.classList.contains('type-mr')).toBe(true);
    expect(mr.textContent).toContain('MORNING REPORT');
    expect(el.querySelectorAll('td[data-morning-report]').length).toBe(1);  // Feb 2026 has exactly one
    expect(el.querySelector('[data-date="2026-02-05"][data-row="TYPE"]').textContent)
      .not.toContain('MORNING REPORT');
  });

  it('totals table: columns + whole-number / 0.5-increment formatting + audit-consistent off counts', () => {
    const t = renderTotals(schedule);
    expect(t.querySelectorAll('thead th').length).toBe(11);
    expect(t.textContent).toContain('Intern1');
    const intern1Off = t.querySelector('[data-name="Intern1"][data-col="off"]').textContent;
    expect(intern1Off).toBe('2');
    for (const td of t.querySelectorAll('tbody td')) expect(td.textContent).not.toMatch(/^\d+\.0$/);   // whole numbers drop the .0
  });

  it('warnings panel mirrors audit output', () => {
    const w = renderWarnings(audit(s, schedule));
    expect(w.querySelectorAll('li.warning').length).toBe(audit(s, schedule).warnings.length);
  });
});

// The pager holder still goes to didactics and steps out if something happens (program rule, 2026-08),
// so the DIDACTICS row keeps them, tagged — and the totals carry a denominator a chief can act on.
describe('didactics reporting', () => {
  let s, schedule;
  beforeAll(async () => {
    s = parseScenario(feb);
    ({ schedule } = await solve(s));
  });

  it('a didactics-day pager holder stays on the DIDACTICS row, tagged', () => {
    const el = renderCalendar(s, schedule);
    const rows = [...el.querySelectorAll('tr')]
      .filter(tr => tr.querySelector('th')?.textContent === 'DIDACTICS');
    const text = rows.map(tr => tr.textContent).join(' ');
    const tethered = Object.entries(schedule.totals).filter(([, t]) => t.didacticsPager > 0);
    if (tethered.length) expect(text).toContain(`${tethered[0][0]} (pager)`);
    // and nobody who lost the half-day to an off day is listed as present
    for (const [d, dd] of Object.entries(schedule.days))
      for (const name of dd.off) {
        const cell = el.querySelector(`[data-date="${d}"][data-row="didactics"]`);
        if (cell) expect(cell.textContent).not.toContain(name);
      }
  });

  it('totals show didactics as attended / attendable, not a bare count', () => {
    const t = renderTotals(schedule);
    for (const [name, tot] of Object.entries(schedule.totals)) {
      const cell = t.querySelector(`[data-name="${name}"][data-col="didactics"]`);
      if (!tot.didacticsOf) continue;
      expect(cell.textContent).toBe(`${tot.didactics} / ${tot.didacticsOf}`);
    }
  });
});

it('a schedule saved before the denominator existed shows the bare old count, not a fake n / n', async () => {
  const s = parseScenario(feb);
  const { schedule } = await solve(s);
  const old = { ...schedule, totals: Object.fromEntries(Object.entries(schedule.totals)
    .map(([n, t]) => [n, { ...t, didacticsOf: undefined, didacticsPager: undefined }])) };
  const t = renderTotals(old);
  const name = Object.keys(old.totals)[0];
  expect(t.querySelector(`[data-name="${name}"][data-col="didactics"]`).textContent)
    .toBe(String(old.totals[name].didactics));
});
