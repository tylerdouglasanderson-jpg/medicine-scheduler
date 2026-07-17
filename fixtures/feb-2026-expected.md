# feb-2026 golden fixture — expected properties

Source: Senior1's ChatGPT share (Medicine F Team, Feb 2026), transcribed 2026-07-16.
**PENDING TYLER SIGN-OFF.** Items marked ⚠ are rule questions surfaced during transcription — answer at sign-off.

## Derived cycle (anchor: Feb 1 = post-post-call; Feb 1 is a Sunday)
| Date range | Types |
|---|---|
| Feb 1 | ppc |
| Feb 2 / 3 / 4 | sc1 / sc2 / precall |
| **Feb 5** | **call** (matches convo: "first call day is February 5") |
| Feb 6 | postcall |
| repeats every 6 days | |

- **Call days: Feb 5 (Thu), 11 (Wed), 17 (Tue), 23 (Mon)**.
- Post-call: Feb 6, 12, 18, 24. Pre-call: Feb 4 (Wed), 10 (Tue), 16 (Mon), 22 (Sun), 28 (Sat).
- Morning-Report days for this team (pre-call falling Tue/Thu): **Feb 10 only**.
- Intern didactics Thursdays: Feb 5 (call day — didactics lost to call, allowed exception), Feb 12 (post-call — see ⚠ below), Feb 19, Feb 26.

## Input validation (must pass with ZERO hard errors)
- No clinic/PTO lands on any call or post-call day for its owner (checked by hand: all clear).
- carryIn not required (anchor ≠ postcall).

## Quotas (proportional round-half-up)
| Person | Service days | Quota |
|---|---|---|
| Intern1 | 15/28 | 4×15/28 = 2.14 → **2** |
| Intern2 | 28/28 | **4** |
| Senior1 | 28/28 | **4** (+ PTO Feb 20 as uncounted extra) |
| Senior2 | 28/28 | **4** |

## Composition per call date
- Feb 5, 11: 2 seniors + 2 interns → night = one intern (Intern1/Intern2), day = senior + other intern; external cross-cover covers night senior side.
- Feb 17, 23: 2 seniors + 1 intern (Intern1 gone) → 2S+1I alternation rule.

## Night-split expectations
- Intern1 available for calls 5, 11 only → nights as equal as possible pro-rated: Intern1 1, Intern2 1 across Feb 5+11.
- Feb 17+23 (2S+1I window, only 2 calls): **RESOLVED (Senior1 2026-07-16) — solver decides by fairness**; either split (Intern2 1 night / senior 1 night, or seniors both nights) is acceptable. Full-month 2S+1I alternation rule applies only when the composition holds for the whole month's calls.
- No person takes nights on two consecutive call days (universal).

## Pager facts
- No pager holder on call days (5, 11, 17, 23).
- Post-call pager = prior day's day-call intern: Feb 6, 12 → whichever intern worked day on 5, 11.
- Feb 18, 24 (post-call, no day-call intern the prior day): **RESOLVED (Senior1) — any working senior holds the pager, solver's choice, no warning.** Reminder encoded: EVERYONE works call days — each person either works day-call + full post-call, or night-call + post-call morning rounds (then leaves).
- Thursday post-call vs hard intern didactics (Feb 12): **RESOLVED (Senior1) — swap-if-possible first, pager ultimately wins.** Solver soft-steers the day-call assignment on Feb 11 so the intern holding the Feb 12 pager is NOT losing hard didactics if any legal alternative exists; when unavoidable, pager duty overrides didactics and a "X misses didactics" warning is emitted (matches Aug-2025 sheet precedent).
- All other days: exactly one holder; never someone with PM clinic/didactics; never someone off; never the prior night's sleeper; interns preferred; ATTENDING fallback only with warning.

## Solution properties (asserted by tests — NOT exact cells; optima are not unique)
- audit() returns zero violations.
- Off counts exactly = quota per person (or quota−1 + explicit warning).
- No offs on call/post-call days; night workers sleep next day (uncounted).
- Intern1 scheduled for nothing after Feb 15.
- Staffing ≥2 working every day through Feb 15; ≥2 where possible Feb 16-28 (3-person roster).
- Off-day spread ≈ 1/calendar-week per person (soft — assert no person has 3+ offs within any 7-day window without cause).
- Seniors not off on sc1/sc2 unless unavoidable (assert warning emitted if violated).
- Senior1 works ≤ 0 duties on Feb 20 (PTO).
- Trade-off ordering: senior-not-off-on-SC outranks small equity gains (weight regression guard).

## Pin variant (from Senior1's second ChatGPT convo — regression scenario)
Add pin `{ person: "Senior2", date: "2026-02-26", type: "offCounted" }` → solve must place one of Senior2's 4 offs on Feb 26 and remain violation-free.
