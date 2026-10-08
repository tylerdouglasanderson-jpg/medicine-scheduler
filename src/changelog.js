// What's new, newest first — plain language for chief residents, not developers.
// Shown by the version chip in the app bar AND mirrored in src/ui/guide.html ("What's new").
// test/discoverability.test.js fails if a version or item here is missing from the guide, so edit both.
// The first entry's version must equal package.json's version.
export const CHANGELOG = [
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
