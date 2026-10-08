/* global __BUILD_VERSION__ */
import './style.css';
import { loadScenario, saveScenario, blankScenario, exportScenarioJSON, importScenarioJSON, storage } from './state.js';
import { validate } from '../validate.js';
import { audit } from '../audit.js';
import { downloadXlsx, downloadAllXlsx } from '../export.js';
import { downloadResidentCalendar, downloadCalendarsZip, downloadAllSolutionsCalendarsZip } from '../ics.js';
import { solveAlternatives, initHighs } from '../solve.js';
import { describeDifference } from '../compare.js';
import { onService, monthDates, parseScenario, solutionIsCurrent, afternoonsOffDates } from '../model.js';
import { renderCalendar, renderTotals, renderWarnings } from './calendar.js';
import * as setup from './setup.js';
import * as roster from './roster.js';
import * as chips from './chips.js';
import { initFeedback, openFeedback } from './feedback.js';
import { CHANGELOG } from '../changelog.js';
import guideRaw from './guide.html?raw';
import feb from '../../fixtures/feb-2026.json';

let scenario;
let root;
let saveTimer = null;
let dialogEl = null;
let dismissInstalled = false;

// solve-flow state (transient — not persisted)
let solving = false;
let freezeDate = '';        // freeze-through-date; '' = no freeze
let diagnosis = null;       // last infeasible {diagnosis, culprits}
let solveError = null;      // last thrown-error message
let progress = null;        // {done, total} while alternatives are still arriving
let solveSeq = 0;           // bumped by any input edit, so a solve that outlives it is discarded
let exportScope = 'one';    // 'one' = the active tab, 'all' = every solution
let saveHintPending = false; // set by the first successful Solve; the "save my month" hint shows until dismissed
let compareOpen = true;
// The schedule a pin / attending-day re-solve stays close to (stability). A pin edit
// clears every displayed and exportable solution — none of them honours the new pin — but the re-solve
// still anchors on the schedule the chief was looking at. Never rendered, exported or saved; cleared by
// any other edit, by opening a month, by Clear, and once a solve succeeds.
let anchor = null;

const RELEASES = 'https://github.com/tylerdouglasanderson-jpg/medicine-scheduler/releases';
const HINT_KEY = 'med-scheduler-save-hint-dismissed';
const COMPARE_KEY = 'med-scheduler-compare-open';
const appVersion = () => String(typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'dev').split(' ')[0];

export function mount(container) {
  root = container;
  scenario = loadScenario();
  compareOpen = true;
  try { compareOpen = localStorage.getItem(COMPARE_KEY) !== 'false'; } catch { /* viewer storage may be unavailable */ }
  ensureGuideDialog();
  initFeedback({ getScenarioJSON: () => exportScenarioJSON(scenario) });
  initHighs().catch(() => {});   // warm the wasm at page load so the first Solve is fast
  if (!dismissInstalled) { installExportMenuDismiss(); dismissInstalled = true; }
  render();
}

// Any input edit invalidates the solved schedule AND every alternative (docs/RULES.md §12).
const NO_SOLUTION = { lastSolution: null, alternatives: [], activeSolution: 0, alternativesReason: null };

// Saved files can carry assignments that today's inputs or rules no longer allow. Consecutive
// nights are the model's penalized fallback; every other hard audit finding blocks export/save.
function exportableSchedule(schedule = scenario.lastSolution) {
  if (validate(scenario).length || !schedule) return null;
  return audit(scenario, schedule).violations.some(v =>
    v.code.startsWith('A_') && v.code !== 'A_CONSECUTIVE_NIGHTS') ? null : schedule;
}

const FIX_EXPORT_TIP = 'Fix the errors above, then Solve';

function onChange(next, { preserveSolution = false } = {}) {
  if (!preserveSolution) {
    solveSeq++;
    anchor = null;
    freezeDate = '';      // freezing needs a schedule to freeze to; a stale date would silently box in the next solve
  }
  scenario = preserveSolution ? next : { ...next, ...NO_SOLUTION };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveScenario(scenario), 300);
  render();
}

// A pin or attending-day edit: every solution on screen is now invalid (it may break the new input),
// so they go — but the next solve keeps the chosen schedule as its stability anchor. Freeze-through
// stays cleared: a freeze to the old schedule can contradict the very pin just added.
function editKeepingAnchor(next) {
  const keep = scenario.lastSolution ?? anchor;
  onChange(next);
  anchor = keep;
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
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'version-chip';
  chip.id = 'version-chip';
  const buildDate = String(typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : '').split(' ')[1];
  chip.textContent = `v${appVersion()} · What’s new`;
  chip.title = `Version ${appVersion()}${buildDate ? ` (built ${buildDate})` : ''} — see what’s new.`;
  chip.addEventListener('click', openWhatsNew);
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
  dlBtn.id = 'download-button';
  dlBtn.type = 'button';
  dlBtn.className = 'btn-secondary';
  dlBtn.textContent = 'Download';
  dlBtn.title = 'Get the latest version to run offline';
  dlBtn.addEventListener('click', openDownload);
  right.appendChild(dlBtn);

  // Deliberately loud: amber, two lines, and it says what it sends. A co-chief who hits a bad
  // schedule should find this before they think of texting a screenshot.
  const reportBtn = document.createElement('button');
  reportBtn.id = 'report-button';
  reportBtn.type = 'button';
  reportBtn.className = 'btn-report';
  reportBtn.title = 'Tell us what went wrong — we receive your schedule so we can see exactly what you see.';
  // narrow screens hide the second line visually; the accessible name keeps it
  reportBtn.setAttribute('aria-label', 'Report a problem — sends us your schedule');
  const main = document.createElement('span');
  main.className = 'btn-report-main';
  main.textContent = 'Report a problem';
  const sub = document.createElement('span');
  sub.className = 'btn-report-sub';
  sub.textContent = 'sends us your schedule';
  reportBtn.append(main, ' ', sub);
  reportBtn.addEventListener('click', () => openFeedback({ type: 'problem' }));
  right.appendChild(reportBtn);

  bar.appendChild(right);

  return bar;
}

