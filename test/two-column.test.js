// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { mount } from '../src/ui/app.js';
import { saveScenario } from '../src/ui/state.js';
import { parseScenario } from '../src/model.js';
import { solveAlternatives } from '../src/solve.js';
import feb from '../fixtures/feb-2026.json';

const $ = sel => document.querySelector(sel);
let solved;
beforeAll(async () => {
  const result = await solveAlternatives(parseScenario(feb));
  const alternatives = result.solutions.map(s => ({ ...s.schedule, objective: s.objective }));
  solved = parseScenario({ ...feb, alternatives, activeSolution: 0, lastSolution: alternatives[0] });
}, 30000);
beforeEach(() => {
  localStorage.clear();
  window.scrollTo = () => {};                      // jsdom has neither
  Element.prototype.scrollIntoView = () => {};
});

describe('two-column (revise) view', () => {
  it('opens two-column on a wide screen and switches both ways with the plain-language labels', () => {
    saveScenario(solved);
    window.innerWidth = 1500;
    document.body.innerHTML = '<div id="app"></div>';
    mount($('#app'));
    expect($('#revise-done').textContent).toBe('Return to single-column view');
    expect($('#auto-resolve').checked).toBe(true);               // on by default
    expect($('#auto-resolve').title).toBeTruthy();
    $('#revise-done').click();
    const enter = $('#revise-button');
    expect(enter.textContent).toBe('Return to two-column view');
    enter.click();
    expect($('#revise-done')).not.toBeNull();
  });
  it('stays single-column on a narrow screen and offers the button even with no schedule yet', () => {
    window.innerWidth = 800;
    document.body.innerHTML = '<div id="app"></div>';
    mount($('#app'));
    expect($('#revise-done')).toBeNull();
    expect($('#revise-button')).not.toBeNull();
    window.innerWidth = 1024;
  });
  it('the empty page offers two example months', () => {
    saveScenario(parseScenario({ team: 'A', month: '', anchorType: 'call', residents: [] }));
    document.body.innerHTML = '<div id="app"></div>';
    mount($('#app'));
    expect($('#load-example-button')).not.toBeNull();
    expect($('#load-example-button-2')).not.toBeNull();
    $('#load-example-button-2').click();
    expect(document.querySelectorAll('#roster-section tbody tr, #roster-section .resident-row').length).toBeGreaterThan(0);
  });
});

describe('bottom bar placement', () => {
  it('the app root is a full-height flex column so the action bar can pin to the bottom of a short page', () => {
    const css = readFileSync('src/ui/style.css', 'utf8');
    expect(css).toMatch(/#app\s*\{[^}]*min-height:\s*100dvh[^}]*flex-direction:\s*column/);
    expect(css).toMatch(/#app > \.action-bar\s*\{[^}]*margin-top:\s*auto/);
  });
});
