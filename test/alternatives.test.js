import { describe, it, expect, beforeAll } from 'vitest';
import { solve, solveAlternatives, initHighs } from '../src/solve.js';
import { buildModel, ALT_SLACK } from '../src/milp.js';
import { audit } from '../src/audit.js';
import { parseScenario, quotaFor, RULES_VERSION, deriveCycle, monthDates } from '../src/model.js';
import feb from '../fixtures/feb-2026.json';
import oct from '../fixtures/oct-2026-didactics.json';
import twoPerson from '../scenarios/12-two-person-1s1i-medE.json';
import threeIntern from '../scenarios/10-three-intern-medF.json';
import sixCallDays from '../scenarios/32-2s1i-six-call-days.json';

const T = 60000;
// Objectives are HiGHS's full-precision values; MIP tolerances move them in the ~1e-9 relative range.
const tol = z => 1e-6 * Math.max(1, Math.abs(z));
// Off-cell distance, re-derived here rather than trusting solve.js's own.
const offCells = sch => new Set(Object.entries(sch.days).flatMap(([d, day]) => day.off.map(p => `${p}|${d}`)));
const dist = (a, b) => {
  const A = offCells(a), B = offCells(b);
  return [...A].filter(c => !B.has(c)).length + [...B].filter(c => !A.has(c)).length;
};

// Every solution: audit-clean, exact quota, stamped, within the cap; every pair far enough apart.
function assertSolutionSet(s, out, { m0 = null } = {}) {
  const sols = out.solutions;
  expect(sols.length).toBeGreaterThanOrEqual(1);
  expect(sols[0].minOffsMoved).toBeNull();
  for (const x of sols) {
    expect(audit(s, x.schedule).violations).toEqual([]);
    expect(x.schedule.rulesVersion).toBe(RULES_VERSION);
    for (const r of s.residents) expect(x.schedule.totals[r.name].off).toBe(quotaFor(r, s));
  }
  for (const x of sols.slice(1)) {
    expect(x.objective).toBeLessThanOrEqual(out.z0 + ALT_SLACK + tol(out.z0));
    expect(x.objective).toBeGreaterThanOrEqual(out.z0 - tol(out.z0));   // z0 is the optimum
    expect(x.minOffsMoved).toBeGreaterThanOrEqual(1);
    if (m0 !== null) expect([m0, Math.max(1, Math.round(m0 * 0.6))]).toContain(x.minOffsMoved);
  }
  for (let i = 0; i < sols.length; i++)
    for (let j = i + 1; j < sols.length; j++)
      expect(dist(sols[i].schedule, sols[j].schedule)).toBeGreaterThanOrEqual(sols[j].minOffsMoved);
  // Fewer than asked for is only ever said out loud.
  expect(sols.length < 5).toBe(out.stoppedReason !== null);
}

describe.each([
  ['feb-2026 golden', feb],
  ['oct-2026 didactics', oct],
  ['two-person 1S+1I', twoPerson],
  ['three-intern', threeIntern],
])('solveAlternatives: %s', (_, raw) => {
  let s, out, progress;
  beforeAll(async () => {
    s = parseScenario(structuredClone(raw));
    progress = [];
    out = await solveAlternatives(s, { onProgress: p => progress.push(p) });
  }, T);

  it('returns several distinct, audit-clean schedules at exact quota within the quality cap', () => {
    expect(out.solutions.length).toBeGreaterThan(1);
    // No pins or freeze in these months, so every off in Solution 1 is movable.
    assertSolutionSet(s, out, { m0: Math.ceil(0.5 * offCells(out.solutions[0].schedule).size) });
  });

  it('with no saved schedule, Solution 1 is the best schedule itself', () =>
    expect(out.solutions[0].objective).toBeCloseTo(out.z0, 5));

  it('reports progress once per solution, in order, Solution 1 first', () => {
    expect(progress.map(p => p.done)).toEqual(out.solutions.map((_, i) => i + 1));
    expect(progress.every(p => p.total === 5)).toBe(true);
    expect(progress[0].solution.schedule).toBe(out.solutions[0].schedule);
  });
});

describe('Solution 1 is the chosen schedule, changed as little as possible', () => {
  it('anchored on a current lastSolution, it equals the old solve() result', async () => {
    const base = await solve(parseScenario(structuredClone(oct)));
    const s = parseScenario({ ...structuredClone(oct), lastSolution: base.schedule });
    const old = await solve(s);
    const out = await solveAlternatives(s);
    expect(out.solutions[0].schedule).toEqual(old.schedule);
    expect(out.solutions[0].schedule.days).toEqual(base.schedule.days);   // nothing to change
    assertSolutionSet(s, out);
  }, T);
});