function onboardingHint() {
  const box = document.createElement('div');
  box.className = 'onboarding-hint';
  const p = document.createElement('p');
  p.textContent = 'Set up a team, month, and roster, then Solve to build the schedule. ' +
    'Not sure where to start? Press “Load the example month” below, or open the Guide.';
  box.appendChild(p);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-primary';
  btn.id = 'load-example-button';
  btn.textContent = 'Load the example month (Medicine F · Feb 2026)';
  btn.title = 'Load a filled-in example scenario (Medicine F, February 2026) to see the app in action.';
  btn.addEventListener('click', () => onChange(parseScenario(feb)));
  box.appendChild(btn);
  return box;
}

function render() {
  closePopover();
  const comparison = root.querySelector('#compare-solutions');
  if (comparison) compareOpen = comparison.open;
  root.innerHTML = '';

  root.appendChild(topBar());

  const main = document.createElement('main');
  main.className = 'main';
  root.appendChild(main);

  if (!storage.available) {
    const notice = document.createElement('p');
    notice.className = 'storage-notice';
    notice.textContent = 'autosave unavailable — use “Save my month (.json)” so you don’t lose your work';
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
  if (errors.length || (scenario.lastSolution && !exportableSchedule())) {
    const notice = document.createElement('p');
    notice.className = 'panel-help';
    notice.textContent = 'Your saved file will keep your setup but not the schedule until these errors are fixed.';
    errorsPanel.appendChild(notice);
  }
  main.appendChild(errorsPanel);

  main.appendChild(renderResults());

  root.appendChild(actionBar(errors));
  revealActiveTab();
}

// On a phone the tab strip scrolls inside itself; every render rebuilds it at scrollLeft 0, so bring
// the selected tab back into view (scrollLeft only — never scrolls the page).
function revealActiveTab() {
  const strip = root.querySelector('.solution-tabs');
  const tab = strip?.querySelector('[aria-selected="true"]');
  if (!tab || strip.scrollWidth <= strip.clientWidth) return;
  strip.scrollLeft = Math.max(0, tab.offsetLeft - (strip.clientWidth - tab.offsetWidth) / 2);
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

// ---- sticky bottom action bar: one compact row —
// [Solve][Freeze through] | [Save my month][Open a saved month] | [Export ▾] ......... Clear scenario
// The export controls live in a small menu that opens above the bar.
let exportMenuOpen = false;   // survives re-renders; closed by outside click / Escape / no schedule

function actionBar(errors) {
  const bar = document.createElement('div');
  bar.className = 'action-bar';

  const solveGroup = document.createElement('div');
  solveGroup.className = 'action-bar-solve';
  solveGroup.appendChild(solveButton(errors));
  solveGroup.appendChild(freezeControl());
  bar.appendChild(solveGroup);

  bar.appendChild(divider());

  // The user's own file, kept visually together and apart from the exports.
  const work = document.createElement('div');
  work.className = 'action-group action-group-work';
  work.setAttribute('role', 'group');
  work.setAttribute('aria-label', 'Your work');
  work.appendChild(ioButtons());
  bar.appendChild(work);

  bar.appendChild(divider());
  bar.appendChild(exportMenu());

  const clear = clearButton();
  clear.classList.add('action-bar-clear');
  bar.appendChild(clear);

  return bar;
}

function divider() {
  const d = document.createElement('div');
  d.className = 'action-bar-divider';
  d.setAttribute('aria-hidden', 'true');
  return d;
}

function exportMenu() {
  const hasSchedule = !!scenario.lastSolution;
  if (!hasSchedule) exportMenuOpen = false;

  const wrap = document.createElement('div');
  wrap.className = 'action-group action-group-export export-menu-wrap';

  const toggle = document.createElement('button');
  toggle.id = 'export-toggle';
  toggle.type = 'button';
  toggle.className = 'btn-secondary export-toggle';
  toggle.textContent = 'Export ▾';
  toggle.setAttribute('aria-haspopup', 'true');
  toggle.setAttribute('aria-controls', 'export-menu');
  toggle.setAttribute('aria-expanded', String(exportMenuOpen));
  toggle.disabled = !hasSchedule;
  toggle.title = hasSchedule ? 'Calendars, spreadsheet, Google Sheets, print.' : 'Solve first';
  // a disabled button shows no tooltip in some browsers — the wrapper carries it too
  wrap.title = hasSchedule ? '' : 'Solve first';
  toggle.addEventListener('click', () => setExportMenu(!exportMenuOpen, { focusFirst: true }));
  wrap.appendChild(toggle);

  const panel = document.createElement('div');
  panel.id = 'export-menu';
  panel.className = 'export-menu';
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', 'Share & export');
  panel.hidden = !exportMenuOpen;
  panel.appendChild(exportButtons());
  wrap.appendChild(panel);
  return wrap;
}

function setExportMenu(open, { focusFirst = false, returnFocus = false } = {}) {
  exportMenuOpen = open;
  const panel = document.getElementById('export-menu');
  const toggle = document.getElementById('export-toggle');
  if (panel) panel.hidden = !open;
  if (toggle) toggle.setAttribute('aria-expanded', String(open));
  if (open && focusFirst) panel?.querySelector('select:not(:disabled), button:not(:disabled)')?.focus();
  if (!open && returnFocus) toggle?.focus();
}

// Installed once: outside click and Escape close the export menu.
function installExportMenuDismiss() {
  document.addEventListener('click', e => {
    if (!exportMenuOpen) return;
    const wrap = document.querySelector('.export-menu-wrap');
    if (wrap && e.target instanceof Node && wrap.contains(e.target)) return;
    setExportMenu(false);
  }, true);   // capture: decide before a click handler re-renders and detaches the target
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && exportMenuOpen) { e.preventDefault(); setExportMenu(false, { returnFocus: true }); }
  });
}

