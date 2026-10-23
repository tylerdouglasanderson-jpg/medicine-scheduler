// Website-only "Save session" (6-digit PIN, autosave) and the read-only phone team link.
// Talks to the sessions Worker (sessions-worker/). Does nothing on the downloaded file (file://): cloudAvailable()
// is false there and no control is drawn. State lives at module level so render() can rebuild the page freely;
// the PIN bar is updated in place (refreshBar) so autosave never forces a full re-render.
import QRCode from 'qrcode-svg';

export const API = 'https://team.tylerdouglasanderson.com';
const KEY = 'med-scheduler-cloud';
const AUTOSAVE_MS = 2000;

export function cloudAvailable() {
  if (typeof location === 'undefined') return false;
  const h = location.hostname;
  return /^https?:$/.test(location.protocol) &&
    (h === 'scheduler.tylerdouglasanderson.com' || h === 'localhost' || h === '127.0.0.1');
}

// pin/version/updatedAt persist so a reload resumes autosave; status/conflict/links are session-only.
const state = { pin: null, version: 0, updatedAt: null, links: [], status: 'idle', conflict: null, error: null, saved: null, last: null };
try {
  const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (raw && /^\d{6}$/.test(raw.pin)) Object.assign(state, { pin: raw.pin, version: raw.version, updatedAt: raw.updatedAt, status: 'saved' });
} catch { /* storage may be unavailable */ }
const persist = () => {
  try { localStorage.setItem(KEY, JSON.stringify(state.pin ? { pin: state.pin, version: state.version, updatedAt: state.updatedAt } : null)); }
  catch { /* ignore */ }
};

let ctx = null;            // { serialize(): string, parse(text): scenario, apply(scenario): void }
let timer = null;
let inFlight = false;
let dirty = false;

