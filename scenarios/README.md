# Smoke / stress scenarios

36 numbered, hand-authored scenario JSONs (13 originals + 20 stress variations + 3 Astra
fix-pass regressions, all
invented names), plus the real Oct months in the gitignored `private/` folder. Every
file is a valid scenario JSON, the same format the app's **Load Scenario** button reads.

## Two ways to use these

**A. Eyeball in the app (visual reasonableness)**
1. Open `dist/med-scheduler.html`.
2. **Load Scenario** -> pick a file -> **Solve**.
3. Read the calendar, totals, and any Potential Issues. Export xlsx / print to sanity-check.

**B. Automated check (no clicking)**
```
npm run smoke            # scenarios/*.json + fixtures feb-2026, oct-2026-didactics, comp-*
npm run smoke 05         # only files matching "05"
npm run stress           # same + scenarios/private/*.json (real months, never committed)
node scripts/smoketest.mjs --verbose   # also print the per-person calendar of Solution 1
```

For each file the harness runs `validate()` (must be zero errors), then
`solveAlternatives(count 5)`, then checks **every** returned solution:

- **Independent audit** (`src/audit.js`) - zero violations.
- **Inputs honored** - PTO fully idle, commitments, pins (incl. `halfOff` on its half),
  `attendingPagerDays` -> `ATTENDING` pager, `carryIn` on day 1.
- **Exact off quota** - recounted in the harness (round-half-up, whole days only: `halfOff`
  pins are freebies and earn no credit);
  `quotaFor` is deliberately not imported.
- **Pairwise off-distance** between solutions (min is reported as `minD`).
- **Count and `stoppedReason`** when fewer than 5 alternatives come back.
- **Time** - per scenario, 30 s fail budget.

Three passes per file: **fresh** (no prior), **anchored** (re-solve with Solution 1 as
`lastSolution`), **frozen** (re-solve with a `freezeDate`; frozen days must be unchanged).
The table is printed to the console; Solution 1 of each file is written to
`scenarios/solved/<name>.solved.json` and the table to `scenarios/solved/summary.json`
(both gitignored). `didStatus()` in the harness is display-only: it never decides pass/fail.

A file is "accurate" only if all of the above hold. Last run: **40/40 as expected - 40
accurate + 0 expected-fail** (38 scenarios/fixtures + 2 private; RULES_VERSION 1.0.0).

## `_xfail` convention

A top-level `"_xfail": "<reason>"` in a scenario marks a known solver/model bug. The
harness runs it normally and reports `XFAIL` if it still fails. If it starts passing the
harness reports **XPASS and fails the run**, so the marker gets removed when the bug is
fixed. Do not use it to hide an input mistake; fix the input instead.

## `private/` (real months)

`scenarios/private/` is gitignored and holds the real Oct 2026 files for Team D and
Team B. They contain real names: never copy them into `fixtures/`, docs, or the repo.
Only `npm run stress` (`--private`) runs them.

## The scenarios

