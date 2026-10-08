// HiGHS wrapper + column-primal extraction to the Schedule shape + staged pin diagnosis.
// solve() is pure (no DOM, no storage) and does not audit — the UI composes them.
// solveAlternatives() does audit: the independent auditor is its acceptance gate for alternatives.
import { buildModel, NO_DIDACTICS, ALT_SLACK } from './milp.js';
import { deriveCycle, onService, RULES_VERSION, solutionIsCurrent, afternoonsOffDates } from './model.js';
import { validate } from './validate.js';
import { audit } from './audit.js';

// Detect Node the same way highs.js's own Emscripten runtime does (globalThis.process.versions.node) —
// NOT `typeof window === 'undefined'`: jsdom test environments define `window` while still running in
// real Node, which would otherwise route through the browser wasmUrl and mis-resolve the wasm path.
const isNode = typeof process !== 'undefined' && !!process.versions?.node;

let highsPromise = null;
export function initHighs() {
  highsPromise ??= isNode
    ? import('highs').then(m => m.default())               // Node / Vitest (incl. jsdom env): bare highs()
    : import('./highs-browser.js').then(m => m.default());  // real browser: wasm inlined by vite
  return highsPromise;
}

const SOLVE_OPTS = { output_flag: false };

export async function solve(scenario, { freezeDate = null } = {}) {
  const errs = validate(scenario);
  if (errs.length)
    throw new Error('solve() requires validate() to be empty; got: ' + errs.map(e => e.code).join(', '));

  const highs = await initHighs();
  const built = buildModel(scenario, freezeDate);
  const sol = highs.solve(built.lp, SOLVE_OPTS);
  if (sol.Status === 'Optimal')
    return { ...extract(scenario, built.vars, sol.Columns), ...scoreOf(built, sol) };

  return diagnose(scenario, freezeDate, highs);
}

// The schedule's objective WITHOUT the stability term. HiGHS's own full-precision ObjectiveValue
// (the LP has no constant term), minus the stability contribution — every stability term sits on a
// binary, so rounding those primals makes the subtraction exact. Re-pricing every term from rounded
// primals instead drifts in the 4th decimal (Oct-2026: 778.1290322580626 vs 778.1292), and this
// value is what the alternatives' quality cap is built on.
// Also counts the 100k+ penalty events by category (buildModel's `categories`).
function scoreOf(built, sol) {
  let stab = 0;
  for (const [name, coef] of built.stabilityTerms) stab += coef * Math.round(sol.Columns[name]?.Primal ?? 0);
  const categories = {};
  for (const [k, names] of Object.entries(built.categories))
    categories[k] = names.reduce((n, name) => n + Math.round(sol.Columns[name]?.Primal ?? 0), 0);
  return { objective: sol.ObjectiveValue - stab, categories };
}
const OBJ_TOL = z => 1e-6 * Math.max(1, Math.abs(z));   // relative float tolerance for cap checks

// ---- alternative schedules (v1.0.0, docs/RULES.md §12) ----
const ALT_BUDGET_MS = 15000;   // stop looking for alternatives after this, and keep what we have

// HiGHS runs synchronously on the main thread, and initHighs() is already resolved after the first
// solve, so nothing between MILPs yields a macrotask: the browser would not paint Solution 1 or the
// "Building alternatives" progress until every solve was done. Wait for a frame, then a task (a bare
// task can run before the next frame); the timeout covers hidden tabs, which get no frames. Node has
// no requestAnimationFrame and nothing to paint: one task is enough there.
const letBrowserPaint = () => new Promise(resolve => {
  if (typeof requestAnimationFrame !== 'function') return void setTimeout(resolve, 0);
  const t = setTimeout(resolve, 50);
  requestAnimationFrame(() => setTimeout(() => { clearTimeout(t); resolve(); }, 0));
});

// Violation codes the auditor reports, counted. Solution 1 sets the allowance: a hard rule the model
// can only meet through a penalized fallback (consecutive nights, milp.js (4)) breaks in EVERY
// schedule of that month, so it must not disqualify the alternatives.
function violationCounts(scenario, schedule) {
  const n = {};
  for (const v of audit(scenario, schedule).violations) n[v.code] = (n[v.code] ?? 0) + 1;
  return n;
}

