import { CYCLE } from '../model.js';

const CYCLE_LABELS = {
  precall: 'Pre-call', call: 'Call', postcall: 'Post-call',
  ppc: 'Post-post-call', sc1: 'Short Call 1', sc2: 'Short Call 2',
};
const TEAMS = ['A', 'B', 'C', 'D', 'E', 'F'];

const CARRY_TITLES = {
  nightPerson: 'Who was on night call at the end of last month — needed to continue the cycle when the month starts post-call.',
  dayCallIntern: 'Who was the day-call intern at the end of last month — needed to continue the cycle when the month starts post-call.',
  dayCallSenior: 'Who was the day-call senior at the end of last month — needed to continue the cycle when the month starts post-call.',
};

function labeled(labelText, input, hint) {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const span = document.createElement('span');
  span.textContent = labelText;
  wrap.appendChild(span);
  wrap.appendChild(input);
  if (hint) {
    const h = document.createElement('span');
    h.className = 'field-hint';
    h.textContent = hint;
    wrap.appendChild(h);
  }
  return wrap;
}

// A standard inline checkbox: box first, then a label you can click.
function checkLabel(labelText, input) {
  const wrap = document.createElement('label');
  wrap.className = 'check';
  const span = document.createElement('span');
  span.textContent = labelText;
  wrap.append(input, span);
  return wrap;
}

function selectEl(name, options, value, labelFor, onSet, title) {
  const sel = document.createElement('select');
  sel.name = name;
  if (title) sel.title = title;
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = labelFor ? labelFor(opt) : opt;
    if (opt === value) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => onSet(sel.value));
  return sel;
}

export function render(container, scenario, onChange) {
  container.innerHTML = '';
  const h = document.createElement('h2');
  h.textContent = 'Setup';
  container.appendChild(h);
  const help = document.createElement('p');
  help.className = 'panel-help';
  help.textContent = 'Team, month, and the call-cycle rules that shape the whole schedule.';
  container.appendChild(help);

  if (!scenario.month) {
    const hint = document.createElement('p');
    hint.className = 'empty-state';
    hint.textContent = 'Pick a month — it drives the whole calendar.';
    container.appendChild(hint);
  }

  const row = document.createElement('div');
  row.className = 'row';
  container.appendChild(row);

  const teamSel = selectEl('team', TEAMS, scenario.team, null,
    v => onChange({ ...scenario, team: v }),
    'Which inpatient team this schedule is for (A–F). Med C has senior-only call rules.');
  teamSel.className = 'team-select';
  row.appendChild(labeled('Team', teamSel));

  const month = document.createElement('input');
  month.type = 'month';
  month.name = 'month';
  month.value = scenario.month || '';
  month.title = 'The calendar month to schedule. Drives the whole grid.';
  month.addEventListener('change', () => onChange({ ...scenario, month: month.value }));
  row.appendChild(labeled('Month', month));

  row.appendChild(labeled('Anchor type', selectEl('anchorType', CYCLE, scenario.anchorType,
    o => CYCLE_LABELS[o], v => onChange({ ...scenario, anchorType: v }),
    'What point in the 6-day call cycle the 1st of the month falls on.'),
    'The day the month starts on within the 6-day call cycle.'));

  const quota = document.createElement('input');
  quota.type = 'number';
  quota.min = '0';
  quota.name = 'offQuota';
  quota.value = String(scenario.options.offQuota);
  quota.title = 'Target number of counted days off per resident for a full month (pro-rated by service days).';
  quota.addEventListener('change', () => onChange({
    ...scenario, options: { ...scenario.options, offQuota: Number(quota.value) },
  }));
  row.appendChild(labeled('Off quota', quota,
    'Days off per person the model solves for (pro-rated by days on service).'));

  const prefs = document.createElement('div');
  prefs.className = 'prefs';
  prefs.setAttribute('role', 'group');
  const prefsH = document.createElement('h3');
  prefsH.className = 'prefs-heading';
  prefsH.id = 'prefs-heading';
  prefsH.textContent = 'Preferences';
  prefs.setAttribute('aria-labelledby', prefsH.id);
  prefs.appendChild(prefsH);

  const golden = document.createElement('input');
  golden.type = 'checkbox';
  golden.name = 'goldenWeekend';
  golden.checked = !!scenario.options.goldenWeekend;
  golden.title = 'Try to give each resident a full Saturday+Sunday off together (soft goal).';
  golden.addEventListener('change', () => onChange({
    ...scenario, options: { ...scenario.options, goldenWeekend: golden.checked },
  }));
  prefs.appendChild(checkLabel('Attempt golden weekend', golden));

  const scOff = document.createElement('input');
  scOff.type = 'checkbox';
  scOff.name = 'seniorsOffShortCall';
  scOff.checked = !!scenario.options.seniorsOffShortCall;
  scOff.title = 'For months when interns admit on their own: stop steering seniors away from weekday '
    + 'short-call days off. Weekend short call takes no admissions, so it is never protected.';
  scOff.addEventListener('change', () => onChange({
    ...scenario, options: { ...scenario.options, seniorsOffShortCall: scOff.checked },
  }));
  prefs.appendChild(checkLabel('Allow seniors off on short-call days', scOff));

  const firstDay = document.createElement('input');
  firstDay.type = 'checkbox';
  firstDay.name = 'seniorFirstDay';
  firstDay.checked = scenario.options.seniorFirstDay !== false;
  firstDay.title = 'Steer seniors away from a day off on the 1st of the month, so a senior is there for '
    + 'the team changeover (soft goal).';
  firstDay.addEventListener('change', () => onChange({
    ...scenario, options: { ...scenario.options, seniorFirstDay: firstDay.checked },
  }));
  prefs.appendChild(checkLabel('Have a senior present on the 1st', firstDay));

  // carryIn required only when the month anchors on a post-call day (Solve gate: validate.js CARRYIN_REQUIRED)
  if (scenario.anchorType === 'postcall') {
    const ci = scenario.carryIn || { nightPerson: '', dayCallIntern: '', dayCallSenior: '' };
    const names = scenario.residents.map(r => r.name);
    const carryRow = document.createElement('div');
    carryRow.className = 'row carry-in';
    container.appendChild(carryRow);

    for (const [field, label] of [
      ['nightPerson', 'Carry-in night person'],
      ['dayCallIntern', 'Carry-in day-call intern'],
      ['dayCallSenior', 'Carry-in day-call senior'],
    ]) {
      const sel = selectEl(field, ['', ...names], ci[field], o => (o || '(choose)'),
        v => onChange({ ...scenario, carryIn: { ...ci, [field]: v } }), CARRY_TITLES[field]);
      sel.required = true;
      carryRow.appendChild(labeled(label, sel));
    }
  }
  container.appendChild(prefs);   // after the carry-in row: required inputs first, soft preferences last
}