function clearButton() {
  const btn = document.createElement('button');
  btn.id = 'clear-button';
  btn.type = 'button';
  btn.className = 'btn-ghost btn-danger';
  btn.textContent = 'Clear scenario';
  btn.title = 'Wipe the setup, roster, chips, pins, and solved schedule — start fresh.';
  btn.disabled = solving;
  // ponytail: native confirm() — no styled dialog until someone asks for one.
  btn.addEventListener('click', () => {
    if (!confirm('Are you sure you want to clear this scenario?')) return;
    freezeDate = '';
    anchor = null;
    diagnosis = null;
    solveError = null;
    solveSeq++;
    scenario = blankScenario();
    saveScenario(scenario);
    render();
  });
  return btn;
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

const FREEZE_TIP = 'Keep every day up to this date exactly as it is; only later days can change';

function freezeControl() {
  const wrap = document.createElement('div');
  wrap.className = 'freeze-label';
  const hasSchedule = !!(scenario.lastSolution || anchor);
  const label = document.createElement('label');
  label.htmlFor = 'freeze-date';
  label.textContent = 'Freeze through';
  wrap.appendChild(label);
  const freeze = document.createElement('input');
  freeze.type = 'date';
  freeze.id = 'freeze-date';
  freeze.disabled = !hasSchedule || solving;
  // a disabled input shows no tooltip in some browsers — the wrapper carries it too
  freeze.title = wrap.title = hasSchedule ? FREEZE_TIP : 'Solve first';
  const dates = monthDates(scenario.month);
  if (dates.length) { freeze.min = dates[0]; freeze.max = dates[dates.length - 1]; }
  freeze.value = freezeDate;
  freeze.addEventListener('change', () => { freezeDate = freeze.value; });
  wrap.appendChild(freeze);
  return wrap;
}

// A stored tab: the schedule plus its stability-free objective, which the differs-header prices.
const stored = sol => ({ ...sol.schedule, objective: sol.objective });

// Every Solve — button, pin re-solve, Freeze through, attending pager — rebuilds all the tabs.
// Solution 1 is anchored on lastSolution, i.e. on whichever tab is selected right now.
async function runSolve() {
  if (solving) return;
  if (validate(scenario).length) { render(); return; }   // Solve gate — show errors, stay unsolved
  solving = true;
  diagnosis = null;
  solveError = null;
  progress = null;
  const seq = solveSeq;
  // After a pin edit nothing is displayed, but the solve still stays close to the schedule it replaced.
  const input = !scenario.lastSolution && anchor ? { ...scenario, lastSolution: anchor } : scenario;
  render();                                               // "Solving…" state
  try {
    const onProgress = ({ done, total, solution }) => {
      if (seq !== solveSeq) return;
      progress = { done, total };
      anchor = null;                                      // a current schedule exists again
      const alternatives = done === 1 ? [stored(solution)] : [...scenario.alternatives, stored(solution)];
      const activeSolution = done === 1 ? 0 : scenario.activeSolution;
      scenario = { ...scenario, alternatives, activeSolution, alternativesReason: null,
        lastSolution: alternatives[activeSolution] };
      if (done === 1) saveScenario(scenario);
      render();                                           // Solution 1 now; later tabs as they land
    };
    const result = await solveAlternatives(input, { freezeDate: freezeDate || null, onProgress });
    if (seq !== solveSeq) return;
    if (result.infeasible) {
      diagnosis = result.infeasible;                      // a schedule still on screen still fits the inputs
    } else {
      const alternatives = result.solutions.map(stored);
      const activeSolution = Math.min(scenario.activeSolution ?? 0, alternatives.length - 1);
      scenario = { ...scenario, alternatives, activeSolution, alternativesReason: result.stoppedReason ?? null,
        lastSolution: alternatives[activeSolution] };
      saveScenario(scenario);
      saveHintPending = true;                             // first good Solve -> nudge toward Save my month
    }
  } catch (e) {
    solveError = e.message;
  } finally {
    solving = false;
    progress = null;
    render();
  }
}

// Choosing a tab makes it THE schedule: lastSolution (so the next re-solve stays near it),
// the calendar, totals, Potential Issues and every export target.
function selectSolution(k) {
  const chosen = scenario.alternatives[k];
  if (!chosen || k === scenario.activeSolution) return;
  scenario = { ...scenario, activeSolution: k, lastSolution: chosen };
  saveScenario(scenario);
  render();
}

// describeDifference audits both schedules; a tab's header only changes when its schedules do.
const diffCache = new WeakMap();
function differs(k) {
  const alt = scenario.alternatives[k];
  if (!diffCache.has(alt)) {
    const base = scenario.alternatives[0];
    diffCache.set(alt, describeDifference(scenario,
      { schedule: base, objective: base.objective }, { schedule: alt, objective: alt.objective }));
  }
  return diffCache.get(alt);
}
const differsLines = k => differs(k).lines;

// Hand one afternoon's pager to the attending, then solve again. Same shape as the pin-and-resolve
// loop: the stability term keeps the rest of the month where it is.
function onAttendingCover(date, undo = false) {
  if (solving) return;
  const days = scenario.attendingPagerDays ?? [];
  const next = undo ? days.filter(d => d !== date) : days.includes(date) ? days : [...days, date];
  editKeepingAnchor({ ...scenario, attendingPagerDays: next });
  runSolve();
}

// ---- calendar color legend: swatches reuse the exact calendar fills ----
const LEGEND = [
  ['type-call', 'Call'], ['type', 'Cycle type'], ['type-mr', 'Morning Report (we present)'],
  ['rounders', 'Rounders'], ['pager', 'Pager'],
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
        li.textContent = [c.type, '—', c.person, c.date].filter(Boolean).join(' ');
        ul.appendChild(li);
      }
      box.appendChild(ul);
    }
    box.appendChild(reportPrompt('Think this should have worked?', 'Send this month to us.', 'report-prompt-infeasible',
      ["The app said there's no feasible schedule:", diagnosis.diagnosis, '', 'Why I think it should have worked: '].join('\n')));
    wrap.appendChild(box);
  }

  if (solveError == null && scenario.lastSolution && !solutionIsCurrent(scenario)) {
    const note = document.createElement('div');
    note.className = 'stale-rules';
    note.id = 'stale-rules-note';
    note.textContent = 'This schedule was built under older scheduling rules. It is shown as saved — '
      + 'press Solve to rebuild it under the current rules. Your roster, clinics, PTO and pins are kept.';
    wrap.appendChild(note);
  }

  const sched = scenario.lastSolution;
  const monthStart = monthDates(scenario.month)[0];
  // guard: a lastSolution from a since-changed month would key by stale dates and crash the renderer
  if (sched && monthStart && sched.days[monthStart]) {
    if (saveHintPending && !hintDismissed()) wrap.appendChild(saveHint());
    for (const el of solutionTabs()) wrap.appendChild(el);
    const cal = renderCalendar(scenario, sched);
    cal.addEventListener('click', onCalendarClick);
    cal.title = 'Click an OFF / PAGER / ROUNDERS cell to pin an assignment and re-solve';
    // calendar.js output is frozen: scroll wrappers and change markers are added around/onto it here.
    for (const table of cal.querySelectorAll('table.week')) {
      const box = scrollBox('week-scroll');
      table.before(box);
      box.appendChild(table);
    }
    const active = scenario.activeSolution ?? 0;
    if (active > 0 && scenario.alternatives?.[0] && highlightOn()) markChanges(cal, scenario.alternatives[0], sched);
    wrap.appendChild(cal);
    wrap.appendChild(legend());
    wrap.appendChild(scrollBox('totals-scroll', renderTotals(sched)));
    const a = audit(scenario, sched);
    // ponytail: fold independent-audit VIOLATIONS into the same panel — the auditor's whole
    // point is catching a solver hard-rule miss; silently dropping them would defeat it.
    const issues = renderWarnings({ warnings: [...a.violations, ...a.warnings] }, onAttendingCover);
    groupIssues(issues, a);
    // calendar.js stays free of UI imports, so the "send it to us" prompt is attached here.
    issues.appendChild(a.violations.length
      ? reportPrompt('The checker found a broken rule —', 'please send it to us.', 'report-prompt-violation',
        ['The checker flagged a broken rule:', ...a.violations.map(v => `- ${v.message}`), '', ''].join('\n'))
      : reportPrompt('Something look wrong?', 'Send it to us.', 'report-prompt-issues', 'Something looks wrong with this schedule: '));
    wrap.appendChild(issues);
  } else if (!solveError && !diagnosis) {
    wrap.appendChild(resultsEmptyState());
  }

  return wrap;
}

