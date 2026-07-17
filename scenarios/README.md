# Smoke-test scenarios

10 hand-authored, realistic team/month setups for trialing the scheduler. Every
file is a valid scenario JSON — the same format the app's **Load Scenario** button
reads — so you can either eyeball them in the HTML or run them all through the
solver+auditor automatically.

## Two ways to use these

**A. Eyeball in the app (visual reasonableness)**
1. Open `dist/med-scheduler.html`.
2. **Load Scenario** → pick a file below → **Solve**.
3. Read the calendar, totals, and any Potential Issues. Export xlsx / print to sanity-check.

**B. Automated accuracy check (no clicking)**
```
npm run smoke            # all 10
npm run smoke 05         # just files matching "05"
```
For each scenario the harness runs the **real solver** then the **independent
auditor** (`src/audit.js`, which re-derives every hard rule separately from the
solver — so a clean audit is a genuine cross-check, not the solver grading itself),
plus three input-vs-output checks:
- **PTO honored** — anyone on PTO is fully idle that day.
- **Pins honored** — every pinned cell shows up in the solved grid.
- **Off quota met** — each resident hits quota (or quota-1 *with* a `W_QUOTA_SHORT` warning).

A scenario is "accurate" only if the audit is clean **and** all inputs are honored.
Solved schedules are written to `scenarios/solved/*.solved.json` for inspection/diff.
Last run: **10/10 accurate**.

## The scenarios

| # | File | Team | Month · anchor | Roster | What it exercises |
|---|------|------|----------------|--------|-------------------|
| 01 | `01-standard-medF.json` | F | Feb · ppc | 1S + 2I | Baseline clean month, light clinics + hard intern didactics |
| 02 | `02-golden-weekend-medG.json` | G | Feb · ppc | 1S + 2I | `goldenWeekend: true` soft goal |
| 03 | `03-senior-pto-week-medB.json` | B | Feb · ppc | 1S + 2I | Senior 4-day PTO block + an intern PTO day (prorated coverage) |
| 04 | `04-split-seat-medF.json` | F | Feb · ppc | 1S + 2I* | Seat replacement: two half-month interns on adjacent windows → prorated off quota (2 each) |
| 05 | `05-medC-two-seniors.json` | C | Mar · call | 2 Seniors | **Med C** two-senior self-cover (seniors take nights) |
| 06 | `06-two-senior-one-intern-medE.json` | E | Feb · ppc | 2S + 1I | 2S+1I rule (intern alternates nights, each senior ~1 night) |
| 07 | `07-heavy-clinic-load-medD.json` | D | Feb · ppc | 1S + 2I | Heavy PM clinic load — stresses commitment / Morning-Report handling |
| 08 | `08-with-pins-medF.json` | F | Feb · ppc | 1S + 2I | Four pins (nightCall, dayCall, offCounted, offFree) all honored |
| 09 | `09-april-precall-medA.json` | A | Apr · precall | 1S + 2I | 30-day month + `precall` anchor (cycle math across month length) |
| 10 | `10-three-intern-medF.json` | F | Mar · call | 1S + 3I | Larger roster, `call` anchor, one intern PTO day |

\*04 has 4 residents on paper but always 1 senior + 2 interns on service at once.

## Notes for reading the output
- `W_DIDACTICS_MISS` is expected whenever a pager/coverage need lands on a hard
  didactics half — the tool keeps the ward covered and flags the miss (by design).
- `W_ATTENDING_PAGER` / `W_CARRYOUT` are soft, expected on thin rosters / month edges.
- Off totals show as `off/quota`; prorated seats (04) correctly show `2/2`.
- These are **synthetic** rosters (fake names, plausible clinics) for testing the
  engine — not a real month. Run your real upcoming month as the final acceptance.
