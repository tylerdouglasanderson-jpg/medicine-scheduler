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
// Seniors & psych interns: Tue PM · TY interns: Wed PM · categorical interns: Thu PM.
// OB/GYN & "other" interns have no fixed default — set per resident in the roster.
export function defaultDidactics(role, kind) {
  const TUE = 2, WED = 3, THU = 4;   // JS getDay(): Sun=0
  let dow = null;
  if (role === 'senior') dow = TUE;
  else if (kind === 'psych') dow = TUE;
  else if (kind === 'TY') dow = WED;
  else if (kind === 'categorical') dow = THU;
  return dow === null ? null : { dow, half: 'PM', hard: false };
}

// Bump ONLY when the solver's or auditor's SEMANTICS change (a new/removed/reweighted rule) —
// not for UI, packaging, or bug fixes with no effect on what an optimal schedule looks like.
// solve() stamps every schedule it produces with this. A saved solution carrying a different stamp
// is not used to anchor re-solve stability, so a scenario file built under older rules re-solves to
// the NEW optimum without being cleared and re-typed first.
export const RULES_VERSION = '0.6.0';

export function parseScenario(json) {
  for (const k of ['team', 'month', 'anchorType', 'residents'])
    if (json[k] == null) throw new Error(`scenario missing ${k}`);
  return normalize({
    carryIn: null, pins: [], notes: [], attendingPagerDays: [], lastSolution: null,
    ...json,
    options: { offQuota: 4, goldenWeekend: false, ...(json.options ?? {}) },
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
  for (const r of s.residents) {
    r.commitments = (r.commitments ?? []).filter(c => c && inMonth(c.date));
    r.pto = [...new Set((r.pto ?? []).filter(inMonth))].sort();
  }
  if (s.carryIn && !names.has(s.carryIn.nightPerson)) s.carryIn = null;

  // A solution only counts as this month's if it covers every date and names only current people.
  const days = s.lastSolution?.days;
  const covers = days && monthDates(s.month).every(d => days[d])
    && Object.keys(days).every(inMonth)
    && Object.keys(s.lastSolution.totals ?? {}).every(n => names.has(n));
  if (!covers) s.lastSolution = null;
  return s;
}

// True when the saved schedule was produced by the rules currently compiled in. Only then may it
// anchor the re-solve stability term; otherwise the old answer would pin the new rules in place.
export function solutionIsCurrent(scenario) {
  return scenario.lastSolution?.rulesVersion === RULES_VERSION;
}
