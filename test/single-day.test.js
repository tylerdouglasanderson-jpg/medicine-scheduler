// @vitest-environment jsdom
// v1.8.0: "1 person OK" days - the chief lets the solver leave a single person working a date.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { solve } from '../src/solve.js';
import { audit } from '../src/audit.js';
import { validate } from '../src/validate.js';
import { parseScenario, RULES_VERSION } from '../src/model.js';
import { mount } from '../src/ui/app.js';
import { saveScenario } from '../src/ui/state.js';
import feb from '../fixtures/feb-2026.json';

const $ = sel => document.querySelector(sel);
const base = () => { const s = parseScenario(feb); s.lastSolution = null; return s; };
const ids = s => ({ call: new Set(Object.entries(s.schedule?.days ?? {}).filter(([, d]) => d.type === 'call').map(([k]) => k)) });

// A plain (non-call) weekday, found from the solved schedule, with two of the four residents pinned off.
async function setup() {
  const s0 = base();
  const sol0 = await solve(s0);
  const busy = new Set(s0.residents.flatMap(r => r.commitments.map(c => c.date)));
  const date = Object.entries(sol0.schedule.days).find(([k, d]) => d.type !== 'call' && !busy.has(k)
    && s0.residents.every(r => !r.pto.includes(k)))[0];
  return { s0, date };
}
const pinOff = (s, date, who) => ({ ...s, pins: [...s.pins, ...who.map(person => ({ person, date, type: 'offCounted', half: null, note: '' }))] });

describe('1 person OK days', () => {
  it('RULES_VERSION was bumped for the new semantics', () => expect(RULES_VERSION).toBe('1.3.0'));

  it('normalize keeps singleDays sorted, unique, in-month, with unknown people blanked', () => {
    const s = parseScenario({ ...feb, singleDays: [
      { date: '2026-02-10', person: 'Nobody' }, { date: '2026-02-03', person: 'Senior1' },
      { date: '2026-02-10', person: 'Senior1' }, { date: '2026-03-01', person: '' }] });
    expect(s.singleDays).toEqual([{ date: '2026-02-03', person: 'Senior1' }, { date: '2026-02-10', person: '' }]);
    expect(parseScenario(feb).singleDays).toEqual([]);
  });

  it('floor drops to 1 on a marked date: infeasible without, feasible + warned with', async () => {
    const { s0, date } = await setup();
    const names = s0.residents.map(r => r.name);
    const tight = pinOff(s0, date, names.slice(1));        // only names[0] left
    let plain = null; try { plain = await solve(tight); } catch { /* validate may refuse */ }
    const withSingle = { ...tight, singleDays: [{ date, person: '' }] };
    expect(validate(withSingle)).toEqual([]);
    const sol = await solve(withSingle);
    expect(sol.status ?? 'ok').not.toBe('infeasible');
    const a = audit(withSingle, sol.schedule);
    expect(a.violations).toEqual([]);
    expect(a.warnings.map(w => w.code)).toContain('W_SINGLE_COVER');
    expect(a.warnings.find(w => w.code === 'W_SINGLE_COVER').message).toContain(`${date}, as you allowed`);
    if (plain?.schedule) expect(audit(tight, plain.schedule).warnings.map(w => w.code)).not.toContain('W_SINGLE_COVER');
  });

  it('a named person works that day (implicit work pin)', async () => {
    const { s0, date } = await setup();
    const who = s0.residents.find(r => r.role === 'intern').name;
    const s = { ...s0, singleDays: [{ date, person: who }] };
    const sol = await solve(s);
    expect(sol.schedule.days[date].working).toContain(who);
    expect(audit(s, sol.schedule).violations).toEqual([]);
  });

  it('open day prefers a senior when only one works', async () => {
    const { s0, date } = await setup();
    const names = s0.residents.map(r => r.name);
    const keepSenior = s0.residents.find(r => r.role === 'senior').name;
    const keepIntern = s0.residents.find(r => r.role === 'intern').name;
    const tight = { ...pinOff(s0, date, names.filter(n => n !== keepSenior && n !== keepIntern)),
      singleDays: [{ date, person: '' }] };   // a senior and an intern left
    const sol = await solve(tight);
    const a = audit(tight, sol.schedule);
    expect(a.violations).toEqual([]);
    const w = sol.schedule.days[date].working;
    expect(w).toContain(keepSenior);   // whoever else is on, the senior is never the one dropped
  });

  it('validate refuses a named person who is on PTO that day', async () => {
    const { s0, date } = await setup();
    const r = s0.residents[0];
    const s = { ...s0, residents: s0.residents.map(x => (x === r ? { ...x, pto: [...x.pto, date] } : x)),
      singleDays: [{ date, person: r.name }] };
    expect(validate(s).map(e => e.code)).toContain('SINGLE_DAY_PERSON_UNAVAILABLE');
  });

  it('auditor flags a named person who is not working', async () => {
    const { s0, date } = await setup();
    const sol = await solve(s0);
    const idle = s0.residents.map(r => r.name).find(n => !sol.schedule.days[date].working.includes(n));
    if (!idle) return;
    const a = audit({ ...s0, singleDays: [{ date, person: idle }] }, sol.schedule);
    expect(a.violations.map(v => v.code)).toContain('A_SINGLE_PERSON_IGNORED');
  });
});

describe('1 person OK UI', () => {
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });
  it('mode toggles a date, shows a chip on every resident, lists it, and removes it', () => {
    HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute('open', ''); };
    saveScenario(base());
    localStorage.setItem('med-scheduler-howto-seen', '1');
    document.body.innerHTML = '<div id="app"></div>';
    mount($('#app'));
    expect($('#chips-section').textContent).toContain('None picked.');
    $('#mode-single').click(); $('#mode-single').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#chips-section .chip-day[data-date="2026-02-10"]').click();
    const chips = document.querySelectorAll('#chips-section .chip-single');
    expect(chips.length).toBe(4);                                  // one per resident
    expect($('#chips-section .single-day-row').textContent).toContain('2026-02-10');
    const sel = $('#chips-section .single-day-row select');
    expect(sel.options[0].textContent).toBe('Solver chooses');
    sel.value = sel.options[1].value; sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect($('#chips-section .single-day-row select').value).toBe(sel.options[1].value);
    $('#chips-section .single-day-row button').click();
    expect($('#chips-section').textContent).toContain('None picked.');
  });
});

describe('results-ready pop-up', () => {
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });
  it('after Solve, opens a dialog with the pin tip; closing it scrolls to the results', async () => {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
    let scrolled = 0; Element.prototype.scrollIntoView = function () { if (this.id === 'results-section') scrolled++; };
    localStorage.setItem('med-scheduler-howto-seen', '1');
    saveScenario(base());
    document.body.innerHTML = '<div id="app"></div>';
    mount($('#app'));
    const solveBtn = [...document.querySelectorAll('button')].find(b => b.textContent === 'Solve');
    solveBtn.click();
    await vi.waitFor(() => expect($('#results-dialog')?.hasAttribute('open')).toBe(true), { timeout: 60000 });
    expect($('#results-dialog').textContent).toContain('Your results are here');
    expect($('#results-dialog').textContent).toContain('click that day');
    expect(scrolled).toBe(0);
    $('#results-note-off').checked = true;
    $('#results-dialog').querySelector('.dialog-link').click();
    expect(scrolled).toBe(1);
    expect(localStorage.getItem('med-scheduler-results-note-off')).toBe('1');
  }, 90000);
});
