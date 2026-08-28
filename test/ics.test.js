import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildResidentCalendar, buildCalendarsZip, calendarFilename } from '../src/ics.js';

const scenario = {
  team: 'D',
  month: '2026-10',
  anchorType: 'call',
  residents: [
    {
      name: 'Senior One', role: 'senior', kind: 'categorical',
      serviceStart: '2026-10-01', serviceEnd: '2026-10-31',
      didactics: { dow: 2, half: 'PM', hard: false },
      commitments: [{ date: '2026-10-06', half: 'PM', label: 'Clinic FHC' }],
      pto: ['2026-10-07'],
    },
    {
      name: 'Intern One', role: 'intern', kind: 'categorical',
      serviceStart: '2026-10-01', serviceEnd: '2026-10-31',
      didactics: null, commitments: [], pto: [],
    },
  ],
};

const schedule = {
  days: {
    '2026-10-01': {
      type: 'call', working: ['Senior One', 'Intern One'], off: [], sleeper: null,
      pager: null, night: 'Intern One', dayCall: { senior: 'Senior One', intern: null },
    },
    '2026-10-02': {
      type: 'postcall', working: ['Senior One'], off: [], sleeper: 'Intern One',
      pager: 'Senior One', night: null, dayCall: null,
    },
    '2026-10-03': {
      type: 'ppc', working: ['Senior One', 'Intern One'], off: [], sleeper: null,
      pager: 'Senior One', night: null, dayCall: null,
    },
    '2026-10-04': {
      type: 'sc1', working: ['Senior One', 'Intern One'], off: [], sleeper: null,
      pager: 'Senior One', night: null, dayCall: null,
    },
    '2026-10-05': {
      type: 'sc2', working: ['Senior One', 'Intern One'], off: [], sleeper: null,
      pager: 'Intern One', night: null, dayCall: null,
    },
    '2026-10-06': {
      type: 'precall', working: ['Senior One', 'Intern One'], off: [], sleeper: null,
      pager: 'Senior One', night: null, dayCall: null,
    },
    '2026-10-07': {
      type: 'call', working: ['Intern One'], off: [], sleeper: null,
      pager: null, night: 'Intern One', dayCall: { senior: null, intern: null },
    },
    '2026-10-08': {
      type: 'postcall', working: [], off: ['Senior One'], sleeper: 'Intern One',
      pager: 'ATTENDING', night: null, dayCall: null,
    },
  },
  totals: {},
};

const stamp = new Date('2026-08-27T12:00:00Z');

function unfold(ics) {
  return ics.replace(/\r\n[ \t]/g, '');
}

