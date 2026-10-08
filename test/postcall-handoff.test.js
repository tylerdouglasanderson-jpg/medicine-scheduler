// Post-call pager across a mid-month handoff (v1.1.0; a co-resident's Nov report, names invented).
// Rule (program rule, 2026-10): post-call, the day-call intern pages. If that intern rotated off service, a working,
// awake intern pages (the incoming intern, even on their first day); a senior only when no intern can.
import { describe, it, expect, beforeAll } from 'vitest';
import { parseScenario } from '../src/model.js';
import { solve } from '../src/solve.js';
import { audit } from '../src/audit.js';

const r = (name, role, kind, serviceStart, serviceEnd, dow) => ({
  name, role, kind, serviceStart, serviceEnd, didactics: { dow, half: 'PM', hard: false }, commitments: [], pto: [],
});
const handoff = () => parseScenario({
  team: 'A', month: '2026-11', anchorType: 'sc2',
  pins: [
    { person: 'InternA', date: '2026-11-01', type: 'offCounted', half: null, note: '' },
    { person: 'InternB', date: '2026-11-14', type: 'offCounted', half: null, note: '' },
  ],
  residents: [
    r('InternA', 'intern', 'categorical', '2026-11-01', '2026-11-15', 4),
    r('InternB', 'intern', 'TY', '2026-11-01', '2026-11-30', 3),
    r('SeniorA', 'senior', 'categorical', '2026-11-01', '2026-11-15', 3),
    r('SeniorB', 'senior', 'categorical', '2026-11-16', '2026-11-30', 2),
    r('InternC', 'intern', 'other', '2026-11-16', '2026-11-30', 4),
  ],
});

describe('post-call pager when the day-call intern rotates off (11/15 call → 11/16 post-call handoff)', () => {
  let s, schedule;
  beforeAll(async () => { s = handoff(); ({ schedule } = await solve(s)); });

  it('solves audit-clean', () => {
    expect(audit(s, schedule).violations).toEqual([]);
  });
  it('an intern holds the post-call pager, never the incoming senior', () => {
    const d = schedule.days['2026-11-16'];
    expect(d.type).toBe('postcall');
    expect(['InternB', 'InternC']).toContain(d.pager);
    expect(d.pager).not.toBe(d.sleeper);
  });
  it('the auditor rejects the incoming senior holding it while an awake intern is working', () => {
    const d = schedule.days['2026-11-16'];
    const bad = { ...schedule, days: { ...schedule.days, '2026-11-16': { ...d, pager: 'SeniorB' } } };
    expect(audit(s, bad).violations.filter(v => v.date === '2026-11-16').map(v => v.code)).toContain('A_POSTCALL_PAGER');
  });
});
