import JSZip from 'jszip';
import { onService } from './model.js';

const TIMEZONE = 'America/Chicago';
const PRODID = '-//Medicine Team Scheduler//Personal Schedule//EN';
const CHICAGO_TIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${TIMEZONE}`,
  `X-LIC-LOCATION:${TIMEZONE}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0600',
  'TZOFFSETTO:-0500',
  'TZNAME:CDT',
  'DTSTART:20070311T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0600',
  'TZNAME:CST',
  'DTSTART:20071104T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

const compactDate = date => date.replaceAll('-', '');

function addDays(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

function dow(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const isWeekend = date => [0, 6].includes(dow(date));
const at = (date, hhmm) => `${compactDate(date)}T${hhmm}00`;

function escapeText(value) {
  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,');
}

function foldLine(line) {
  const chunks = [];
  let chunk = '';
  let bytes = 0;
  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    if (bytes + size > 73 && chunk) {
      chunks.push(chunk);
      chunk = char;
      bytes = size;
    } else {
      chunk += char;
      bytes += size;
    }
  }
  chunks.push(chunk);
  return chunks.join('\r\n ');
}

function stamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function slug(value) {
  return value.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'resident';
}

function timedEvent(person, date, kind, summary, start, endDate, end, description, now, index) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${slug(person)}-${compactDate(date)}-${slug(kind)}-${index}@medicine-scheduler`,
    `DTSTAMP:${stamp(now)}`,
    `SUMMARY:${escapeText(summary)}`,
    `DTSTART;TZID=${TIMEZONE}:${at(date, start)}`,
    `DTEND;TZID=${TIMEZONE}:${at(endDate, end)}`,
  ];
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  lines.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'END:VEVENT');
  return lines;
}

function allDayEvent(person, date, kind, summary, now, index) {
  return [
    'BEGIN:VEVENT',
    `UID:${slug(person)}-${compactDate(date)}-${slug(kind)}-${index}@medicine-scheduler`,
    `DTSTAMP:${stamp(now)}`,
    `SUMMARY:${escapeText(summary)}`,
    `DTSTART;VALUE=DATE:${compactDate(date)}`,
    `DTEND;VALUE=DATE:${compactDate(addDays(date, 1))}`,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
  ];
}

// Both pinned halves for this person and date. validate() guarantees a half off is
// never on a call or post-call day, never over a commitment in the same half, and a PM half-off is
// never the pager holder.
function halfOffOf(scenario, person, date) {
  const pins = (scenario.pins ?? []).filter(x => x.person === person && x.date === date && x.type === 'halfOff');
  return ['AM', 'PM'].filter(half => pins.some(p => p.half === half));
}

function dutyEvent(person, date, dd, now, index, halfOff = []) {
  const working = dd.working?.includes(person);
  if (dd.type === 'call') {
    if (!working) return null;
    if (dd.night === person) {
      return timedEvent(person, date, 'night-call', 'Night Call — end varies with rounding',
        '1730', addDays(date, 1), '1200',
        'Calendar end time is noon. Actual departure varies with rounding, typically 9:00 AM–2:00 PM.',
        now, index);
    }
    return timedEvent(person, date, 'day-call', 'Day Call', isWeekend(date) ? '0600' : '0700',
      date, '1730', null, now, index);
  }

  if (dd.type === 'postcall') {
    if (dd.sleeper === person) {
      return timedEvent(person, date, 'post-call-off', 'Post Call — Off After Rounds',
        '0600', date, '1700', 'Night shift ended today; off after rounding is complete.', now, index);
    }
    if (!working) return null;
    const pager = dd.pager === person;
    return timedEvent(person, date, 'post-call', `Post Call${pager ? ', Pager Duty' : ''}`,
      '0600', date, '1700', null, now, index);
  }

  if (!working) return null;
  const pager = dd.pager === person;
  // AM half off: no morning duty at all; a pager holder's afternoon is still an event.
  if (halfOff.includes('AM'))
    return pager && !halfOff.includes('PM')
      ? timedEvent(person, date, 'pager', 'Pager Duty', '1300', date, '1700', null, now, index) : null;
  let summary = 'Rounding';
  let start = '0700';
  if (dd.type === 'sc1') summary = `Short Call 1${isWeekend(date) ? ' — No Call' : ''}`;
  if (dd.type === 'sc2') {
    summary = `Short Call 2${isWeekend(date) ? ' — No Call' : ''}`;
    start = isWeekend(date) ? '0700' : '0600';
  }
  if (pager && !halfOff.includes('PM')) summary += ', Pager Duty';
  return timedEvent(person, date, `duty-${dd.type}`, summary, start, date,
    pager && !halfOff.includes('PM') ? '1700' : '1300', null, now, index);
}

function postCallEvent(person, callDate, callDay, nextDay, now, index) {
  const date = addDays(callDate, 1);
  if (callDay.night === person) {
    return timedEvent(person, date, 'post-call-off', 'Post Call — Off After Rounds',
      '0600', date, '1700', 'Night shift ended today; off after rounding is complete.', now, index);
  }
  const pager = nextDay?.pager === person;
  return timedEvent(person, date, 'post-call', `Post Call${pager ? ', Pager Duty' : ''}`,
    '0600', date, '1700', null, now, index);
}

function obligationEvents(scenario, schedule, resident, date, now, startIndex, halfOff = []) {
  const events = [];
  const dd = schedule.days[date];
  const pager = dd?.pager === resident.name;
  let index = startIndex;

  if (dd?.working?.includes(resident.name) && !['call', 'postcall'].includes(dd.type)) {
    for (const half of halfOff) {
      const am = half === 'AM';
      events.push(timedEvent(resident.name, date, `half-off-${half}`, `Half day off (${half})`,
        am ? '0700' : '1300', date, am ? '1300' : '1700', null, now, index++));
    }
  }

  for (const c of resident.commitments ?? []) {
    if (c.date !== date || halfOff.includes(c.half)) continue;
    const isPm = c.half === 'PM';
    events.push(timedEvent(resident.name, date, `commitment-${index}`,
      `${c.label || 'Commitment'}${pager ? ', Pager Duty' : ''}`,
      isPm ? '1300' : '0700', date, isPm ? '1700' : '1300', null, now, index++));
  }

  const attendsDidactics = resident.didactics
    && resident.didactics.dow === dow(date)
    && onService(resident, date)
    && !['call', 'postcall'].includes(dd?.type)
    && !(resident.pto ?? []).includes(date)
    && !(dd?.off ?? []).includes(resident.name)
    && !halfOff.includes(resident.didactics.half ?? 'PM');     // a half day off over it is a miss
  if (attendsDidactics) {
    const isPm = resident.didactics.half === 'PM';
    events.push(timedEvent(resident.name, date, 'didactics',
      `Didactics${pager ? ', Pager Duty' : ''}`,
      isPm ? '1300' : '0700', date, isPm ? '1700' : '1300', null, now, index++));
  }

  const morningReport = dd?.type === 'precall' && [2, 4].includes(dow(date))
    && dd.working?.includes(resident.name) && !halfOff.includes('AM');
  if (morningReport) {
    events.push(timedEvent(resident.name, date, 'morning-report', 'Morning Report',
      '1100', date, '1130', 'This team presents; overlaps morning rounding.', now, index++));
  }
  return events;
}

export function buildResidentCalendar(scenario, schedule, person, { now = new Date() } = {}) {
  const resident = scenario.residents.find(r => r.name === person);
  if (!resident) throw new Error(`Unknown resident: ${person}`);

  const events = [];
  let index = 1;
  const dates = Object.keys(schedule.days).sort();
  const postCallFromVisibleCall = new Set(dates
    .filter(date => schedule.days[date].type === 'call')
    .map(date => addDays(date, 1)));
  for (const date of dates) {
    const dd = schedule.days[date];
    if ((resident.pto ?? []).includes(date))
      events.push(allDayEvent(person, date, 'pto', 'PTO', now, index++));
    if ((dd.off ?? []).includes(person))
      events.push(allDayEvent(person, date, 'off', 'OFF', now, index++));

    // A visible call day is the source of truth for everybody's next-day post-call event. The
    // post-call day's `working` list deliberately omits the night sleeper and may omit someone
    // whose service window ended on the call date. Only use current-day data for a month-start
    // carry-in, where the preceding call day is outside this schedule.
    const halfOff = halfOffOf(scenario, person, date);
    const duty = dd.type === 'postcall' && postCallFromVisibleCall.has(date)
      ? null : dutyEvent(person, date, dd, now, index++, halfOff);
    if (duty) events.push(duty);
    if (dd.type === 'call' && dd.working?.includes(person)) {
      const nextDate = addDays(date, 1);
      events.push(postCallEvent(person, date, dd, schedule.days[nextDate], now, index++));
    }
    const obligations = obligationEvents(scenario, schedule, resident, date, now, index, halfOff);
    events.push(...obligations);
    index += obligations.length;
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`${person} — ${scenario.team || 'Medicine'} ${scenario.month}`)}`,
    `X-WR-TIMEZONE:${TIMEZONE}`,
    ...CHICAGO_TIMEZONE,
    ...events.flat(),
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

export function calendarFilename(person, month) {
  const safe = person.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/[. ]+$/g, '').trim() || 'resident';
  return `${safe}-${month}.ics`;
}

