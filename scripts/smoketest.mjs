// Smoke / stress harness: run every scenario through the REAL solver (solveAlternatives — the same
// call every Solve in the app makes) + the independent auditor, then report accuracy.
//
//   node scripts/smoketest.mjs              # fixtures/{feb-2026,oct-2026-didactics,comp-*} + scenarios/*.json
//   node scripts/smoketest.mjs 05           # only files whose path contains "05"
//   node scripts/smoketest.mjs --private    # ...plus scenarios/private/*.json (gitignored real months)
//   node scripts/smoketest.mjs --verbose    # also print Solution 1's per-person calendar for each file
//
// Per scenario, in three passes (fresh -> anchored on Solution 1 -> frozen through the 10th):
//   1. validate() is clean,
//   2. solveAlternatives(count 5) returns solutions (or says plainly why fewer),
//   3. for EVERY solution: the auditor reports ZERO violations, every INPUT is honored (PTO idle, pins,
//      halfOff, attendingPagerDays -> ATTENDING, carryIn on day 1, service windows), off quota is exact
//      by an independent recount, objective within z0 + ALT_SLACK, and pairwise off-cell distance holds,
//   4. solve time stays under the fail budget (30 s).
// The auditor re-implements every hard rule independently of the solver and this file re-implements
// the input checks again, so a clean run is a real cross-check, not the solver grading its own homework.
//
// Writes scenarios/solved/<name>.solved.json (Solution 1) and scenarios/solved/summary.json.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { solveAlternatives } from '../src/solve.js';
import { ALT_SLACK } from '../src/milp.js';
import { audit } from '../src/audit.js';
import { validate } from '../src/validate.js';
import { parseScenario, deriveCycle, RULES_VERSION } from '../src/model.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scenDir = join(root, 'scenarios');
const outDir = join(scenDir, 'solved');
mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const PRIVATE = args.includes('--private');
const VERBOSE = args.includes('--verbose');
const filter = args.find(a => !a.startsWith('--'));
const TIME_BUDGET_MS = 30000;
const FREEZE_DAY = 10;                 // pass 3 freezes through this day of the month
const COUNT = 5;

// ---- the file set ----
const sources = [];
const addDir = (dir, label, pick) => {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json') && pick(f)).sort())
    sources.push({ path: join(dir, f), file: f, label: label + f, out: label.replace('/', '-') + f.replace(/\.json$/, '') });
};
addDir(join(root, 'fixtures'), 'fixtures/', f => f === 'feb-2026.json' || f === 'oct-2026-didactics.json' || f.startsWith('comp-'));
addDir(scenDir, '', () => true);
if (PRIVATE) addDir(join(scenDir, 'private'), 'private/', () => true);
const files = sources.filter(s => !filter || s.label.includes(filter));

// ---- independent input-vs-output cross-checks (do NOT reuse solver eligibility or quotaFor) ----
const daysInMonthOf = month => { const [y, m] = month.split('-').map(Number); return new Date(y, m, 0).getDate(); };

// Round-half-up of offQuota * serviceDays / monthDays in integer arithmetic (no float edge cases).
function expectedQuota(r, s) {
  const dim = daysInMonthOf(s.month);
  let svc = 0;
  for (let i = 1; i <= dim; i++) {
    const d = `${s.month}-${String(i).padStart(2, '0')}`;
    if (d >= r.serviceStart && d <= r.serviceEnd) svc++;
  }
  return { svc, quota: Math.floor((2 * s.options.offQuota * svc + dim) / (2 * dim)) };
}

