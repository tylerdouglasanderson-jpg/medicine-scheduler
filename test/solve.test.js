import { describe, it, expect, beforeAll } from 'vitest';
import { solve } from '../src/solve.js';
import { audit } from '../src/audit.js';
import { validate } from '../src/validate.js';
import { parseScenario, deriveCycle, quotaFor, solutionIsCurrent, RULES_VERSION } from '../src/model.js';
import feb from '../fixtures/feb-2026.json';
import oct from '../fixtures/oct-2026-didactics.json';
import stale from '../fixtures/oct-2026-stale-solution.json';

const CALLS = ['2026-02-05', '2026-02-11', '2026-02-17', '2026-02-23'];
const nextDate = d => { const [y, m, dd] = d.split('-').map(Number);
  const n = new Date(y, m - 1, dd + 1);
  return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0'); };

describe('feb-2026 golden solve (Node)', () => {
  let s, schedule, warnings;
  beforeAll(async () => {
    s = parseScenario(feb);
    ({ schedule, warnings } = await solve(s));
  });

  it('zero audit violations', () => expect(audit(s, schedule).violations).toEqual([]));

  it('off counts = quota EXACTLY for everyone (hard line); Intern1 2 on a half window', () => {
    for (const r of s.residents) expect(schedule.totals[r.name].off).toBe(quotaFor(r, s));
    expect(schedule.totals.Intern1.off).toBe(2);   // Feb 1-15 = 15/28 days -> 4 * 15/28 rounds to 2
    expect(warnings.some(w => w.code === 'W_QUOTA_SHORT')).toBe(false);
  });

  it('no offs on call/post-call; night workers sleep next day', () => {
    const { types } = deriveCycle(s.anchorType, s.month);
    for (const [d, day] of Object.entries(schedule.days)) {
      if (['call', 'postcall'].includes(types.get(d))) expect(day.off).toEqual([]);
      if (types.get(d) === 'call' && schedule.days[nextDate(d)])
        expect(schedule.days[nextDate(d)].sleeper).toBe(day.night);
    }
  });

  it('Intern1: nothing after Feb 15; exactly one night across Feb 5+11 (Intern2 the other)', () => {
    for (const [d, day] of Object.entries(schedule.days))
      if (d > '2026-02-15')
        expect([...day.working, ...day.off, day.pager, day.night, day.sleeper]).not.toContain('Intern1');
    expect(['2026-02-05', '2026-02-11'].map(d => schedule.days[d].night).sort())
      .toEqual(['Intern1', 'Intern2']);
  });

  it('call days: no pager, one night, everyone on service works', () => {
    for (const c of CALLS) {
      const day = schedule.days[c];
      expect(day.pager).toBeNull();
      expect(day.night).toBeTruthy();
      for (const r of s.residents)
        if (r.serviceStart <= c && c <= r.serviceEnd && !r.pto.includes(c))
          expect(day.working).toContain(r.name);
    }
  });

  it('post-call pager: Feb 6/12 = prior day-call intern; Feb 18/24 = working senior when none', () => {
    for (const c of ['2026-02-05', '2026-02-11'])
      expect(schedule.days[nextDate(c)].pager).toBe(schedule.days[c].dayCall.intern);
    for (const c of ['2026-02-17', '2026-02-23'])
      if (!schedule.days[c].dayCall.intern)
        expect(['Senior1', 'Senior2']).toContain(schedule.days[nextDate(c)].pager);
  });

  it('Feb 12 is post-call: the day-call intern pages and no didactics warning is raised', () => {
    // Nobody attends didactics on a post-call day (program rule, 2026-08), so the pager there costs
    // nobody a session — this used to raise W_DIDACTICS_MISS against the holder.
    const holder = schedule.days['2026-02-12'].pager;
    expect(holder).toBe(schedule.days['2026-02-11'].dayCall.intern);
    expect(warnings.some(w => w.code === 'W_DIDACTICS_MISS' && w.date === '2026-02-12')).toBe(false);
    expect(audit(s, schedule).warnings.some(w => w.date === '2026-02-12' && w.code.startsWith('W_DIDACTICS')))
      .toBe(false);
  });

  it('Senior1 idle on PTO day Feb 20', () => {
    const day = schedule.days['2026-02-20'];
    expect(day.working).not.toContain('Senior1');
    expect(day.pager).not.toBe('Senior1');
  });

  it('spread + SC properties (expected.md)', () => {
    const allDates = Object.keys(schedule.days).sort();
    // (a) sliding 7-day window: no person has 3+ counted offs in any window
    const freeOf = name => new Set(s.pins.filter(p => p.person === name && p.type === 'offFree').map(p => p.date));
    for (const r of s.residents) {
      const free = freeOf(r.name);
      const offDates = allDates.filter(d => schedule.days[d].off.includes(r.name) && !free.has(d));
      for (let i = 0; i < allDates.length; i++) {
        const lo = allDates[i], hi = allDates[Math.min(i + 6, allDates.length - 1)];
        expect(offDates.filter(d => d >= lo && d <= hi).length).toBeLessThan(3);
      }
    }
    // (b) no senior off on a WEEKDAY sc1/sc2 unless a warning names it; weekend SC is never warned
    const { types } = deriveCycle(s.anchorType, s.month);
    const seniors = new Set(s.residents.filter(r => r.role === 'senior').map(r => r.name));
    const weekend = d => [0, 6].includes(new Date(2026, 1, Number(d.slice(8))).getDay());
    for (const [d, day] of Object.entries(schedule.days)) {
      if (!['sc1', 'sc2'].includes(types.get(d))) continue;
      for (const name of day.off)
        if (seniors.has(name))
          expect(warnings.some(w => w.code === 'W_SENIOR_OFF_SC' && w.person === name && w.date === d))
            .toBe(!weekend(d));
    }
  });
});

describe('variants', () => {
  it('pin variant: Senior2 offCounted 2026-02-26 honored, violation-free, still 4 offs', async () => {
    const s = parseScenario({ ...feb, pins: [{ person: 'Senior2', date: '2026-02-26', type: 'offCounted' }] });
    const { schedule } = await solve(s);
    expect(schedule.days['2026-02-26'].off).toContain('Senior2');
    expect(audit(s, schedule).violations).toEqual([]);
    expect(schedule.totals.Senior2.off).toBe(4);
  });

  it('Med C: seniors take nights, sleeper never same-day day-call senior, audit clean', async () => {
    const s = parseScenario((await import('../fixtures/comp-medc.json')).default);
    const { schedule } = await solve(s);
    expect(audit(s, schedule).violations).toEqual([]);
  });

  it('3-intern team: post-call pager always a prior-day day-call intern, audit clean', async () => {
    const s = parseScenario((await import('../fixtures/comp-3intern.json')).default);
    const { schedule } = await solve(s);
    expect(audit(s, schedule).violations).toEqual([]);
  });

  it('2S+1I whole month: each senior exactly 1 night, intern the rest, audit clean', async () => {
    const s = parseScenario((await import('../fixtures/comp-2s1i.json')).default);
    const { schedule } = await solve(s);
    expect(audit(s, schedule).violations).toEqual([]);
    const seniors = s.residents.filter(r => r.role === 'senior').map(r => r.name);
    for (const sn of seniors)
      expect(Object.values(schedule.days).filter(d => d.night === sn).length).toBe(1);
  });

  it('re-solve stability: one added PTO day changes <= 8 decision cells', async () => {
    const base = parseScenario(feb);
    const first = await solve(base);
    const tweaked = parseScenario(structuredClone({ ...feb, lastSolution: first.schedule }));
    tweaked.residents.find(r => r.name === 'Intern2').pto.push('2026-02-09');
    const second = await solve(tweaked);
    expect(audit(tweaked, second.schedule).violations).toEqual([]);
    let changed = 0;
    for (const d of Object.keys(first.schedule.days)) {
      const a = first.schedule.days[d], b = second.schedule.days[d];
      if (a.night !== b.night) changed++;
      if (a.pager !== b.pager) changed++;
      changed += a.off.filter(n => !b.off.includes(n)).length + b.off.filter(n => !a.off.includes(n)).length;
    }
    expect(changed).toBeLessThanOrEqual(8);
  });

  it('no resident is off on a day they have a commitment (clinic)', async () => {
    const s = parseScenario(feb);
    const { schedule } = await solve(s);
    for (const r of s.residents)
      for (const c of r.commitments)
        expect(schedule.days[c.date]?.off ?? []).not.toContain(r.name);
  });

  it('validate rejects an off pin on a commitment day', () => {
    const r = feb.residents.find(x => (x.commitments ?? []).length);
    const s = parseScenario({ ...feb, pins: [{ person: r.name, date: r.commitments[0].date, type: 'offCounted' }] });
    expect(validate(s).map(e => e.code)).toContain('OFF_ON_COMMITMENT');
  });

  it('auditor independently flags an off on a commitment day', async () => {
    const s = parseScenario(feb);
    const { schedule } = await solve(s);
    const r = s.residents.find(x => x.commitments.length);
    const d = r.commitments[0].date;
    const bad = structuredClone(schedule);
    bad.days[d].off = [...bad.days[d].off.filter(n => n !== r.name), r.name];
    expect(audit(s, bad).violations.map(v => v.code)).toContain('A_OFF_ON_COMMITMENT');
  });

  it('seniors are not off on the first day of the month', async () => {
    const s = parseScenario(feb);
    const { schedule } = await solve(s);
    for (const name of s.residents.filter(r => r.role === 'senior').map(r => r.name))
      expect(schedule.days[s.month + '-01'].off).not.toContain(name);
  });

  it('contradictory pins produce a staged diagnosis naming culprits', async () => {
    // individually legal, jointly infeasible: nightCall Intern2 2026-02-05 forces him asleep 2026-02-06,
    // but pager Intern2 2026-02-06 needs him awake to page (sleeper cannot hold the pager).
    const s = parseScenario({ ...feb, pins: [
      { person: 'Intern2', date: '2026-02-05', type: 'nightCall' },
      { person: 'Intern2', date: '2026-02-06', type: 'pager' }] });
    const r = await solve(s);
    expect(r.infeasible.diagnosis).toMatch(/pin/i);
    expect(r.infeasible.culprits.length).toBeGreaterThan(0);
  });

  it('an unreachable off quota is named as the culprit, not "over-constrained inputs"', async () => {
    // Three residents on team F: the day team needs 2, so at most one person is off on any day,
    // yet each is owed 10. Each has enough eligible days (validate passes) — only the solve can
    // find that they can't all have them.
    const s = parseScenario({
      ...feb,
      options: { ...feb.options, offQuota: 10 },
      residents: feb.residents.filter(r => ['Intern2', 'Senior1', 'Senior2'].includes(r.name))
        .map(r => ({ ...r, pto: [], commitments: [], serviceStart: '2026-02-01', serviceEnd: '2026-02-28' })),
    });
    expect(validate(s)).toEqual([]);
    const r = await solve(s);
    expect(r.infeasible.diagnosis).toMatch(/off quota/i);
    expect(r.infeasible.culprits.length).toBeGreaterThan(0);
  });

  it('a two-person team (1 intern + 1 senior) gets full quota: one resident runs the day alone', async () => {
    // Program rule (2026-10): on a 1+1 team a single resident covering the day is the expectation.
    // Before v0.9.0 the floor of 2 made every day off impossible and the month was infeasible.
    const s = parseScenario({
      ...feb,
      residents: feb.residents.filter(r => ['Intern2', 'Senior1'].includes(r.name))
        .map(r => ({ ...r, pto: [], commitments: [], serviceStart: '2026-02-01', serviceEnd: '2026-02-28' })),
    });
    const r = await solve(s);
    expect(r.infeasible).toBeUndefined();
    expect(audit(s, r.schedule).violations).toEqual([]);
    for (const p of s.residents) expect(r.schedule.totals[p.name].off).toBe(quotaFor(p, s));
    const alone = Object.values(r.schedule.days).filter(day => day.off.length === 1);
    expect(alone.length).toBeGreaterThan(0);
  });

  it('seniorsOffShortCall silences every short-call warning and the month stays audit-clean', async () => {
    const s = parseScenario({ ...feb, options: { ...feb.options, seniorsOffShortCall: true } });
    const r = await solve(s);
    const a = audit(s, r.schedule);
    expect(a.violations).toEqual([]);
    expect([...r.warnings, ...a.warnings].filter(w => w.code === 'W_SENIOR_OFF_SC')).toEqual([]);
  });
});

// --- didactics protection (program rule, 2026-08) -------------------------------------------------
// Regression for the reported "the senior gets didactics, the interns don't". The old model had a
// senior-only didactics term and no off-on-didactics penalty at all, so this exact month solved to
// senior 3/4, interns 1/4 and 0/4, with six teaching afternoons spent as days off.
describe('oct-2026 didactics protection', () => {
  let s, schedule;
  beforeAll(async () => {
    s = parseScenario(oct);
    ({ schedule } = await solve(s));
  });

  const dowOf = d => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).getDay(); };

  it('zero audit violations', () => expect(audit(s, schedule).violations).toEqual([]));

  it('everyone attends every session the month can offer — interns included', () => {
    for (const r of s.residents) {
      const t = schedule.totals[r.name];
      expect(t.didacticsOf).toBeGreaterThan(0);
      expect(t.didactics).toBe(t.didacticsOf);
    }
  });

  it('no day off is ever placed on the resident’s own didactics day', () => {
    for (const r of s.residents)
      for (const [d, day] of Object.entries(schedule.days))
        if (day.off.includes(r.name)) expect(dowOf(d)).not.toBe(r.didactics.dow);
  });

  it('committed afternoons (clinic PM + didactics + pager) come out within one of each other', () => {
    const { types } = deriveCycle(s.anchorType, s.month);
    const load = r => {
      const svc = Object.keys(schedule.days).filter(d => r.serviceStart <= d && d <= r.serviceEnd && !r.pto.includes(d));
      return svc.filter(d => r.commitments.some(c => c.date === d && c.half === 'PM')).length
        + svc.filter(d => dowOf(d) === r.didactics.dow && types.get(d) !== 'call').length
        + schedule.totals[r.name].pager;
    };
    const loads = s.residents.map(load);
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(1);
  });

  it('the senior no longer hides from the pager: every intern carries fewer than twice the senior', () => {
    const senior = s.residents.find(r => r.role === 'senior');
    for (const r of s.residents.filter(r => r.role === 'intern'))
      expect(schedule.totals[r.name].pager).toBeLessThan(2 * schedule.totals[senior.name].pager);
  });

  it('tethered didactics are flagged, and handing those afternoons to the attending clears them', async () => {
    const TETHER = ['W_DIDACTICS_PAGER', 'W_DIDACTICS_PAGER_INTERN'];
    const flagged = audit(s, schedule).warnings.filter(w => TETHER.includes(w.code));
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.every(w => w.attendingCanCover)).toBe(true);

    const s2 = parseScenario({ ...oct, attendingPagerDays: flagged.map(w => w.date) });
    expect(validate(s2)).toEqual([]);
    const { schedule: sch2 } = await solve(s2);
    expect(audit(s2, sch2).violations).toEqual([]);
    for (const d of s2.attendingPagerDays) expect(sch2.days[d].pager).toBe('ATTENDING');
    for (const r of s2.residents) {
      expect(sch2.totals[r.name].didactics).toBe(sch2.totals[r.name].didacticsOf);
      expect(sch2.totals[r.name].didacticsPager).toBe(0);
    }
  });
});

