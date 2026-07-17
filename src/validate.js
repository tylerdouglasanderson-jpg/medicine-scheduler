import { deriveCycle, onService, monthDates } from './model.js';

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
    if (['dayCall', 'nightCall'].includes(p.type) && t !== 'call')
      err('CONTRADICTORY_PINS', p.person, p.date, `${p.type} pin on a non-call day (${p.date})`);
  }

  // pairwise pin contradictions (same date)
  for (let i = 0; i < scenario.pins.length; i++) for (let j = i + 1; j < scenario.pins.length; j++) {
    const a = scenario.pins[i], b = scenario.pins[j];
    if (a.date !== b.date) continue;
    if (a.person === b.person) {
      if (CONFLICTS.some(([x, ys]) =>
        (a.type === x && ys.includes(b.type)) || (b.type === x && ys.includes(a.type))))
        err('CONTRADICTORY_PINS', a.person, a.date, `${a.person} has contradictory ${a.type} + ${b.type} pins on ${a.date}`);
    } else if (a.type === b.type && ['nightCall', 'pager'].includes(a.type)) {
      err('CONTRADICTORY_PINS', a.person, a.date, `${a.person} and ${b.person} both pinned ${a.type} on ${a.date}`);
    }
  }

  if (scenario.anchorType === 'postcall' && !scenario.carryIn)
    err('CARRYIN_REQUIRED', null, dates[0], 'Anchor is post-call: carry-in (night person + day-call intern/senior) is required');

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