export function initCloud(c) {
  ctx = c;
  // A reload keeps the PIN; the list of team links comes from the server.
  if (cloudAvailable() && state.pin) refreshLinks().then(() => redrawTeam?.(), () => {});
}
export const cloudState = () => state;

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(API + path, {
      method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw Object.assign(new Error('Could not reach the server. Check your connection.'), { offline: true }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Server error ${res.status}`), { status: res.status, data });
  return data;
}

const payloadScenario = () => JSON.parse(ctx.serialize());
const clock = iso => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// ---------- session operations ----------
export async function saveSession({ asNew = false } = {}) {
  if (!state.pin || asNew) {
    const r = await call('POST', '/api/session', { scenario: payloadScenario() });
    Object.assign(state, { pin: r.pin, version: r.version, updatedAt: r.updatedAt, links: [], status: 'saved', conflict: null, error: null, saved: Date.now() });
    persist(); refreshBar();
    return { created: true, pin: r.pin };
  }
  await putNow();
  return { created: false, pin: state.pin };
}

async function putNow({ force = false } = {}) {
  inFlight = true; state.status = 'saving'; refreshBar();
  try {
    const r = await call('PUT', `/api/session/${state.pin}`, { scenario: payloadScenario(), baseVersion: state.version, force });
    Object.assign(state, { version: r.version, updatedAt: r.updatedAt, status: 'saved', conflict: null, error: null, saved: Date.now() });
    persist();
  } catch (e) {
    if (e.status === 409) { state.status = 'conflict'; state.conflict = { version: e.data.version, updatedAt: e.data.updatedAt }; }
    else { state.status = 'error'; state.error = e.message; dirty = true; }
    throw e;
  } finally { inFlight = false; refreshBar(); }
}

// Called by app.js on every edit. Does nothing until the first explicit Save has made a PIN.
export function scheduleAutosave() {
  if (!state.pin || !ctx) return;
  if (state.status === 'conflict') return;                  // paused until the user picks a side
  dirty = true;
  if (state.status !== 'saving') { state.status = 'unsent'; refreshBar(); }
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (inFlight) { scheduleAutosave(); return; }
    dirty = false;
    try { await putNow(); } catch { /* the bar shows it */ }
  }, AUTOSAVE_MS);
}

export async function openSavedSession(pin) {
  const r = await call('GET', `/api/session/${encodeURIComponent(pin)}`);
  Object.assign(state, { pin, version: r.version, updatedAt: r.updatedAt, links: r.links ?? [], status: 'saved', conflict: null, error: null, saved: Date.now() });
  persist();
  return r.scenario;
}

export async function loadNewerVersion() {
  const scenario = await openSavedSession(state.pin);
  ctx.apply(ctx.parse(JSON.stringify(scenario)));
  refreshBar();
}
export async function keepMine() { clearTimeout(timer); await putNow({ force: true }); }

// ---------- team links ----------
export async function refreshLinks() {
  if (!state.pin) return [];
  const r = await call('GET', `/api/session/${state.pin}`);
  state.links = r.links ?? [];
  return state.links;
}
export async function publishTeam(payload, words) {
  const r = await call('POST', '/api/team', { pin: state.pin, payload, words });
  const i = state.links.findIndex(l => l.words === r.words);
  const link = { words: r.words, updated: r.updated, title: payload.title };
  if (i >= 0) state.links[i] = link; else state.links.push(link);
  state.last = r.words;
  return r;
}
export async function stopSharing(words) {
  await call('DELETE', `/api/team/${words}`, { pin: state.pin });
  state.links = state.links.filter(l => l.words !== words);
  if (state.last === words) state.last = null;
}
export const linkUrl = words => `${API}/${words}`;

// ---------- DOM ----------
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.filter(k => k != null));
  return n;
};
const btn = (text, onClick, cls = 'btn-secondary', props = {}) =>
  el('button', { type: 'button', className: cls, textContent: text, onclick: onClick, ...props });

function fillBar(bar) {
  bar.replaceChildren();
  bar.className = 'cloud-bar';
  if (!state.pin) { bar.hidden = true; return; }
  bar.hidden = false;
  const amber = state.status === 'conflict' || state.status === 'error';
  bar.classList.add(amber ? 'cloud-amber' : 'cloud-green');
  const when = state.saved ? ` · saved ${new Date(state.saved).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
  const status = { saving: ' · saving…', unsent: ' · saving soon…', error: ' · Not saved', conflict: ' · Not saved' }[state.status] ?? when;
  bar.append(el('span', { className: 'cloud-pin' }, 'Saved session PIN ', el('strong', { textContent: state.pin })), el('span', { className: 'cloud-status', textContent: status }));
  if (state.status === 'error') bar.append(el('span', { className: 'cloud-msg', textContent: state.error }), btn('Try again', () => putNow().catch(() => {}), 'btn-secondary'));
  if (state.status === 'conflict') {
    bar.append(el('span', { className: 'cloud-msg', textContent: `A newer version was saved from another computer at ${clock(state.conflict.updatedAt)}.` }),
      btn('Load that version', () => loadNewerVersion().catch(e => alert(e.message)), 'btn-secondary'),
      btn('Keep mine (replace it)', () => keepMine().catch(e => alert(e.message)), 'btn-secondary'));
  }
}
let redrawTeam = null;      // the one team-link section in the page, redrawn when the session state changes
export function refreshBar() {
  const bar = typeof document !== 'undefined' && document.getElementById('cloud-bar');
  if (bar) fillBar(bar);
  if (redrawTeam) redrawTeam();
}
export function cloudBar() {
  const bar = el('div', { id: 'cloud-bar', role: 'status' });
  fillBar(bar);
  return bar;
}

function dialog(id, title, ...body) {
  document.getElementById(id)?.remove();
  const dlg = el('dialog', { id, className: 'app-dialog' });
  const header = el('div', { className: 'guide-dialog-header' }, el('h2', { textContent: title }),
    btn('×', () => dlg.close(), 'btn-ghost', { title: 'Closes this box.' }));
  dlg.append(header, el('div', { className: 'app-dialog-body' }, ...body));
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.appendChild(dlg);
  dlg.showModal();
  return dlg;
}

function pinAdvice(pin) {
  const dlg = dialog('cloud-pin-dialog', 'Session saved',
    el('p', { textContent: 'Your PIN is:' }),
    el('p', { className: 'cloud-bigpin', textContent: pin }),
    el('p', { textContent: 'Write it down now, for example in the Notes app on your phone. The PIN is the only way to get this session back, and it opens on any computer.' }),
    el('p', { className: 'dialog-note', textContent: 'From here on, every change saves to this PIN automatically. A session is deleted 90 days after it was last opened. Anyone who has the PIN can open it, so share it only with people who should see this month.' }),
    btn('Got it', () => dlg.close(), 'btn-primary dialog-link'));
}

export function openSaveDialog({ asNew = false } = {}) {
  const status = el('p', { className: 'dialog-note', textContent: '' });
  const go = btn(asNew ? 'Save as a new session' : 'Save session', async () => {
    go.disabled = true; status.textContent = 'Saving…';
    try { const r = await saveSession({ asNew }); dlg.close(); if (r.created) pinAdvice(r.pin); }
    catch (e) { status.textContent = e.message; go.disabled = false; }
  }, 'btn-primary dialog-link');
  const dlg = dialog('cloud-save-dialog', asNew ? 'Save as a new session' : 'Save session',
    el('p', { textContent: state.pin && !asNew
      ? `Saves this month to PIN ${state.pin} now. It also saves automatically as you work.`
      : 'Saves this month on the server and gives you a 6-digit PIN. Open it later from any computer with that PIN. No account needed.' }),
    el('p', { className: 'dialog-note', textContent: 'Sessions are deleted 90 days after they were last opened. Anyone with the PIN can open the session.' }),
    go, status);
}

export function openOpenDialog() {
  const input = el('input', { type: 'text', id: 'cloud-pin-input', className: 'cloud-pin-input', inputMode: 'numeric', maxLength: 6, placeholder: '000000', autocomplete: 'off', title: '6-digit PIN' });
  const status = el('p', { className: 'dialog-note cloud-status', textContent: '' });
  const go = btn('Open session', async () => {
    const pin = input.value.trim();
    if (!/^\d{6}$/.test(pin)) { status.textContent = 'A PIN is 6 digits.'; return; }
    go.disabled = true; status.classList.remove('cloud-status-error'); status.textContent = 'Opening…';
    try {
      const scenario = await openSavedSession(pin);
      ctx.apply(ctx.parse(JSON.stringify(scenario)));
      dlg.close(); refreshBar();
    } catch (e) { status.textContent = e.message; status.classList.add('cloud-status-error'); go.disabled = !/^\d{6}$/.test(input.value); }
  }, 'btn-primary dialog-link');
  go.disabled = true;                                  // enabled once there are 6 digits
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 6);
    go.disabled = input.value.length !== 6;
    status.textContent = ''; status.classList.remove('cloud-status-error');
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !go.disabled) go.click(); });
  const dlg = dialog('cloud-open-dialog', 'Open a saved session',
    el('p', { textContent: 'Type the 6-digit PIN you were given when you saved.' }),
    el('label', { className: 'cloud-pin-label', htmlFor: 'cloud-pin-input', textContent: 'PIN' }), input,
    go, status,
    el('p', { className: 'dialog-note', textContent: 'This replaces the month on screen, so save it first if you want to keep it.' }));
  input.focus();
}

