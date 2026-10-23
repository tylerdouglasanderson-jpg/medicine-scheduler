export const CYCLE = ['precall', 'call', 'postcall', 'ppc', 'sc1', 'sc2'];

export function monthDates(month) {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(y, m, 0).getDate();          // local; day 0 of next month = last day
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

export function deriveCycle(anchorType, month) {
  const start = CYCLE.indexOf(anchorType);
  if (start === -1) throw new Error(`Unknown anchorType: ${anchorType}`);
  const dates = monthDates(month);
  const [y, m] = month.split('-').map(Number);
  const types = new Map();
  const callDays = [], postCallDays = [], morningReportDays = [];
  dates.forEach((date, i) => {
    const type = CYCLE[(start + i) % 6];
    types.set(date, type);
    if (type === 'call') callDays.push(date);
    if (type === 'postcall') postCallDays.push(date);
    if (type === 'precall') {
      const dow = new Date(y, m - 1, i + 1).getDay();      // local, no TZ math
      if (dow === 2 || dow === 4) morningReportDays.push(date);   // Tue / Thu
    }
  });
  return { types, callDays, postCallDays, morningReportDays, daysInMonth: dates.length };
}

// ---- two-person teams (v1.14.1) ----
// 'intern': the intern takes every night on a two-person call day and the senior takes days (pins are filled in);
// 'days': both work every day and an external cross-cover person covers the nights, so those call days have NO night
// person in the app (derived at solve time, no pins); 'manual': the chief pins it, nothing is filled in.
export const TWO_PERSON_MODES = ['intern', 'days', 'manual'];
export const TWO_PERSON_NOTE = 'two-person';   // marks the pins the pop-up filled in, so a new choice can replace them

// Call days on which exactly one senior and one intern are on service.
export function twoPersonCallDays(scenario) {
  const { callDays } = deriveCycle(scenario.anchorType, scenario.month);
  return callDays.filter(d => {
    const on = scenario.residents.filter(r => onService(r, d));
    return on.length === 2 && on.some(r => r.role === 'senior') && on.some(r => r.role === 'intern');
  });
}

// Call days with no night person (cross-cover has the nights): the two-person days when the mode is 'days'.
export function noNightDays(scenario) {
  return scenario.options?.twoPersonNights === 'days' ? twoPersonCallDays(scenario) : [];
}

// The night / day-call pins for mode 'intern'. A day whose intern has a PM commitment is left to the solver (a night
// pin there is a validation error).
export function twoPersonPins(scenario, mode) {
  if (mode !== 'intern') return [];
  const pins = [];
  for (const d of twoPersonCallDays(scenario)) {
    const on = scenario.residents.filter(r => onService(r, d));
    const night = on.find(r => r.role === 'intern'), day = on.find(r => r.role !== 'intern');
    if (night.commitments.some(x => x.date === d && x.half === 'PM')) continue;
    pins.push({ person: night.name, date: d, type: 'nightCall', half: null, note: TWO_PERSON_NOTE });
    pins.push({ person: day.name, date: d, type: 'dayCall', half: null, note: TWO_PERSON_NOTE });
  }
  return pins;
}

export function onService(person, date) {
  return date >= person.serviceStart && date <= person.serviceEnd;   // ISO strings compare lexically
}

export function serviceDaysIn(person, month) {
  return monthDates(month).filter(d => onService(person, d)).length;
}

export function quotaFor(person, scenario) {
  const days = serviceDaysIn(person, scenario.month);
  const { daysInMonth } = deriveCycle(scenario.anchorType, scenario.month);
  return Math.floor(scenario.options.offQuota * days / daysInMonth + 0.5);  // round-half-up
}

// Default didactics half-day by resident type (program rules). PM = afternoon.
// Seniors & psych interns: Tue PM · categorical interns: Thu PM.
// Transitional (TY) interns: Wednesday PM, flagged `alt` (every OTHER Wednesday). The starting week differs each
// month, so nothing is assumed: `dates` starts empty and the chief picks them with the calendar's Didactics (PM) mode.
// OB/GYN & "other" interns have no fixed default — set per resident in the roster.
export function defaultDidactics(role, kind) {
  const TUE = 2, THU = 4;   // JS getDay(): Sun=0
  let dow = null;
  if (role === 'senior') dow = TUE;
  else if (kind === 'psych') dow = TUE;
  else if (kind === 'categorical') dow = THU;
  else if (kind === 'TY' && role !== 'senior') return { dow: 3, half: 'PM', hard: true, alt: true, dates: [] };
  return dow === null ? null : { dow, half: 'PM', hard: role !== 'senior' };   // interns default to Hard: try to give them the day off; seniors soft
}

// Does this resident have a didactics session on `date` (YYYY-MM-DD)? Weekly rule: that weekday. Every-other
// rule (`alt`, Transitional): only the dates the chief picked. Service/PTO/call status is the caller's job.
export function didacticsOn(r, date) {
  const dd = r?.didactics;
  if (!dd) return false;
  if ((dd.skip ?? []).includes(date)) return false;   // the chief struck this session out (v1.16.0)
  if ((dd.extra ?? []).includes(date)) return true;    // a one-off session the chief added (v1.16.0)
  if (dd.alt) return (dd.dates ?? []).includes(date);
  if (dd.weekly === false) return false;                // ad hoc only: no weekly day
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getDay() === dd.dow;
}

// v1.1.0 — Afternoons off (program rule, 2026-10): reported, never solved for. A resident rounds in the morning and
// has nothing in the afternoon — not the pager, no PM commitment (clinic, ITE…), no PM didactics.
// Call and post-call days never count: the day team and the sleeper's supervising senior are there all
// day, the night person's call day is the daylight before the night, and the sleeper is not working.
// Weekends count. A PM half day off counts (they rounded and left); an AM half day off does not.
export function afternoonsOffDates(scenario, schedule, name) {
  const p = scenario.residents.find(r => r.name === name);
  if (!p || !schedule?.days) return [];
  const [y, m] = scenario.month.split('-').map(Number);
  const pins = scenario.pins.filter(x => x.person === name && x.type === 'halfOff');
  return Object.keys(schedule.days).sort().filter(d => {
    const day = schedule.days[d];
    if (day.type === 'call' || day.type === 'postcall') return false;
    if (!day.working.includes(name) || day.pager === name) return false;
    if (pins.some(x => x.date === d && x.half === 'AM')) return false;
    if (pins.some(x => x.date === d && x.half === 'PM')) return true;
    if (p.commitments.some(c => c.date === d && c.half === 'PM')) return false;
    return !(didacticsOn(p, d) && (p.didactics.half ?? 'PM') === 'PM');
  });
}

// Bump ONLY when the solver's or auditor's SEMANTICS change (a new/removed/reweighted rule) —
// not for UI, packaging, or bug fixes with no effect on what an optimal schedule looks like.
// solve() stamps every schedule it produces with this. A saved solution carrying a different stamp
// is not used to anchor re-solve stability, so a scenario file built under older rules re-solves to
// the NEW optimum without being cleared and re-typed first.
export const RULES_VERSION = '1.8.0';   // v1.8.0: a didactics session the chief struck out (didactics.skip) is not a didactics day anywhere; v1.6.0: a person the chief pinned (nightCall) on two consecutive call days is exempt from the no-back-to-back-nights rule; v1.5.0: singleDays now FORCES exactly 1 or 2 working (surplus offs are free); v1.4.0: soft options.seniorPagerLimit; v1.3.0: per-date one-person-is-enough staffing exception (singleDays); v1.2.0: Transitional didactics dates

export function parseScenario(json) {
  for (const k of ['team', 'month', 'anchorType', 'residents'])
    if (json[k] == null) throw new Error(`scenario missing ${k}`);
  return normalize({
    carryIn: null, pins: [], notes: [], attendingPagerDays: [], singleDays: [], lastSolution: null,
    alternatives: [], activeSolution: 0, alternativesReason: null,
    ...json,
    options: {
      offQuota: 4, goldenWeekend: false, seniorsOffShortCall: false, seniorFirstDay: true, seniorPagerLimit: null, allowExtraOffs: false, twoPersonNights: null,
      ...(json.options ?? {}),
    },
    residents: json.residents.map(r => ({ didactics: null, commitments: [], pto: [], ...r })),
  });
}

// A scenario file outlives the roster, the month, and the rules that produced its schedule. Drop
// anything that can no longer point at something real — otherwise it surfaces as a hard error or a
// render crash the UI gives no way to clear, and the only fix is starting the month over.
function normalize(s) {
  const names = new Set(s.residents.map(r => r.name));
  const inMonth = d => typeof d === 'string' && d.length === 10 && d.slice(0, 7) === s.month;

  s.pins = (s.pins ?? []).filter(p => p && names.has(p.person) && inMonth(p.date));
  s.notes = (s.notes ?? []).filter(n => n && inMonth(n.date));
  s.attendingPagerDays = [...new Set((s.attendingPagerDays ?? []).filter(inMonth))].sort();
  // Optional soft cap on pager days per senior: null (none) or a whole number 0-4.
  const rawSpl = s.options.seniorPagerLimit;
  const spl = rawSpl === null || rawSpl === undefined || rawSpl === '' ? NaN : Number(rawSpl);
  s.options = { ...s.options, seniorPagerLimit: Number.isInteger(spl) && spl >= 0 && spl <= 4 ? spl : null };
  // How the chief chose to run a two-person team (v1.14.0): null = not asked yet.
  if (!TWO_PERSON_MODES.includes(s.options.twoPersonNights)) s.options = { ...s.options, twoPersonNights: null };
  // Days the chief FORCES to exactly N people working (v1.5.0; before it, 1 was only allowed, never forced):
  // { date, count: 1|2, person } - person '' lets the solver choose who works alone (count 1 only).
  const seenSingle = new Set();
  s.singleDays = (s.singleDays ?? [])
    .filter(x => x && inMonth(x.date) && !seenSingle.has(x.date) && seenSingle.add(x.date))
    .map(x => { const count = Number(x.count) === 2 ? 2 : 1;
      return { date: x.date, count, person: count === 1 && names.has(x.person) ? x.person : '' }; })
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const r of s.residents) {
    r.commitments = (r.commitments ?? []).filter(c => c && inMonth(c.date));
    r.pto = [...new Set((r.pto ?? []).filter(inMonth))].sort();
  }
  if (s.carryIn && !names.has(s.carryIn.nightPerson)) s.carryIn = null;

  // A solution only counts as this month's if it covers every date and names only current people.
  const covers = sch => !!sch?.days && monthDates(s.month).every(d => sch.days[d])
    && Object.keys(sch.days).every(inMonth)
    && Object.keys(sch.totals ?? {}).every(n => names.has(n));
  if (!covers(s.lastSolution)) s.lastSolution = null;
  // v1.1.0: afternoons off are a report, not a rule: fill them in for schedules saved before they existed.
  const withPmOff = sch => {
    for (const r of s.residents) if (sch.totals?.[r.name] && sch.totals[r.name].pmOff == null)
      sch.totals[r.name].pmOff = afternoonsOffDates(s, sch, r.name).length;
  };

  // Alternatives (docs/RULES.md §12): the tab set, in order. Each must be this month's AND built by
  // the current rules. Solution 1 is what every other tab's header compares against, and the chosen
  // tab must be the lastSolution — if either no longer holds, the set is dropped whole and the
  // scenario falls back to the single saved schedule.
  const alts = Array.isArray(s.alternatives) ? s.alternatives : [];
  const ok = alts.filter(a => covers(a) && a.rulesVersion === RULES_VERSION);
  const sameDays = a => JSON.stringify(a.days) === JSON.stringify(s.lastSolution?.days);
  const active = ok[0] === alts[0] ? ok.findIndex(sameDays) : -1;
  if (active < 0) {
    s.alternatives = [];
    s.activeSolution = 0;
    s.alternativesReason = null;
  } else {
    ok.forEach(withPmOff);
    s.alternatives = ok;
    s.activeSolution = Number.isInteger(s.activeSolution) && ok[s.activeSolution] && sameDays(ok[s.activeSolution])
      ? s.activeSolution : active;
    if (typeof s.alternativesReason !== 'string') s.alternativesReason = null;
  }
  if (s.lastSolution) withPmOff(s.lastSolution);
  return s;
}

// True when the saved schedule was produced by the rules currently compiled in. Only then may it
// anchor the re-solve stability term; otherwise the old answer would pin the new rules in place.
export function solutionIsCurrent(scenario) {
  return scenario.lastSolution?.rulesVersion === RULES_VERSION;
}
