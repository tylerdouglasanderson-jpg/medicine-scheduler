/* global __BUILD_VERSION__ */
import './style.css';
import { loadScenario, saveScenario, exportScenarioJSON, importScenarioJSON, storage } from './state.js';
import { validate } from '../validate.js';
import { audit } from '../audit.js';
import { downloadXlsx } from '../export.js';
import { solve, initHighs } from '../solve.js';
import { onService, monthDates, parseScenario } from '../model.js';
import { renderCalendar, renderTotals, renderWarnings } from './calendar.js';
import * as setup from './setup.js';
import * as roster from './roster.js';
import * as chips from './chips.js';
import { initFeedback, openFeedback } from './feedback.js';
import guideRaw from './guide.html?raw';
import feb from '../../fixtures/feb-2026.json';

let scenario;
let root;
let saveTimer = null;
let dialogEl = null;

// solve-flow state (transient — not persisted)
let solving = false;
let freezeDate = '';        // freeze-through-date; '' = no freeze
let diagnosis = null;       // last infeasible {diagnosis, culprits}
let solveError = null;      // last thrown-error message

export function mount(container) {
  root = container;
  scenario = loadScenario();
  ensureGuideDialog();
  initFeedback({ getScenarioJSON: () => exportScenarioJSON(scenario) });
  initHighs().catch(() => {});   // warm the wasm at page load so the first Solve is fast
  render();
}

function onChange(next) {
  scenario = next;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveScenario(scenario), 300);
  render();
}

function section(id) {
  const el = document.createElement('section');
  el.id = id;
  el.className = 'panel';
  return el;
}

// ---- guide dialog: lives on <body>, outside root, so re-render doesn't reset open state ----
function ensureGuideDialog() {
  if (dialogEl && document.body.contains(dialogEl)) return;

  dialogEl = document.createElement('dialog');
  dialogEl.id = 'guide-dialog';

  const header = document.createElement('div');
  header.className = 'guide-dialog-header';
  const h = document.createElement('h2');
  h.textContent = 'User Guide';
  header.appendChild(h);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn-ghost';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close';
  closeBtn.addEventListener('click', () => dialogEl.close());
  header.appendChild(closeBtn);
  dialogEl.appendChild(header);

  const iframe = document.createElement('iframe');
  iframe.className = 'guide-dialog-frame';
  iframe.srcdoc = guideRaw;
  dialogEl.appendChild(iframe);

  // backdrop click closes: a click that lands on the dialog element itself (not a child)
  // only happens when it lands on the ::backdrop area.
  dialogEl.addEventListener('click', e => { if (e.target === dialogEl) dialogEl.close(); });

  document.body.appendChild(dialogEl);
}

function topBar() {
  const bar = document.createElement('header');
  bar.className = 'app-bar';

  const left = document.createElement('div');
  left.className = 'app-bar-left';
  const h1 = document.createElement('h1');
  h1.textContent = 'Medicine Team Scheduler';
  left.appendChild(h1);
  const chip = document.createElement('span');
  chip.className = 'version-chip';
  chip.textContent = __BUILD_VERSION__;
  left.appendChild(chip);
  bar.appendChild(left);

  const right = document.createElement('div');
  right.className = 'app-bar-right';
  const guideBtn = document.createElement('button');
  guideBtn.type = 'button';
  guideBtn.className = 'btn-secondary';
  guideBtn.textContent = 'Guide';
  guideBtn.title = 'Open the full user guide.';
  guideBtn.addEventListener('click', () => { if (!dialogEl.open) dialogEl.showModal(); });
  right.appendChild(guideBtn);

  const dlBtn = document.createElement('button');
  dlBtn.type = 'button';
  dlBtn.className = 'btn-secondary';
  dlBtn.textContent = 'Run it yourself';
  dlBtn.title = 'Download the app to run it offline on your own machine.';
  dlBtn.addEventListener('click', () => document.getElementById('dl-modal').showModal());
  right.appendChild(dlBtn);

  const fbBtn = document.createElement('button');
  fbBtn.type = 'button';
  fbBtn.className = 'btn-secondary';
  fbBtn.textContent = 'Feedback';
  fbBtn.title = 'Report a problem or share an idea.';
  fbBtn.addEventListener('click', openFeedback);
  right.appendChild(fbBtn);

  bar.appendChild(right);

  return bar;
}