describe('per-resident iCalendar export', () => {
  it('creates one combined duty event and extends it through pager coverage', () => {
    const ics = unfold(buildResidentCalendar(scenario, schedule, 'Senior One', { now: stamp }));

    expect(ics).toContain('BEGIN:VTIMEZONE');
    expect(ics).toContain('TZID:America/Chicago');
    expect(ics).toContain('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU');
    expect(ics).toContain('SUMMARY:Rounding\\, Pager Duty');
    expect(ics).toContain('DTSTART;TZID=America/Chicago:20261003T070000');
    expect(ics).toContain('DTEND;TZID=America/Chicago:20261003T170000');
    expect(ics).toContain('SUMMARY:Short Call 1 — No Call\\, Pager Duty');
    expect(ics).toContain('DTSTART;TZID=America/Chicago:20261004T070000');
    expect(ics).toContain('SUMMARY:Short Call 2');
    expect(ics).toContain('DTSTART;TZID=America/Chicago:20261005T060000');
  });

  it('exports night call and an overlapping same-date post-call event for the night resident', () => {
    const ics = unfold(buildResidentCalendar(scenario, schedule, 'Intern One', { now: stamp }));

    expect(ics).toContain('SUMMARY:Night Call — end varies with rounding');
    expect(ics).toContain('DTSTART;TZID=America/Chicago:20261001T173000');
    expect(ics).toContain('DTEND;TZID=America/Chicago:20261002T120000');
    expect(ics).toContain('Actual departure varies with rounding\\, typically 9:00 AM–2:00 PM.');
    expect(ics).toContain('SUMMARY:Post Call — Off After Rounds');
    expect(ics).toContain('DTSTART;TZID=America/Chicago:20261002T060000');
    expect(ics).toContain('DTEND;TZID=America/Chicago:20261002T170000');
  });

  it('adds next-month post-call after a night shift on the final day of the schedule', () => {
    const edgeSchedule = {
      days: {
        '2026-10-31': {
          type: 'call', working: ['Intern One'], off: [], sleeper: null,
          pager: null, night: 'Intern One', dayCall: { senior: null, intern: null },
        },
      },
      totals: {},
    };
    const ics = unfold(buildResidentCalendar(scenario, edgeSchedule, 'Intern One', { now: stamp }));

    expect(ics).toContain('DTEND;TZID=America/Chicago:20261101T120000');
    expect(ics).toContain('SUMMARY:Post Call — Off After Rounds');
    expect(ics).toContain('DTSTART;TZID=America/Chicago:20261101T060000');
    expect(ics).toContain('DTEND;TZID=America/Chicago:20261101T170000');
  });

  it('adds overlapping obligations and morning report with pager status made explicit', () => {
    const ics = unfold(buildResidentCalendar(scenario, schedule, 'Senior One', { now: stamp }));

    expect(ics).toContain('SUMMARY:Clinic FHC\\, Pager Duty');
    expect(ics).toContain('DTSTART;TZID=America/Chicago:20261006T130000');
    expect(ics).toContain('DTEND;TZID=America/Chicago:20261006T170000');
    expect(ics).toContain('SUMMARY:Didactics\\, Pager Duty');
    expect(ics).toContain('SUMMARY:Morning Report');
    expect(ics).toContain('DTSTART;TZID=America/Chicago:20261006T110000');
    expect(ics).toContain('DTEND;TZID=America/Chicago:20261006T113000');
  });

  it('includes PTO and OFF as all-day events using exclusive end dates', () => {
    const ics = unfold(buildResidentCalendar(scenario, schedule, 'Senior One', { now: stamp }));

    expect(ics).toContain('SUMMARY:PTO\r\nDTSTART;VALUE=DATE:20261007\r\nDTEND;VALUE=DATE:20261008');
    expect(ics).toContain('SUMMARY:OFF\r\nDTSTART;VALUE=DATE:20261008\r\nDTEND;VALUE=DATE:20261009');
  });

  it('rejects an unknown resident rather than producing an empty calendar', () => {
    expect(() => buildResidentCalendar(scenario, schedule, 'Nobody', { now: stamp }))
      .toThrow('Unknown resident: Nobody');
  });
});

describe('calendar files and ZIP', () => {
  it('uses Windows-safe filenames', () => {
    expect(calendarFilename('Lee: Night/Float', '2026-10')).toBe('Lee- Night-Float-2026-10.ics');
  });

  it('packages one independently importable calendar per resident', async () => {
    const bytes = await buildCalendarsZip(scenario, schedule, { now: stamp });
    const zip = await JSZip.loadAsync(bytes);

    expect(Object.keys(zip.files).sort()).toEqual([
      'Intern One-2026-10.ics',
      'Senior One-2026-10.ics',
    ]);
    expect(await zip.file('Senior One-2026-10.ics').async('string')).toContain('BEGIN:VCALENDAR');
    expect(await zip.file('Intern One-2026-10.ics').async('string')).toContain('BEGIN:VCALENDAR');
  });

  it('keeps every resident when Windows-safe filenames would otherwise collide', async () => {
    const collisionScenario = {
      ...scenario,
      residents: scenario.residents.map((resident, i) => ({
        ...resident,
        name: i === 0 ? 'Lee: Night' : 'Lee? Night',
      })),
    };
    const collisionSchedule = {
      days: Object.fromEntries(Object.entries(schedule.days).map(([date, day]) => [date, {
        ...day,
        working: day.working.map(name => name === 'Senior One' ? 'Lee: Night' : 'Lee? Night'),
        off: day.off.map(name => name === 'Senior One' ? 'Lee: Night' : 'Lee? Night'),
        sleeper: day.sleeper === 'Senior One' ? 'Lee: Night' : day.sleeper === 'Intern One' ? 'Lee? Night' : day.sleeper,
        pager: day.pager === 'Senior One' ? 'Lee: Night' : day.pager === 'Intern One' ? 'Lee? Night' : day.pager,
        night: day.night === 'Senior One' ? 'Lee: Night' : day.night === 'Intern One' ? 'Lee? Night' : day.night,
        dayCall: day.dayCall && {
          senior: day.dayCall.senior === 'Senior One' ? 'Lee: Night' : day.dayCall.senior,
          intern: day.dayCall.intern === 'Intern One' ? 'Lee? Night' : day.dayCall.intern,
        },
      }])),
      totals: {},
    };

    const bytes = await buildCalendarsZip(collisionScenario, collisionSchedule, { now: stamp });
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files).sort()).toEqual([
      'Lee- Night (2)-2026-10.ics',
      'Lee- Night-2026-10.ics',
    ]);
  });
});
