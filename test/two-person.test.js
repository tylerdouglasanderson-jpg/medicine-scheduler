// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '../src/ui/app.js';
import { saveScenario } from '../src/ui/state.js';
import { parseScenario, onService, twoPersonCallDays, noNightDays, twoPersonPins, TWO_PERSON_NOTE } from '../src/model.js';
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
  it('mode intern pins the intern to the nights and gives the senior day call', () => {
    const mode = 'intern';
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
  it('days and manual fill no pins', () => {
    expect(twoPersonPins(base(), 'days')).toEqual([]);
    expect(twoPersonPins(base(), 'manual')).toEqual([]);
  });
  it('noNightDays is the two-person days in days mode and empty otherwise', () => {
    const s = base();
    expect(noNightDays(s)).toEqual([]);
    s.options.twoPersonNights = 'days';
    expect(noNightDays(s)).toEqual(twoPersonCallDays(s));
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
});

describe('cross-cover nights (days mode)', () => {
  const daysMode = () => { const s = base(); s.options.twoPersonNights = 'days'; return s; };
  it('solves with no night person on the two-person days and audits clean', async () => {
    const s = daysMode();
    expect(validate(s)).toEqual([]);
    const r = await solve(s);
    expect(audit(s, r.schedule).violations).toEqual([]);
    for (const d of noNightDays(s)) {
      const day = r.schedule.days[d];
      expect(day.night).toBeNull();
      expect(day.working.length).toBe(2);
      const next = r.schedule.days[Object.keys(r.schedule.days)[Object.keys(r.schedule.days).indexOf(d) + 1]];
      if (next) expect(next.sleeper).toBeNull();
    }
  }, 60000);
  it('the auditor flags a night person on a cross-cover day', async () => {
    const s = daysMode();
    const r = await solve(s);
    const d = noNightDays(s)[0];
    const bad = structuredClone(r.schedule);
    bad.days[d].night = bad.days[d].working[0];
    expect(audit(s, bad).violations.some(v => v.code === 'A_NIGHT_COUNT')).toBe(true);
  }, 60000);
  it('a nightCall pin on a cross-cover day is a validation error', () => {
    const s = daysMode();
    const d = noNightDays(s)[0];
    const intern = s.residents.find(r => r.role === 'intern' && onService(r, d));
    s.pins = [...s.pins, { person: intern.name, date: d, type: 'nightCall', half: null, note: '' }];
    expect(validate(s).some(e => e.code === 'CONTRADICTORY_PINS')).toBe(true);
  });
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
    expect($('#two-person-senior')).toBeNull();
    expect($('#two-person-alternate')).toBeNull();
    expect($('#two-person-days')).toBeTruthy();
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
