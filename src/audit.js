// Independent auditor — deliberately re-implements cycle typing and every hard rule.
// NO imports from milp.js or model.js (see CLAUDE.md): the auditor's value is independence.
const CYCLE = ['precall', 'call', 'postcall', 'ppc', 'sc1', 'sc2'];

function deriveTypes(anchorType, month) {           // local re-implementation, do not import
  const [y, m] = month.split('-').map(Number);
  const n = new Date(y, m, 0).getDate();
  const types = new Map();
  for (let d = 1; d <= n; d++)
    types.set(`${month}-${String(d).padStart(2, '0')}`, CYCLE[(CYCLE.indexOf(anchorType) + d - 1) % 6]);
  return types;
}

export function audit(scenario, schedule) {
  const violations = [], warnings = [];
  const V = (code, message, person, date) => violations.push({ code, message, person, date });
  const W = (code, message, person, date) => warnings.push({ code, message, person, date });
  const types = deriveTypes(scenario.anchorType, scenario.month);
  const allDates = [...types.keys()];
  const dates = allDates.filter(d => schedule.days[d]);   // audit only days the schedule covers
  const byName = Object.fromEntries(scenario.residents.map(r => [r.name, r]));
  const onSvc = (r, d) => d >= r.serviceStart && d <= r.serviceEnd;   // ISO strings compare lexically
  const isPto = (r, d) => (r.pto ?? []).includes(d);
  const day = d => schedule.days[d];
  const dow = d => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).getDay(); };

  // ---------- per-day checks ----------
  dates.forEach((d, i) => {
    const t = types.get(d);
    const dd = day(d);
    const roster = scenario.residents.filter(r => onSvc(r, d));
    if (roster.length === 0) return;                      // nobody on service — nothing to audit
    const avail = roster.filter(r => !isPto(r, d));

    // A_WINDOW: any assignment for a person outside their window (or unknown)
    const assigned = new Set([...dd.working, ...dd.off]);
    if (dd.sleeper) assigned.add(dd.sleeper);
    if (dd.night) assigned.add(dd.night);
    if (dd.pager && dd.pager !== 'ATTENDING') assigned.add(dd.pager);
    for (const name of assigned) {
      const r = byName[name];
      if (!r || !onSvc(r, d))
        V('A_WINDOW', `${name} has an assignment on ${d} outside their service window`, name, d);
    }

    // A_PTO_WORKED
    for (const r of roster)
      if (isPto(r, d) && (dd.working.includes(r.name) || dd.pager === r.name || dd.night === r.name))
        V('A_PTO_WORKED', `${r.name} is assigned to work on their PTO day ${d}`, r.name, d);

    // A_OFF_ON_CALL (sleeper exempt by shape — sleeper is not in off)
    if (t === 'call' || t === 'postcall')
      for (const name of dd.off)
        V('A_OFF_ON_CALL', `${name} is off on a ${t} day (${d})`, name, d);

    if (t === 'call') {
      // A_PAGER_ON_CALL
      if (dd.pager != null)
        V('A_PAGER_ON_CALL', `Pager assigned to ${dd.pager} on call day ${d} — no pager holder exists on call days`, dd.pager, d);

      // A_EVERYONE_WORKS_CALL
      for (const r of avail)
        if (!dd.working.includes(r.name) && dd.night !== r.name)
          V('A_EVERYONE_WORKS_CALL', `${r.name} is on service but neither working nor on night on call day ${d}`, r.name, d);

      // A_NIGHT_COUNT: exactly one night, eligible per composition, never also day-call
      const interns = roster.filter(r => r.role === 'intern');
      if (!dd.night)
        V('A_NIGHT_COUNT', `Call day ${d} has no night person`, null, d);
      else {
        const nr = byName[dd.night];
        if (interns.length >= 2 && nr?.role !== 'intern')
          V('A_NIGHT_COUNT', `Night on ${d} must be an intern (${interns.length} interns on service)`, dd.night, d);
        if (scenario.team === 'C' && interns.length === 0 && nr?.role !== 'senior')
          V('A_NIGHT_COUNT', `Night on ${d} must be a team senior (Med C, no interns)`, dd.night, d);
        if (dd.dayCall && (dd.dayCall.senior === dd.night || dd.dayCall.intern === dd.night))
          V('A_NIGHT_COUNT', `${dd.night} is both day-call and night on ${d}`, dd.night, d);
      }
    } else {
      // A_PAGER_MISSING / W_ATTENDING_PAGER / A_PAGER_CONFLICT / W_DIDACTICS_MISS
      if (dd.pager == null)
        V('A_PAGER_MISSING', `No pager holder on ${d}`, null, d);
      else if (dd.pager === 'ATTENDING')
        W('W_ATTENDING_PAGER', `Attending holds the pager on ${d}`, null, d);
      else {
        const pr = byName[dd.pager];
        if (!pr || !onSvc(pr, d))
          V('A_PAGER_CONFLICT', `Pager holder ${dd.pager} is outside their service window on ${d}`, dd.pager, d);
        else {
          if (dd.off.includes(dd.pager))
            V('A_PAGER_CONFLICT', `Pager holder ${dd.pager} is off on ${d}`, dd.pager, d);
          if (isPto(pr, d))
            V('A_PAGER_CONFLICT', `Pager holder ${dd.pager} is on PTO on ${d}`, dd.pager, d);
          if (dd.sleeper === dd.pager)
            V('A_PAGER_CONFLICT', `Pager holder ${dd.pager} is the post-call sleeper on ${d}`, dd.pager, d);
          if ((pr.commitments ?? []).some(c => c.date === d && c.half === 'PM'))
            V('A_PAGER_CONFLICT', `Pager holder ${dd.pager} has a PM commitment on ${d}`, dd.pager, d);
          if (pr.didactics?.hard && pr.didactics.dow === dow(d))
            W('W_DIDACTICS_MISS', `${dd.pager} holds the pager on ${d} and will miss didactics`, dd.pager, d);
        }
      }
    }

    // A_STAFFING — mirrors milp floor: min(2, on-service non-PTO minus night (call) / sleeper (post-call))
    const sleeperOut = dd.sleeper && avail.some(r => r.name === dd.sleeper) ? 1 : 0;
    const effAvail = avail.length - (t === 'call' ? 1 : sleeperOut);
    const dayTeam = t === 'call' ? dd.working.filter(n => n !== dd.night) : dd.working;
    const medCstaff = scenario.team === 'C' && roster.every(r => r.role === 'senior');
    if (dayTeam.length < Math.min(medCstaff ? 1 : 2, effAvail))
      V('A_STAFFING', `Only ${dayTeam.length} working the day team on ${d} (floor ${Math.min(medCstaff ? 1 : 2, effAvail)})`, null, d);

    // W_MULTI_OFF / W_SENIOR_OFF_SC
    if (dd.off.length > 1)
      W('W_MULTI_OFF', `${dd.off.length} people off on ${d} (${dd.off.join(', ')})`, null, d);
    if (t === 'sc1' || t === 'sc2')
      for (const name of dd.off)
        if (byName[name]?.role === 'senior')
          W('W_SENIOR_OFF_SC', `Senior ${name} is off on a ${t} day (${d})`, name, d);
  });

  // ---------- night chain: A_CONSECUTIVE_NIGHTS + A_NIGHT_NO_SLEEP + A_POSTCALL_PAGER ----------
  let lastNight = null;
  dates.forEach((d, i) => {
    if (types.get(d) !== 'call') return;
    const n = day(d).night;
    if (n && n === lastNight)
      V('A_CONSECUTIVE_NIGHTS', `${n} takes night on consecutive call days ending ${d}`, n, d);
    lastNight = n;
    const next = dates[i + 1];
    if (!next) return;                                    // month-end night: carry-out, nothing to check
    const nd = day(next);
    if (n && (nd.sleeper !== n || nd.working.includes(n) || nd.off.includes(n) || nd.pager === n))
      V('A_NIGHT_NO_SLEEP', `${n} took night ${d} but is not sleeping ${next}`, n, next);
    // A_POSTCALL_PAGER: day-call intern pages post-call; if none existed, a working senior must
    if (types.get(next) === 'postcall') {
      const intern = day(d).dayCall?.intern ?? null;
      if (intern) {
        if (nd.pager !== intern)
          V('A_POSTCALL_PAGER', `Post-call pager on ${next} must be the day-call intern ${intern}`, nd.pager, next);
      } else if (!nd.pager || nd.pager === 'ATTENDING'
                 || byName[nd.pager]?.role !== 'senior' || !nd.working.includes(nd.pager)) {
        V('A_POSTCALL_PAGER', `Post-call pager on ${next} must be a working senior (no day-call intern on ${d})`, nd.pager, next);
      }
    }
  });

  // ---------- per-person: A_QUOTA_FLOOR / W_QUOTA_SHORT / W_DUTY_HOUR / W_LONG_STRETCH ----------
  for (const r of scenario.residents) {
    const svc = allDates.filter(d => onSvc(r, d));
    if (svc.length === 0) continue;
    const quota = Math.floor(scenario.options.offQuota * svc.length / allDates.length + 0.5); // round-half-up
    const pins = scenario.pins ?? [];
    const freeDates = new Set(pins.filter(p => p.person === r.name && p.type === 'offFree').map(p => p.date));
    let counted = svc.filter(d => day(d)?.off.includes(r.name) && !freeDates.has(d)).length;
    counted += 0.5 * pins.filter(p => p.person === r.name && p.type === 'halfOff').length;
    const floor = Math.max(quota - 1, Math.min(quota, 2));
    if (counted < floor)
      V('A_QUOTA_FLOOR', `${r.name} has ${counted} counted offs; floor is ${floor} (quota ${quota})`, r.name);
    else if (counted < quota)
      W('W_QUOTA_SHORT', `${r.name} received quota-1 offs (${counted}/${quota})`, r.name);

    // duty-hour: (offs incl. free + PTO) / serviceDays < 1/7
    const ptoDays = (r.pto ?? []).filter(d => svc.includes(d)).length;
    const allOff = svc.filter(d => day(d)?.off.includes(r.name)).length + ptoDays;
    if (allOff / svc.length < 1 / 7)
      W('W_DUTY_HOUR', `${r.name}: ${allOff} rest days over ${svc.length} service days (<1 in 7)`, r.name);

    // long stretch: >6 consecutive service days with no rest (rest = off, PTO, or post-call sleep —
    // matches the solver's worked-expression semantics, not the working-array literally)
    let run = [];
    const flush = () => {
      if (run.length > 6)
        W('W_LONG_STRETCH', `${r.name} works ${run.length} consecutive days (${run[0]} through ${run[run.length - 1]})`, r.name, run[0]);
      run = [];
    };
    for (const d of svc) {
      const dd = day(d);
      const rest = !dd || dd.off.includes(r.name) || isPto(r, d) || dd.sleeper === r.name;
      if (rest) flush(); else run.push(d);
    }
    flush();
  }

  // ---------- A_PIN_VIOLATED ----------
  const PIN_OK = {
    offCounted: (dd, p) => dd.off.includes(p),
    offFree: (dd, p) => dd.off.includes(p),
    work: (dd, p) => dd.working.includes(p),
    pager: (dd, p) => dd.pager === p,
    dayCall: (dd, p) => dd.working.includes(p) && dd.night !== p,
    nightCall: (dd, p) => dd.night === p,
    halfOff: (dd, p) => dd.working.includes(p),          // works the day, noted 0.5 in totals
  };
  for (const p of scenario.pins ?? []) {
    const dd = day(p.date);
    const ok = PIN_OK[p.type];
    if (!ok) continue;                                    // unknown pin type — validate's job
    if (!dd || !ok(dd, p.person))
      V('A_PIN_VIOLATED', `${p.type} pin for ${p.person} on ${p.date} was not honored`, p.person, p.date);
  }

  return { violations, warnings };
}