describe('freeze, pins and attending days hold in EVERY solution', () => {
  const FREEZE = '2026-02-08';
  let s, out, base, pin, attDay;
  beforeAll(async () => {
    base = (await solve(parseScenario(structuredClone(feb)))).schedule;
    const after = Object.keys(base.days).filter(d => d > FREEZE);
    // Pin Intern2 to WORK on a day he had off, so the pin has to move something.
    pin = { person: 'Intern2', date: after.find(d => base.days[d].off.includes('Intern2')), type: 'work' };
    attDay = after.find(d => ['ppc', 'sc1', 'sc2', 'precall'].includes(base.days[d].type) && d !== pin.date);
    s = parseScenario({ ...structuredClone(feb), lastSolution: base, pins: [pin], attendingPagerDays: [attDay] });
    out = await solveAlternatives(s, { freezeDate: FREEZE });
  }, T);

  it('every solution is valid and the set is distinct', () => {
    expect(out.solutions.length).toBeGreaterThan(1);
    assertSolutionSet(s, out);
  });

  it('frozen days match the saved schedule; the pin and the attending day are honoured', () => {
    for (const { schedule } of out.solutions) {
      for (const d of Object.keys(base.days).filter(x => x <= FREEZE)) {
        expect([...schedule.days[d].off].sort()).toEqual([...base.days[d].off].sort());
        expect(schedule.days[d].night).toBe(base.days[d].night);
        expect(schedule.days[d].pager).toBe(base.days[d].pager);
      }
      expect(schedule.days[pin.date].working).toContain('Intern2');
      expect(schedule.days[attDay].pager).toBe('ATTENDING');
    }
  });
});

describe('2S+1I with six call days (scenario 32, program rule, 2026-10)', () => {
  // Before v1.0.0 each senior took exactly 1 night, so the lone intern took 4 of 6 and had to work
  // two call nights in a row (A_CONSECUTIVE_NIGHTS in every schedule). Now the intern alternates (3)
  // and the seniors split the other 3 as evenly as possible (2 + 1).
  it('every schedule: intern 3 alternating nights, seniors 2 + 1, audit clean', async () => {
    const s = parseScenario(structuredClone(sixCallDays));
    const out = await solveAlternatives(s);
    expect(out.solutions.length).toBeGreaterThan(1);
    const calls = Object.keys(out.solutions[0].schedule.days).filter(d => out.solutions[0].schedule.days[d].type === 'call').sort();
    expect(calls).toHaveLength(6);
    for (const { schedule } of out.solutions) {
      expect(audit(s, schedule).violations).toEqual([]);
      const nights = calls.map(d => schedule.days[d].night);
      const count = name => nights.filter(n => n === name).length;
      expect(count('Eastman')).toBe(3);
      for (let i = 1; i < nights.length; i++) expect(nights[i] === 'Eastman' && nights[i - 1] === 'Eastman').toBe(false);
      expect([count('Calloway'), count('Dalby')].sort()).toEqual([1, 2]);
    }
  }, T);

  it('the auditor flags a lopsided senior split on its own (A_NIGHT_SPLIT)', async () => {
    const s = parseScenario(structuredClone(sixCallDays));
    const { schedule } = await solve(s);
    const calls = Object.keys(schedule.days).filter(d => schedule.days[d].type === 'call').sort();
    const bad = structuredClone(schedule);
    const seniorDays = calls.filter(d => bad.days[d].night !== 'Eastman');
    for (const d of seniorDays) bad.days[d].night = 'Calloway';            // 3 + 0
    expect(audit(s, bad).violations.map(v => v.code)).toContain('A_NIGHT_SPLIT');
  }, T);
});

describe('the browser gets to paint between solves', () => {
  // HiGHS is synchronous; without a macrotask yield after each progress event the page would freeze
  // until every solution was built. A timer set inside onProgress must fire before the next event.
  it('a timer scheduled in onProgress fires before the next progress event', async () => {
    const events = [];
    await solveAlternatives(parseScenario(structuredClone(feb)), {
      onProgress: ({ done }) => { events.push(`p${done}`); setTimeout(() => events.push(`t${done}`), 0); },
    });
    const ps = events.filter(e => e.startsWith('p'));
    expect(ps.length).toBeGreaterThan(1);
    for (let k = 1; k < ps.length; k++) {
      expect(events).toContain(`t${k}`);
      expect(events.indexOf(`t${k}`)).toBeLessThan(events.indexOf(`p${k + 1}`));
    }
  }, T);
});

