import { describe, it, expect, beforeAll } from 'vitest';
import { solve } from '../src/solve.js';
import { audit } from '../src/audit.js';
import { validate } from '../src/validate.js';
import { parseScenario, deriveCycle, quotaFor } from '../src/model.js';
import feb from '../fixtures/feb-2026.json';

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

  it('Feb 12: pager wins over Thu didactics, warning emitted (both interns hard-Thu)', () => {
    const holder = schedule.days['2026-02-12'].pager;
    expect(['Intern1', 'Intern2']).toContain(holder);
    expect(warnings.some(w => w.code === 'W_DIDACTICS_MISS' && w.person === holder)).toBe(true);
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
    // (b) no senior in day.off on any sc1/sc2 date unless a warning names it
    const { types } = deriveCycle(s.anchorType, s.month);
    const seniors = new Set(s.residents.filter(r => r.role === 'senior').map(r => r.name));
    for (const [d, day] of Object.entries(schedule.days)) {
      if (!['sc1', 'sc2'].includes(types.get(d))) continue;
      for (const name of day.off)
        if (seniors.has(name))
          expect(warnings.some(w => w.person === name && w.date === d)).toBe(true);
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
    // Two residents on team F: the day team needs 2, so nobody can ever take a day off, yet each
    // is owed 4. Eligible days exist (validate passes) — only the solve can find this.
    const s = parseScenario({
      ...feb,
      residents: feb.residents.filter(r => ['Intern2', 'Senior1'].includes(r.name))
        .map(r => ({ ...r, pto: [], commitments: [], serviceStart: '2026-02-01', serviceEnd: '2026-02-28' })),
    });
    expect(validate(s)).toEqual([]);
    const r = await solve(s);
    expect(r.infeasible.diagnosis).toMatch(/off quota/i);
    expect(r.infeasible.culprits.map(c => c.person).sort()).toEqual(['Intern2', 'Senior1']);
  });
});
