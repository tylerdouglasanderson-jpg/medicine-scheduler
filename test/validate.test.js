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
