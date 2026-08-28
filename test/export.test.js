import { describe, it, expect, beforeAll } from 'vitest';
import { buildWorkbook } from '../src/export.js';
import { solve } from '../src/solve.js';
import { audit } from '../src/audit.js';
import { parseScenario } from '../src/model.js';
import ExcelJS from 'exceljs';
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

  it('Feb 10 (pre-call Tue) TYPE cell carries the MORNING REPORT tag; Feb 5 does not', () => {
    const mrCell = ws.getCell(11, 4);        // week-2 TYPE row, col 4 = Tue Feb 10
    expect(String(mrCell.value)).toBe('PRECALL\nMORNING REPORT');
    expect(mrCell.font.color.argb).toBe('FF7030A0');
    expect(String(ws.getCell(3, 6).value)).not.toContain('MORNING REPORT');
    expect(JSON.stringify(ws.getSheetValues())).toContain('MORNING REPORT = this team presents');
  });

  it('totals block lists all four residents with 0.5-increment offs', () => {
    const text = JSON.stringify(ws.getSheetValues());
    for (const n of ['Intern1', 'Intern2', 'Senior1', 'Senior2']) expect(text).toContain(n);
  });

  it('persists readable Excel and Google Sheets dimensions through an xlsx round-trip', async () => {
    const wb = await buildWorkbook(s, schedule, audit(s, schedule), '0.1.0 2026-07-16');
    const copy = new ExcelJS.Workbook();
    await copy.xlsx.load(await wb.xlsx.writeBuffer());
    const sheet = copy.worksheets[0];

    expect(sheet.getColumn(1).width).toBe(14);
    for (let col = 2; col <= 8; col++) expect(sheet.getColumn(col).width).toBe(22);
    expect(sheet.getColumn(10).width).toBe(20);
    expect(sheet.getColumn(14).width).toBe(14);
    expect(sheet.getRow(2).height).toBe(20);
    expect(sheet.getRow(3).height).toBe(36);
    expect(sheet.getRow(4).height).toBe(72);
    expect(sheet.getCell('H1').isMerged).toBe(true);
    expect(sheet.views[0]).toEqual(expect.objectContaining({
      state: 'frozen', xSplit: 1, ySplit: 1, topLeftCell: 'B2',
    }));
    expect(sheet.pageSetup).toEqual(expect.objectContaining({
      orientation: 'landscape', fitToPage: true, fitToWidth: 1,
    }));
  });

  it('wraps and merges long notes across the calendar width', () => {
    const note = ws.getColumn(1).values.findIndex(v => v === 'Potential Issues');
    expect(note).toBeGreaterThan(0);
    expect(ws.getCell(note, 8).isMerged).toBe(true);
    expect(ws.getCell(note, 1).alignment).toEqual(expect.objectContaining({
      vertical: 'top', wrapText: true,
    }));
  });
});
