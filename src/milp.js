// MILP formulation — emits a CPLEX-LP string for HiGHS plus a var-extraction map.
// Encodings follow docs/superpowers/plans/2026-07-16-med-scheduler.md Task 5;
// rule authority is docs/plan-v2.md. audit.js must NEVER import from here (CLAUDE.md).
import { deriveCycle, monthDates, onService, serviceDaysIn, quotaFor, solutionIsCurrent } from './model.js';

// Nobody attends didactics on these days (program rule, 2026-08): a call day is in-house start to
// finish, and a post-call day is spent sleeping or handing over. They are excluded from the model,
// from the totals denominator, and from the calendar's DIDACTICS row — not counted as misses,
// because there was never a session to make.
export const NO_DIDACTICS = new Set(['call', 'postcall']);

export const WEIGHTS = {
  consecSlack: 1000000,    // P1 per consecutive-nights slack use
  quotaShort: 200000,      // P2 per whole off short — DIAGNOSTIC ONLY (opts.elasticQuota; the
                           //    real model makes quota a hard equality, see hard row (1))
  didacticsEscape: 100000, // P3 post-call pager holder has hard didactics that dow
  attendingPager: 100000,  // P4 attending holds pager, per day
  stability: 3000,         // S1 per changed binary vs lastSolution
  equity: 40,              // S2 per pp of shift-rate deviation from mean
  nightSplit: 2,           // S3 per pp of intern night-rate deviation
  dayCallSplit: 2,         // S3b per pp of intern day-call-rate deviation
  offSpread: 10,           // S4 per unit of |weekOffs - 1| per person-week
  seniorOffSC: 25,         // S5 per senior off on a WEEKDAY sc1/sc2 (weekend SC takes no admits; option lifts it)
  seniorOffFirstDay: 30,   // S11 per senior off on the first day of the month (soft: try not to)
  afternoonLoad: 6,        // S6 per pp of committed-afternoon-rate deviation (clinic PM + didactics + pager)
  didacticsOff: 45,        // S7 own didactics half-day lost to a day off (a miss AND a wasted off)
  didacticsPager: 8,       // S7 a SENIOR tethered to the pager at their own didactics — the normal case
  didacticsPagerIntern: 35,// S7 an INTERN tethered — nearly as bad as not going, so buy them out of it
  didacticsIntern: 2,      // S7 multiplier on didacticsOff: interns' protected teaching time comes first
  didacticsDev: 12,        // S7 per unit of didactics-miss imbalance across the team
  morningReport: 4,        // S8 per off on a Morning-Report pre-call day
  multiOff: 2,             // S9 per excess off above 1 on a date
  goldenWeekend: 15,       // S10 reward (applied negative) per Sat+Sun off pair
  offPrecall: 6,           // S12 reward per off on a non-Morning-Report pre-call day (lightest day)
  offSc2: 3,               // S12 reward per off on a short-call-2 day (next lightest)
  mrThin: 60,              // S13 fewer than 2 people present on a Morning-Report day
  mrNoSenior: 30,          // S13 no senior present on a Morning-Report day
  mrNoIntern: 20,          // S13 no intern present on a Morning-Report day
};

// Whole-month 2 seniors + 1 intern (program rule, 2026-10; Astra review 2026-10-06). Only when exactly
// three residents serve this month — 2 seniors + 1 intern — and EVERY one of them is on service
// from the 1st through the last day (PTO ignored). A partial window falls back to ordinary
// eligibility/fairness: forcing the split on a month the intern leaves early produced back-to-back
// nights and an uncovered post-call pager. Returns null, or { intern, seniors, callDays, parity }:
// the intern takes every other call night, on call-day indexes with index % 2 === parity. parity is
//   1 when the intern carried in the last night of the previous month (can't take the first night),
//   0 when a senior carried it in, or with an odd number of call days (intern takes ceil(n/2)),
//   null when either parity is allowed (even n, no carry-in).
// validate.js uses this too (pins that make the alternation impossible); audit.js re-derives it.
export function wholeMonth2S1I(scenario) {
  const dates = monthDates(scenario.month);
  const team = scenario.residents.filter(p => serviceDaysIn(p, scenario.month) > 0);
  if (team.length !== 3) return null;
  if (!team.every(p => p.serviceStart <= dates[0] && p.serviceEnd >= dates[dates.length - 1])) return null;
  const interns = team.filter(p => p.role === 'intern'), seniors = team.filter(p => p.role === 'senior');
  if (interns.length !== 1 || seniors.length !== 2) return null;
  const { callDays } = deriveCycle(scenario.anchorType, scenario.month);
  if (!callDays.length) return null;
  const carry = scenario.anchorType === 'postcall' ? scenario.carryIn : null;
  let parity = callDays.length % 2 ? 0 : null;
  if (carry?.nightPerson) parity = carry.nightPerson === interns[0].name ? 1 : 0;
  return { intern: interns[0], seniors, callDays, parity };
}

// Alternative schedules (v1.0.0, program rule, 2026-10) may cost at most this much more than the best
// schedule, objective measured WITHOUT the stability term. 130 ≈ one shift of equity imbalance
// (equity 40/pp × ~3.2 pp per shift in a 31-day month). Absolute, never a percentage — the best
// objective can be 0 or negative. Every hard rule still holds, and no 100k+ penalty fits inside it.
export const ALT_SLACK = 130;

