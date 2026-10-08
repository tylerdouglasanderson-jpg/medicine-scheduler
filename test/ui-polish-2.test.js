// @vitest-environment jsdom
// UI polish round 2: inline radio/checkbox markup in the Report dialog, didactics em dash, totals header
// help, Export menu labels + dividers, Freeze-through label wiring, one wording for the example month.
// Presence and wiring, never layout.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { saveScenario } from '../src/ui/state.js';
import { mount } from '../src/ui/app.js';
import { renderTotals } from '../src/ui/calendar.js';
import { solveAlternatives } from '../src/solve.js';
import { parseScenario } from '../src/model.js';
import feb from '../fixtures/feb-2026.json';

let solved;
beforeAll(async () => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); };
  const r = await solveAlternatives(parseScenario(feb));
  const alternatives = r.solutions.map(s => ({ ...s.schedule, objective: s.objective }));
  solved = parseScenario({ ...feb, alternatives, activeSolution: 0, lastSolution: alternatives[0],
    alternativesReason: r.stoppedReason });
}, 30000);

function mountApp() {
  document.getElementById('feedback-dialog')?.remove();
  document.body.innerHTML = '<div id="app"></div>';
  mount(document.getElementById('app'));
}
const $ = sel => document.querySelector(sel);

describe('Report dialog form controls', () => {
  beforeEach(() => localStorage.clear());

  it('Problem / Idea is a segmented radio pair: each radio has its own label[for], not a wrapping label', () => {
    mountApp();
    $('#report-button').click();
    const dlg = $('#feedback-dialog');
    const group = dlg.querySelector('fieldset.feedback-type.segmented');
    expect(group).toBeTruthy();
    expect(group.querySelector('legend').textContent.length).toBeGreaterThan(0);   // the group has a name
    const radios = [...group.querySelectorAll('input[type="radio"][name="fb-type"]')];
    expect(radios.map(r => r.value)).toEqual(['problem', 'idea']);
    for (const r of radios) {
      expect(r.closest('label')).toBeNull();
      const label = r.nextElementSibling;
      expect(label.tagName).toBe('LABEL');
      expect(label.htmlFor).toBe(r.id);
    }
    expect(radios.map(r => r.nextElementSibling.textContent)).toEqual(['Problem', 'Idea']);
    radios[1].nextElementSibling.click();
    expect(dlg.querySelector('input[name="fb-type"]:checked').value).toBe('idea');
  });

  it('the attach checkbox sits first inside an inline label.check, and its text toggles it', () => {
    mountApp();
    $('#report-button').click();
    const box = $('#feedback-dialog [data-attach]');
    const label = box.parentElement;
    expect(label.tagName).toBe('LABEL');
    expect(label.classList.contains('check')).toBe(true);
    expect(label.firstElementChild).toBe(box);
    expect(label.textContent.trim()).toBe('Attach my schedule (recommended)');
    expect(box.checked).toBe(true);
    label.querySelector('span').click();
    expect(box.checked).toBe(false);
  });

  it('has the short title, a muted subtitle, and the dialog is named and described by them', () => {
    mountApp();
    $('#report-button').click();
    const dlg = $('#feedback-dialog');
    expect(document.getElementById(dlg.getAttribute('aria-labelledby')).textContent).toBe('Report a problem or idea');
    expect(document.getElementById(dlg.getAttribute('aria-describedby')).textContent)
      .toBe('We\'ll see exactly what you see.');
  });
});

