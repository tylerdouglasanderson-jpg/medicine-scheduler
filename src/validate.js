import { deriveCycle, onService, monthDates } from './model.js';
import { wholeMonth2S1I } from './milp.js';

const OFFISH = ['offCounted', 'offFree', 'halfOff'];
const CONFLICTS = [['work', OFFISH], ['pager', ['offCounted', 'offFree']], ['dayCall', ['nightCall']]];

export function validate(scenario) {
  const errors = [];
  const err = (code, person, date, message) => errors.push({ code, person, date, message });
  const { types, callDays } = deriveCycle(scenario.anchorType, scenario.month);
  const dates = monthDates(scenario.month);
  const byName = Object.fromEntries(scenario.residents.map(r => [r.name, r]));

  for (const r of scenario.residents) {
    for (const c of r.commitments)
      if (onService(r, c.date) && ['call', 'postcall'].includes(types.get(c.date)))
        err('COMMITMENT_ON_CALL', r.name, c.date,
          `${r.name} has ${c.label || 'a commitment'} on a ${types.get(c.date)} day (${c.date}) — remedy with administration`);
    for (const d of r.pto)
      if (onService(r, d) && ['call', 'postcall'].includes(types.get(d)))
        err('PTO_ON_CALL', r.name, d, `${r.name} has PTO on a ${types.get(d)} day (${d})`);
  }

  for (const p of scenario.pins) {
    const r = byName[p.person];
    if (!r || !dates.includes(p.date) || !onService(r, p.date)) {
      err('PIN_OUTSIDE_WINDOW', p.person, p.date, `Pin for ${p.person} on ${p.date} is outside their service window`);
      continue;
    }
    const t = types.get(p.date);
    if (p.type === 'nightCall' && r.commitments.some(c => c.date === p.date && c.half === 'PM'))
      err('NIGHT_PIN_PM_COMMITMENT', p.person, p.date, `${p.person} pinned to night call on ${p.date} but has a PM commitment that day`);
    if (p.type === 'pager' && t === 'call')
      err('CONTRADICTORY_PINS', p.person, p.date, `No pager holder exists on call days (${p.date})`);
    if (OFFISH.includes(p.type) && ['call', 'postcall'].includes(t))
      err('CONTRADICTORY_PINS', p.person, p.date, `Off pin on a ${t} day (${p.date})`);
    if (['offCounted', 'offFree'].includes(p.type) && r.commitments.some(c => c.date === p.date))
      err('OFF_ON_COMMITMENT', p.person, p.date, `${p.person} is pinned off on ${p.date} but has a commitment (clinic) that day — an off day must be free`);
    // A half day off may not overlap the obligation it would excuse (Astra review 2026-10-06).
    if (p.type === 'halfOff') {
      const c = r.commitments.find(c => c.date === p.date && c.half === p.half);
      if (c) {
        const what = c.label || 'clinic';
        err('HALFOFF_ON_COMMITMENT', p.person, p.date,
          `${p.person} has a ${what} that ${p.half === 'AM' ? 'morning' : 'afternoon'} — remove the half-day off or the ${what} (${p.date})`);
      }
    }
    if (['dayCall', 'nightCall'].includes(p.type) && t !== 'call')
      err('CONTRADICTORY_PINS', p.person, p.date, `${p.type} pin on a non-call day (${p.date})`);
  }

  // pairwise pin contradictions (same date)
  for (let i = 0; i < scenario.pins.length; i++) for (let j = i + 1; j < scenario.pins.length; j++) {
    const a = scenario.pins[i], b = scenario.pins[j];
    if (a.date !== b.date) continue;
    if (a.person === b.person) {
      const pmHalfOffPager = [a, b].some(x => x.type === 'pager') && [a, b].some(x => x.type === 'halfOff' && x.half === 'PM');
      if (pmHalfOffPager || CONFLICTS.some(([x, ys]) =>
        (a.type === x && ys.includes(b.type)) || (b.type === x && ys.includes(a.type))))
        err('CONTRADICTORY_PINS', a.person, a.date, `${a.person} has contradictory ${a.type} + ${b.type} pins on ${a.date}`);
    } else if (a.type === b.type && ['nightCall', 'pager'].includes(a.type)) {
      err('CONTRADICTORY_PINS', a.person, a.date, `${a.person} and ${b.person} both pinned ${a.type} on ${a.date}`);
    }
  }

  for (const d of scenario.attendingPagerDays ?? []) {
    if (!dates.includes(d))
      err('ATTENDING_DAY_OUTSIDE_MONTH', null, d, `The attending is set to cover the pager on ${d}, which is not in this month`);
    else if (['call', 'postcall'].includes(types.get(d)))
      err('ATTENDING_DAY_INVALID', null, d,
        `The attending cannot cover the pager on a ${types.get(d)} day (${d}) — ${types.get(d) === 'call' ? 'no pager holder exists' : 'the post-call pager is fixed by the prior night'}`);
  }

  if (scenario.anchorType === 'postcall' && !scenario.carryIn)
    err('CARRYIN_REQUIRED', null, dates[0], 'Anchor is post-call: carry-in (night person + day-call intern/senior) is required');

  // The off quota is hard, so an impossible one is an input error, not an infeasible solve.
  // Eligible off day = on service, no PTO, not call/post-call, no commitment that day.
  for (const r of scenario.residents) {
    const svc = dates.filter(d => onService(r, d));
    if (!svc.length) continue;
    const quota = Math.floor(scenario.options.offQuota * svc.length / dates.length + 0.5);
    const eligible = svc.filter(d =>
      !r.pto.includes(d) && !['call', 'postcall'].includes(types.get(d))
      && !r.commitments.some(c => c.date === d)).length;
    if (eligible < quota)   // half days off are freebies: no quota credit
      err('QUOTA_IMPOSSIBLE', r.name, null,
        `${r.name} needs ${quota} days off but only has ${eligible} eligible day(s) — every other day is call, post-call, PTO, or a commitment. Free up a day or lower the off quota.`);
  }

  // Whole-month 2S+1I: the intern takes EXACTLY every other call night (chief resident 2026-10-06).
  // Night/day-call pins that force a different pattern can't be scheduled — say which, up front.
  const alt = wholeMonth2S1I(scenario);
  if (alt) {
    const I = alt.intern.name;
    const crew = [I, ...alt.seniors.map(s => s.name)];
    const involved = [];
    const must = [], never = [];                       // per call index: the intern must / can't take it
    alt.callDays.forEach((c, j) => {
      let can = crew;
      for (const p of scenario.pins.filter(x => x.date === c && crew.includes(x.person))) {
        if (p.type === 'nightCall') { can = can.filter(n => n === p.person); involved.push(p); }
        if (p.type === 'dayCall') { can = can.filter(n => n !== p.person); involved.push(p); }
      }
      if (can.length === 1 && can[0] === I) must.push(j);
      if (can.length && !can.includes(I)) never.push(j);
    });
    const fits = q => must.every(j => j % 2 === q) && never.every(j => j % 2 !== q);
    const options = alt.parity === null ? [0, 1] : [alt.parity];
    if (!options.some(fits)) {
      const pattern = q => alt.callDays.filter((_, j) => j % 2 === q).join(', ');
      const allowed = options.map(pattern).map(x => `[${x}]`).join(' or ');
      const carryNote = scenario.anchorType === 'postcall' && scenario.carryIn?.nightPerson
        ? (scenario.carryIn.nightPerson === I
          ? ` ${I} came in post-call from last month's last night, so cannot take the first call night.`
          : ` A senior took last month's last night, so ${I} takes the first call night.`)
        : '';
      const pins = involved.map(p => `${p.type} ${p.person} ${p.date}`).join('; ');
      err('NIGHT_ALTERNATION_IMPOSSIBLE', I, null,
        `With two seniors and one intern all month, ${I} takes every other call night — never two in a row, and the seniors never two in a row either — so ${I}'s nights must be ${allowed}.${carryNote} These pins can't all hold: ${pins}. Remove or change one of them.`);
    }
  }

  for (const c of callDays) {
    const on = scenario.residents.filter(r => onService(r, c));
    const seniors = on.filter(r => r.role === 'senior').length;
    const medC = scenario.team === 'C' && seniors === on.length && seniors >= 2;
    if (on.length < 2 || (seniors === 0 && !medC))
      err('DEGENERATE_COMPOSITION', null, c,
        `Unsupported composition on call day ${c}: ${seniors} senior(s), ${on.length - seniors} intern(s)`);
  }
  return errors;
}