// --- a scenario file must survive a rule change (program rule, 2026-08) --------------------------------
// The co-resident's real Oct-2026 file, saved by v0.5.0. Re-solving it used to return the OLD
// schedule almost unchanged: the stability term (3000 per changed binary) anchored on the saved
// answer, so the only way to feel a new rule was Clear scenario and re-typing the whole month.
describe('re-solving a file saved under older rules', () => {
  it('the saved schedule is recognised as stale, not current', () => {
    expect(solutionIsCurrent(parseScenario(stale))).toBe(false);
    expect(parseScenario(stale).lastSolution).toBeTruthy();   // still shown, just not authoritative
  });

  it('re-solves to the CURRENT optimum without clearing — inputs all preserved', async () => {
    const s = parseScenario(stale);
    expect(s.residents).toHaveLength(3);                       // roster, clinics, PTO untouched
    expect(s.residents[0].commitments.length).toBeGreaterThan(0);

    const { schedule } = await solve(s);
    expect(audit(s, schedule).violations).toEqual([]);
    for (const r of s.residents)
      expect(schedule.totals[r.name].didactics).toBe(schedule.totals[r.name].didacticsOf);
    expect(schedule.rulesVersion).toBe(RULES_VERSION);
  });

  it('a solution this build produced DOES still anchor stability', async () => {
    const s = parseScenario(stale);
    const { schedule } = await solve(s);
    expect(solutionIsCurrent({ lastSolution: schedule })).toBe(true);

    const again = parseScenario({ ...stale, lastSolution: schedule });
    const { schedule: s2 } = await solve(again);
    let changed = 0;
    for (const d of Object.keys(schedule.days)) {
      const a = schedule.days[d], b = s2.days[d];
      changed += a.off.filter(n => !b.off.includes(n)).length + (a.pager === b.pager ? 0 : 1);
    }
    expect(changed).toBe(0);                                   // identical: stability held
  });
});