| # | File | Team | Month / anchor | Roster | What it exercises |
|---|------|------|----------------|--------|-------------------|
| 01 | `01-standard-medF.json` | F | Feb / ppc | 1S+2I | Baseline clean month, light clinics + hard intern didactics |
| 02 | `02-golden-weekend-medG.json` | G | Feb / ppc | 1S+2I | `goldenWeekend: true` soft goal |
| 03 | `03-senior-pto-week-medB.json` | B | Feb / ppc | 1S+2I | Senior 4-day PTO block + an intern PTO day (prorated coverage) |
| 04 | `04-split-seat-medF.json` | F | Feb / ppc | 1S+2I* | Seat replacement: two half-month interns on adjacent windows -> prorated quota |
| 05 | `05-medC-two-seniors.json` | C | Mar / call | 2S | Med C two-senior self-cover |
| 06 | `06-two-senior-one-intern-medE.json` | E | Feb / ppc | 2S+1I | 2S+1I rule (intern alternates nights, seniors split the rest evenly — 1 each here) |
| 07 | `07-heavy-clinic-load-medD.json` | D | Feb / ppc | 1S+2I | Heavy PM clinic load, Morning Report handling |
| 08 | `08-with-pins-medF.json` | F | Feb / ppc | 1S+2I | nightCall, dayCall, offCounted, offFree pins |
| 09 | `09-april-precall-medA.json` | A | Apr / precall | 1S+2I | 30-day month + precall anchor |
| 10 | `10-three-intern-medF.json` | F | Mar / call | 1S+3I | Larger roster, one intern PTO day |
| 11 | `11-fm-senior-psych-fm-juniors.json` | F | Feb / ppc | 1S+2I | FM senior with psych/FM juniors |
| 12 | `12-two-person-1s1i-medE.json` | E | Feb / ppc | 1S+1I | Two-person team (staffing floor 1) |
| 13 | `13-interns-admit-alone-medA.json` | A | Feb / ppc | 1S+2I | `seniorsOffShortCall` + `seniorFirstDay:false` |
| 14 | `14-var-teamD-nov-ppc-pins.json` | D | Nov / ppc | 1S+2I | Team D shape (heavy-clinic senior, hard-didactics intern Thu, hard psych intern Tue), early-month work pins on precall days |
| 15 | `15-var-teamB-dec-heavy-senior-clinic.json` | B | Dec / sc1 | 1S+2I | Team B shape, senior with 12 clinics across Mon/Tue/Thu/Fri, ITE days, sc1 anchor |
| 16 | `16-var-teamB-jan-intern-pto-block.json` | B | Jan27 / call | 1S+2I | Team B shape, TY intern 5-weekday PTO block + categorical intern 2 days |
| 17 | `17-var-teamD-oct-mid-month-seat-swap.json` | D | Oct / call | 1S+3I | Team D shape, psych intern leaves the 15th, new categorical joins the 16th |
| 18 | `18-var-teamD-two-person-nov.json` | D | Nov / call | 1S+1I | Two-person version of the Team D shape (heavy-clinic senior) |
| 19 | `19-var-teamB-three-intern-mar-sc2.json` | B | Mar27 / sc2 | 1S+3I | Team B shape with categorical + TY + psych interns, sc2 anchor, `seniorsOffShortCall` |
| 20 | `20-two-person-31day-sc1-golden.json` | E | Jul / sc1 | 1S+1I | 31-day month, two-person, sc1 anchor, golden weekend |
| 21 | `21-three-intern-postcall-carryin.json` | F | May27 / postcall | 1S+3I | postcall anchor with required `carryIn` (night/day-call people on day 1) |
| 22 | `22-medC-two-seniors-sc2-senior-pto-week.json` | C | Sep / sc2 | 2S | Med C, sc2 anchor, a senior PTO week |
| 23 | `23-two-senior-one-intern-hard-didactics.json` | E | Nov / call | 2S+1I | 2S+1I, hard intern didactics, clinic-heavy seniors; 30-day month (5 call days) |
| 24 | `24-split-seat-intern-and-senior.json` | A | Apr27 / ppc | 2S+3I | Split seats for an intern AND a senior (handoff on the 16th) |
| 25 | `25-heavy-staggered-pto-1s3i.json` | F | Mar27 / call | 1S+3I | 4-5 day staggered PTO per person on a 3-intern team (see "1S2I heavy PTO" below) |
| 26 | `26-all-toggles-flipped.json` | G | Aug27 / precall | 1S+2I | All three toggles flipped from default |
| 27 | `27-every-pin-type-and-attending-days.json` | D | Dec / ppc | 1S+2I | Every pin type (halfOff in AM/PM pairs) + 3 `attendingPagerDays` -> ATTENDING pager |
| 28 | `28-leap-feb-2032-29days.json` | F | Feb32 / sc2 | 1S+2I | Leap February, 29 days |
| 29 | `29-feb-2031-saturday-start-precall.json` | A | Feb31 / precall | 1S+2I | 28-day month starting on a Saturday, precall anchor |
| 30 | `30-all-hard-didactics-same-weekday-1s3i.json` | F | Jun27 / call | 1S+3I | Hard didactics for everyone (senior included) on the same weekday PM |
| 31 | `31-tight-but-feasible-senior-clinic-wall.json` | D | Nov / ppc | 1S+2I | Exactly enough eligible off days for the senior (5 free for quota 4) and one intern (4 for 4) |
| 32 | `32-2s1i-six-call-days.json` | E | Dec / call | 2S+1I | 6 call days: intern 3 alternating nights, seniors 2 + 1 (was XFAIL, fixed in 1.0.0) |
| 33 | `33-single-halfoff-pin.json` | F | Feb27 / ppc | 1S+2I | One `halfOff` pin: a freebie, full whole-day quota for everyone (was XFAIL, fixed in 1.0.0) |
| 34 | `34-2s1i-postcall-carryin-intern-5-calls.json` | E | Mar / postcall | 2S+1I | Intern carried in last month's night: skips the first call night, strict alternation, 5 call days |
| 35 | `35-2s1i-intern-leaves-oct-26.json` | E | Oct / precall | 2S+1I* | Intern leaves Oct 26: NOT a whole-month 2S+1I, so the special night split must not apply |
| 36 | `36-halfoff-over-didactics-and-mr.json` | F | Feb / ppc | 1S+2I | Half day off over the resident's own didactics half and a Morning Report day |