const offCells = sch => new Set(Object.entries(sch.days).flatMap(([d, day]) => day.off.map(p => p + '|' + d)));
// Off-cell Hamming distance. Pinned/frozen cells are identical in every solution, so the whole-month
// count equals the movable-cell count the model's distance rows constrain.
function offDistance(a, b) {
  const A = offCells(a), B = offCells(b);
  let n = 0;
  for (const c of A) if (!B.has(c)) n++;
  for (const c of B) if (!A.has(c)) n++;
  return n;
}

// Solution 1 is exactly today's solve() — the chosen schedule, changed as little as possible.
// Solutions 2..count are fresh optima (no stability anchor) that each differ from EVERY schedule
// already accepted on >= m movable off cells, and cost at most ALT_SLACK more than the best
// schedule. If none exists at m, m steps down once (x0.6, min 1); then we stop and say why rather
// than pad the list with near-duplicates. No accepted alternative breaks a rule Solution 1 keeps.
// Returns solve()'s { infeasible } unchanged, or { solutions, z0, stoppedReason }; each solution is
// solve()'s { schedule, warnings, objective, categories } plus minOffsMoved (the m it was held to; null for
// Solution 1) and offDistance (off cells that differ from Solution 1).
export async function solveAlternatives(scenario, { freezeDate = null, count = 5, onProgress = null } = {}) {
  let t0 = Date.now();
  const left = () => ALT_BUDGET_MS - (Date.now() - t0);
  // Time spent letting the browser paint is not search time: it does not count against the budget.
  const yieldToPaint = async () => { const y = Date.now(); await letBrowserPaint(); t0 += Date.now() - y; };
  const first = await solve(scenario, { freezeDate });
  if (first.infeasible) return first;
  const solutions = [{ ...first, minOffsMoved: null, offDistance: 0 }];
  onProgress?.({ done: 1, total: count, solution: solutions[0] });
  let z0 = null;
  const done = stoppedReason => ({ solutions, z0, stoppedReason });
  if (count <= 1) return done(null);
  await yieldToPaint();

  const highs = await initHighs();
  const timedOut = () => done(`Stopped looking after ${ALT_BUDGET_MS / 1000} seconds with `
    + `${solutions.length} schedule${solutions.length === 1 ? '' : 's'} — the rest were taking too long to find.`);
  // One time-boxed MILP. ok:false = no usable schedule (infeasible, or out of time with none found).
  // highs-js returns Columns even when the time limit hits before any incumbent; the objective is
  // then Infinity and the primals are garbage.
  const run = opts => {
    if (left() <= 0) return { ok: false, timeout: true };
    const built = buildModel(scenario, freezeDate, { stability: false, ...opts });
    const r = highs.solve(built.lp, { ...SOLVE_OPTS, time_limit: left() / 1000 });
    if (r.Status === 'Time limit reached' && !Number.isFinite(r.ObjectiveValue)) return { ok: false, timeout: true };
    if (r.Status !== 'Optimal' && r.Status !== 'Time limit reached') return { ok: false, timeout: false };
    return { ok: true, timeout: r.Status !== 'Optimal', ...extract(scenario, built.vars, r.Columns),
      ...scoreOf(built, r) };
  };

  // z0 = the best objective with no stability anchor. With no current lastSolution, Solution 1 was
  // already solved exactly that way; otherwise solve it once — and keep it, since it may itself be
  // a valid Solution 2 (optimal before the distance row, so optimal after it if it satisfies it).
  let best = null;
  if (!solutionIsCurrent(scenario)) z0 = first.objective;
  else {
    best = run({});
    if (!best.ok || best.timeout) return timedOut();   // same constraints as Solution 1: only time can fail it
    z0 = best.objective;
  }
  const cap = z0 + ALT_SLACK;

  const ref = offCells(first.schedule);
  const movable = buildModel(scenario, freezeDate, { stability: false }).movableOffs
    .filter(([, m]) => ref.has(m.person + '|' + m.date)).length;
  let m = Math.ceil(0.5 * movable);
  if (m === 0) return done('Every day off is pinned or frozen, so this is the only schedule.');

  // The independent auditor and a JS re-check of distance and cap have the last word on a candidate.
  // rejection() names why one was turned down (null = accepted), so the stop reason can be honest.
  // The auditor only has to agree the candidate breaks nothing Solution 1 doesn't already break.
  const allowed = violationCounts(scenario, first.schedule);
  // No alternative may use more of any 100k+ penalty event than Solution 1 does (attending pager days
  // nobody asked for, hard-didactics escapes, consecutive nights): with equal weights it could
  // otherwise swap one for another and still sit inside the cap. Rows in the model, re-checked here.
  const categoryCaps = first.categories;
  const overCategory = c => Object.entries(categoryCaps).some(([k, n]) => (c.categories?.[k] ?? 0) > n);
  const rejection = (c, mm) => !c.ok ? 'none'
    : overCategory(c) ? 'category'
    : c.objective > cap + OBJ_TOL(cap) ? 'cap'
      : !solutions.every(s => offDistance(s.schedule, c.schedule) >= mm) ? 'distance'
        : Object.entries(violationCounts(scenario, c.schedule)).some(([code, k]) => k > (allowed[code] ?? 0))
          ? 'audit' : null;
  const attempt = mm => run({ distinctFrom: solutions.map(s => s.schedule), minOffsMoved: mm, objCap: cap, categoryCaps });

  let stepped = false;
  while (solutions.length < count) {
    let c = best && !rejection(best, m) ? best : null;
    best = null;
    c ??= attempt(m);
    if (rejection(c, m) && !c.timeout && !stepped) {
      stepped = true;                                  // step down once (decision 4), then hold it
      const m2 = Math.max(1, Math.round(m * 0.6));
      if (m2 < m) { m = m2; c = attempt(m); }
    }
    const why = rejection(c, m);
    if (why) {
      if (c.timeout) return timedOut();
      return done(whyNoMore(solutions, movable, ref.size, m, run, categoryCaps, why, timedOut));
    }
    const sol = { schedule: c.schedule, warnings: c.warnings, objective: c.objective, categories: c.categories,
      minOffsMoved: m, offDistance: offDistance(first.schedule, c.schedule) };
    solutions.push(sol);
    onProgress?.({ done: solutions.length, total: count, solution: sol });
    await yieldToPaint();
  }
  return done(null);
}

