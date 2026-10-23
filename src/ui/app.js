/* global __BUILD_VERSION__ */
import './style.css';
import { loadScenario, saveScenario, blankScenario, exportScenarioJSON, importScenarioJSON, storage } from './state.js';
import { validate } from '../validate.js';
import { audit } from '../audit.js';
import { downloadXlsx } from '../export.js';
import { downloadResidentCalendar, downloadCalendarsZip } from '../ics.js';
import { solveAlternatives, initHighs } from '../solve.js';
import { describeDifference } from '../compare.js';
import { onService, monthDates, parseScenario, solutionIsCurrent, afternoonsOffDates,
  twoPersonCallDays, twoPersonPins, TWO_PERSON_NOTE } from '../model.js';
import { renderCalendar, renderTotals, renderWarnings } from './calendar.js';
import * as setup from './setup.js';
import * as roster from './roster.js';
import * as chips from './chips.js';
import { initFeedback, openFeedback } from './feedback.js';
import { cloudAvailable, cloudState, detachSession, initCloud, cloudBar, scheduleAutosave, sessionButtons, teamSection } from './cloud.js';
import { buildPhonePayload } from '../phone.js';
import { phoneHtml } from '../phone-page.js';
import { CHANGELOG } from '../changelog.js';
import { CRITERIA, ACGME } from './info.js';
import guideRaw from './guide.html?raw';
import exampleWhole from '../../fixtures/example-3-person.json';
import exampleSwap from '../../fixtures/example-3-then-2.json';

let scenario;
let root;
let saveTimer = null;
let cloudQuiet = false;     // true while a month just opened from the server is being applied (nothing to autosave)
let dialogEl = null;
let dismissInstalled = false;

// solve-flow state (transient — not persisted)
let solving = false;
let freezeDate = '';        // freeze-through-date; '' = no freeze
let diagnosis = null;       // last infeasible {diagnosis, culprits}
let solveError = null;      // last thrown-error message
let progress = null;        // {done, total} while alternatives are still arriving
let solveSeq = 0;           // bumped by any input edit, so a solve that outlives it is discarded
let exportPick = null;    // which solution Export covers: null = the one on screen, else an index into scenario.alternatives
let saveHintPending = false; // set by the first successful Solve; the "save my month" hint shows until dismissed
let compareOpen = true;
// Two-column view (v1.10.0; the default on wide screens since v1.13.0): inputs on the left, results on the right,
// each scrolling on its own. A screen narrower than WIDE_PX is always single-column. On a wide screen the page opens
// two-column; the button in the results panel switches either way (not persisted: a reload re-opens two-column).
let reviseMode = false;
let wantSingle = false;          // the user chose single-column on a wide screen; kept until the screen goes narrow
const WIDE_PX = 1100;           // same breakpoint as the CSS that hides the view buttons
let staleSnap = null;       // the scenario as last solved, shown greyed on the right once an input is edited
let autoResolve = false;    // re-solve ~0.7 s after each edit (a per-viewer preference, see AUTO_KEY)
let autoTimer = null;
let flashBase = null;       // the schedule a re-solve replaced; its changed cells are outlined for a few seconds
let flashTimer = null;
let resizeInstalled = false;
const AUTO_KEY = 'med-scheduler-auto-resolve';
// On unless the viewer switched it off.
try { autoResolve = storage.get(AUTO_KEY) !== false; } catch { /* per-viewer convenience only */ }
// The schedule a pin / attending-day re-solve stays close to (stability). A pin edit
// clears every displayed and exportable solution — none of them honours the new pin — but the re-solve
// still anchors on the schedule the chief was looking at. Never rendered, exported or saved; cleared by
// any other edit, by opening a month, by Clear, and once a solve succeeds.
let anchor = null;

const RELEASES = 'https://github.com/tylerdouglasanderson-jpg/medicine-scheduler/releases';
const HINT_KEY = 'med-scheduler-save-hint-dismissed';
const COMPARE_KEY = 'med-scheduler-compare-open';
const HOWTO_KEY = 'med-scheduler-howto-seen';
const COLLAPSE_KEY = 'med-scheduler-collapsed';
// Panels the user minimized; survives re-render (which rebuilds every panel) and reloads.
let collapsed = new Set();
const appVersion = () => String(typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'dev').split(' ')[0];

export function mount(container) {
  root = container;
  scenario = loadScenario();
  twoPersonSkipKey = null;
  compareOpen = true;
  try { compareOpen = localStorage.getItem(COMPARE_KEY) !== 'false'; } catch { /* viewer storage may be unavailable */ }
  try { collapsed = new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]')); } catch { /* viewer storage may be unavailable */ }
  reviseMode = window.innerWidth >= WIDE_PX;
  wantSingle = false;
  if (!resizeInstalled) {
    window.addEventListener('resize', () => {
      const want = window.innerWidth >= WIDE_PX && !wantSingle;
      if (window.innerWidth < WIDE_PX) wantSingle = false;      // narrow forces single; coming back wide re-opens two-column
      if (want !== reviseMode) setRevise(want);
    });
    resizeInstalled = true;
  }
  ensureGuideDialog();
  initFeedback({ getScenarioJSON: () => exportScenarioJSON(scenario) });
  initCloud({
    serialize: monthJSON,
    parse: importScenarioJSON,
    apply: next => {                       // a month opened from the server replaces the one on screen
      solveSeq++; anchor = null; freezeDate = '';
      cloudQuiet = true;
      try { onChange(next, { preserveSolution: true }); } finally { cloudQuiet = false; }
    },
  });
  initHighs().catch(() => {});   // warm the wasm at page load so the first Solve is fast
  if (!dismissInstalled) { installExportMenuDismiss(); dismissInstalled = true; }
  render();
  let seen = false;
  try { seen = localStorage.getItem(HOWTO_KEY) === '1'; } catch { /* treat as unseen */ }
  if (!seen) openQuickHowTo();
}

// "Your results are here": after a good Solve, say so, then gently scroll to the results.
const RESULTS_NOTE_KEY = 'med-scheduler-results-note-off';
function scrollToResults() {
  const el = document.getElementById('results-section');
  if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function announceResults() {
  if (reviseMode) return;                // revising side by side: no pop-up, and the panes stay where they are
  let off = false;
  try { off = localStorage.getItem(RESULTS_NOTE_KEY) === '1'; } catch { /* storage may be unavailable */ }
  let dlg = document.getElementById('results-dialog');
  if (off || typeof HTMLDialogElement === 'undefined' || (dlg ?? document.createElement('dialog')).showModal === undefined) {
    scrollToResults();
    return;
  }
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'results-dialog';
    dlg.className = 'app-dialog';
    const header = document.createElement('div');
    header.className = 'guide-dialog-header';
    const h = document.createElement('h2');
    h.textContent = 'Your results are here';
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'btn-ghost'; x.textContent = '×'; x.title = 'Closes this message and scrolls you down to the schedule. Nothing on your schedule changes.';
    x.addEventListener('click', () => dlg.close());
    header.append(h, x);
    const body = document.createElement('div');
    body.className = 'app-dialog-body';
    const p = document.createElement('p');
    p.textContent = 'The schedule is ready. Closing this takes you down to it.';
    const tip = document.createElement('p');
    tip.className = 'dialog-note';
    tip.textContent = 'To change a single day while you review: click that day’s OFF, PAGER or ROUNDERS cell in the results calendar below, add or change a pin there, and it re-solves. The rest of the month stays as close to this schedule as it can.';
    const label = document.createElement('label');
    label.className = 'dialog-note';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.id = 'results-note-off';
    cb.title = 'Tick this to stop the “Your results are here” message from appearing after each Solve; the page will just scroll to the results. The choice is saved on this computer only, in this browser.';
    label.append(cb, document.createTextNode(' Don’t show this again'));
    const ok = document.createElement('button');
    ok.type = 'button'; ok.className = 'btn-primary dialog-link'; ok.textContent = 'Show me the results';
    ok.title = 'Closes this message and scrolls you down to the schedule. If “Don’t show this again” is ticked, this message will not appear after future Solves.';
    ok.addEventListener('click', () => dlg.close());
    body.append(p, tip, label, ok);
    dlg.append(header, body);
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => {
      try { if (cb.checked) localStorage.setItem(RESULTS_NOTE_KEY, '1'); } catch { /* ignore */ }
      scrollToResults();
    });
    document.body.appendChild(dlg);
  }
  if (!dlg.open) dlg.showModal();
}