\*04 lists 4 residents but always has 1 senior + 2 interns on service at once.

Fixtures run by the harness as well: `fixtures/feb-2026.json`, `fixtures/oct-2026-didactics.json`,
`fixtures/comp-2s1i.json`, `fixtures/comp-3intern.json`, `fixtures/comp-medc.json`.

## Known bugs captured here (do not fix by editing the scenario)

None open. Fixed in 1.0.0 (program rule changes, 2026-10-06), kept as regression scenarios:

- **32 - 2S+1I, six call days.** Each senior used to get exactly 1 night, so the lone intern
  took 4 of 6 and was forced onto consecutive nights (`A_CONSECUTIVE_NIGHTS`). Now the intern
  alternates (3) and the seniors split the other 3 as 2 + 1. Scenario 23 is the same shape
  in a 30-day month (5 call days: 1 night per senior).
- **33 - single `halfOff` pin.** Each pin used to credit 0.5 toward the quota, so an odd
  number left a half-integer quota and the month was INFEASIBLE. Half days off are now
  freebies with no quota credit.

## Input-side gotchas found while building these

- **1S2I with heavy PTO is infeasible by arithmetic.** Offs plus PTO exceed the absent
  slots the 2-working staffing floor allows. `validate()` has no team-level capacity check
  (it only flags per-person `QUOTA_IMPOSSIBLE`), so it passes and the solver returns
  INFEASIBLE. Scenario 25 therefore uses 1S+3I.
- `normalize()` silently drops pins, PTO, commitments and attending days with bad dates,
  so a clean `validate()` does not prove nothing was dropped. The harness's inputs-honored
  check catches this.
- `validate()` forbids commitments or PTO on call/postcall days, and a postcall anchor
  needs `carryIn`.

## Notes for reading the output
- `W_DIDACTICS_MISS` is expected whenever a pager/coverage need lands on a hard
  didactics half; the tool keeps the ward covered and flags the miss.
- `W_ATTENDING_PAGER` / `W_CARRYOUT` are soft, expected on thin rosters / month edges.
- Off totals show as `off/quota`; prorated seats (04) show `2/2`.
- Rosters are **synthetic** (invented names, plausible clinics). The real Oct months live
  only in the gitignored `private/` folder.
