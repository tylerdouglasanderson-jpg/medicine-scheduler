// What's new, newest first — plain language for chief residents, not developers.
// Shown by the version chip in the app bar AND mirrored in src/ui/guide.html ("What's new").
// test/discoverability.test.js fails if a version or item here is missing from the guide, so edit both.
// The first entry's version must equal package.json's version.
export const CHANGELOG = [
  {
    version: '1.16.0', date: '2026-10-23',
    items: [
      'Publish to team is now easy to find: the Export menu is now called Share, and its team section reads Publish to team with a Publish button (Update team schedule once a link is live)',
      'A status chip beside Share always shows whether the team sees your latest draft: green Team sees vN in sync, or amber Draft has changes since publish. Click the amber chip to see what changed',
      'Compare shows your draft against what the team sees: how many days differ, who is affected, and each person\'s before and after counts, with Update and Revert right there. Each team link has a Compare button too',
      'Click a calendar cell and the box now starts with Why?: who else could have had that slot, one line on why each blocked person could not, and how the person\'s counts compare with the team',
      'Buttons are grouped by what you are doing: Save holds save as a file, save online (PIN), open and Clear scenario; Share holds Publish to team and the export files; Help holds the Comprehensive Guide, How it solves, ACGME rules and What\'s new',
      'Quick How-To has moved next to the title and is rewritten in three short phases (Set up, Solve and review, Share), with senior tips and the step to send an Excel or PDF to the chiefs for approval before publishing. New visitors also see a New here? 6 steps tip above Setup',
      'Scrollbars now match the app (slim, rounded and themed) on both the app and the phone calendar',
      'In Revise this plan the last lines of each column can no longer hide behind the bottom bar',
    ],
  },
  {
    version: '1.15.1', date: '2026-10-22',
    items: [
      'The phone calendar now says what each commitment is next to the name, using the label you typed: Smith (Clinic FHC), Jones (ITE). Several on one day read Smith (Clinic FHC + ITE)',
      'The phone calendar spells out roles: the first section is headed Rounders instead of Working, and call days read Day call - Smith and Night call - Jones instead of Day and Night',
      'The Export menu is laid out in three tidy columns (spreadsheet and print, calendar files, phone team link) so it no longer scrolls, and the QR code for a team link opens in its own pop-up with the link underneath, over a dimmed page',
      'Phone team links now stay up for a year after they were last opened (saved sessions still go after 90 days)',
      'A Collapse all button at the top right of Potential Issues hides or shows the whole list; the groups inside keep their own arrows',
      'Print / Save as PDF leaves out the green saved-session bar with the PIN',
      'The Open by PIN pop-up is tidier: a large centred PIN box that accepts digits only, a full-width Open session button that switches on at 6 digits, and a note that opening replaces the month on screen',
      'The Phone team link section now says at a glance whether the schedule shown matches the one the team sees: a green tick when they agree, a red cross when you have changed or re-solved since the last Update',
      'The phone page now shows its Updated time in US Central time (Fort Worth), with CDT or CST, instead of the server clock',
      'Clear scenario no longer endangers a saved session: it now says the saved session (PIN) is left alone, and the page stops saving into it, so a blank month can never overwrite it. Open by PIN brings the session back',
      'Each team link now has a Revert draft to this button: it puts your working draft back to exactly what that link was last published from (the full schedule is kept privately, never on the phone page). A confirm comes first and Undo revert brings your previous draft back until you reload. Links published before this show it greyed out; click Update once to enable it',
      'The browser tab now shows a small calendar icon (a blue month with one amber day) instead of the blank default',
    ],
  },
  {
    version: '1.15.0', date: '2026-10-22',
    items: [
      'A saved session on the website: Save online makes a 6-digit PIN (write it down), and from then on every change saves by itself. Open a saved session with that PIN from any computer. Sessions are deleted 90 days after they were last opened, and anyone with the PIN can open one',
      'The green bar at the top shows the session PIN. If a newer version was saved from another computer, the bar turns amber with Not saved and offers Load that version or Keep mine (replace it)',
      'Export now has a Phone team link: Publish team link (after Save online) gives a short three-word link to a read-only phone calendar with a week strip, a day card you can swipe, a Me or Everyone switch, and a month grid in landscape. It can be added to the home screen and works offline after the first open',
      'Update team link replaces the schedule behind the same link, Publish as a new link makes another, and each link in the list has Copy, Update and Stop sharing. A link stays up for a year after it was last opened. Download phone view (.html) saves the same calendar as a single file',
      'The phone calendar is built from the same text as the Excel export, and a test compares every cell of 43 scenarios, so the two never disagree',
    ],
  },
  {
    version: '1.14.1', date: '2026-10-22',
    items: [
      'The two-person team pop-up now has exactly three choices: The intern takes nights, the senior takes days; Both work every day, cross-cover has the nights; or I’ll pin it myself. The earlier senior-takes-every-night and share-the-nights choices are gone',
      'Choosing cross-cover nights schedules the senior and the intern on every day, shows Night - cross-cover on those call days, and leaves no post-call sleeper, because the cross-cover person who covers the night is not scheduled here',
    ],
  },
  {
    version: '1.14.0', date: '2026-10-22',
    items: [
      'A new pop-up appears when you press Solve on a month with a two-person team (one senior and one intern on service). It asks how to run those days: The intern takes every night, The senior takes every night, Work the days together, share the nights, or I’ll pin it myself',
      'The two Takes every night choices fill in both calendars for you (night call for one, day call for the other) and allow that person to work back-to-back nights, which the scheduler otherwise never does. You can change any filled-in day afterward, and Setup has a Two-person team row with a Choose how… button to pick again',
    ],
  },
  {
    version: '1.13.0', date: '2026-10-22',
    items: [
      'On a wide screen the page now opens in two-column view, with your inputs on the left and the results on the right. A narrow screen stays single-column. The results panel always has a button to switch: Return to single-column view, or Return to two-column view',
      'Re-solve automatically is now on by default. You can still switch it off in the two-column view',
      'Setup tidy-up: the note under Allow seniors off on short-call days is reworded, and Limit senior pager days to now lines up with the other preferences, with No limit, 0, 1, 2, 3 and 4 as buttons on its right',
      'The bottom bar (Solve, Freeze through, Save my month, Export, Clear scenario) now always stays at the bottom of the screen, even when every section is collapsed and the page is short',
      'The empty page now offers two example months to load: a 3-person team all month (Medicine B, Feb 2026) and a 3-person team that becomes a 2-person team on the 16th (Medicine A, Oct 2026)',
    ],
  },
  {
    version: '1.12.0', date: '2026-10-22',
    items: [
      'New Force One Person Only and Force Two People Only buttons make a day run with exactly one or exactly two people. Everyone else who is free that day gets a bonus day off that does not count against the quota. Click dates one after another with no dialog; click the same mode again to remove a date. Old 1 person OK days load as Force One Person Only',
      'Commitment buttons remember the last label you typed (starting at clinic). Pin and mode buttons are renamed in Title Case: PTO Day, PIN:OFF DAY, PIN:Must Work, PIN:Pager, PIN:Day, PIN:Night, PIN:Half Off AM and PIN:Half Off PM',
      'Setup has a tidier Preferences group. The off quota hint says it is per month and pro-rated (normally leave it at 4), and a new, not advised preference Allow more than the quota of days off lets the solver exceed it only when a month cannot be staffed otherwise',
      'The roster name column is now Last name, the example month uses sample last names, and interns get Hard didactics ticked automatically',
      'On a wide screen the first Solve now puts your inputs on the left and the results on the right automatically. The buttons read Return to single-column view and Return to two-column view',
      'Every control now has a longer, fuller tooltip that was checked against what the code does',
      'Print / Save as PDF is cleaner: the title reads Final Results, there is no collapse button, byline or Potential Issues, two weeks fit on each landscape page, and tables stay inside the page width',
      'The Export menu exports one solution at a time, the one on screen by default, and says which. Calendar (.ics) files are for Outlook, Google or Apple Calendar; the Excel spreadsheet is for working through the month or sending to the chief; Print makes a PDF',
      'Fixed the solver ignoring its preference for a senior when only one person works, and a crash when opening the side-by-side view on a wide screen',
    ],
  },
  {
    version: '1.11.0', date: '2026-10-21',
    items: [
      'Each day box in the Commitments / PTO / Pins calendars now shows the team’s call-cycle day in the top-right corner (SC1, SC2, PRE-C, CALL, PC for post-call, PPC), so you can see what the team is doing while you edit one person',
    ],
  },
  {
    version: '1.10.0', date: '2026-10-21',
    items: [
      'A new Revise this plan button above the results (laptop or monitor screens) puts your inputs on the left and the schedule on the right, each scrolling on its own. Edit PTO, clinics or pins and the old schedule stays greyed until you press Solve, or turn on Re-solve automatically to update it as you go. Days that moved are outlined for a few seconds. Press Done to return to the one-column page',
    ],
  },
  {
    version: '1.9.1', date: '2026-10-21',
    items: [
      'The Limit senior pager days to setting now also accepts 0, which asks the solver to keep seniors off the pager when it can',
    ],
  },
  {
    version: '1.9.0', date: '2026-10-21',
    items: [
      'A new optional Limit senior pager days to setting (1 to 4, under Preferences) asks the solver to keep each senior at or under that many pager days. It is a soft goal: if the month cannot work that way it goes over, and still keeps senior pager days as low as it can. A warning lists any senior who ends up over the limit. Also, the “results are here” pop-up now says you can click a day in the results calendar to change its pin while you review',
    ],
  },
  {
    version: '1.8.0', date: '2026-10-21',
    items: [
      'A new 1 person OK mode in the Commitments calendar lets you mark any date where the schedule may have just one person working (normally at least 2 are needed). Click the date, then optionally name who works alone, or leave it on Solver chooses and it prefers a senior. It only allows it; the solver still uses two or more when it can. The results say “Only X is scheduled on D, as you allowed.” and nothing changes in the Excel file. Days that already drop to one person on their own (Med C, two-person teams, heavy PTO) need no marking',
      'When a Solve finishes, a pop-up now says your results are here and how to change a single day (add a pin in Commitments / PTO / Pins, then Solve again). Closing it gently scrolls the page down to the results. Tick Don’t show this again to skip the pop-up and just scroll',
    ],
  },
  {
    version: '1.7.0', date: '2026-10-21',
    items: [
      'A Quick How-to pop-up (six short steps) now opens the first time someone visits, and from the new Quick How-to button in the header. The Guide button is now Comprehensive Guide. Each big section (Setup, Roster, Commitments, Errors, Results) has a Collapse button at its top right to minimize it while you work on the rest; your choice is remembered',
    ],
  },
  {
    version: '1.6.0', date: '2026-10-21',
    items: [
      'Transitional interns now get Wednesday PM didactics selected automatically (greyed out, since it is every other week). A new Didactics (PM) mode in the calendar lets you click just the Wednesdays that have it. They count like any didactics: protected from days off and the pager, balanced across the team, and shown in the totals, the export and the calendar invite. A warning appears if none are picked',
    ],
  },
  {
    version: '1.5.0', date: '2026-10-21',
    items: [
      'Transitional interns: nothing is assumed for their every-other-Wednesday didactics any more. Choosing Transitional pops up instructions to enter those Wednesdays as PM commitments on their calendar',
    ],
  },
  {
    version: '1.4.4', date: '2026-10-21',
    items: [
      'Fixed: “Download & open Google Sheets” opened Sheets but did not download the file (1.4.3 only)',
    ],
  },
  {
    version: '1.4.3', date: '2026-10-21',
    items: [
      'Export to Google Sheets: “Download & open Google Sheets” now first explains the steps (file lands in Downloads, then File, Open, Upload). The bonus grid starts empty: put an X in a box to give a day or half day. Shorter grid title that no longer overflows',
    ],
  },
  {
    version: '1.4.2', date: '2026-10-21',
    items: [
      'Google Sheets export: row heights now fit their text instead of stretched fixed heights, and the bonus tick grid says plainly how to turn it into checkboxes (Sheets cannot import them from Excel files: select the grid, choose Insert, then Checkbox)',
    ],
  },
  {
    version: '1.4.1', date: '2026-10-21',
    items: [
      'The “Fewer than 1 rest day in 7” warning now needs only floor(service days ÷ 7) days off (4 for a full month, 2 for a two-week seat) and counts actual days off only, not PTO',
    ],
  },
  {
    version: '1.4.0', date: '2026-10-21',
    items: [
      'Weekday names (Sunday–Saturday) now head every calendar: each resident’s days-off picker, the solved calendar, and the spreadsheet',
      'The “Off (free / bonus)” pin is gone from the pickers — bonus days can no longer be added by hand. Bonus days the scheduler gives still show in the output',
      'Spreadsheet: the Potential Issues list is no longer written to the file (it still shows on the solution page)',
      'User guide: new “6a. How it solves” page — a short list of every rule and priority the solver uses, including how seniors’ days off are prioritized (pre-call first, then PPC and weekend short call, weekday short call last; post-call and call days are never offs)',
      'New “How it solves” button in the top bar: the same list as a bulleted pop-up',
      'New “2026 ACGME rules” button in the top bar: the resident work-hour rules (80 hours, 1 day in 7, 24+4, 14 hours after 24, every third night, and more) with a boxed ↗ link on each rule that opens the exact page of the ACGME document',
      'User guide: the pin table now lists 6 pin types, and the short-call/off-day preference text matches how the solver really behaves',
    ],
  },
  {
    version: '1.3.0', date: '2026-10-17',
    items: [
      'Spreadsheet: every total in the box is now a live formula over the calendar — Shifts, Pager, Clinic/Obligation, Didactics, Off, PTO, Days, Perks (half days), Off + Bonus and PM off — so editing the calendar by hand keeps the totals right',
      'Spreadsheet: today is highlighted on the calendar (the date cell darker and bold, the rest of that day pale) and moves on by itself each day',
      'Spreadsheet: Bonus is now Days and Perks is Perks (half days) under a shared Bonus/Off header; Clinic is renamed Clinic/Obligation; Off + Bonus counts each half day (Perks) as half a day',
      'Spreadsheet: the bonus-days grid now starts empty (days the scheduler already gave are counted from the calendar, shown as “(bonus)” and “1/2 off”)',
    ],
  },
  {
    version: '1.2.0', date: '2026-10-08',
    items: [
      'Spreadsheet: a “bonus days given” grid under the totals — tick Day (bonus day off) or AM / PM (half day) for anyone, and their Shifts, Bonus, Perks and Off + Bonus totals update by themselves. Days the scheduler already gave are pre-ticked; a box turns red if that person is already off that day, or if both a half and the whole day are ticked',
      'Spreadsheet totals are boxed and colour-coded: green headers are the numbers the grid changes',
    ],
  },
  {
    version: '1.1.1', date: '2026-10-07',
    items: [
      'User guide: the post-call pager section now explains who holds it when the day-call intern has just rotated off the team',
    ],
  },
  {
    version: '1.1.0', date: '2026-10-07',
    items: [
      'New “PM off” number: afternoons off per resident — days they round in the morning with nothing in the afternoon (no pager, clinic, didactics or other block). Weekends count; call and post-call days never do. It is shown in the totals table, the solution comparison and the spreadsheet, for information only — the scheduler does not solve for it',
      'A commitment that isn’t clinic is now named in the CLINIC row with its own label — “Smith (ITE)”, or “(other commitment)” if it has no label — instead of looking like clinic',
      'Fixed: on a post-call day when the day-call intern has just rotated off the team, the incoming intern now holds the pager (it used to hand it to the wrong person and flag its own schedule as broken)',
    ],
  },
  {
    version: '1.0.1', date: '2026-10-06',
    items: [
      'The downloaded app no longer includes the website’s anonymous visit counter — it sends nothing unless you use Report a problem',
      'User guide: the list of Potential Issues codes is corrected and complete',
    ],
  },
  {
    version: '1.0.0', date: '2026-10-06',
    items: [
      'Every Solve now gives up to 5 different schedules that all follow the rules — flip between them with the Solution tabs; each tab says how it differs from Solution 1',
      'Export one solution or all of them (one spreadsheet with a sheet per solution; calendars in one zip)',
      'Save my month keeps all your solutions in the file, so you can reopen it or send it to a co-chief',
      'Bigger “Report a problem” button that sends us your schedule',
      'Download button now gets you the newest app file directly',
      'This What’s new list',
      'Two seniors + one intern: the intern strictly alternates call nights (never back-to-back, and it picks up from last month’s last night); in a 31-day month one senior takes a second night',
      "Half days off are now extra freebies — they never count toward anyone's days off",
      'A half day off can no longer sit on top of a clinic in the same half, counts as missing didactics if it lands on them, and shows correctly in calendar files',
    ],
  },
  {
    version: '0.9.0', date: '2026-10-06',
    items: [
      'Weekend short call no longer needs a senior — seniors can take those days off',
      'New setting: Allow seniors off on short-call days (for months when interns admit on their own)',
      'New setting: Have a senior present on the 1st',
      'Two-person teams (1 intern + 1 senior) now work: one resident runs the day while the other is off',
    ],
  },
  {
    version: '0.8.0', date: '2026-08-27',
    items: [
      'Download each resident’s schedule as a calendar file (works with Google/Apple/Outlook calendars)',
      'Cleaner spreadsheets, plus a button to open in Google Sheets',
    ],
  },
  {
    version: '0.7.0', date: '2026-08-19',
    items: [
      'Nobody is listed for didactics on call or post-call days',
      'Interns are kept off the pager during their own didactics whenever a senior can cover',
    ],
  },
  {
    version: '0.6.0', date: '2026-08-19',
    items: [
      'Everyone’s didactics are protected, not just the senior’s',
      'Pager, clinic and didactics afternoons are shared fairly',
      'One-click “Attending covers the pager” when nobody else is free',
      'Months saved under older rules update automatically when you press Solve',
    ],
  },
  {
    version: '0.5.0', date: '2026-07-20',
    items: [
      'Everyone always gets their full days off',
      'Morning Report days keep enough people on',
      'Days off land on the lightest days of the cycle',
    ],
  },
  {
    version: '0.4.6', date: '2026-07-20',
    items: ['Morning Report days are marked on the calendar and spreadsheet'],
  },
  {
    version: '0.4.5', date: '2026-07-20',
    items: ['Clear scenario button', 'Clearer resident-type labels'],
  },
  {
    version: '0.4.4', date: '2026-07-18',
    items: ['Feedback button'],
  },
  {
    version: '0.4.0–0.4.3', date: '2026-07-18',
    items: [
      'Didactics day fills in automatically from each resident’s type',
      'Roster fits on screen',
      'Guide links fixed',
    ],
  },
  {
    version: '0.3.0–0.3.1', date: '2026-07-17',
    items: [
      'Days off never land on clinic days',
      'Seniors steered away from being off on the 1st',
      'One-click “Click me” launcher in the download',
    ],
  },
  {
    version: '0.2.0', date: '2026-07-17',
    items: ['New look, built-in user guide, and a “Load example” month'],
  },
];
