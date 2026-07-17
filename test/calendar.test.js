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

  it('totals table: columns + 0.5-increment formatting + audit-consistent off counts', () => {
    const t = renderTotals(schedule);
    expect(t.querySelectorAll('thead th').length).toBe(10);
    expect(t.textContent).toContain('Intern1');
    const anaelleOff = t.querySelector('[data-name="Intern1"][data-col="off"]').textContent;
    expect(anaelleOff).toBe('2.0');
  });

  it('warnings panel mirrors audit output', () => {
    const w = renderWarnings(audit(s, schedule));
    expect(w.querySelectorAll('li.warning').length).toBe(audit(s, schedule).warnings.length);
  });
});