// Plain-language reason for stopping short. Up to two extra re-solves tell the causes apart:
//   uncapped but category-capped finds one  -> "noticeably less fair" (the quality cap)
//   only once the category caps are lifted  -> it would cost an attending-pager day, a protected
//                                              didactics afternoon or back-to-back nights (Astra review)
//   neither                                  -> boxed in (pins, freeze, clinic/PTO, pager coverage)
// A candidate the auditor turned down means model and auditor disagree; say that rather than guess.
function whyNoMore(solutions, movable, offTotal, m, run, categoryCaps, why, timedOut) {
  const n = solutions.length;
  const lead = n === 1 ? 'No meaningfully different schedule exists'
    : `Only ${n} meaningfully different schedules exist`;
  const category = `${lead} — other arrangements would need the attending to cover the pager more often, `
    + 'would cost someone their protected didactics, or would put someone on back-to-back call nights, so they are not shown.';
  if (why === 'audit')
    return `${lead} — the other schedules found would break a scheduling rule, so they are not shown.`;
  if (why === 'category') return category;
  const distinct = { distinctFrom: solutions.map(s => s.schedule), minOffsMoved: m };
  const uncapped = run({ ...distinct, categoryCaps });
  if (uncapped.ok)                                 // a distinct schedule exists, just over the cap
    return `${lead} — any other arrangement of days off is noticeably less fair (more than about one shift).`;
  if (uncapped.timeout) return timedOut().stoppedReason;
  const anyAtAll = run(distinct);                  // no quality cap, no category caps
  if (anyAtAll.ok) return category;
  if (anyAtAll.timeout) return timedOut().stoppedReason;
  if (movable < offTotal / 2) return `${lead} — most days off are pinned, frozen, or blocked by clinic/PTO.`;
  return `${lead} — the days off have very few places they can go (call days, clinic, PTO, pager coverage).`;
}

// ---- staged relaxation: drop pin groups cumulatively; first feasible stage names its group ----
const PIN_STAGES = [
  ['pager'],
  ['dayCall', 'nightCall'],
  ['offCounted', 'offFree', 'work', 'halfOff'],
];

