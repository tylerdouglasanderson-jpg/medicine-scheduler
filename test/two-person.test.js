// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '../src/ui/app.js';
import { saveScenario } from '../src/ui/state.js';
import { parseScenario, onService, twoPersonCallDays, twoPersonPins, TWO_PERSON_NOTE } from '../src/model.js';
import { solve } from '../src/solve.js';
import { audit } from '../src/audit.js';
import { validate } from '../src/validate.js';
import swap from '../fixtures/example-3-then-2.json';

const $ = sel => document.querySelector(sel);
const base = () => parseScenario(structuredClone(swap));
const settle = () => new Promise(r => setTimeout(r, 0));
const idle = async () => {                                       // wait out the real solve the choice kicks off
  await settle();
  for (let i = 0; i < 900 && /Solving/.test($('#solve-button')?.textContent ?? ''); i++) await new Promise(r => setTimeout(r, 100));
};
const saved = () => new Promise(r => setTimeout(r, 450));   // the app debounces its save by 300 ms

describe('two-person helpers', () => {
  it('finds only call days with exactly one senior and one intern on service', () => {
    const s = base();
    const days = twoPersonCallDays(s);
    expect(days.length).toBeGreaterThan(0);
    for (const d of days) expect(s.residents.filter(r => onService(r, d)).length).toBe(2);
  });
  it.each(['intern', 'senior'])('mode %s pins the night person and gives the other day call', mode => {
    const s = base();
    const pins = twoPersonPins(s, mode);
    const days = twoPersonCallDays(s);
    expect(pins.length).toBe(days.length * 2);
    expect(pins.every(p => p.note === TWO_PERSON_NOTE)).toBe(true);
    for (const d of days) {
      const night = pins.find(p => p.date === d && p.type === 'nightCall');
      expect(s.residents.find(r => r.name === night.person).role).toBe(mode);
    }
  });
  it('alternate and manual fill nothing', () => {
    expect(twoPersonPins(base(), 'alternate')).toEqual([]);
    expect(twoPersonPins(base(), 'manual')).toEqual([]);
  });
  it('an unknown twoPersonNights value is cleaned to null', () => {
    const s = parseScenario({ ...structuredClone(swap), options: { ...swap.options, twoPersonNights: 'bogus' } });
    expect(s.options.twoPersonNights).toBeNull();
  });
});

describe('back-to-back nights', () => {
  it('intern-takes-every-night solves and audits clean', async () => {
    const s = base();
    s.pins = [...s.pins, ...twoPersonPins(s, 'intern')];
    s.options.twoPersonNights = 'intern';
    expect(validate(s)).toEqual([]);
    const r = await solve(s);
    expect(audit(s, r.schedule).violations).toEqual([]);
  }, 60000);
  it('the auditor still flags back-to-back nights that are not both pinned', async () => {
    const s = base();
    s.pins = [...s.pins, ...twoPersonPins(s, 'intern')];
    const r = await solve(s);
    const unpinned = { ...s, pins: s.pins.filter(p => p.type !== 'nightCall') };
    expect(audit(unpinned, r.schedule).violations.some(v => v.code === 'A_CONSECUTIVE_NIGHTS')).toBe(true);
  }, 60000);
  it('alternate mode still forbids back-to-back nights', async () => {
    const s = base();
    s.options.twoPersonNights = 'alternate';
    const r = await solve(s);
    expect(audit(s, r.schedule).violations.filter(v => v.code === 'A_CONSECUTIVE_NIGHTS')).toEqual([]);
  }, 60000);
});

describe('two-person pop-up', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('med-scheduler-howto-seen', '1');
    window.scrollTo = () => {};
    Element.prototype.scrollIntoView = () => {};
    HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close ??= function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
    document.body.innerHTML = '<div id="app"></div>';
  });
  const open = async () => {
    saveScenario(base());
    mount($('#app'));
    $('#solve-button').click();
    await settle();
  };
  it('closing the pop-up cancels the solve', async () => {
    await open();
    $('#two-person-dialog button.btn-ghost').click();
    await settle();
    expect($('#two-person-dialog')).toBeNull();
    expect($('#solve-button').disabled).toBe(false);        // no solve started
  });
  it('the manual choice fills nothing', async () => {
    await open();
    $('#two-person-manual').click();
    await settle();
    await saved();
    const saved2 = JSON.parse(localStorage.getItem('med-scheduler-scenario'));
    expect(saved2.options.twoPersonNights).toBe('manual');
    expect(saved2.pins.filter(p => p.note === 'two-person')).toEqual([]);
    await idle();
  });
  it('asks on Solve and the intern choice fills the pins and records the mode', async () => {
    await open();
    expect($('#two-person-dialog')).toBeTruthy();
    $('#two-person-intern').click();
    await settle();
    await saved();
    const saved2 = JSON.parse(localStorage.getItem('med-scheduler-scenario'));
    expect(saved2.options.twoPersonNights).toBe('intern');
    expect(saved2.pins.filter(p => p.note === 'two-person').length).toBeGreaterThan(0);
    expect($('#two-person-dialog')).toBeNull();
    await idle();
  }, 60000);
});
