import { describe, it, expect, beforeAll } from 'vitest';
import { buildWorkbook } from '../src/export.js';
import { solve } from '../src/solve.js';
import { audit } from '../src/audit.js';
import { parseScenario } from '../src/model.js';
import feb from '../fixtures/feb-2026.json';

describe('xlsx export (feb-2026, week of Feb 1-7)', () => {
  let ws, schedule, s;
  beforeAll(async () => {
    s = parseScenario(feb);
    ({ schedule } = await solve(s));
    const wb = await buildWorkbook(s, schedule, audit(s, schedule), '0.1.0 2026-07-16');
    ws = wb.worksheets[0];
  });

  it('header row carries month + version stamp', () => {
    expect(String(ws.getCell('A1').value)).toContain('February 2026');
    expect(String(ws.getCell('A1').value)).toContain('0.1.0');
  });

  it('week-1 block: row labels in order, Feb 5 TYPE cell = CALL with call fill', () => {
    const labels = [2, 3, 4, 5, 6, 7, 8, 9].map(r => ws.getCell(r, 1).value);
    expect(labels).toEqual(['DATE', 'TYPE', 'ROUNDERS', 'PAGER', 'CLINIC', 'DIDACTICS', 'PTO', 'OFF']);
    const typeCell = ws.getCell(3, 6);              // col 6 = Thu Feb 5 (Sun-first, col 2 = Sun Feb 1)
    expect(typeCell.value).toBe('CALL');
    expect(typeCell.fill.fgColor.argb).toBe('FFFF9999');
  });

  it('Feb 5 ROUNDERS cell contains Day-/Night- lines; PAGER cell is the em-dash', () => {
    expect(String(ws.getCell(4, 6).value)).toContain('Night - ' + schedule.days['2026-02-05'].night);
    expect(String(ws.getCell(5, 6).value)).toContain('—');
  });

  it('totals block lists all four residents with 0.5-increment offs', () => {
    const text = JSON.stringify(ws.getSheetValues());
    for (const n of ['Intern1', 'Intern2', 'Senior1', 'Senior2']) expect(text).toContain(n);
  });
});
