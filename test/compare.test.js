import { describe, it, expect } from 'vitest';
import { describeDifference } from '../src/compare.js';
import { audit } from '../src/audit.js';
import { solve } from '../src/solve.js';
import { parseScenario } from '../src/model.js';
import feb from '../fixtures/feb-2026.json';

// Hand-built mini month: three residents, a handful of October days. `issues` is supplied so these
// stay free of the auditor; the last block covers the audited path on a real month.
const scenario = { residents: [{ name: 'Alvarez' }, { name: 'Brooks' }, { name: 'Chen' }] };
const DATES = ['2026-10-03', '2026-10-04', '2026-10-06', '2026-10-07', '2026-10-12'];  // 3,4 = Sat,Sun
const tot = (pager, didactics = 4, didacticsOf = 4) => ({ pager, didactics, didacticsOf });
function sched({ off = {}, night = {}, pager = {}, totals } = {}) {
  const days = Object.fromEntries(DATES.map(d => [d, {
    type: 'sc1', working: [], off: off[d] ?? [], sleeper: null, pager: pager[d] ?? null, night: night[d] ?? null, dayCall: null,
  }]));
  return { days, totals: totals ?? { Alvarez: tot(6), Brooks: tot(10), Chen: tot(10) } };
}
const sol = (schedule, objective = 100, issues = 2) => ({ schedule, objective, issues });

describe('describeDifference on hand-built schedules', () => {
  const base = sched({ off: { '2026-10-06': ['Brooks'], '2026-10-07': ['Chen'] } });

  it('names each day off that moved, per person, with plain dates', () => {
    const alt = sched({ off: { '2026-10-12': ['Brooks'], '2026-10-07': ['Chen'] } });
    const r = describeDifference(scenario, sol(base), sol(alt));
    expect(r.lines[0]).toBe('Brooks: off Oct 6→Oct 12');
    expect(r.stats.offsMoved).toBe(1);
  });

  it('identical schedules read "Same days off" and "Equally good", nothing else', () => {
    const r = describeDifference(scenario, sol(base), sol(base));
    expect(r.lines).toEqual(['Same days off', 'Equally good · same number of potential issues']);
    expect(r.stats).toEqual({ offsMoved: 0, nightsChanged: 0, pagerChanged: 0, objectiveDelta: 0, issuesDelta: 0 });
  });

  it('pager split is in roster order, this schedule first; nights are counted', () => {
    const alt = sched({
      off: { '2026-10-06': ['Brooks'], '2026-10-07': ['Chen'] },
      night: { '2026-10-04': 'Brooks' }, pager: { '2026-10-06': 'Chen' },
      totals: { Alvarez: tot(7), Brooks: tot(9), Chen: tot(10) },
    });
    const r = describeDifference(scenario, sol(base), sol(alt));
    expect(r.lines[1]).toBe('1 night reassigned · pager 7/9/10 vs 6/10/10');
    expect(r.stats).toMatchObject({ nightsChanged: 1, pagerChanged: 1 });
  });

  it('didactics attended and weekend days off are reported when they change', () => {
    const alt = sched({
      off: { '2026-10-03': ['Brooks'], '2026-10-07': ['Chen'] },
      totals: { Alvarez: tot(6), Brooks: tot(10, 3, 4), Chen: tot(10) },
    });
    const r = describeDifference(scenario, sol(base), sol(alt));
    expect(r.lines[0]).toBe('Brooks: off Oct 6→Oct 3');
    expect(r.lines[1]).toBe('didactics Brooks 3/4 vs 4/4 · weekend days off 1 vs 0');
  });

  it('quality is in quarter shifts (130 per shift), never a percentage', () => {
    const q = delta => describeDifference(scenario, sol(base, 100), sol(base, 100 + delta)).lines.at(-1).split(' · ')[0];
    expect(q(0)).toBe('Equally good');
    expect(q(1)).toBe('Equally good');
    expect(q(-1)).toBe('Equally good');
    expect(q(6)).toBe('Nearly as good');
    expect(q(-6)).toBe('Slightly better');
    expect(q(32.5)).toBe('≈ ¼ shift less balanced');
    expect(q(65)).toBe('≈ ½ shift less balanced');
    expect(q(100)).toBe('≈ ¾ shift less balanced');
    expect(q(130)).toBe('≈ 1 shift less balanced');
    expect(q(195)).toBe('≈ 1½ shifts less balanced');
    expect(q(-65)).toBe('≈ ½ shift more balanced');
  });

  it('Potential Issues change is counted both ways', () => {
    const tail = (a, b) => describeDifference(scenario, sol(base, 100, a), sol(base, 100, b)).lines.at(-1);
    expect(tail(2, 3)).toBe('Equally good · 1 more potential issue');
    expect(tail(3, 1)).toBe('Equally good · 2 fewer potential issues');
  });

  it('at most three lines and three people; the rest are summarised', () => {
    const roster = { residents: ['A', 'B', 'C', 'D'].map(name => ({ name })) };
    const t = { A: tot(1), B: tot(1), C: tot(1), D: tot(1) };
    const a = sched({ off: { '2026-10-06': ['A', 'B', 'C', 'D'] }, totals: t });
    const b = sched({ off: { '2026-10-07': ['A', 'B', 'C', 'D'] }, night: { '2026-10-04': 'A' }, totals: t });
    const r = describeDifference(roster, sol(a, 0), sol(b, 300, 9));
    expect(r.lines).toHaveLength(3);
    expect(r.lines[0]).toBe('A: off Oct 6→Oct 7; B: off Oct 6→Oct 7; C: off Oct 6→Oct 7; +1 more');
    expect(r.stats.offsMoved).toBe(4);
    expect(r.lines.join(' ')).not.toMatch(/%|objective/i);
  });
});

describe('describeDifference on a real month', () => {
  it('without `issues`, counts Potential Issues the way the UI does (every audit finding)', async () => {
    const s = parseScenario(structuredClone(feb));
    const base = await solve(s);
    const alt = structuredClone(base);
    // Move one of Intern2's days off by hand onto a call day: the auditor will object.
    const from = Object.keys(alt.schedule.days).find(d => alt.schedule.days[d].off.includes('Intern2'));
    const to = Object.keys(alt.schedule.days).find(d => alt.schedule.days[d].type === 'call');
    alt.schedule.days[from].off = alt.schedule.days[from].off.filter(n => n !== 'Intern2');
    alt.schedule.days[to].off.push('Intern2');
    const count = sch => { const a = audit(s, sch); return a.violations.length + a.warnings.length; };
    const r = describeDifference(s, base, alt);
    expect(r.stats.issuesDelta).toBe(count(alt.schedule) - count(base.schedule));
    expect(r.stats.issuesDelta).toBeGreaterThan(0);
    expect(r.lines[0]).toMatch(/^Intern2: off Feb \d+→Feb \d+$/);
  }, 60000);
});
