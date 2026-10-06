// How an alternative schedule differs from Solution 1, in words a chief resident reads at a glance
// (v1.0.0 decision 7, docs/RULES.md §12). Pure: no DOM, no solver. Days off lead, because that is
// what the alternatives were built to vary; nights, pager and didactics follow only when they moved.
import { audit } from './audit.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = d => `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8))}`;
const isWeekend = d => [0, 6].includes(new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8)).getDay());
const SHIFT = 130;          // objective units per shift of imbalance — milp.js ALT_SLACK's yardstick
const MAX_PEOPLE = 3;       // name at most this many people on the days-off line

// Potential Issues as the UI counts them: everything the independent auditor reports. A caller that
// already has the number (or a hand-built schedule) can pass `issues` instead.
const issuesOf = (scenario, x) => x.issues
  ?? (({ violations, warnings }) => violations.length + warnings.length)(audit(scenario, x.schedule));

// "¼", "½", "1", "1¾" — quarter-shift granularity, never a percentage.
function shifts(q) {
  const whole = Math.floor(q), frac = ['', '¼', '½', '¾'][Math.round((q - whole) * 4)];
  const n = (whole ? String(whole) : '') + frac;
  return `${n} shift${q > 1 ? 's' : ''}`;
}

export function describeDifference(scenario, base, alt) {
  const A = base.schedule, B = alt.schedule;
  const dates = Object.keys(A.days).sort();
  const names = scenario.residents.map(r => r.name);
  const offsOf = (sch, n) => dates.filter(d => sch.days[d]?.off?.includes(n));

  // ---- days off, per person: pair the days given up with the days gained, in date order ----
  let offsMoved = 0;
  const moves = [];
  const people = [];          // per-person detail for the UI: [{ name, count, moves: ['Feb 14→Feb 9', …] }]
  for (const n of names) {
    const a = offsOf(A, n), b = offsOf(B, n);
    const lost = a.filter(d => !b.includes(d)), gained = b.filter(d => !a.includes(d));
    const k = Math.max(lost.length, gained.length);
    if (!k) continue;
    offsMoved += k;
    const pairs = Array.from({ length: k }, (_, i) =>
      `${lost[i] ? fmt(lost[i]) : 'none'}→${gained[i] ? fmt(gained[i]) : 'none'}`);
    moves.push(`${n}: off ${pairs.join(', ')}`);
    people.push({ name: n, count: k, moves: pairs });
  }
  const extra = moves.length - MAX_PEOPLE;
  const line1 = !moves.length ? 'Same days off'
    : moves.slice(0, MAX_PEOPLE).join('; ') + (extra > 0 ? `; +${extra} more` : '');

  // ---- everything else that moved ----
  const nightsChanged = dates.filter(d => (A.days[d].night ?? null) !== (B.days[d]?.night ?? null)).length;
  const pagerChanged = dates.filter(d => (A.days[d].pager ?? null) !== (B.days[d]?.pager ?? null)).length;
  const other = [];
  if (nightsChanged) other.push(`${nightsChanged} night${nightsChanged === 1 ? '' : 's'} reassigned`);
  const split = sch => names.map(n => sch.totals?.[n]?.pager ?? 0).join('/');
  if (split(A) !== split(B)) other.push(`pager ${split(B)} vs ${split(A)}`);
  const did = names.filter(n => A.totals?.[n]?.didactics !== B.totals?.[n]?.didactics)
    .map(n => `${n} ${B.totals[n].didactics}/${B.totals[n].didacticsOf} vs ${A.totals[n].didactics}/${A.totals[n].didacticsOf}`);
  if (did.length) other.push(`didactics ${did.join(', ')}`);
  const wkOffs = sch => dates.filter(isWeekend).reduce((s, d) => s + (sch.days[d]?.off?.length ?? 0), 0);
  if (wkOffs(A) !== wkOffs(B)) other.push(`weekend days off ${wkOffs(B)} vs ${wkOffs(A)}`);

  // ---- quality, in shifts; then Potential Issues ----
  const objectiveDelta = Math.round(((alt.objective ?? 0) - (base.objective ?? 0)) * 1000) / 1000;
  const q = Math.round(Math.abs(objectiveDelta) / SHIFT * 4) / 4;
  const quality = Math.abs(objectiveDelta) <= 1 ? 'Equally good'
    : q === 0 ? (objectiveDelta > 0 ? 'Nearly as good' : 'Slightly better')
      : `≈ ${shifts(q)} ${objectiveDelta > 0 ? 'less' : 'more'} balanced`;
  const issuesDelta = issuesOf(scenario, alt) - issuesOf(scenario, base);
  const issues = issuesDelta === 0 ? 'same number of potential issues'
    : `${Math.abs(issuesDelta)} ${issuesDelta > 0 ? 'more' : 'fewer'} potential issue${Math.abs(issuesDelta) === 1 ? '' : 's'}`;

  const lines = [line1, other.join(' · '), `${quality} · ${issues}`].filter(Boolean);
  return { lines, stats: { offsMoved, nightsChanged, pagerChanged, objectiveDelta, issuesDelta },
    people, other, quality, issues };
}
