// v1.6.0: Transitional (TY) interns have didactics every OTHER Wednesday PM. The chief picks the dates
// (`didactics.alt` + `didactics.dates`); picked dates behave exactly like weekly didactics, unpicked
// Wednesdays are nothing.
import { describe, it, expect, beforeAll } from 'vitest';
import { solve } from '../src/solve.js';
import { audit } from '../src/audit.js';
import { parseScenario, defaultDidactics, didacticsOn, deriveCycle, quotaFor } from '../src/model.js';
import oct from '../fixtures/oct-2026-didactics.json';

const withTY = (dates, hard = false) => {
  const s = parseScenario(JSON.parse(JSON.stringify(oct)));
  const chen = s.residents.find(r => r.name === 'Chen');
  chen.didactics = { dow: 3, half: 'PM', hard, alt: true, dates };
  s.lastSolution = null;
  return s;
};

describe('defaults and helper', () => {
  it('TY intern defaults to a locked Wednesday PM alt rule with no dates', () => {
    expect(defaultDidactics('intern', 'TY')).toEqual({ dow: 3, half: 'PM', hard: true, alt: true, dates: [] });
  });
  it('didacticsOn: alt uses only the picked dates, weekly uses the weekday', () => {
    const alt = { didactics: { dow: 3, alt: true, dates: ['2026-10-07'] } };
    expect(didacticsOn(alt, '2026-10-07')).toBe(true);
    expect(didacticsOn(alt, '2026-10-14')).toBe(false);
    expect(didacticsOn({ didactics: { dow: 3 } }, '2026-10-14')).toBe(true);
    expect(didacticsOn({ didactics: null }, '2026-10-14')).toBe(false);
  });
});

describe('solving with picked TY dates', () => {
  for (const hard of [false, true]) {
    describe(hard ? 'protected (hard)' : 'soft', () => {
      let s, schedule, warnings;
      beforeAll(async () => {
        s = withTY(['2026-10-07', '2026-10-21'], hard);
        ({ schedule, warnings } = await solve(s));
      }, 120000);

      it('audit-clean, exact off quotas, no TY-date warning', () => {
        expect(audit(s, schedule).violations).toEqual([]);
        for (const r of s.residents) expect(schedule.totals[r.name].off).toBe(quotaFor(r, s));
        expect(audit(s, schedule).warnings.some(w => w.code === 'W_DIDACTICS_NO_DATES')).toBe(false);
      });

      it('denominator is the picked sessions (minus call/post-call) and all are attended', () => {
        const { types } = deriveCycle(s.anchorType, s.month);
        const picked = ['2026-10-07', '2026-10-21'].filter(d => !['call', 'postcall'].includes(types.get(d)));
        const t = schedule.totals.Chen;
        expect(t.didacticsOf).toBe(picked.length);
        expect(t.didactics).toBe(t.didacticsOf);
      });

      it('no day off or (hard) pager on a picked date; unpicked Wednesdays are unprotected', () => {
        for (const d of ['2026-10-07', '2026-10-21']) {
          expect(schedule.days[d].off).not.toContain('Chen');
          if (hard) expect(schedule.days[d].pager).not.toBe('Chen');
        }
      });
    });
  }
});

describe('no dates picked', () => {
  it('warns once, counts no sessions, and still solves audit-clean', async () => {
    const s = withTY([]);
    const { schedule } = await solve(s);
    expect(audit(s, schedule).warnings.filter(w => w.code === 'W_DIDACTICS_NO_DATES' && w.person === 'Chen')).toHaveLength(1);
    expect(schedule.totals.Chen.didacticsOf).toBe(0);
    expect(audit(s, schedule).violations).toEqual([]);
  }, 120000);
});
