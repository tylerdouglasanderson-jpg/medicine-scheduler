// @vitest-environment jsdom
// v1.5.0: Transitional interns have no default didactics (every OTHER Wednesday, start week unknown);
// choosing that Kind pops up instructions instead of hard-coding a day.
import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '../src/ui/app.js';
import { saveScenario } from '../src/ui/state.js';
import { parseScenario } from '../src/model.js';
import feb from '../fixtures/feb-2026.json';

const $ = sel => document.querySelector(sel);
beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

describe('Transitional intern kind', () => {
  it('pops up instructions, selects Wed PM locked, no dates', () => {
    HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close ??= function () { this.removeAttribute('open'); };
    const s = parseScenario(feb);
    const i = s.residents.findIndex(r => r.role === 'intern' && r.kind !== 'TY');
    saveScenario(s);
    document.body.innerHTML = '<div id="app"></div>';
    mount($('#app'));
    expect($('#transitional-dialog')).toBeNull();
    const sel = document.querySelectorAll('select[title^="Training background"]')[i];
    sel.value = 'TY';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const dlg = $('#transitional-dialog');
    expect(dlg.hasAttribute('open')).toBe(true);
    expect(dlg.textContent).toContain('every other Wednesday afternoon');
    expect(dlg.textContent).toContain('Didactics (PM)');
    // re-rendered roster: the kind stuck, and no didactics day was filled in
    const row = document.querySelectorAll('select[title^="Training background"]')[i].closest('tr');
    expect(row.querySelector('select[title^="Training background"]').value).toBe('TY');
    const sels = [...row.querySelectorAll('select')];
    const day = sels.find(x => x.value === '3');
    expect(day).toBeTruthy();                       // Wednesday auto-selected...
    expect(day.disabled).toBe(true);                // ...and greyed out (every other week, dates picked in the calendar)
    expect(sels.find(x => x.value === 'PM').disabled).toBe(true);
  });
});
