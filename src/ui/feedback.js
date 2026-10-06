/* global __BUILD_VERSION__ */
// "Report a problem or idea" modal. Posts { type, name, message, version, hp, scenario }
// to the Cloudflare Worker. The dialog lives on <body> (built once) so app re-renders don't reset it.

// Set this to the deployed Worker URL. While it still contains __SUBDOMAIN__ the button
// works but tells the user feedback isn't wired up yet (see submit()).
const ENDPOINT = 'https://med-scheduler-feedback.tyler-douglas-anderson.workers.dev/submit';
const CONFIGURED = !ENDPOINT.includes('__SUBDOMAIN__');

const MAX_SCENARIO = 250_000; // keep the worker from rejecting the whole report over a huge attach

let dialogEl = null;
let els = null;
let getScenarioJSON = () => null;

export function initFeedback(opts = {}) {
  if (typeof opts.getScenarioJSON === 'function') getScenarioJSON = opts.getScenarioJSON;
  ensureDialog();
}

// openFeedback({ type: 'problem' | 'idea', prefill }) — `prefill` seeds the message box so a contextual
// "Send this month to us" prompt can hand over what the app just showed. Callable as a bare click handler.
export function openFeedback(opts) {
  ensureDialog();
  resetForm();
  const { type, prefill } = opts && typeof opts === 'object' && !('target' in opts) ? opts : {};
  if (type === 'problem' || type === 'idea') {
    const radio = dialogEl.querySelector(`input[name="fb-type"][value="${type}"]`);
    if (radio) radio.checked = true;
  }
  if (typeof prefill === 'string') els.message.value = prefill;
  if (!dialogEl.open) dialogEl.showModal();
}

function ensureDialog() {
  if (dialogEl && document.body.contains(dialogEl)) return;

  dialogEl = document.createElement('dialog');
  dialogEl.id = 'feedback-dialog';
  dialogEl.setAttribute('aria-labelledby', 'feedback-title');
  dialogEl.setAttribute('aria-describedby', 'feedback-subtitle');
  dialogEl.innerHTML = `
    <div class="feedback-dialog-inner">
      <div class="feedback-header">
        <div class="feedback-heading">
          <h2 id="feedback-title">Report a problem or idea</h2>
          <p class="feedback-subtitle" id="feedback-subtitle">We'll see exactly what you see.</p>
        </div>
        <button type="button" class="btn-ghost" data-close title="Close" aria-label="Close">×</button>
      </div>
      <form novalidate>
        <fieldset class="feedback-type segmented">
          <legend class="visually-hidden">What are you sending?</legend>
          <input type="radio" name="fb-type" id="fb-type-problem" value="problem" checked>
          <label for="fb-type-problem">Problem</label>
          <input type="radio" name="fb-type" id="fb-type-idea" value="idea">
          <label for="fb-type-idea">Idea</label>
        </fieldset>
        <label class="feedback-field">Your name (optional)
          <input type="text" data-name maxlength="80" autocomplete="name">
        </label>
        <label class="feedback-field">What happened, or your idea
          <textarea data-message maxlength="4000" required
            placeholder="Describe the problem or share your idea…"></textarea>
        </label>
        <label class="check feedback-attach">
          <input type="checkbox" data-attach checked>
          <span>Attach my schedule (recommended)</span>
        </label>
        <p class="field-hint">This is the only thing the app sends anywhere — what you type here, the app
          version, and your month (roster, pins and all your solutions) if that box is ticked.</p>
        <div class="feedback-hp" aria-hidden="true">
          <label>Leave this empty<input type="text" data-hp tabindex="-1" autocomplete="off"></label>
        </div>
        <div class="feedback-actions">
          <button type="submit" class="btn-primary" data-send>Send</button>
          <button type="button" class="btn-ghost" data-close>Cancel</button>
        </div>
        <p class="feedback-status" role="status" data-status></p>
      </form>
    </div>`;

  document.body.appendChild(dialogEl);

  els = {
    form: dialogEl.querySelector('form'),
    name: dialogEl.querySelector('[data-name]'),
    message: dialogEl.querySelector('[data-message]'),
    attach: dialogEl.querySelector('[data-attach]'),
    hp: dialogEl.querySelector('[data-hp]'),
    send: dialogEl.querySelector('[data-send]'),
    status: dialogEl.querySelector('[data-status]'),
  };

  els.form.addEventListener('submit', submit);
  dialogEl.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => dialogEl.close()));
  dialogEl.addEventListener('click', e => { if (e.target === dialogEl) dialogEl.close(); }); // backdrop closes
}

function resetForm() {
  els.form.reset(); // restores defaults: type=problem, attach checked
  setStatus('');
  els.send.disabled = false;
}

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle('error', isError);
}

function currentType() {
  const checked = dialogEl.querySelector('input[name="fb-type"]:checked');
  return checked ? checked.value : 'problem';
}

async function submit(e) {
  e.preventDefault();
  if (!CONFIGURED) { setStatus('Feedback isn’t set up yet — please tell Tyler directly.', true); return; }

  const message = els.message.value.trim();
  if (!message) { setStatus('Please describe the problem or idea first.', true); return; }

  let scenario = els.attach.checked ? safeScenario() : null;
  if (scenario && scenario.length > MAX_SCENARIO) scenario = null; // too big to attach; still send the report

  const payload = {
    type: currentType(),
    name: els.name.value.trim(),
    message,
    version: typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : '',
    hp: els.hp.value,
    scenario,
  };

  els.send.disabled = true;
  setStatus('Sending…');
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setStatus('Thanks — sent ✓');
      setTimeout(() => dialogEl.close(), 1200);
    } else if (res.status === 429) {
      setStatus('Too many submissions right now — please try again later.', true);
      els.send.disabled = false;
    } else {
      setStatus('Could not send — please try again.', true);
      els.send.disabled = false;
    }
  } catch {
    setStatus('Could not send (are you offline?) — please try again.', true);
    els.send.disabled = false;
  }
}

function safeScenario() {
  try { return getScenarioJSON(); } catch { return null; }
}
