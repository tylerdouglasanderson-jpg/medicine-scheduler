import { monthDates, deriveCycle } from '../model.js';

// Team call-cycle shorthand shown top-right in each day box, so you can see what the team is doing that day.
const TYPE_TAG = {
  precall: ['PRE-C', 'Pre-call day'], call: ['CALL', 'Call day'], postcall: ['PC', 'Post-call day'],
  ppc: ['PPC', 'Post-post-call day'], sc1: ['SC1', 'Senior clinic day 1'], sc2: ['SC2', 'Senior clinic day 2'],
};

// [id, button label, tooltip]. Labels are Title Case; PIN modes start "PIN:".
const MODES = [
  ['commitment-AM', 'Commitment AM', 'A clinic or other obligation (ITE, conference) that takes this resident’s MORNING. Click a day, type a label (it remembers your last one, starting with “clinic”), and click the same day again to remove it. A day with a commitment can never be given as a day off, and a PM commitment also keeps them off the afternoon pager.'],
  ['commitment-PM', 'Commitment PM', 'A clinic or other obligation that takes this resident’s AFTERNOON. Click a day, type a label (it remembers your last one, starting with “clinic”), and click the same day again to remove it. They will not be given that day off or the afternoon pager.'],
  ['didactics', 'Didactics (PM)', 'Transitional interns only: click each Wednesday they have didactics (it is every other week, and the weeks change each month). Clicks on other residents or other weekdays do nothing. Click a picked day again to remove it.'],
  ['single', 'Force One Person Only', 'Click a date to make EXACTLY ONE resident work that day (it is a whole-team setting, so any resident’s calendar works). Everyone else who is free gets a bonus day off that does NOT count toward their 4. Name who works alone in the list below, or leave it to the solver. Not allowed on call days; impossible if two or more people have clinic or must-work pins that day. Click again to remove, or switch it to Two People.'],
  ['double', 'Force Two People Only', 'Click a date to make EXACTLY TWO residents work that day (a whole-team setting). Anyone beyond two who is free gets a bonus day off that does NOT count toward their 4. Not allowed on call days; impossible if three or more people have clinic or must-work pins that day. Click again to remove, or switch it to One Person.'],
  ['pto', 'PTO Day', 'Vacation for this resident. They are not scheduled that day and it does not count as one of their days off. Click again to remove. PTO on a call or post-call day is flagged as an error.'],
  ['offCounted', 'PIN:OFF DAY', 'Forces this resident to have this day off, and it counts toward their normal 4 days off. Not allowed if they have a clinic or other commitment that day, or on a call or post-call day. Click again to remove.'],
  ['work', 'PIN:Must Work', 'Forces this resident to work this day, so the solver cannot give them a day off there. Use it for a day they must cover. Contradicts any off pin on the same day. Click again to remove.'],
  ['pager', 'PIN:Pager', 'Forces this resident to carry the pager this day. Not allowed on call days (no pager then), or if they are also pinned off or have a PM clinic. Click again to remove.'],
  ['dayCall', 'PIN:Day', 'On a CALL day, makes this resident the day-call person (so not the night person). Only works on call days. Click again to remove.'],
  ['nightCall', 'PIN:Night', 'On a CALL day, makes this resident the night person. Only works on call days, and not if they have a PM clinic that day. Click again to remove.'],
  ['halfOff-AM', 'PIN:Half Off AM', 'Gives this resident a free half day off in the MORNING; they work the afternoon. It never counts toward their 4 days off. Not allowed over a morning clinic. If it lands on their didactics half they miss that session. Click again to remove.'],
  ['halfOff-PM', 'PIN:Half Off PM', 'Gives this resident a free half day off in the AFTERNOON; they work the morning. It never counts toward their 4 days off. Not allowed over an afternoon clinic or if they are the afternoon pager. If it lands on their didactics half they miss that session. Click again to remove.'],
];

