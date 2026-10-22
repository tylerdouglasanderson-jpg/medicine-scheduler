// @vitest-environment jsdom
// v1.7.0: first-visit Quick How-to pop-up + per-section Collapse buttons.
import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '../src/ui/app.js';

const $ = sel => document.querySelector(sel);
const boot = () => { document.body.innerHTML = '<div id="app"></div>'; mount($('#app')); };
beforeEach(() => {
  localStorage.clear(); document.body.innerHTML = '';
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});

describe('Quick How-to', () => {
  it('opens on the first visit only, and from the header button', () => {
    boot();
    expect($('#howto-dialog').hasAttribute('open')).toBe(true);
    expect($('#howto-dialog').textContent).toContain('Roster');
    $('#howto-dialog').removeAttribute('open');
    boot();
    expect($('#howto-dialog')).toBeNull();   // seen already: not even built
    $('#howto-button').click();
    expect($('#howto-dialog').hasAttribute('open')).toBe(true);
  });
  it('renames Guide to Comprehensive Guide', () => {
    boot();
    const labels = [...document.querySelectorAll('.app-bar-right button')].map(b => b.textContent);
    expect(labels).toContain('Comprehensive Guide');
    expect(labels).toContain('Quick How-to');
  });
});

describe('Collapse buttons', () => {
  it('every major panel collapses, survives re-render and reload', () => {
    boot();
    for (const id of ['setup-section', 'roster-section', 'chips-section', 'errors-panel', 'results-section']) {
      expect($(`#${id} > .collapse-btn`), id).toBeTruthy();
    }
    $('#roster-section > .collapse-btn').click();
    expect($('#roster-section').classList.contains('collapsed')).toBe(true);
    $('#setup-section > .collapse-btn').click();       // another click, then reload from storage
    boot();
    expect($('#roster-section').classList.contains('collapsed')).toBe(true);
    expect($('#setup-section').classList.contains('collapsed')).toBe(true);
    expect($('#chips-section').classList.contains('collapsed')).toBe(false);
    $('#roster-section > .collapse-btn').click();
    expect($('#roster-section').classList.contains('collapsed')).toBe(false);
  });
});
