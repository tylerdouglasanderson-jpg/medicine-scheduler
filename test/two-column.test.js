// @vitest-environment jsdom
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
  it('enters and leaves two-column view with the plain-language button labels', () => {
    saveScenario(solved);
    document.body.innerHTML = '<div id="app"></div>';
    mount($('#app'));
    const enter = $('#revise-button');
    expect(enter.textContent).toBe('Revise this plan');
    enter.click();                                     // renders the bar that has the auto-resolve switch
    expect($('#revise-done').textContent).toBe('Return to single-column view');
    expect($('#auto-resolve').title).toBeTruthy();
    $('#revise-done').click();
    expect($('#revise-button')).not.toBeNull();
  });
});