function inputHonored(s, schedule) {
  const problems = [];
  const dates = Object.keys(schedule.days).sort();
  const pins = s.pins ?? [];
  const inWindow = (r, d) => d >= r.serviceStart && d <= r.serviceEnd;

  // Service windows: nobody appears anywhere on a day outside their window.
  for (const r of s.residents)
    for (const d of dates) {
      if (inWindow(r, d)) continue;
      const dd = schedule.days[d];
      if (dd.working.includes(r.name) || dd.off.includes(r.name) || dd.pager === r.name ||
          dd.night === r.name || dd.sleeper === r.name)
        problems.push(`window: ${r.name} scheduled outside service window on ${d}`);
    }

  // PTO days: the person must be completely idle (not working/pager/night/sleeper/off).
  for (const r of s.residents)
    for (const d of r.pto ?? []) {
      const dd = schedule.days[d];
      if (!dd) continue;
      if (dd.working.includes(r.name) || dd.pager === r.name ||
          dd.night === r.name || dd.sleeper === r.name || dd.off.includes(r.name))
        problems.push(`PTO not honored: ${r.name} not idle on ${d}`);
    }

  // Pins: the solved cell must match what was pinned.
  const pinOk = {
    offCounted: (dd, p) => dd.off.includes(p.person),
    offFree:    (dd, p) => dd.off.includes(p.person),
    nightCall:  (dd, p) => dd.night === p.person,
    dayCall:    (dd, p) => dd.dayCall?.intern === p.person || dd.dayCall?.senior === p.person,
    pager:      (dd, p) => dd.pager === p.person,
    work:       (dd, p) => dd.working.includes(p.person),
    // The day record has no half-day shape: a half-off is a day WORKED (not off, not asleep) and,
    // when the PM is the half given away, the person cannot be tethered to the pager that day.
    halfOff:    (dd, p) => dd.working.includes(p.person) && !dd.off.includes(p.person)
                           && !(p.half === 'PM' && dd.pager === p.person),
  };
  for (const p of pins) {
    const dd = schedule.days[p.date];
    if (!dd) { problems.push(`pin date ${p.date} missing from schedule`); continue; }
    const check = pinOk[p.type];
    if (!check) problems.push(`unknown pin type ${p.type}`);
    else if (!check(dd, p)) problems.push(`pin not honored: ${p.person} ${p.type}${p.half ? ' ' + p.half : ''} on ${p.date}`);
  }

  // The chief handed these pager days to the attending.
  for (const d of s.attendingPagerDays ?? []) {
    const got = schedule.days[d]?.pager;
    if (got !== 'ATTENDING') problems.push(`attendingPagerDays: ${d} pager is ${got ?? 'nobody'}, expected ATTENDING`);
  }

  // Post-call anchor: day 1 is fixed by the carry-in (the night person sleeps, the day-call intern holds the pager).
  if (s.anchorType === 'postcall' && s.carryIn) {
    const d1 = schedule.days[dates[0]];
    if (d1.sleeper !== s.carryIn.nightPerson)
      problems.push(`carryIn: day 1 sleeper is ${d1.sleeper}, expected ${s.carryIn.nightPerson}`);
    if (s.carryIn.dayCallIntern && d1.pager !== s.carryIn.dayCallIntern)
      problems.push(`carryIn: day 1 pager is ${d1.pager}, expected ${s.carryIn.dayCallIntern}`);
  }

  // Off quota is a hard line: exact count, recounted from the day grid (not from schedule.totals).
  for (const r of s.residents) {
    const { svc, quota } = expectedQuota(r, s);
    if (!svc) continue;
    const free = new Set(pins.filter(p => p.person === r.name && p.type === 'offFree').map(p => p.date));
    // halfOff pins are freebies (program rule, 2026-10): they never count toward the quota.
    const counted = dates.filter(d => inWindow(r, d) && schedule.days[d].off.includes(r.name) && !free.has(d)).length;
    if (counted !== quota) problems.push(`off quota: ${r.name} has ${counted} counted off, expected ${quota} (${svc} service days)`);
  }
  return problems;
}

// ---- cross-solution checks ----
const offCells = sch => new Set(Object.entries(sch.days).flatMap(([d, day]) => day.off.map(p => p + '|' + d)));
function dist(a, b) {                                   // off-cell Hamming distance between two schedules
  let n = 0;
  for (const c of a) if (!b.has(c)) n++;
  for (const c of b) if (!a.has(c)) n++;
  return n;
}

