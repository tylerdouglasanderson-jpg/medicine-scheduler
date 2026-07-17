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
