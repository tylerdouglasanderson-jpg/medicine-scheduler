// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { mount } from '../src/ui/app.js';
import { saveScenario, loadScenario } from '../src/ui/state.js';
import { parseScenario } from '../src/model.js';
import { solveAlternatives } from '../src/solve.js';
import { describeDifference } from '../src/compare.js';
import { audit } from '../src/audit.js';
import feb from '../fixtures/feb-2026.json';

const $ = sel => document.querySelector(sel);
const rows = () => [...document.querySelectorAll('#compare-solutions tbody tr')];
let solved;
beforeAll(async () => {
  const result = await solveAlternatives(parseScenario(feb));
  const alternatives = result.solutions.map(s => ({ ...s.schedule, objective: s.objective }));
  solved = parseScenario({ ...feb, alternatives, activeSolution: 0, lastSolution: alternatives[0] });
}, 30000);
beforeEach(() => localStorage.clear());

function mountApp(s = solved) {
  if (s) saveScenario(s);
  document.body.innerHTML = '<div id="app"></div>';
  mount($('#app'));
}

describe('UI polish round 3', () => {
  it('renders a real comparison table above the tabs, with roster labels and selected rows', () => {
    mountApp();
    expect(rows()).toHaveLength(solved.alternatives.length);
    expect($('#compare-solutions').tagName).toBe('DETAILS');
    expect($('#compare-solutions').open).toBe(true);
    expect($('#compare-solutions summary').textContent).toBe('Compare solutions');
    expect($('#compare-solutions').nextElementSibling.className).toBe('solution-tabs');
    expect([...$('#compare-solutions thead').querySelectorAll('th')].every(th => th.scope === 'col')).toBe(true);
    expect(rows()[0].querySelector('th').scope).toBe('row');
    expect(rows().every(row => row.tabIndex === 0)).toBe(true);
    expect(rows()[0].getAttribute('aria-selected')).toBe('true');
    expect($('#compare-solutions [data-metric="nights"]').title).toContain(solved.residents.map(r => r.name).join(' · '));
    expect([...$('#compare-solutions thead [data-metric="nights"]').querySelectorAll('span')].map(el => el.textContent))
      .toEqual(solved.residents.map(r => r.name.trim().split(/\s+/)[0].slice(0, 3)));
  });

  it('clicking row 3 selects Solution 3 as lastSolution and selects its tab', () => {
    mountApp();
    rows()[2].click();
    const s = loadScenario();
    expect(s.activeSolution).toBe(2);
    expect(s.lastSolution).toEqual(s.alternatives[2]);
    expect($('#solution-tab-3').getAttribute('aria-selected')).toBe('true');
    expect(rows().map(row => row.getAttribute('aria-selected'))).toEqual(
      rows().map((_, k) => String(k === 2)));
  });

  it('Enter selects a row and retains keyboard focus after rendering', () => {
    mountApp();
    rows()[2].focus();
    rows()[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(loadScenario().activeSolution).toBe(2);
    expect(document.activeElement).toBe(rows()[2]);
  });

  it('per-person night and pager counts match each schedule in roster order', () => {
    mountApp();
    expect(rows()).toHaveLength(solved.alternatives.length);
    for (const [k, row] of rows().entries()) {
      const schedule = solved.alternatives[k];
      const values = metric => [...row.querySelectorAll(`[data-metric="${metric}"] span`)].map(s => Number(s.textContent));
      expect(values('nights')).toEqual(solved.residents.map(r => Object.values(schedule.days).filter(d => d.night === r.name).length));
      expect(values('pager')).toEqual(solved.residents.map(r => schedule.totals[r.name].pager));
    }
  });

  it('weekend counts only Sat/Sun offs, excluding free whole days off', () => {
    const s = structuredClone(solved);
    const date = Object.keys(s.alternatives[0].days).find(d => [0, 6].includes(new Date(`${d}T12:00:00`).getDay()) && s.alternatives[0].days[d].off.length);
    const person = s.alternatives[0].days[date].off[0];
    s.pins.push({ person, date, type: 'offFree' });
    mountApp(s);
    const counts = [...rows()[0].querySelectorAll('[data-metric="weekend"] span')].map(el => Number(el.textContent));
    expect(counts).toEqual(s.residents.map(r => Object.entries(s.alternatives[0].days).filter(([d, day]) =>
      [0, 6].includes(new Date(`${d}T12:00:00`).getDay()) && day.off.includes(r.name) && !(r.name === person && d === date)).length));
  });

  it('shows comparison quality, days moved and warning counts with signed deltas', () => {
    mountApp();
    const base = solved.alternatives[0];
    const baseIssues = audit(solved, base).warnings.length;
    expect(rows()[0].querySelector('[data-metric="quality"]').textContent).toBe('Current');
    expect(rows()[0].querySelector('[data-metric="moves"]').textContent).toBe('—');
    for (const [k, row] of rows().entries()) {
      const alt = solved.alternatives[k];
      const count = audit(solved, alt).warnings.length, delta = count - baseIssues;
      expect(row.querySelector('[data-metric="issues"]').textContent).toBe(`${count} (${delta >= 0 ? '+' : ''}${delta})`);
      if (!k) continue;
      const diff = describeDifference(solved, { schedule: base, objective: base.objective }, { schedule: alt, objective: alt.objective });
      expect(row.querySelector('[data-metric="quality"]').textContent).toBe(diff.quality);
      expect(row.querySelector('[data-metric="moves"]').textContent).toBe(String(diff.stats.offsMoved));
      expect($(`#solution-tab-${k + 1} .solution-tab-sub`).textContent).toBe(`${diff.quality} · ${diff.stats.offsMoved} moves`);
    }
  });

  it('omits the table with a single solution', () => {
    mountApp({ ...solved, alternatives: [solved.alternatives[0]] });
    expect($('#compare-solutions')).toBeNull();
  });

  it('updates rows during a real solve, with muted, unavailable placeholders while building', async () => {
    mountApp(parseScenario(feb));
    const snapshots = [];
    const observer = new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
      const table = node.nodeType === 1 && node.querySelector('#compare-solutions');
      if (table) snapshots.push([...table.querySelectorAll('tbody tr')].map(row => ({
        pending: row.classList.contains('compare-pending'), disabled: row.getAttribute('aria-disabled'), text: row.textContent,
      })));
    })));
    observer.observe(document.body, { childList: true, subtree: true });
    try {
      $('#solve-button').click();
      await vi.waitFor(() => expect($('#solve-button').textContent).toBe('Solve'), { timeout: 30000 });
    } finally { observer.disconnect(); }
    expect(snapshots.some(s => s.length === 5 && s.filter(r => r.pending).length === 4)).toBe(true);
    expect(snapshots.flat().filter(r => r.pending).every(r => r.disabled === 'true' && r.text.includes('Building…'))).toBe(true);
    expect(rows()).toHaveLength(loadScenario().alternatives.length);
    expect(rows().every(row => !row.classList.contains('compare-pending'))).toBe(true);
  }, 30000);

  it('remembers disclosure state across selection and remount, outside the scenario', async () => {
    mountApp();
    $('#compare-solutions').open = false;
    await vi.waitFor(() => expect(localStorage.getItem('med-scheduler-compare-open')).toBe('false'));
    $('#solution-tab-2').click();
    expect($('#compare-solutions').open).toBe(false);
    mountApp();
    expect($('#compare-solutions').open).toBe(false);
  });

  it('stays usable when localStorage rejects the viewer preference', async () => {
    saveScenario(solved);
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function(key) {
      if (key === 'med-scheduler-compare-open') throw new Error('storage blocked');
      return get.call(this, key);
    });
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function(key, value) {
      if (key === 'med-scheduler-compare-open') throw new Error('storage blocked');
      return set.call(this, key, value);
    });
    try {
      mountApp();
      expect($('#compare-solutions').open).toBe(true);
      $('#compare-solutions').open = false;
      await vi.waitFor(() => expect(write).toHaveBeenCalledWith('med-scheduler-compare-open', 'false'));
      $('#solution-tab-2').click();
      expect($('#compare-solutions').open).toBe(false);
    } finally { read.mockRestore(); write.mockRestore(); }
  });

  it('uses the primary class for the onboarding example button', () => {
    mountApp(null);
    expect($('#load-example-button').classList.contains('btn-primary')).toBe(true);
  });
});