// Chip text for each pin type (the stored type names are internal).
const PIN_CHIP = {
  offCounted: 'PIN:OFF DAY', work: 'PIN:Must Work', pager: 'PIN:Pager', dayCall: 'PIN:Day', nightCall: 'PIN:Night',
  halfOff: 'PIN:Half Off', offFree: 'PIN:Bonus Day Off',
};

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const dowOf =date => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };

let lastCommitmentLabel = 'clinic';   // the commitment prompt starts from whatever was typed last (shared by AM and PM)
let currentMode = 'pto';   // ephemeral UI state — not scenario data, doesn't need to persist across reloads

function patchResident(scenario, i, patch) {
  const residents = scenario.residents.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
  return { ...scenario, residents };
}

function applyMode(scenario, onChange, i, date) {
  const r = scenario.residents[i];

  if (currentMode === 'single' || currentMode === 'double') {
    // Same click = remove; the other Force mode = switch the count. No dialog either way.
    const count = currentMode === 'single' ? 1 : 2;
    const days = scenario.singleDays ?? [];
    const have = days.find(x => x.date === date);
    const next = have && have.count === count ? days.filter(x => x.date !== date)
      : [...days.filter(x => x.date !== date), { date, count, person: '' }].sort((a, b) => a.date.localeCompare(b.date));
    onChange({ ...scenario, singleDays: next });
    return;
  }

  if (currentMode === 'pto') {
    const pto = r.pto.includes(date) ? r.pto.filter(d => d !== date) : [...r.pto, date];
    onChange(patchResident(scenario, i, { pto }));
    return;
  }
  if (currentMode === 'didactics') {
    // Only a Transitional (every-other-Wednesday) intern has picked dates, and only Wednesdays can be picked.
    if (!r.didactics?.alt || dowOf(date) !== r.didactics.dow) return;
    const dates = r.didactics.dates ?? [];
    const next = dates.includes(date) ? dates.filter(d => d !== date) : [...dates, date].sort();
    onChange(patchResident(scenario, i, { didactics: { ...r.didactics, dates: next } }));
    return;
  }
  if (currentMode === 'commitment-AM' || currentMode === 'commitment-PM') {
    const half = currentMode.endsWith('AM') ? 'AM' : 'PM';
    const existing = r.commitments.find(c => c.date === date && c.half === half);
    if (existing) {
      onChange(patchResident(scenario, i, { commitments: r.commitments.filter(c => c !== existing) }));
      return;
    }
    const label = prompt(`Commitment label for ${r.name} on ${date} (${half})?`, lastCommitmentLabel);
    if (!label) return;
    lastCommitmentLabel = label;
    onChange(patchResident(scenario, i, { commitments: [...r.commitments, { date, half, label }] }));
    return;
  }
  // pin modes: offCounted / offFree / work / pager / dayCall / nightCall / halfOff-AM / halfOff-PM
  const isHalfOff = currentMode.startsWith('halfOff');
  const type = isHalfOff ? 'halfOff' : currentMode;
  const half = isHalfOff ? (currentMode.endsWith('AM') ? 'AM' : 'PM') : null;
  const existing = scenario.pins.find(p => p.person === r.name && p.date === date && p.type === type && p.half === half);
  const pins = existing
    ? scenario.pins.filter(p => p !== existing)
    : [...scenario.pins, { person: r.name, date, type, half, note: '' }];
  onChange({ ...scenario, pins });
}

// A derived, non-removable marker (didactics is a weekly roster rule, not per-date data).
function staticTag(text, cls, title) {
  const span = document.createElement('span');
  span.className = `chip ${cls}`;
  span.textContent = text;
  if (title) span.title = title;
  return span;
}

