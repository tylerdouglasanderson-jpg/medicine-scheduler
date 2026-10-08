// Independent auditor — deliberately re-implements cycle typing and every hard rule.
// NO imports from milp.js or model.js (see CLAUDE.md): the auditor's value is independence.
const CYCLE = ['precall', 'call', 'postcall', 'ppc', 'sc1', 'sc2'];
// Nobody attends didactics on a call or post-call day — re-stated here, not imported (see CLAUDE.md).
const NO_DIDACTICS = ['call', 'postcall'];
const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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

    // A_OFF_ON_COMMITMENT: an off day must be free of clinics/commitments
    for (const name of dd.off) {
      const r = byName[name];
      if (r && (r.commitments ?? []).some(c => c.date === d))
        V('A_OFF_ON_COMMITMENT', `${name} is off on ${d} but has a commitment (clinic) that day`, name, d);
    }
    for (const p of (scenario.pins ?? []).filter(x => x.type === 'halfOff' && x.date === d)) {
      if ((byName[p.person]?.commitments ?? []).some(c => c.date === d && c.half === p.half))
        V('A_OFF_ON_COMMITMENT', `${p.person} has a half day off on ${d} over their own ${p.half} commitment`, p.person, d);
    }

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
        warnings.push({
          code: 'W_ATTENDING_PAGER', person: null, date: d,
          message: (scenario.attendingPagerDays ?? []).includes(d)
            ? `Attending holds the pager on ${d} — you handed them this afternoon`
            : `Attending holds the pager on ${d}`,
          attendingChosen: (scenario.attendingPagerDays ?? []).includes(d),
        });
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
          if ((scenario.pins ?? []).some(x => x.person === dd.pager && x.date === d && x.type === 'halfOff' && x.half === 'PM'))
            V('A_PAGER_CONFLICT', `Pager holder ${dd.pager} has the afternoon off on ${d}`, dd.pager, d);
          if (pr.didactics?.hard && pr.didactics.dow === dow(d) && !NO_DIDACTICS.includes(t))
            W('W_DIDACTICS_MISS', `${dd.pager} holds the pager on ${d} and will miss didactics`, dd.pager, d);
        }
      }
    }

    // A_STAFFING — mirrors milp floor: min(2 — or 1 for Med C / a two-person team —, on-service non-PTO minus night (call) / sleeper (post-call))
    const sleeperOut = dd.sleeper && avail.some(r => r.name === dd.sleeper) ? 1 : 0;
    const effAvail = avail.length - (t === 'call' ? 1 : sleeperOut);
    const dayTeam = t === 'call' ? dd.working.filter(n => n !== dd.night) : dd.working;
    const medCstaff = scenario.team === 'C' && roster.every(r => r.role === 'senior');
    const twoPersonTeam = roster.length <= 2;   // 1 intern + 1 senior: one resident runs it alone
    const floor = Math.min(medCstaff || twoPersonTeam ? 1 : 2, effAvail);
    if (dayTeam.length < floor)
      V('A_STAFFING', `Only ${dayTeam.length} working the day team on ${d} (floor ${floor})`, null, d);

    // W_MR_THIN / W_MR_NO_SENIOR / W_MR_NO_INTERN — Morning Report = pre-call on Tue/Thu, this
    // team presents: want 2+ on, ideally a senior and an intern. Soft, so these are warnings.
    if (t === 'precall' && (dow(d) === 2 || dow(d) === 4)) {
      const present = avail.filter(r => !dd.off.includes(r.name));
      if (present.length < 2)
        W('W_MR_THIN', `Only ${present.length} on for Morning Report (${d}) — the team presents that day`, null, d);
      else if (!present.some(r => r.role === 'senior'))
        W('W_MR_NO_SENIOR', `No senior on for Morning Report (${d})`, null, d);
      else if (!present.some(r => r.role === 'intern') && avail.some(r => r.role === 'intern'))
        W('W_MR_NO_INTERN', `No intern on for Morning Report (${d})`, null, d);
    }

    // W_MULTI_OFF / W_SENIOR_OFF_SC
    if (dd.off.length > 1)
      W('W_MULTI_OFF', `${dd.off.length} people off on ${d} (${dd.off.join(', ')})`, null, d);
    // weekend short call takes no admissions; the option covers months when interns admit alone
    const seniorWantedOnSC = !scenario.options?.seniorsOffShortCall && dow(d) !== 0 && dow(d) !== 6;
    if ((t === 'sc1' || t === 'sc2') && seniorWantedOnSC)
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
      // a day-call intern whose service ended on the call day can't page tomorrow: a senior must
      const dci = day(d).dayCall?.intern ?? null;
      const intern = dci && byName[dci] && onSvc(byName[dci], next) ? dci : null;
      if (intern) {
        if (nd.pager !== intern)
          V('A_POSTCALL_PAGER', `Post-call pager on ${next} must be the day-call intern ${intern}`, nd.pager, next);
      } else {
        // v1.1.0 (program rule, 2026-10): no day-call intern on service → a working, awake intern pages if one can
        // (e.g. the incoming intern on a handoff day); a senior only when no intern can hold it that afternoon.
        const pinned = name => (scenario.pins ?? []).some(x => x.person === name && x.date === next && x.type === 'pager');
        const canPage = q => byName[q]?.role === 'intern' && nd.working.includes(q) && (pinned(q) || !(
          (byName[q].commitments ?? []).some(x => x.date === next && x.half === 'PM')
          || (scenario.pins ?? []).some(x => x.person === q && x.date === next && x.type === 'halfOff' && x.half === 'PM')));
        const internCan = nd.working.some(canPage);
        const holder = nd.pager && nd.pager !== 'ATTENDING' && nd.working.includes(nd.pager) ? byName[nd.pager] : null;
        if (internCan && holder?.role !== 'intern')
          V('A_POSTCALL_PAGER', `Post-call pager on ${next} must be a working intern (the day-call intern from ${d} is off service)`, nd.pager, next);
        else if (!internCan && holder?.role !== 'senior')
          V('A_POSTCALL_PAGER', `Post-call pager on ${next} must be a working senior (no day-call intern on ${d})`, nd.pager, next);
      }
    }
  });

  // ---------- A_NIGHT_SPLIT: whole-month two seniors + one intern (program rule, 2026-10) ----------
  // Only when exactly three residents serve this month (2 seniors + 1 intern) and every one of them is
  // on service on EVERY date of the month (PTO ignored). The intern then takes exactly every other
  // call night — never two in a row, and the seniors never two in a row either — and the seniors'
  // counts differ by <= 1. Parity: an intern who carried in last month's night skips the first call
  // night; a senior who carried it in hands the first to the intern; an odd month starts with the
  // intern (ceil(n/2)); an even month with no carry-in may start either way.
  const callDates = allDates.filter(d => types.get(d) === 'call');
  const team = scenario.residents.filter(r => allDates.some(d => onSvc(r, d)));
  const fullMonth = team.length === 3 && team.every(r => allDates.every(d => onSvc(r, d)));
  const tInterns = team.filter(r => r.role === 'intern'), tSeniors = team.filter(r => r.role === 'senior');
  if (fullMonth && tInterns.length === 1 && tSeniors.length === 2
      && callDates.length && callDates.every(d => schedule.days[d])) {
    const I = tInterns[0].name;
    const isI = callDates.map(d => day(d).night === I);
    const carried = scenario.anchorType === 'postcall' ? scenario.carryIn?.nightPerson : null;
    const q = carried ? (carried === I ? 1 : 0) : callDates.length % 2 ? 0 : (isI[0] ? 0 : 1);
    const expected = callDates.filter((_, k) => k % 2 === q);
    const off = callDates.find((_, k) => isI[k] !== (k % 2 === q));
    if (off)
      V('A_NIGHT_SPLIT', `Two seniors + one intern all month: ${I} should take exactly every other call night `
        + `(${expected.join(', ')})${carried ? `, given ${carried} carried in last month's night` : ''} — `
        + `${off} breaks the alternation (${day(off).night ?? 'nobody'} on night)`, day(off).night ?? null, off);
    const [s1, s2] = tSeniors.map(r => callDates.filter(d => day(d).night === r.name).length);
    const want = callDates.length - expected.length;
    if (s1 + s2 !== want || Math.abs(s1 - s2) > 1)
      V('A_NIGHT_SPLIT', `Two seniors + one intern over ${callDates.length} call days: the seniors should share `
        + `${want} night(s) evenly (the intern alternates the rest), but they have ${s1} and ${s2}`, null, null);
  }

  // ---------- per-person: A_QUOTA_SHORT / W_DUTY_HOUR / W_LONG_STRETCH ----------
  for (const r of scenario.residents) {
    const svc = allDates.filter(d => onSvc(r, d));
    if (svc.length === 0) continue;
    const quota = Math.floor(scenario.options.offQuota * svc.length / allDates.length + 0.5); // round-half-up
    const pins = scenario.pins ?? [];
    const freeDates = new Set(pins.filter(p => p.person === r.name && p.type === 'offFree').map(p => p.date));
    // Half days off (halfOff pins) are freebies: they never count toward the quota (program rule, 2026-10).
    const counted = svc.filter(d => day(d)?.off.includes(r.name) && !freeDates.has(d)).length;
    // Quota is a hard line: the full pro-rated number of whole offs, every person, every month.
    if (counted < quota)
      V('A_QUOTA_SHORT', `${r.name} has ${counted} counted offs; the quota is ${quota} (${svc.length} service days)`, r.name);

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

  // ---------- didactics ledger (program rule, 2026-08) ----------
  // Every teaching half-day the schedule could have protected, and what took it. Off and post-call
  // sleep are misses; the pager still lets them go but tethered, and when nobody else on the team
  // was eligible that afternoon the only remedy is handing the pager to the attending — flagged so
  // the chief can do exactly that and re-solve.
  for (const r of scenario.residents) {
    if (!r.didactics) continue;
    for (const d of dates) {
      if (dow(d) !== r.didactics.dow || !onSvc(r, d) || isPto(r, d)) continue;
      if (NO_DIDACTICS.includes(types.get(d))) continue;   // no session to make on a call/post-call day
      const dd = day(d);
      const halfOffHere = (scenario.pins ?? []).some(x => x.person === r.name && x.date === d
        && x.type === 'halfOff' && x.half === (r.didactics.half ?? 'PM'));
      if (halfOffHere && !dd.off.includes(r.name))
        W('W_DIDACTICS_HALF_OFF', `${r.name} has the ${r.didactics.half ?? 'PM'} off on ${d}, their didactics half-day — a missed session`, r.name, d);
      else if (dd.off.includes(r.name))
        W('W_DIDACTICS_OFF', `${r.name} is off on ${d}, their didactics day — a missed session and a day off spent on a half-day`, r.name, d);
      else if (dd.pager === r.name && !r.didactics.hard) {  // hard already raises W_DIDACTICS_MISS above
        const free = o => o.name !== r.name && onSvc(o, d) && !isPto(o, d)
          && !dd.off.includes(o.name) && dd.sleeper !== o.name
          && !(o.commitments ?? []).some(c => c.date === d && c.half === 'PM');
        const freeSenior = scenario.residents.find(o => o.role === 'senior' && free(o));
        const freeAnyone = scenario.residents.some(free);
        if (r.role === 'senior') {
          warnings.push({
            code: 'W_DIDACTICS_PAGER', person: r.name, date: d,
            message: freeAnyone
              ? `${r.name} attends didactics on ${d} holding the pager`
              : `${r.name} attends didactics on ${d} holding the pager — nobody else on the team is free to take it`,
            attendingCanCover: !freeAnyone,
          });
        } else {
          // An intern on the pager through their own didactics is barely at didactics at all, and
          // carrying it is normally a senior's job — so this always offers a way out, either the
          // senior who was free that afternoon or the attending.
          warnings.push({
            code: 'W_DIDACTICS_PAGER_INTERN', person: r.name, date: d,
            message: freeSenior
              ? `${r.name} (intern) carries the pager through their own didactics on ${d} — ${freeSenior.name} is free that afternoon and would normally take it. Pin the pager to them and re-solve.`
              : freeAnyone
                ? `${r.name} (intern) carries the pager through their own didactics on ${d} — no senior is free that afternoon`
                : `${r.name} (intern) carries the pager through their own didactics on ${d} — nobody else on the team is free to take it`,
            attendingCanCover: !freeSenior,
          });
        }
      }
    }
  }

  // An input-level collision the solver can never fix: if a senior has a PM commitment on EVERY one
  // of an intern's didactics afternoons, no schedule can ever put a senior on that pager. The chief
  // has to move a clinic or hand those afternoons to the attending, so say it once, plainly.
  for (const r of scenario.residents) {
    if (r.role !== 'intern' || !r.didactics) continue;
    const sessions = dates.filter(d => dow(d) === r.didactics.dow && onSvc(r, d) && !isPto(r, d)
      && !NO_DIDACTICS.includes(types.get(d)));
    if (sessions.length < 2) continue;
    const coverable = sessions.filter(d => scenario.residents.some(o => o.role === 'senior'
      && onSvc(o, d) && !isPto(o, d)
      && !(o.commitments ?? []).some(c => c.date === d && c.half === 'PM')));
    if (coverable.length === 0)
      W('W_DIDACTICS_NO_SENIOR_COVER',
        `No senior can cover ${r.name}'s ${DOW_NAMES[r.didactics.dow]} didactics on any of the ${sessions.length} afternoons this month — a senior has a PM commitment every one of those days. They can only fall to another intern or the attending. Moving one of those clinics is the real fix.`,
        r.name);
  }

  // ---------- A_ATTENDING_DAY_IGNORED ----------
  for (const d of scenario.attendingPagerDays ?? []) {
    const dd = day(d);
    if (dd && dd.pager !== 'ATTENDING')
      V('A_ATTENDING_DAY_IGNORED', `The attending was set to cover the pager on ${d} but ${dd.pager ?? 'nobody'} holds it`, null, d);
  }

  // ---------- A_PIN_VIOLATED ----------
  const PIN_OK = {
    offCounted: (dd, p) => dd.off.includes(p),
    offFree: (dd, p) => dd.off.includes(p),
    work: (dd, p) => dd.working.includes(p),
    pager: (dd, p) => dd.pager === p,
    dayCall: (dd, p) => dd.working.includes(p) && dd.night !== p,
    nightCall: (dd, p) => dd.night === p,
    halfOff: (dd, p) => dd.working.includes(p),          // works the other half; a freebie, not an off
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