// opts.elasticQuota re-adds the per-person quota slack. Used ONLY by solve.js's diagnose() to tell
// "the off quota is what's unsatisfiable" apart from every other cause of infeasibility.
// The remaining opts build the alternative schedules (solve.js solveAlternatives, RULES.md §12):
//   stability:false  drops the S1 re-solve anchor entirely.
//   distinctFrom     schedules this one must differ from on >= minOffsMoved movable off cells each
//                    (movable = an off var exists, after freezeDate, and nothing is pinned that day).
//   objCap           the stability-free objective must come in at or under this value.
//   categoryCaps     { att, escape, consec }: upper bounds on how many of each 100k+ penalty event a
//                    schedule may use — attending pager days the chief did NOT hand over, hard-didactics
//                    escapes, consecutive-night slack. Alternatives get Solution 1's counts, so an
//                    alternative can never trade one such event for another inside the quality cap.
// Returns { lp, vars, objective, stabilityTerms, categories, movableOffs }: `objective` is the
// stability-free name -> coefficient map (no constant term), so a caller can price any solution;
// `stabilityTerms` is the S1 name -> coefficient map (all binaries); `categories` lists the var names
// behind each categoryCaps key; `movableOffs` lists the [name, meta] off vars the distance rows count.
export function buildModel(scenario, freezeDate = null,
  { elasticQuota = false, stability = true, distinctFrom = [], minOffsMoved = 0, objCap = null,
    categoryCaps = null } = {}) {
  const { types, callDays, morningReportDays } = deriveCycle(scenario.anchorType, scenario.month);
  const dates = monthDates(scenario.month);
  const di = new Map(dates.map((d, i) => [d, i]));
  const people = scenario.residents;
  const [Y, M] = scenario.month.split('-').map(Number);
  const dow = d => new Date(Y, M - 1, Number(d.slice(8))).getDay();
  const lastDate = dates[dates.length - 1];
  const carry = scenario.anchorType === 'postcall' ? scenario.carryIn : null;
  const last = scenario.lastSolution;
  // Stability may only anchor on a solution the CURRENT rules produced. A schedule saved under an
  // older rules version still renders and can still be frozen through, but it must not hold the
  // new rules hostage — otherwise a file has to be cleared and re-typed to feel a rule change.
  const stableRef = stability && solutionIsCurrent(scenario) ? last : null;
  // A freeze date only means something when there is a saved schedule to freeze to. A stale date
  // with no lastSolution freezes nothing — not even the distance rows' idea of what can move.
  const frozenThrough = freezeDate && last?.days ? freezeDate : null;

  // ---- accumulators ----
  const vars = new Map();
  const categories = { att: [], escape: [], consec: [] };   // the 100k+ penalty events, by kind
  const cons = [], bounds = [], frees = [], binaries = [];
  const objMap = new Map();
  const addObj = (coef, name) => objMap.set(name, (objMap.get(name) ?? 0) + coef);
  const T = (coef, name) => ({ coef, name });
  const lin = terms => terms.map((t, i) => {
    const sign = t.coef < 0 ? '- ' : i === 0 ? '' : '+ ';
    return sign + Math.abs(t.coef) + ' ' + t.name;
  }).join(' ');
  const bin = (name, meta) => { vars.set(name, meta); binaries.push(name); return name; };
  const cont = (name, meta, lo, hi) => {
    vars.set(name, meta);
    if (lo === 'free') frees.push(name);
    else if (hi !== undefined) bounds.push(` ${lo} <= ${name} <= ${hi}`);
    return name; // default: nonneg [0, inf)
  };

  const pinsOf = (p, d) => scenario.pins.filter(x => x.person === p.name && x.date === d);
  const hasPin = (p, d, type) => pinsOf(p, d).some(x => x.type === type);
  const isPto = (p, d) => p.pto.includes(d);

  const prevVal = meta => {           // lastSolution's opinion on a binary, or null
    const day = last?.days?.[meta.date];
    if (!day) return null;
    if (meta.kind === 'off') return day.off?.includes(meta.person) ? 1 : 0;
    if (meta.kind === 'night') return day.night === meta.person ? 1 : 0;
    if (meta.kind === 'pager') return day.pager === meta.person ? 1 : 0;
    return null;
  };

  // ---- derived facts ----
  const callInfo = callDays.map((c, ci) => {
    const on = people.filter(p => onService(p, c));
    const interns = on.filter(p => p.role === 'intern');
    const seniors = on.filter(p => p.role === 'senior');
    let E;
    if (interns.length >= 2) E = interns;        // external cross-cover supervises
    else if (interns.length === 0) E = seniors;  // Med C
    else E = on;                                 // 1 intern: fairness-decided (incl. partial 2S+1I)
    E = E.filter(p => !(p.serviceEnd === c && c < lastDate)); // sleep day would fall outside window
    return { c, ci, on, interns, seniors, E };
  });
  const whole2S1I = wholeMonth2S1I(scenario);
  const prevCallOf = new Map(); // post-call date -> its call date
  callDays.forEach(c => { const i = dates.indexOf(c); if (dates[i + 1]) prevCallOf.set(dates[i + 1], c); });

  // ---- variable creation (static pruning only) ----
  const offName = new Map();   // `${name}|${date}` -> var
  people.forEach((p, pi) => dates.forEach(d => {
    if (!onService(p, d) || isPto(p, d)) return;
    if (['call', 'postcall'].includes(types.get(d))) return;
    if (p.commitments.some(c => c.date === d)) return; // an off day can't fall on a clinic/commitment day
    offName.set(p.name + '|' + d, bin(`off_${pi}_${di.get(d)}`, { kind: 'off', person: p.name, date: d }));
  }));

  const nightName = new Map(); // `${name}|${callDate}` -> var
  callInfo.forEach(({ c, ci, E }) => E.forEach(p => {
    const pi = people.indexOf(p);
    nightName.set(p.name + '|' + c, bin(`night_${pi}_c${ci}`, { kind: 'night', person: p.name, date: c }));
  }));

  const pagerName = new Map(); // `${name}|${date}` -> var
  dates.forEach(d => {
    const t = types.get(d);
    if (t === 'call') return;
    people.forEach((p, pi) => {
      if (!onService(p, d) || isPto(p, d)) return;
      if (!hasPin(p, d, 'pager')) { // ponytail: explicit pager pin overrides static pruning; pin row enforces it
        if (p.commitments.some(x => x.date === d && x.half === 'PM')) return;
        if (p.didactics?.hard && p.didactics.dow === dow(d) && t !== 'postcall') return;
        if (pinsOf(p, d).some(x => x.type === 'halfOff' && x.half === 'PM')) return;
      }
      if (carry && d === dates[0]) { // day-1 post-call from carryIn
        if (p.name === carry.nightPerson) return;                    // sleeper
        if (carry.dayCallIntern && p.name !== carry.dayCallIntern) return; // pager fixed by coverage row
      }
      pagerName.set(p.name + '|' + d, bin(`pager_${pi}_${di.get(d)}`, { kind: 'pager', person: p.name, date: d }));
    });
  });

  // attending-pager slack: non-call, non-post-call days only. Normally near-forbidden; on a day the
  // chief has explicitly handed to the attending it is forced instead, and costs nothing.
  const attendingDays = new Set(scenario.attendingPagerDays ?? []);
  dates.forEach(d => {
    const t = types.get(d);
    if (t === 'call' || t === 'postcall') return;
    const v = cont(`att_${di.get(d)}`, { kind: 'att', date: d }, 0, 1);
    if (attendingDays.has(d)) cons.push(`attfix_${di.get(d)}: 1 ${v} = 1`);
    else { addObj(WEIGHTS.attendingPager, v); categories.att.push(v); }
  });

  if (elasticQuota) people.forEach((p, pi) => {   // diagnostic-only quota slack
    const q = quotaFor(p, scenario);
    cont(`short_${pi}`, { kind: 'short', person: p.name }, 0, q);
    addObj(WEIGHTS.quotaShort, `short_${pi}`);
  });

  // worked indicator w[p,d] as {constant, terms} — an expression, never a variable
  function wTerm(p, d) {
    if (!onService(p, d) || isPto(p, d)) return { constant: 0, terms: [] };
    const t = types.get(d);
    if (t === 'call') return { constant: 1, terms: [] };
    if (t === 'postcall') {
      if (carry && d === dates[0]) return { constant: p.name === carry.nightPerson ? 0 : 1, terms: [] };
      const c = prevCallOf.get(d);
      const nv = c && nightName.get(p.name + '|' + c);
      return nv ? { constant: 1, terms: [T(-1, nv)] } : { constant: 1, terms: [] };
    }
    const ov = offName.get(p.name + '|' + d);
    const half = pinsOf(p, d).some(x => x.type === 'halfOff') ? 0.5 : 0;
    return { constant: 1 - half, terms: ov ? [T(-1, ov)] : [] };
  }

  // ---- hard rows ----
  // (1) HARD quota: counted offs = quota, no slack. offFree is excluded, and halfOff pins are FREEBIES
  // (program rule, 2026-10): they never count toward the quota, however many there are — two halves are
  // not a day off. Everyone gets their full pro-rated quota in WHOLE days or the month is infeasible.
  // The slack only comes back under opts.elasticQuota, for diagnosis.
  people.forEach((p, pi) => {
    const terms = [];
    dates.forEach(d => {
      const v = offName.get(p.name + '|' + d);
      if (v && !hasPin(p, d, 'offFree')) terms.push(T(1, v));
    });
    const slack = elasticQuota ? [T(1, `short_${pi}`)] : [];
    cons.push(`q_${pi}: ` + lin([...terms, ...slack]) + ' = ' + quotaFor(p, scenario));
  });

  // (3) exactly one night per call day
  callInfo.forEach(({ c, ci, E }) => {
    const terms = E.map(p => T(1, nightName.get(p.name + '|' + c))).filter(t => t.name);
    if (terms.length) cons.push(`ngt_c${ci}: ` + lin(terms) + ' = 1'); // ponytail: empty E = validate's problem
  });

  // (4) no consecutive nights, penalized-slack fallback
  for (let j = 0; j + 1 < callDays.length; j++) {
    people.forEach((p, pi) => {
      const na = nightName.get(p.name + '|' + callDays[j]);
      const nb = nightName.get(p.name + '|' + callDays[j + 1]);
      if (!na || !nb) return;
      const v = bin(`consec_${pi}_${j}`, { kind: 'consec', person: p.name, date: callDays[j + 1] });
      cons.push(`cons_${pi}_${j}: ` + lin([T(1, na), T(1, nb), T(-1, v)]) + ' <= 1');
      addObj(WEIGHTS.consecSlack, v);
      categories.consec.push(v);
    });
  }

  // (5+8) post-call pager derivation + sleeper-can't-page, per composition at c
  callInfo.forEach(({ c, ci, interns, seniors }) => {
    const next = dates[dates.indexOf(c) + 1];
    if (!next) return;
    const leq1 = (p, tag) => { // pager[p,next] + night[p,c] <= 1
      const pv = pagerName.get(p.name + '|' + next), nv = nightName.get(p.name + '|' + c);
      if (pv && nv) cons.push(`pcp_${tag}${people.indexOf(p)}_${ci}: ` + lin([T(1, pv), T(1, nv)]) + ' <= 1');
    };
    if (interns.length >= 2) {
      seniors.forEach(s => {
        const pv = pagerName.get(s.name + '|' + next);
        if (pv) cons.push(`pcp_s${people.indexOf(s)}_${ci}: 1 ${pv} = 0`); // day-call intern pages
      });
      interns.forEach(i => leq1(i, 'i'));
    } else if (interns.length === 1) {
      const I = interns[0];
      const pv = pagerName.get(I.name + '|' + next), nv = nightName.get(I.name + '|' + c);
      if (pv && nv) cons.push(`pcp_i${people.indexOf(I)}_${ci}: ` + lin([T(1, pv), T(1, nv)]) + ' = 1');
      seniors.forEach(s => leq1(s, 's'));
    } else {
      seniors.forEach(s => leq1(s, 's')); // Med C: coverage picks a working senior
    }
  });

  // (6) pager coverage on every non-call day
  dates.forEach(d => {
    if (types.get(d) === 'call') return;
    const terms = people.map(p => pagerName.get(p.name + '|' + d)).filter(Boolean).map(v => T(1, v));
    if (vars.has(`att_${di.get(d)}`)) terms.push(T(1, `att_${di.get(d)}`));
    if (terms.length) cons.push(`pcov_${di.get(d)}: ` + lin(terms) + ' = 1');
  });

  // (7) pager/off exclusion wherever both vars exist
  dates.forEach(d => people.forEach((p, pi) => {
    const pv = pagerName.get(p.name + '|' + d), ov = offName.get(p.name + '|' + d);
    if (pv && ov) cons.push(`pgo_${pi}_${di.get(d)}: ` + lin([T(1, pv), T(1, ov)]) + ' <= 1');
  }));

  // (9) staffing floor. ponytail: rhs also subtracts the guaranteed sleeper on post-call days —
  // that is the "2-person Med-C rounds down to 1" exception; plan formula only subtracts on call days.
  dates.forEach(d => {
    const t = types.get(d);
    if (t === 'call') return; // everyone works call days; day-team floor holds by construction
    const availPeople = people.filter(p => onService(p, d) && !isPto(p, d));
    const avail = availPeople.length;
    // post-call rhs subtracts the guaranteed sleeper (audit's sleeperOut); day-1 carry sleeper
    // only counts when actually on the roster that day
    let sleeperOut = 0;
    if (t === 'postcall') {
      sleeperOut = (carry && d === dates[0])
        ? (availPeople.some(p => p.name === carry.nightPerson) ? 1 : 0)
        : 1;
    }
    const medC = scenario.team === 'C' && availPeople.every(p => p.role === 'senior');
    // a two-person team (1 intern + 1 senior) is run by one resident whenever the other is off or asleep
    const twoPerson = people.filter(p => onService(p, d)).length <= 2;
    const rhs = Math.min(medC || twoPerson ? 1 : 2, avail - sleeperOut);
    let constant = 0; const terms = [];
    people.forEach(p => { const w = wTerm(p, d); constant += w.constant; terms.push(...w.terms); });
    if (terms.length) cons.push(`stf_${di.get(d)}: ` + lin(terms) + ' >= ' + (rhs - constant));
  });

  // (10) pins as constraint rows (Task 6's staged relaxation drops pin_ rows by group)
  scenario.pins.forEach((x, xi) => {
    const p = people.find(r => r.name === x.person);
    if (!p) return; // validate flags PIN_OUTSIDE_WINDOW
    const ov = offName.get(p.name + '|' + x.date);
    const pv = pagerName.get(p.name + '|' + x.date);
    const nv = nightName.get(p.name + '|' + x.date);
    const row = (v, val) => cons.push(`pin_${xi}: 1 ${v} = ${val}`);
    if ((x.type === 'offCounted' || x.type === 'offFree') && ov) row(ov, 1);
    else if (x.type === 'work') {
      if (ov) row(ov, 0);
      const c = prevCallOf.get(x.date);
      const wnv = c && nightName.get(p.name + '|' + c);
      if (types.get(x.date) === 'postcall' && wnv) cons.push(`pin_${xi}n: 1 ${wnv} = 0`); // present all day
    } else if (x.type === 'pager' && pv) row(pv, 1);
    else if (x.type === 'dayCall' && nv) row(nv, 0);
    else if (x.type === 'nightCall' && nv) row(nv, 1);
    else if (x.type === 'halfOff' && ov) row(ov, 0); // works the other half: 0.5 in w, nothing in quota
  });

  // (11) freeze-through-date: implicit pins from lastSolution
  if (frozenThrough) {
    for (const [name, meta] of vars) {
      if (!['off', 'night', 'pager'].includes(meta.kind) || meta.date > frozenThrough) continue;
      const v = prevVal(meta);
      if (v !== null) cons.push(`pin_frz_${name}: 1 ${name} = ${v}`);
    }
  }

  // (12) whole-month 2S+1I alternation (program rule, 2026-10; chief resident 2026-10-06): the intern takes
  // EXACTLY every other call night — of any two consecutive call days, one night is the intern's and
  // one a senior's, so neither the intern nor the seniors ever go two in a row. The seniors share their
  // nights as evenly as possible (counts differ by at most 1): 4-5 call days = 1 each, 6 = 2 + 1.
  // A carry-in fixes the parity (see wholeMonth2S1I); otherwise an odd month gives the intern ceil(n/2).
  // Pins that make this impossible are rejected by validate() (NIGHT_ALTERNATION_IMPOSSIBLE).
  if (whole2S1I) {
    const { intern: I, seniors: S, parity } = whole2S1I;
    const n = callDays.length;
    const internNights = parity === 1 ? Math.floor(n / 2) : Math.ceil(n / 2);
    const sn = S.map(s =>
      callDays.map(c => nightName.get(s.name + '|' + c)).filter(Boolean).map(v => T(1, v)));
    const all = sn.flat();
    if (all.length) cons.push(`alt_s: ` + lin(all) + ' = ' + (n - internNights));
    if (sn.length === 2 && sn[0].length && sn[1].length) {
      const neg = ts => ts.map(t => T(-t.coef, t.name));
      cons.push(`alt_d0: ` + lin([...sn[0], ...neg(sn[1])]) + ' <= 1');
      cons.push(`alt_d1: ` + lin([...sn[1], ...neg(sn[0])]) + ' <= 1');
    }
    for (let j = 0; j + 1 < n; j++) {
      const a = nightName.get(I.name + '|' + callDays[j]), b = nightName.get(I.name + '|' + callDays[j + 1]);
      if (a && b) cons.push(`altI_${j}: ` + lin([T(1, a), T(1, b)]) + ' = 1');
    }
    const first = nightName.get(I.name + '|' + callDays[0]);
    if (parity !== null && first) cons.push(`altI_first: 1 ${first} = ${parity === 0 ? 1 : 0}`);
  }

  // ---- soft rows ----
  // S2 total-time equity: rate/mu/dev pattern on shift rate (percent scale)
  const active = people.map((p, pi) => ({ p, pi })).filter(({ p }) => serviceDaysIn(p, scenario.month) > 0);
  cont('mu', { kind: 'dev' }, 'free');
  active.forEach(({ p, pi }) => {
    cont(`shifts_${pi}`, { kind: 'dev', person: p.name }, 'free');
    cont(`rate_${pi}`, { kind: 'dev', person: p.name }, 'free');
    cont(`dev_${pi}`, { kind: 'dev', person: p.name });
    let constant = 0; const terms = [];
    dates.forEach(d => { const w = wTerm(p, d); constant += w.constant; terms.push(...w.terms); });
    cons.push(`sh_${pi}: ` + lin([T(1, `shifts_${pi}`), ...terms.map(t => T(-t.coef, t.name))]) + ' = ' + constant);
    cons.push(`rt_${pi}: ` + lin([T(serviceDaysIn(p, scenario.month), `rate_${pi}`), T(-100, `shifts_${pi}`)]) + ' = 0');
    cons.push(`dv1_${pi}: ` + lin([T(1, `dev_${pi}`), T(-1, `rate_${pi}`), T(1, 'mu')]) + ' >= 0');
    cons.push(`dv2_${pi}: ` + lin([T(1, `dev_${pi}`), T(1, `rate_${pi}`), T(-1, 'mu')]) + ' >= 0');
    addObj(WEIGHTS.equity, `dev_${pi}`);
  });
  cons.push('dv_mu: ' + lin([T(active.length, 'mu'), ...active.map(({ pi }) => T(-1, `rate_${pi}`))]) + ' = 0');

  // shared rate/mu/dev pattern for the count-split fairness terms (percent scale)
  function ratePattern(tag, members, weight) {
    if (members.length < 2) return;
    cont(`${tag}mu`, { kind: 'dev' }, 'free');
    members.forEach(m => {
      cont(`${tag}rate_${m.pi}`, { kind: 'dev' }, 'free');
      cont(`${tag}dev_${m.pi}`, { kind: 'dev' });
      cons.push(`rt_${tag}${m.pi}: ` + lin([T(m.denom, `${tag}rate_${m.pi}`),
        ...m.terms.map(t => T(-100 * t.coef, t.name))]) + ' = ' + 100 * (m.constant ?? 0));
      cons.push(`dv1_${tag}${m.pi}: ` + lin([T(1, `${tag}dev_${m.pi}`), T(-1, `${tag}rate_${m.pi}`), T(1, `${tag}mu`)]) + ' >= 0');
      cons.push(`dv2_${tag}${m.pi}: ` + lin([T(1, `${tag}dev_${m.pi}`), T(1, `${tag}rate_${m.pi}`), T(-1, `${tag}mu`)]) + ' >= 0');
      addObj(weight, `${tag}dev_${m.pi}`);
    });
    cons.push(`dv_${tag}mu: ` + lin([T(members.length, `${tag}mu`), ...members.map(m => T(-1, `${tag}rate_${m.pi}`))]) + ' = 0');
  }

  // S3 night-split + S3b day-call split (interns, pro-rated over their eligible call days)
  const internNight = [];
  people.forEach((p, pi) => {
    if (p.role !== 'intern') return;
    const nvs = callDays.map(c => nightName.get(p.name + '|' + c)).filter(Boolean);
    if (nvs.length) internNight.push({ pi, denom: nvs.length, terms: nvs.map(v => T(1, v)), constant: 0 });
  });
  ratePattern('n', internNight, WEIGHTS.nightSplit);
  ratePattern('dc', internNight.map(m => ({
    pi: m.pi, denom: m.denom, constant: m.denom, terms: m.terms.map(t => T(-1, t.name)),
  })), WEIGHTS.dayCallSplit);

  // S6 committed-afternoon equity (program rule, 2026-08): pager + clinic PM + didactics afternoons should
  // come out roughly even across the team, pro-rated by service days. A senior with a heavy clinic
  // week therefore earns fewer pager days from the DATA rather than from a flat role discount — and
  // the interns stop absorbing the whole pager. Short call is a morning thing and never appears here.
  const afternoons = [];
  people.forEach((p, pi) => {
    const svc = dates.filter(d => onService(p, d) && !isPto(p, d));
    const clinicPM = svc.filter(d => p.commitments.some(c => c.date === d && c.half === 'PM')).length;
    const didacticsDays = p.didactics
      ? svc.filter(d => dow(d) === p.didactics.dow && !NO_DIDACTICS.has(types.get(d))).length : 0;
    const pvs = dates.map(d => pagerName.get(p.name + '|' + d)).filter(Boolean);
    const denom = serviceDaysIn(p, scenario.month);
    if (denom) afternoons.push({ pi, denom, terms: pvs.map(v => T(1, v)), constant: clinicPM + didacticsDays });
  });
  ratePattern('af', afternoons, WEIGHTS.afternoonLoad);

  // S7 didactics protection — ROLE-NEUTRAL, interns weighted first (program rule, 2026-08). Nobody
  // attends on a call or post-call day (program rule, 2026-08), so those are out of the model entirely:
  // not a miss to charge anyone for, not a session anyone could have made. On every other day the
  // ways to lose it are priced: a day off is a miss AND a wasted off; the pager still gets them
  // there, tethered — cheap for a senior, expensive for an intern, because an intern on the pager
  // at didactics is barely there at all. `hard` escalates the off to the escape weight (the pager
  // is already pruned for hard, see var creation).
  const didMiss = [];   // {pi, terms, constant} — per-person miss count, for the imbalance term
  people.forEach((p, pi) => {
    if (!p.didactics) return;
    const offW = (p.role === 'intern' ? WEIGHTS.didacticsIntern : 1) * WEIGHTS.didacticsOff;
    const pagerW = p.role === 'intern' ? WEIGHTS.didacticsPagerIntern : WEIGHTS.didacticsPager;
    const terms = [];
    let constant = 0;
    dates.forEach(d => {
      if (dow(d) !== p.didactics.dow || !onService(p, d) || isPto(p, d)) return;
      if (NO_DIDACTICS.has(types.get(d))) return;               // nobody attends on call / post-call
      // A half day off pinned over the didactics half is a fixed miss (Astra review 2026-10-06): the
      // chief chose it, so nothing to price — but it still counts toward the miss spread.
      if (pinsOf(p, d).some(x => x.type === 'halfOff' && x.half === (p.didactics.half ?? 'PM'))) { constant++; return; }
      const ov = offName.get(p.name + '|' + d);
      if (ov) {
        addObj(p.didactics.hard ? WEIGHTS.didacticsEscape : offW, ov);
        if (p.didactics.hard) categories.escape.push(ov);
        terms.push(T(1, ov));
      }
      const pv = pagerName.get(p.name + '|' + d);
      if (pv) addObj(pagerW, pv);                               // attends tethered — not a miss, not free
    });
    didMiss.push({ pi, terms, constant });
  });
  // Spread the misses a month cannot avoid instead of stacking them on the same person.
  if (didMiss.length >= 2) {
    cont('dmu', { kind: 'dev' }, 'free');
    didMiss.forEach(m => {
      cont(`dmiss_${m.pi}`, { kind: 'dev', person: people[m.pi].name }, 'free');
      cont(`ddev_${m.pi}`, { kind: 'dev', person: people[m.pi].name });
      cons.push(`dm_${m.pi}: ` + lin([T(1, `dmiss_${m.pi}`), ...m.terms.map(t => T(-t.coef, t.name))]) + ' = ' + m.constant);
      cons.push(`dd1_${m.pi}: ` + lin([T(1, `ddev_${m.pi}`), T(-1, `dmiss_${m.pi}`), T(1, 'dmu')]) + ' >= 0');
      cons.push(`dd2_${m.pi}: ` + lin([T(1, `ddev_${m.pi}`), T(1, `dmiss_${m.pi}`), T(-1, 'dmu')]) + ' >= 0');
      addObj(WEIGHTS.didacticsDev, `ddev_${m.pi}`);
    });
    cons.push('dd_mu: ' + lin([T(didMiss.length, 'dmu'), ...didMiss.map(m => T(-1, `dmiss_${m.pi}`))]) + ' = 0');
  }

  // S5 senior off on a weekday sc1/sc2 — the senior is wanted for short-call admissions. Weekend short
  // call takes no admits, and the seniorsOffShortCall option covers months when interns admit alone.
  // S8 off on Morning-Report days
  dates.forEach(d => {
    if (!['sc1', 'sc2'].includes(types.get(d))) return;
    if (scenario.options.seniorsOffShortCall || [0, 6].includes(dow(d))) return;
    people.forEach(p => {
      if (p.role !== 'senior') return;
      const v = offName.get(p.name + '|' + d);
      if (v) addObj(WEIGHTS.seniorOffSC, v);
    });
  });
  morningReportDays.forEach(d => people.forEach(p => {
    const v = offName.get(p.name + '|' + d);
    if (v) addObj(WEIGHTS.morningReport, v);
  }));

  // S12 steer offs onto the lightest days: pre-call first (but not a Morning-Report pre-call),
  // then sc2. Rewards are below offSpread (10) so weekly spacing still wins the argument.
  const mrSet = new Set(morningReportDays);
  dates.forEach(d => {
    const t = types.get(d);
    const reward = t === 'precall' && !mrSet.has(d) ? WEIGHTS.offPrecall
      : t === 'sc2' ? WEIGHTS.offSc2 : 0;
    if (!reward) return;
    people.forEach(p => {
      if (p.didactics && dow(d) === p.didactics.dow && !NO_DIDACTICS.has(t)) return;  // never bribe an off onto teaching time
      const v = offName.get(p.name + '|' + d);
      if (v) addObj(-reward, v);
    });
  });

  // S13 Morning-Report staffing: keep at least 2 people on, ideally one senior AND one intern.
  // Soft — a day where nothing else works may still go thin, and the auditor will say so.
  morningReportDays.forEach((d, k) => {
    const avail = people.filter(p => onService(p, d) && !isPto(p, d));
    const offVars = ps => ps.map(p => offName.get(p.name + '|' + d)).filter(Boolean).map(v => T(1, v));
    const softMin = (group, minPresent, slack, weight) => {
      const terms = offVars(group);
      if (!terms.length || group.length < minPresent) return;   // structurally impossible: no penalty
      cont(slack, { kind: 'mr', date: d });
      cons.push(`${slack}_r: ` + lin([...terms, T(-1, slack)]) + ' <= ' + (group.length - minPresent));
      addObj(weight, slack);
    };
    softMin(avail, 2, `mrthin_${k}`, WEIGHTS.mrThin);
    softMin(avail.filter(p => p.role === 'senior'), 1, `mrsen_${k}`, WEIGHTS.mrNoSenior);
    softMin(avail.filter(p => p.role === 'intern'), 1, `mrint_${k}`, WEIGHTS.mrNoIntern);
  });

  // S11 seniors preferably not off on the first day of the month (option, default on)
  people.forEach(p => {
    if (p.role !== 'senior' || scenario.options.seniorFirstDay === false) return;
    const v = offName.get(p.name + '|' + dates[0]);
    if (v) addObj(WEIGHTS.seniorOffFirstDay, v);
  });

  // S9 >1 off per day
  dates.forEach(d => {
    const vs = people.map(p => offName.get(p.name + '|' + d)).filter(Boolean);
    if (vs.length < 2) return;
    cont(`exc_${di.get(d)}`, { kind: 'dev', date: d });
    cons.push(`mo_${di.get(d)}: ` + lin([...vs.map(v => T(1, v)), T(-1, `exc_${di.get(d)}`)]) + ' <= 1');
    addObj(WEIGHTS.multiOff, `exc_${di.get(d)}`);
  });

  // S4 calendar-week (Sun-Sat) off spread: dev >= |weekOffs - 1|
  // (plan snippet's inequality signs were inverted — corrected here to the actual abs-value encoding)
  const weeks = [];
  { let wk = [];
    dates.forEach(d => { if (dow(d) === 0 && wk.length) { weeks.push(wk); wk = []; } wk.push(d); });
    if (wk.length) weeks.push(wk); }
  people.forEach((p, pi) => weeks.forEach((weekDates, wi) => {
    const svc = weekDates.filter(d => onService(p, d));
    if (svc.length < 4) return;
    const pinnedOff = d => pinsOf(p, d).some(x => ['offCounted', 'offFree'].includes(x.type));
    const offVars = svc.filter(d => offName.get(p.name + '|' + d) && !pinnedOff(d));
    // a half day off is a freebie: it does not satisfy "one off this week" (program rule, 2026-10)
    const pinConst = svc.filter(pinnedOff).length;
    const w = cont(`wdev_${pi}_${wi}`, { kind: 'dev', person: p.name });
    cons.push(`wk1_${pi}_${wi}: ` + lin([T(1, w), ...offVars.map(d => T(1, offName.get(p.name + '|' + d)))]) + ' >= ' + (1 - pinConst));
    cons.push(`wk2_${pi}_${wi}: ` + lin([T(1, w), ...offVars.map(d => T(-1, offName.get(p.name + '|' + d)))]) + ' >= ' + (pinConst - 1));
    addObj(WEIGHTS.offSpread, w);
  }));

  // S10 golden weekend (toggle): reward Sat+Sun both off
  if (scenario.options.goldenWeekend) {
    people.forEach((p, pi) => dates.forEach((d, i) => {
      if (dow(d) !== 6) return;
      const a = offName.get(p.name + '|' + d), b = dates[i + 1] && offName.get(p.name + '|' + dates[i + 1]);
      if (!a || !b) return;
      const g = cont(`gw_${pi}_${i}`, { kind: 'dev', person: p.name, date: d }, 0, 1);
      cons.push(`gw1_${pi}_${i}: ` + lin([T(1, g), T(-1, a)]) + ' <= 0');
      cons.push(`gw2_${pi}_${i}: ` + lin([T(1, g), T(-1, b)]) + ' <= 0');
      addObj(-WEIGHTS.goldenWeekend, g);
    }));
  }

  // Everything above is the schedule's quality; snapshot it before stability is mixed in. It has no
  // constant term (stability's constant is dropped below), so Σ coef × primal is the exact objective.
  const objective = new Map([...objMap].filter(([, c]) => c !== 0));

  // ALT1 quality cap for alternatives: stay within objCap of the stability-free objective.
  if (objCap !== null && objective.size)
    cons.push('objcap: ' + lin([...objective].map(([name, coef]) => T(coef, name))) + ' <= ' + objCap);

  // ALT3 high-penalty category caps for alternatives (no new 100k+ events, see categoryCaps above)
  if (categoryCaps) for (const [k, cap] of Object.entries(categoryCaps)) {
    const names = categories[k] ?? [];
    if (names.length && Number.isFinite(cap)) cons.push(`ccap_${k}: ` + lin(names.map(n => T(1, n))) + ' <= ' + cap);
  }

  // ALT2 distinctness, days off only: Hamming distance to each reference over the movable off vars,
  //   Σ_{ref off=0} off + Σ_{ref off=1} (1 - off) >= minOffsMoved
  // Pinned and frozen cells can't move, so they never count toward (or against) the distance.
  const movableOffs = [...vars].filter(([, m]) => m.kind === 'off'
    && !(frozenThrough && m.date <= frozenThrough)
    && !scenario.pins.some(x => x.person === m.person && x.date === m.date));
  if (minOffsMoved > 0) distinctFrom.forEach((ref, ri) => {
    const isOff = m => ref.days?.[m.date]?.off?.includes(m.person) ?? false;
    const ones = movableOffs.filter(([, m]) => isOff(m)).length;
    const terms = movableOffs.map(([name, m]) => T(isOff(m) ? -1 : 1, name));
    if (terms.length) cons.push(`dist_${ri}: ` + lin(terms) + ' >= ' + (minOffsMoved - ones));
  });

  // S1 re-solve stability: Hamming distance to lastSolution (constant part dropped). Every term is on
  // a binary, so a caller can subtract it from HiGHS's objective exactly (stabilityTerms).
  const stabilityTerms = new Map();
  if (stableRef) {
    for (const [name, meta] of vars) {
      if (!['off', 'night', 'pager'].includes(meta.kind)) continue;
      const v = prevVal(meta);
      if (v === null) continue;
      const coef = v ? -WEIGHTS.stability : WEIGHTS.stability;
      addObj(coef, name);
      stabilityTerms.set(name, coef);
    }
  }

  // ---- LP emission ----
  const objTerms = [...objMap.entries()].filter(([, c]) => c !== 0).map(([name, coef]) => ({ coef, name }));
  const objLines = [];
  objTerms.forEach((t, i) => {
    const sign = t.coef < 0 ? '- ' : i === 0 ? '' : '+ ';
    const s = sign + Math.abs(t.coef) + ' ' + t.name;
    if (i % 12 === 0) objLines.push(' ' + (i === 0 ? 'obj: ' : '') + s);
    else objLines[objLines.length - 1] += ' ' + s;
  });
  const binLines = [];
  for (let i = 0; i < binaries.length; i += 20) binLines.push(' ' + binaries.slice(i, i + 20).join(' '));

  const lp = [
    'Minimize',
    ...objLines,
    'Subject To',
    ...cons.map(c => ' ' + c),
    'Bounds',
    ...bounds,
    ...frees.map(f => ` ${f} free`),
    'Binary',
    ...binLines,
    'End',
  ].join('\n');

  return { lp, vars, objective, stabilityTerms, categories, movableOffs };
}