function chip(text, cls, onRemove, title) {
  const span = document.createElement('span');
  if (title) span.title = title;
  span.className = `chip chip-${cls}`;
  span.textContent = text;
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'chip-remove';
  x.textContent = '×';
  x.title = 'Remove this marker.';
  x.setAttribute('aria-label', 'Remove');
  x.addEventListener('click', e => { e.stopPropagation(); onRemove(); });
  span.appendChild(x);
  return span;
}

// Forced-staffing dates as a list (only shown when there are some): name who works alone, or remove the date.
function singleDaysList(scenario, onChange) {
  const days = scenario.singleDays ?? [];
  const box = document.createElement('div');
  box.className = 'single-days';
  if (!days.length) return box;
  const h = document.createElement('h3');
  h.textContent = 'Forced Staffing Days';
  box.appendChild(h);
  const set = next => onChange({ ...scenario, singleDays: next });
  for (const x of days) {
    const count = x.count === 2 ? 2 : 1;
    const row = document.createElement('div');
    row.className = 'single-day-row';
    const label = document.createElement('span');
    label.textContent = `${DOW_LABELS[dowOf(x.date)]} ${x.date} — ${count === 1 ? 'Only 1 Works' : 'Only 2 Work'}`;
    row.appendChild(label);
    if (count === 1) {
      const sel = document.createElement('select');
      sel.title = 'Who works alone this day. “Solver chooses” leaves it open (it prefers a senior when it can). Naming someone makes them a must-work for that day, and everyone else free gets a bonus day off.';
      sel.setAttribute('aria-label', `Who works alone on ${x.date}`);
      const open = document.createElement('option');
      open.value = ''; open.textContent = 'Solver chooses';
      sel.appendChild(open);
      for (const r of scenario.residents) {
        const o = document.createElement('option');
        o.value = r.name; o.textContent = r.name;
        sel.appendChild(o);
      }
      sel.value = x.person;
      sel.addEventListener('change', () => set(days.map(y => (y === x ? { ...y, person: sel.value } : y))));
      row.appendChild(sel);
    }
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'btn-ghost'; rm.textContent = 'Remove';
    rm.title = 'Remove this forced day. Normal staffing (at least two working) applies again.';
    rm.addEventListener('click', () => set(days.filter(y => y !== x)));
    row.appendChild(rm);
    box.appendChild(row);
  }
  return box;
}

