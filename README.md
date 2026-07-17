# Medicine Team Scheduler

A single self-contained HTML file that builds an optimal monthly inpatient-medicine
call schedule (6-day call cycle: pre-call → call → post-call → post-post-call →
short-call-1 → short-call-2) using an exact MILP solver ([HiGHS](https://highs.dev/)
compiled to WebAssembly). Open it in any browser on Windows or Mac — **zero install,
works offline, your data never leaves your computer.**

## ⬇️ Download

**[Download the app (latest release)](../../releases/latest/download/med-scheduler.html)**
— one file. Save it, double-click it, done.

- **[User guide](../../releases/latest/download/med-scheduler-guide.html)** — full how-to.
- **[Starter bundle (.zip)](../../releases/latest/download/Medicine-Scheduler.zip)** —
  app + guide + example schedules + a "START HERE" note, for sharing with a team.

## What it does

- Solves the whole month exactly (not a greedy heuristic) — call/night split, pager
  coverage, 4-offs quota (prorated for split service windows), clinics & didactics.
- An **independent auditor** re-checks every hard rule separately from the solver, so a
  clean schedule is genuinely verified, not self-graded.
- **Pin** any cell (night, day-call, pager, off, work) and re-solve — early weeks stay
  put via freeze-through-date, so one fix doesn't reshuffle the month.
- Flags soft "Potential Issues" (e.g. a forced didactics miss) without blocking.
- Export a styled **.xlsx** (colors match the on-screen grid) or **print to PDF**.

## Use it in 4 steps

1. Double-click `med-scheduler.html` — it opens in your browser.
2. Click **Load example** (or Load Scenario → pick a file from `scenarios/`).
3. Click **Solve**. Read the calendar and the totals.
4. Enter your own team (residents, clinics, PTO), Solve, pin & re-solve, then Export.

Full instructions, every field and pin type: see the **User guide**.

## For developers

Vanilla JS + [Vite](https://vitejs.dev/) (single-file build), HiGHS-WASM solver,
[ExcelJS](https://github.com/exceljs/exceljs) for export, Vitest for tests.

```bash
npm install
npm run dev            # local dev server
npm test               # full test suite (solver properties + independent auditor)
npm run smoke          # solve every scenario in scenarios/ and check accuracy
npm run build          # emits the single-file dist/med-scheduler.html
```

- `src/milp.js` builds the optimization model; `src/audit.js` re-implements every hard
  rule **independently** (never share eligibility helpers — the auditor's value is that
  it can disagree with the solver).
- `scenarios/` + `npm run smoke` is a self-contained smoke-test harness: it runs each
  scenario through the real solver + auditor and reports whether inputs were honored.
  See `scenarios/README.md`.

## Versioning

Releases are tagged (`vMAJOR.MINOR.PATCH`) and each carries the built single-file app,
the guide, and the starter zip as downloadable assets. The download links above always
resolve to the newest release.

## License

MIT — see [LICENSE](LICENSE).
