// Per-day cell text shared by the xlsx export (export.js) and the phone view (phone.js), so the two can never
// disagree: both ask THIS module what a day's ROUNDERS / PAGER / CLINIC / DIDACTICS / PTO / OFF cell says.
// Pure functions of (scenario, schedule); no DOM, no ExcelJS.
import { didacticsOn, onService } from './model.js';

export const TYPE_LABEL = { precall: 'PRECALL', call: 'CALL', postcall: 'PC', ppc: 'PPC', sc1: 'SC1', sc2: 'SC2' };

export function halfOffPins(scenario, person, date) {
  return (scenario.pins ?? []).filter(p => p.type === 'halfOff' && p.person === person && p.date === date);
}
// AM and PM both pinned the same day: one line, tagged so the Perks formula can count the second half.
export const BOTH_HALVES = ' (AM+PM)';
export function halfOffTag(scenario, person, date) {
  const halves = new Set(halfOffPins(scenario, person, date).map(p => p.half ?? 'PM'));
  return halves.size === 0 ? '' : ` - 1/2 off${halves.size > 1 ? BOTH_HALVES : ''}`;
}
export function isBonusOff(scenario, person, date) {
  return (scenario.pins ?? []).some(p => p.type === 'offFree' && p.person === person && p.date === date)
    || (scenario.singleDays ?? []).some(x => x.date === date);
}
function rounderLines(date, type, dd, scenario) {
  const lines = [];
  if (type === 'call') {
    for (const n of dd.working.filter(n => n !== dd.night)) lines.push(`Day - ${n}`);
    if (dd.night) lines.push(`Night - ${dd.night}`);
    else if (scenario.options?.twoPersonNights === 'days') lines.push('Night - cross-cover');
  } else if (type === 'postcall') {
    for (const n of dd.working) lines.push(`${n} (postcall)`);
  } else {
    for (const n of dd.working) lines.push(`${n}${halfOffTag(scenario, n, date)}`);
  }
  for (const note of scenario.notes ?? []) if (note.date === date) lines.push(note.text);
  return lines;
}
// v1.1.0: the CLINIC row also carries non-clinic commitments (ITE, …). Any label that doesn't start with
// "clinic" is named inline with its own label — "Smith (ITE)", "Smith (Conference)" — the same way DIDACTICS
// tags "(pager)". No new row. A blank label reads "(other commitment)".
function clinicLabel(r, date) {
  const cs = (r.commitments ?? []).filter(c => c.date === date);
  const name = c => (c.label ?? '').trim() || 'other commitment';
  const other = [...new Set(cs.map(name).filter(l => !/^clinic/i.test(l)))];
  if (!other.length) return r.name;
  const hasClinic = cs.some(c => /^clinic/i.test(name(c)));
  return `${r.name} (${hasClinic ? 'clinic + ' : ''}${other.join(', ')})`;
}
function clinicNames(scenario, date) {
  return scenario.residents.filter(r => (r.commitments ?? []).some(c => c.date === date)).map(r => clinicLabel(r, date));
}
export function ptoNames(scenario, date) {
  return scenario.residents.filter(r => (r.pto ?? []).includes(date)).map(r => r.name);
}
function offNames(scenario, dd, date) {
  return dd.off.map(n => (isBonusOff(scenario, n, date) ? `${n} (bonus)` : n));
}
// The pager holder still goes to didactics and steps out if something happens (program rule, 2026-08),
// so they stay on this row, tagged. Off / post-call sleep / PTO genuinely lose the half-day.
function didacticsNames(scenario, schedule, date, type) {
  if (type === 'call' || type === 'postcall') return [];   // nobody attends on those days
  const dd = schedule.days[date];
  return scenario.residents
    .filter(r => didacticsOn(r, date) && onService(r, date))
    .filter(r => !(dd.off.includes(r.name) || (r.pto ?? []).includes(date)))
    .filter(r => !(scenario.pins ?? []).some(p => p.type === 'halfOff' && p.person === r.name
      && p.date === date && p.half === (r.didactics.half ?? 'PM')))
    .map(r => (dd.pager === r.name ? `${r.name} (pager)` : r.name));
}

export function cellText(row, date, type, dd, scenario, schedule) {
  switch (row) {
    case 'DATE': return String(Number(date.slice(8)));
    case 'TYPE': return TYPE_LABEL[type];
    case 'ROUNDERS': return rounderLines(date, type, dd, scenario).join('\n');
    case 'PAGER': return type === 'call' ? '—' : (dd.pager ?? '—');
    case 'CLINIC': return clinicNames(scenario, date).join(', ');
    case 'DIDACTICS': return didacticsNames(scenario, schedule, date, type).join(', ');
    case 'PTO': return ptoNames(scenario, date).join(', ');
    case 'OFF': return offNames(scenario, dd, date).join(', ');
    default: return '';
  }
}

