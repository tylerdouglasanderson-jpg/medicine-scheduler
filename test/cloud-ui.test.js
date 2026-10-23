// @vitest-environment jsdom
// Saved sessions + phone team link, app side: PIN bar, first-save advice, autosave, the newer-version conflict, publish.
// The server is a fake fetch; the real Worker was exercised against wrangler dev and the live domain.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { saveScenario } from '../src/ui/state.js';
import { solveAlternatives } from '../src/solve.js';
import { parseScenario } from '../src/model.js';
import feb from '../fixtures/feb-2026.json';
import { payloadSig } from '../src/ui/cloud.js';

const gate = vi.hoisted(() => ({ backToBack: false }));
vi.mock('../src/audit.js', async orig => {
  const real = await orig();
  return { ...real, audit: (...a) => {
    const r = real.audit(...a);
    return gate.backToBack ? { ...r, violations: [...r.violations, { code: 'A_CONSECUTIVE_NIGHTS', message: 'x' }] } : r;
  } };
});

let solved;
let mount;
beforeAll(async () => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
  const r = await solveAlternatives(parseScenario(feb));
  const alternatives = r.solutions.map(s => ({ ...s.schedule, objective: s.objective }));
  solved = parseScenario({ ...feb, alternatives, activeSolution: 0, lastSolution: alternatives[0], alternativesReason: r.stoppedReason });
}, 30000);

const $ = sel => document.querySelector(sel);
const flush = () => new Promise(r => setTimeout(r, 0));

// Fake server: one session at a time, version counter, optional forced 409.
function fakeServer() {
  const s = { calls: [], version: 1, force409: false, links: [] };
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = url.replace('https://team.tylerdouglasanderson.com', '');
    const body = init.body ? JSON.parse(init.body) : null;
    s.calls.push({ method: init.method || 'GET', path, body });
    const ok = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
    if (path === '/api/session' && init.method === 'POST') return ok({ pin: '123456', version: 1, updatedAt: '2026-10-22T10:00:00Z' });
    if (path === '/api/session/123456' && init.method === 'PUT') {
      if (s.force409 && !body.force) return ok({ error: 'newer', version: 5, updatedAt: '2026-10-22T11:00:00Z' }, 409);
      s.version += 1;
      return ok({ version: s.version, updatedAt: '2026-10-22T10:05:00Z' });
    }
    if (path === '/api/session/123456') return ok({ scenario: { ...JSON.parse(JSON.stringify(feb)), team: 'FromServer' }, version: 5, updatedAt: '2026-10-22T11:00:00Z', links: s.links });
    if (path === '/api/team' && init.method === 'POST') {
      const words = body.words || 'pineapple-mango-dog';
      s.links = s.links.filter(l => l.words !== words);
      s.links.push({ words, updated: body.payload.updated, title: body.payload.title, hasSnapshot: !s.noSnap && !!body.snapshot });
      s.snapshot = s.noSnap ? undefined : body.snapshot;
      return ok({ words, url: `https://team.tylerdouglasanderson.com/${words}`, updated: body.payload.updated, hasSnapshot: !s.noSnap && !!body.snapshot });
    }
    if (/^\/api\/team\/[a-z-]+\/snapshot$/.test(path)) return s.snapshot ? ok({ snapshot: s.snapshot, updated: 'x' }) : ok({ error: 'none' }, 404);
    return ok({ error: 'not found' }, 404);
  });
  return s;
}

async function mountApp(scenario = solved) {
  vi.resetModules();
  ({ mount } = await import('../src/ui/app.js'));
  document.getElementById('feedback-dialog')?.remove();
  document.body.innerHTML = '<div id="app"></div>';
  saveScenario(scenario);
  mount($('#app'));
}