describe('stopping short', () => {
  it('a month frozen almost to the end returns fewer than 5, with a plain reason', async () => {
    const base = (await solve(parseScenario(structuredClone(feb)))).schedule;
    const s = parseScenario({ ...structuredClone(feb), lastSolution: base });
    const out = await solveAlternatives(s, { freezeDate: '2026-02-24' });
    expect(out.solutions.length).toBeLessThan(5);
    expect(out.stoppedReason).toMatch(/meaningfully different/);
    expect(out.stoppedReason).not.toMatch(/%|objective/);
    assertSolutionSet(s, out);
  }, T);

  it('a fully frozen month has exactly one schedule and says so', async () => {
    const base = (await solve(parseScenario(structuredClone(feb)))).schedule;
    const s = parseScenario({ ...structuredClone(feb), lastSolution: base });
    const out = await solveAlternatives(s, { freezeDate: '2026-02-28' });
    expect(out.solutions).toHaveLength(1);
    expect(out.stoppedReason).toMatch(/pinned or frozen/);
  }, T);

  it('an infeasible month comes back exactly as solve() reports it', async () => {
    const s = parseScenario({ ...structuredClone(feb), pins: [   // the contradictory pins from solve.test.js
      { person: 'Intern2', date: '2026-02-05', type: 'nightCall' },
      { person: 'Intern2', date: '2026-02-06', type: 'pager' }] });
    const r = await solveAlternatives(s);
    expect(r.infeasible).toBeTruthy();
    expect(r).toEqual(await solve(s));
  }, T);
});

describe('buildModel alternative options', () => {
  const s = parseScenario(structuredClone(feb));

  it('defaults leave the model untouched', () => {
    const a = buildModel(s), b = buildModel(s, null, { stability: true, distinctFrom: [], minOffsMoved: 0, objCap: null });
    expect(b.lp).toBe(a.lp);
    expect(a.lp).not.toMatch(/objcap|dist_/);
  });

  it('stability:false drops the anchor; the returned objective never contains it', async () => {
    const { schedule } = await solve(s);
    const anchored = parseScenario({ ...structuredClone(feb), lastSolution: schedule });
    const on = buildModel(anchored), off = buildModel(anchored, null, { stability: false });
    expect(on.lp).not.toBe(off.lp);
    expect(off.lp).toBe(buildModel(s).lp);                   // same as never having had a schedule
    expect([...on.objective]).toEqual([...off.objective]);
  });

  it('objCap and distinctFrom add one row each per reference', async () => {
    const { schedule } = await solve(s);
    const m = buildModel(s, null, { stability: false, objCap: 500, distinctFrom: [schedule, schedule], minOffsMoved: 3 });
    expect(m.lp).toMatch(/objcap: .* <= 500/);
    expect(m.lp.match(/ dist_\d+: /g)).toHaveLength(2);
  });

  it('pinned and frozen off cells are not movable', async () => {
    const all = buildModel(s).movableOffs.map(([, m]) => m);
    const target = all.find(m => m.person === 'Intern2' && m.date > '2026-02-10');   // a real off var
    const { schedule } = await solve(s);
    const pinned = parseScenario({ ...structuredClone(feb), lastSolution: schedule,
      pins: [{ person: 'Intern2', date: target.date, type: 'work' }] });
    const mv = buildModel(pinned, '2026-02-10').movableOffs.map(([, m]) => m);
    expect(all.some(m => m.date <= '2026-02-10')).toBe(true);
    expect(mv.length).toBeGreaterThan(0);
    expect(mv.some(m => m.date <= '2026-02-10')).toBe(false);
    expect(mv.some(m => m.person === 'Intern2' && m.date === target.date)).toBe(false);
  });
});

