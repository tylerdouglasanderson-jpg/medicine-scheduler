// @vitest-environment jsdom
// Final release regressions: loaded schedules must pass today's input guard and independent audit.
import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { mount } from '../src/ui/app.js';
import { saveScenario, importScenarioJSON } from '../src/ui/state.js';
import { parseScenario, solutionIsCurrent } from '../src/model.js';
import { solve } from '../src/solve.js';
import { validate } from '../src/validate.js';
import { audit } from '../src/audit.js';
import { renderCalendar } from '../src/ui/calendar.js';
import { buildWorkbook, downloadXlsx, downloadAllXlsx } from '../src/export.js';
import { buildResidentCalendar, downloadResidentCalendar, downloadCalendarsZip,
  downloadAllSolutionsCalendarsZip } from '../src/ics.js';
import comp from '../fixtures/comp-2s1i.json';
import everyPin from '../scenarios/27-every-pin-type-and-attending-days.json';
import medc from '../fixtures/comp-medc.json';

// Keep the real builders; replace only browser download side effects.
vi.mock('../src/export.js', async original => ({ ...await original(),
  downloadXlsx: vi.fn(), downloadAllXlsx: vi.fn() }));
vi.mock('../src/ics.js', async original => ({ ...await original(),
  downloadResidentCalendar: vi.fn(), downloadCalendarsZip: vi.fn(),
  downloadAllSolutionsCalendarsZip: vi.fn() }));

let clean, twoHalves;
beforeAll(async () => {
  const s = parseScenario(structuredClone(comp));
  clean = { ...s, lastSolution: (await solve(s)).schedule };
  const pins = parseScenario(structuredClone(everyPin));
  twoHalves = { ...pins, lastSolution: (await solve(pins)).schedule };
}, 30000);
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const $ = selector => document.querySelector(selector);
const ids = ['calendar-export-button', 'xlsx-export-button', 'google-sheets-button', 'print-button'];
const notice = 'Your saved file will keep your setup but not the schedule until these errors are fixed.';
function show(s) {
  saveScenario(s);
  document.body.innerHTML = '<div id="app"></div>';
  mount($('#app'));
}
function broken(withPins = false) {
  const s = structuredClone(clean);
  for (const date of ['2026-02-11', '2026-02-17']) s.lastSolution.days[date].night = 'InternA';
  if (withPins) s.pins = ['2026-02-11', '2026-02-17'].map(date =>
    ({ person: 'InternA', date, type: 'nightCall' }));
  s.alternatives = [structuredClone(s.lastSolution), structuredClone(s.lastSolution)];
  s.activeSolution = 0;
  return s;
}
async function savedFile() {
  let blob;
  vi.stubGlobal('URL', { createObjectURL: vi.fn(b => { blob = b; return 'blob:test'; }), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  $('#save-button').click();
  const text = await new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(blob);
  });
  vi.unstubAllGlobals();
  return JSON.parse(text);
}

describe('loaded schedule export and save guard', () => {
  it('a 1.0.0 schedule is stale under the corrected rules while the package stays 1.0.0', async () => {
    const s = structuredClone(clean);
    s.lastSolution.rulesVersion = '1.0.0';
    expect(solutionIsCurrent(s)).toBe(false);
    show(s);
    expect($('#stale-rules-note')).not.toBeNull();
    const pkg = await import('../package.json');
    expect(pkg.default.version).toBe('1.0.0');
  });

  it.each([true, false])('locks every export and scope for invalid loaded schedules (hard inputs=%s)', async withPins => {
    const s = broken(withPins);
    expect(validate(s).some(e => e.code === 'NIGHT_ALTERNATION_IMPOSSIBLE')).toBe(withPins);
    expect(audit(s, s.lastSolution).violations.map(v => v.code)).toContain('A_NIGHT_SPLIT');
    show(s);
    expect($('#solve-button').disabled).toBe(withPins);
    for (const id of ids) {
      expect($('#' + id).disabled, id).toBe(true);
      expect($('#' + id).title).toBe('Fix the errors above, then Solve');
    }
    expect($('#export-scope')?.disabled ?? true).toBe(true);
    expect($('#errors-panel').textContent).toContain(notice);
    expect($('#save-button').disabled).toBe(false);
    const file = await savedFile();
    expect(file).not.toHaveProperty('lastSolution');
    expect(file).not.toHaveProperty('alternatives');
    expect(file.pins).toEqual(s.pins);
    expect(file.residents).toEqual(s.residents);
    expect(importScenarioJSON(JSON.stringify(file)).lastSolution).toBeNull();
  });

  it.each(ids)('guards the %s handler even when a click is dispatched directly', id => {
    show(broken());
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const open = vi.spyOn(window, 'open').mockImplementation(() => {});
    $('#' + id).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    for (const fn of [downloadXlsx, downloadAllXlsx, downloadResidentCalendar,
      downloadCalendarsZip, downloadAllSolutionsCalendarsZip, print, open]) expect(fn).not.toHaveBeenCalled();
  });

  it.each([true, false])('Save writes only inputs for an invalid loaded schedule (hard inputs=%s)', async withPins => {
    const s = broken(withPins);
    show(s);
    const file = await savedFile();
    expect(file).not.toHaveProperty('lastSolution');
    expect(file).not.toHaveProperty('alternatives');
    expect(file.pins).toEqual(s.pins);
    expect(importScenarioJSON(JSON.stringify(file)).lastSolution).toBeNull();
  });

  it('keeps clean schedules exportable and saves the chosen schedule and alternatives', async () => {
    const s = structuredClone(clean);
    s.alternatives = [s.lastSolution, structuredClone(s.lastSolution)];
    show(s);
    for (const id of ids) expect($('#' + id).disabled).toBe(false);
    expect($('#export-scope').disabled).toBe(false);
    const file = await savedFile();
    expect(file.lastSolution.days).toEqual(s.lastSolution.days);
    expect(file.alternatives).toHaveLength(2);
  });

  it('allows the solver-supported consecutive-night fallback to be exported and saved', async () => {
    const s = parseScenario(structuredClone(medc));
    s.pins = ['01', '07', '13', '19', '25', '31'].map(d =>
      ({ person: 'SeniorA', date: `2026-03-${d}`, type: 'nightCall' }));
    expect(validate(s)).toEqual([]);
    s.lastSolution = (await solve(s)).schedule;
    const violations = audit(s, s.lastSolution).violations;
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.every(v => v.code === 'A_CONSECUTIVE_NIGHTS')).toBe(true);
    show(s);
    for (const id of ids) expect($('#' + id).disabled).toBe(false);
    expect($('#errors-panel').textContent).not.toContain(notice);
    const file = await savedFile();
    expect(file.lastSolution.days).toEqual(s.lastSolution.days);
  });
});

