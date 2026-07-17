# PRODUCT.md — Medicine Team Scheduler

**register:** product (a tool; design serves the task)

## What it is
A single self-contained HTML file that builds an optimal monthly inpatient-medicine
call schedule (6-day call cycle: pre-call → call → post-call → post-post-call → short-call-1 →
short-call-2) via an exact MILP solver (HiGHS-in-WASM). Chief residents open it in any
browser on Windows/Mac with zero install, set up their team, Solve, iterate with pins, and
export a styled xlsx / print a PDF to share.

## Who uses it, where
A chief resident at a laptop — often late, tired, under fluorescent light — building next
month's team schedule. They need to (1) enter a roster + commitments quickly, (2) trust the
solved grid at a glance, (3) nudge it with pins and re-solve without the whole month
reshuffling, (4) hand a clean, colored schedule to the team. High-legibility, dense data,
calm and clinical. Not flashy. The tool should disappear into the task.

## Scene sentence
9pm, workstation, fluorescent light: scan a dense call grid and trust it, fix one cell, re-solve, print.

## Primary flows
1. **Set up** — team, month, anchor phase, off-quota, golden-weekend; roster (role/kind/service
   window/didactics); commitments, PTO, and pins on a per-resident month grid.
2. **Solve** — one button; hard errors block it, an independent auditor flags soft "Potential Issues".
3. **Iterate** — click a calendar cell to pin an assignment; freeze-through a date so early weeks
   stay put; re-solve.
4. **Ship** — export styled xlsx (matches the on-screen color language) or print to PDF.

## Design register & strategy
- **Restrained** chrome (neutral surfaces + one clinical-blue accent for primary action / selection /
  focus). The **calendar itself is the data layer** and keeps its semantic multi-color fills — those
  fills are the shared "Google-Sheet" color language and must match the xlsx export exactly.
- One type family (tuned system sans), fixed rem scale, tabular numerals in data tables.
- Familiar product affordances only (native `<dialog>`, native form controls, `title` tooltips).

## Non-negotiables
- Ships as ONE self-contained `dist/med-scheduler.html` (no external refs). Deps stay exactly
  `exceljs` + `highs`.
- Solver (`milp.js`) and independent auditor (`audit.js`) semantics are frozen — never touched by design work.
- Calendar DOM contract (classes, `data-*`, totals columns) is asserted by tests; recolor via CSS only.
