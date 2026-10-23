// Phone team view, data side. The payload carries each day's cell strings straight from cell-text.js (the
// same functions the xlsx export calls), so the phone card can never say something the spreadsheet doesn't.
// Stored/served data is the finished schedule only: no scenario inputs, pins, totals or audit findings.
import { deriveCycle, monthDates } from './model.js';
import { cellText } from './cell-text.js';

export const PHONE_ROWS = ['ROUNDERS', 'PAGER', 'CLINIC', 'DIDACTICS', 'PTO', 'OFF'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function buildPhonePayload(scenario, schedule, version, updated = new Date().toISOString()) {
  const { types, morningReportDays } = deriveCycle(scenario.anchorType, scenario.month);
  const [Y, M] = scenario.month.split('-').map(Number);
  const days = monthDates(scenario.month).map(date => {
    const type = types.get(date);
    const dd = schedule.days[date];
    const rows = {};
    for (const row of PHONE_ROWS) rows[row] = cellText(row, date, type, dd, scenario, schedule);
    return { date, type: cellText('TYPE', date, type, dd, scenario, schedule), rows };
  });
  return {
    v: 1,
    team: scenario.team || '',
    month: scenario.month,
    title: `${scenario.team ? scenario.team + ' - ' : ''}${MONTH_NAMES[M - 1]} ${Y}`,
    version,
    updated,
    residents: scenario.residents.map(r => r.name),
    morningReportDays: [...morningReportDays],
    days,
  };
}