function onboardingHint() {
  const box = document.createElement('div');
  box.className = 'onboarding-hint';
  const p = document.createElement('p');
  p.textContent = 'Set up a team, month, and roster, then Solve to build the schedule. ' +
    'Not sure where to start? Load a working example below or open the Guide.';
  box.appendChild(p);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-secondary';
  btn.textContent = 'Load example (Medicine F · Feb 2026)';
  btn.title = 'Load a filled-in example scenario (Medicine F, February 2026) to see the app in action.';
  btn.addEventListener('click', () => onChange(parseScenario(feb)));
  box.appendChild(btn);
  return box;
}

function render() {
  closePopover();
  root.innerHTML = '';

  root.appendChild(topBar());

  const main = document.createElement('main');
  main.className = 'main';
  root.appendChild(main);

  if (!storage.available) {
    const notice = document.createElement('p');
    notice.className = 'storage-notice';
    notice.textContent = 'autosave unavailable — use Save Scenario (JSON)';
    main.appendChild(notice);
  }

  if (!scenario.residents.length || !scenario.month) {
    main.appendChild(onboardingHint());
  }

  const setupSection = section('setup-section');
  main.appendChild(setupSection);
  setup.render(setupSection, scenario, onChange);

  const rosterSection = section('roster-section');
  main.appendChild(rosterSection);
  roster.render(rosterSection, scenario, onChange);

  const chipsSection = section('chips-section');
  main.appendChild(chipsSection);
  chips.render(chipsSection, scenario, onChange);

  const errors = validate(scenario);
  const errorsPanel = section('errors-panel');
  renderErrors(errorsPanel, errors);
  main.appendChild(errorsPanel);

  main.appendChild(renderResults());

  root.appendChild(actionBar(errors));
}

function renderErrors(panel, errors) {
  panel.classList.toggle('panel-danger', errors.length > 0);
  const h = document.createElement('h2');
  h.textContent = 'Errors';
  panel.appendChild(h);
  const help = document.createElement('p');
  help.className = 'panel-help';
  help.textContent = 'Hard problems that must be fixed before Solve will run.';
  panel.appendChild(help);
  if (errors.length === 0) {
    const p = document.createElement('p');
    p.className = 'quiet-ok';
    p.textContent = 'No hard errors — ready to Solve.';
    panel.appendChild(p);
    return;
  }
  const ul = document.createElement('ul');
  for (const e of errors) {
    const li = document.createElement('li');
    li.className = 'error';
    li.textContent = e.message;
    ul.appendChild(li);
  }
  panel.appendChild(ul);
}

// ---- sticky bottom action bar: Solve + freeze, then Save/Load/Export/Print grouped right ----
function actionBar(errors) {
  const bar = document.createElement('div');
  bar.className = 'action-bar';

  const solveGroup = document.createElement('div');
  solveGroup.className = 'action-bar-solve';
  solveGroup.appendChild(solveButton(errors));
  solveGroup.appendChild(freezeControl());
  bar.appendChild(solveGroup);

  const divider = document.createElement('div');
  divider.className = 'action-bar-divider';
  bar.appendChild(divider);

  const ioGroup = document.createElement('div');
  ioGroup.className = 'action-bar-io';
  ioGroup.appendChild(ioButtons());
  ioGroup.appendChild(exportButtons());
  bar.appendChild(ioGroup);

  return bar;
}