describe('totals table', () => {
  it('a resident with no attendable didactics shows an em dash with an explanation, not 0 / 0', () => {
    const sched = solved.lastSolution;
    const name = Object.keys(sched.totals)[0];
    const t = renderTotals({ ...sched, totals: { ...sched.totals,
      [name]: { ...sched.totals[name], didactics: 0, didacticsOf: 0, didacticsPager: 0 } } });
    const cell = t.querySelector(`[data-name="${name}"][data-col="didactics"]`);
    expect(cell.textContent).toBe('—');
    expect(cell.title).toBe('No didactics sessions they could attend this month (call, post-call, PTO or off service)');
    expect(t.textContent).not.toContain('0 / 0');
  });

  it('every column header carries a plain-words tooltip and an accessible description', () => {
    const t = renderTotals(solved.lastSolution);
    const ths = [...t.querySelectorAll('thead th')];
    expect(ths.length).toBe(11);
    for (const th of ths) {
      expect(th.title.length, th.textContent).toBeGreaterThan(5);
      const desc = th.querySelector(`#${th.getAttribute('aria-describedby')}`);
      expect(desc?.textContent).toBe(th.title);
      expect(desc.hidden).toBe(true);
    }
    const byLabel = label => ths.find(th => th.firstChild.textContent === label);
    expect(byLabel('Perks').title).toMatch(/half days off/i);
    expect(byLabel('Off').title).toMatch(/half days are not/i);
  });

  it('numeric columns (Didactics included) are marked for right alignment; the name column is not', () => {
    const t = renderTotals(solved.lastSolution);
    for (const td of t.querySelectorAll('tbody td'))
      expect(td.classList.contains('num')).toBe(td.dataset.col !== 'name');
  });
});

describe('action bar', () => {
  beforeEach(() => localStorage.clear());

  it('Export menu selects have visible labels, and dividers split calendar / workbook / print', () => {
    saveScenario(solved);
    mountApp();
    const menu = $('#export-menu');
    expect(menu.querySelector('label[for="export-scope"]').textContent).toBe('Which solution');
    expect(menu.querySelector('label[for="calendar-export-person"]').textContent).toBe('Whose calendar');
    expect(menu.querySelectorAll('hr.export-divider').length).toBe(2);
    const order = [...menu.querySelectorAll('button, hr')].map(el => el.id || el.className);
    expect(order).toEqual(['calendar-export-button', 'export-divider', 'xlsx-export-button',
      'google-sheets-button', 'export-divider', 'print-button']);
  });

  it('with a single solution the scope select and its label are absent', () => {
    saveScenario({ ...solved, alternatives: [], activeSolution: 0 });
    mountApp();
    expect($('#export-scope')).toBeNull();
    expect($('label[for="export-scope"]')).toBeNull();
    expect($('label[for="calendar-export-person"]').textContent).toBe('Whose calendar');
  });

  it('Freeze through is a real label[for] wired to its date input; disabled with "Solve first" until solved', () => {
    mountApp();
    const label = $('.freeze-label label');
    const input = $('#freeze-date');
    expect(label.htmlFor).toBe('freeze-date');
    expect(label.control).toBe(input);
    expect(label.textContent).toBe('Freeze through');
    expect(input.disabled).toBe(true);
    expect(input.title).toBe('Solve first');

    saveScenario(solved);
    mountApp();
    expect($('#freeze-date').disabled).toBe(false);
    expect($('#freeze-date').title)
      .toBe('Keep every day up to this date exactly as it is; only later days can change');
  });
});

describe('results + empty state', () => {
  beforeEach(() => localStorage.clear());

  it('the change legend is a sample cell + text, with the toggle as a separate switch', () => {
    saveScenario(solved);
    mountApp();
    $('#solution-tab-2').click();
    const legendRow = $('#diff-legend');
    const key = legendRow.querySelector('.diff-legend-key');
    expect(key.querySelector('.diff-legend-swatch')).toBeTruthy();
    expect(key.querySelector('input')).toBeNull();
    const box = $('#highlight-changes');
    expect(box.getAttribute('role')).toBe('switch');
    expect(box.closest('label').classList.contains('switch')).toBe(true);
    expect(key.contains(box)).toBe(false);
  });

  it('the onboarding hint and the empty roster point at the same "Load the example month" button', () => {
    mountApp();
    const btn = $('#load-example-button');
    expect(btn.textContent).toContain('Load the example month');
    expect($('.onboarding-hint p').textContent).toContain('Load the example month');
    expect($('#roster-section .empty-state').textContent).toContain('Load the example month');
  });
});
