import { describe, it, expect } from 'vitest';
import { buildModel, WEIGHTS } from '../src/milp.js';
import { parseScenario, deriveCycle } from '../src/model.js';
import feb from '../fixtures/feb-2026.json';
import medc from '../fixtures/comp-medc.json';
import s2i1 from '../fixtures/comp-2s1i.json';

const kindsFor = (vars, kind) => [...vars.entries()].filter(([, m]) => m.kind === kind);

describe('buildModel(feb-2026) structure', () => {
  const s = parseScenario(feb);
  const { lp, vars } = buildModel(s);
  const { types } = deriveCycle(s.anchorType, s.month);

  it('no off vars on call/post-call days', () =>
    expect(kindsFor(vars, 'off')
      .filter(([, m]) => ['call', 'postcall'].includes(types.get(m.date)))).toEqual([]));

  it('no pager vars on call days; none for Intern2 on his PM clinic dates', () => {
    const pagers = kindsFor(vars, 'pager');
    expect(pagers.filter(([, m]) => types.get(m.date) === 'call')).toEqual([]);
    expect(pagers.filter(([, m]) =>
      m.person === 'Intern2' && ['2026-02-03', '2026-02-10'].includes(m.date))).toEqual([]);
  });

  it('nights Feb 5/11 intern-only; Feb 17/23 fairness-decided (all 3 remaining people)', () => {
    const nights = kindsFor(vars, 'night');
    expect(new Set(nights.filter(([, m]) => m.date === '2026-02-05').map(([, m]) => m.person)))
      .toEqual(new Set(['Intern1', 'Intern2']));
    expect(nights.filter(([, m]) => m.date === '2026-02-17').length).toBe(3);
  });

  it('Intern1 quota row = 2 with zero slack headroom (floor max(q-1,2) = 2)', () => {
    expect(lp).toMatch(/q_0:.* = 2/);
    expect(lp).toMatch(/0 <= short_0 <= 0/);
  });

  it('consecutive-night slack vars exist; no 2S+1I alternation rows (partial window)', () => {
    expect(kindsFor(vars, 'consec').length).toBeGreaterThan(0);
    expect(lp).not.toMatch(/alt_/);
  });
});

it('2S+1I whole-month fixture gets alternation rows', () =>
  expect(buildModel(parseScenario(s2i1)).lp).toMatch(/alt_/));

it('Med C fixture: night vars exist for seniors', () =>
  expect(kindsFor(buildModel(parseScenario(medc)).vars, 'night').length).toBeGreaterThan(0));

it('weight-ladder invariants (trade-off regression guard)', () => {
  expect(WEIGHTS.seniorOffSC).toBeGreaterThan(WEIGHTS.offSpread + WEIGHTS.morningReport + WEIGHTS.multiOff);
  expect(WEIGHTS.stability).toBeGreaterThan(300);
  expect(WEIGHTS.consecSlack).toBeGreaterThan(WEIGHTS.quotaShort);
  expect(WEIGHTS.quotaShort).toBeGreaterThan(WEIGHTS.didacticsEscape);
  expect(WEIGHTS.didacticsEscape).toBeGreaterThanOrEqual(WEIGHTS.attendingPager);
});