export function sessionButtons() {
  const wrap = el('div', { className: 'cloud-buttons' }, el('span', { className: 'cloud-label', textContent: 'Saved session (website):' }));
  wrap.append(
    btn(state.pin ? 'Save online now' : 'Save online…', () => openSaveDialog(), 'btn-secondary',
      { id: 'cloud-save-button', title: 'Saves this month on the server under a 6-digit PIN, so you can open it from any computer. After the first save it saves by itself as you work.' }),
    btn('Save online as new PIN…', () => openSaveDialog({ asNew: true }), 'btn-secondary',
      { id: 'cloud-new-button', title: 'Makes a second saved session with its own PIN, leaving the first as it is.' }),
    btn('Open by PIN…', openOpenDialog, 'btn-secondary',
      { id: 'cloud-open-button', title: 'Opens a month saved on the server by its 6-digit PIN. This replaces the month on screen.' }));
  return wrap;
}

// ---------- team link section (inside the Export panel) ----------
function qrSvg(text) {
  return new QRCode({ content: text, padding: 1, width: 320, height: 320, ecl: 'M', join: true, container: 'svg-viewbox' }).svg();
}

// The QR code gets its own pop-up over a dimmed page: scan it, then close it.
function showQr(url) {
  const qr = el('div', { className: 'team-qr' }); qr.innerHTML = qrSvg(url);
  const dlg = dialog('team-qr-dialog', 'Scan to open the schedule', qr,
    el('p', { className: 'team-qr-url', textContent: url.replace(/^https:\/\//, '') }),
    btn('Close', () => dlg.close(), 'btn-primary dialog-link'));
}

function choose(title, text, options) {
  return new Promise(resolve => {
    const dlg = dialog('cloud-choose-dialog', title, el('p', { textContent: text }),
      ...options.map(([label, value, cls]) => btn(label, () => { resolve(value); dlg.close(); }, cls ?? 'btn-secondary dialog-link')));
    dlg.addEventListener('close', () => resolve(null));
  });
}

// gate(): returns the payload to publish, or null if it must not publish (it has already told the user why).
// downloadPhone(): saves the self-contained phone view.
export function teamSection({ gate, hasSchedule, downloadPhone }) {
  const wrap = el('div', { className: 'team-section' });
  const msg = el('p', { className: 'export-note', textContent: '' });
  const say = t => { msg.textContent = t; };

  async function run(label, fn) {
    say(label);
    try { await fn(); say(''); draw(); } catch (e) { say(e.message); }
  }
  async function publish(words) {
    const payload = gate();
    if (!payload) return;
    await run('Publishing…', () => publishTeam(payload, words));
  }
  async function publishNew() {
    if (!state.links.length) {
      try { await refreshLinks(); } catch { /* publishing will report a real error */ }
      if (state.links.length) {
        const pick = await choose('You already have a team link for this session', 'You already have a team link for this session. Update it, or make a new one?',
          [['Update it', 'update', 'btn-primary dialog-link'], ['Make a new one', 'new'], ['Cancel', null, 'btn-ghost dialog-link']]);
        if (pick === 'update') return publish(state.links[state.links.length - 1].words);
        if (pick !== 'new') return;
      }
    }
    return publish(undefined);
  }

  function draw() {
    wrap.replaceChildren();
    wrap.append(el('p', { className: 'export-note', textContent: 'A read-only calendar for the team’s phones. Publish it once the schedule is final. It stays up for a year after it was last opened.' }));
    const canPublish = hasSchedule && !!state.pin;
    const newest = state.links[state.links.length - 1];
    if (!state.links.length) {
      wrap.append(btn('Publish team link', publishNew, 'btn-secondary', { id: 'team-publish-button', disabled: !canPublish }));
    } else {
      wrap.append(btn('Update team link', () => publish(newest.words), 'btn-secondary', { id: 'team-update-button', disabled: !canPublish, title: 'Replaces the schedule behind the same link. Everyone who has the link sees the new version.' }),
        btn('Publish as a new link', publishNew, 'btn-ghost', { id: 'team-new-button', disabled: !canPublish }));
    }
    if (!state.pin) wrap.append(el('p', { className: 'export-note', textContent: 'Save the session first (Save online on the toolbar). The link belongs to a saved session.' }));
    if (!cloudAvailable()) wrap.lastChild.textContent = 'Team links need the website version. They are not available in the downloaded file.';
    for (const l of state.links) {
      const url = linkUrl(l.words);
      const row = el('div', { className: 'team-link' },
        el('div', { className: 'team-url', textContent: url.replace(/^https:\/\//, '') }),
        el('div', { className: 'team-meta', textContent: `${l.title || ''}${l.updated ? ` · updated ${clock(l.updated)}` : ''}` }),
        btn('Copy', async () => { try { await navigator.clipboard.writeText(url); say('Link copied.'); } catch { say(url); } }, 'btn-ghost'),
        btn('Update', () => publish(l.words), 'btn-ghost', { disabled: !canPublish }),
        btn('QR', () => showQr(url), 'btn-ghost', { title: 'Shows a QR code to scan with a phone camera.' }),
        btn('Stop sharing', () => {
          if (confirm('Stop sharing this link? Anyone who opens it will see that it is no longer active.')) run('Stopping…', () => stopSharing(l.words));
        }, 'btn-ghost'));
      wrap.append(row);
    }
    wrap.append(btn('Download phone view (.html)', downloadPhone, 'btn-secondary', { id: 'phone-download-button', disabled: !hasSchedule,
      title: 'A single file with the same read-only calendar, to send or open offline. It shows the schedule as of today and does not update.' }), msg);
  }
  redrawTeam = draw;
  draw();
  return wrap;
}
