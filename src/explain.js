// "Why is Dr X on this day?" — Tier 1 instant facts for the calendar pin popover. Pure: reads the scenario
// and the solved schedule, never re-solves, never mutates. Eligibility is re-derived from the scenario
// itself, so this file stays independent of the solver side (no imports at all, on purpose; see CLAUDE.md).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NO_DIDACTICS = ['call', 'postcall'];
const HEDGE = 'The solver picks the best balance across the whole month rather than one day at a time.';

const pretty = d => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
const dow = d => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).getDay(); };
const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const one = n => (Math.round(n * 10) / 10).toFixed(1);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const list = xs => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

export function explainCell(scenario, schedule, { date, slot } = {}) {
  const out = { date, slot, assigned: [], pinned: false, eligible: [], blocked: [], counts: [], summary: '' };
  const dd = schedule?.days?.[date];
  const residents = scenario?.residents ?? [];
  if (!dd) {
    out.summary = `There is no solved schedule for ${date ?? 'that day'}, so there is nothing to explain.`;
    return out;
  }

  const pins = scenario.pins ?? [];
  const byName = Object.fromEntries(residents.map(r => [r.name, r]));
  const type = dd.type;
  const onSvc = (r, d) => d >= r.serviceStart && d <= r.serviceEnd;   // ISO strings compare lexically
  const isPto = (r, d) => (r.pto ?? []).includes(d);
  const commits = (r, d) => (r.commitments ?? []).filter(c => c.date === d);
  const pinsOf = (name, d, t) => pins.filter(p => p.person === name && p.date === d && (!t || p.type === t));
  const didOn = (r, d) => !r.didactics || (r.didactics.skip ?? []).includes(d) ? false
    : (r.didactics.extra ?? []).includes(d) ? true
    : r.didactics.alt ? (r.didactics.dates ?? []).includes(d) : r.didactics.weekly !== false && dow(d) === r.didactics.dow;
  const allDates = Object.keys(schedule.days).sort();
  const svcDays = r => allDates.filter(d => onSvc(r, d)).length;
  const active = residents.filter(r => svcDays(r) > 0);
  const totals = schedule.totals ?? {};
  const lastDate = allDates[allDates.length - 1];

  // Window / PTO come first for every slot: nothing else matters if the person is not there.
  const away = r => {
    if (r.serviceStart == null || r.serviceEnd == null) return 'Not on service this month';
    if (date < r.serviceStart) return `Not on service yet (starts ${pretty(r.serviceStart)})`;
    if (date > r.serviceEnd) return `Service ended ${pretty(r.serviceEnd)}`;
    if (isPto(r, date)) return 'On PTO';
    return null;
  };

  const block = (name, reason) => out.blocked.push({ name, reason });
  const allow = (name, why) => out.eligible.push(why ? { name, why } : { name });

  const kind = slot === 'call' ? 'night' : slot;
  let assignedNames = [];
  let pinType = null;     // pin type that would make this assignment a chief's choice

  if (kind === 'off') {
    assignedNames = [...(dd.off ?? [])];
    pinType = ['offCounted', 'offFree'];
    const quotaOf = r => Math.floor((scenario.options?.offQuota ?? 4) * svcDays(r) / (allDates.length || 1) + 0.5);
    for (const r of residents) {
      if (assignedNames.includes(r.name)) continue;
      const gone = away(r);
      if (gone) { block(r.name, gone); continue; }
      if (type === 'call') { block(r.name, dd.night === r.name ? 'Has the night call' : 'Working the call day'); continue; }
      if (type === 'postcall') { block(r.name, dd.sleeper === r.name ? 'Post-call, sleeping' : 'Post-call day (no offs allowed)'); continue; }
      const cs = commits(r, date);
      if (cs.length) { block(r.name, `Has a clinic or commitment (${list([...new Set(cs.map(c => c.half))])})`); continue; }
      if (pinsOf(r.name, date, 'work').length) { block(r.name, 'Pinned to work that day'); continue; }
      if (pinsOf(r.name, date, 'halfOff').length) { block(r.name, 'Has a half day off pinned that day'); continue; }
      if (dd.pager === r.name) { block(r.name, 'Holds the pager that day'); continue; }
      if (r.didactics?.hard && didOn(r, date)) { block(r.name, 'Has protected (hard) didactics that day'); continue; }
      if (!scenario.options?.allowExtraOffs && (totals[r.name]?.off ?? 0) >= quotaOf(r)) {
        block(r.name, `Already has their full ${plural(quotaOf(r), 'day')} off`); continue;
      }
      allow(r.name, 'free that day');
    }
  } else if (kind === 'pager') {
    if (type === 'call') {
      out.summary = `Nobody holds the pager on call days (${pretty(date)} is a call day).`;
      return out;
    }
    assignedNames = dd.pager === 'ATTENDING' ? ['Attending'] : dd.pager ? [dd.pager] : [];
    pinType = ['pager'];
    const holder = dd.pager && dd.pager !== 'ATTENDING' ? byName[dd.pager] : null;
    const pagerPin = pins.find(p => p.type === 'pager' && p.date === date);
    for (const r of residents) {
      if (r.name === dd.pager) continue;
      const gone = away(r);
      if (gone) { block(r.name, gone); continue; }
      if (pagerPin && pagerPin.person !== r.name) { block(r.name, `Pager pinned to ${pagerPin.person}`); continue; }
      if (dd.sleeper === r.name) { block(r.name, 'Post-call, sleeping'); continue; }
      if ((dd.off ?? []).includes(r.name)) { block(r.name, 'Off that day'); continue; }
      if (commits(r, date).some(c => c.half === 'PM')) { block(r.name, 'Has a PM clinic or commitment'); continue; }
      if (pinsOf(r.name, date, 'halfOff').some(p => p.half === 'PM')) { block(r.name, 'Has the afternoon off (pinned)'); continue; }
      if (r.didactics?.hard && didOn(r, date) && !NO_DIDACTICS.includes(type)) { block(r.name, 'Has protected (hard) didactics that day'); continue; }
      if (type === 'postcall' && holder?.role === 'intern' && r.role === 'senior') {
        block(r.name, 'Post-call pager goes to an intern when one can take it'); continue;
      }
      allow(r.name, 'free to take the pager');
    }
  } else if (kind === 'rounders') {
    assignedNames = [...(dd.working ?? [])];
    for (const r of residents) {
      if (assignedNames.includes(r.name)) continue;
      const gone = away(r);
      if (gone) { block(r.name, gone); continue; }
      if (dd.sleeper === r.name) { block(r.name, 'Post-call, sleeping'); continue; }
      if ((dd.off ?? []).includes(r.name)) { block(r.name, 'Off that day'); continue; }
      allow(r.name);
    }
    pinType = ['work'];
  } else if (kind === 'night') {
    if (type !== 'call') {
      out.summary = `${pretty(date)} is not a call day, so there is no night call to explain.`;
      return out;
    }
    assignedNames = dd.night ? [dd.night] : [];
    pinType = ['nightCall'];
    const callDates = allDates.filter(d => schedule.days[d].type === 'call');
    const i = callDates.indexOf(date);
    const prev = i > 0 ? schedule.days[callDates[i - 1]].night : null;
    const next = i < callDates.length - 1 ? schedule.days[callDates[i + 1]].night : null;
    const interns = residents.filter(r => onSvc(r, date) && r.role === 'intern').length;
    const nightPin = pins.find(p => p.type === 'nightCall' && p.date === date);
    for (const r of residents) {
      if (r.name === dd.night) continue;
      const gone = away(r);
      if (gone) { block(r.name, gone); continue; }
      if (nightPin && nightPin.person !== r.name) { block(r.name, `Night pinned to ${nightPin.person}`); continue; }
      if (r.serviceEnd === date && date !== lastDate) { block(r.name, 'Service ends that day, so the post-call day would fall outside it'); continue; }
      if (interns >= 2 && r.role !== 'intern') { block(r.name, 'Interns take the nights when 2 or more are on service'); continue; }
      if (prev === r.name || next === r.name) { block(r.name, 'Has the night on the neighboring call day (no back-to-back nights)'); continue; }
      allow(r.name, 'could have taken the night');
    }
  } else if (kind === 'didactics') {
    for (const r of residents) {
      const gone = away(r);
      if (gone) { block(r.name, gone); continue; }
      if (!r.didactics) { block(r.name, 'Has no didactics scheduled'); continue; }
      if (!didOn(r, date)) { block(r.name, 'Not their didactics day'); continue; }
      if (NO_DIDACTICS.includes(type)) { block(r.name, 'Call or post-call day (no session to attend)'); continue; }
      const half = r.didactics.half ?? 'PM';
      if ((dd.off ?? []).includes(r.name)) { block(r.name, 'Off that day, so the session is missed'); continue; }
      if (pinsOf(r.name, date, 'halfOff').some(p => p.half === half)) { block(r.name, `Has the ${half} off (pinned), so the session is missed`); continue; }
      assignedNames.push(r.name);
    }
  } else {
    out.summary = `Nothing to explain for "${slot}".`;
    return out;
  }

  out.assigned = assignedNames;
  out.pinned = !!pinType && assignedNames.some(n => pinType.some(t => pinsOf(n, date, t).length));

  // Counts: the assigned person's total vs the team average, from the solver's own totals.
  const nightsOf = n => allDates.filter(d => schedule.days[d].night === n).length;
  for (const name of assignedNames) {
    const me = byName[name];
    if (!me) continue;
    let value, others, label;
    if (kind === 'off') {
      value = totals[name]?.off; others = active.map(r => totals[r.name]?.off);
      label = v => `${plural(value, 'off')} this month (team average ${v})`;
    } else if (kind === 'pager') {
      value = totals[name]?.pager; others = active.map(r => totals[r.name]?.pager);
      label = v => `${plural(value, 'pager day')} this month (team average ${v})`;
    } else if (kind === 'rounders') {
      value = totals[name]?.shifts; others = active.map(r => totals[r.name]?.shifts);
      label = v => `${value} shifts worked this month (team average ${v})`;
    } else if (kind === 'night') {
      const mates = active.filter(r => r.role === me.role);
      value = nightsOf(name); others = mates.map(r => nightsOf(r.name));
      label = v => `${plural(value, 'night')} this month (average for ${me.role}s ${v})`;
    } else {
      const t = totals[name];
      value = t?.didactics; others = active.filter(r => r.didactics).map(r => totals[r.name]?.didactics);
      label = v => `${value} of ${t?.didacticsOf ?? '?'} didactics sessions attended (team average ${v})`;
    }
    if (typeof value !== 'number') continue;
    const teamAvg = avg(others.filter(x => typeof x === 'number'));
    out.counts.push({ name, value, teamAvg, label: label(one(teamAvg)) });
  }

  // Summary: facts only. We know who could have taken it and whether the chief pinned it; we do not know
  // why the optimizer preferred one eligible person over another, so we do not claim to.
  const who = list(assignedNames);
  const others = out.eligible.map(e => e.name);
  const bits = [];
  if (kind === 'didactics') {
    bits.push(assignedNames.length ? `${who} attend${assignedNames.length === 1 ? 's' : ''} didactics on ${pretty(date)}.` : `Nobody attends didactics on ${pretty(date)}.`);
  } else if (!assignedNames.length) {
    bits.push(`Nobody is assigned to this slot on ${pretty(date)}.`);
  } else if (out.pinned) {
    bits.push(`${who} ${assignedNames.length === 1 ? 'is' : 'are'} pinned here by the chief, so the solver kept ${assignedNames.length === 1 ? 'it' : 'them'} fixed.`);
  } else if (kind === 'rounders') {
    bits.push(`${who} ${assignedNames.length === 1 ? 'is' : 'are'} on service and not off, on PTO or sleeping post-call.`);
  } else if (others.length) {
    bits.push(`${who} was chosen by the solver. Also eligible: ${list(others)}.`);
  } else {
    bits.push(`${who} was the only person eligible by the rules.`);
  }
  if (kind === 'pager' && dd.pager === 'ATTENDING')
    bits.push((scenario.attendingPagerDays ?? []).includes(date) ? 'The chief handed the attending this afternoon.' : 'The attending holds the pager on this day.');
  if (kind !== 'didactics' && kind !== 'rounders') bits.push(HEDGE);
  else if (kind === 'rounders') bits.push('Who is off or on the pager that day is balanced across the whole month.');
  out.summary = bits.join(' ');
  return out;
}
