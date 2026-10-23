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

describe('Quick How-To', () => {
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
    const labels = [...document.querySelectorAll('.app-bar button')].map(b => b.textContent);
    expect(labels).toContain('Comprehensive Guide');
    expect(labels).toContain('Quick How-To');
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

describe('v1.16.0 layout', () => {
  it('Help menu holds the guides; Save and Share menus hold their actions', () => {
    boot();
    expect($('#help-menu #criteria-button')).toBeTruthy();
    expect($('#help-menu #acgme-button')).toBeTruthy();
    expect($('#save-menu #save-button')).toBeTruthy();
    expect($('#save-menu #open-button')).toBeTruthy();
    expect($('#save-menu #clear-button')).toBeTruthy();
    expect($('#export-toggle').textContent).toContain('Share');
    expect($('#howto-button').closest('.app-bar-left')).toBeTruthy();
  });
  it('Quick How-To has three phases and the chief-approval step', () => {
    boot();
    const t = $('#howto-dialog').textContent;
    for (const w of ['Set up', 'Solve and review', 'Share', 'chiefs', 'Publish', 'Update team schedule']) expect(t).toContain(w);
    expect(t).not.toContain('Hey, here');
  });
  it('New-here strip shows until dismissed', () => {
    boot();
    expect($('#newhere-strip')).toBeTruthy();
    $('#newhere-strip .newhere-x').click();
    expect($('#newhere-strip')).toBeNull();
    boot();
    expect($('#newhere-strip')).toBeNull();
  });
});
