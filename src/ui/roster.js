import { monthDates, defaultDidactics } from '../model.js';

const ROLES = ['intern', 'senior'];
const KINDS = ['categorical', 'TY', 'psych', 'OBGYN', 'other'];
// Display labels only — stored values stay as-is so saved scenarios need no migration.
const KIND_LABELS = {
  categorical: 'Family', TY: 'Transitional', psych: 'Psych', OBGYN: 'OB/GYN', other: 'Other',
};
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

// Changing Role or Kind re-fills that type's default didactics day (keeping any `hard` flag, and a Transitional
// intern's picked dates).
// The day/half stay editable per resident afterward.
function patchType(scenario, i, patch) {
  const r = scenario.residents[i];
  const def = defaultDidactics(patch.role ?? r.role, patch.kind ?? r.kind);
  const didactics = def ? { ...def, hard: r.didactics?.hard ?? def.hard } : null;
  if (didactics?.alt && r.didactics?.alt) didactics.dates = r.didactics.dates ?? [];
  return patchResident(scenario, i, { ...patch, didactics });
}

// Transitional interns teach every OTHER Wednesday PM, and which Wednesdays differs each month, so nothing is
// filled in (locked) but the dates are not: this pop-up tells the chief to click them in the Didactics mode.
function showTransitionalNotice() {
  let dlg = document.getElementById('transitional-dialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'transitional-dialog';
    dlg.className = 'app-dialog';
    const header = document.createElement('div');
    header.className = 'guide-dialog-header';
    const h = document.createElement('h2');
    h.textContent = 'Transitional intern didactics';
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'btn-ghost'; x.textContent = '×'; x.title = 'Closes this note. Nothing about the roster changes.';
    x.addEventListener('click', () => dlg.close());
    header.append(h, x);
    const body = document.createElement('div');
    body.className = 'app-dialog-body';
    const p = document.createElement('p');
    p.textContent = 'Transitional interns have didactics every Wednesday afternoon, or every other Wednesday afternoon. '
      + 'This software is not sure which Wednesdays, so none are filled in. Wednesday PM is selected for them. Please '
      + 'confirm which Wednesdays your transitional intern has didactics and click them in their calendar:';
    const steps = document.createElement('ol');
    steps.className = 'dialog-steps';
    for (const text of [
      'Scroll to Commitments / PTO / Pins and pick the mode “Didactics (PM)”.',
      'In that intern’s calendar, click each Wednesday that has didactics.',
      'They count like any didactics: kept off the pager and days off when possible, and listed in the totals.',
      'Remove one by clicking its × chip.',
    ]) { const li = document.createElement('li'); li.textContent = text; steps.appendChild(li); }
    const ok = document.createElement('button');
    ok.type = 'button'; ok.className = 'btn-primary dialog-link'; ok.textContent = 'Got it';
    ok.title = 'Closes this note. Next, switch to the Didactics (PM) mode in Commitments / PTO / Pins and click each Wednesday this intern has didactics in their calendar.';
    ok.addEventListener('click', () => dlg.close());
    body.append(p, steps, ok);
    dlg.append(header, body);
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });   // backdrop click
    document.body.appendChild(dlg);
  }
  if (!dlg.open) dlg.showModal();
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
    empty.textContent = 'No residents yet — add your team, or press “Load the example month” at the top of the page.';
    container.appendChild(empty);
  } else {
    const table = document.createElement('table');
    table.className = 'roster-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Last name</th><th>Role</th><th>Kind</th><th>Start</th><th>End</th>' +
      '<th>Didactics day</th><th>Half</th><th>Hard</th><th></th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    const scroll = document.createElement('div');
    scroll.className = 'roster-scroll';
    scroll.appendChild(table);
    container.appendChild(scroll);

    scenario.residents.forEach((r, i) => {
      const tr = document.createElement('tr');

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = r.name;
      nameInput.placeholder = 'Last name';
      nameInput.title = 'Last name only is fine; it just has to be unique on this team. It labels this resident everywhere on the calendar, totals and exports. Pins are saved under this name, so set it before adding pins: renaming later does not move existing pins.';
      nameInput.addEventListener('change', () => onChange(patchResident(scenario, i, { name: nameInput.value })));
      tr.appendChild(td(nameInput));

      tr.appendChild(selectCell(ROLES, r.role, null, v => onChange(patchType(scenario, i, { role: v })),
        false, 'Intern or senior. This drives who can cover which call and pager slots, and which senior-only rules apply to this person. Changing it also resets this resident’s didactics day to the default for the new role and background (seniors default to Tuesday PM), replacing any day or half you picked; the Hard flag is kept.'));
      tr.appendChild(selectCell(KINDS, r.kind, k => KIND_LABELS[k] ?? k,
        v => { onChange(patchType(scenario, i, { kind: v })); if (v === 'TY') showTransitionalNotice(); },
        false, 'Training background, which sets the default weekly didactics day: Family = Thursday PM, Psych = Tuesday PM, Transitional = every other Wednesday PM (pick the dates in their calendar with the Didactics (PM) mode). Changing it resets the didactics day and half, and for OB/GYN or Other interns removes it until you choose one.'));

      const start = document.createElement('input');
      start.type = 'date';
      start.value = r.serviceStart;
      start.title = 'The first day this resident is on the team this month. Days before it are ignored: no work, day off or pager is assigned, and it does not count against their days off. Use it for someone who joins mid-month; their days-off quota is pro-rated by the days they serve.';
      start.addEventListener('change', () => onChange(patchResident(scenario, i, { serviceStart: start.value })));
      tr.appendChild(td(start));

      const end = document.createElement('input');
      end.type = 'date';
      end.value = r.serviceEnd;
      end.title = 'The last day this resident is on the team this month. Days after it are ignored: nothing is assigned to them. Make sure it is on or after the start date. Their days-off quota is pro-rated by the days they serve, and Split seat uses this date to start the replacement.';
      end.addEventListener('change', () => onChange(patchResident(scenario, i, { serviceEnd: end.value })));
      tr.appendChild(td(end));

      const dowOptions = ['none', ...DOW_LABELS.map((_, dow) => String(dow))];
      const alt = !!r.didactics?.alt;   // Transitional: Wed PM is fixed, the dates are picked in the calendar
      const dowValue = r.didactics ? String(r.didactics.dow) : 'none';
      tr.appendChild(selectCell(dowOptions, dowValue, o => (o === 'none' ? 'None' : DOW_LABELS[Number(o)]), v => {
        const didactics = v === 'none' ? null : { dow: Number(v), half: r.didactics?.half ?? 'PM', hard: r.didactics?.hard ?? (r.role !== 'senior') };
        onChange(patchResident(scenario, i, { didactics }));
      }, alt, alt ? 'Locked: this Transitional intern has didactics on every other Wednesday PM. Pick those Wednesdays in this intern’s calendar with the Didactics (PM) mode.'
        : 'The weekday this resident has weekly didactics, or None. It is filled in from role and background, and you can override it here. On that day the scheduler tries to keep them off the pager and off days off (strictly if Hard is ticked), and the totals count the sessions attended.'));

      tr.appendChild(selectCell(['AM', 'PM'], r.didactics?.half ?? 'PM', null, v => {
        if (!r.didactics) return;
        onChange(patchResident(scenario, i, { didactics: { ...r.didactics, half: v } }));
      }, !r.didactics || alt, 'Whether the weekly didactics session is in the morning or the afternoon. A half day off on the same half makes them miss that session. Greyed out when there is no didactics day, and for Transitional interns (Wednesday PM is fixed).'));

      const hard = document.createElement('input');
      hard.type = 'checkbox';
      hard.checked = !!r.didactics?.hard;
      hard.disabled = !r.didactics;
      hard.title = 'Protected didactics. When ticked, the scheduler keeps this resident off the pager and off a day off on their didactics day, and treats breaking that as very costly. It is not an absolute ban: if the month cannot be staffed any other way it will break it, and the warnings panel tells you. Needs a didactics day first.';
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
      removeBtn.title = 'Deletes this resident’s row from the roster right away, with no confirmation. Their time off and clinic entries go with the row; any pins stay in the month under their name but no longer apply. Press Solve again afterwards.';
      removeBtn.addEventListener('click', () =>
        onChange({ ...scenario, residents: scenario.residents.filter((_, idx) => idx !== i) }));
      actions.appendChild(removeBtn);

      const splitBtn = document.createElement('button');
      splitBtn.type = 'button';
      splitBtn.className = 'btn-secondary';
      splitBtn.textContent = 'Split seat';
      splitBtn.title = 'Mid-month handoff. Asks for a replacement’s name and adds a copy of this seat that starts the day after this resident’s end date and runs to the end of the month. The replacement starts with no time off or clinic entries, and pins are not copied. Set this resident’s End date first.';
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
  addBtn.title = 'Adds an empty resident row covering the whole month, as an intern with no didactics day. Type a last name first, then set role, background and service dates, and add a didactics day if they have one.';
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
