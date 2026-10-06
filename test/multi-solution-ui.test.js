// @vitest-environment jsdom
// v1.0.0 multi-solution UI (docs/RULES.md §12): tabs, the chosen tab as lastSolution, persistence,
// invalidation, and the all-solutions exports. Properties only — never exact cells.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import JSZip from 'jszip';
import { saveScenario, loadScenario, exportScenarioJSON, importScenarioJSON } from '../src/ui/state.js';
import { mount } from '../src/ui/app.js';
import { solveAlternatives } from '../src/solve.js';
import { parseScenario, RULES_VERSION } from '../src/model.js';
import { buildWorkbook, buildAllSolutionsWorkbook } from '../src/export.js';
import { buildAllSolutionsCalendarsZip } from '../src/ics.js';
import { audit } from '../src/audit.js';
import { describeDifference } from '../src/compare.js';
import feb from '../fixtures/feb-2026.json';
import twoPerson from '../scenarios/12-two-person-1s1i-medE.json';

const offCells = sch => Object.entries(sch.days).flatMap(([d, day]) => day.off.map(p => `${p}|${d}`)).sort();
const calendarText = () => document.querySelector('#results-section .calendar')?.textContent ?? '';

// One real solve shared by the non-UI tests: tabs as the app stores them (schedule + objective).
let solved;
beforeAll(async () => {
  const r = await solveAlternatives(parseScenario(feb));
  const alternatives = r.solutions.map(s => ({ ...s.schedule, objective: s.objective }));
  solved = parseScenario({ ...feb, alternatives, activeSolution: 1, lastSolution: alternatives[1],
    alternativesReason: r.stoppedReason });
}, 30000);

function mountApp() {
  document.body.innerHTML = '<div id="app"></div>';
  mount(document.getElementById('app'));
}

const waitSolved = () => vi.waitFor(() => {
  if (document.querySelector('#solve-button').textContent !== 'Solve') throw new Error('still solving');
}, { timeout: 30000, interval: 50 });

async function clickSolveAndWait() {
  document.querySelector('#solve-button').click();
  await waitSolved();
}