// "<lead> [action]" — opens the Report dialog pre-filled with what the app just
// showed. The month itself rides along via the dialog's (default-on) attach box.
function reportPrompt(lead, action, id, prefill) {
  const p = document.createElement('p');
  p.className = 'report-prompt';
  p.id = id;
  p.append(lead, ' ');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-ghost';
  btn.textContent = action;
  btn.addEventListener('click', () => openFeedback({ type: 'problem', prefill }));
  p.appendChild(btn);
  return p;
}

// Compact overview of built solutions; pending rows arrive with the same progress as the tabs.
function compareSolutions(total) {
  const alts = scenario.alternatives;
  const names = scenario.residents.map(r => r.name);
  const details = document.createElement('details');
  details.id = 'compare-solutions';
  details.className = 'compare-solutions';
  details.open = compareOpen;
  details.addEventListener('toggle', () => {
    if (!details.isConnected) return; // old disclosures can emit a queued toggle after a re-render
    compareOpen = details.open;
    try { localStorage.setItem(COMPARE_KEY, String(compareOpen)); } catch { /* keep the session preference */ }
  });
  const summary = document.createElement('summary');
  summary.textContent = 'Compare solutions';
  details.appendChild(summary);
  const table = document.createElement('table');
  table.className = 'compare-table';
  table.setAttribute('aria-label', 'Compare solutions');
  const head = table.createTHead().insertRow();
  const columns = [
    ['solution', 'Solution'], ['quality', 'Quality vs Solution 1'], ['issues', 'Potential issues'],
    ['moves', 'Days off moved'], ['nights', 'Nights per person'],
    ['weekend', 'Weekend days off per person'], ['pager', 'Pager per person'],
    ['pmoff', 'Afternoons off per person'],   // v1.1.0
  ];
  // Identical sub-grids in headers and cells keep each count under its resident's short name.
  const perPerson = values => {
    const grid = document.createElement('div');
    grid.className = 'compare-people';
    grid.style.setProperty('--people', names.length);
    values.forEach((value, i) => {
      const span = document.createElement('span');
      span.textContent = value;
      span.title = names[i];
      grid.appendChild(span);
    });
    return grid;
  };
  for (const [metric, label] of columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.dataset.metric = metric;
    th.textContent = label;
    if (['nights', 'weekend', 'pager'].includes(metric)) {
      th.title = `Residents in roster order: ${names.join(' · ')}`;
      th.appendChild(perPerson(names.map(n => n.trim().split(/\s+/)[0].slice(0, 3))));
    }
    head.appendChild(th);
  }
  const body = table.createTBody();
  const baseIssues = audit(scenario, alts[0]).warnings.length;
  for (let k = 0; k < total; k++) {
    const schedule = alts[k];
    const row = body.insertRow();
    row.dataset.solution = k;
    row.tabIndex = 0;
    row.setAttribute('aria-selected', String(k === (scenario.activeSolution ?? 0)));
    const name = document.createElement('th');
    name.scope = 'row';
    name.textContent = `Solution ${k + 1}`;
    row.appendChild(name);
    if (!schedule) {
      row.className = 'compare-pending';
      row.setAttribute('aria-disabled', 'true');
      columns.slice(1).forEach(([metric], i) => {
        const cell = row.insertCell();
        cell.dataset.metric = metric;
        cell.textContent = i === 0 ? 'Building…' : '—';
      });
      continue;
    }
    const select = () => {
      selectSolution(k);
      root.querySelector(`#compare-solutions tr[data-solution="${k}"]`)?.focus({ preventScroll: true });
    };
    row.addEventListener('click', select);
    row.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      select();
    });
    const diff = k ? differs(k) : null;
    const issues = k ? audit(scenario, schedule).warnings.length : baseIssues;
    const delta = issues - baseIssues;
    const days = Object.entries(schedule.days);
    const values = {
      quality: diff?.quality ?? 'Current', issues: `${issues} (${delta >= 0 ? '+' : ''}${delta})`,
      moves: diff ? String(diff.stats.offsMoved) : '—',
      nights: names.map(n => days.filter(([, day]) => day.night === n).length),
      weekend: names.map(n => days.filter(([date, day]) => {
        const weekend = [0, 6].includes(new Date(`${date}T12:00:00`).getDay());
        return weekend && day.off.includes(n) && !scenario.pins.some(p =>
          p.person === n && p.date === date && p.type === 'offFree');
      }).length),
      pager: names.map(n => schedule.totals[n]?.pager ?? 0),
      pmoff: names.map(n => schedule.totals[n]?.pmOff ?? afternoonsOffDates(scenario, schedule, n).length),
    };
    for (const [metric] of columns.slice(1)) {
      const cell = row.insertCell();
      cell.dataset.metric = metric;
      if (Array.isArray(values[metric])) cell.appendChild(perPerson(values[metric]));
      else cell.textContent = values[metric];
    }
  }
  details.appendChild(scrollBox('compare-scroll', table));
  return details;
}

