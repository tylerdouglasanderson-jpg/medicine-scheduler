// The phone page's browser script. It is serialised with .toString() into the page, so it must stay
// self-contained: no imports, no references to anything outside this function.
export function phoneClient(DATA) {
  const $ = id => document.getElementById(id);
  const KEY_WHO = 'ms-who', KEY_MODE = 'ms-mode';
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    del: k => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
  };
  const days = DATA.days;
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const KINDS = {
    ROUNDERS: { label: 'Working', dot: '#d9534f' }, PAGER: { label: 'Pager', dot: '#3c9d4e' },
    CLINIC: { label: 'Commitments', dot: '#e0a800' }, DIDACTICS: { label: 'Didactics', dot: '#e8803a' },
    PTO: { label: 'PTO', dot: '#c47f00' }, OFF: { label: 'Off', dot: '#d6609a' },
  };
  const ORDER = ['ROUNDERS', 'PAGER', 'CLINIC', 'DIDACTICS', 'PTO', 'OFF'];
  const names = [...DATA.residents].sort((a, b) => b.length - a.length);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nameRx = n => new RegExp('(^|[^A-Za-z0-9])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9])');

  // Which residents a piece of text names (longest name first; each match is blanked so "Ann" inside "Anna" is not counted).
  function whoIn(text) {
    const found = new Set();
    let rest = text;
    for (const n of names) {
      const rx = nameRx(n);
      if (rx.test(rest)) {
        found.add(n);
        rest = rest.replace(new RegExp(rx.source, 'g'), '$1 ');
      }
    }
    return found;
  }
  // A row's text split into entries; rounders are one per line, the others one per ", ".
  const entries = (row, text) => (text ? text.split(row === 'ROUNDERS' ? '\n' : ', ') : []);
  const mine = (row, d, who) => entries(row, d.rows[row]).filter(e => whoIn(e).has(who));
  const dowOf = date => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };

  let who = store.get(KEY_WHO);
  if (who && !DATA.residents.includes(who)) who = null;
  let mode = store.get(KEY_MODE) === 'all' ? 'all' : 'me';
  if (!who) mode = 'all';
  const today = (() => {
    const t = new Date(), p = n => String(n).padStart(2, '0');
    return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
  })();
  let idx = Math.max(0, days.findIndex(d => d.date === today));

  const dots = d => (who ? ORDER.filter(r => mine(r, d, who).length)
    .map(r => '<i style="background:' + KINDS[r].dot + '"></i>').join('') : '');

  function renderStrip() {
    const start = Math.max(0, idx - dowOf(days[idx].date)), cells = [];
    for (let k = 0; k < 7; k++) {
      const i = start + k, d = days[i];
      if (!d || dowOf(d.date) !== k) { cells.push('<div class="sc blank"></div>'); continue; }
      cells.push('<button class="sc' + (i === idx ? ' sel' : '') + (d.date === today ? ' today' : '') + '" data-i="' + i + '">' +
        '<span>' + DOW[k][0] + '</span><b>' + Number(d.date.slice(8)) + '</b><em>' + dots(d) + '</em></button>');
    }
    $('strip').innerHTML = cells.join('');
  }
  function section(row, d) {
    let list = entries(row, d.rows[row]);
    if (mode === 'me' && who) list = list.filter(e => whoIn(e).has(who) || (row === 'ROUNDERS' && whoIn(e).size === 0));
    if (!list.length) return '';
    const cls = e => (who && whoIn(e).has(who) ? ' class="me"' : '');
    return '<section><h3><i style="background:' + KINDS[row].dot + '"></i>' + KINDS[row].label + '</h3>' +
      list.map(e => '<p' + cls(e) + '>' + esc(e) + '</p>').join('') + '</section>';
  }
  function renderCard() {
    const d = days[idx];
    const mr = DATA.morningReportDays.includes(d.date) ? '<span class="mr">Morning report</span>' : '';
    let body = ORDER.map(r => section(r, d)).join('');
    if (!body) body = '<p class="none">' + (mode === 'me' && who ? 'Nothing for you this day.' : 'Nothing scheduled.') + '</p>';
    $('card').innerHTML = '<header><h2>' + DOW[dowOf(d.date)] + ' ' + Number(d.date.slice(5, 7)) + '/' + Number(d.date.slice(8)) +
      '</h2><span class="type">' + esc(d.type) + '</span>' + mr + '</header>' + body;
  }
  function renderGrid() {
    const cells = [];
    for (let k = 0; k < dowOf(days[0].date); k++) cells.push('<div class="gc blank"></div>');
    for (const d of days) {
      let inner;
      if (mode === 'me' && who) {
        inner = ORDER.map(r => mine(r, d, who).map(e =>
          '<p><i style="background:' + KINDS[r].dot + '"></i>' + esc(e) + '</p>').join('')).join('');
      } else {
        inner = entries('ROUNDERS', d.rows.ROUNDERS).map(e => '<p>' + esc(e) + '</p>').join('');
      }
      cells.push('<div class="gc' + (d.date === today ? ' today' : '') + '"><b>' + Number(d.date.slice(8)) + '</b><small>' +
        esc(d.type) + '</small>' + inner + '</div>');
    }
    $('grid').innerHTML = '<div class="gh">' + DOW.map(n => '<span>' + n + '</span>').join('') + '</div><div class="gb">' + cells.join('') + '</div>';
  }
  function render() {
    $('who').textContent = who || 'Pick your name';
    $('mode-me').classList.toggle('on', mode === 'me');
    $('mode-all').classList.toggle('on', mode === 'all');
    renderStrip(); renderCard(); renderGrid();
  }
  const go = i => { idx = Math.min(days.length - 1, Math.max(0, i)); render(); };

  function askWho() {
    $('wholist').innerHTML = DATA.residents.map(n => '<button data-n="' + esc(n) + '">' + esc(n) + '</button>').join('') +
      '<button data-n="" class="ghost">Just looking</button>';
    $('whodlg').hidden = false;
  }
  $('wholist').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    who = b.dataset.n || null;
    if (who) { store.set(KEY_WHO, who); mode = 'me'; store.set(KEY_MODE, 'me'); } else { store.del(KEY_WHO); mode = 'all'; }
    $('whodlg').hidden = true;
    render();
  });
  $('who').onclick = askWho;
  $('mode-me').onclick = () => { if (!who) { askWho(); return; } mode = 'me'; store.set(KEY_MODE, 'me'); render(); };
  $('mode-all').onclick = () => { mode = 'all'; store.set(KEY_MODE, 'all'); render(); };
  $('strip').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) go(Number(b.dataset.i)); });
  $('today').onclick = () => { const i = days.findIndex(d => d.date === today); go(i < 0 ? 0 : i); };
  let sx = null, sy = null;
  const swipe = $('swipe');
  swipe.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  swipe.addEventListener('touchend', e => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) go(idx + (dx < 0 ? 1 : -1));
  }, { passive: true });
  document.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') go(idx - 1); if (e.key === 'ArrowRight') go(idx + 1); });

  render();
  if (!who && !store.get('ms-asked')) { store.set('ms-asked', '1'); askWho(); }
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  if (!standalone && DATA.install) {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    $('install').hidden = false;
    $('install').textContent = ios ? 'Add to Home Screen: tap Share, then "Add to Home Screen".'
      : 'Install: browser menu, then "Install app" or "Add to Home screen".';
  }
  if (DATA.install && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