function solveButton(errors) {
  const btn = document.createElement('button');
  btn.id = 'solve-button';
  btn.type = 'button';
  btn.className = 'btn-primary';
  btn.textContent = solving ? 'Solving…' : 'Solve';
  btn.title = 'Build the optimal schedule with the current setup.';
  btn.disabled = errors.length > 0 || solving;
  btn.addEventListener('click', runSolve);
  return btn;
}

function freezeControl() {
  const wrap = document.createElement('label');
  wrap.className = 'freeze-label';
  const span = document.createElement('span');
  span.textContent = 'Freeze through';
  wrap.appendChild(span);
  const freeze = document.createElement('input');
  freeze.type = 'date';
  freeze.title = 'Lock every assignment on/before this date to the last solution, then re-solve the ' +
    'rest — keeps early weeks stable while you iterate.';
  freeze.disabled = !scenario.lastSolution || solving;
  const dates = monthDates(scenario.month);
  if (dates.length) { freeze.min = dates[0]; freeze.max = dates[dates.length - 1]; }
  freeze.value = freezeDate;
  freeze.addEventListener('change', () => { freezeDate = freeze.value; });
  wrap.appendChild(freeze);
  return wrap;
}

async function runSolve() {
  if (solving) return;
  if (validate(scenario).length) { render(); return; }   // Solve gate — show errors, stay unsolved
  solving = true;
  diagnosis = null;
  solveError = null;
  render();                                               // "Solving…" state
  try {
    const result = await solve(scenario, { freezeDate: freezeDate || null });
    if (result.infeasible) {
      diagnosis = result.infeasible;                      // keep the prior lastSolution on screen
    } else {
      scenario = { ...scenario, lastSolution: result.schedule };
      saveScenario(scenario);
    }
  } catch (e) {
    solveError = e.message;
  } finally {
    solving = false;
    render();
  }
}

// ---- calendar color legend: swatches reuse the exact calendar fills ----
const LEGEND = [
  ['type-call', 'Call'], ['type', 'Cycle type'], ['rounders', 'Rounders'], ['pager', 'Pager'],
  ['clinic', 'Clinic'], ['didactics', 'Didactics'], ['pto', 'PTO'], ['off', 'Off'],
];

function legend() {
  const wrap = document.createElement('div');
  wrap.className = 'legend';
  for (const [cls, label] of LEGEND) {
    const item = document.createElement('span');
    item.className = 'legend-item';
    const swatch = document.createElement('span');
    swatch.className = `legend-swatch ${cls}`;
    item.appendChild(swatch);
    const text = document.createElement('span');
    text.textContent = label;
    item.appendChild(text);
    wrap.appendChild(item);
  }
  return wrap;
}

// ---- results: calendar + legend + totals + Potential Issues, or the staged diagnosis ----
function renderResults() {
  const wrap = section('results-section');

  const h = document.createElement('h2');
  h.textContent = 'Results';
  wrap.appendChild(h);
  const help = document.createElement('p');
  help.className = 'panel-help';
  help.textContent = 'The solved calendar, totals, and anything the independent auditor flags.';
  wrap.appendChild(help);

  if (solveError) {
    const box = document.createElement('div');
    box.className = 'solve-error';
    box.textContent = `Solve failed: ${solveError}`;
    wrap.appendChild(box);
  }

  if (diagnosis) {
    const box = document.createElement('div');
    box.className = 'infeasible-box';
    const dh = document.createElement('h2');
    dh.textContent = 'No feasible schedule';
    box.appendChild(dh);
    const p = document.createElement('p');
    p.textContent = diagnosis.diagnosis;
    box.appendChild(p);
    if (diagnosis.culprits?.length) {
      const ul = document.createElement('ul');
      for (const c of diagnosis.culprits) {
        const li = document.createElement('li');
        li.textContent = `${c.type} — ${c.person} ${c.date}`;
        ul.appendChild(li);
      }
      box.appendChild(ul);
    }
    wrap.appendChild(box);
  }

  const sched = scenario.lastSolution;
  const monthStart = monthDates(scenario.month)[0];
  // guard: a lastSolution from a since-changed month would key by stale dates and crash the renderer
  if (sched && monthStart && sched.days[monthStart]) {
    const cal = renderCalendar(scenario, sched);
    cal.addEventListener('click', onCalendarClick);
    cal.title = 'Click an OFF / PAGER / ROUNDERS cell to pin an assignment and re-solve';
    wrap.appendChild(cal);
    wrap.appendChild(legend());
    wrap.appendChild(renderTotals(sched));
    const a = audit(scenario, sched);
    // ponytail: fold independent-audit VIOLATIONS into the same panel — the auditor's whole
    // point is catching a solver hard-rule miss; silently dropping them would defeat it.
    wrap.appendChild(renderWarnings({ warnings: [...a.violations, ...a.warnings] }));
  } else if (!solveError && !diagnosis) {
    wrap.appendChild(resultsEmptyState());
  }

  return wrap;
}