// ---- solution tabs: "Solution 1".."Solution N", the build progress, why there are fewer than 5,
// and the active tab's caption (Solution 1) or how-it-differs header (2..N). Nothing for a single
// schedule saved before v1.0.0 — it renders exactly as it always did.
function solutionTabs() {
  const alts = scenario.alternatives ?? [];
  const total = progress ? progress.total : alts.length;
  if (total < 2 && !scenario.alternativesReason) return [];
  const out = [];
  const active = scenario.activeSolution ?? 0;

  if (total > 1) {
    out.push(compareSolutions(total));
    const bar = document.createElement('div');
    bar.className = 'solution-tabs';
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', 'Solutions');
    for (let k = 0; k < total; k++) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.id = `solution-tab-${k + 1}`;
      tab.className = 'solution-tab';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(k === active));
      tab.tabIndex = k === active ? 0 : -1;               // roving tabindex: arrow keys move between tabs
      const name = document.createElement('span');
      name.className = 'solution-tab-name';
      name.textContent = `Solution ${k + 1}`;
      tab.appendChild(name);
      const diff = k > 0 && alts[k] && alts[0] ? differs(k) : null;
      const sub = k === 0 ? 'Current' : diff ? `${diff.quality} · ${diff.stats.offsMoved} moves` : '';
      if (sub) {
        const s2 = document.createElement('span');
        s2.className = 'solution-tab-sub';
        s2.textContent = sub;
        tab.appendChild(s2);
      }
      tab.disabled = !alts[k];                            // still being built
      tab.addEventListener('click', () => selectSolution(k));
      tab.addEventListener('keydown', e => onTabKey(e, k));
      bar.appendChild(tab);
    }
    if (progress && progress.done < progress.total) {
      const p = document.createElement('span');
      p.className = 'solution-progress';
      p.id = 'solution-progress';
      p.setAttribute('role', 'status');
      p.textContent = `Building alternatives ${progress.done + 1}/${progress.total}…`;
      bar.appendChild(p);
    }
    out.push(bar);
  }

  if (scenario.alternativesReason && !progress) {
    const why = document.createElement('p');
    why.className = 'solution-reason';
    why.id = 'solution-reason';
    why.textContent = scenario.alternativesReason;
    out.push(why);
  }

  if (alts.length > 1) {
    const banner = document.createElement('div');
    banner.className = 'solution-header';
    banner.id = 'solution-header';
    banner.setAttribute('aria-label', active === 0 ? 'Solution 1'
      : `How Solution ${active + 1} differs from Solution 1`);
    if (active === 0) {
      const line = document.createElement('p');
      line.textContent = 'Your current schedule — the best fit for your inputs, changed as little as possible.';
      banner.appendChild(line);
    } else {
      differsBanner(banner, differs(active));
    }
    out.push(banner);
    if (active > 0) out.push(changesLegend());
  }
  return out;
}

// Arrow keys / Home / End move between the built tabs (WAI-ARIA tabs pattern, automatic activation).
function onTabKey(e, k) {
  const built = (scenario.alternatives ?? []).length;
  const to = { ArrowRight: k + 1, ArrowLeft: k - 1, Home: 0, End: built - 1 }[e.key];
  if (to == null || built < 2) return;
  e.preventDefault();
  const next = (to + built) % built;
  selectSolution(next);
  document.getElementById(`solution-tab-${next + 1}`)?.focus();
}

// How Solution k differs, as chips: who had days off moved, what else moved, and how good it is.
// The per-date moves sit behind a native disclosure.
function differsBanner(banner, d) {
  const chipsRow = document.createElement('div');
  chipsRow.className = 'diff-chips';
  const chip = (text, cls = '') => {
    const c = document.createElement('span');
    c.className = `diff-chip ${cls}`.trim();
    c.textContent = text;
    chipsRow.appendChild(c);
  };
  chip(d.people.length
    ? `Days off moved: ${d.people.map(p => `${p.name} ${p.count}`).join(' · ')}`
    : 'Same days off');
  for (const o of d.other) chip(o.charAt(0).toUpperCase() + o.slice(1));
  chip(`${d.quality} · ${d.issues}`, 'diff-chip-quality');
  banner.appendChild(chipsRow);

  if (d.people.length) {
    const det = document.createElement('details');
    det.className = 'diff-details';
    const sum = document.createElement('summary');
    sum.textContent = 'Show details';
    det.appendChild(sum);
    for (const p of d.people) {
      const line = document.createElement('p');
      const who = document.createElement('strong');
      who.textContent = `${p.name}: `;
      line.append(who, `day off ${p.moves.join(', ')}`);
      det.appendChild(line);
    }
    banner.appendChild(det);
  }
}

// ---- "what changed vs Solution 1" cell markers (screen only — never print or xlsx) ----
const HL_KEY = 'med-scheduler-highlight-changes';
function highlightOn() {
  try { return storage.get(HL_KEY) !== false; } catch { return true; }
}

