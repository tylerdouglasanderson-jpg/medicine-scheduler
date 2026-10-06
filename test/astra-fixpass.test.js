// Regressions for the Astra (gpt-6-astra) review of v1.0.0, 2026-10-06. Each block reproduces the
// reviewer's in-memory probe; every one of them failed against the committed code.
import { describe, it, expect } from 'vitest';
import { solve, solveAlternatives } from '../src/solve.js';
import { buildModel } from '../src/milp.js';
import { audit } from '../src/audit.js';
import { validate } from '../src/validate.js';
import { buildResidentCalendar } from '../src/ics.js';
import { parseScenario } from '../src/model.js';
import s2i1 from '../fixtures/comp-2s1i.json';
import sixCallDays from '../scenarios/32-2s1i-six-call-days.json';

const T = 60000;
const callDates = sch => Object.keys(sch.days).filter(d => sch.days[d].type === 'call').sort();
const nightsOf = sch => callDates(sch).map(d => sch.days[d].night);
const codes = list => list.map(x => x.code);

const res = (name, role, start, end, extra = {}) =>
  ({ name, role, kind: 'categorical', serviceStart: start, serviceEnd: end, ...extra });

// Whole-month 2S+1I, March 2026 (31 days), post-call anchor: call days 6, 12, 18, 24, 30.
const marchPostcall = carryIn => parseScenario({
  team: 'E', month: '2026-03', anchorType: 'postcall', carryIn,
  residents: [
    res('SeniorA', 'senior', '2026-03-01', '2026-03-31'),
    res('SeniorB', 'senior', '2026-03-01', '2026-03-31'),
    res('InternA', 'intern', '2026-03-01', '2026-03-31'),
  ],
});

describe('#1 2S+1I: the intern strictly alternates call nights', () => {
  it('pins forcing two intern nights in a row are rejected by validate() with a fix-it message', () => {
    const s = parseScenario({ ...structuredClone(s2i1), pins: [
      { person: 'InternA', date: '2026-02-11', type: 'nightCall' },
      { person: 'InternA', date: '2026-02-17', type: 'nightCall' }] });
    const errs = validate(s);
    expect(codes(errs)).toContain('NIGHT_ALTERNATION_IMPOSSIBLE');
    const msg = errs.find(e => e.code === 'NIGHT_ALTERNATION_IMPOSSIBLE').message;
    expect(msg).toMatch(/InternA/);
    expect(msg).toMatch(/every other call night/);
    expect(msg).toMatch(/remove|change/i);
  });

  it('the model row is an equality: one of every two consecutive call nights is the intern', () => {
    const lp = buildModel(parseScenario(structuredClone(s2i1))).lp;
    const rows = lp.split('\n').filter(l => /altI_\d+:/.test(l));
    expect(rows.length).toBe(3);
    for (const r of rows) expect(r).toMatch(/ = 1$/);
  });

  it('a single intern pin solves to strict alternation around it', async () => {
    const s = parseScenario({ ...structuredClone(s2i1), pins: [
      { person: 'InternA', date: '2026-02-11', type: 'nightCall' }] });
    expect(validate(s)).toEqual([]);
    const { schedule } = await solve(s);
    expect(nightsOf(schedule).map(n => n === 'InternA')).toEqual([false, true, false, true]);
    expect(audit(s, schedule).violations).toEqual([]);
  }, T);

  it('carry-in intern: the intern does NOT take the first call night; 5 call days -> intern 2, seniors 3', async () => {
    const s = marchPostcall({ nightPerson: 'InternA', dayCallIntern: null, dayCallSenior: 'SeniorA' });
    expect(validate(s)).toEqual([]);
    const { schedule } = await solve(s);
    const n = nightsOf(schedule);
    expect(n.map(x => x === 'InternA')).toEqual([false, true, false, true, false]);
    expect([n.filter(x => x === 'SeniorA').length, n.filter(x => x === 'SeniorB').length].sort()).toEqual([1, 2]);
    expect(audit(s, schedule).violations).toEqual([]);
  }, T);

  it('carry-in senior: the intern takes the first call night', async () => {
    const s = marchPostcall({ nightPerson: 'SeniorA', dayCallIntern: 'InternA', dayCallSenior: 'SeniorB' });
    const { schedule } = await solve(s);
    expect(nightsOf(schedule).map(x => x === 'InternA')).toEqual([true, false, true, false, true]);
    expect(audit(s, schedule).violations).toEqual([]);
  }, T);

  it('carry-in intern + an intern pin on the first call night is rejected up front', () => {
    const s = marchPostcall({ nightPerson: 'InternA', dayCallIntern: null, dayCallSenior: 'SeniorA' });
    s.pins = [{ person: 'InternA', date: '2026-03-06', type: 'nightCall' }];
    expect(codes(validate(s))).toContain('NIGHT_ALTERNATION_IMPOSSIBLE');
  });

  it('the auditor flags a carry-in intern who also takes the first call night', async () => {
    const s = marchPostcall({ nightPerson: 'SeniorA', dayCallIntern: 'InternA', dayCallSenior: 'SeniorB' });
    const { schedule } = await solve(s);
    const c = marchPostcall({ nightPerson: 'InternA', dayCallIntern: null, dayCallSenior: 'SeniorA' });
    expect(codes(audit(c, schedule).violations)).toContain('A_NIGHT_SPLIT');
  }, T);
});