function resultsEmptyState() {
  const box = document.createElement('div');
  box.className = 'empty-state';
  const p = document.createElement('p');
  p.textContent = 'Set up your team and month above, then press Solve to build the schedule.';
  box.appendChild(p);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-ghost';
  btn.textContent = 'Open the Guide';
  btn.title = 'Open the full user guide.';
  btn.addEventListener('click', () => { if (!dialogEl.open) dialogEl.showModal(); });
  box.appendChild(btn);
  return box;
}

// ---- click a rendered cell -> pin popover -> re-solve ----
const PINNABLE_ROWS = new Set(['OFF', 'PAGER', 'ROUNDERS']);
const PIN_TYPES = [
  ['offCounted', 'off (counted)'], ['offFree', 'off (free/bonus)'], ['work', 'must work'],
  ['pager', 'pager'], ['dayCall', 'day call'], ['nightCall', 'night call'],
  ['halfOff-AM', 'half off (AM)'], ['halfOff-PM', 'half off (PM)'],
];
let popoverEl = null;
let outsideHandler = null;

function onCalendarClick(e) {
  const td = e.target.closest('td[data-date][data-row]');
  if (!td || !PINNABLE_ROWS.has(td.dataset.row)) return;
  openPinPopover(td.getBoundingClientRect(), td.dataset.date, td.dataset.row);
}

function defaultPerson(date, row) {
  const dd = scenario.lastSolution?.days?.[date];
  if (!dd) return null;
  if (row === 'PAGER' && dd.pager && dd.pager !== 'ATTENDING') return dd.pager;
  if (row === 'ROUNDERS' && dd.night) return dd.night;
  if (row === 'OFF' && dd.off.length) return dd.off[0];
  return null;
}

function openPinPopover(rect, date, row) {
  closePopover();
  const people = scenario.residents.filter(r => onService(r, date)).map(r => r.name);
  if (!people.length) return;

  const pop = document.createElement('div');
  pop.className = 'pin-popover';
  pop.style.position = 'absolute';
  pop.style.zIndex = '1000';
  pop.style.left = `${Math.min(rect.left + window.scrollX, window.scrollX + window.innerWidth - 200)}px`;
  pop.style.top = `${rect.bottom + window.scrollY}px`;

  const title = document.createElement('div');
  title.className = 'pin-popover-title';
  title.textContent = `Pin — ${date}`;
  pop.appendChild(title);

  const personSel = mkSelect(people.map(n => [n, n]));
  const dflt = defaultPerson(date, row);
  if (dflt) personSel.value = dflt;
  pop.appendChild(personSel);

  const typeSel = mkSelect(PIN_TYPES);
  typeSel.value = row === 'PAGER' ? 'pager' : row === 'ROUNDERS' ? 'nightCall' : 'offCounted';
  pop.appendChild(typeSel);

  pop.appendChild(mkButton('Pin & re-solve', () => {
    addPin(personSel.value, date, typeSel.value);
    closePopover();
    runSolve();
  }, 'btn-primary'));
  pop.appendChild(mkButton('Remove pins here', () => {
    removePins(personSel.value, date);
    closePopover();
    runSolve();
  }, 'btn-secondary'));
  pop.appendChild(mkButton('Cancel', closePopover, 'btn-ghost'));

  document.body.appendChild(pop);
  popoverEl = pop;
  outsideHandler = ev => { if (popoverEl && !popoverEl.contains(ev.target)) closePopover(); };
  setTimeout(() => document.addEventListener('click', outsideHandler), 0);
}