// Legend on the left (a miniature changed cell + its meaning), the on/off switch on the right —
// so the sample cell can't be mistaken for an unticked checkbox next to the real one.
function changesLegend() {
  const row = document.createElement('div');
  row.className = 'diff-legend';
  row.id = 'diff-legend';
  const key = document.createElement('span');
  key.className = 'diff-legend-key';
  const swatch = document.createElement('span');
  swatch.className = 'diff-legend-swatch';
  swatch.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.textContent = 'Outlined cells differ from Solution 1';
  key.append(swatch, text);
  const label = document.createElement('label');
  label.className = 'switch';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = 'highlight-changes';
  box.setAttribute('role', 'switch');
  box.checked = highlightOn();
  box.addEventListener('change', () => {
    try { storage.set(HL_KEY, box.checked); } catch { /* per-viewer convenience only */ }
    render();
  });
  const lt = document.createElement('span');
  lt.textContent = 'Highlight changes';
  label.append(box, lt);
  row.append(key, label);
  return row;
}

// OFF row: the set of people off differs; ROUNDERS: the night person; PAGER: the holder.
function markChanges(cal, base, sched) {
  const same = (a, b) => (a ?? null) === (b ?? null);
  const sameSet = (a = [], b = []) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
  for (const [date, dd] of Object.entries(sched.days)) {
    const bd = base.days?.[date];
    if (!bd) continue;
    const changed = [];
    if (!sameSet(bd.off, dd.off)) changed.push('OFF');
    if (!same(bd.night, dd.night)) changed.push('ROUNDERS');
    if (!same(bd.pager, dd.pager)) changed.push('PAGER');
    for (const row of changed) {
      const td = cal.querySelector(`td[data-date="${date}"][data-row="${row}"]`);
      if (!td) continue;
      td.classList.add('cell-changed');
      td.title = 'Differs from Solution 1';
    }
  }
}

function scrollBox(cls, child) {
  const box = document.createElement('div');
  box.className = cls;
  if (child) box.appendChild(child);
  return box;
}

// ---- Potential Issues: grouped by kind, calmer weight; broken rules stay loud and on top ----
const ISSUE_GROUPS = [
  ['violation', 'Broken rules', null],
  ['multi-off', 'Several people off the same day', ['W_MULTI_OFF']],
  ['stretch', 'Long stretches without a day off', ['W_LONG_STRETCH']],
  ['duty', 'Fewer than 1 rest day in 7', ['W_DUTY_HOUR']],
  ['senior-sc', 'Senior off on a short-call day', ['W_SENIOR_OFF_SC']],
  ['mr', 'Morning Report coverage', ['W_MR_THIN', 'W_MR_NO_SENIOR', 'W_MR_NO_INTERN']],
  ['pager', 'Pager / didactics', ['W_ATTENDING_PAGER', 'W_DIDACTICS_MISS', 'W_DIDACTICS_PAGER',
    'W_DIDACTICS_PAGER_INTERN', 'W_DIDACTICS_NO_SENIOR_COVER', 'W_DIDACTICS_OFF']],
  ['other', 'Other', null],
];
const MON_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = iso => `${MON_ABBR[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

// The line already leads with "Feb 7: " — drop the item's own ISO date from the message, and write
// any other ISO date (e.g. the ends of a long stretch) the short way. audit.js messages are untouched.
function tidyIssueText(text, date) {
  let t = text;
  if (date) t = t.split(` on ${date}`).join('').split(` (${date})`).join('').split(` ${date}`).join('');
  return t.replace(/\b\d{4}-\d{2}-\d{2}\b/g, shortDate);
}

function groupIssues(panel, auditResult) {
  const items = [...auditResult.violations.map(v => ({ ...v, violation: true })), ...auditResult.warnings];
  const list = panel.querySelector('ul');
  const lis = [...panel.querySelectorAll('li.warning')];
  if (!list || !lis.length || lis.length !== items.length) return;   // empty: keep "No issues flagged."

  const groupOf = it => (it.violation ? 'violation'
    : ISSUE_GROUPS.find(([, , codes]) => codes?.includes(it.code))?.[0] ?? 'other');
  const buckets = new Map();
  lis.forEach((li, i) => {
    const it = items[i];
    const span = li.querySelector('span');
    if (span) span.textContent = tidyIssueText(span.textContent, it.date);
    if (it.violation) li.classList.add('violation');
    const g = groupOf(it);
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g).push(li);
  });

  const h = panel.querySelector('h2');
  if (h) {
    const count = document.createElement('span');
    count.className = 'issues-count';
    count.textContent = ` (${items.length})`;
    h.appendChild(count);
  }
  const groups = document.createElement('div');
  groups.className = 'issue-groups';
  let shown = 0;
  for (const [key, label] of ISSUE_GROUPS) {
    const members = buckets.get(key);
    if (!members) continue;
    const det = document.createElement('details');
    det.className = `issue-group issue-group-${key}`;
    det.open = key === 'violation' || shown < 2;
    if (key !== 'violation') shown++;
    const sum = document.createElement('summary');
    sum.className = 'issue-group-title';
    sum.textContent = `${label} (${members.length})`;
    det.appendChild(sum);
    const ul = document.createElement('ul');
    for (const li of members) ul.appendChild(li);   // moved, not rebuilt: the attending buttons keep their handlers
    det.appendChild(ul);
    groups.appendChild(det);
  }
  list.replaceWith(groups);
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
  if (solving) return;                 // a pin added mid-build would be ignored by the solve in flight
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
  editKeepingAnchor({ ...scenario, pins });
}

function removePins(person, date) {
  editKeepingAnchor({ ...scenario, pins: scenario.pins.filter(p => !(p.person === person && p.date === date)) });
}

// Download the whole month — setup, pins, every solution and which tab is chosen — as one .json.
function saveMonth() {
  if (solving) return;                   // mid-build the file would hold only some of the solutions
  let saved = scenario;
  if (!exportableSchedule() || !(scenario.alternatives ?? []).every(sch => exportableSchedule(sch))) {
    const { lastSolution, alternatives, activeSolution, alternativesReason, ...inputs } = scenario;
    saved = inputs;
  }
  const blob = new Blob([exportScenarioJSON(saved)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${scenario.team || 'scenario'}-${scenario.month || 'unset'}.json`;
  a.click();
  URL.revokeObjectURL(url);
  dismissSaveHint();
}

