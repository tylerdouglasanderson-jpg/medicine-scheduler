import { monthDates, deriveCycle } from '../model.js';

// Team call-cycle shorthand shown top-right in each day box, so you can see what the team is doing that day.
const TYPE_TAG = {
  precall: ['PRE-C', 'Pre-call day'], call: ['CALL', 'Call day'], postcall: ['PC', 'Post-call day'],
  ppc: ['PPC', 'Post-post-call day'], sc1: ['SC1', 'Senior clinic day 1'], sc2: ['SC2', 'Senior clinic day 2'],
};

const MODES = [
  ['commitment-AM', 'Commitment (AM)', 'A clinic/obligation that occupies this half-day (AM).'],
  ['commitment-PM', 'Commitment (PM)', 'A clinic/obligation that occupies this half-day (PM).'],
  ['didactics', 'Didactics (PM)', 'Transitional interns only: click each Wednesday that has didactics (they have it every other week).'],
  ['single', '1 person OK', 'Day-level, not tied to one resident: the solver may leave just one person working this day. Optionally name who, in the list below the mode buttons.'],
  ['pto', 'PTO', 'Vacation day — this resident is off and unavailable to schedule.'],
  ['offCounted', 'Pin: off (counted)', 'Force this assignment: an off day that counts toward their quota.'],
  ['work', 'Pin: must work', 'Force this assignment: this resident must work (not off) this day.'],
  ['pager', 'Pin: pager', 'Force this assignment: this resident carries the pager this day.'],
  ['dayCall', 'Pin: day call', 'Force this assignment: this resident takes day call this day.'],
  ['nightCall', 'Pin: night call', 'Force this assignment: this resident takes night call this day.'],
  ['halfOff-AM', 'Pin: half off (AM)', 'Force this assignment: half-day off (AM) for this resident.'],
  ['halfOff-PM', 'Pin: half off (PM)', 'Force this assignment: half-day off (PM) for this resident.'],
];

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const dowOf =date => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };

let currentMode = 'pto';   // ephemeral UI state — not scenario data, doesn't need to persist across reloads

function patchResident(scenario, i, patch) {
  const residents = scenario.residents.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
  return { ...scenario, residents };
}

function applyMode(scenario, onChange, i, date) {
  const r = scenario.residents[i];

  if (currentMode === 'single') {
    const days = scenario.singleDays ?? [];
    const next = days.some(x => x.date === date) ? days.filter(x => x.date !== date)
      : [...days, { date, person: '' }].sort((a, b) => a.date.localeCompare(b.date));
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
    const label = prompt(`Commitment label for ${r.name} on ${date} (${half})?`, 'clinic');
    if (!label) return;
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

function chip(text, cls, onRemove) {
  const span = document.createElement('span');
  span.className = `chip chip-${cls}`;
  span.textContent = text;
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'chip-remove';
  x.textContent = '×';
  x.addEventListener('click', e => { e.stopPropagation(); onRemove(); });
  span.appendChild(x);
  return span;
}

// The "1 person OK" dates as a list: pick who works alone (or leave it to the solver), or remove the date.
function singleDaysList(scenario, onChange) {
  const days = scenario.singleDays ?? [];
  const box = document.createElement('div');
  box.className = 'single-days';
  const h = document.createElement('h3');
  h.textContent = 'Days where one person is enough';
  box.appendChild(h);
  const help = document.createElement('p');
  help.className = 'panel-help';
  help.textContent = 'Pick the \u201c1 person OK\u201d mode and click a date to add it. The solver may then leave just one person '
    + 'working that day (normally at least 2 are required). Name who, or leave it to the solver, which prefers a senior. '
    + 'Use it only when the day truly can run with one person.';
  box.appendChild(help);
  if (!days.length) {
    const none = document.createElement('p');
    none.className = 'empty-state';
    none.textContent = 'None picked.';
    box.appendChild(none);
    return box;
  }
  const set = next => onChange({ ...scenario, singleDays: next });
  for (const x of days) {
    const row = document.createElement('div');
    row.className = 'single-day-row';
    const label = document.createElement('span');
    label.textContent = `${DOW_LABELS[dowOf(x.date)]} ${x.date}`;
    const sel = document.createElement('select');
    sel.title = 'Who works alone this day. Solver chooses leaves it open and prefers a senior.';
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
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'btn-ghost'; rm.textContent = 'Remove'; rm.title = 'Remove this date';
    rm.addEventListener('click', () => set(days.filter(y => y !== x)));
    row.append(label, sel, rm);
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

      if ((scenario.singleDays ?? []).some(x => x.date === date))
        cell.appendChild(chip('1 person OK', 'single', () =>
          onChange({ ...scenario, singleDays: scenario.singleDays.filter(x => x.date !== date) })));

      if (r.pto.includes(date))
        cell.appendChild(chip('PTO', 'pto', () =>
          onChange(patchResident(scenario, i, { pto: r.pto.filter(d => d !== date) }))));

      for (const c of r.commitments.filter(c => c.date === date))
        cell.appendChild(chip(`${c.label} (${c.half})`, 'commitment', () =>
          onChange(patchResident(scenario, i, { commitments: r.commitments.filter(x => x !== c) }))));

      for (const p of scenario.pins.filter(p => p.person === r.name && p.date === date))
        cell.appendChild(chip(`pin:${p.type}${p.half ? ' ' + p.half : ''}`, 'pin', () =>
          onChange({ ...scenario, pins: scenario.pins.filter(x => x !== p) })));

      if (r.didactics?.alt) {
        if ((r.didactics.dates ?? []).includes(date))
          cell.appendChild(chip(`didactics ${r.didactics.half}`, 'chip-didactics', () =>
            onChange(patchResident(scenario, i, { didactics: { ...r.didactics,
              dates: r.didactics.dates.filter(d => d !== date) } }))));
      } else if (r.didactics && dowOf(date) === r.didactics.dow)
        cell.appendChild(staticTag(`didactics ${r.didactics.half}`, 'chip-didactics',
          `Weekly didactics: ${DOW_LABELS[r.didactics.dow]} ${r.didactics.half}` +
          `${r.didactics.hard ? ' — protected (they skip pager here when free)' : ' — soft preference'}`));

      cell.addEventListener('click', () => applyMode(scenario, onChange, i, date));
      grid.appendChild(cell);
    }
    block.appendChild(grid);
    container.appendChild(block);
  });
}
