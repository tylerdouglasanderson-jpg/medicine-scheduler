import { describe, it, expect } from 'vitest';
import { solve } from '../src/solve.js';
import { audit } from '../src/audit.js';
import { parseScenario, RULES_VERSION } from '../src/model.js';
import feb from '../fixtures/feb-2026.json';
import two from '../scenarios/06-two-senior-one-intern-medE.json';
import tight from '../scenarios/12-two-person-1s1i-medE.json';

const held = (sol, name) => Object.values(sol.schedule.days).filter(d => d.type !== 'call' && d.pager === name).length;
const mk = (j, L) => { const s = parseScenario({ ...j, options: { ...j.options, seniorPagerLimit: L } }); s.lastSolution = null; return s; };

describe('senior pager limit (v1.9.0)', () => {
  it('RULES_VERSION bumped', () => expect(RULES_VERSION >= '1.4.0').toBe(true));
  it('normalize keeps only whole numbers 0-4, else null', () => {
    for (const [v, want] of [[2, 2], ['3', 3], [0, 0], ['0', 0], [-1, null], [5, null], [2.5, null], ['', null], [null, null], ['x', null]])
      expect(mk(feb, v).options.seniorPagerLimit, String(v)).toBe(want);
    expect(parseScenario(feb).options.seniorPagerLimit).toBeNull();
  });
  it('holds each senior at or under the limit when the month allows it', async () => {
    const senior = mk(feb, 3).residents.find(r => r.role === 'senior').name;
    const free = await solve(mk(feb, null));
    const capped = await solve(mk(feb, 3));
    expect(held(free, senior)).toBeGreaterThan(3);
    expect(held(capped, senior)).toBeLessThanOrEqual(3);
    const a = audit(mk(feb, 3), capped.schedule);
    expect(a.violations).toEqual([]);
    expect(a.warnings.map(w => w.code)).not.toContain('W_SENIOR_PAGER_OVER');
  });
  it('is breakable: over an unreachable limit it warns, stays valid, and still beats no limit', async () => {
    const s = mk(tight, 1);
    const senior = s.residents.find(r => r.role === 'senior').name;
    const capped = await solve(s);
    const free = await solve(mk(tight, null));
    expect(held(capped, senior)).toBeGreaterThan(1);
    expect(held(capped, senior)).toBeLessThanOrEqual(held(free, senior));
    const a = audit(s, capped.schedule);
    expect(a.violations).toEqual([]);
    expect(a.warnings.map(w => w.code)).toContain('W_SENIOR_PAGER_OVER');
  });
  it('a limit of 0 keeps seniors off the pager when the month allows it', async () => {
    const s = mk(feb, 0);
    const senior = s.residents.find(r => r.role === 'senior').name;
    const free = await solve(mk(feb, null));
    const capped = await solve(s);
    expect(held(capped, senior)).toBeLessThan(held(free, senior));
    expect(audit(s, capped.schedule).violations).toEqual([]);
  });
  it('applies per senior on a two-senior team', async () => {
    const s = mk(two, 1);
    const seniors = s.residents.filter(r => r.role === 'senior').map(r => r.name);
    const free = await solve(mk(two, null));
    const capped = await solve(s);
    const sum = x => seniors.reduce((n, nm) => n + held(x, nm), 0);
    expect(sum(capped)).toBeLessThan(sum(free));
    expect(audit(s, capped.schedule).violations).toEqual([]);
  });
});