describe('#2 the 2S+1I split applies only to genuinely full-month service windows', () => {
  // Oct 2026, pre-call anchor: call days 2, 8, 14, 20, 26. The intern's service ends Oct 26.
  const octShort = () => parseScenario({
    team: 'E', month: '2026-10', anchorType: 'precall',
    residents: [
      res('SeniorA', 'senior', '2026-10-01', '2026-10-31'),
      res('SeniorB', 'senior', '2026-10-01', '2026-10-31'),
      res('InternA', 'intern', '2026-10-01', '2026-10-26'),
    ],
  });

  it('no alternation rows when the intern leaves before month end', () => {
    expect(buildModel(octShort()).lp).not.toMatch(/alt_|altI_/);
  });

  it('solves with no consecutive nights and a clean audit (post-call pager covered Oct 27)', async () => {
    const s = octShort();
    const { schedule, warnings } = await solve(s);
    expect(codes(warnings)).not.toContain('W_CONSEC_NIGHT_SLACK');
    expect(audit(s, schedule).violations).toEqual([]);
    expect(schedule.days['2026-10-27'].pager).not.toBeNull();
  }, T);

  it('the auditor does not apply A_NIGHT_SPLIT to a partial month', async () => {
    const s = octShort();
    const { schedule } = await solve(s);
    const bad = structuredClone(schedule);
    for (const d of callDates(bad)) if (d !== '2026-10-26') bad.days[d].night = 'InternA';
    expect(codes(audit(s, bad).violations)).not.toContain('A_NIGHT_SPLIT');
  }, T);
});

describe('#3 the auditor checks the alternation SEQUENCE, not just the counts', () => {
  it('Intern, SenA, SenB, Intern, SenA, Intern (3 + 2/1 counts, two seniors adjacent) is a violation', async () => {
    const s = parseScenario(structuredClone(sixCallDays));
    const { schedule } = await solve(s);
    const bad = structuredClone(schedule);
    const seq = ['Eastman', 'Calloway', 'Dalby', 'Eastman', 'Calloway', 'Eastman'];
    callDates(bad).forEach((d, i) => { bad.days[d].night = seq[i]; });
    expect(codes(audit(s, bad).violations)).toContain('A_NIGHT_SPLIT');
  }, T);
});

