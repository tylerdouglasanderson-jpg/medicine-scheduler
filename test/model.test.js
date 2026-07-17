import { describe, it, expect } from 'vitest';
import { CYCLE, deriveCycle, onService, serviceDaysIn, quotaFor, parseScenario } from '../src/model.js';
import fixture from '../fixtures/feb-2026.json';

const NEXT = { precall: 'call', call: 'postcall', postcall: 'ppc', ppc: 'sc1', sc1: 'sc2', sc2: 'precall' };
const MONTHS = { '2026-02': 28, '2028-02': 29, '2026-04': 30, '2026-01': 31 };

describe('deriveCycle — all 6 anchors x 28/29/30/31-day months', () => {
  for (const anchor of CYCLE) {
    for (const [month, len] of Object.entries(MONTHS)) {
      it(`${anchor} / ${month}`, () => {
        const { types, daysInMonth, callDays, postCallDays } = deriveCycle(anchor, month);
        expect(daysInMonth).toBe(len);
        expect(types.size).toBe(len);
        const seq = [...types.values()];
        expect(seq[0]).toBe(anchor);                       // anchor = type of the 1st
        for (let i = 1; i < seq.length; i++) expect(seq[i]).toBe(NEXT[seq[i - 1]]);
        expect(callDays).toEqual([...types].filter(([, t]) => t === 'call').map(([d]) => d));
        expect(postCallDays).toEqual([...types].filter(([, t]) => t === 'postcall').map(([d]) => d));
      });
    }
  }
});

function nextDay(d) { const [y, m, day] = d.split('-').map(Number);
  const n = new Date(y, m - 1, day + 1);
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; }

describe('feb-2026 fixture derivation', () => {
  const c = deriveCycle(fixture.anchorType, fixture.month);
  it('call days Feb 5/11/17/23', () =>
    expect(c.callDays).toEqual(['2026-02-05', '2026-02-11', '2026-02-17', '2026-02-23']));
  it('post-call days Feb 6/12/18/24', () =>
    expect(c.postCallDays).toEqual(['2026-02-06', '2026-02-12', '2026-02-18', '2026-02-24']));
  it('Morning Report Feb 10 only (pre-call on Tue/Thu)', () =>
    expect(c.morningReportDays).toEqual(['2026-02-10']));
});

describe('quotas — proportional round-half-up', () => {
  const s = parseScenario(fixture);
  const q = Object.fromEntries(s.residents.map(r => [r.name, quotaFor(r, s)]));
  it('Intern1 2 (15/28), others 4', () =>
    expect(q).toEqual({ Intern1: 2, Intern2: 4, Senior1: 4, Senior2: 4 }));
  it('half-month rounds half up: 4 * 14/28 = 2', () =>
    expect(quotaFor({ serviceStart: '2026-02-01', serviceEnd: '2026-02-14' }, s)).toBe(2));
});

describe('onService', () => {
  const anaelle = fixture.residents[0];
  it('inside window', () => expect(onService(anaelle, '2026-02-15')).toBe(true));
  it('outside window', () => expect(onService(anaelle, '2026-02-16')).toBe(false));
});
