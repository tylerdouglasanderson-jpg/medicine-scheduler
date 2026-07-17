// Smoke-test harness: run every scenario in ../scenarios through the REAL
// solver + the independent auditor, then report accuracy.
//
//   node scripts/smoketest.mjs            # all scenarios
//   node scripts/smoketest.mjs 05         # only files whose name contains "05"
//
// "Accuracy" here = three independent checks on each solved schedule:
//   1. auditor (src/audit.js) reports ZERO hard-rule violations,
//   2. every INPUT is honored in the OUTPUT (PTO idle, pins obeyed, quota met),
//   3. the solve was feasible.
// The auditor re-implements every hard rule independently of the solver, so a
// clean audit is a real cross-check, not the solver grading its own homework.
//
// Solved schedules are written to scenarios/solved/<name>.solved.json so you can
// diff or inspect them; the HTML app is still the place to eyeball the calendar.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { solve } from '../src/solve.js';
import { audit } from '../src/audit.js';
import { validate } from '../src/validate.js';
import { parseScenario, deriveCycle, quotaFor } from '../src/model.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scenDir = join(root, 'scenarios');
const outDir = join(scenDir, 'solved');
mkdirSync(outDir, { recursive: true });

const filter = process.argv[2];
const files = readdirSync(scenDir)
  .filter(f => f.endsWith('.json') && (!filter || f.includes(filter)))
  .sort();

// ---- independent input-vs-output cross-checks (do NOT reuse solver eligibility) ----
function inputHonored(s, schedule, warnings) {
  const problems = [];

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
    halfOff:    () => true,   // half-day shape not exposed on the day record; skip strict check
  };
  for (const p of s.pins ?? []) {
    const dd = schedule.days[p.date];
    if (!dd) { problems.push(`pin date ${p.date} missing from schedule`); continue; }
    const check = pinOk[p.type];
    if (check && !check(dd, p)) problems.push(`pin not honored: ${p.person} ${p.type} on ${p.date}`);
  }

  // Off quota: each resident hits quota, or quota-1 WITH a W_QUOTA_SHORT warning naming them.
  for (const r of s.residents) {
    const q = quotaFor(r, s);
    const off = schedule.totals[r.name]?.off ?? 0;
    if (off === q) continue;
    if (off === q - 1 && warnings.some(w => w.code === 'W_QUOTA_SHORT' && w.person === r.name)) continue;
    problems.push(`off quota: ${r.name} has ${off} off, expected ${q}`);
  }
  return problems;
}

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
  // A PM didactics is only truly missed when on call (in-house all day), on nights,
  // or holding the pager (what the app itself flags). A plain day-team day rounds in
  // the AM and can still attend PM didactics, so that is NOT a miss.
  const misses = (d, st) => st === 'N' || st === 'P' || (types.get(d) === 'call' && st === 'W');

  const lines = [];
  lines.push('    ' + pad('  day') + dates.map(d => String(Number(d.slice(8, 10)) % 10)).join(''));
  lines.push('    ' + pad('  type') + dates.map(d => ({ call: 'C', postcall: 'c' }[types.get(d)] ?? '.')).join(''));
  for (const r of s.residents) {
    const st = dates.map(d => status(r, d));
    lines.push('    ' + pad(r.name) + st.join('') + `   ${r.role}`);
    if (r.didactics) {
      let missed = 0;
      const dl = dates.map((d, i) => {
        if (!onSvc(r, d) || dowOf(d) !== r.didactics.dow) return ' ';
        if (misses(d, st[i])) { missed++; return '!'; }
        return 'd';
      }).join('');
      const soft = r.didactics.hard ? '' : ' (soft, no warning)';
      lines.push('    ' + pad(`  ${DOW[r.didactics.dow]} didx`) + dl +
        `   ${missed} missed${soft}`);
    }
  }
  lines.push('    legend  W work · N night · S post-night sleep · P pager · O off · X PTO · . off-service');
  lines.push('    didx    d = didactics that day (free) · ! = on duty, MISSES didactics');
  return lines.join('\n');
}

function statTable(s, schedule) {
  const rows = s.residents.map(r => {
    const nights = Object.values(schedule.days).filter(d => d.night === r.name).length;
    const pager = Object.values(schedule.days).filter(d => d.pager === r.name).length;
    const work = Object.values(schedule.days).filter(d => d.working.includes(r.name)).length;
    const off = schedule.totals[r.name]?.off ?? 0;
    return `    ${r.name.padEnd(10)} ${r.role.padEnd(7)} nights ${nights}  pager ${pager}  off ${off}/${quotaFor(r, s)}  work ${work}`;
  });
  return rows.join('\n');
}

let pass = 0, fail = 0;
for (const f of files) {
  const raw = JSON.parse(readFileSync(join(scenDir, f), 'utf8'));
  let s;
  try { s = parseScenario(raw); }
  catch (e) { console.log(`\n✗ ${f}\n    parse error: ${e.message}`); fail++; continue; }

  const errs = validate(s);
  if (errs.length) {
    console.log(`\n✗ ${f}  — INPUT INVALID (validate blocks Solve)`);
    for (const e of errs) console.log(`    [${e.code}] ${e.message}`);
    fail++; continue;
  }

  let result;
  try { result = await solve(s); }
  catch (e) { console.log(`\n✗ ${f}\n    solve threw: ${e.message}`); fail++; continue; }

  if (result.infeasible) {
    console.log(`\n✗ ${f}  — INFEASIBLE`);
    console.log(`    diagnosis: ${result.infeasible.diagnosis}`);
    console.log(`    culprits:  ${JSON.stringify(result.infeasible.culprits)}`);
    fail++; continue;
  }

  const { schedule, warnings } = result;
  const { violations } = audit(s, schedule);
  const honored = inputHonored(s, schedule, warnings);
  const ok = violations.length === 0 && honored.length === 0;

  writeFileSync(join(outDir, f.replace(/\.json$/, '.solved.json')),
    JSON.stringify(schedule, null, 2));

  console.log(`\n${ok ? '✓' : '✗'} ${f}  — team ${s.team} · ${s.month} · anchor ${s.anchorType} · ${s.residents.length} residents`);
  console.log(statTable(s, schedule));
  console.log(calendarBlock(s, schedule));
  if (violations.length) {
    console.log('    AUDIT VIOLATIONS (hard-rule failures):');
    for (const v of violations) console.log(`      [${v.code}] ${v.message}`);
  }
  if (honored.length) {
    console.log('    INPUT NOT HONORED:');
    for (const p of honored) console.log(`      ${p}`);
  }
  if (warnings.length) {
    console.log(`    soft warnings (${warnings.length}): ` +
      warnings.map(w => w.code).filter((c, i, a) => a.indexOf(c) === i).join(', '));
  }
  ok ? pass++ : fail++;
}

console.log(`\n${'='.repeat(60)}\n${pass}/${pass + fail} scenarios accurate (audit-clean + inputs honored).`);
console.log(`Solved schedules written to scenarios/solved/.`);
if (fail) process.exitCode = 1;