describe('#4 a half day off cannot overlap the obligation it would excuse', () => {
  const base = () => structuredClone(s2i1);

  it('an AM halfOff on an AM clinic is rejected (HALFOFF_ON_COMMITMENT)', () => {
    const raw = base();
    raw.residents[2].commitments = [{ date: '2026-02-09', half: 'AM', label: 'clinic' }];
    raw.pins = [{ person: 'InternA', date: '2026-02-09', type: 'halfOff', half: 'AM' }];
    const errs = validate(parseScenario(raw));
    expect(codes(errs)).toContain('HALFOFF_ON_COMMITMENT');
    expect(errs.find(e => e.code === 'HALFOFF_ON_COMMITMENT').message)
      .toMatch(/InternA has a clinic that morning — remove the half-day off or the clinic/);
  });

  it('a PM halfOff alongside an AM clinic is fine', () => {
    const raw = base();
    raw.residents[2].commitments = [{ date: '2026-02-09', half: 'AM', label: 'clinic' }];
    raw.pins = [{ person: 'InternA', date: '2026-02-09', type: 'halfOff', half: 'PM' }];
    expect(validate(parseScenario(raw))).toEqual([]);
  });

  it('a PM halfOff plus a pager pin the same day is contradictory', () => {
    const raw = base();
    raw.pins = [{ person: 'InternA', date: '2026-02-09', type: 'halfOff', half: 'PM' },
      { person: 'InternA', date: '2026-02-09', type: 'pager' }];
    expect(codes(validate(parseScenario(raw)))).toContain('CONTRADICTORY_PINS');
  });

  it('a halfOff on a call or post-call day is rejected', () => {
    for (const date of ['2026-02-11', '2026-02-12']) {
      const raw = base();
      raw.pins = [{ person: 'InternA', date, type: 'halfOff', half: 'AM' }];
      expect(codes(validate(parseScenario(raw)))).toContain('CONTRADICTORY_PINS');
    }
  });

  it('a PM halfOff over (hard) PM didactics counts as a missed session and is warned about', async () => {
    const raw = base();
    raw.residents[0].didactics = { dow: 2, half: 'PM', hard: true };            // Tuesdays
    raw.pins = [{ person: 'SeniorA', date: '2026-02-10', type: 'halfOff', half: 'PM' }];
    const s = parseScenario(raw);
    expect(validate(s)).toEqual([]);
    const { schedule } = await solve(s);
    const t = schedule.totals.SeniorA;
    // Tue 3 sc2, 10 precall, 17 call + 24 post-call (no session): 2 attendable, the 10th lost to the half-off
    expect(t.didacticsOf).toBe(2);
    expect(t.didactics).toBeLessThanOrEqual(1);
    const w = audit(s, schedule).warnings.find(x => x.code === 'W_DIDACTICS_HALF_OFF');
    expect(w).toBeTruthy();
    expect(w.person).toBe('SeniorA');
    expect(w.date).toBe('2026-02-10');
  }, T);
});