// Quick How-to: shown once on a first visit, and from the header button any time.
function openQuickHowTo() {
  try { localStorage.setItem(HOWTO_KEY, '1'); } catch { /* viewer storage may be unavailable */ }
  let dlg = document.getElementById('howto-dialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'howto-dialog';
    dlg.className = 'app-dialog';
    const header = document.createElement('div');
    header.className = 'guide-dialog-header';
    const h = document.createElement('h2');
    h.textContent = 'Quick how-to';
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'btn-ghost'; x.textContent = '×'; x.title = 'Closes the quick how-to without changing anything. You can reopen it any time from the Quick How-to button at the top.';
    x.addEventListener('click', () => dlg.close());
    header.append(h, x);
    const body = document.createElement('div');
    body.className = 'app-dialog-body';
    const p = document.createElement('p');
    p.textContent = 'Hey, here’s a real quick guide:';
    const steps = document.createElement('ol');
    steps.className = 'dialog-steps';
    for (const text of [
      'At the very top, pick your team, the month, and the Anchor type: the kind of day the 1st of the month falls on in the 6-day call cycle (Pre-call, Call, Post-call, Post-post-call, Short Call 1 or Short Call 2). This is how the app lays out the rest of the month.',
      'Under Roster, add the members of your team.',
      'Didactics are filled in for you when you add someone: seniors and Psych interns on Tuesday PM, Family interns on Thursday PM. Transitional interns get Wednesday PM, but it is every other week, so click their Wednesdays with the Didactics (PM) mode. OB/GYN and Other interns get none, so set their didactics day in the Roster if they have one. Check that everyone’s is right.',
      'Under Commitments / PTO / Pins, add everybody’s clinic schedule as a Commitment (PM).',
      'Add any PTO that is already approved.',
      'When the clinic days, PTO, and didactics are in, press Solve (bottom left), then check the results at the very bottom of the page.',
    ]) { const li = document.createElement('li'); li.textContent = text; steps.appendChild(li); }
    let teamNote = null;
    if (cloudAvailable()) {
      const team = document.createElement('p');
      team.className = 'dialog-note';
      team.textContent = 'When the schedule is final and approved by the chiefs and admin: Save online, then Export, Publish team link. Your team gets a read-only phone calendar at a short link. It stays up for a year after it was last opened.';
      teamNote = team;
    }
    const note = document.createElement('p');
    note.className = 'dialog-note';
    note.textContent = 'Need more? Open the Comprehensive Guide in the header any time.';
    const ok = document.createElement('button');
    ok.type = 'button'; ok.className = 'btn-primary dialog-link'; ok.textContent = 'Got it';
    ok.title = 'Closes the quick how-to. You can reopen it any time from the Quick How-to button at the top; nothing you entered is affected.';
    ok.addEventListener('click', () => dlg.close());
    body.append(p, steps, ...(teamNote ? [teamNote] : []), note, ok);
    dlg.append(header, body);
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    document.body.appendChild(dlg);
  }
  if (!dlg.open && typeof dlg.showModal === 'function') dlg.showModal();
}

const COLLAPSE_TIP_CLOSE = 'Hides the body of this section so the rest of the page is easier to see; only its heading stays. Nothing you entered is lost or changed. The choice is remembered on this computer. Click Expand to bring it back.';
const COLLAPSE_TIP_OPEN = 'Shows this section again. Everything in it is exactly as you left it. The choice is remembered on this computer.';

// Top-right minimize button on a panel; the panel keeps its heading and hides the rest.
function addCollapse(panel) {
  const id = panel.id;
  const isCollapsed = collapsed.has(id);
  panel.classList.toggle('collapsed', isCollapsed);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-ghost collapse-btn';
  btn.textContent = isCollapsed ? 'Expand' : 'Collapse';
  btn.title = isCollapsed ? COLLAPSE_TIP_OPEN : COLLAPSE_TIP_CLOSE;
  btn.setAttribute('aria-expanded', String(!isCollapsed));
  btn.addEventListener('click', () => {
    if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed])); } catch { /* viewer storage may be unavailable */ }
    const now = collapsed.has(id);
    panel.classList.toggle('collapsed', now);
    btn.textContent = now ? 'Expand' : 'Collapse';
    btn.title = now ? COLLAPSE_TIP_OPEN : COLLAPSE_TIP_CLOSE;
    btn.setAttribute('aria-expanded', String(!now));
  });
  panel.prepend(btn);
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
    // Revise mode: keep the schedule that was on screen, greyed, and let the next solve stay close to it.
    if (reviseMode && !staleSnap && scenario.lastSolution) staleSnap = scenario;
    solveSeq++;
    anchor = reviseMode && staleSnap ? staleSnap.lastSolution : null;
    freezeDate = '';      // freezing needs a schedule to freeze to; a stale date would silently box in the next solve
  }
  scenario = preserveSolution ? next : { ...next, ...NO_SOLUTION };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveScenario(scenario), 300);
  if (!cloudQuiet) scheduleAutosave();
  render();
  if (reviseMode && autoResolve && !preserveSolution) scheduleAutoSolve();
}