// "Your work": Save my month / Open a saved month. The file input is hidden behind a real button so
// it reads as a button, not a browser-native "Choose file" widget.
function ioButtons() {
  const wrap = document.createElement('div');
  wrap.className = 'io-buttons';

  const saveBtn = document.createElement('button');
  saveBtn.id = 'save-button';
  saveBtn.type = 'button';
  saveBtn.className = 'btn-secondary';
  saveBtn.textContent = 'Save my month (.json)';
  saveBtn.title = 'Download this month as a file — your setup, pins and every solution. Reopen it anytime or send it to a co-chief.';
  saveBtn.disabled = solving;            // mid-build the file would hold only some of the solutions
  saveBtn.addEventListener('click', saveMonth);
  wrap.appendChild(saveBtn);

  const loadInput = document.createElement('input');
  loadInput.type = 'file';
  loadInput.id = 'load-input';
  loadInput.accept = '.json,application/json';
  loadInput.hidden = true;
  loadInput.addEventListener('change', () => {
    const file = loadInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      // A solve still building belongs to the old month: discard it, or its tabs land on this one. The
      // old month's anchor and freeze date go with it. (preserveSolution keeps the FILE's own solutions.)
      try {
        const next = importScenarioJSON(reader.result);
        solveSeq++; anchor = null; freezeDate = '';
        onChange(next, { preserveSolution: true });
      }
      catch (e) { alert(`Could not open that file: ${e.message}`); }
    };
    reader.readAsText(file);
    loadInput.value = '';                                  // so picking the same file again still fires
  });

  const openBtn = document.createElement('button');
  openBtn.id = 'open-button';
  openBtn.type = 'button';
  openBtn.className = 'btn-secondary';
  openBtn.textContent = 'Open a saved month…';
  openBtn.title = 'Open a month you (or a co-chief) saved earlier.';
  openBtn.addEventListener('click', () => loadInput.click());
  wrap.append(openBtn, loadInput);

  return wrap;
}

// ---- one-time "save my month" hint, shown after the first good Solve until dismissed ----
function hintDismissed() { return storage.get(HINT_KEY) === true; }

function dismissSaveHint() {
  saveHintPending = false;
  storage.set(HINT_KEY, true);
  document.getElementById('save-hint')?.remove();
}

function saveHint() {
  const box = document.createElement('div');
  box.className = 'save-hint';
  box.id = 'save-hint';
  box.setAttribute('role', 'note');
  const p = document.createElement('p');
  p.textContent = 'Want to keep these options or try changes? Save my month — you can reopen the file ' +
    'anytime, or send it to a co-chief.';
  box.appendChild(p);
  const save = mkButton('Save my month', saveMonth, 'btn-primary');
  save.id = 'save-hint-button';
  save.disabled = solving;               // same lock as the action bar's Save
  box.appendChild(save);
  const x = mkButton('Dismiss', dismissSaveHint, 'btn-ghost');
  x.title = 'Don’t show this again.';
  box.appendChild(x);
  return box;
}

// ---- Download + What's new dialogs: built on <body> like the guide, so re-render can't reset them ----
function openAppDialog(id, title, fill) {
  let dlg = document.getElementById(id);
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = id;
    dlg.className = 'app-dialog';
    const header = document.createElement('div');
    header.className = 'guide-dialog-header';
    const h = document.createElement('h2');
    header.appendChild(h);
    header.appendChild(mkButton('×', () => dlg.close(), 'btn-ghost'));
    header.lastChild.title = 'Close';
    const body = document.createElement('div');
    body.className = 'app-dialog-body';
    dlg.append(header, body);
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });   // backdrop click
    document.body.appendChild(dlg);
  }
  dlg.querySelector('h2').textContent = title;
  const body = dlg.querySelector('.app-dialog-body');
  body.innerHTML = '';
  fill(body);
  if (!dlg.open) dlg.showModal();
}

const linkButton = (href, text, cls) => {
  const a = document.createElement('a');
  a.href = href;
  a.className = `${cls} dialog-link`;
  a.textContent = text;
  return a;
};

// No network check here on purpose: the app never phones home. The link always points at "latest",
// so whoever clicks gets the newest file.
function openDownload() {
  const offline = location.protocol === 'file:';
  openAppDialog('download-dialog', offline ? 'Get the latest version' : 'Download the app', body => {
    const lead = document.createElement('p');
    lead.textContent = offline
      ? `You have v${appVersion()}. Download the newest app file to see what's new.`
      : 'Run the scheduler offline on your own machine — one file, no install, nothing uploaded.';
    body.appendChild(lead);

    const main = linkButton(`${RELEASES}/latest/download/med-scheduler.html`,
      'Download the app (one HTML file)', 'btn-primary');
    main.id = 'download-app-link';
    body.appendChild(main);
    const note = document.createElement('p');
    note.className = 'dialog-note';
    note.textContent = 'You’ll get the newest version. Open the file by double-clicking it.';
    body.appendChild(note);

    const kit = linkButton(`${RELEASES}/latest/download/Medicine-Scheduler.zip`,
      'Starter kit (.zip): app + guide + example months', 'btn-secondary');
    kit.id = 'download-kit-link';
    body.appendChild(kit);

    const all = document.createElement('a');
    all.href = RELEASES;
    all.target = '_blank';
    all.rel = 'noopener';
    all.className = 'dialog-small-link';
    all.textContent = 'All versions on GitHub';
    body.appendChild(all);
  });
}