describe('multi-solution UI (jsdom)', () => {
  beforeEach(() => localStorage.clear());

  it('Solve renders Solution 1..N tabs, Solution 1 selected, with build progress on the way', async () => {
    saveScenario(parseScenario(feb));
    mountApp();
    const seen = new Set();
    const mo = new MutationObserver(recs => recs.forEach(r => r.addedNodes.forEach(n => {
      if (n.nodeType === 1) n.querySelectorAll?.('#solution-progress').forEach(p => seen.add(p.textContent));
    })));
    mo.observe(document.body, { childList: true, subtree: true });
    await clickSolveAndWait();
    mo.disconnect();

    const tabs = [...document.querySelectorAll('.solution-tab')];
    expect(tabs.length).toBeGreaterThan(1);
    expect(tabs.length).toBeLessThanOrEqual(5);
    expect(tabs.map(t => t.querySelector('.solution-tab-name').textContent)).toEqual(tabs.map((_, k) => `Solution ${k + 1}`));
    expect(tabs[0].querySelector('.solution-tab-sub').textContent).toBe('Current');
    expect(tabs.every(t => !t.disabled)).toBe(true);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('#solution-progress')).toBeNull();     // done building
    expect([...seen].some(t => /^Building alternatives \d\/5…$/.test(t))).toBe(true);
    expect(document.querySelector('#solution-header').textContent).toContain('Your current schedule');

    const s = loadScenario();
    expect(s.alternatives.length).toBe(tabs.length);
    expect(s.activeSolution).toBe(0);
    expect(s.lastSolution.days).toEqual(s.alternatives[0].days);
    expect(s.alternatives.every(a => a.rulesVersion === RULES_VERSION && typeof a.objective === 'number')).toBe(true);
  }, 30000);

  it('choosing a tab makes it lastSolution and redraws the calendar with its differs-header', () => {
    const one = { ...solved, activeSolution: 0, lastSolution: solved.alternatives[0] };
    saveScenario(one);
    mountApp();
    const before = calendarText();

    document.querySelector('#solution-tab-2').click();
    const s = loadScenario();
    expect(s.activeSolution).toBe(1);
    expect(s.lastSolution.days).toEqual(s.alternatives[1].days);
    expect(document.querySelector('#solution-tab-2').getAttribute('aria-selected')).toBe('true');
    expect(calendarText()).not.toBe(before);                         // off days differ by construction

    // the header is now chips + a details disclosure, built from the same describeDifference result
    const d = describeDifference(s,
      { schedule: s.alternatives[0], objective: s.alternatives[0].objective },
      { schedule: s.alternatives[1], objective: s.alternatives[1].objective });
    const chips = [...document.querySelectorAll('#solution-header .diff-chip')].map(c => c.textContent);
    expect(chips.at(-1)).toBe(d.lines.at(-1));                      // quality · issues
    expect(chips[0]).toBe(d.people.length
      ? `Days off moved: ${d.people.map(p => `${p.name} ${p.count}`).join(' · ')}` : 'Same days off');
    const details = document.querySelector('#solution-header details.diff-details');
    for (const p of d.people) expect(details.textContent).toContain(`${p.name}: day off ${p.moves.join(', ')}`);
    expect(document.querySelector('#solution-tab-2 .solution-tab-sub').textContent).toBe(`${d.quality} · ${d.stats.offsMoved} moves`);
    expect(document.querySelector('#solution-header').textContent).not.toMatch(/%/);
  });

  it('re-solving anchors the new Solution 1 on the tab that was selected', async () => {
    saveScenario(solved);                                    // tab 2 selected
    mountApp();
    const chosen = offCells(solved.alternatives[1]);
    await clickSolveAndWait();
    const s = loadScenario();
    expect(s.activeSolution).toBe(0);
    expect(offCells(s.alternatives[0])).toEqual(chosen);
    expect(document.querySelectorAll('.solution-tab').length).toBe(s.alternatives.length);
  }, 30000);

  it('an input edit clears every alternative along with lastSolution', () => {
    saveScenario(solved);
    mountApp();
    expect(document.querySelectorAll('.solution-tab').length).toBeGreaterThan(1);
    const name = document.querySelector('#roster-section input[type="text"]');
    name.value = 'Renamed resident';
    name.dispatchEvent(new Event('change'));

    expect(document.querySelectorAll('.solution-tab').length).toBe(0);
    expect(document.querySelector('#export-scope')).toBeNull();
    // the autosave is debounced; the in-memory state is what the next save writes
    expect(document.querySelector('#xlsx-export-button').disabled).toBe(true);
  });

  it('the export scope selector appears only with more than one solution', () => {
    saveScenario(solved);
    mountApp();
    const scope = document.querySelector('#export-scope');
    expect([...scope.options].map(o => o.textContent)).toEqual(['This solution', 'All solutions']);
    expect(document.querySelector('#calendar-export-button').textContent).toBe('Download calendar');
    expect(document.querySelector('#xlsx-export-button').textContent).toBe('Export spreadsheet');

    localStorage.clear();
    saveScenario({ ...solved, alternatives: [], activeSolution: 0 });
    mountApp();
    expect(document.querySelector('#export-scope')).toBeNull();
    expect(document.querySelectorAll('.solution-tab').length).toBe(0);
  });

  // solveAlternatives yields to the browser between solves, so the page is live while tabs build.
  // Nothing the user does then may mix the build with a different setup.
  it('mid-build: pins, exports and Save are locked, and opening another month discards the build', async () => {
    saveScenario(parseScenario(feb));
    mountApp();
    document.querySelector('#solve-button').click();
    await vi.waitFor(() => { if (!document.querySelector('#solution-progress')) throw new Error('not building yet'); },
      { timeout: 30000, interval: 5 });

    for (const id of ['#xlsx-export-button', '#google-sheets-button', '#calendar-export-button', '#save-button'])
      expect(document.querySelector(id).disabled).toBe(true);
    document.querySelector('#results-section td[data-date][data-row="OFF"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.pin-popover')).toBeNull();

    const input = document.querySelector('#load-input');
    Object.defineProperty(input, 'files', { value: [new File([JSON.stringify(twoPerson)], 'other.json')], configurable: true });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => { if (loadScenario().residents.length !== twoPerson.residents.length) throw new Error('not loaded'); },
      { timeout: 5000, interval: 5 });
    await waitSolved();

    const s = loadScenario();
    expect(s.alternatives).toEqual([]);                        // the old month's tabs never landed here
    expect(s.lastSolution).toBeNull();
    expect(feb.residents.some(r => calendarText().includes(r.name))).toBe(false);
  }, 30000);

  it('a stop reason shows under the tabs', () => {
    saveScenario({ ...solved, alternativesReason: 'Only 2 meaningfully different schedules exist — test.' });
    mountApp();
    expect(document.querySelector('#solution-reason').textContent).toContain('Only 2 meaningfully different');
  });

  // Astra review 2026-10-06: a pin the re-solve rejects used to leave every old tab selectable and
  // exportable although none of them honours the new pin.
  const pinFromCalendar = (date, type) => {
    document.querySelector(`#results-section td[data-date="${date}"][data-row="OFF"]`)
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const [, typeSel] = document.querySelectorAll('.pin-popover select');
    typeSel.value = type;
    [...document.querySelectorAll('.pin-popover button')].find(b => b.textContent === 'Pin & re-solve').click();
  };

  it('a rejected pin clears every solution: nothing stale to select, export or save', async () => {
    saveScenario(solved);
    mountApp();
    expect(document.querySelectorAll('.solution-tab').length).toBeGreaterThan(1);
    pinFromCalendar('2026-02-05', 'offCounted');            // an off on a call day: validate() rejects it
    await waitSolved();
    expect(document.querySelector('#errors-panel').textContent).toMatch(/call day/);
    expect(document.querySelectorAll('.solution-tab').length).toBe(0);
    expect(document.querySelector('#export-toggle').disabled).toBe(true);
    await vi.waitFor(() => { if (loadScenario().alternatives.length) throw new Error('not saved yet'); },
      { timeout: 2000, interval: 20 });
    const s = loadScenario();
    expect(s.lastSolution).toBeNull();
    expect(s.pins.some(p => p.date === '2026-02-05')).toBe(true);
  }, 30000);

  it('an accepted pin re-solves near the schedule that was on screen', async () => {
    saveScenario(solved);                                    // tab 2 selected
    mountApp();
    const before = solved.alternatives[1];
    const [date, offs] = Object.entries(before.days).find(([, dd]) => dd.off.length);
    pinFromCalendar(date, 'work');                           // pins the default person (the one off) to work
    await waitSolved();
    const s = loadScenario();
    expect(s.alternatives.length).toBeGreaterThan(0);
    expect(s.alternatives[0].days[date].off).not.toContain(offs.off[0]);
    const a = offCells(before), b = offCells(s.alternatives[0]);
    const moved = a.filter(c => !b.includes(c)).length + b.filter(c => !a.includes(c)).length;
    expect(moved).toBeLessThanOrEqual(6);                   // anchored, not rebuilt from scratch
  }, 30000);

  it('an input edit clears a Freeze-through date along with the schedule', async () => {
    saveScenario(solved);
    mountApp();
    const freeze = () => document.querySelector('.freeze-label input');
    freeze().value = '2026-02-28';
    freeze().dispatchEvent(new Event('change'));
    const name = document.querySelector('#roster-section input[type="text"]');
    name.value = 'Renamed resident';
    name.dispatchEvent(new Event('change'));
    expect(freeze().value).toBe('');
    await clickSolveAndWait();
    expect(document.querySelectorAll('.solution-tab').length).toBeGreaterThan(1);
    expect(document.querySelector('#solution-reason')?.textContent ?? '').not.toMatch(/pinned or frozen/);
  }, 30000);

  it('a pin edit clears Freeze-through too, so a pin that contradicts the old schedule still solves', async () => {
    saveScenario(solved);
    mountApp();
    const freeze = () => document.querySelector('.freeze-label input');
    freeze().value = '2026-02-28';
    freeze().dispatchEvent(new Event('change'));
    const [date] = Object.entries(solved.lastSolution.days).find(([, dd]) => dd.off.length);
    pinFromCalendar(date, 'work');                           // contradicts the frozen schedule's off
    await waitSolved();
    expect(freeze().value).toBe('');
    expect(document.querySelector('.infeasible-box')).toBeNull();
    expect(loadScenario().alternatives.length).toBeGreaterThan(0);
  }, 30000);

  it('the save hint Save button is locked while solving', async () => {
    saveScenario(parseScenario(feb));
    mountApp();
    await clickSolveAndWait();                               // first good solve shows the hint
    expect(document.querySelector('#save-hint-button')).not.toBeNull();
    document.querySelector('#solve-button').click();
    await vi.waitFor(() => { if (!document.querySelector('#solution-progress')) throw new Error('not building yet'); },
      { timeout: 30000, interval: 5 });
    expect(document.querySelector('#save-hint-button').disabled).toBe(true);
    await waitSolved();
    expect(document.querySelector('#save-hint-button').disabled).toBe(false);
  }, 60000);
});