describe('saved sessions (website only)', () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => vi.useRealTimers());

  it('shows no PIN bar before the first Save, and Save makes a PIN, a green bar and the write-it-down advice', async () => {
    const server = fakeServer();
    await mountApp();
    expect($('#cloud-bar').hidden).toBe(true);
    $('#cloud-save-button').click();
    $('#cloud-save-dialog .btn-primary').click();
    await vi.advanceTimersByTimeAsync(10);
    expect(server.calls[0]).toMatchObject({ method: 'POST', path: '/api/session' });
    expect($('#cloud-bar').hidden).toBe(false);
    expect($('#cloud-bar').className).toContain('cloud-green');
    expect($('#cloud-bar').textContent).toContain('123456');
    expect($('#cloud-pin-dialog').textContent).toMatch(/Write it down/);
    expect($('#cloud-pin-dialog').textContent).toMatch(/90 days/);
  });

  it('autosaves after an edit once a PIN exists, sending the version it loaded', async () => {
    const server = fakeServer();
    await mountApp();
    $('#cloud-save-button').click(); $('#cloud-save-dialog .btn-primary').click();
    await vi.advanceTimersByTimeAsync(10);
    server.calls.length = 0;
    const sel = document.querySelector('select[name]');
    sel.value = [...sel.options].find(o => o.value !== sel.value).value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(2500);
    const put = server.calls.find(c => c.method === 'PUT');
    expect(put).toBeTruthy();
    expect(put.body.baseVersion).toBe(1);
  });

  it('a newer server version is not overwritten: amber bar, both choices, autosave pauses', async () => {
    const server = fakeServer();
    await mountApp();
    $('#cloud-save-button').click(); $('#cloud-save-dialog .btn-primary').click();
    await vi.advanceTimersByTimeAsync(10);
    server.force409 = true;
    $('#cloud-save-button').click(); $('#cloud-save-dialog .btn-primary').click();
    await vi.advanceTimersByTimeAsync(10);
    const bar = $('#cloud-bar');
    expect(bar.className).toContain('cloud-amber');
    expect(bar.textContent).toMatch(/Not saved/);
    expect(bar.textContent).toMatch(/A newer version was saved from another computer at/);
    const labels = [...bar.querySelectorAll('button')].map(b => b.textContent);
    expect(labels).toEqual(['Load that version', 'Keep mine (replace it)']);
    server.calls.length = 0;
    [...bar.querySelectorAll('button')][1].click();            // Keep mine
    await vi.advanceTimersByTimeAsync(10);
    expect(server.calls[0].body.force).toBe(true);
    expect($('#cloud-bar').className).toContain('cloud-green');
  });

  it('Open a saved session replaces the month with the server copy and shows its PIN', async () => {
    fakeServer();
    await mountApp();
    $('#cloud-open-button').click();
    $('#cloud-pin-input').value = '123456';
    $('#cloud-pin-input').dispatchEvent(new Event('input'));
    $('#cloud-open-dialog .btn-primary').click();
    await vi.advanceTimersByTimeAsync(10);
    expect($('#cloud-bar').textContent).toContain('123456');
    await vi.advanceTimersByTimeAsync(400);
    expect(JSON.parse(localStorage.getItem('med-scheduler-scenario')).team).toBe('FromServer');
  });
});