function scheduleAutoSolve() {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    if (!reviseMode || !autoResolve) return;
    if (solving) { scheduleAutoSolve(); return; }          // an older solve is still winding down
    if (!validate(scenario).length) runSolve();
  }, 700);
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
  closeBtn.title = 'Closes the user guide and returns you to the scheduler. Your schedule is not affected.';
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
  chip.title = `You are running version ${appVersion()}${buildDate ? ` (built ${buildDate})` : ''}. Click to see what changed in each version, newest first. It is read-only and does not change your schedule.`;
  chip.addEventListener('click', openWhatsNew);
  left.appendChild(chip);
  bar.appendChild(left);

  const right = document.createElement('div');
  right.className = 'app-bar-right';
  const guideBtn = document.createElement('button');
  guideBtn.type = 'button';
  guideBtn.className = 'btn-secondary';
  guideBtn.textContent = 'Comprehensive Guide';
  guideBtn.title = 'Opens the full user guide in a window on top of this page. It explains how to set up a month, what each option does and how to read the schedule. Close it with the × in its corner; your schedule is not affected.';
  guideBtn.addEventListener('click', () => { if (!dialogEl.open) dialogEl.showModal(); });
  const howtoBtn = document.createElement('button');
  howtoBtn.id = 'howto-button';
  howtoBtn.type = 'button';
  howtoBtn.className = 'btn-secondary';
  howtoBtn.textContent = 'Quick How-to';
  howtoBtn.title = 'Opens a short six-step guide to setting up a month and pressing Solve. It is read-only and does not change anything you have entered. Use the Comprehensive Guide for the full detail.';
  howtoBtn.addEventListener('click', openQuickHowTo);
  right.append(howtoBtn, guideBtn);

  const critBtn = document.createElement('button');
  critBtn.id = 'criteria-button';
  critBtn.type = 'button';
  critBtn.className = 'btn-secondary';
  critBtn.textContent = 'How it solves';
  critBtn.title = 'Opens a plain-language list of the rules the scheduler always follows and the preferences it works toward, in priority order. Read-only: nothing on your schedule changes.';
  critBtn.addEventListener('click', openCriteria);
  right.appendChild(critBtn);

  const acgmeBtn = document.createElement('button');
  acgmeBtn.id = 'acgme-button';
  acgmeBtn.type = 'button';
  acgmeBtn.className = 'btn-secondary';
  acgmeBtn.textContent = ACGME.title;
  acgmeBtn.title = 'Opens the ACGME duty-hour rules, with a link to the exact page of each rule in the official document. It also explains which of them the scheduler checks. Read-only: nothing on your schedule changes.';
  acgmeBtn.addEventListener('click', openAcgme);
  right.appendChild(acgmeBtn);

  const dlBtn = document.createElement('button');
  dlBtn.id = 'download-button';
  dlBtn.type = 'button';
  dlBtn.className = 'btn-secondary';
  dlBtn.textContent = 'Download';
  dlBtn.title = 'Opens the download options for the scheduler so you can run it offline on your own computer. Nothing is uploaded, and your current schedule is not changed.';
  dlBtn.addEventListener('click', openDownload);
  right.appendChild(dlBtn);

  // Deliberately loud: amber, two lines, and it says what it sends. A co-chief who hits a bad
  // schedule should find this before they think of texting a screenshot.
  const reportBtn = document.createElement('button');
  reportBtn.id = 'report-button';
  reportBtn.type = 'button';
  reportBtn.className = 'btn-report';
  reportBtn.title = 'Opens a short form to tell the developer about a problem. Your current month (roster, pins and solutions) is attached by default so they can see exactly what you see; you can untick that in the form. Nothing is sent until you press Send.';
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
    'Not sure where to start? Press “Load the example month” below (there are two to choose from), or open the Quick How-to.';
  box.appendChild(p);
  const row = document.createElement('div');
  row.className = 'example-row';
  const examples = [
    ['load-example-button', exampleWhole, 'Load the example month: 3-person team all month (Medicine B · Feb 2026)',
      'Fills the app with a sample month: Medicine B, February 2026, one senior and two interns for the whole month, with a senior PTO week and clinics. This replaces the setup on the page and clears any schedule. Use Clear scenario to start your own month afterwards.'],
    ['load-example-button-2', exampleSwap, 'Load the example month: 3-person team, then 2-person from the 16th (Medicine A · Oct 2026)',
      'Fills the app with a sample month: Medicine A, October 2026. One senior and two interns run the first half; on the 16th the senior and one intern rotate off and a new senior joins the remaining intern, so the team shrinks to two people. Includes a one-person day, clinics, an ITE half-day and a retreat. This replaces the setup on the page and clears any schedule. Use Clear scenario to start your own month afterwards.'],
  ];
  examples.forEach(([id, fixture, label, title], i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = i === 0 ? 'btn-primary' : 'btn-secondary';
    btn.id = id;
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener('click', () => onChange(parseScenario(fixture)));
    row.appendChild(btn);
  });
  box.appendChild(row);
  return box;
}

function render() {
  closePopover();
  const comparison = root.querySelector('#compare-solutions');
  if (comparison) compareOpen = comparison.open;
  // render() rebuilds everything, so each pane's scroll position is carried across by hand.
  const keepLeft = root.querySelector('.pane-left')?.scrollTop ?? 0;
  const keepRight = root.querySelector('.pane-right')?.scrollTop ?? 0;
  if (!reviseMode || scenario.lastSolution) staleSnap = null;   // a current schedule exists again
  document.body.classList.toggle('revise-on', reviseMode);
  root.innerHTML = '';

  root.appendChild(topBar());
  if (cloudAvailable()) root.appendChild(cloudBar());

  const main = document.createElement('main');
  main.className = 'main';
  root.appendChild(main);
  const pane = cls => { const d = document.createElement('div'); d.className = `pane ${cls}`; return d; };
  const left = reviseMode ? pane('pane-left') : main;
  const right = reviseMode ? pane('pane-right') : main;
  if (reviseMode) { main.classList.add('revise'); main.append(left, right); }

  if (!storage.available) {
    const notice = document.createElement('p');
    notice.className = 'storage-notice';
    notice.textContent = 'autosave unavailable — use “Save my month (.json)” so you don’t lose your work';
    left.appendChild(notice);
  }

  if (!scenario.residents.length || !scenario.month) {
    left.appendChild(onboardingHint());
  }

  const setupSection = section('setup-section');
  left.appendChild(setupSection);
  setup.render(setupSection, scenario, onChange, reopenTwoPerson);

  const rosterSection = section('roster-section');
  left.appendChild(rosterSection);
  roster.render(rosterSection, scenario, onChange);

  const chipsSection = section('chips-section');
  left.appendChild(chipsSection);
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
  left.appendChild(errorsPanel);

  let resultsPanel;
  if (staleSnap) {                       // the old schedule, drawn from the scenario it was solved for
    const live = scenario;
    scenario = staleSnap;
    try { resultsPanel = renderResults(); } finally { scenario = live; }
  } else resultsPanel = renderResults();
  right.appendChild(resultsPanel);
  for (const p of [setupSection, rosterSection, chipsSection, errorsPanel, resultsPanel]) addCollapse(p);

  root.appendChild(actionBar(errors));
  document.documentElement.style.setProperty('--appbar-h', `${root.querySelector('.app-bar')?.offsetHeight ?? 56}px`);
  if (reviseMode) {
    const h = sel => root.querySelector(sel)?.offsetHeight ?? 0;
    main.style.height = `calc(100dvh - ${h('.app-bar') + h('.action-bar')}px)`;
    left.scrollTop = keepLeft;
    right.scrollTop = keepRight;
  }
  revealActiveTab();
  placeExportMenu();
}

