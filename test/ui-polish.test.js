// @vitest-environment jsdom
// UI polish round 1: compact action bar + Export menu, totals formatting, grouped Potential Issues,
// change highlighting on Solutions 2..N, inline checkbox labels. Presence and wiring, never layout.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { saveScenario } from '../src/ui/state.js';
import { mount } from '../src/ui/app.js';
import { solveAlternatives } from '../src/solve.js';
import { parseScenario } from '../src/model.js';
import feb from '../fixtures/feb-2026.json';

let solved;
beforeAll(async () => {
  const r = await solveAlternatives(parseScenario(feb));
  const alternatives = r.solutions.map(s => ({ ...s.schedule, objective: s.objective }));
  solved = parseScenario({ ...feb, alternatives, activeSolution: 0, lastSolution: alternatives[0],
    alternativesReason: r.stoppedReason });
}, 30000);

function mountApp() {
  document.body.innerHTML = '<div id="app"></div>';
  mount(document.getElementById('app'));
}
const $ = sel => document.querySelector(sel);

describe('compact action bar', () => {
  beforeEach(() => localStorage.clear());

  it('holds Solve, Save, Open, the Export toggle and Clear in one bar, with no stacked captions', () => {
    mountApp();
    const bar = $('.action-bar');
    for (const id of ['#solve-button', '#save-button', '#open-button', '#export-toggle', '#clear-button'])
      expect(bar.contains($(id)), id).toBe(true);
    expect(document.querySelectorAll('.action-bar').length).toBe(1);
    expect(bar.querySelector('.action-group-label')).toBeNull();
    expect(bar.textContent).not.toMatch(/Share & export|Your work/i);
  });

  it('Export is disabled with a "Solve first" tooltip until there is a schedule', () => {
    mountApp();
    const toggle = $('#export-toggle');
    expect(toggle.disabled).toBe(true);
    expect(toggle.title).toBe('Solve first');
    expect($('#export-menu').hidden).toBe(true);
    expect($('#xlsx-export-button')).toBeTruthy();                // rendered, just inside the closed menu
  });

  it('the Export menu opens and exposes every export control; Escape and outside clicks close it', () => {
    saveScenario(solved);
    mountApp();
    const toggle = $('#export-toggle');
    const menu = $('#export-menu');
    expect(toggle.disabled).toBe(false);
    expect(menu.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    toggle.click();
    expect(menu.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    for (const id of ['#export-scope', '#calendar-export-person', '#calendar-export-button',
      '#xlsx-export-button', '#google-sheets-button', '#print-button'])
      expect(menu.contains($(id)), id).toBe(true);
    expect($('#print-button').textContent).toBe('Print');

    $('#export-scope').dispatchEvent(new MouseEvent('click', { bubbles: true }));   // inside: stays open
    expect(menu.hidden).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    toggle.click();
    expect(menu.hidden).toBe(false);
    $('#results-section h2').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(menu.hidden).toBe(true);
  });
});

describe('results polish', () => {
  beforeEach(() => localStorage.clear());

  it('totals show whole numbers without ".0"', () => {
    saveScenario(solved);
    mountApp();
    const cells = [...document.querySelectorAll('.totals-scroll .totals-table tbody td')];
    expect(cells.length).toBeGreaterThan(0);
    for (const td of cells) expect(td.textContent).not.toMatch(/^\d+\.0$/);
    expect($('.totals-table').textContent).not.toContain('.0');
  });

  it('calendar weeks and totals each sit in their own horizontal scroll wrapper', () => {
    saveScenario(solved);
    mountApp();
    const weeks = document.querySelectorAll('.calendar table.week');
    expect(weeks.length).toBeGreaterThan(0);
    for (const t of weeks) expect(t.parentElement.className).toBe('week-scroll');
    expect($('.totals-table').parentElement.className).toBe('totals-scroll');
  });

  it('Potential Issues are grouped under headers with counts, without repeating the ISO date', () => {
    saveScenario(solved);
    mountApp();
    const panel = $('.warnings-panel');
    const lis = [...panel.querySelectorAll('li.warning')];
    expect(lis.length).toBeGreaterThan(0);
    const groups = [...panel.querySelectorAll('details.issue-group')];
    expect(groups.length).toBeGreaterThan(0);
    let total = 0;
    for (const g of groups) {
      const m = g.querySelector('summary').textContent.match(/^(.+) \((\d+)\)$/);
      expect(m, g.querySelector('summary').textContent).toBeTruthy();
      expect(Number(m[2])).toBe(g.querySelectorAll('li.warning').length);
      total += Number(m[2]);
    }
    expect(total).toBe(lis.length);
    expect(groups[0].open).toBe(true);
    for (const li of lis) expect(li.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(panel.querySelector('.report-prompt').textContent).toBe('Something look wrong? Send it to us.');
  });

  it('change highlighting marks cells on Solution 2 but not on Solution 1, and can be switched off', () => {
    saveScenario(solved);
    mountApp();
    expect(document.querySelectorAll('.solution-tab').length).toBeGreaterThan(1);
    expect(document.querySelectorAll('.calendar td.cell-changed').length).toBe(0);
    expect($('#diff-legend')).toBeNull();

    $('#solution-tab-2').click();
    const marked = [...document.querySelectorAll('.calendar td.cell-changed')];
    expect(marked.length).toBeGreaterThan(0);
    expect(marked.every(td => ['OFF', 'ROUNDERS', 'PAGER'].includes(td.dataset.row))).toBe(true);
    expect($('#diff-legend').textContent).toContain('Outlined cells differ from Solution 1');

    const box = $('#highlight-changes');
    expect(box.checked).toBe(true);
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(document.querySelectorAll('.calendar td.cell-changed').length).toBe(0);
    expect($('#highlight-changes').checked).toBe(false);
  });
});

describe('setup polish', () => {
  beforeEach(() => localStorage.clear());

  it('preference checkboxes are inline, clickable labels under a "Preferences" heading', () => {
    saveScenario(parseScenario(feb));
    mountApp();
    const prefs = $('#setup-section .prefs');
    expect(prefs.querySelector('h3').textContent).toBe('Preferences');
    for (const name of ['goldenWeekend', 'seniorsOffShortCall', 'seniorFirstDay']) {
      const input = prefs.querySelector(`input[name="${name}"]`);
      const label = input.closest('label.check');
      expect(label, name).toBeTruthy();
      expect(label.firstElementChild).toBe(input);                 // box left of the text
    }
    const before = prefs.querySelector('input[name="goldenWeekend"]').checked;
    prefs.querySelector('input[name="goldenWeekend"]').closest('label').querySelector('span').click();
    expect($('#setup-section input[name="goldenWeekend"]').checked).toBe(!before);
  });

  it('the version chip reads "v<version> · What’s new"', () => {
    mountApp();
    expect($('#version-chip').textContent).toMatch(/^v\S+ · What’s new$/);
  });
});
