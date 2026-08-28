// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { storage, saveScenario, loadScenario, exportScenarioJSON, importScenarioJSON } from '../src/ui/state.js';
import { mount } from '../src/ui/app.js';
import { solve } from '../src/solve.js';
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

  it('Clear scenario: cancel keeps the scenario, confirm empties it and autosave', () => {
    saveScenario(feb);
    document.body.innerHTML = '<div id="app"></div>';
    mount(document.getElementById('app'));
    expect(document.querySelectorAll('#roster-section tbody tr').length).toBe(4);

    window.confirm = () => false;
    document.querySelector('#clear-button').click();
    expect(document.querySelectorAll('#roster-section tbody tr').length).toBe(4);

    window.confirm = () => true;
    document.querySelector('#clear-button').click();
    expect(document.querySelectorAll('#roster-section tbody tr').length).toBe(0);
    expect(loadScenario().residents).toEqual([]);
    expect(loadScenario().month).toBe('');
  });

  it('a solved schedule offers each resident calendar, a ZIP, and spreadsheet exports', async () => {
    const { schedule } = await solve(feb);
    saveScenario({ ...feb, lastSolution: schedule });
    document.body.innerHTML = '<div id="app"></div>';
    mount(document.getElementById('app'));

    const calendarSelect = document.querySelector('#calendar-export-person');
    expect([...calendarSelect.options].map(o => o.textContent)).toEqual([
      'All residents (.zip)', 'Intern1', 'Intern2', 'Senior1', 'Senior2',
    ]);
    expect(document.querySelector('#calendar-export-button').textContent).toBe('Download calendar');
    expect(document.querySelector('#xlsx-export-button').textContent).toBe('Export spreadsheet');
    expect(document.querySelector('#google-sheets-button').textContent).toBe('Download & open Google Sheets');
  });

  it('invalidates a solved schedule after an input edit so stale exports cannot be downloaded', async () => {
    const { schedule } = await solve(feb);
    saveScenario({ ...feb, lastSolution: schedule });
    document.body.innerHTML = '<div id="app"></div>';
    mount(document.getElementById('app'));

    expect(document.querySelector('#calendar-export-button').disabled).toBe(false);
    const name = document.querySelector('#roster-section input[type="text"]');
    name.value = 'Renamed resident';
    name.dispatchEvent(new Event('change'));

    expect(document.querySelector('#calendar-export-button').disabled).toBe(true);
    expect(document.querySelector('#xlsx-export-button').disabled).toBe(true);
    expect(document.querySelector('#google-sheets-button').disabled).toBe(true);
  });
});
