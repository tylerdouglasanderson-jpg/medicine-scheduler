import { monthDates, defaultDidactics } from '../model.js';

const ROLES = ['intern', 'senior'];
const KINDS = ['categorical', 'TY', 'psych', 'OBGYN', 'other'];
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function nextDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const n = new Date(y, m - 1, d + 1);
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

function patchResident(scenario, i, patch) {
  const residents = scenario.residents.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
  return { ...scenario, residents };
}

// Changing Role or Kind re-fills that type's default didactics day (keeping any `hard` flag).
// The day/half stay editable per resident afterward.
function patchType(scenario, i, patch) {
  const r = scenario.residents[i];
  const def = defaultDidactics(patch.role ?? r.role, patch.kind ?? r.kind);
  const didactics = def ? { ...def, hard: r.didactics?.hard ?? false } : null;
  return patchResident(scenario, i, { ...patch, didactics });
}

function td(el) {
  const cell = document.createElement('td');
  cell.appendChild(el);
  return cell;
}

function selectCell(options, value, labelFor, onSet, disabled = false, title) {
  const sel = document.createElement('select');
  sel.disabled = disabled;
  if (title) sel.title = title;
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = labelFor ? labelFor(opt) : opt;
    if (opt === value) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => onSet(sel.value));
  return td(sel);
}

export function render(container, scenario, onChange) {
  container.innerHTML = '';
  const h = document.createElement('h2');
  h.textContent = 'Roster';
  container.appendChild(h);
  const help = document.createElement('p');
  help.className = 'panel-help';
  help.textContent = 'Who is on the team this month — role, service window, and weekly didactics. ' +
    'The didactics day is filled in automatically from each resident’s role/kind; change it per resident if needed.';
  container.appendChild(help);

  if (scenario.residents.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No residents yet — add your team, or load the example scenario above.';
    container.appendChild(empty);
  } else {
    const table = document.createElement('table');
    table.className = 'roster-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Name</th><th>Role</th><th>Kind</th><th>Start</th><th>End</th>' +
      '<th>Didactics day</th><th>Half</th><th>Hard</th><th></th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    container.appendChild(table);

    scenario.residents.forEach((r, i) => {
      const tr = document.createElement('tr');

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = r.name;
      nameInput.title = 'This resident’s display name.';
      nameInput.addEventListener('change', () => onChange(patchResident(scenario, i, { name: nameInput.value })));
      tr.appendChild(td(nameInput));

      tr.appendChild(selectCell(ROLES, r.role, null, v => onChange(patchType(scenario, i, { role: v })),
        false, 'Intern vs senior — drives call composition. Seniors default to Tue PM didactics.'));
      tr.appendChild(selectCell(KINDS, r.kind, null, v => onChange(patchType(scenario, i, { kind: v })),
        false, 'Training background. Sets the default didactics day: psych → Tue PM, TY → Wed PM, categorical → Thu PM. Override the day per resident if needed.'));

      const start = document.createElement('input');
      start.type = 'date';
      start.value = r.serviceStart;
      start.title = 'Service window start — the first date this resident is on the team.';
      start.addEventListener('change', () => onChange(patchResident(scenario, i, { serviceStart: start.value })));
      tr.appendChild(td(start));

      const end = document.createElement('input');
      end.type = 'date';
      end.value = r.serviceEnd;
      end.title = 'Service window end — the last date this resident is on the team.';
      end.addEventListener('change', () => onChange(patchResident(scenario, i, { serviceEnd: end.value })));
      tr.appendChild(td(end));

      const dowOptions = ['none', ...DOW_LABELS.map((_, dow) => String(dow))];
      const dowValue = r.didactics ? String(r.didactics.dow) : 'none';
      tr.appendChild(selectCell(dowOptions, dowValue, o => (o === 'none' ? 'None' : DOW_LABELS[Number(o)]), v => {
        const didactics = v === 'none' ? null : { dow: Number(v), half: r.didactics?.half ?? 'PM', hard: r.didactics?.hard ?? false };
        onChange(patchResident(scenario, i, { didactics }));
      }, false, 'Weekly didactics day — defaulted from role/kind; override here per resident.'));

      tr.appendChild(selectCell(['AM', 'PM'], r.didactics?.half ?? 'PM', null, v => {
        if (!r.didactics) return;
        onChange(patchResident(scenario, i, { didactics: { ...r.didactics, half: v } }));
      }, !r.didactics, 'AM or PM half for didactics.'));

      const hard = document.createElement('input');
      hard.type = 'checkbox';
      hard.checked = !!r.didactics?.hard;
      hard.disabled = !r.didactics;
      hard.title = 'Protected — must not be scheduled over; a conflict emits a warning.';
      hard.addEventListener('change', () => {
        if (!r.didactics) return;
        onChange(patchResident(scenario, i, { didactics: { ...r.didactics, hard: hard.checked } }));
      });
      tr.appendChild(td(hard));

      const actions = document.createElement('td');
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn-ghost';
      removeBtn.textContent = 'Remove';
      removeBtn.title = 'Remove this resident from the roster.';
      removeBtn.addEventListener('click', () =>
        onChange({ ...scenario, residents: scenario.residents.filter((_, idx) => idx !== i) }));
      actions.appendChild(removeBtn);

      const splitBtn = document.createElement('button');
      splitBtn.type = 'button';
      splitBtn.className = 'btn-secondary';
      splitBtn.textContent = 'Split seat';
      splitBtn.title = 'Mid-month handoff: duplicate this seat with a replacement starting the day after this resident’s service ends.';
      splitBtn.addEventListener('click', () => {
        const name = prompt(`Name of the resident replacing ${r.name}?`);
        if (!name) return;
        const dates = monthDates(scenario.month);
        const monthEnd = dates[dates.length - 1];
        const replacement = {
          ...r, name,
          serviceStart: nextDay(r.serviceEnd),
          serviceEnd: monthEnd,
          commitments: [], pto: [],
        };
        onChange({ ...scenario, residents: [...scenario.residents, replacement] });
      });
      actions.appendChild(splitBtn);

      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
  }

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn-secondary';
  addBtn.textContent = 'Add resident';
  addBtn.title = 'Add a new resident row to the roster.';
  addBtn.addEventListener('click', () => {
    const dates = monthDates(scenario.month);
    const blank = {
      name: '', role: 'intern', kind: 'other',
      serviceStart: dates[0] ?? '', serviceEnd: dates[dates.length - 1] ?? '',
      didactics: null, commitments: [], pto: [],
    };
    onChange({ ...scenario, residents: [...scenario.residents, blank] });
  });
  container.appendChild(addBtn);
}
