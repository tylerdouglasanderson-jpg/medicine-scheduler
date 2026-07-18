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

export function parseScenario(json) {
  for (const k of ['team', 'month', 'anchorType', 'residents'])
    if (json[k] == null) throw new Error(`scenario missing ${k}`);
  return {
    carryIn: null, pins: [], notes: [], lastSolution: null,
    ...json,
    options: { offQuota: 4, goldenWeekend: false, ...(json.options ?? {}) },
    residents: json.residents.map(r => ({ didactics: null, commitments: [], pto: [], ...r })),
  };
}
