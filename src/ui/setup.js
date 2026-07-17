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

function labeled(labelText, input) {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const span = document.createElement('span');
  span.textContent = labelText;
  wrap.appendChild(span);
  wrap.appendChild(input);
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
    hint.textContent = 'Pick a month below — it drives the whole calendar.';
    container.appendChild(hint);
  }

  const row = document.createElement('div');
  row.className = 'row';
  container.appendChild(row);

  row.appendChild(labeled('Team', selectEl('team', TEAMS, scenario.team, null,
    v => onChange({ ...scenario, team: v }),
    'Which inpatient team this schedule is for (A–F). Med C has senior-only call rules.')));

  const month = document.createElement('input');
  month.type = 'month';
  month.name = 'month';
  month.value = scenario.month || '';
  month.title = 'The calendar month to schedule. Drives the whole grid.';
  month.addEventListener('change', () => onChange({ ...scenario, month: month.value }));
  row.appendChild(labeled('Month', month));

  row.appendChild(labeled('Anchor type', selectEl('anchorType', CYCLE, scenario.anchorType,
    o => CYCLE_LABELS[o], v => onChange({ ...scenario, anchorType: v }),
    'What point in the 6-day call cycle the 1st of the month falls on.')));

  const quota = document.createElement('input');
  quota.type = 'number';
  quota.min = '0';
  quota.name = 'offQuota';
  quota.value = String(scenario.options.offQuota);
  quota.title = 'Target number of counted days off per resident for a full month (pro-rated by service days).';
  quota.addEventListener('change', () => onChange({
    ...scenario, options: { ...scenario.options, offQuota: Number(quota.value) },
  }));
  row.appendChild(labeled('Off quota', quota));

  const golden = document.createElement('input');
  golden.type = 'checkbox';
  golden.name = 'goldenWeekend';
  golden.checked = !!scenario.options.goldenWeekend;
  golden.title = 'Try to give each resident a full Saturday+Sunday off together (soft goal).';
  golden.addEventListener('change', () => onChange({
    ...scenario, options: { ...scenario.options, goldenWeekend: golden.checked },
  }));
  row.appendChild(labeled('Attempt golden weekend', golden));

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
}
