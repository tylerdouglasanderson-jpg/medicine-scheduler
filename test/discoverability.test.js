// @vitest-environment jsdom
// v1.0.0 discoverability: Report a problem, Save/Open, Download, What's new — plus the changelog
// being mirrored in the guide. UI assertions are about presence and wiring, never layout.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { saveScenario } from '../src/ui/state.js';
import { mount } from '../src/ui/app.js';
import { solve } from '../src/solve.js';
import { CHANGELOG } from '../src/changelog.js';
import feb from '../fixtures/feb-2026.json';
import { parseScenario } from '../src/model.js';

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8');
const guide = read('../src/ui/guide.html');
const pkg = JSON.parse(read('../package.json'));
const escapeHtml = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// jsdom has no <dialog> modal support; open/close are all these tests need.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); };
});

function mountApp() {
  document.getElementById('feedback-dialog')?.remove();
  document.querySelectorAll('dialog.app-dialog').forEach(d => d.remove());
  document.body.innerHTML = '<div id="app"></div>';
  mount(document.getElementById('app'));
}

async function clickSolveAndWait() {
  document.querySelector('#solve-button').click();
  await vi.waitFor(() => {
    if (document.querySelector('#solve-button').textContent !== 'Solve') throw new Error('still solving');
  }, { timeout: 30000, interval: 50 });
}