describe('#5 personal calendars honour half days off', () => {
  const unfold = ics => ics.replace(/\r\n[ \t]/g, '');
  const events = ics => unfold(ics).split('BEGIN:VEVENT').slice(1);
  const on = (evs, date) => evs.filter(e => e.includes(`DTSTART;TZID=America/Chicago:${date.replaceAll('-', '')}T`));
  const now = new Date('2026-10-06T12:00:00Z');

  // Feb 10 is a Tuesday pre-call day (Morning Report).
  it('AM halfOff: no rounding or Morning Report that morning; a "Half day off (AM)" event instead', async () => {
    const raw = structuredClone(s2i1);
    raw.pins = [{ person: 'InternA', date: '2026-02-10', type: 'halfOff', half: 'AM' }];
    const s = parseScenario(raw);
    const { schedule } = await solve(s);
    const evs = on(events(buildResidentCalendar(s, schedule, 'InternA', { now })), '2026-02-10');
    expect(evs.some(e => /SUMMARY:Rounding/.test(e))).toBe(false);
    expect(evs.some(e => /SUMMARY:Morning Report/.test(e))).toBe(false);
    expect(evs.some(e => /SUMMARY:Half day off \(AM\)/.test(e) && /T070000/.test(e) && /DTEND;TZID=America\/Chicago:20260210T130000/.test(e))).toBe(true);
  }, T);

  it('PM halfOff: morning rounding kept, a 13:00-17:00 "Half day off (PM)" event, no didactics', async () => {
    const raw = structuredClone(s2i1);
    raw.residents[0].didactics = { dow: 2, half: 'PM', hard: false };
    raw.pins = [{ person: 'SeniorA', date: '2026-02-10', type: 'halfOff', half: 'PM' }];
    const s = parseScenario(raw);
    const { schedule } = await solve(s);
    expect(schedule.days['2026-02-10'].pager).not.toBe('SeniorA');
    const evs = on(events(buildResidentCalendar(s, schedule, 'SeniorA', { now })), '2026-02-10');
    const rounding = evs.find(e => /SUMMARY:Rounding/.test(e));
    expect(rounding).toMatch(/DTEND;TZID=America\/Chicago:20260210T130000/);
    expect(evs.some(e => /SUMMARY:Half day off \(PM\)/.test(e) && /T130000/.test(e) && /T170000/.test(e))).toBe(true);
    expect(evs.some(e => /SUMMARY:Didactics/.test(e))).toBe(false);
  }, T);

  it('AM halfOff while holding the pager: an afternoon-only Pager Duty event', () => {
    const s = parseScenario({ ...structuredClone(s2i1),
      pins: [{ person: 'InternA', date: '2026-02-09', type: 'halfOff', half: 'AM' }] });
    const schedule = { days: { '2026-02-09': { type: 'sc2', working: ['SeniorA', 'SeniorB', 'InternA'],
      off: [], sleeper: null, pager: 'InternA', night: null, dayCall: null } }, totals: {} };
    const evs = on(events(buildResidentCalendar(s, schedule, 'InternA', { now })), '2026-02-09');
    expect(evs.some(e => /SUMMARY:Short Call|SUMMARY:Rounding/.test(e))).toBe(false);
    const pager = evs.find(e => /SUMMARY:Pager Duty/.test(e));
    expect(pager).toMatch(/T130000/);
    expect(pager).toMatch(/DTEND;TZID=America\/Chicago:20260209T170000/);
  });
});

describe('#6 a category-cap stop says so in plain language', () => {
  // Two-person Feb (ppc anchor). The senior's only clinic-free off days are Mon 9 and Mon 16; the
  // intern has PM clinic on the 16th, so a senior off on the 16th leaves the pager to the attending.
  // Solution 1 puts the off on the 9th; the only other arrangement costs an attending-pager day.
  it('names the attending / protected didactics, not "boxed in"', async () => {
    const dates = Array.from({ length: 28 }, (_, i) => `2026-02-${String(i + 1).padStart(2, '0')}`);
    const types = ['ppc', 'sc1', 'sc2', 'precall', 'call', 'postcall'];
    const free = dates.filter((d, i) => !['call', 'postcall'].includes(types[i % 6]));
    const s = parseScenario({
      team: 'E', month: '2026-02', anchorType: 'ppc', options: { offQuota: 1 },
      residents: [
        res('Sen', 'senior', '2026-02-01', '2026-02-28', { commitments:
          free.filter(d => !['2026-02-09', '2026-02-16'].includes(d)).map(date => ({ date, half: 'AM', label: 'clinic' })) }),
        res('Int', 'intern', '2026-02-01', '2026-02-28', { commitments: [{ date: '2026-02-16', half: 'PM', label: 'clinic' }] }),
      ],
      pins: [{ person: 'Int', date: '2026-02-03', type: 'offCounted' }],
    });
    expect(validate(s)).toEqual([]);
    const out = await solveAlternatives(s);
    expect(out.infeasible).toBeFalsy();
    expect(out.solutions).toHaveLength(1);
    expect(out.stoppedReason).toMatch(/attending to cover the pager more often/);
    expect(out.stoppedReason).toMatch(/protected didactics/);
  }, T);
});