// Every solution, every check. Returns { problems, minPair }.
function checkRun(s, out, progress, frozenFrom = null, freezeDate = null) {
  const problems = [];
  const sols = out.solutions;
  const P = (i, msg) => problems.push(`Solution ${i + 1}: ${msg}`);

  if (!sols.length) { problems.push('no solutions returned'); return { problems, minPair: null }; }
  if (sols.length < COUNT && !out.stoppedReason) problems.push(`only ${sols.length} solution(s) and no stoppedReason`);
  if (sols.length === COUNT && out.stoppedReason) problems.push(`full set but stoppedReason is set: ${out.stoppedReason}`);
  if (progress.length !== sols.length || progress.some((p, i) => p !== i + 1))
    problems.push(`onProgress fired ${JSON.stringify(progress)} for ${sols.length} solutions`);

  const cells = sols.map(x => offCells(x.schedule));
  sols.forEach((x, i) => {
    const { violations } = audit(s, x.schedule);
    for (const v of violations) P(i, `AUDIT [${v.code}] ${v.message}`);
    for (const p of inputHonored(s, x.schedule)) P(i, p);
    if (x.schedule.rulesVersion !== RULES_VERSION) P(i, `rulesVersion stamp is ${x.schedule.rulesVersion}`);
    if (i > 0) {
      const tol = 1e-6 * Math.max(1, Math.abs(out.z0));   // HiGHS full-precision objectives, MIP tolerances
      if (!(x.objective <= out.z0 + ALT_SLACK + tol)) P(i, `objective ${x.objective} exceeds z0 ${out.z0} + ${ALT_SLACK}`);
      if (x.objective < out.z0 - tol) P(i, `objective ${x.objective} is below z0 ${out.z0} (z0 not the optimum)`);
      for (let j = 0; j < i; j++) {
        const d = dist(cells[i], cells[j]);
        if (d < x.minOffsMoved) P(i, `only ${d} off cells differ from Solution ${j + 1}, needs >= ${x.minOffsMoved}`);
        if (d === 0) P(i, `identical off cells to Solution ${j + 1}`);
      }
    }
    // Frozen pass: every day through the freeze date is the saved schedule's, cell for cell.
    if (frozenFrom)
      for (const [d, day] of Object.entries(frozenFrom.days)) {
        if (d > freezeDate) continue;
        const g = x.schedule.days[d];
        const sameSet = (a, b) => [...a].sort().join() === [...b].sort().join();
        if (!sameSet(g.off, day.off) || g.night !== day.night || g.pager !== day.pager) {
          P(i, `frozen day ${d} changed`); break;
        }
      }
  });
  let minPair = null;
  for (let i = 1; i < sols.length; i++)
    for (let j = 0; j < i; j++) { const d = dist(cells[i], cells[j]); if (minPair === null || d < minPair) minPair = d; }
  return { problems, minPair };
}

async function runPass(s, extra = {}) {
  const progress = [];
  const t0 = Date.now();
  const out = await solveAlternatives(s, { count: COUNT, onProgress: p => progress.push(p.done), ...extra });
  return { out, progress, ms: Date.now() - t0 };
}

// ---- display only ----
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dowOf = d => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).getDay(); };

// Per-person day-by-day calendar. Each day is one char for that person's role;
// a second line marks their didactics weekday — '!' when they're on duty and MISS it.
function calendarBlock(s, schedule) {
  const { types } = deriveCycle(s.anchorType, s.month);
  const dates = Object.keys(schedule.days).sort();
  const pad = str => String(str).padEnd(11);
  const onSvc = (r, d) => d >= r.serviceStart && d <= r.serviceEnd;

  const status = (r, d) => {
    const dd = schedule.days[d];
    if (!onSvc(r, d)) return '.';
    if ((r.pto ?? []).includes(d)) return 'X';
    if (dd.night === r.name) return 'N';
    if (dd.sleeper === r.name) return 'S';
    if (dd.pager === r.name) return 'P';
    if (dd.off.includes(r.name)) return 'O';
    if (dd.working.includes(r.name)) return 'W';
    return '-';
  };
  // DISPLAY ONLY. This re-implements the didactics rules (RULES.md section 7) to draw the calendar; it is
  // not an assertion and is not covered by the test suite, so a semantics change must update it by hand.
  // Didactics semantics (program rule, 2026-08): a call day or PTO is structurally unattendable and is
  // not the schedule's doing; a day off or post-call sleep LOSES the half-day; holding the pager
  // still gets them there, tethered. Anything else is a clean attendance.
  const didStatus = (d, st, r) => {
    // Nobody attends on a call or post-call day, and PTO is PTO — no session existed to make.
    if (types.get(d) === 'call' || types.get(d) === 'postcall' || st === 'X') return '·';
    if (st === 'O') return '!';                                     // a day off LOSES the half-day
    // so does a half day off over the didactics half (Astra review 2026-10-06)
    if ((s.pins ?? []).some(x => x.person === r.name && x.date === d && x.type === 'halfOff'
      && x.half === (r.didactics.half ?? 'PM'))) return '!';
    if (st === 'P') return 'p';                                     // attends holding the pager
    return 'd';
  };

  const lines = [];
  lines.push('    ' + pad('  day') + dates.map(d => String(Number(d.slice(8, 10)) % 10)).join(''));
  lines.push('    ' + pad('  type') + dates.map(d => ({ call: 'C', postcall: 'c' }[types.get(d)] ?? '.')).join(''));
  for (const r of s.residents) {
    const st = dates.map(d => status(r, d));
    lines.push('    ' + pad(r.name) + st.join('') + `   ${r.role}`);
    if (r.didactics) {
      let attended = 0, of = 0, tethered = 0;
      const dl = dates.map((d, i) => {
        if (!onSvc(r, d) || dowOf(d) !== r.didactics.dow) return ' ';
        const c = didStatus(d, st[i], r);
        if (c === '·') return c;
        of++;
        if (c !== '!') attended++;
        if (c === 'p') tethered++;
        return c;
      }).join('');
      lines.push('    ' + pad(`  ${DOW[r.didactics.dow]} didx`) + dl +
        `   ${attended}/${of} attended${tethered ? ` (${tethered} on the pager)` : ''}`);
    }
  }
  lines.push('    legend  W work · N night · S post-night sleep · P pager · O off · X PTO · . off-service');
  lines.push('    didx    d = attends free · p = attends holding the pager · ! = LOSES it (day off) · · = no session (call / post-call / PTO)');
  return lines.join('\n');
}

