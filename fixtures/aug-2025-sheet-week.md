# Aug-2025 "Medicine E Schedule" — sample week rendering spec

Transcribed cell-by-cell from Whitfield's Google Sheet (tab "Pre-Call"), week of Aug 3–9, 2025, via screenshots on 2026-07-16.
**FORMAT ground truth ONLY.** This sheet predates the current call rules (here team seniors took night call and an intern is off on a post-call day) — do NOT treat assignments as rule-semantics examples. **PENDING TYLER SIGN-OFF**; cells marked [?] were hard to read.

Roster that month: interns Reyes, Jared; seniors Whitfield, Sarah. Didactics: Jared Wed (hard stop*), Reyes Thu (hard stop), Whitfield+Sarah Tue (soft stop).

## Sheet structure
- One row-block per calendar week; columns Sunday → Saturday.
- Block rows: `DATE`, `TYPE`, `ROUNDERS` (multi-line), `PAGER`, `CLINIC`, `DIDACTICS`, `PTO`, `OFF`.
- Header above grid: month/year ("August 2025") + weekday of the 1st ("FRIDAY"); sheet tab named after the anchor type ("Pre-Call").
- Color language: TYPE cells blue except CALL = red/pink; ROUNDERS block light blue; PAGER row green; CLINIC row yellow; DIDACTICS row pink/red tint; PTO row orange; OFF row pink. Days before the month starts = dark gray blanks.

## Week of Aug 3–9, 2025
| Row | Sun 3 | Mon 4 | Tue 5 | Wed 6 | Thu 7 | Fri 8 | Sat 9 |
|---|---|---|---|---|---|---|---|
| TYPE | PC | PPC | SC1 | SC2 | PRECALL | **CALL** | PC |
| ROUNDERS | Sarah (postcall)<br>Jared (postcall) | Sarah<br>Jared | Sarah<br>Whitfield | Sarah<br>Whitfield - 1/2 off<br>Reyes | Reyes - 1/2 off<br>Whitfield | Day - Sarah<br>Day - Jared<br>Night - Whitfield<br>Night - Reyes | Whitfield (postcall)<br>Reyes (postcall)<br>Sarah |
| PAGER | Whitfield | Reyes | Reyes | **Dr. Williams** | Jared | — (call day) | Jared |
| CLINIC | — | Jared, Sarah + noon meeting | — | Whitfield, Reyes, Sarah | Whitfield | — | — |
| DIDACTICS | — | — | Sarah, Whitfield | Jared [?] | Reyes | — | — |
| PTO | — | — | — | — | — | — | — |
| OFF | Reyes | Whitfield | Jared | — | Sarah | — | — |

Notation seen elsewhere in the sheet (must be renderable):
- `X - 1/2 off` (half-day off, appears in ROUNDERS)
- `X (postcall)` tag; `Sarah - off`, `Jared - off` inline in ROUNDERS; `Sarah (less pts!)`, `Sarah - AM` freeform annotations
- `Day - <name>` / `Night - <name>` lines on CALL days
- Attending as pager holder (`Dr. Williams`)
- Clinic cell freeform: `Sarah + mtgs 10-11 and 12-1`, `Day - Sara* 9:30-4pm mtgs`
- `Whitfield (ICU Nights)` (person elsewhere-rotation note, week of Aug 1)

## Right-side summary table (whole-month totals; 0.5 increments)
| Resident | Pager | Clinic | Didactics | Off | PTO | Bonus |   | Off + Bonus |
|---|---|---|---|---|---|---|---|---|
| Reyes | 9.0 | 4.0 | 2.0 | 5.0 | – | 3.0 | | 8.0 |
| Jared | 7.0 | 3.0 | 1.0 | 5.0 | – | 3.5 | | 8.5 |
| Whitfield | 5.0 | 6.0 | 2.0 | 5.0 | 1.0 | 1.0 | | 6.0 |
| Sarah | 4.0 | 8.0 | 2.0 | 4.5 | – | 1.5 | | 6.0 |

## Side sections (below totals)
- **Notes**: per-person didactics day + stop hardness (`Jared — Wed Didactics — hard stop*`, `Reyes — Thu Didactics — hard stop`, `Whitfield + Sarah — Tue Didactics — soft stop`).
- **Potential Issues**: dated free-text list (`Aug 6th: Pager … Jared or attending? Didactics day`, `Aug 21: Reyes will miss didactics`). Tool's warnings panel + export mirror this.