describe('two half-off pins in personal calendars', () => {
  it.each([['AM', 'PM'], ['PM', 'AM']])('emits both halves and suppresses duty for pin order %s/%s', (first, second) => {
    const s = structuredClone(twoHalves);
    const both = s.pins.filter(p => p.person === 'Rutledge' && p.date === '2026-12-19');
    s.pins = [both.find(p => p.half === first), both.find(p => p.half === second)];
    const ics = buildResidentCalendar(s, s.lastSolution, 'Rutledge').replace(/\r\n[ \t]/g, '');
    const events = ics.split('BEGIN:VEVENT').slice(1).filter(e =>
      e.includes('DTSTART;TZID=America/Chicago:20261219'));
    expect(events).toHaveLength(2);
    expect(events.some(e => e.includes('SUMMARY:Half day off (AM)'))).toBe(true);
    expect(events.some(e => e.includes('SUMMARY:Half day off (PM)'))).toBe(true);
    expect(events.some(e => /SUMMARY:.*(?:Rounding|Short Call|Pager Duty|Didactics|Morning Report)/.test(e))).toBe(false);
  });

  it('AM and PM half-off suppression is independent on a Morning Report / didactics date', () => {
    const s = structuredClone(clean);
    const r = s.residents.find(r => r.name === 'SeniorA');
    r.didactics = { dow: 2, half: 'PM', hard: false };
    s.pins = ['PM', 'AM'].map(half => ({ person: r.name, date: '2026-02-10', type: 'halfOff', half }));
    const ics = buildResidentCalendar(s, s.lastSolution, r.name).replace(/\r\n[ \t]/g, '');
    const events = ics.split('BEGIN:VEVENT').slice(1).filter(e => e.includes('DTSTART;TZID=America/Chicago:20260210'));
    expect(events).toHaveLength(2);
    expect(events.every(e => e.includes('SUMMARY:Half day off'))).toBe(true);
  });
});

describe('didactics rows respect the pinned half', () => {
  function didactics(half) {
    const s = structuredClone(clean);
    s.residents.find(r => r.name === 'SeniorA').didactics = { dow: 2, half: 'PM', hard: false };
    s.pins = [{ person: 'SeniorA', date: '2026-02-10', type: 'halfOff', half }];
    // Presentation uses assignment facts, regardless of which optimum HiGHS chose.
    s.lastSolution.days['2026-02-10'].off = [];
    s.lastSolution.days['2026-02-10'].pager = 'SeniorB';
    return s;
  }
  it.each([['PM', false], ['AM', true]])('calendar attendance with a %s half-off is %s', (half, attends) => {
    const s = didactics(half);
    const el = renderCalendar(s, s.lastSolution);
    const td = el.querySelector('[data-date="2026-02-10"][data-row="DIDACTICS"]');
    expect(td.textContent.includes('SeniorA')).toBe(attends);
    expect(td.children).toHaveLength(0); // frozen cell DOM structure
  });
  it.each([['PM', false], ['AM', true]])('spreadsheet attendance with a %s half-off is %s', async (half, attends) => {
    const s = didactics(half);
    const wb = await buildWorkbook(s, s.lastSolution, audit(s, s.lastSolution));
    expect(String(wb.worksheets[0].getCell(15, 4).value).includes('SeniorA')).toBe(attends);
  });
});
