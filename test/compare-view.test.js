// diffMonths(): the pure draft-vs-published comparison behind the Compare view (src/ui/compare.js).
// (test/compare.test.js covers the other module, src/compare.js, which compares two solver alternatives.)
import { describe, it, expect } from 'vitest';
import { diffMonths } from '../src/ui/compare.js';

const day = (o = {}) => ({ working: ['Intern1', 'Intern2', 'Senior1'], off: [], sleeper: null, pager: 'Intern1', night: 'Intern2', dayCall: { senior: 'Senior1', intern: 'Intern1' }, ...o });
// 2026-10-03 is a Saturday, 2026-10-05 a Monday.
const month = days => ({ lastSolution: { days, totals: { Intern1: { didactics: 2 }, Intern2: { didactics: 3 }, Senior1: { didactics: 0 } } } });
const base = () => month({ '2026-10-03': day(), '2026-10-04': day(), '2026-10-05': day({ off: ['Senior1'] }) });

describe('diffMonths', () => {
  it('finds nothing when the months match', () => {
    const d = diffMonths(base(), base());
    expect(d).toMatchObject({ dayCount: 0, personCount: 0, days: [], hasPublished: true, hasDraft: true });
  });

  it('reports a swapped night per day and per person', () => {
    const draft = base();
    draft.lastSolution.days['2026-10-04'].night = 'Intern1';
    const d = diffMonths(base(), draft);
    expect(d.dayCount).toBe(1);
    expect(d.days[0]).toEqual({ date: '2026-10-04', changes: [{ slot: 'Night', before: 'Intern2', after: 'Intern1' }] });
    expect(d.personCount).toBe(2);
    const i1 = d.people.find(p => p.name === 'Intern1');
    expect(i1.delta.nights).toBe(1);
    expect(i1.before.nights).toBe(0);
    expect(i1.after.nights).toBe(1);
    expect(d.people.find(p => p.name === 'Intern2').delta.nights).toBe(-1);
    expect(d.people.find(p => p.name === 'Senior1').changed).toBe(false);
  });

  it('lists off-list changes by who was added or removed, and counts offs', () => {
    const draft = base();
    draft.lastSolution.days['2026-10-05'].off = ['Intern2'];
    const d = diffMonths(base(), draft);
    expect(d.days[0].changes).toEqual([{ slot: 'Off', before: 'Senior1', after: 'Intern2' }]);
    expect(d.people.find(p => p.name === 'Senior1').delta.offs).toBe(-1);
    expect(d.people.find(p => p.name === 'Intern2').delta.offs).toBe(1);
  });

  it('counts weekends worked, calls and pager from the day grid', () => {
    const p = diffMonths(base(), base()).people.find(x => x.name === 'Intern1');
    expect(p.after).toMatchObject({ weekends: 2, calls: 3, pager: 3, nights: 0, didactics: 2 });
  });

  it('takes didactics from the stored totals', () => {
    const draft = base();
    draft.lastSolution.totals.Intern1.didactics = 5;
    const d = diffMonths(base(), draft);
    expect(d.dayCount).toBe(0);
    expect(d.people.find(p => p.name === 'Intern1').delta.didactics).toBe(3);
    expect(d.personCount).toBe(1);
  });

  it('falls back to the active alternative when there is no lastSolution', () => {
    const alt = { alternatives: [base().lastSolution], activeSolution: 0 };
    expect(diffMonths(alt, base()).dayCount).toBe(0);
  });

  it('flags a draft with no solved schedule', () => {
    const d = diffMonths(base(), { residents: [] });
    expect(d.hasDraft).toBe(false);
    expect(d.hasPublished).toBe(true);
  });
});
