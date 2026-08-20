import { describe, it, expect } from 'vitest';
import { audit } from '../src/audit.js';
import { readdirSync } from 'node:fs';
import valid from '../fixtures/broken-schedules/valid-mini.json';

it('hand-written valid mini-schedule passes with zero violations', () => {
  expect(audit(valid.scenario, valid.schedule).violations).toEqual([]);
});

const files = readdirSync('fixtures/broken-schedules').filter(f => f !== 'valid-mini.json');
it('covers every violation code', () => expect(files.length).toBeGreaterThanOrEqual(14));

for (const f of files) {
  it(`${f} is caught`, async () => {
    const fx = (await import(`../fixtures/broken-schedules/${f}`)).default;
    const { violations } = audit(fx.scenario, fx.schedule);
    expect(violations.map(v => v.code)).toContain(fx.expect);
  });
}

it('duty-hour + long-stretch warnings fire', () => {
  // mutate valid-mini: remove all of one intern's offs from schedule.days and totals
  const fx = structuredClone(valid);
  for (const d of Object.values(fx.schedule.days)) d.off = d.off.filter(n => n !== 'Intern2');
  fx.schedule.totals.Intern2.off = 0;
  const { warnings } = audit(fx.scenario, fx.schedule);
  const codes = warnings.map(w => w.code);
  expect(codes).toContain('W_DUTY_HOUR');
  expect(codes).toContain('W_LONG_STRETCH');
});

// Didactics ledger (program rule, 2026-08): an off or post-call sleep LOSES the half-day; the pager
// still gets them there, tethered — and is only unfixable when nobody else could have taken it.
describe('didactics ledger', () => {
  const withDidactics = (name, dow) => {
    const fx = structuredClone(valid);
    fx.scenario.residents.find(r => r.name === name).didactics = { dow, half: 'PM', hard: false };
    return fx;
  };

  it('an off on your own didactics day is flagged', () => {
    const fx = withDidactics('Senior2', 0);            // Feb 1 2026 is a Sunday; Senior2 is off that day
    const w = audit(fx.scenario, fx.schedule).warnings;
    expect(w.some(x => x.code === 'W_DIDACTICS_OFF' && x.person === 'Senior2' && x.date === '2026-02-01')).toBe(true);
  });

  it('an INTERN on the pager at their own didactics is flagged separately and names the free senior', () => {
    const fx = withDidactics('Intern2', 1);               // Intern2 is an intern; Feb 2 is a Monday, he pages
    const w = audit(fx.scenario, fx.schedule).warnings;
    const hit = w.find(x => x.code === 'W_DIDACTICS_PAGER_INTERN' && x.date === '2026-02-02');
    expect(hit).toBeTruthy();
    expect(hit.person).toBe('Intern2');
    expect(hit.message).toMatch(/Senior1|Senior2/);      // both seniors are working and free that day
    expect(hit.attendingCanCover).toBe(false);        // pin the senior instead — no attending needed
    expect(w.some(x => x.code === 'W_DIDACTICS_OFF' && x.date === '2026-02-02')).toBe(false);
  });

  it('a SENIOR on the pager at their own didactics is the ordinary case', () => {
    const fx = withDidactics('Senior1', 0);             // Senior1 is a senior and pages Feb 1 (a Sunday)
    const w = audit(fx.scenario, fx.schedule).warnings;
    const hit = w.find(x => x.code === 'W_DIDACTICS_PAGER' && x.date === '2026-02-01');
    expect(hit).toBeTruthy();
    expect(hit.person).toBe('Senior1');
  });

  it('nobody is charged for didactics on a call or post-call day', () => {
    const types = { '2026-02-05': 'call', '2026-02-06': 'postcall' };
    for (const [date] of Object.entries(types)) {
      const d = new Date(...date.split('-').map((v, i) => i === 1 ? Number(v) - 1 : Number(v)));
      const fx = withDidactics('Intern2', d.getDay());
      const w = audit(fx.scenario, fx.schedule).warnings;
      expect(w.some(x => x.code.startsWith('W_DIDACTICS') && x.date === date)).toBe(false);
    }
  });

  it('an attending day the schedule ignored is a violation', () => {
    const fx = structuredClone(valid);
    fx.scenario.attendingPagerDays = ['2026-02-01'];  // pager there is Senior1, not the attending
    const codes = audit(fx.scenario, fx.schedule).violations.map(v => v.code);
    expect(codes).toContain('A_ATTENDING_DAY_IGNORED');
  });
});
