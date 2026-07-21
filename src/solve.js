// HiGHS wrapper + column-primal extraction to the Schedule shape + staged pin diagnosis.
// solve() is pure (no DOM, no storage). It does NOT import audit.js — the UI composes them.
import { buildModel } from './milp.js';
import { deriveCycle, onService } from './model.js';
import { validate } from './validate.js';

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
  const { lp, vars } = buildModel(scenario, freezeDate);
  const sol = highs.solve(lp, SOLVE_OPTS);
  if (sol.Status === 'Optimal') return extract(scenario, vars, sol.Columns);

  return diagnose(scenario, freezeDate, highs);
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
      if (carry && i === 0) pager = carry.dayCallIntern;   // day-1 pager fixed by carry-in
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

    let shifts = 0, pager = 0, off = 0, didactics = 0;
    for (const d of svc) {
      const dd = days[d];
      if (dd.working.includes(name)) shifts += halfDates.has(d) ? 0.5 : 1;
      if (dd.pager === name) pager++;
      if (dd.off.includes(name) && !freeDates.has(d)) off++;             // counted offs only
    }
    off += 0.5 * halfPins.length;
    const clinic = p.commitments.filter(c => days[c.date]?.working.includes(name)).length;
    if (p.didactics) {
      for (const d of svc) {
        if (dow(d) !== p.didactics.dow || types.get(d) === 'call') continue;
        const dd = days[d];
        if (dd.pager === name || dd.off.includes(name) || dd.sleeper === name || p.pto.includes(d)) continue;
        didactics++;                                       // attended: in window, not lost to call/pager/off
      }
    }
    totals[name] = {
      shifts, pager, clinic, didactics, off,
      pto: p.pto.filter(d => svc.includes(d)).length,
      bonus: freeDates.size,
      perks: halfPins.length,
    };
  }

  // ---- warnings from slack primals + derived didactics/carry-out ----
  const warnings = [];
  const W = (code, message, person, date) => warnings.push({ code, message, person, date });
  for (const m of consecList)
    W('W_CONSEC_NIGHT_SLACK', `${m.person} takes night on consecutive call days ending ${m.date}`, m.person, m.date);
  for (const d of dates) {
    const dd = days[d];
    if (attOf[d]) W('W_ATTENDING_PAGER', `Attending holds the pager on ${d}`, null, d);
    if (types.get(d) === 'call') continue;
    const holder = dd.pager;
    if (!holder || holder === 'ATTENDING') continue;
    const pr = people.find(p => p.name === holder);
    if (pr?.didactics?.hard && pr.didactics.dow === dow(d))
      W('W_DIDACTICS_MISS', `${holder} holds the pager on ${d} and will miss didactics`, holder, d);
  }
  for (const d of dates) {                       // seniors are only softly discouraged from SC-day offs — surface it
    if (!['sc1', 'sc2'].includes(types.get(d))) continue;
    for (const name of days[d].off)
      if (people.find(p => p.name === name)?.role === 'senior')
        W('W_SENIOR_OFF_SC', `${name} (senior) is off on a short-call day (${d})`, name, d);
  }
  const lastD = dates[dates.length - 1];
  if (types.get(lastD) === 'call' && nightOf[lastD])
    W('W_CARRYOUT', `${nightOf[lastD]} is post-call/asleep on the 1st of next month`, nightOf[lastD], lastD);

  return { schedule: { days, totals }, warnings };
}
