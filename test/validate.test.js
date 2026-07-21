import { describe, it, expect } from 'vitest';
import { validate } from '../src/validate.js';
import { parseScenario } from '../src/model.js';
import good from '../fixtures/feb-2026.json';

const CASES = [
  ['commitment-on-call', 'COMMITMENT_ON_CALL'],
  ['pto-on-call', 'PTO_ON_CALL'],
  ['night-pin-pm-commitment', 'NIGHT_PIN_PM_COMMITMENT'],
  ['contradictory-pins', 'CONTRADICTORY_PINS'],
  ['pin-outside-window', 'PIN_OUTSIDE_WINDOW'],
  ['carryin-required', 'CARRYIN_REQUIRED'],
  ['degenerate', 'DEGENERATE_COMPOSITION'],
];

it('feb-2026 golden fixture has zero hard errors', () => {
  expect(validate(parseScenario(good))).toEqual([]);
});

for (const [file, code] of CASES) {
  it(`${file} -> ${code}`, async () => {
    const bad = (await import(`../fixtures/broken-inputs/${file}.json`)).default;
    const errs = validate(parseScenario(bad));
    expect(errs.map(e => e.code)).toContain(code);
    expect(errs.find(e => e.code === code).message).toBeTruthy();
  });
}

it('QUOTA_IMPOSSIBLE: clinic on every eligible day leaves nowhere to put the 4 offs', () => {
  const s = parseScenario(good);
  const eligible = ['2026-02-01', '2026-02-02', '2026-02-03', '2026-02-04', '2026-02-07',
    '2026-02-08', '2026-02-09', '2026-02-10', '2026-02-13', '2026-02-14', '2026-02-15',
    '2026-02-16', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-25',
    '2026-02-26', '2026-02-27', '2026-02-28'];   // every non-call, non-post-call day in Feb 2026
  s.residents = s.residents.map(r => r.name === 'Intern2'
    ? { ...r, commitments: eligible.map(date => ({ date, half: 'AM', label: 'clinic' })) } : r);
  const errs = validate(s);
  expect(errs.map(e => e.code)).toContain('QUOTA_IMPOSSIBLE');
  expect(errs.find(e => e.code === 'QUOTA_IMPOSSIBLE').message).toMatch(/only has 0 eligible/);
});