function diagnose(scenario, freezeDate, highs) {
  let dropped = [];
  for (const stage of PIN_STAGES) {
    const culprits = scenario.pins.filter(p => stage.includes(p.type));
    dropped = [...dropped, ...stage];
    if (culprits.length === 0) continue;                   // nothing of this kind pinned — skip
    const relaxed = { ...scenario, pins: scenario.pins.filter(p => !dropped.includes(p.type)) };
    const r = highs.solve(buildModel(relaxed, freezeDate).lp, SOLVE_OPTS);
    if (r.Status === 'Optimal') {
      const list = culprits.map(p => `${p.type} ${p.person} ${p.date}`).join('; ');
      return { infeasible: { diagnosis: `Infeasible until dropping these pins: ${list}`, culprits } };
    }
  }

  // Quota is a hard equality. If the month solves once that equality is allowed to fall short,
  // the quota is the binding problem — say so, and name who can't be paid their days off.
  const el = buildModel(scenario, freezeDate, { elasticQuota: true });
  const r = highs.solve(el.lp, SOLVE_OPTS);
  if (r.Status === 'Optimal') {
    const short = [];
    for (const [name, m] of el.vars)
      if (m.kind === 'short' && (r.Columns[name]?.Primal ?? 0) > 1e-6)
        short.push({ type: 'quota', person: m.person, date: null });
    const who = short.map(s => s.person).join(', ') || 'someone';
    return {
      infeasible: {
        diagnosis: `Everyone must get their full off quota, and there is no way to give ${who} `
          + 'theirs this month. Free up eligible days (fewer clinics/PTO on non-call days), '
          + 'lower the off quota, or add a resident.',
        culprits: short,
      },
    };
  }
  return { infeasible: { diagnosis: 'over-constrained inputs (check PTO/commitment density)', culprits: [] } };
}

