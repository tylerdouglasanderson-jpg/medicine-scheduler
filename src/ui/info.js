// Plain-language reference content for the two header pop-ups: "How it solves" and "2026 ACGME rules".
// Keep CRITERIA in step with the guide's §6a (src/ui/guide.html) and with RULES.md; keep ACGME in step
// with the 2026 Common Program Requirements PDFs it links to (page numbers are PDF pages).

const CPR = 'https://www.acgme.org/globalassets/pfassets/programrequirements/2026-prs/cprresidency_2026.pdf';
const IM = 'https://www.acgme.org/globalassets/pfassets/programrequirements/2026-prs/140_internalmedicine_2026.pdf';

export const CRITERIA = [
  { heading: 'Never broken', items: [
    '1 night person per call day, who sleeps the next day',
    'Everyone works a call day',
    'No offs on call, post-call, or commitment days',
    'Exact off quota for everyone (pro-rated for part-month seats)',
    '1 pager holder every non-call day, never someone who is off, asleep, or in a PM commitment',
    'Post-call pager goes to the day-call intern (a senior only if no intern can)',
    'At least 2 working every day',
    '2 seniors + 1 intern: the intern takes every other night',
    'Your pins, PTO, service windows and chosen attending days are honored',
  ] },
  { heading: 'Almost never broken', items: [
    'No back-to-back call nights for the same person',
    'No off on a protected (hard) didactics day',
    'The attending covers the pager only as a last resort',
  ] },
  { heading: 'Balanced as well as possible', items: [
    'Shifts worked, as a share of each person’s service days',
    'Interns split night call and day call evenly',
    'Afternoon load (PM clinic, didactics, pager) spread across the team',
    'Missed didactics spread across the team',
    'About one day off per calendar week',
  ] },
  { heading: 'How do we prioritize off days for seniors?', items: [
    'Pre-call is the first choice for a senior’s off day (not a Tuesday/Thursday Morning Report pre-call)',
    'Then PPC (the day after post-call), and weekend short call',
    'Weekday short call 2, then weekday short call 1, are the last choices: seniors are wanted there for admissions',
    'Day 1 of the month is also avoided for senior offs',
    'Post-call and call days are never offs',
    'Chiefs can lift the short-call preference with “Allow seniors off on short-call days”',
  ] },
  { heading: 'Other off-day preferences', items: [
    'Avoid offs on Morning Report days; keep a senior and an intern present',
    'Avoid two people off the same day',
    'Optional: Sat + Sun both off (golden weekend)',
    'Re-solving changes as little of the existing schedule as possible',
  ] },
];

export const ACGME = {
  title: '2026 ACGME rules',
  intro: 'ACGME Common Program Requirements (Residency), effective July 1, 2026. These apply to interns and seniors alike; the Internal Medicine requirements repeat them word for word. Click ↗ to open the exact page of the primary source.',
  rules: [
    { ref: '6.20', title: 'Weekly hours', text: '80 hours a week maximum, averaged over 4 weeks. Counts in-house work, clinical work done from home, and all moonlighting.', page: 47 },
    { ref: '6.21', title: 'Time off between shifts', text: 'Residents should have 8 hours off between scheduled clinical and educational work periods.', page: 48 },
    { ref: '6.21.a', title: 'After 24 hours in-house', text: 'At least 14 hours free of clinical work and education after 24 hours of in-house call.', page: 49 },
    { ref: '6.21.b', title: 'One day in seven', text: 'At least 1 day in 7 free of clinical work and required education, averaged over 4 weeks. No at-home call on those days. A day off is one continuous 24-hour period.', page: 49 },
    { ref: '6.22', title: 'Longest work period', text: '24 hours of continuous scheduled clinical work at most.', page: 49 },
    { ref: '6.22.a', title: 'Extra 4 hours', text: 'Up to 4 more hours for handoffs, patient safety, or education. No new patient care assigned in that time.', page: 49 },
    { ref: '6.24', title: '88-hour exceptions', text: 'A Review Committee may allow rotation-specific exceptions up to 88 hours. Enforcement is currently suspended pending the Common Program Requirements revision.', page: 50 },
    { ref: '6.25', title: 'Moonlighting', text: 'Counts toward the 80 hours. PGY-1 residents are not permitted to moonlight (6.25.b).', page: 51 },
    { ref: '6.26', title: 'Night float', text: 'Must fit within the 80-hour and one-day-off-in-seven limits. The Review Committee may add caps on consecutive weeks or months.', page: 51 },
    { ref: '6.27', title: 'In-house call frequency', text: 'No more often than every third night, averaged over 4 weeks.', page: 51 },
    { ref: '6.28', title: 'At-home call', text: 'Patient care time counts toward the 80 hours; not limited to every third night, but the 1-in-7 rule still applies.', page: 51 },
  ],
  sources: [
    { label: 'Common Program Requirements (Residency), 2026 PDF', href: CPR },
    { label: 'Internal Medicine requirements, 2026 PDF (section 6.20 on page 62)', href: `${IM}#page=62` },
  ],
  note: 'The scheduler plans days and call, not clock hours. It guarantees one night person with a sleep day after, an exact off quota, and warns on fewer than 1 rest day in 7 (whole month) or more than 6 days in a row. Weekly hours, 24+4, and 8 hours between shifts depend on your real shift times and are not calculated.',
  link: page => `${CPR}#page=${page}`,
};
