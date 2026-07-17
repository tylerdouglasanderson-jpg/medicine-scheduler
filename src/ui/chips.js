import { monthDates } from '../model.js';

const MODES = [
  ['commitment-AM', 'Commitment (AM)', 'A clinic/obligation that occupies this half-day (AM).'],
  ['commitment-PM', 'Commitment (PM)', 'A clinic/obligation that occupies this half-day (PM).'],
  ['pto', 'PTO', 'Vacation day — this resident is off and unavailable to schedule.'],
  ['offCounted', 'Pin: off (counted)', 'Force this assignment: an off day that counts toward their quota.'],
  ['offFree', 'Pin: off (free/bonus)', 'Force this assignment: a bonus off day that does not count toward quota.'],
  ['work', 'Pin: must work', 'Force this assignment: this resident must work (not off) this day.'],
  ['pager', 'Pin: pager', 'Force this assignment: this resident carries the pager this day.'],
  ['dayCall', 'Pin: day call', 'Force this assignment: this resident takes day call this day.'],
  ['nightCall', 'Pin: night call', 'Force this assignment: this resident takes night call this day.'],
  ['halfOff-AM', 'Pin: half off (AM)', 'Force this assignment: half-day off (AM) for this resident.'],
  ['halfOff-PM', 'Pin: half off (PM)', 'Force this assignment: half-day off (PM) for this resident.'],
];

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const dowOf = date => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };

let currentMode = 'pto';   // ephemeral UI state — not scenario data, doesn't need to persist across reloads

function patchResident(scenario, i, patch) {
  const residents = scenario.residents.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
  return { ...scenario, residents };
}

function applyMode(scenario, onChange, i, date) {
  const r = scenario.residents[i];

  if (currentMode === 'pto') {
    const pto = r.pto.includes(date) ? r.pto.filter(d => d !== date) : [...r.pto, date];
    onChange(patchResident(scenario, i, { pto }));
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

  const dates = monthDates(scenario.month);
  let firstDow = 0;
  if (dates.length) {
    const [y, m] = scenario.month.split('-').map(Number);
    firstDow = new Date(y, m - 1, 1).getDay();
  }

  const header = document.createElement('div');
  header.className = 'chip-grid chip-grid-header';
  for (const dow of DOW_LABELS) {
    const cell = document.createElement('div');
    cell.textContent = dow;
    header.appendChild(cell);
  }
  container.appendChild(header);

  scenario.residents.forEach((r, i) => {
    const block = document.createElement('div');
    block.className = 'chip-calendar';
    const name = document.createElement('h3');
    name.textContent = r.name;
    block.appendChild(name);

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

      if (r.pto.includes(date))
        cell.appendChild(chip('PTO', 'pto', () =>
          onChange(patchResident(scenario, i, { pto: r.pto.filter(d => d !== date) }))));

      for (const c of r.commitments.filter(c => c.date === date))
        cell.appendChild(chip(`${c.label} (${c.half})`, 'commitment', () =>
          onChange(patchResident(scenario, i, { commitments: r.commitments.filter(x => x !== c) }))));

      for (const p of scenario.pins.filter(p => p.person === r.name && p.date === date))
        cell.appendChild(chip(`pin:${p.type}${p.half ? ' ' + p.half : ''}`, 'pin', () =>
          onChange({ ...scenario, pins: scenario.pins.filter(x => x !== p) })));

      if (r.didactics && dowOf(date) === r.didactics.dow)
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
