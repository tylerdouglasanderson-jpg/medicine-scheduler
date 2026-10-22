import { CYCLE, twoPersonCallDays } from '../model.js';

const CYCLE_LABELS = {
  precall: 'Pre-call', call: 'Call', postcall: 'Post-call',
  ppc: 'Post-post-call', sc1: 'Short Call 1', sc2: 'Short Call 2',
};
const TEAMS = ['A', 'B', 'C', 'D', 'E', 'F'];

const CARRY_TITLES = {
  nightPerson: 'Who took night call on the last day of last month. Needed because this month starts on a post-call day. On day 1 this person is sleeping after night call, so they are not counted as working. Required before you can Solve.',
  dayCallIntern: 'The intern who took day call on the last day of last month. Because day 1 is a post-call day, this intern holds the pager on day 1. Required before you can Solve.',
  dayCallSenior: 'The senior who took day call on the last day of last month. It is saved with the month and required to Solve, but the scheduler does not appear to use it when building day 1.',
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

// One preference: the control, a clear label, and a muted line saying what it does. `control` is a checkbox or a select.
function prefRow(control, labelText, hint) {
  const row = document.createElement('label');
  row.className = 'pref';
  const text = document.createElement('span');
  text.className = 'pref-text';
  const name = document.createElement('span');
  name.className = 'pref-name';
  name.textContent = labelText;
  const note = document.createElement('span');
  note.className = 'pref-hint';
  note.textContent = hint;
  text.append(name, note);
  row.append(control, text);
  return row;
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

export function render(container, scenario, onChange, onTwoPerson) {
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
    'Which inpatient team (A to F) this schedule is for. The letter labels the schedule and the saved file name. Team C also has a special senior-only staffing rule on days when every available person is a senior.');
  teamSel.className = 'team-select';
  row.appendChild(labeled('Team', teamSel));

  const month = document.createElement('input');
  month.type = 'month';
  month.name = 'month';
  month.value = scenario.month || '';
  month.title = 'The month to build. The whole calendar, the call-cycle labels, each resident’s service window and the days-off quotas follow from this.';
  month.addEventListener('change', () => onChange({ ...scenario, month: month.value }));
  row.appendChild(labeled('Month', month));

  row.appendChild(labeled('Anchor type', selectEl('anchorType', CYCLE, scenario.anchorType,
    o => CYCLE_LABELS[o], v => onChange({ ...scenario, anchorType: v }),
    'Which day of the 6-day call cycle the 1st of this month falls on. It decides which days are call days, post-call days and short-call days for the whole month, so check it against your team’s rotation sheet. Choosing Post-call makes you fill in who was on call at the end of last month.'),
    'The day the month starts on within the 6-day call cycle.'));

  const quota = document.createElement('input');
  quota.type = 'number';
  quota.min = '0';
  quota.name = 'offQuota';
  quota.value = String(scenario.options.offQuota);
  quota.title = 'Whole days off each resident gets in a full month (normally 4). Residents who are on the team for only part of the month get a share based on their service days, rounded half up. A quota the schedule cannot meet shows up as an error and blocks Solve. Bonus days and half days off are on top of this.';
  quota.addEventListener('change', () => onChange({
    ...scenario, options: { ...scenario.options, offQuota: Number(quota.value) },
  }));
  row.appendChild(labeled('Off quota', quota,
    'Days off per person per month: 4 for a full month, pro-rated for a part month (2 for a half month). Normally leave this at 4.'));

  const prefs = document.createElement('div');
  prefs.className = 'prefs';
  prefs.setAttribute('role', 'group');
  const prefsH = document.createElement('h3');
  prefsH.className = 'prefs-heading';
  prefsH.id = 'prefs-heading';
  prefsH.textContent = 'Preferences';
  prefs.setAttribute('aria-labelledby', prefsH.id);
  prefs.appendChild(prefsH);

  const checkbox = (name, checked, onSet, title) => {
    const c = document.createElement('input');
    c.type = 'checkbox'; c.name = name; c.checked = checked;
    if (title) c.title = title;
    c.addEventListener('change', () => onChange({ ...scenario, options: { ...scenario.options, [name]: onSet(c) } }));
    return c;
  };
  const opt = (name, checked, title) => checkbox(name, checked, c => c.checked, title);

  prefs.appendChild(prefRow(opt('goldenWeekend', !!scenario.options.goldenWeekend,
      'When ticked, the scheduler rewards giving a resident both Saturday and Sunday off in the same weekend. It is a soft goal: it gives way to staffing rules and to keeping days off fair, so not everyone will get one.'),
    'Try for a golden weekend',
    'Aim to give each resident a full Saturday and Sunday off together. A soft goal.'));

  prefs.appendChild(prefRow(opt('seniorsOffShortCall', !!scenario.options.seniorsOffShortCall,
      'When unticked (the default), seniors are steered to keep working on weekday short-call days. Tick it for months when interns admit on their own, so seniors can take a day off on those days. Weekend short call is never protected either way.'),
    'Allow seniors off on short-call days',
    'For months later in the year, when interns are more independent and you are confident that they can admit on their own. Weekend short call still takes no admissions, so it is never protected either way.'));

  prefs.appendChild(prefRow(opt('seniorFirstDay', scenario.options.seniorFirstDay !== false,
      'On by default. Steers seniors away from a day off on the 1st of the month, so a senior is there at the team changeover. It is a soft goal and can be broken if the month cannot be staffed otherwise.'),
    'Keep a senior present on the 1st',
    'Steers seniors away from a day off on the 1st so a senior is there for the team changeover. A soft goal.'));

  prefs.appendChild(prefRow(opt('allowExtraOffs', !!scenario.options.allowExtraOffs,
      'Not advised. Turns the days-off quota into a minimum, so the scheduler may give someone more offs than the quota, but only as a last resort when the month cannot be staffed any other way. For extra time off, add bonus days instead.'),
    'Allow more than the quota of days off',
    'Not advised. Add bonus days afterwards instead. This only lets the solver give extra days off if the month cannot be staffed any other way, and it avoids them whenever it can.'));

  const pagerTitle = 'Optional cap on how many days each senior holds the pager this month (0 to 4). Choose 0 to keep seniors off the pager if at all possible. It is a soft goal: the scheduler breaks it when the month needs it, and still keeps the count as low as it can. No limit means no cap.';
  const pagerNow = scenario.options.seniorPagerLimit != null ? String(scenario.options.seniorPagerLimit) : '';
  const pagerRow = document.createElement('div');
  pagerRow.className = 'pref pref-choice';
  const spacer = document.createElement('span');
  spacer.className = 'pref-spacer';
  spacer.setAttribute('aria-hidden', 'true');
  const pagerText = document.createElement('span');
  pagerText.className = 'pref-text';
  const pagerName = document.createElement('span');
  pagerName.className = 'pref-name';
  pagerName.id = 'pager-limit-label';
  pagerName.textContent = 'Limit senior pager days to';
  const pagerHint = document.createElement('span');
  pagerHint.className = 'pref-hint';
  pagerHint.textContent = '0 to 4 per senior (0 = keep seniors off the pager if at all possible). A soft goal: it is broken if the month needs it, and then still kept as low as possible.';
  pagerText.append(pagerName, pagerHint);
  const seg = document.createElement('div');
  seg.className = 'seg';
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-labelledby', pagerName.id);
  seg.title = pagerTitle;
  for (const v of ['', '0', '1', '2', '3', '4']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.name = 'seniorPagerLimit';
    btn.value = v;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(v === pagerNow));
    btn.className = v === pagerNow ? 'seg-btn on' : 'seg-btn';
    btn.textContent = v === '' ? 'No limit' : v;
    btn.addEventListener('click', () => onChange({
      ...scenario, options: { ...scenario.options, seniorPagerLimit: v !== '' ? Number(v) : null },
    }));
    seg.appendChild(btn);
  }
  pagerRow.append(spacer, pagerText, seg);
  prefs.appendChild(pagerRow);

  // Two-person days (v1.14.0): re-open the pop-up that fills in who takes the nights.
  if (onTwoPerson && twoPersonCallDays(scenario).length) {
    const row = document.createElement('div');
    row.className = 'pref pref-choice';
    const text = document.createElement('span');
    text.className = 'pref-text';
    const name = document.createElement('span');
    name.className = 'pref-name';
    name.textContent = 'Two-person team';
    const note = document.createElement('span');
    note.className = 'pref-hint';
    const labels = { intern: 'the intern takes nights, the senior takes days',
      days: 'both work days, cross-cover has the nights', manual: 'you pin it yourself' };
    note.textContent = 'Some days have only one senior and one intern. ' +
      (labels[scenario.options.twoPersonNights] ? `Now: ${labels[scenario.options.twoPersonNights]}.` : 'Not chosen yet; Solve will ask.');
    text.append(name, note);
    const btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'two-person-open'; btn.className = 'btn-secondary';
    btn.textContent = 'Choose how…';
    btn.addEventListener('click', onTwoPerson);
    row.append(text, btn);
    prefs.appendChild(row);
  }

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
