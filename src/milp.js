// MILP formulation — emits a CPLEX-LP string for HiGHS plus a var-extraction map.
// Encodings follow docs/superpowers/plans/2026-07-16-med-scheduler.md Task 5;
// rule authority is docs/plan-v2.md. audit.js must NEVER import from here (CLAUDE.md).
import { deriveCycle, monthDates, onService, serviceDaysIn, quotaFor } from './model.js';

export const WEIGHTS = {
  consecSlack: 1000000,    // P1 per consecutive-nights slack use
  quotaShort: 200000,      // P2 per whole off short
  didacticsEscape: 100000, // P3 post-call pager holder has hard didactics that dow
  attendingPager: 100000,  // P4 attending holds pager, per day
  stability: 3000,         // S1 per changed binary vs lastSolution
  equity: 40,              // S2 per pp of shift-rate deviation from mean
  nightSplit: 2,           // S3 per pp of intern night-rate deviation
  dayCallSplit: 2,         // S3b per pp of intern day-call-rate deviation
  offSpread: 10,           // S4 per unit of |weekOffs - 1| per person-week
  seniorOffSC: 25,         // S5 per senior off on sc1/sc2
  pagerSenior: 3,          // S6 per senior-pager day
  pagerInternDev: 1,       // S6 per pp of intern pager-rate deviation
  seniorDidactics: 6,      // S7 per senior pager on own didactics dow
  seniorDidacticsDev: 4,   // S7 per unit senior didactics-miss imbalance
  morningReport: 4,        // S8 per off on a Morning-Report pre-call day
  multiOff: 2,             // S9 per excess off above 1 on a date
  goldenWeekend: 15,       // S10 reward (applied negative) per Sat+Sun off pair
};