// ---- extraction: column primals -> Schedule ----
function extract(scenario, vars, cols) {
  const { types } = deriveCycle(scenario.anchorType, scenario.month);
  const dates = [...types.keys()];
  const people = scenario.residents;
  const carry = scenario.anchorType === 'postcall' ? scenario.carryIn : null;
  const [Y, M] = scenario.month.split('-').map(Number);
  const dow = d => new Date(Y, M - 1, Number(d.slice(8))).getDay();
  const prim = n => cols[n]?.Primal ?? 0;

  // read primals grouped by kind
  const nightOf = {}, offOf = {}, pagerOf = {}, attOf = {};
  const consecList = [];
  for (const [name, m] of vars) {
    const v = prim(name);
    if (m.kind === 'off') { if (v > 0.5) (offOf[m.date] ??= []).push(m.person); }
    else if (m.kind === 'night') { if (v > 0.5) nightOf[m.date] = m.person; }
    else if (m.kind === 'pager') { if (v > 0.5) pagerOf[m.date] = m.person; }
    else if (m.kind === 'att') { if (v > 0.5) attOf[m.date] = true; }
    else if (m.kind === 'consec') { if (v > 0.5) consecList.push(m); }
  }

  const idx = new Map(dates.map((d, i) => [d, i]));
  const days = {};
  for (const d of dates) {
    const t = types.get(d);
    const off = offOf[d] ?? [];
    const i = idx.get(d);
    let sleeper = null, pager = null, night = null, dayCall = null;

    if (t === 'call') {
      night = nightOf[d] ?? null;                          // pager stays null on call days
    } else {
      if (carry && i === 0) sleeper = carry.nightPerson;   // day-1 carry-in sleeper
      else {
        const pd = dates[i - 1];
        if (pd && types.get(pd) === 'call') sleeper = nightOf[pd] ?? null;
      }
      // day-1 pager fixed by carry-in; with no day-call intern the coverage row picked one
      if (carry && i === 0 && carry.dayCallIntern) pager = carry.dayCallIntern;
      else if (pagerOf[d] != null) pager = pagerOf[d];
      else if (attOf[d]) pager = 'ATTENDING';
    }

    const working = people
      .filter(p => onService(p, d) && !p.pto.includes(d) && !off.includes(p.name) && p.name !== sleeper)
      .map(p => p.name);                                   // night person IS in working on the call day

    if (t === 'call') {
      const nextD = dates[i + 1];
      const nextPager = nextD ? (pagerOf[nextD] ?? null) : null;
      const workInterns = people.filter(p =>
        p.role === 'intern' && working.includes(p.name) && p.name !== night);
      const intern = (nextPager && workInterns.some(p => p.name === nextPager)) ? nextPager
        : workInterns.length === 1 ? workInterns[0].name
          : null;
      const senior = people.find(p =>
        p.role === 'senior' && working.includes(p.name) && p.name !== night)?.name ?? null;
      dayCall = { senior, intern };
    }

    days[d] = { type: t, working, off, sleeper, pager, night, dayCall };
  }

  // ---- totals ----
  const totals = {};
  for (const p of people) {
    const name = p.name;
    const svc = dates.filter(d => onService(p, d));
    const pins = scenario.pins.filter(x => x.person === name);
    const freeDates = new Set(pins.filter(x => x.type === 'offFree').map(x => x.date));
    const halfPins = pins.filter(x => x.type === 'halfOff');
    const halfDates = new Set(halfPins.map(x => x.date));

    let shifts = 0, pager = 0, off = 0, didactics = 0, didacticsOf = 0, didacticsPager = 0;
    for (const d of svc) {
      const dd = days[d];
      if (dd.working.includes(name)) shifts += halfDates.has(d) ? 0.5 : 1;
      if (dd.pager === name) pager++;
      if (dd.off.includes(name) && !freeDates.has(d)) off++;             // counted offs only
    }
    // Half days off never count toward Off (program rule, 2026-10): they are freebies, reported in Perks.
    const clinic = p.commitments.filter(c => days[c.date]?.working.includes(name)).length;
    if (p.didactics) {
      for (const d of svc) {
        if (dow(d) !== p.didactics.dow) continue;
        if (NO_DIDACTICS.has(types.get(d)) || p.pto.includes(d)) continue;   // no session to make
        didacticsOf++;                                                   // the denominator a chief can act on
        const dd = days[d];
        if (dd.off.includes(name)) continue;                             // lost the half-day
        // a half day off over the didactics half is a miss too (Astra review 2026-10-06)
        if (halfPins.some(x => x.date === d && x.half === (p.didactics.half ?? 'PM'))) continue;
        didactics++;
        if (dd.pager === name) didacticsPager++;   // they go, but tethered to the pager (program rule, 2026-08)
      }
    }
    totals[name] = {
      shifts, pager, clinic, didactics, didacticsOf, didacticsPager, off,
      pto: p.pto.filter(d => svc.includes(d)).length,
      bonus: freeDates.size,          // whole free days off (offFree pins)
      perks: halfPins.length,         // half days off (halfOff pins) — extra freebies, outside Off
    };
  }

  // v1.1.0: afternoons off need the finished days (pager holders), so they fill in once every resident is done.
  for (const p of people) totals[p.name].pmOff = afternoonsOffDates(scenario, { days }, p.name).length;

  // ---- warnings from slack primals + derived didactics/carry-out ----
  const warnings = [];
  const W = (code, message, person, date) => warnings.push({ code, message, person, date });
  for (const m of consecList)
    W('W_CONSEC_NIGHT_SLACK', `${m.person} takes night on consecutive call days ending ${m.date}`, m.person, m.date);
  for (const d of dates) {
    const dd = days[d];
    if (attOf[d]) W('W_ATTENDING_PAGER', `Attending holds the pager on ${d}`, null, d);
    if (NO_DIDACTICS.has(types.get(d))) continue;
    const holder = dd.pager;
    if (!holder || holder === 'ATTENDING') continue;
    const pr = people.find(p => p.name === holder);
    if (pr?.didactics?.hard && pr.didactics.dow === dow(d))
      W('W_DIDACTICS_MISS', `${holder} holds the pager on ${d} and will miss didactics`, holder, d);
  }
  for (const d of dates) {                       // seniors are only softly discouraged from weekday SC offs — surface it
    if (!['sc1', 'sc2'].includes(types.get(d))) continue;
    if (scenario.options.seniorsOffShortCall || [0, 6].includes(dow(d))) continue;
    for (const name of days[d].off)
      if (people.find(p => p.name === name)?.role === 'senior')
        W('W_SENIOR_OFF_SC', `${name} (senior) is off on a short-call day (${d})`, name, d);
  }
  const lastD = dates[dates.length - 1];
  if (types.get(lastD) === 'call' && nightOf[lastD])
    W('W_CARRYOUT', `${nightOf[lastD]} is post-call/asleep on the 1st of next month`, nightOf[lastD], lastD);

  // The stamp rides ON the schedule, so every caller that feeds a solve result back into a scenario
  // carries it automatically — see solutionIsCurrent() in model.js.
  return { schedule: { rulesVersion: RULES_VERSION, days, totals }, warnings };
}
