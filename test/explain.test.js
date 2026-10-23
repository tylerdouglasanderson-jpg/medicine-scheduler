import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { explainCell } from '../src/explain.js';

// Hand-built mini month (Oct 2026, anonymized names). Oct 6 = sc1 (Tue), Oct 7 = sc2, Oct 8 = precall,
// Oct 9 = call, Oct 10 = postcall. Senior1 holds the pager Oct 6; Intern1 is off Oct 6.
const deepFreeze = o => { Object.values(o).forEach(v => { if (v && typeof v === 'object') deepFreeze(v); }); return Object.freeze(o); };
const day = (type, o = {}) => ({ type, working: [], off: [], sleeper: null, pager: null, night: null, dayCall: null, ...o });

function build() {
  const scenario = {
    team: 'A', month: '2026-10', anchorType: 'sc1',
    options: { offQuota: 4 },
    residents: [
      { name: 'Senior1', role: 'senior', serviceStart: '2026-10-01', serviceEnd: '2026-10-31', commitments: [], pto: [] },
      { name: 'Intern1', role: 'intern', serviceStart: '2026-10-01', serviceEnd: '2026-10-31', commitments: [], pto: [] },
      { name: 'Intern2', role: 'intern', serviceStart: '2026-10-01', serviceEnd: '2026-10-31', commitments: [], pto: ['2026-10-06'] },
      { name: 'Intern3', role: 'intern', serviceStart: '2026-10-01', serviceEnd: '2026-10-31', commitments: [{ date: '2026-10-06', half: 'AM', label: 'clinic' }], pto: [] },
      { name: 'Senior2', role: 'senior', serviceStart: '2026-10-12', serviceEnd: '2026-10-31', commitments: [], pto: [] },
    ],
    pins: [{ person: 'Intern1', date: '2026-10-06', type: 'offCounted', half: null, note: '' }],
    attendingPagerDays: [],
  };
  const schedule = {
    days: {
      '2026-10-06': day('sc1', { working: ['Senior1', 'Intern3'], off: ['Intern1'], pager: 'Senior1' }),
      '2026-10-07': day('sc2', { working: ['Senior1', 'Intern1', 'Intern3'], pager: 'Intern1' }),
    },
    totals: {
      Senior1: { shifts: 20, pager: 7, off: 4 }, Intern1: { shifts: 19, pager: 5, off: 5 },
      Intern2: { shifts: 18, pager: 4, off: 3 }, Intern3: { shifts: 20, pager: 6, off: 4 },
      Senior2: { shifts: 10, pager: 2, off: 2 },
    },
  };
  return { scenario, schedule };
}

describe('explainCell', () => {
  it('off slot: PTO, clinic and not-yet-on-service people are blocked with plain reasons', () => {
    const { scenario, schedule } = build();
    const r = explainCell(scenario, schedule, { date: '2026-10-06', slot: 'off' });
    expect(r.assigned).toEqual(['Intern1']);
    const by = Object.fromEntries(r.blocked.map(b => [b.name, b.reason]));
    expect(by.Intern2).toMatch(/PTO/);
    expect(by.Intern3).toMatch(/clinic|commitment/i);
    expect(by.Senior2).toMatch(/not on service yet/i);
    expect(by.Senior1).toMatch(/pager/i);
  });

  it('the assigned person is never in blocked, and a matching pin marks the cell pinned', () => {
    const { scenario, schedule } = build();
    const r = explainCell(scenario, schedule, { date: '2026-10-06', slot: 'off' });
    expect(r.blocked.map(b => b.name)).not.toContain('Intern1');
    expect(r.pinned).toBe(true);
    expect(r.summary).toMatch(/pinned/);
  });

  it('counts carry a numeric team average and a readable label', () => {
    const { scenario, schedule } = build();
    const r = explainCell(scenario, schedule, { date: '2026-10-06', slot: 'off' });
    expect(r.counts).toHaveLength(1);
    expect(typeof r.counts[0].teamAvg).toBe('number');
    expect(r.counts[0].value).toBe(5);
    // Senior2 has no service day inside the two-day hand-built schedule, so the average is over the other four.
    expect(r.counts[0].teamAvg).toBeCloseTo(4.0, 5);
    expect(r.counts[0].label).toBe('5 offs this month (team average 4.0)');
  });

  it('pager slot: unpinned holder, PTO and hard-clinic people blocked, solver wording honest', () => {
    const { scenario, schedule } = build();
    const r = explainCell(scenario, schedule, { date: '2026-10-06', slot: 'pager' });
    expect(r.assigned).toEqual(['Senior1']);
    expect(r.pinned).toBe(false);
    expect(r.blocked.find(b => b.name === 'Intern2').reason).toMatch(/PTO/);
    expect(r.blocked.find(b => b.name === 'Intern1').reason).toMatch(/off/i);
    expect(r.summary).toMatch(/whole month/);
  });

  it('rounders slot lists the people who are off as blocked', () => {
    const { scenario, schedule } = build();
    const r = explainCell(scenario, schedule, { date: '2026-10-06', slot: 'rounders' });
    expect(r.assigned).toEqual(['Senior1', 'Intern3']);
    expect(r.blocked.find(b => b.name === 'Intern1').reason).toMatch(/off/i);
  });

  it('a non-call day has no night to explain, and unknown slots do not throw', () => {
    const { scenario, schedule } = build();
    expect(explainCell(scenario, schedule, { date: '2026-10-06', slot: 'night' }).assigned).toEqual([]);
    expect(explainCell(scenario, schedule, { date: '2026-10-06', slot: 'bogus' }).summary).toMatch(/Nothing to explain/);
    expect(explainCell(scenario, schedule, { date: '2026-10-20', slot: 'off' }).assigned).toEqual([]);
  });

  it('is pure: frozen inputs are accepted and unchanged', () => {
    const { scenario, schedule } = build();
    const before = JSON.stringify({ scenario, schedule });
    deepFreeze(scenario); deepFreeze(schedule);
    for (const slot of ['off', 'pager', 'rounders', 'night', 'didactics'])
      expect(() => explainCell(scenario, schedule, { date: '2026-10-06', slot })).not.toThrow();
    expect(JSON.stringify({ scenario, schedule })).toBe(before);
  });

  it('stays independent of the solver side (no milp / model references)', () => {
    const text = readFileSync(new URL('../src/explain.js', import.meta.url), 'utf8');
    expect(text).not.toContain('milp');
    expect(text).not.toContain('model.js');
    expect(text).not.toMatch(/^\s*import\s/m);
  });
});