function statTable(s, schedule) {
  const rows = s.residents.map(r => {
    const nights = Object.values(schedule.days).filter(d => d.night === r.name).length;
    const pager = Object.values(schedule.days).filter(d => d.pager === r.name).length;
    const work = Object.values(schedule.days).filter(d => d.working.includes(r.name)).length;
    const off = schedule.totals[r.name]?.off ?? 0;
    return `    ${r.name.padEnd(10)} ${r.role.padEnd(7)} nights ${nights}  pager ${pager}  off ${off}/${expectedQuota(r, s).quota}  work ${work}`;
  });
  return rows.join('\n');
}

const rosterShape = s => {
  const n = role => s.residents.filter(r => r.role === role).length;
  return `${n('senior')}S${n('intern')}I`;
};
const monthAbbr = m => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m.slice(5) - 1] + m.slice(2, 4);

// ---- main ----
const rows = [], failures = [];
const fail = (src, msg) => failures.push({ file: src.label, msg });

for (const src of files) {
  const row = { file: src.label, ok: false, n: null, minPair: null, ms: null, anch: '-', frz: '-', note: '' };
  rows.push(row);
  const raw = JSON.parse(readFileSync(src.path, 'utf8'));
  let s;
  try { s = parseScenario(raw); }
  catch (e) { row.note = 'parse error'; fail(src, `parse error: ${e.message}`); continue; }
  // `_xfail: "<reason>"` marks a scenario that exposes a KNOWN solver/model bug: it is expected to fail,
  // reports XFAIL (not a failure), and turns into a hard failure (XPASS) the day it starts passing.
  const xfail = typeof raw._xfail === 'string' ? raw._xfail : null;
  Object.assign(row, { team: s.team, month: monthAbbr(s.month), anchor: s.anchorType, shape: rosterShape(s) });

  const errs = validate(s);
  if (errs.length) {
    row.note = 'INVALID INPUT';
    for (const e of errs) fail(src, `validate [${e.code}] ${e.message}`);
    continue;
  }

  const problems = [];
  try {
    // pass 1 — fresh. A saved schedule from an old file must not matter: start from none so the run is deterministic.
    const fresh = { ...s, lastSolution: null };
    const p1 = await runPass(fresh);
    row.ms = p1.ms;
    if (p1.out.infeasible) {
      row.note = 'INFEASIBLE';
      if (xfail) { row.ok = true; row.result = 'XFAIL'; row.xfail = xfail; continue; }
      fail(src, `INFEASIBLE: ${p1.out.infeasible.diagnosis} culprits=${JSON.stringify(p1.out.infeasible.culprits)}`);
      continue;
    }
    const c1 = checkRun(fresh, p1.out, p1.progress);
    problems.push(...c1.problems);
    if (p1.ms > TIME_BUDGET_MS) problems.push(`fresh solve took ${p1.ms} ms (> ${TIME_BUDGET_MS})`);
    row.n = p1.out.solutions.length;
    row.minPair = c1.minPair;
    row.stopped = p1.out.stoppedReason ?? null;
    row.z0 = p1.out.z0;
    const sol1 = p1.out.solutions[0].schedule;
    writeFileSync(join(outDir, src.out + '.solved.json'), JSON.stringify(sol1, null, 2));
    if (VERBOSE) {
      console.log(`\n${src.label}  — Solution 1`);
      console.log(statTable(s, sol1));
      console.log(calendarBlock(s, sol1));
    }

    // pass 2 — anchored: the app's pin-resolve path. Solution 1 now has the stability term pointing at a current lastSolution.
    const anchored = { ...s, lastSolution: sol1 };
    const p2 = await runPass(anchored);
    if (p2.out.infeasible) problems.push(`anchored re-solve INFEASIBLE: ${p2.out.infeasible.diagnosis}`);
    else {
      const c2 = checkRun(anchored, p2.out, p2.progress);
      problems.push(...c2.problems.map(m => `[anchored] ${m}`));
      if (p2.ms > TIME_BUDGET_MS) problems.push(`[anchored] solve took ${p2.ms} ms (> ${TIME_BUDGET_MS})`);
      row.anch = c2.problems.length ? 'FAIL' : `${p2.out.solutions.length}`;
      row.msAnch = p2.ms;
    }

    // pass 3 — freeze through the 10th (needs a saved schedule: Solution 1 of pass 1).
    const freezeDate = `${s.month}-${String(FREEZE_DAY).padStart(2, '0')}`;
    const p3 = await runPass(anchored, { freezeDate });
    if (p3.out.infeasible) problems.push(`[frozen] re-solve INFEASIBLE: ${p3.out.infeasible.diagnosis}`);
    else {
      const c3 = checkRun(anchored, p3.out, p3.progress, sol1, freezeDate);
      problems.push(...c3.problems.map(m => `[frozen] ${m}`));
      if (p3.ms > TIME_BUDGET_MS) problems.push(`[frozen] solve took ${p3.ms} ms (> ${TIME_BUDGET_MS})`);
      row.frz = c3.problems.length ? 'FAIL' : `${p3.out.solutions.length}`;
    }
  } catch (e) {
    problems.push(`threw: ${e.stack?.split('\n').slice(0, 3).join(' | ') ?? e.message}`);
  }
  if (xfail && problems.length) { row.ok = true; row.result = 'XFAIL'; row.xfail = xfail; row.xfailProblems = problems; continue; }
  if (xfail) problems.push(`XPASS: marked _xfail ("${xfail}") but now passes — remove the _xfail key`);
  row.ok = problems.length === 0;
  for (const m of problems) fail(src, m);
}