export function render(container, scenario, onChange) {
  container.innerHTML = '';
  const h = document.createElement('h2');
  h.textContent = 'Commitments / PTO / Pins';
  container.appendChild(h);
  const help = document.createElement('p');
  help.className = 'panel-help';
  help.textContent = 'Pick a mode, then click a day on a resident’s calendar below to apply it.';
  container.appendChild(help);

  const modeRow = document.createElement('div');
  modeRow.className = 'chip-mode-picker';
  for (const [value, label, title] of MODES) {
    const id = `mode-${value}`;
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'chip-mode';
    radio.id = id;
    radio.value = value;
    radio.title = title;
    radio.checked = value === currentMode;
    radio.addEventListener('change', () => { currentMode = value; });
    const lbl = document.createElement('label');
    lbl.htmlFor = id;
    lbl.title = title;
    lbl.textContent = label;
    modeRow.appendChild(radio);
    modeRow.appendChild(lbl);
  }
  container.appendChild(modeRow);

  container.appendChild(singleDaysList(scenario, onChange));

  const dates = monthDates(scenario.month);
  let cycleTypes = null;
  try { cycleTypes = deriveCycle(scenario.anchorType, scenario.month).types; } catch { /* no anchor yet: no tags */ }
  let firstDow = 0;
  if (dates.length) {
    const [y, m] = scenario.month.split('-').map(Number);
    firstDow = new Date(y, m - 1, 1).getDay();
  }

  scenario.residents.forEach((r, i) => {
    const block = document.createElement('div');
    block.className = 'chip-calendar';
    const name = document.createElement('h3');
    name.textContent = r.name;
    block.appendChild(name);

    const dowHead = document.createElement('div');
    dowHead.className = 'chip-grid chip-grid-header';
    for (const label of DOW_FULL) {
      const cell = document.createElement('div');
      cell.textContent = label;
      dowHead.appendChild(cell);
    }
    block.appendChild(dowHead);

    const grid = document.createElement('div');
    grid.className = 'chip-grid';
    for (let b = 0; b < firstDow; b++) {
      const blank = document.createElement('div');
      blank.className = 'chip-day blank';
      grid.appendChild(blank);
    }
    for (const date of dates) {
      const cell = document.createElement('div');
      cell.className = 'chip-day';
      cell.dataset.date = date;

      const dayNum = document.createElement('span');
      dayNum.className = 'day-num';
      dayNum.textContent = date.slice(-2);
      cell.appendChild(dayNum);
      const tag = TYPE_TAG[cycleTypes?.get(date)];
      if (tag) {
        const t = document.createElement('span');
        t.className = 'day-type';
        t.textContent = tag[0];
        t.title = tag[1];
        cell.appendChild(t);
      }

      const forced = (scenario.singleDays ?? []).find(x => x.date === date);
      if (forced)
        cell.appendChild(chip(forced.count === 2 ? 'ONLY 2 WORK' : 'ONLY 1 WORKS', 'single', () =>
          onChange({ ...scenario, singleDays: scenario.singleDays.filter(x => x.date !== date) }),
          `Forced staffing: exactly ${forced.count === 2 ? 'two people work' : 'one person works'} this day, for the whole team. Everyone else free gets a bonus day off outside their 4. The × removes it for everyone.`));

      if (r.pto.includes(date))
        cell.appendChild(chip('PTO', 'pto', () =>
          onChange(patchResident(scenario, i, { pto: r.pto.filter(d => d !== date) })),
          'Vacation for this resident. Not scheduled this day; it does not count as one of their days off.'));

      for (const c of r.commitments.filter(c => c.date === date))
        cell.appendChild(chip(`${c.label} (${c.half})`, 'commitment', () =>
          onChange(patchResident(scenario, i, { commitments: r.commitments.filter(x => x !== c) })),
          `A ${c.half === 'AM' ? 'morning' : 'afternoon'} commitment (${c.label}). This day cannot be a day off for them${c.half === 'PM' ? ', and they cannot hold the afternoon pager' : ''}.`));

      for (const p of scenario.pins.filter(p => p.person === r.name && p.date === date))
        cell.appendChild(chip(`${PIN_CHIP[p.type] ?? p.type}${p.half ? ' ' + p.half : ''}`, 'pin', () =>
          onChange({ ...scenario, pins: scenario.pins.filter(x => x !== p) }),
          'A pinned assignment the solver must honor for this resident on this day. The × removes the pin.'));

      if (r.didactics?.alt) {
        if ((r.didactics.dates ?? []).includes(date))
          cell.appendChild(chip(`didactics ${r.didactics.half}`, 'chip-didactics', () =>
            onChange(patchResident(scenario, i, { didactics: { ...r.didactics,
              dates: r.didactics.dates.filter(d => d !== date) } })),
            'A Wednesday this Transitional intern has didactics. The × removes it.'));
      } else if (r.didactics && dowOf(date) === r.didactics.dow)
        cell.appendChild(staticTag(`didactics ${r.didactics.half}`, 'chip-didactics',
          `Weekly didactics: ${DOW_LABELS[r.didactics.dow]} ${r.didactics.half}` +
          `${r.didactics.hard ? ' — protected (they skip pager here when free)' : ' — soft preference'}`));

      cell.title = `Click to apply the selected mode (${MODES.find(m => m[0] === currentMode)?.[1] ?? ''}) to ${r.name} on this day. Click again to undo.`;
      cell.addEventListener('click', () => applyMode(scenario, onChange, i, date));
      grid.appendChild(cell);
    }
    block.appendChild(grid);
    container.appendChild(block);
  });
}