function closePopover() {
  if (outsideHandler) { document.removeEventListener('click', outsideHandler); outsideHandler = null; }
  if (popoverEl) { popoverEl.remove(); popoverEl = null; }
}

function mkSelect(opts) {
  const sel = document.createElement('select');
  for (const [v, l] of opts) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = l;
    sel.appendChild(o);
  }
  return sel;
}

function mkButton(text, onClick, cls = 'btn-secondary') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function addPin(person, date, rawType) {
  const isHalf = rawType.startsWith('halfOff');
  const type = isHalf ? 'halfOff' : rawType;
  const half = isHalf ? (rawType.endsWith('AM') ? 'AM' : 'PM') : null;
  const pins = scenario.pins.filter(
    p => !(p.person === person && p.date === date && p.type === type && p.half === half));
  pins.push({ person, date, type, half, note: '' });
  scenario = { ...scenario, pins };
  saveScenario(scenario);
}

function removePins(person, date) {
  scenario = { ...scenario, pins: scenario.pins.filter(p => !(p.person === person && p.date === date)) };
  saveScenario(scenario);
}

function ioButtons() {
  const wrap = document.createElement('div');
  wrap.className = 'io-buttons';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn-secondary';
  saveBtn.textContent = 'Save Scenario (JSON)';
  saveBtn.title = 'Download this scenario as JSON — for backup or sharing.';
  saveBtn.addEventListener('click', () => {
    const blob = new Blob([exportScenarioJSON(scenario)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${scenario.team || 'scenario'}-${scenario.month || 'unset'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
  wrap.appendChild(saveBtn);

  const loadLabel = document.createElement('label');
  loadLabel.className = 'load-scenario-label';
  loadLabel.title = 'Load a previously saved scenario JSON file.';
  loadLabel.textContent = 'Load Scenario (JSON): ';
  const loadInput = document.createElement('input');
  loadInput.type = 'file';
  loadInput.accept = 'application/json';
  loadInput.addEventListener('change', () => {
    const file = loadInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { onChange(importScenarioJSON(reader.result)); }
      catch (e) { alert(`Could not load scenario: ${e.message}`); }
    };
    reader.readAsText(file);
  });
  loadLabel.appendChild(loadInput);
  wrap.appendChild(loadLabel);

  return wrap;
}

// Export xlsx / Print — enabled once a schedule exists (`scenario.lastSolution`, set by Solve).
function exportButtons() {
  const wrap = document.createElement('div');
  wrap.className = 'export-buttons';
  const schedule = scenario.lastSolution;

  const xlsxBtn = document.createElement('button');
  xlsxBtn.type = 'button';
  xlsxBtn.className = 'btn-secondary';
  xlsxBtn.textContent = 'Export xlsx';
  xlsxBtn.title = 'Download a colored spreadsheet matching this grid.';
  xlsxBtn.disabled = !schedule;
  xlsxBtn.addEventListener('click', () => downloadXlsx(scenario, schedule, audit(scenario, schedule)));
  wrap.appendChild(xlsxBtn);

  const printBtn = document.createElement('button');
  printBtn.type = 'button';
  printBtn.className = 'btn-secondary';
  printBtn.textContent = 'Print';
  printBtn.title = 'Print the calendar + totals (browser → PDF).';
  printBtn.disabled = !schedule;
  printBtn.addEventListener('click', () => window.print());
  wrap.appendChild(printBtn);

  return wrap;
}