describe('alternatives never add a 100k+ penalty event (Astra review, 2026-10-06)', () => {
  // Two-person Feb, quota 3. The senior has hard Tue didactics, the intern hard Thu; the intern's
  // only clinic-free days are Tue/Thu. An intern off on a Thursday breaks hard didactics; off on a
  // Tuesday, the senior can't take the pager (hard didactics) so the attending must. Both cost 100k,
  // so without category caps an alternative swapped one for the other and stayed under z0 + 130.
  const month = '2026-02';
  const dows = d => new Date(2026, 1, Number(d.slice(8))).getDay();
  const build = () => {
    const free = d => !['call', 'postcall'].includes(deriveCycle('ppc', month).types.get(d));
    const dates = monthDates(month);
    return parseScenario({
      team: 'E', month, anchorType: 'ppc', carryIn: null, options: { offQuota: 3 },
      residents: [
        { name: 'Sen', role: 'senior', kind: 'categorical', serviceStart: '2026-02-01', serviceEnd: '2026-02-28',
          didactics: { dow: 2, half: 'PM', hard: true }, commitments: [], pto: [] },
        { name: 'Int', role: 'intern', kind: 'categorical', serviceStart: '2026-02-01', serviceEnd: '2026-02-28',
          didactics: { dow: 4, half: 'PM', hard: true }, pto: [],
          commitments: dates.filter(d => free(d) && ![2, 4].includes(dows(d))).map(d => ({ date: d, half: 'AM', label: 'clinic' })) },
      ],
      pins: dates.filter(d => free(d) && ![2, 4].includes(dows(d))).slice(0, 3)
        .map(d => ({ person: 'Sen', date: d, type: 'offCounted', half: null, note: '' })),
    });
  };
  const events = (s, sch) => ({
    att: Object.entries(sch.days).filter(([d, dd]) => dd.pager === 'ATTENDING' && !s.attendingPagerDays.includes(d)).length,
    escape: s.residents.filter(r => r.didactics?.hard).reduce((n, r) => n + Object.entries(sch.days)
      .filter(([d, dd]) => dows(d) === r.didactics.dow && dd.off.includes(r.name)).length, 0),
  });

  it('no alternative has more attending-pager days or didactics escapes than Solution 1', async () => {
    const s = build();
    const out = await solveAlternatives(s);
    expect(out.infeasible).toBeFalsy();
    const base = events(s, out.solutions[0].schedule);
    expect(base.att + base.escape).toBeGreaterThan(0);              // the premise: Solution 1 pays some
    for (const x of out.solutions.slice(1)) {
      const e = events(s, x.schedule);
      expect(e.att).toBeLessThanOrEqual(base.att);
      expect(e.escape).toBeLessThanOrEqual(base.escape);
    }
  }, T);

  it('buildModel emits the category rows only when asked', () => {
    const s = build();
    expect(buildModel(s).lp).not.toMatch(/ccap_/);
    const lp = buildModel(s, null, { stability: false, categoryCaps: { att: 1, escape: 2, consec: 0 } }).lp;
    expect(lp).toMatch(/ccap_att: .* <= 1/);
    expect(lp).toMatch(/ccap_escape: .* <= 2/);
  });
});

describe('a stale Freeze-through date freezes nothing without a saved schedule (Astra review)', () => {
  it('buildModel: no freeze rows and every off stays movable', () => {
    const s = parseScenario(structuredClone(feb));
    const frozen = buildModel(s, '2026-02-28');
    expect(frozen.lp).not.toMatch(/pin_frz_/);
    expect(frozen.movableOffs.length).toBe(buildModel(s).movableOffs.length);
  });

  it('solveAlternatives still builds alternatives', async () => {
    const out = await solveAlternatives(parseScenario(structuredClone(feb)), { freezeDate: '2026-02-28' });
    expect(out.solutions.length).toBeGreaterThan(1);
    expect(out.stoppedReason ?? '').not.toMatch(/pinned or frozen/);
  }, T);
});

describe('objective is HiGHS full precision, stability subtracted exactly (Astra review)', () => {
  it('unanchored: equals HiGHS ObjectiveValue bit for bit', async () => {
    const s = parseScenario(structuredClone(oct));
    const { objective } = await solve({ ...s, lastSolution: null });
    const highs = await initHighs();
    expect(objective).toBe(highs.solve(buildModel({ ...s, lastSolution: null }).lp, { output_flag: false }).ObjectiveValue);
  }, T);

  it('anchored on its own schedule: the stability-free objective matches the unanchored one', async () => {
    const s = parseScenario(structuredClone(oct));
    const first = await solve({ ...s, lastSolution: null });
    const again = await solve({ ...s, lastSolution: first.schedule });
    expect(Math.abs(again.objective - first.objective)).toBeLessThan(tol(first.objective));
  }, T);
});
