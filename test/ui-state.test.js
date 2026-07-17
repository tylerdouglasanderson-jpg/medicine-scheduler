// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { storage, saveScenario, loadScenario, exportScenarioJSON, importScenarioJSON } from '../src/ui/state.js';
import { mount } from '../src/ui/app.js';
import feb from '../fixtures/feb-2026.json';

describe('state round-trip', () => {
  beforeEach(() => localStorage.clear());
  it('save -> load returns the same scenario', () => {
    saveScenario(feb);
    expect(loadScenario()).toEqual(expect.objectContaining({ team: 'F', month: '2026-02' }));
  });
  it('scenario JSON export/import round-trips exactly', () => {
    const s = importScenarioJSON(exportScenarioJSON(feb));
    expect(s.residents.map(r => r.name)).toEqual(['Intern1', 'Intern2', 'Senior1', 'Senior2']);
    expect(s.options).toEqual({ offQuota: 4, goldenWeekend: false });
  });
  it('importScenarioJSON throws a readable error on garbage', () =>
    expect(() => importScenarioJSON('{nope')).toThrow());
  it('storage wrapper never throws when localStorage is broken', () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('SecurityError'); };
    expect(() => storage.set('k', { a: 1 })).not.toThrow();
    Storage.prototype.setItem = orig;
  });
});

describe('app smoke (jsdom)', () => {
  beforeEach(() => localStorage.clear());

  it('renders setup/roster/chips sections + errors panel; postcall reveals carryIn selects', () => {
    document.body.innerHTML = '<div id="app"></div>';
    mount(document.getElementById('app'));

    expect(document.querySelector('#setup-section')).toBeTruthy();
    expect(document.querySelector('#roster-section')).toBeTruthy();
    expect(document.querySelector('#chips-section')).toBeTruthy();
    expect(document.querySelector('#errors-panel')).toBeTruthy();
    expect(document.querySelectorAll('.carry-in select').length).toBe(0);

    const anchorSelect = document.querySelector('#setup-section select[name="anchorType"]');
    anchorSelect.value = 'postcall';
    anchorSelect.dispatchEvent(new Event('change'));

    expect(document.querySelectorAll('.carry-in select').length).toBe(3);
  });
});