describe('alternatives persistence (scenario JSON)', () => {
  it('export -> import keeps every tab and the selected one', () => {
    const back = importScenarioJSON(exportScenarioJSON(solved));
    expect(back.alternatives.length).toBe(solved.alternatives.length);
    expect(back.alternatives.map(a => a.days)).toEqual(solved.alternatives.map(a => a.days));
    expect(back.activeSolution).toBe(1);
    expect(back.lastSolution.days).toEqual(solved.alternatives[1].days);
    expect(back.alternativesReason).toBe(solved.alternativesReason);
  });

  it('parseScenario defaults: no alternatives on an old file', () => {
    const s = parseScenario(feb);
    expect(s.alternatives).toEqual([]);
    expect(s.activeSolution).toBe(0);
    expect(s.alternativesReason).toBeNull();
  });

  it('normalize drops alternatives built under other rules', () => {
    const json = JSON.parse(exportScenarioJSON(solved));
    json.alternatives = json.alternatives.map(a => ({ ...a, rulesVersion: '0.8.0' }));
    const s = parseScenario(json);
    expect(s.alternatives).toEqual([]);
    expect(s.activeSolution).toBe(0);
    expect(s.lastSolution).not.toBeNull();                   // the chosen schedule itself survives
  });

  it('normalize drops one stale alternative but keeps the set and re-points the active tab', () => {
    const json = JSON.parse(exportScenarioJSON(solved));
    if (json.alternatives.length < 3) return;                // needs a non-active, non-first tab
    json.alternatives[2] = { ...json.alternatives[2], rulesVersion: 'old' };
    json.activeSolution = 1;
    const s = parseScenario(json);
    expect(s.alternatives.length).toBe(solved.alternatives.length - 1);
    expect(s.alternatives[s.activeSolution].days).toEqual(s.lastSolution.days);
  });

  it('normalize drops the set when it no longer covers the month or roster', () => {
    const json = JSON.parse(exportScenarioJSON(solved));
    const s = parseScenario({ ...json, residents: json.residents.slice(1) });
    expect(s.alternatives).toEqual([]);
    const t = parseScenario({ ...json, month: '2026-03' });
    expect(t.alternatives).toEqual([]);
  });

  it('normalize clamps activeSolution to the tab that is lastSolution', () => {
    const json = JSON.parse(exportScenarioJSON(solved));
    const s = parseScenario({ ...json, activeSolution: 99 });
    expect(s.activeSolution).toBe(1);
    const t = parseScenario({ ...json, lastSolution: null });
    expect(t.alternatives).toEqual([]);
  });
});