// ---- Revise this plan: slide the results to the right, fade the inputs in on the left (and back) ----
const SLIDE = { duration: 480, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' };
function setRevise(on, byUser = false) {
  if (on === reviseMode) return;
  if (byUser) wantSingle = !on;
  const before = document.getElementById('results-section')?.getBoundingClientRect();
  reviseMode = on;
  if (!on) { staleSnap = null; clearTimeout(autoTimer); }
  render();
  if (on) window.scrollTo(0, 0);
  else document.getElementById('results-section')?.scrollIntoView({ block: 'start' });
  const res = document.getElementById('results-section');
  if (before && res && res.animate) {
    const after = res.getBoundingClientRect();
    res.animate([{ transform: `translate(${before.left - after.left}px, ${before.top - after.top}px)` },
      { transform: 'none' }], SLIDE);
  }
  const fading = on ? [root.querySelector('.pane-left')]
    : [...root.querySelectorAll('#setup-section, #roster-section, #chips-section, #errors-panel')];
  for (const el of fading) {
    if (el?.animate) el.animate([{ opacity: 0, transform: 'translateX(-28px)' }, { opacity: 1, transform: 'none' }], SLIDE);
  }
}

function startFlash(base) {
  flashBase = base;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flashBase = null; render(); }, 6000);
}

function reviseBar() {
  if (!reviseMode) {
    const bar = document.createElement('div');
    bar.className = 'revise-bar';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'revise-button'; btn.className = 'btn-primary revise-btn';
    btn.textContent = 'Return to two-column view';
    btn.title = 'Splits the screen into two columns: your inputs on the left and this schedule on the right, each scrolling on its own, so you can change something and re-solve side by side. Your schedule and inputs are unchanged by switching views. Only shown on a wide screen. Use Return to single-column view to go back.';
    btn.addEventListener('click', () => setRevise(true, true));
    bar.appendChild(btn);
    return bar;
  }
  const bar = document.createElement('div');
  bar.className = 'revise-bar';
  const done = document.createElement('button');
  done.type = 'button'; done.id = 'revise-done'; done.className = 'btn-ghost';
  done.textContent = 'Return to single-column view';
  done.title = 'Goes back to the single-column page: inputs first, with the schedule below. Your inputs are kept. Gotcha: if you changed something and have not pressed Solve, the greyed old schedule is dropped and the results stay empty until you Solve again.';
  done.addEventListener('click', () => setRevise(false, true));
  const label = document.createElement('label');
  label.className = 'switch';
  label.title = 'When on, the schedule rebuilds by itself about a second after each change you make. When off, the old schedule stays greyed out until you press Solve. Automatic solving replaces the schedule each time, so turn it off if you are making several edits. This setting is remembered on this computer only.';
  const box = document.createElement('input');
  box.title = label.title;
  box.type = 'checkbox'; box.id = 'auto-resolve'; box.setAttribute('role', 'switch');
  box.checked = autoResolve;
  box.addEventListener('change', () => {
    autoResolve = box.checked;
    try { storage.set(AUTO_KEY, autoResolve); } catch { /* per-viewer convenience only */ }
    if (autoResolve && staleSnap && !validate(scenario).length) scheduleAutoSolve();
  });
  const lt = document.createElement('span');
  lt.textContent = 'Re-solve automatically';
  label.append(box, lt);
  bar.append(done, label);
  return bar;
}

