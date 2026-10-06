import { describe, it, expect } from 'vitest';
import { buildModel, WEIGHTS, NO_DIDACTICS } from '../src/milp.js';
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

  it('Intern1 quota row = 2 (half window) and is a hard equality — no slack var at all', () => {
    expect(lp).toMatch(/q_0:.* = 2/);
    expect(lp).not.toMatch(/short_/);
  });

  it('opts.elasticQuota re-adds the slack (diagnosis path only)', () => {
    const el = buildModel(parseScenario(feb), null, { elasticQuota: true });
    expect(el.lp).toMatch(/short_0/);
    expect(el.lp).toMatch(/q_0:.*short_0.* = 2/);
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

// Didactics tiering (program rule, 2026-08). The ordering is load-bearing, not cosmetic: when the pager
// penalty is raised above the sleep/off ones the solver starts trading an ATTENDED-but-tethered
// afternoon for an outright miss, which is strictly worse for the resident.
describe('didactics + afternoon-load weights', () => {
  it('per role, being tethered to the pager always beats not attending at all', () => {
    expect(WEIGHTS.didacticsPager).toBeLessThan(WEIGHTS.didacticsOff);
    expect(WEIGHTS.didacticsPagerIntern).toBeLessThan(WEIGHTS.didacticsOff * WEIGHTS.didacticsIntern);
  });

  it('an intern tethered to the pager costs far more than a senior — only a senior should normally do it', () =>
    expect(WEIGHTS.didacticsPagerIntern).toBeGreaterThan(3 * WEIGHTS.didacticsPager));

  it('a pager on a call or post-call day is never priced as a didactics loss', () => {
    expect([...NO_DIDACTICS].sort()).toEqual(['call', 'postcall']);
    const s = parseScenario(feb);
    const { lp } = buildModel(s);
    const objective = lp.split('Subject To')[0];
    const { types } = deriveCycle(s.anchorType, s.month);
    const dow = d => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).getDay(); };
    let checked = 0;
    for (const r of s.residents) {
      if (!r.didactics) continue;
      for (const [d, t] of types) {
        if (t !== 'postcall' || dow(d) !== r.didactics.dow) continue;   // call days have no pager var at all
        const name = `pager_${s.residents.indexOf(r)}_${Number(d.slice(8)) - 1}`;
        expect(objective).not.toContain(` ${name} `);
        expect(objective).not.toContain(` ${name}\n`);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);   // the fixture really does exercise this
  });

  it('no off-placement reward can buy a teaching afternoon', () =>
    expect(WEIGHTS.didacticsOff)
      .toBeGreaterThan(WEIGHTS.offPrecall + WEIGHTS.offSc2 + WEIGHTS.offSpread));

  it('interns’ teaching time outranks the senior’s', () =>
    expect(WEIGHTS.didacticsIntern).toBeGreaterThan(1));

  it('a chief-chosen attending day is forced and costs nothing; other days stay near-forbidden', () => {
    const s = parseScenario({ ...feb, attendingPagerDays: ['2026-02-02'] });
    const { lp } = buildModel(s);
    const [obj] = lp.split('Subject To');
    expect(lp).toContain('attfix_1: 1 att_1 = 1');
    expect(obj).not.toContain(' att_1 ');            // forced, so no attending penalty for that day
    expect(obj).toContain(` ${WEIGHTS.attendingPager} att_2`);   // every other day still priced
  });
});

// Senior short-call offs (program rule, 2026-10): weekend short call takes no admissions, and a
// month where interns admit alone can lift the weekday rule too. The first-day rule is separate.
describe('senior short-call + first-day options', () => {
  const objCoef = (lp, name) => {             // sum of `[sign] coef name` terms in the objective
    const toks = lp.slice(lp.indexOf('Minimize'), lp.indexOf('Subject To')).replace('obj:', '').split(/\s+/);
    let c = 0;
    toks.forEach((t, k) => {
      if (t !== name) return;
      c += Number(toks[k - 1]) * (toks[k - 2] === '-' ? -1 : 1);
    });
    return c;
  };
  const offVar = (vars, person, date) =>
    [...vars.entries()].find(([, m]) => m.kind === 'off' && m.person === person && m.date === date)?.[0];
  const solveWith = options => buildModel(parseScenario({ ...feb, options: { ...feb.options, ...options } }));
  const { types } = deriveCycle(feb.anchorType, feb.month);
  const dowOf = d => new Date(2026, 1, Number(d.slice(8))).getDay();
  const scDates = [...types].filter(([, t]) => ['sc1', 'sc2'].includes(t)).map(([d]) => d);
  const base = solveWith({}), lifted = solveWith({ seniorsOffShortCall: true });
  const delta = d => {
    const v = offVar(base.vars, 'Senior1', d);
    return v ? objCoef(base.lp, v) - objCoef(lifted.lp, offVar(lifted.vars, 'Senior1', d)) : null;
  };

  it('a weekday short-call off costs a senior seniorOffSC, and the option lifts it', () => {
    const weekday = scDates.filter(d => ![0, 6].includes(dowOf(d)) && delta(d) !== null);
    expect(weekday.length).toBeGreaterThan(0);
    weekday.forEach(d => expect(delta(d)).toBe(WEIGHTS.seniorOffSC));
  });

  it('a weekend short-call off is never charged, option or not', () => {
    const weekend = scDates.filter(d => [0, 6].includes(dowOf(d)) && delta(d) !== null);
    expect(weekend.length).toBeGreaterThan(0);
    weekend.forEach(d => expect(delta(d)).toBe(0));
  });

  it('seniorFirstDay (default on) charges a senior off on day 1; turning it off removes it', () => {
    const d1 = '2026-02-01';
    const on = solveWith({}), off = solveWith({ seniorFirstDay: false });
    const v = offVar(on.vars, 'Senior1', d1);
    expect(v).toBeTruthy();
    expect(objCoef(on.lp, v) - objCoef(off.lp, offVar(off.vars, 'Senior1', d1))).toBe(WEIGHTS.seniorOffFirstDay);
  });
});

