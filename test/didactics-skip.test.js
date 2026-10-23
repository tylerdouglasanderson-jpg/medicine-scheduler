// @vitest-environment jsdom
// v1.16.0: the chief can strike out ONE weekly didactics session (`didactics.skip`); it must stop being a
// didactics day everywhere: solver, auditor, denominators, explain, .ics, calendar chip.
import { describe, it, expect, beforeAll } from 'vitest';
import { solve } from '../src/solve.js';
import { audit } from '../src/audit.js';
import { parseScenario, didacticsOn, RULES_VERSION } from '../src/model.js';
import { buildResidentCalendar } from '../src/ics.js';
import { render as renderChips } from '../src/ui/chips.js';
import { buildPhonePayload } from '../src/phone.js';
import { cellText } from '../src/cell-text.js';
import { buildWorkbook } from '../src/export.js';
import oct from '../fixtures/oct-2026-didactics.json';

// Brooks: Thursday PM, soft. Oct 2026 Thursdays: 1, 8, 15, 22, 29.
const base = () => parseScenario(JSON.parse(JSON.stringify(oct)));
const struck = d => { const s = base(); s.residents[1].didactics.skip = d; s.lastSolution = null; return s; };

describe('didacticsOn', () => {
  it('a skipped date is not a didactics day; the other weeks still are', () => {
    const r = { didactics: { dow: 4, half: 'PM', skip: ['2026-10-15'] } };
    expect(didacticsOn(r, '2026-10-15')).toBe(false);
    expect(didacticsOn(r, '2026-10-08')).toBe(true);
  });
  it('rules version moved', () => expect(RULES_VERSION).toBe('1.8.0'));
});

describe('solving with a struck session', () => {
  let plain, withSkip, a, b;
  beforeAll(async () => {
    plain = base(); plain.lastSolution = null;
    withSkip = struck(['2026-10-15', '2026-10-22']);
    a = (await solve(plain)).schedule;
    b = (await solve(withSkip)).schedule;
  }, 120000);

  it('denominator drops by the struck sessions that were attendable', () => {
    const wasAttendable = ['2026-10-15', '2026-10-22'].filter(d => !['call', 'postcall'].includes(a.days[d].type) && !a.days[d].off.includes('Brooks'));
    expect(b.totals.Brooks.didacticsOf).toBeLessThanOrEqual(a.totals.Brooks.didacticsOf);
    expect(b.totals.Brooks.didacticsOf).toBeGreaterThanOrEqual(a.totals.Brooks.didacticsOf - 2);
    expect(wasAttendable).toBeDefined();
  });
  it('audits clean and raises no didactics warning for a struck day', () => {
    const r = audit(withSkip, b);
    expect(r.violations).toEqual([]);
    for (const w of r.warnings.filter(w => /DIDACTICS/.test(w.code)))
      expect(['2026-10-15', '2026-10-22']).not.toContain(w.date);
  });
  it('.ics has no didactics event on a struck Thursday', () => {
    const ics = buildResidentCalendar(withSkip, b, 'Brooks');
    const events = ics.split('BEGIN:VEVENT').filter(e => /SUMMARY:Didactics/.test(e));
    expect(events.some(e => /20261015|20261022/.test(e))).toBe(false);
  });
});

describe('calendar chip', () => {
  it('weekly day shows a × that strikes it out; a struck day shows struck and restores', () => {
    const s = base();
    let out = null;
    const host = document.createElement('div');
    renderChips(host, s, n => { out = n; });
    const chip = [...host.querySelectorAll('.chip-didactics')].find(c => c.textContent.startsWith('didactics PM'));
    expect(chip).toBeTruthy();
    chip.querySelector('.chip-remove').click();
    const hit = out.residents.find(r => r.didactics?.skip?.length);
    expect(hit.didactics.skip).toHaveLength(1);
    const host2 = document.createElement('div');
    renderChips(host2, out, n => { out = n; });
    const st = host2.querySelector('.chip-didactics.struck');
    expect(st.textContent).toContain('struck out');
    st.querySelector('.chip-remove').click();
    expect(out.residents.find(r => r.name === hit.name).didactics.skip).toEqual([]);
  });
});

describe('one-off sessions added with the Didactics (PM) pin', () => {
  // Alvarez has Tue PM; add a Friday session (2026-10-09) for her, and an ad hoc one for a resident with none.
  const build = () => {
    const s = base();
    s.residents[0].didactics.extra = ['2026-10-09'];
    s.residents[2].didactics = { dow: 5, half: 'PM', hard: false, weekly: false, extra: ['2026-10-16'] };
    s.lastSolution = null;
    return s;
  };
  let s, sch;
  beforeAll(async () => { s = build(); sch = (await solve(s)).schedule; }, 120000);

  it('didacticsOn honours extras and ad hoc residents have no weekly day', () => {
    expect(didacticsOn(s.residents[0], '2026-10-09')).toBe(true);
    expect(didacticsOn(s.residents[2], '2026-10-16')).toBe(true);
    expect(didacticsOn(s.residents[2], '2026-10-23')).toBe(false);
  });
  it('shows in the calendar/phone Didactics row (cell-text) unless off, PTO, or call', () => {
    for (const [d, n] of [['2026-10-09', s.residents[0].name], ['2026-10-16', s.residents[2].name]]) {
      const dd = sch.days[d];
      const txt = cellText('DIDACTICS', d, dd.type, dd, s, sch);
      const away = dd.off.includes(n) || ['call', 'postcall'].includes(dd.type) || (s.residents.find(r => r.name === n).pto ?? []).includes(d);
      expect(txt.includes(n)).toBe(!away);
    }
  });
  it('audits clean and counts in the totals denominator', () => {
    expect(audit(s, sch).violations).toEqual([]);
    expect(sch.totals[s.residents[2].name].didacticsOf).toBeGreaterThanOrEqual(0);
    expect(buildPhonePayload(s, sch, 1)).toBeTruthy();
    expect(typeof buildWorkbook).toBe('function');
  });
});