describe('all-solutions exports', () => {
  it('xlsx: one sheet per solution, differs-header at the top of sheets 2..N', async () => {
    const n = solved.alternatives.length;
    const entries = solved.alternatives.map((sch, k) => ({
      schedule: sch, auditResult: audit(solved, sch),
      headerLines: k === 0 ? [] : ['Line one', 'Line two'],
    }));
    const wb = await buildAllSolutionsWorkbook(solved, entries, '1.0.0 test');
    expect(wb.worksheets.map(w => w.name)).toEqual(entries.map((_, k) => `Solution ${k + 1}`));
    expect(wb.worksheets.length).toBe(n);

    const [s1, s2] = wb.worksheets;
    expect(s1.getCell(2, 1).value).toBe('DATE');               // Solution 1 = the single-sheet layout
    expect(s2.getCell(2, 1).value).toBe('Line one');
    expect(s2.getCell(3, 1).value).toBe('Line two');
    expect(s2.getCell(4, 1).value).toBe('DATE');               // calendar pushed below the header
    expect(s2.getCell(4, 10).value).toBe('Resident');          // totals aligned with the calendar

    // the single export is unchanged by the refactor
    const single = (await buildWorkbook(solved, solved.alternatives[0], audit(solved, solved.alternatives[0]), '1.0.0 test')).worksheets[0];
    expect(JSON.stringify(single.getSheetValues().slice(1))).toBe(JSON.stringify(s1.getSheetValues().slice(1)));
  });

  it('calendars: one ZIP with a folder per solution, each holding every resident', async () => {
    const n = solved.alternatives.length;
    const zip = await JSZip.loadAsync(await buildAllSolutionsCalendarsZip(solved, solved.alternatives,
      { now: new Date(2026, 0, 1) }));
    const files = Object.keys(zip.files).filter(f => !zip.files[f].dir);
    const folders = [...new Set(files.map(f => f.split('/')[0]))].sort();
    expect(folders).toEqual(Array.from({ length: n }, (_, k) => `Solution ${k + 1}`).sort());
    expect(files.length).toBe(n * solved.residents.length);
    expect(await zip.file('Solution 1/Senior1-2026-02.ics').async('string')).toContain('BEGIN:VCALENDAR');

    const one = await JSZip.loadAsync(await buildAllSolutionsCalendarsZip(solved, solved.alternatives,
      { person: 'Senior1', now: new Date(2026, 0, 1) }));
    expect(Object.keys(one.files).filter(f => !one.files[f].dir).length).toBe(n);
  });
});