export function buildModel(scenario, freezeDate = null) {
  const { types, callDays, morningReportDays } = deriveCycle(scenario.anchorType, scenario.month);
  const dates = monthDates(scenario.month);
  const di = new Map(dates.map((d, i) => [d, i]));
  const people = scenario.residents;
  const [Y, M] = scenario.month.split('-').map(Number);
  const dow = d => new Date(Y, M - 1, Number(d.slice(8))).getDay();
  const lastDate = dates[dates.length - 1];
  const carry = scenario.anchorType === 'postcall' ? scenario.carryIn : null;
  const last = scenario.lastSolution;

  // ---- accumulators ----
  const vars = new Map();
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
  const whole2S1I = callInfo.length > 0 && callInfo.every(x =>
    x.seniors.length === 2 && x.interns.length === 1 &&
    x.interns[0] === callInfo[0].interns[0] &&
    x.seniors.every(s => callInfo[0].seniors.includes(s)));
  const prevCallOf = new Map(); // post-call date -> its call date
  callDays.forEach(c => { const i = dates.indexOf(c); if (dates[i + 1]) prevCallOf.set(dates[i + 1], c); });

  // ---- variable creation (static pruning only) ----
  const offName = new Map();   // `${name}|${date}` -> var
  people.forEach((p, pi) => dates.forEach(d => {
    if (!onService(p, d) || isPto(p, d)) return;
    if (['call', 'postcall'].includes(types.get(d))) return;
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

  dates.forEach(d => {          // attending-pager slack: non-call, non-post-call days only
    const t = types.get(d);
    if (t === 'call' || t === 'postcall') return;
    cont(`att_${di.get(d)}`, { kind: 'att', date: d }, 0, 1);
    addObj(WEIGHTS.attendingPager, `att_${di.get(d)}`);
  });

  people.forEach((p, pi) => {   // quota slack
    const q = quotaFor(p, scenario);
    const floor = Math.max(q - 1, Math.min(q, 2));
    cont(`short_${pi}`, { kind: 'short', person: p.name }, 0, Math.max(0, q - floor));
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
  // (1) elastic quota: counted offs + short = quota (offFree excluded; halfOff pins are 0.5 constants)
  people.forEach((p, pi) => {
    const terms = [];
    dates.forEach(d => {
      const v = offName.get(p.name + '|' + d);
      if (v && !hasPin(p, d, 'offFree')) terms.push(T(1, v));
    });
    const halfCount = scenario.pins.filter(x => x.person === p.name && x.type === 'halfOff').length;
    cons.push(`q_${pi}: ` + lin([...terms, T(1, `short_${pi}`)]) + ' = ' + (quotaFor(p, scenario) - 0.5 * halfCount));
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
    const rhs = Math.min(medC ? 1 : 2, avail - sleeperOut);
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
    else if (x.type === 'halfOff' && ov) row(ov, 0); // 0.5 credit is a constant in quota/w
  });

  // (11) freeze-through-date: implicit pins from lastSolution
  if (freezeDate && last) {
    for (const [name, meta] of vars) {
      if (!['off', 'night', 'pager'].includes(meta.kind) || meta.date > freezeDate) continue;
      const v = prevVal(meta);
      if (v !== null) cons.push(`pin_frz_${name}: 1 ${name} = ${v}`);
    }
  }

  // (12) whole-month 2S+1I alternation
  if (whole2S1I) {
    const I = callInfo[0].interns[0];
    callInfo[0].seniors.forEach(s => {
      const terms = callDays.map(c => nightName.get(s.name + '|' + c)).filter(Boolean).map(v => T(1, v));
      if (terms.length) cons.push(`alt_${people.indexOf(s)}: ` + lin(terms) + ' = 1');
    });
    for (let j = 0; j + 1 < callDays.length; j++) {
      const a = nightName.get(I.name + '|' + callDays[j]), b = nightName.get(I.name + '|' + callDays[j + 1]);
      if (a && b) cons.push(`altI_${j}: ` + lin([T(1, a), T(1, b)]) + ' >= 1');
    }
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

  // S6 pager fairness: flat cost per senior-pager day + intern pager-rate deviation
  const internPager = [];
  people.forEach((p, pi) => {
    const pvs = dates.map(d => pagerName.get(p.name + '|' + d)).filter(Boolean);
    if (p.role === 'senior') pvs.forEach(v => addObj(WEIGHTS.pagerSenior, v));
    else if (pvs.length) internPager.push({ pi, denom: serviceDaysIn(p, scenario.month), terms: pvs.map(v => T(1, v)), constant: 0 });
  });
  ratePattern('pg', internPager, WEIGHTS.pagerInternDev);

  // S7 senior soft didactics: cost per pager on own didactics dow + miss-count imbalance (2 seniors)
  const seniorMiss = [];
  people.forEach(p => {
    if (p.role !== 'senior' || !p.didactics) return;
    const vs = dates.filter(d => dow(d) === p.didactics.dow)
      .map(d => pagerName.get(p.name + '|' + d)).filter(Boolean);
    vs.forEach(v => addObj(WEIGHTS.seniorDidactics, v));
    seniorMiss.push(vs);
  });
  if (seniorMiss.length === 2) {
    cont('sddev', { kind: 'dev' });
    const t = [...seniorMiss[0].map(v => T(-1, v)), ...seniorMiss[1].map(v => T(1, v))];
    cons.push('dv1_sd: ' + lin([T(1, 'sddev'), ...t]) + ' >= 0');
    cons.push('dv2_sd: ' + lin([T(1, 'sddev'), ...t.map(x => T(-x.coef, x.name))]) + ' >= 0');
    addObj(WEIGHTS.seniorDidacticsDev, 'sddev');
  }

  // S5 senior off on sc1/sc2; S8 off on Morning-Report days
  dates.forEach(d => {
    if (!['sc1', 'sc2'].includes(types.get(d))) return;
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
    const pinConst = svc.reduce((s, d) =>
      s + (pinnedOff(d) ? 1 : pinsOf(p, d).some(x => x.type === 'halfOff') ? 0.5 : 0), 0);
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

  // P3 didactics escape: post-call pager hitting the holder's HARD didactics dow
  dates.forEach(d => {
    if (types.get(d) !== 'postcall') return;
    people.forEach(p => {
      if (!p.didactics?.hard || p.didactics.dow !== dow(d)) return;
      const v = pagerName.get(p.name + '|' + d);
      if (v) addObj(WEIGHTS.didacticsEscape, v);
    });
  });

  // S1 re-solve stability: Hamming distance to lastSolution (constant part dropped)
  if (last) {
    for (const [name, meta] of vars) {
      if (!['off', 'night', 'pager'].includes(meta.kind)) continue;
      const v = prevVal(meta);
      if (v !== null) addObj(v ? -WEIGHTS.stability : WEIGHTS.stability, name);
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

  return { lp, vars };
}