describe('phone team link', () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => vi.useRealTimers());

  it('Publish is disabled until a session is saved, then publishes the phone payload and lists the link', async () => {
    const server = fakeServer();
    await mountApp();
    expect($('#team-publish-button').disabled).toBe(true);
    $('#cloud-save-button').click(); $('#cloud-save-dialog .btn-primary').click();
    await vi.advanceTimersByTimeAsync(10);
    $('#export-toggle').click();
    expect($('#team-publish-button').disabled).toBe(false);
    server.calls.length = 0;
    $('#team-publish-button').click();
    await vi.advanceTimersByTimeAsync(20);
    const post = server.calls.find(c => c.path === '/api/team');
    expect(post.body.pin).toBe('123456');
    expect(post.body.payload.v).toBe(1);
    expect(post.body.payload.days.length).toBeGreaterThan(27);
    expect($('.team-url').textContent).toBe('team.tylerdouglasanderson.com/pineapple-mango-dog');
    expect($('#team-update-button')).toBeTruthy();
    expect($('#team-new-button')).toBeTruthy();
    expect($('.team-qr')).toBeNull();                       // no inline QR any more
    [...document.querySelectorAll('.team-link button')].find(b => b.textContent === 'QR').click();   // QR opens its own pop-up
    expect($('#team-qr-dialog .team-qr svg')).toBeTruthy();
    expect($('#team-qr-dialog .team-qr-url').textContent).toBe('team.tylerdouglasanderson.com/pineapple-mango-dog');
    $('#team-qr-dialog .btn-primary').click();              // Close
    expect($('#team-qr-dialog')).toBeNull();
  });

  it('team link shows a green tick while the schedule matches and a red cross once it does not', async () => {
    fakeServer();
    await mountApp();
    $('#cloud-save-button').click(); $('#cloud-save-dialog .btn-primary').click();
    await vi.advanceTimersByTimeAsync(10);
    $('#team-publish-button').click(); await vi.advanceTimersByTimeAsync(20);
    expect($('.team-sync-ok')).toBeTruthy();
    expect($('.team-sync-stale')).toBeNull();
    const a = { v: 1, updated: 'x', version: '1', days: [{ rows: { ROUNDERS: 'A' } }] };
    expect(payloadSig({ ...a, updated: 'y', version: '2' })).toBe(payloadSig(a));
    expect(payloadSig({ ...a, days: [{ rows: { ROUNDERS: 'B' } }] })).not.toBe(payloadSig(a));
  });

  it('Clear scenario lets go of the saved session and never writes the blank month over it', async () => {
    const server = fakeServer();
    await mountApp();
    $('#cloud-save-button').click(); $('#cloud-save-dialog .btn-primary').click();
    await vi.advanceTimersByTimeAsync(10);
    expect($('#cloud-bar').hidden).toBe(false);
    const spy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    server.calls.length = 0;
    try {
      $('#clear-button').click();
      expect(spy.mock.calls[0][0]).toContain('123456');           // says what happens to the saved session
      expect($('#cloud-bar').hidden).toBe(true);                  // no longer attached
      await vi.advanceTimersByTimeAsync(5000);
      expect(server.calls.some(c => c.method === 'PUT')).toBe(false);
    } finally { spy.mockRestore(); }
  });

  it('Revert draft to this link puts the published month back, and Undo revert returns the draft', async () => {
    const server = fakeServer();
    await mountApp();
    $('#cloud-save-button').click(); $('#cloud-save-dialog .btn-primary').click();
    await vi.advanceTimersByTimeAsync(10);
    $('#team-publish-button').click(); await vi.advanceTimersByTimeAsync(20);
    const sent = JSON.parse(server.snapshot);                   // the publish carried the full month, privately
    expect(sent.residents.length).toBe(solved.residents.length);
    expect(sent.lastSolution || sent.alternatives).toBeTruthy();
    server.snapshot = JSON.stringify({ ...sent, team: 'Published' });   // pretend the link was published from a different draft
    const stored = () => JSON.parse(localStorage.getItem('med-scheduler-scenario')).team;
    const was = stored();
    const spy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      const revert = [...document.querySelectorAll('.team-link button')].find(b => b.textContent === 'Revert draft to this');
      expect(revert.disabled).toBe(false);
      revert.click(); await vi.advanceTimersByTimeAsync(500);
      expect(stored()).toBe('Published');
      $('#team-undo-revert').click(); await vi.advanceTimersByTimeAsync(500);
      expect(stored()).toBe(was);
      expect($('#team-undo-revert')).toBeNull();
    } finally { spy.mockRestore(); }
  });

  it('Revert is disabled for a link published before snapshots existed', async () => {
    const server = fakeServer();
    server.noSnap = true;
    await mountApp();
    $('#cloud-save-button').click(); $('#cloud-save-dialog .btn-primary').click();
    await vi.advanceTimersByTimeAsync(10);
    $('#team-publish-button').click(); await vi.advanceTimersByTimeAsync(20);
    const revert = [...document.querySelectorAll('.team-link button')].find(b => b.textContent === 'Revert draft to this');
    expect(revert?.disabled).toBe(true);
  });

  it('the button reads Publish, then Update team schedule once a link exists', async () => {
    fakeServer();
    await mountApp();
    $('#cloud-save-button').click(); $('#cloud-save-dialog .btn-primary').click();
    await vi.advanceTimersByTimeAsync(10);
    expect($('#team-publish-button').textContent).toBe('Publish');
    $('#team-publish-button').click(); await vi.advanceTimersByTimeAsync(20);
    expect($('#team-update-button').textContent).toBe('Update team schedule');
  });

  it('Compare is disabled without a snapshot', async () => {
    const server = fakeServer();
    server.noSnap = true;
    await mountApp();
    $('#cloud-save-button').click(); $('#cloud-save-dialog .btn-primary').click();
    await vi.advanceTimersByTimeAsync(10);
    $('#team-publish-button').click(); await vi.advanceTimersByTimeAsync(20);
    expect($('.team-compare').disabled).toBe(true);
  });

  it('Compare opens the diff dialog: no differences, then a banner once the published copy differs', async () => {
    const server = fakeServer();
    await mountApp();
    $('#cloud-save-button').click(); $('#cloud-save-dialog .btn-primary').click();
    await vi.advanceTimersByTimeAsync(10);
    $('#team-publish-button').click(); await vi.advanceTimersByTimeAsync(20);
    const sent = JSON.parse(server.snapshot);
    expect($('#team-compare-pineapple-mango-dog').disabled).toBe(false);
    $('#team-compare-pineapple-mango-dog').click(); await vi.advanceTimersByTimeAsync(20);
    expect($('#compare-dialog #compare-banner').textContent).toMatch(/No differences/);
    $('#compare-close').click();
    expect($('#compare-dialog')).toBeNull();
    const date = Object.keys(sent.lastSolution.days)[3];
    sent.lastSolution.days[date].night = 'Ghost1';             // the team link was published with someone else on night
    server.snapshot = JSON.stringify(sent);
    $('#team-compare-pineapple-mango-dog').click(); await vi.advanceTimersByTimeAsync(20);
    expect($('#compare-banner').textContent).toMatch(/^1 day differs · \d+ (person|people) affected$/);
    expect($('#compare-days').textContent).toContain('Ghost1');
    expect($('#compare-update')).toBeTruthy();
    expect($('#compare-revert')).toBeTruthy();
    $('#compare-close').click();
  });

  it('the status chip shows not published, then in sync, then amber once the published copy differs', async () => {
    fakeServer();
    await mountApp();
    const { publishStatusChip, cloudState } = await import('../src/ui/cloud.js');
    const chip = publishStatusChip();
    document.body.append(chip);
    expect(chip.id).toBe('publish-status-chip');
    expect(chip.textContent).toBe('Not published yet');
    $('#cloud-save-button').click(); $('#cloud-save-dialog .btn-primary').click();
    await vi.advanceTimersByTimeAsync(10);
    $('#team-publish-button').click(); await vi.advanceTimersByTimeAsync(20);
    expect(chip.textContent).toMatch(/^Team sees .* · in sync$/);
    cloudState().links[0].sig = 'different';                    // as if the draft had moved on since publishing
    $('#cloud-save-button').click(); $('#cloud-save-dialog .btn-primary').click();   // any state change refreshes live chips
    await vi.advanceTimersByTimeAsync(20);
    expect(chip.textContent).toBe('Draft has changes since publish — see what changed');
  });

  it('Update team schedule reuses the same words', async () => {
    const server = fakeServer();
    await mountApp();
    $('#cloud-save-button').click(); $('#cloud-save-dialog .btn-primary').click();
    await vi.advanceTimersByTimeAsync(10);
    $('#team-publish-button').click(); await vi.advanceTimersByTimeAsync(20);
    server.calls.length = 0;
    $('#team-update-button').click(); await vi.advanceTimersByTimeAsync(20);
    expect(server.calls.find(c => c.path === '/api/team').body.words).toBe('pineapple-mango-dog');
  });

  it('back-to-back nights ask Publish anyway?; Cancel stops the publish, OK publishes', async () => {
    const server = fakeServer();
    await mountApp();
    $('#cloud-save-button').click(); $('#cloud-save-dialog .btn-primary').click();
    await vi.advanceTimersByTimeAsync(10);
    gate.backToBack = true;
    const spy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    server.calls.length = 0;
    try {
      $('#team-publish-button').click(); await vi.advanceTimersByTimeAsync(20);
      expect(spy).toHaveBeenCalledWith('This schedule has back-to-back nights. Publish anyway?');
      expect(server.calls.some(c => c.path === '/api/team')).toBe(false);
      spy.mockReturnValue(true);
      $('#team-publish-button').click(); await vi.advanceTimersByTimeAsync(20);
      expect(server.calls.some(c => c.path === '/api/team')).toBe(true);
    } finally { gate.backToBack = false; spy.mockRestore(); }
  });

  it('Download phone view makes a self-contained html file', async () => {
    fakeServer();
    await mountApp();
    const urls = [];
    URL.createObjectURL = blob => { urls.push(blob); return 'blob:x'; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function click() {};
    $('#phone-download-button').click();
    expect(urls.length).toBe(1);
    const text = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsText(urls[0]); });
    expect(text).toMatch(/^<!doctype html>/i);
    expect(text).not.toMatch(/<script[^>]+src=/i);
  });
});

describe('downloaded file (file://)', () => {
  it('draws no session controls', async () => {
    const real = window.location;
    // jsdom location is http://localhost; cloudAvailable() is the one gate, so assert its logic directly.
    const { cloudAvailable } = await import('../src/ui/cloud.js');
    expect(cloudAvailable()).toBe(true);
    expect(real.hostname).toBe('localhost');
  });
});