function calendarFilenames(scenario) {
  const used = new Set();
  return scenario.residents.map(resident => {
    const safe = resident.name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/[. ]+$/g, '').trim() || 'resident';
    let suffix = '';
    let sequence = 1;
    let filename;
    do {
      filename = `${safe}${suffix}-${scenario.month}.ics`;
      sequence += 1;
      suffix = ` (${sequence})`;
    } while (used.has(filename.toLocaleLowerCase('en-US')));
    used.add(filename.toLocaleLowerCase('en-US'));
    return filename;
  });
}

export async function buildCalendarsZip(scenario, schedule, options = {}) {
  const zip = new JSZip();
  const filenames = calendarFilenames(scenario);
  for (const [index, resident] of scenario.residents.entries())
    zip.file(filenames[index],
      buildResidentCalendar(scenario, schedule, resident.name, options));
  return zip.generateAsync({ type: 'uint8array' });
}

// Every solution's calendars in one ZIP, a folder each ("Solution 1/…ics"), in tab order.
// `person` narrows every folder to that one resident; null = everyone.
export async function buildAllSolutionsCalendarsZip(scenario, schedules, { person = null, ...options } = {}) {
  const zip = new JSZip();
  const filenames = calendarFilenames(scenario);
  schedules.forEach((schedule, k) => {
    const folder = zip.folder(`Solution ${k + 1}`);
    for (const [index, resident] of scenario.residents.entries())
      if (!person || resident.name === person)
        folder.file(filenames[index], buildResidentCalendar(scenario, schedule, resident.name, options));
  });
  return zip.generateAsync({ type: 'uint8array' });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadResidentCalendar(scenario, schedule, person) {
  const text = buildResidentCalendar(scenario, schedule, person);
  const residentIndex = scenario.residents.findIndex(resident => resident.name === person);
  downloadBlob(new Blob([text], { type: 'text/calendar;charset=utf-8' }),
    calendarFilenames(scenario)[residentIndex]);
}

export async function downloadCalendarsZip(scenario, schedule) {
  const bytes = await buildCalendarsZip(scenario, schedule);
  downloadBlob(new Blob([bytes], { type: 'application/zip' }),
    `${scenario.team || 'medicine'}-${scenario.month}-calendars.zip`);
}

export async function downloadAllSolutionsCalendarsZip(scenario, schedules, person = null) {
  const bytes = await buildAllSolutionsCalendarsZip(scenario, schedules, { person });
  downloadBlob(new Blob([bytes], { type: 'application/zip' }),
    `${scenario.team || 'medicine'}-${scenario.month}-all-solutions-calendars.zip`);
}