// ---- compact table ----
const w = Math.max(10, ...rows.map(r => r.file.length));
console.log('\n' + ['file'.padEnd(w), 'team', 'month ', 'anchor  ', 'roster', 'sols', 'minD', 'fresh ms', 'anch', 'frz ', 'result'].join('  '));
for (const r of rows) {
  console.log([
    r.file.padEnd(w), String(r.team ?? '-').padEnd(4), String(r.month ?? '-').padEnd(6), String(r.anchor ?? '-').padEnd(8),
    String(r.shape ?? '-').padEnd(6), String(r.n ?? '-').padStart(4), String(r.minPair ?? '-').padStart(4),
    String(r.ms ?? '-').padStart(8), String(r.anch).padStart(4), String(r.frz).padStart(4),
    r.result ?? (r.ok ? 'ok' : `FAIL ${r.note}`.trim()),
  ].join('  '));
}
const short = rows.filter(r => r.n != null && r.n < COUNT);
if (short.length) {
  console.log('\nFewer than 5 solutions (reason given by the solver):');
  for (const r of short) console.log(`  ${r.file}: ${r.n} — ${r.stopped}`);
}
const xf = rows.filter(r => r.result === 'XFAIL');
if (xf.length) {
  console.log('\nExpected failures (known solver/model bugs, see scenarios/README.md):');
  for (const r of xf) console.log(`  ${r.file}: ${r.xfail}`);
}
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(`  ${f.file}: ${f.msg}`);
}
const pass = rows.filter(r => r.ok).length;
console.log(`\n${'='.repeat(60)}\n${pass}/${rows.length} scenarios as expected: ${pass - xf.length} accurate + ${xf.length} expected-fail (accurate = validate clean, ${COUNT}-solution run audit-clean + inputs honored + quota exact; fresh, anchored, frozen).`);
console.log('Solution 1 of each written to scenarios/solved/; table in scenarios/solved/summary.json.');
writeFileSync(join(outDir, 'summary.json'), JSON.stringify({
  rulesVersion: RULES_VERSION, count: COUNT, private: PRIVATE, passed: pass, total: rows.length,
  rows, failures,
}, null, 2));
if (pass !== rows.length) process.exitCode = 1;
