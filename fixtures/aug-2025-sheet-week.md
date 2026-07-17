# Aug-2025 "Medicine E Schedule" — sample week rendering spec

Transcribed cell-by-cell from Senior1's Google Sheet (tab "Pre-Call"), week of Aug 3–9, 2025, via screenshots on 2026-07-16.
**FORMAT ground truth ONLY.** This sheet predates the current call rules (here team seniors took night call and an intern is off on a post-call day) — do NOT treat assignments as rule-semantics examples. **PENDING TYLER SIGN-OFF**; cells marked [?] were hard to read.

Roster that month: interns Intern2, Jared; seniors Senior1, Sarah. Didactics: Jared Wed (hard stop*), Intern2 Thu (hard stop), Senior1+Sarah Tue (soft stop).

## Sheet structure
- One row-block per calendar week; columns Sunday → Saturday.
- Block rows: `DATE`, `TYPE`, `ROUNDERS` (multi-line), `PAGER`, `CLINIC`, `DIDACTICS`, `PTO`, `OFF`.
- Header above grid: month/year ("August 2025") + weekday of the 1st ("FRIDAY"); sheet tab named after the anchor type ("Pre-Call").
- Color language: TYPE cells blue except CALL = red/pink; ROUNDERS block light blue; PAGER row green; CLINIC row yellow; DIDACTICS row pink/red tint; PTO row orange; OFF row pink. Days before the month starts = dark gray blanks.

## Week of Aug 3–9, 2025
| Row | Sun 3 | Mon 4 | Tue 5 | Wed 6 | Thu 7 | Fri 8 | Sat 9 |
|---|---|---|---|---|---|---|---|
| TYPE | PC | PPC | SC1 | SC2 | PRECALL | **CALL** | PC |
| ROUNDERS | Sarah (postcall)<br>Jared (postcall) | Sarah<br>Jared | Sarah<br>Senior1 | Sarah<br>Senior1 - 1/2 off<br>Intern2 | Intern2 - 1/2 off<br>Senior1 | Day - Sarah<br>Day - Jared<br>Night - Senior1<br>Night - Intern2 | Senior1 (postcall)<br>Intern2 (postcall)<br>Sarah |
| PAGER | Senior1 | Intern2 | Intern2 | **Dr. Williams** | Jared | — (call day) | Jared |
| CLINIC | — | Jared, Sarah + noon meeting | — | Senior1, Intern2, Sarah | Senior1 | — | — |
| DIDACTICS | — | — | Sarah, Senior1 | Jared [?] | Intern2 | — | — |
| PTO | — | — | — | — | — | — | — |
| OFF | Intern2 | Senior1 | Jared | — | Sarah | — | — |

Notation seen elsewhere in the sheet (must be renderable):
- `X - 1/2 off` (half-day off, appears in ROUNDERS)
- `X (postcall)` tag; `Sarah - off`, `Jared - off` inline in ROUNDERS; `Sarah (less pts!)`, `Sarah - AM` freeform annotations
- `Day - <name>` / `Night - <name>` lines on CALL days
- Attending as pager holder (`Dr. Williams`)
- Clinic cell freeform: `Sarah + mtgs 10-11 and 12-1`, `Day - Sara* 9:30-4pm mtgs`
- `Senior1 (ICU Nights)` (person elsewhere-rotation note, week of Aug 1)

## Right-side summary table (whole-month totals; 0.5 increments)
| Resident | Pager | Clinic | Didactics | Off | PTO | Bonus |   | Off + Bonus |
|---|---|---|---|---|---|---|---|---|
| Intern2 | 9.0 | 4.0 | 2.0 | 5.0 | – | 3.0 | | 8.0 |
| Jared | 7.0 | 3.0 | 1.0 | 5.0 | – | 3.5 | | 8.5 |
| Senior1 | 5.0 | 6.0 | 2.0 | 5.0 | 1.0 | 1.0 | | 6.0 |
| Sarah | 4.0 | 8.0 | 2.0 | 4.5 | – | 1.5 | | 6.0 |

## Side sections (below totals)
- **Notes**: per-person didactics day + stop hardness (`Jared — Wed Didactics — hard stop*`, `Intern2 — Thu Didactics — hard stop`, `Senior1 + Sarah — Tue Didactics — soft stop`).
- **Potential Issues**: dated free-text list (`Aug 6th: Pager … Jared or attending? Didactics day`, `Aug 21: Intern2 will miss didactics`). Tool's warnings panel + export mirror this.