function staleBanner() {
  const b = document.createElement('div');
  b.className = 'stale-banner';
  b.id = 'stale-banner';
  const t = document.createElement('span');
  if (solving) { const sp = document.createElement('span'); sp.className = 'spinner'; sp.setAttribute('aria-hidden', 'true'); b.appendChild(sp); }
  t.textContent = solving ? 'Re-solving with your changes…'
    : 'Changed since this schedule was solved. It is greyed out until you press Solve.';
  b.appendChild(t);
  if (!solving) {
    const s = document.createElement('button');
    s.type = 'button'; s.className = 'btn-primary'; s.textContent = 'Solve';
    s.title = 'Rebuilds the schedule with your latest changes. The greyed old schedule is replaced when the new ones are ready.';
    s.addEventListener('click', runSolve);
    b.appendChild(s);
  }
  return b;
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
  toggle.title = hasSchedule ? 'Opens the menu for getting the schedule out of the app: personal calendar files, a spreadsheet, Google Sheets, or print. Nothing downloads until you pick an item in the menu. Click again, press Escape or click elsewhere to close it.' : 'Disabled until there is a schedule. Press Solve first (and fix any errors), then the export options become available.';
  // a disabled button shows no tooltip in some browsers — the wrapper carries it too
  wrap.title = hasSchedule ? '' : 'Disabled until there is a schedule. Press Solve first (and fix any errors), then the export options become available.';
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

// The panel opens up-and-left of the Export button. When the action bar wraps and the button sits near the left
// edge, that would push it off-screen, so open it up-and-right instead.
function placeExportMenu() {
  const panel = document.getElementById('export-menu');
  if (!panel || panel.hidden) return;
  panel.style.left = ''; panel.style.right = '';
  if (panel.getBoundingClientRect().left < 8) { panel.style.left = '0'; panel.style.right = 'auto'; }
}

function setExportMenu(open, { focusFirst = false, returnFocus = false } = {}) {
  exportMenuOpen = open;
  const panel = document.getElementById('export-menu');
  const toggle = document.getElementById('export-toggle');
  if (panel) panel.hidden = !open;
  placeExportMenu();
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
  btn.title = 'Erases this whole month: setup, roster, clinic days, time off, pins and the solved schedule, and starts a blank one. It asks you to confirm first, but it cannot be undone afterwards unless you saved a copy with Save my month. Files you saved earlier are not touched, and neither is a saved online session: this page just stops saving into it (Open by PIN brings it back).';
  btn.disabled = solving;
  // ponytail: native confirm() — no styled dialog until someone asks for one.
  btn.addEventListener('click', () => {
    const pin = cloudState().pin;
    if (!confirm(pin
      ? `Clear this scenario and start a blank month?

Your saved session (PIN ${pin}) is NOT changed or deleted: it stays on the server, and its team link stays up. This page just stops saving into it. Get it back any time with Open by PIN.`
      : 'Are you sure you want to clear this scenario?')) return;
    if (pin) detachSession();
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
  btn.title = 'Builds the schedule from your team, roster, clinic days, time off and pins. It replaces the schedule now on screen, and extra alternative solutions (Solution 2 to 5) appear as they finish. Greyed out while there are errors above that must be fixed, or while a solve is running.';
  btn.disabled = errors.length > 0 || solving;
  btn.addEventListener('click', runSolve);
  return btn;
}

const FREEZE_TIP = 'Keeps every day up to this date exactly as it is, so the next Solve can only change the days after it. Use it to lock in the part of the month that is already done. Any edit to the setup clears this date, and it is not saved with the month.';
const SOLVE_FIRST_TIP = 'Disabled until there is a schedule to freeze. Press Solve first; then pick the last day you want kept as it is.';

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
  freeze.title = wrap.title = hasSchedule ? FREEZE_TIP : SOLVE_FIRST_TIP;
  label.title = freeze.title;
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
let resultsReady = false;
// ---- two-person team pop-up (v1.14.0) ----
let twoPersonSkipKey = null;   // the two-person days the chief already dismissed the pop-up for (this session only)

const TWO_PERSON_CHOICES = [
  ['intern', 'The intern takes nights, the senior takes days', 'The intern covers every night (back to back if needed) and the senior takes day call. Fills in both calendars.'],
  ['days', 'Both work every day; cross-cover has the nights', 'The senior and the intern both work all days. Nights are covered by the cross-cover person, who is not scheduled here, so those call days show no night person.'],
  ['manual', 'I’ll pin it myself', 'Nothing is filled in. Pin the nights you want on the calendar and the scheduler handles pagers and the rest.'],
];

// Resolves to the chosen mode, or null if the chief closed the pop-up.
function askTwoPerson() {
  return new Promise(resolve => {
    if (typeof HTMLDialogElement === 'undefined') { resolve(null); return; }
    document.getElementById('two-person-dialog')?.remove();
    const dlg = document.createElement('dialog');
    dlg.id = 'two-person-dialog';
    dlg.className = 'app-dialog';
    let choice = null;
    const header = document.createElement('div');
    header.className = 'guide-dialog-header';
    const h = document.createElement('h2');
    h.textContent = 'Looks like you have a two-person team';
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'btn-ghost'; x.textContent = '×'; x.title = 'Close without choosing. Nothing changes.';
    x.addEventListener('click', () => dlg.close());
    header.append(h, x);
    const body = document.createElement('div');
    body.className = 'app-dialog-body';
    const intro = document.createElement('p');
    intro.textContent = 'There are a few ways to schedule this. Pick one and it fills in each of their calendars; you can still change any day afterward.';
    body.appendChild(intro);
    for (const [mode, label, hint] of TWO_PERSON_CHOICES) {
      const b = document.createElement('button');
      b.type = 'button'; b.id = 'two-person-' + mode; b.className = 'btn-secondary two-person-choice';
      const t = document.createElement('strong'); t.textContent = label;
      const d = document.createElement('span'); d.className = 'pref-hint'; d.textContent = hint;
      b.append(t, document.createElement('br'), d);
      b.addEventListener('click', () => { choice = mode; dlg.close(); });
      body.appendChild(b);
    }
    dlg.append(header, body);
    dlg.addEventListener('close', () => { dlg.remove(); resolve(choice); });
    document.body.appendChild(dlg);
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  });
}

// Fill in (or clear) the two-person pins for `mode`. The pop-up's own earlier pins are replaced; for the two
// intern and cross-cover modes the chief's own night/day-call pins on those days are replaced too.
function applyTwoPerson(mode) {
  const days = new Set(twoPersonCallDays(scenario));
  const fill = mode === 'intern' || mode === 'days';
  const pins = scenario.pins.filter(p => p.note !== TWO_PERSON_NOTE &&
    !(fill && days.has(p.date) && (p.type === 'nightCall' || p.type === 'dayCall')));
  editKeepingAnchor({ ...scenario, pins: [...pins, ...twoPersonPins(scenario, mode)],
    options: { ...scenario.options, twoPersonNights: mode } });
  clearTimeout(autoTimer);
}

async function reopenTwoPerson() {
  const mode = await askTwoPerson();
  if (mode) applyTwoPerson(mode);
}

async function runSolve() {
  if (solving) return;
  if (validate(scenario).length) { render(); return; }   // Solve gate — show errors, stay unsolved
  const twoDays = twoPersonCallDays(scenario);
  const twoKey = twoDays.join();
  if (twoDays.length && scenario.options.twoPersonNights == null && twoPersonSkipKey !== twoKey) {
    const mode = await askTwoPerson();
    if (!mode) { twoPersonSkipKey = twoKey; return; }      // closed: no solve, and don't ask again on every edit
    applyTwoPerson(mode);
    if (validate(scenario).length) { render(); return; }
  }
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
      if (done === 1 && staleSnap?.lastSolution) startFlash(staleSnap.lastSolution);
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
      resultsReady = true;
    }
  } catch (e) {
    solveError = e.message;
  } finally {
    solving = false;
    progress = null;
    render();
    if (resultsReady) {
      resultsReady = false;
      announceResults();                                  // does nothing in two-column view
    }
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
  h.innerHTML = '<span class="screen-only">Results</span><span class="print-only">Final Results</span>';
  wrap.appendChild(h);
  const help = document.createElement('p');
  help.className = 'panel-help';
  help.textContent = 'The solved calendar, totals, and anything the independent auditor flags.';
  wrap.appendChild(help);
  if (staleSnap) wrap.classList.add('results-stale');
  const rb = reviseBar();
  if (rb) wrap.appendChild(rb);
  if (staleSnap) wrap.appendChild(staleBanner());

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
    cal.title = 'Click an OFF, PAGER or ROUNDERS cell to pin a person to that day (for example off, pager or night call) and re-solve. The pin stays until you remove it, and the rest of the month stays as close to this schedule as it can. Outlined cells show what changed. Other rows do nothing when clicked.';
    // calendar.js output is frozen: scroll wrappers and change markers are added around/onto it here.
    for (const table of cal.querySelectorAll('table.week')) {
      const box = scrollBox('week-scroll');
      table.before(box);
      box.appendChild(table);
    }
    const active = scenario.activeSolution ?? 0;
    if (flashBase && !staleSnap) markChanges(cal, flashBase, sched, 'Changed by the last re-solve');
    else if (active > 0 && scenario.alternatives?.[0] && highlightOn()) markChanges(cal, scenario.alternatives[0], sched);
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
  btn.title = 'Opens the problem form already filled in with what this page shows, so you only have to add a note. Your month goes with it unless you untick the box in the form. Nothing is sent until you press Send.';
  btn.addEventListener('click', () => openFeedback({ type: 'problem', prefill }));
  p.appendChild(btn);
  return p;
}

const COMPARE_HELP = {
  solution: 'One row per solution. Click a row to make it the schedule on screen; the calendar, totals, issues and every export then follow it. Rows still building are greyed out.',
  quality: 'How this solution compares with Solution 1 overall. Solution 1 is your current schedule, so it just says Current.',
  issues: 'Number of potential issues the checker found in this solution, with the change compared with Solution 1 in brackets. Fewer is better.',
  moves: 'How many days off were moved compared with Solution 1. A small number means a gentle change to the plan you already have.',
  nights: 'Number of night-call shifts each person has in this solution.',
  weekend: 'Number of Saturdays and Sundays each person has off in this solution. Free bonus days are not counted.',
  pager: 'Number of days each person holds the pager in this solution.',
  pmoff: 'Number of afternoons each person has free in this solution: worked the morning with nothing in the afternoon. Information only.',
};

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
  summary.title = 'Opens or closes a table comparing the solutions side by side: how different each is from Solution 1, how many issues it has, and each person\u2019s nights, weekend days off, pager days and afternoons off. Click a row to make it the schedule on screen. Whether it is open is remembered on this computer.';
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
      span.title = `${names[i]}: ${value}`;
      grid.appendChild(span);
    });
    return grid;
  };
  for (const [metric, label] of columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.dataset.metric = metric;
    th.textContent = label;
    th.title = COMPARE_HELP[metric];
    if (['nights', 'weekend', 'pager'].includes(metric)) {
      th.title = `${COMPARE_HELP[metric]} Residents in roster order: ${names.join(' \u00b7 ')}.`;
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
    row.title = 'Click (or press Enter) to make this solution the schedule on screen. Later re-solves stay close to whichever solution is active.';
    row.tabIndex = 0;
    row.setAttribute('aria-selected', String(k === (scenario.activeSolution ?? 0)));
    const name = document.createElement('th');
    name.scope = 'row';
    name.textContent = `Solution ${k + 1}`;
    row.appendChild(name);
    if (!schedule) {
      row.className = 'compare-pending';
      row.title = 'Still being built. It becomes clickable when it finishes.';
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
      tab.title = !alts[k] ? 'Still being built. It becomes clickable when it finishes.'
        : 'Shows this solution on the page. The calendar, totals, issue list and every export then follow it. Solution 1 is your current schedule; the others show different ways to schedule the same month, with the number of days off moved from Solution 1.';
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
    sum.title = 'Lists, for each person, the exact days off that moved compared with Solution 1. Display only; nothing changes.';
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
  label.title = box.title = 'Draws an outline around the OFF, PAGER and ROUNDERS cells that differ from Solution 1, so you can see what changed. Turn it off to view the calendar without outlines. This only affects the screen, not prints or exports, and is remembered on this computer.';
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
function markChanges(cal, base, sched, why = 'Differs from Solution 1') {
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
      td.title = why;
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
  ['single', 'One person scheduled (you forced it)', ['W_SINGLE_COVER']],
  ['senior-pager', 'Senior pager days over your limit', ['W_SENIOR_PAGER_OVER']],
  ['mr', 'Morning Report coverage', ['W_MR_THIN', 'W_MR_NO_SENIOR', 'W_MR_NO_INTERN']],
  ['pager', 'Pager / didactics', ['W_ATTENDING_PAGER', 'W_DIDACTICS_MISS', 'W_DIDACTICS_PAGER',
    'W_DIDACTICS_PAGER_INTERN', 'W_DIDACTICS_NO_SENIOR_COVER', 'W_DIDACTICS_OFF', 'W_DIDACTICS_NO_DATES']],
  ['other', 'Other', null],
];
const ISSUE_GROUP_HELP = {
  violation: 'Rules the independent checker found the schedule breaks. Fix these first, so this group is always open. Opens or closes the list.',
  'multi-off': 'Days when more than one person is off at once. The scheduler avoids this when it can, but it is a preference. Opens or closes the list.',
  stretch: 'Residents who work a long run of days in a row without a day off. Opens or closes the list.',
  duty: 'Residents with fewer days off than one in seven of their service days, the ACGME rest-day guideline. PTO does not count as a day off here. Opens or closes the list.',
  'senior-sc': 'Days a senior is off on a short-call day. The scheduler avoids this unless you ticked Allow seniors off on short-call days. Opens or closes the list.',
  single: 'Days only one person is scheduled. You asked for these with Force One Person Only. Opens or closes the list.',
  'senior-pager': 'Seniors who hold the pager on more days than the limit you set in Setup. That limit is a soft goal. Opens or closes the list.',
  mr: 'Morning Report days where the team is thin or has no senior or no intern present. Opens or closes the list.',
  pager: 'Pager and didactics conflicts, such as a resident holding the pager during their didactics or missing a session, and days the attending covers the pager. Opens or closes the list.',
  other: 'Other things the checker flagged that do not fit the groups above. Opens or closes the list.',
};
const MON_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = iso => `${MON_ABBR[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

// The line already leads with "Feb 7: " — drop the item's own ISO date from the message, and write
// any other ISO date (e.g. the ends of a long stretch) the short way. audit.js messages are untouched.
function tidyIssueText(text, date) {
  let t = text;
  if (date) t = t.split(` on ${date}`).join('').split(` (${date})`).join('').split(` ${date}`).join('');
  return t.replace(/\b\d{4}-\d{2}-\d{2}\b/g, shortDate);
}

let issuesCollapsed = false;   // remembered across re-renders within this page load
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
    sum.title = ISSUE_GROUP_HELP[key] ?? 'Opens or closes this group of issues found in the schedule.';
    det.appendChild(sum);
    const ul = document.createElement('ul');
    for (const li of members) ul.appendChild(li);   // moved, not rebuilt: the attending buttons keep their handlers
    det.appendChild(ul);
    groups.appendChild(det);
  }
  list.replaceWith(groups);
  // One button, top right, hides or shows the whole list; each group keeps its own open/close.
  groups.hidden = issuesCollapsed;
  const all = document.createElement('button');
  all.type = 'button';
  all.id = 'issues-collapse-button';
  all.className = 'btn-ghost issues-collapse';
  const label = () => { all.textContent = groups.hidden ? 'Show all' : 'Collapse all'; all.setAttribute('aria-expanded', String(!groups.hidden)); };
  all.title = 'Hides or shows the whole Potential Issues list. The groups inside keep their own open and close arrows.';
  all.addEventListener('click', () => { groups.hidden = !groups.hidden; issuesCollapsed = groups.hidden; label(); });
  label();
  panel.appendChild(all);
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
  btn.title = 'Opens the full user guide, which explains how to set up a month and how to read the schedule. Nothing on the page changes.';
  btn.addEventListener('click', () => { if (!dialogEl.open) dialogEl.showModal(); });
  box.appendChild(btn);
  return box;
}

// ---- click a rendered cell -> pin popover -> re-solve ----
const PINNABLE_ROWS = new Set(['OFF', 'PAGER', 'ROUNDERS']);
const PIN_TYPES = [
  ['offCounted', 'off (counted)'], ['work', 'must work'],
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

  const personSel = mkSelect(people.map(n => [n, n]),
    'The resident this pin applies to. Only people on service that day are listed, and the one currently in the clicked cell is pre-selected.');
  const dflt = defaultPerson(date, row);
  if (dflt) personSel.value = dflt;
  pop.appendChild(personSel);

  const typeSel = mkSelect(PIN_TYPES,
    'What the pin forces: off (a whole day off that counts toward their quota), must work, pager, day call, night call, or a half day off in the morning or afternoon (a free perk that does not count toward the quota). Pins stay until you remove them. A pin that conflicts with another rule shows as an error.');
  typeSel.value = row === 'PAGER' ? 'pager' : row === 'ROUNDERS' ? 'nightCall' : 'offCounted';
  pop.appendChild(typeSel);

  pop.appendChild(mkButton('Pin & re-solve', () => {
    addPin(personSel.value, date, typeSel.value);
    closePopover();
    runSolve();
  }, 'btn-primary',
    'Pins this person to the chosen option on this day, then rebuilds the schedule. The rest of the month stays as close to the current schedule as it can, and the pin stays until you remove it. The alternative solutions are rebuilt too.'));
  pop.appendChild(mkButton('Remove pins here', () => {
    removePins(personSel.value, date);
    closePopover();
    runSolve();
  }, 'btn-secondary',
    'Removes every pin for this person on this day, whatever type it is, and rebuilds the schedule. It does not ask first, so check the day before you press it.'));
  pop.appendChild(mkButton('Cancel', closePopover, 'btn-ghost',
    'Closes this box without changing any pins or re-solving.'));

  document.body.appendChild(pop);
  popoverEl = pop;
  outsideHandler = ev => { if (popoverEl && !popoverEl.contains(ev.target)) closePopover(); };
  setTimeout(() => document.addEventListener('click', outsideHandler), 0);
}

function closePopover() {
  if (outsideHandler) { document.removeEventListener('click', outsideHandler); outsideHandler = null; }
  if (popoverEl) { popoverEl.remove(); popoverEl = null; }
}

function mkSelect(opts, title = '') {
  const sel = document.createElement('select');
  if (title) sel.title = title;
  for (const [v, l] of opts) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = l;
    sel.appendChild(o);
  }
  return sel;
}

function mkButton(text, onClick, cls = 'btn-secondary', title = '') {
  const b = document.createElement('button');
  if (title) b.title = title;
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

// The month as JSON text: solutions are kept only if every one still passes the export gate.
function monthJSON() {
  let saved = scenario;
  if (!exportableSchedule() || !(scenario.alternatives ?? []).every(sch => exportableSchedule(sch))) {
    const { lastSolution, alternatives, activeSolution, alternativesReason, ...inputs } = scenario;
    saved = inputs;
  }
  return exportScenarioJSON(saved);
}

// Download the whole month — setup, pins, every solution and which tab is chosen — as one .json.
function saveMonth() {
  if (solving) return;                   // mid-build the file would hold only some of the solutions
  const blob = new Blob([monthJSON()], { type: 'application/json' });
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
  saveBtn.title = 'Downloads this month to a file on your computer (team-month.json) with your setup, roster, pins and schedules, so you can reopen it later or send it to a co-chief. If there are errors or a broken rule, only the setup is saved, not the schedule. Nothing on screen changes.';
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
  openBtn.title = 'Opens a month file you saved earlier and replaces the month on screen with it, without asking first. Save the current month first if you want to keep it. Solutions saved inside the file come back too. A file that cannot be read shows an error and changes nothing.';
  openBtn.addEventListener('click', () => loadInput.click());
  wrap.append(openBtn, loadInput);
  if (cloudAvailable()) wrap.append(sessionButtons());

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
  save.title = 'Downloads this month to a file so you can reopen it later or send it to a co-chief. This reminder goes away after you save.';
  save.disabled = solving;               // same lock as the action bar's Save
  box.appendChild(save);
  const x = mkButton('Dismiss', dismissSaveHint, 'btn-ghost');
  x.title = 'Hides this save reminder for good on this computer. You can still save any time with Save my month in the bottom bar.';
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
    header.lastChild.title = 'Closes this box. Nothing is downloaded or changed.';
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

// Explain the two-step Google Sheets hand-off before anything downloads or opens.
function openSheetsGuide(download) {
  openAppDialog('sheets-dialog', 'Open in Google Sheets', body => {
    const lead = document.createElement('p');
    lead.textContent = 'The file downloads into your Downloads folder and a blank Google Sheets page opens. Then:';
    const steps = document.createElement('ol');
    steps.className = 'dialog-steps';
    for (const text of [
      'In Google Sheets, click File, then Open.',
      'Choose the Upload tab and pick the file from your Downloads folder (or drag it in).',
      'Open it. On the right, put an X in the AM / PM / Day boxes for bonus days given.',
    ]) { const li = document.createElement('li'); li.textContent = text; steps.appendChild(li); }
    const go = mkButton('Download and open Google Sheets', () => {
      window.open('https://sheets.new', '_blank', 'noopener');
      download();
      document.getElementById('sheets-dialog')?.close();
    }, 'btn-primary');
    go.classList.add('dialog-link');
    go.title = 'Downloads the spreadsheet to your Downloads folder and opens a new blank Google Sheet in a new tab. Then use File, Open, Upload in Sheets to bring the file in. Your browser may block the new tab, so allow pop-ups if nothing opens.';
    const cancel = mkButton('Cancel', () => document.getElementById('sheets-dialog')?.close(), 'btn-ghost');
    cancel.classList.add('dialog-link');
    cancel.title = 'Closes this box without downloading anything or opening Google Sheets.';
    body.append(lead, steps, go, cancel);
  });
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
    main.title = 'Downloads the newest version of the scheduler as a single HTML file. Open it by double-clicking, and it works offline. Your current schedule is not changed.';
    body.appendChild(main);
    const note = document.createElement('p');
    note.className = 'dialog-note';
    note.textContent = 'You’ll get the newest version. Open the file by double-clicking it.';
    body.appendChild(note);

    const kit = linkButton(`${RELEASES}/latest/download/Medicine-Scheduler.zip`,
      'Starter kit (.zip): app + guide + example months', 'btn-secondary');
    kit.id = 'download-kit-link';
    kit.title = 'Downloads a ZIP containing the app, the guide and example months, for a first look or a fresh start on another computer. Your current schedule is not changed.';
    body.appendChild(kit);

    const all = document.createElement('a');
    all.href = RELEASES;
    all.target = '_blank';
    all.rel = 'noopener';
    all.className = 'dialog-small-link';
    all.textContent = 'All versions on GitHub';
    all.title = 'Opens a GitHub page that lists every released version of the scheduler, in a new tab. Nothing is downloaded.';
    body.appendChild(all);
  });
}

function openCriteria() {
  openAppDialog('criteria-dialog', 'How it solves', body => {
    for (const group of CRITERIA) {
      const h = document.createElement('h3');
      h.textContent = group.heading;
      body.appendChild(h);
      const ul = document.createElement('ul');
      for (const text of group.items) {
        const li = document.createElement('li');
        li.textContent = text;
        ul.appendChild(li);
      }
      body.appendChild(ul);
    }
  });
}

function openAcgme() {
  openAppDialog('acgme-dialog', ACGME.title, body => {
    const lead = document.createElement('p');
    lead.textContent = ACGME.intro;
    body.appendChild(lead);
    for (const r of ACGME.rules) {
      const h = document.createElement('h3');
      h.textContent = `${r.title} `;
      const a = document.createElement('a');
      a.href = ACGME.link(r.page);
      a.target = '_blank';
      a.rel = 'noopener';
      a.className = 'cite-link';
      a.textContent = `\u2197 ${r.ref}`;
      a.title = `Opens the official ACGME document at the page for requirement ${r.ref} (PDF page ${r.page}), in a new tab, so you can read the rule in its original wording.`;
      h.appendChild(a);
      body.appendChild(h);
      const p = document.createElement('p');
      p.textContent = r.text;
      p.style.margin = '0 0 0.4rem';
      body.appendChild(p);
    }
    const note = document.createElement('p');
    note.className = 'dialog-note';
    note.textContent = ACGME.note;
    body.appendChild(note);
    for (const src of ACGME.sources) {
      const a = document.createElement('a');
      a.href = src.href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.className = 'dialog-small-link';
      a.textContent = `\u2197 ${src.label}`;
      a.title = 'Opens the full official ACGME document in a new tab so you can read the requirements in their original wording.';
      body.appendChild(a);
    }
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
  const alts = scenario.alternatives ?? [];
  const onScreen = scenario.activeSolution ?? 0;
  if (alts.length < 2 || exportPick == null || !alts[exportPick]) exportPick = null;
  // ONE solution at a time: the picked one, or the one on screen by default.
  const pickedIdx = () => (exportPick ?? onScreen);
  const pickedSchedule = () => (alts.length > 1 ? alts[pickedIdx()] : scenario.lastSolution);
  const schedule = scenario.lastSolution;
  const allowed = !!exportableSchedule();
  const blockedTip = validate(scenario).length || (schedule && !allowed) ? FIX_EXPORT_TIP : null;
  const canExport = () => !solving && !!exportableSchedule(pickedSchedule());
  // The phone view is built from the SAME schedule and the SAME cell-text functions as the xlsx.
  const phonePayload = () => (canExport() ? buildPhonePayload(scenario, pickedSchedule(), appVersion()) : null);
  const publishGate = () => {
    if (!canExport()) return null;
    if (audit(scenario, pickedSchedule()).violations.some(v => v.code === 'A_CONSECUTIVE_NIGHTS')
      && !confirm('This schedule has back-to-back nights. Publish anyway?')) return null;
    return phonePayload();
  };
  const xlsx = () => {
    if (!canExport()) return;
    const sch = pickedSchedule();
    return downloadXlsx(scenario, sch, audit(scenario, sch));
  };

  if (alts.length > 1) {
    const scopeSelect = mkSelect(alts.map((_, k) =>
      [String(k), k === onScreen ? `Solution ${k + 1} (the one on screen)` : `Solution ${k + 1}`]));
    scopeSelect.id = 'export-scope';
    scopeSelect.title = 'Chooses which ONE solution the spreadsheet and the calendar files are made from. It starts on the solution you are looking at; pick another number to export that one instead. You export one solution at a time, so the file always matches the solution you named. It downloads nothing by itself. Print always prints the solution on screen.';
    scopeSelect.value = String(pickedIdx());
    scopeSelect.disabled = !allowed || solving;
    scopeSelect.addEventListener('change', () => {
      exportPick = Number(scopeSelect.value) === onScreen ? null : Number(scopeSelect.value);
    });
    const scopeRow = menuField('Which solution', scopeSelect);
    scopeRow.classList.add('export-scope-row');
    wrap.appendChild(scopeRow);
  }
  // Three columns so the whole menu fits without scrolling (one column on a phone).
  const colFiles = exportColumn('Spreadsheet & print', 'Files to work from or send to the chief.');
  const colCal = exportColumn('Calendar files', 'For Outlook, Google Calendar or Apple Calendar.');
  const colTeam = exportColumn('Phone team link', null);
  wrap.append(colFiles, colCal, colTeam);

  const calendarSelect = document.createElement('select');
  calendarSelect.id = 'calendar-export-person';
  calendarSelect.title = 'Picks whose calendar file (.ics) the Download calendar button makes. Choose one resident for a single .ics file, or leave it on Everyone for a ZIP holding one .ics file per person. These are calendar files to import into Outlook, Google Calendar or Apple Calendar; they are not the Excel spreadsheet. It downloads nothing by itself.';
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'Everyone (ZIP of .ics files)';
  calendarSelect.appendChild(all);
  for (const resident of scenario.residents) {
    const option = document.createElement('option');
    option.value = resident.name;
    option.textContent = resident.name;
    calendarSelect.appendChild(option);
  }
  calendarSelect.disabled = !allowed || solving;
  colCal.appendChild(menuField('Whose calendar (.ics file)', calendarSelect));

  const calendarBtn = document.createElement('button');
  calendarBtn.id = 'calendar-export-button';
  calendarBtn.type = 'button';
  calendarBtn.className = 'btn-secondary';
  calendarBtn.textContent = 'Download calendar (.ics)';
  calendarBtn.title = blockedTip ?? 'Downloads .ics calendar files for the solution named above, to import into Outlook, Google Calendar or Apple Calendar on a phone or computer. One resident gives one .ics file; Everyone gives a ZIP with one .ics file per person. This is not the Excel spreadsheet. Nothing on the schedule changes.';
  calendarBtn.disabled = !allowed || solving;
  calendarBtn.addEventListener('click', async () => {
    if (!canExport()) return;
    calendarBtn.disabled = true;
    calendarSelect.disabled = true;
    const original = calendarBtn.textContent;
    calendarBtn.textContent = 'Preparing…';
    try {
      const sch = pickedSchedule();
      if (calendarSelect.value)
        downloadResidentCalendar(scenario, sch, calendarSelect.value);
      else
        await downloadCalendarsZip(scenario, sch);
    } finally {
      calendarBtn.textContent = original;
      calendarBtn.disabled = !canExport();
      calendarSelect.disabled = !canExport();
    }
  });
  colCal.appendChild(calendarBtn);

  const xlsxBtn = document.createElement('button');
  xlsxBtn.id = 'xlsx-export-button';
  xlsxBtn.type = 'button';
  xlsxBtn.className = 'btn-secondary';
  xlsxBtn.textContent = 'Export Excel spreadsheet (.xlsx)';
  xlsxBtn.title = blockedTip ?? 'Downloads the solution named above as an Excel spreadsheet (.xlsx): the calendar, each person’s totals and the checks. Keep it as your reference through the month, or send it to the chief for approval. It opens in Excel or Google Sheets. Nothing on the schedule changes.';
  xlsxBtn.disabled = !allowed || solving;
  xlsxBtn.addEventListener('click', xlsx);
  colFiles.appendChild(xlsxBtn);

  const sheetsBtn = document.createElement('button');
  sheetsBtn.id = 'google-sheets-button';
  sheetsBtn.type = 'button';
  sheetsBtn.className = 'btn-secondary';
  sheetsBtn.textContent = 'Download & open Google Sheets';
  sheetsBtn.title = blockedTip ?? 'Opens a short two-step guide first. Then it downloads the spreadsheet and opens a blank Google Sheet, where you upload the file. Nothing downloads until you confirm in the next box.';
  sheetsBtn.disabled = !allowed || solving;
  sheetsBtn.addEventListener('click', () => {
    if (!canExport()) return;
    openSheetsGuide(xlsx);
  });
  colFiles.appendChild(sheetsBtn);

  const printBtn = document.createElement('button');
  printBtn.id = 'print-button';
  printBtn.type = 'button';
  printBtn.className = 'btn-secondary';
  printBtn.textContent = 'Print / Save as PDF';
  printBtn.title = blockedTip ?? 'Opens your browser’s print window with the calendar and totals of the solution on screen (not the one picked above). Choose Save as PDF there to make a PDF. Nothing on the schedule changes.';
  printBtn.disabled = !allowed || solving;
  printBtn.addEventListener('click', () => {
    if (solving || !exportableSchedule()) return;
    setExportMenu(false); window.print();
  });
  colFiles.appendChild(printBtn);
  colTeam.appendChild(teamSection({ gate: publishGate, hasSchedule: allowed && !solving, currentPayload: phonePayload, downloadPhone: () => { const payload = phonePayload(); if (payload) downloadPhoneView(payload); } }));

  return wrap;
}

// A small visible caption over a select in the Export menu.
function downloadPhoneView(payload) {
  const url = URL.createObjectURL(new Blob([phoneHtml(payload)], { type: 'text/html' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${scenario.team || 'team'}-${scenario.month || 'month'}-phone.html`;
  a.click();
  URL.revokeObjectURL(url);
}

function menuField(text, control) {
  const field = document.createElement('div');
  field.className = 'export-field';
  const label = document.createElement('label');
  label.htmlFor = control.id;
  label.textContent = text;
  field.append(label, control);
  return field;
}

function exportColumn(title, note) {
  const col = document.createElement('section');
  col.className = 'export-col';
  const h = document.createElement('h3');
  h.className = 'export-col-title';
  h.textContent = title;
  col.appendChild(h);
  if (note) { const p = document.createElement('p'); p.className = 'export-note'; p.textContent = note; col.appendChild(p); }
  return col;
}

function menuDivider() {
  const hr = document.createElement('hr');
  hr.className = 'export-divider';
  return hr;
}