function openWhatsNew() {
  openAppDialog('whatsnew-dialog', 'What’s new', body => {
    for (const entry of CHANGELOG) {
      const h = document.createElement('h3');
      h.textContent = `${entry.version} · ${entry.date}`;
      body.appendChild(h);
      const ul = document.createElement('ul');
      for (const text of entry.items) {
        const li = document.createElement('li');
        li.textContent = text;
        ul.appendChild(li);
      }
      body.appendChild(ul);
    }
  });
}

// Export xlsx / Print — enabled once a schedule exists (`scenario.lastSolution`, set by Solve).
// "This solution" = the active tab, exactly the pre-v1.0.0 exports. "All solutions" (offered only
// when there is more than one) = one workbook with a sheet per tab, one ZIP with a folder per tab.
function exportButtons() {
  const wrap = document.createElement('div');
  wrap.className = 'export-buttons';
  const schedule = scenario.lastSolution;
  const alts = scenario.alternatives ?? [];
  const allowed = !!exportableSchedule();
  const blockedTip = validate(scenario).length || (schedule && !allowed) ? FIX_EXPORT_TIP : null;
  if (alts.length < 2) exportScope = 'one';
  const allScope = () => exportScope === 'all' && alts.length > 1;
  const canExport = () => !solving && !!exportableSchedule()
    && (!allScope() || alts.every(sch => exportableSchedule(sch)));
  const allEntries = () => alts.map((sch, k) => ({
    schedule: sch, auditResult: audit(scenario, sch), headerLines: k === 0 ? [] : differsLines(k),
  }));
  const xlsx = () => {
    if (!canExport()) return;
    return allScope() ? downloadAllXlsx(scenario, allEntries())
      : downloadXlsx(scenario, schedule, audit(scenario, schedule));
  };

  if (alts.length > 1) {
    const scopeSelect = mkSelect([['one', 'This solution'], ['all', 'All solutions']]);
    scopeSelect.id = 'export-scope';
    scopeSelect.title = 'Export only the solution on screen, or every solution at once.';
    scopeSelect.value = exportScope;
    scopeSelect.disabled = !allowed || solving;
    scopeSelect.addEventListener('change', () => { exportScope = scopeSelect.value; });
    wrap.appendChild(menuField('Which solution', scopeSelect));
  }

  const calendarSelect = document.createElement('select');
  calendarSelect.id = 'calendar-export-person';
  calendarSelect.title = 'Choose one resident calendar or download every resident as a ZIP.';
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'All residents (.zip)';
  calendarSelect.appendChild(all);
  for (const resident of scenario.residents) {
    const option = document.createElement('option');
    option.value = resident.name;
    option.textContent = resident.name;
    calendarSelect.appendChild(option);
  }
  calendarSelect.disabled = !allowed || solving;
  wrap.appendChild(menuField('Whose calendar', calendarSelect));

  const calendarBtn = document.createElement('button');
  calendarBtn.id = 'calendar-export-button';
  calendarBtn.type = 'button';
  calendarBtn.className = 'btn-secondary';
  calendarBtn.textContent = 'Download calendar';
  calendarBtn.title = blockedTip ?? 'Download one personal .ics calendar, or a ZIP containing one per resident.';
  calendarBtn.disabled = !allowed || solving;   // 'All solutions' mid-build = a partial set
  calendarBtn.addEventListener('click', async () => {
    if (!canExport()) return;
    calendarBtn.disabled = true;
    calendarSelect.disabled = true;
    const original = calendarBtn.textContent;
    calendarBtn.textContent = 'Preparing…';
    try {
      if (allScope())
        await downloadAllSolutionsCalendarsZip(scenario, alts, calendarSelect.value || null);
      else if (calendarSelect.value)
        downloadResidentCalendar(scenario, schedule, calendarSelect.value);
      else
        await downloadCalendarsZip(scenario, schedule);
    } finally {
      calendarBtn.textContent = original;
      calendarBtn.disabled = !canExport();
      calendarSelect.disabled = !canExport();
    }
  });
  wrap.appendChild(calendarBtn);
  wrap.appendChild(menuDivider());

  const xlsxBtn = document.createElement('button');
  xlsxBtn.id = 'xlsx-export-button';
  xlsxBtn.type = 'button';
  xlsxBtn.className = 'btn-secondary';
  xlsxBtn.textContent = 'Export spreadsheet';
  xlsxBtn.title = blockedTip ?? 'Download a formatted .xlsx for Excel or Google Sheets.';
  xlsxBtn.disabled = !allowed || solving;
  xlsxBtn.addEventListener('click', xlsx);
  wrap.appendChild(xlsxBtn);

  const sheetsBtn = document.createElement('button');
  sheetsBtn.id = 'google-sheets-button';
  sheetsBtn.type = 'button';
  sheetsBtn.className = 'btn-secondary';
  sheetsBtn.textContent = 'Download & open Google Sheets';
  sheetsBtn.title = blockedTip ?? 'Downloads the formatted workbook and opens a new Google Sheet. In Sheets, use File → Import → Upload.';
  sheetsBtn.disabled = !allowed || solving;
  sheetsBtn.addEventListener('click', () => {
    if (!canExport()) return;
    window.open('https://sheets.new', '_blank', 'noopener');
    xlsx();
  });
  wrap.appendChild(sheetsBtn);
  wrap.appendChild(menuDivider());

  const printBtn = document.createElement('button');
  printBtn.id = 'print-button';
  printBtn.type = 'button';
  printBtn.className = 'btn-secondary';
  printBtn.textContent = 'Print';
  printBtn.title = blockedTip ?? 'Print the calendar + totals of the solution on screen (browser → PDF).';
  printBtn.disabled = !allowed || solving;
  printBtn.addEventListener('click', () => {
    if (solving || !exportableSchedule()) return;
    setExportMenu(false); window.print();
  });
  wrap.appendChild(printBtn);

  return wrap;
}

// A small visible caption over a select in the Export menu.
function menuField(text, control) {
  const field = document.createElement('div');
  field.className = 'export-field';
  const label = document.createElement('label');
  label.htmlFor = control.id;
  label.textContent = text;
  field.append(label, control);
  return field;
}

function menuDivider() {
  const hr = document.createElement('hr');
  hr.className = 'export-divider';
  return hr;
}