describe('scenario normalization', () => {
  it('drops what can no longer point at anything real', () => {
    const s = parseScenario({
      ...oct,
      pins: [
        { person: 'Alvarez', date: '2026-10-06', type: 'work', half: null, note: '' },   // keep
        { person: 'Nobody', date: '2026-10-06', type: 'work', half: null, note: '' },    // gone: no such resident
        { person: 'Alvarez', date: '2026-11-06', type: 'work', half: null, note: '' },   // gone: another month
      ],
      notes: [{ date: '2026-10-06', text: 'keep' }, { date: '2026-12-06', text: 'gone' }],
      attendingPagerDays: ['2026-10-07', '2026-10-07', '2026-11-07'],
    });
    expect(s.pins).toHaveLength(1);
    expect(s.pins[0].person).toBe('Alvarez');
    expect(s.notes).toHaveLength(1);
    expect(s.attendingPagerDays).toEqual(['2026-10-07']);      // deduped, out-of-month dropped
  });

  it('drops a saved schedule that belongs to another month or a since-changed roster', () => {
    const feb2 = parseScenario(feb);
    expect(parseScenario({ ...oct, lastSolution: { days: { '2026-02-01': {} }, totals: {} } }).lastSolution).toBeNull();
    expect(parseScenario({ ...oct, lastSolution: { ...stale.lastSolution, totals: { Ghost: {} } } }).lastSolution).toBeNull();
    expect(feb2.lastSolution).toBeNull();                      // the golden fixture ships unsolved
  });
});