describe('changelog', () => {
  it('is newest first and its newest version is package.json\'s', () => {
    expect(CHANGELOG[0].version).toBe(pkg.version);
    expect(CHANGELOG.every(e => e.version && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.items.length > 0)).toBe(true);
    const dates = CHANGELOG.map(e => e.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('every version and every item also appears in the guide\'s What\'s new', () => {
    const section = guide.slice(guide.indexOf('<section id="whatsnew">'), guide.indexOf('<section id="tips">'));
    expect(section.length).toBeGreaterThan(0);
    for (const e of CHANGELOG) {
      expect(section, `version ${e.version}`).toContain(escapeHtml(e.version));
      for (const item of e.items) expect(section, item).toContain(escapeHtml(item));
    }
  });

  it('the guide uses the renamed buttons, not the old ones', () => {
    expect(guide).toContain('Save / Open a saved month');
    expect(guide).toContain('Save my month');
    expect(guide).toContain('Open a saved month…');
    expect(guide).toContain('Trying different versions');
    expect(guide).toContain('Report a problem');
    expect(guide).not.toMatch(/Save Scenario|Load Scenario|Run it yourself/);
  });
});

describe('index.html', () => {
  const html = read('../index.html');
  it('no longer hard-codes the download modal, and keeps the analytics beacon', () => {
    expect(html).not.toContain('dl-modal');
    expect(html).toContain('static.cloudflareinsights.com/beacon.min.js');
    expect(html).toContain('df859a3058d64f2cb31a24e189c51774');
  });
});

describe('app bar (jsdom)', () => {
  beforeEach(() => localStorage.clear());

  it('has a prominent Report a problem button that opens a problem-typed dialog', () => {
    mountApp();
    const btn = document.querySelector('#report-button');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('Report a problem');
    expect(btn.textContent).toContain('sends us your schedule');
    expect(document.querySelector('.app-bar #report-button')).toBe(btn);
    expect([...document.querySelectorAll('.app-bar button')].some(b => b.textContent === 'Feedback')).toBe(false);

    btn.click();
    const dlg = document.querySelector('#feedback-dialog');
    expect(dlg.hasAttribute('open')).toBe(true);
    expect(dlg.querySelector('h2').textContent).toBe('Report a problem or idea');
    expect(dlg.querySelector('.feedback-subtitle').textContent).toBe('We\'ll see exactly what you see.');
    expect(dlg.querySelector('input[name="fb-type"]:checked').value).toBe('problem');
    const attach = dlg.querySelector('[data-attach]');
    expect(attach.checked).toBe(true);
    expect(attach.parentElement.textContent).toContain('Attach my schedule (recommended)');
  });

  it('the Download button opens a dialog with direct "latest" links and no network call', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    mountApp();
    const btn = document.querySelector('#download-button');
    expect(btn.textContent).toBe('Download');
    expect(btn.title).toBe('Get the latest version to run offline');
    btn.click();

    const dlg = document.querySelector('#download-dialog');
    expect(dlg.hasAttribute('open')).toBe(true);
    const main = dlg.querySelector('#download-app-link');
    expect(main.textContent).toBe('Download the app (one HTML file)');
    expect(main.getAttribute('href')).toBe(
      'https://github.com/tylerdouglasanderson-jpg/medicine-scheduler/releases/latest/download/med-scheduler.html');
    expect(dlg.textContent).toContain('You’ll get the newest version');
    const kit = dlg.querySelector('#download-kit-link');
    expect(kit.textContent).toBe('Starter kit (.zip): app + guide + example months');
    expect(kit.getAttribute('href')).toBe(
      'https://github.com/tylerdouglasanderson-jpg/medicine-scheduler/releases/latest/download/Medicine-Scheduler.zip');
    expect([...dlg.querySelectorAll('a')].some(a => a.getAttribute('href').endsWith('/releases'))).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('the version chip opens What\'s new listing every changelog version', () => {
    mountApp();
    const chip = document.querySelector('.version-chip');
    expect(chip.tagName).toBe('BUTTON');
    chip.click();
    const dlg = document.querySelector('#whatsnew-dialog');
    expect(dlg.hasAttribute('open')).toBe(true);
    expect(dlg.querySelector('h2').textContent).toBe('What’s new');
    const headings = [...dlg.querySelectorAll('h3')].map(h => h.textContent);
    expect(headings.length).toBe(CHANGELOG.length);
    for (const e of CHANGELOG) expect(headings.some(h => h.startsWith(e.version))).toBe(true);
    expect(dlg.querySelectorAll('li').length).toBe(CHANGELOG.reduce((n, e) => n + e.items.length, 0));
  });
});

describe('Save / Open (jsdom)', () => {
  beforeEach(() => localStorage.clear());

  it('groups Save my month + Open a saved month under "Your work", ahead of the exports', () => {
    mountApp();
    const save = document.querySelector('#save-button');
    const open = document.querySelector('#open-button');
    const input = document.querySelector('#load-input');
    expect(save.textContent).toBe('Save my month (.json)');
    expect(open.textContent).toBe('Open a saved month…');
    expect(input.type).toBe('file');
    expect(input.hidden).toBe(true);
    expect(document.querySelector('.load-scenario-label')).toBeNull();
    expect(document.body.textContent).not.toContain('Save Scenario (JSON)');

    // one compact bar: the "Your work" group (labelled for assistive tech), then the Export menu
    const groups = [...document.querySelectorAll('.action-bar .action-group')];
    expect(groups[0].getAttribute('aria-label')).toBe('Your work');
    expect(groups[0].contains(save) && groups[0].contains(open)).toBe(true);
    expect(groups[1].contains(document.querySelector('#xlsx-export-button'))).toBe(true);
  });

  it('the Open button triggers the hidden file input', () => {
    mountApp();
    const spy = vi.spyOn(document.querySelector('#load-input'), 'click').mockImplementation(() => {});
    document.querySelector('#open-button').click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('after the first good Solve a one-time hint appears; dismissing it is remembered', async () => {
    saveScenario(feb);
    mountApp();
    expect(document.querySelector('#save-hint')).toBeNull();
    await clickSolveAndWait();
    const hint = document.querySelector('#save-hint');
    expect(hint.textContent).toContain('Want to keep these options or try changes? Save my month');
    expect(hint.textContent).toContain('send it to a co-chief');

    [...hint.querySelectorAll('button')].find(b => b.textContent === 'Dismiss').click();
    expect(document.querySelector('#save-hint')).toBeNull();

    await clickSolveAndWait();                               // dismissed for good
    expect(document.querySelector('#save-hint')).toBeNull();
  }, 60000);

  it('the hint still shows when storage is unavailable (the dismissal just is not remembered)', async () => {
    saveScenario(feb);
    mountApp();
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('SecurityError'); };
    try {
      await clickSolveAndWait();
      expect(document.querySelector('#save-hint')).toBeTruthy();
    } finally { Storage.prototype.getItem = orig; }
  }, 60000);
});

describe('"send it to us" prompts (jsdom)', () => {
  beforeEach(() => localStorage.clear());

  it('shows under Potential Issues and opens the dialog pre-filled as a problem with the schedule attached', async () => {
    const { schedule } = await solve(feb);
    saveScenario({ ...feb, lastSolution: schedule });
    mountApp();
    const prompt = document.querySelector('.warnings-panel .report-prompt');
    expect(prompt.textContent).toBe('Something look wrong? Send it to us.');
    expect(document.querySelectorAll('.report-prompt').length).toBe(1);

    prompt.querySelector('button').click();
    const dlg = document.querySelector('#feedback-dialog');
    expect(dlg.hasAttribute('open')).toBe(true);
    expect(dlg.querySelector('input[name="fb-type"]:checked').value).toBe('problem');
    expect(dlg.querySelector('[data-message]').value).toContain('Something looks wrong');
    expect(dlg.querySelector('[data-attach]').checked).toBe(true);
  }, 30000);

  it('a broken rule replaces it with the checker prompt', async () => {
    const { schedule } = await solve(feb);
    // Pin someone OFF on a day the schedule has them working: the auditor must flag the pin.
    const date = Object.keys(schedule.days).find(d => schedule.days[d].off.length === 0);
    const person = feb.residents[0].name;
    saveScenario({ ...feb, lastSolution: schedule, pins: [{ person, date, type: 'offCounted', half: null, note: '' }] });
    mountApp();
    const p = document.querySelector('.warnings-panel .report-prompt');
    expect(p.id).toBe('report-prompt-violation');
    expect(p.textContent).toBe('The checker found a broken rule — please send it to us.');
    p.querySelector('button').click();
    expect(document.querySelector('#feedback-dialog [data-message]').value).toContain('broken rule');
  }, 30000);

  it('shows in the infeasible box', async () => {
    // individually legal, jointly infeasible (see solve.test.js): asleep after a night, yet holding the pager
    saveScenario(parseScenario({ ...feb, pins: [
      { person: 'Intern2', date: '2026-02-05', type: 'nightCall' },
      { person: 'Intern2', date: '2026-02-06', type: 'pager' }] }));
    mountApp();
    await clickSolveAndWait();
    const box = document.querySelector('.infeasible-box');
    expect(box).toBeTruthy();
    const p = box.querySelector('.report-prompt');
    expect(p.textContent).toBe('Think this should have worked? Send this month to us.');
    p.querySelector('button').click();
    expect(document.querySelector('#feedback-dialog [data-message]').value).toContain('no feasible schedule');
  }, 60000);
});
