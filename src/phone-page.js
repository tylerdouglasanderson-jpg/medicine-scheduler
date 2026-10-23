// Phone team view, page side: one self-contained HTML string. The Worker serves it at /<three-words> (with the
// install hooks on) and the app's "Download phone view" button saves the same page as a plain file (hooks off).
// No imports beyond the client script, so the Worker bundle stays small.
import { phoneClient } from './phone-client.js';

const CSS = `
:root{--bg:#f4f6f8;--card:#fff;--ink:#16202a;--mute:#5d6b78;--line:#d8dee4;--acc:#1f6fb2;--accink:#fff;--me:#e6f1fb}
@media (prefers-color-scheme:dark){:root{--bg:#10161c;--card:#1a232c;--ink:#e8eef3;--mute:#9aa8b5;--line:#2b3742;--acc:#4a9ee0;--accink:#08121a;--me:#17324a}}
*{box-sizing:border-box}html,body{margin:0}
::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--line);border-radius:999px;border:2px solid transparent;background-clip:content-box}::-webkit-scrollbar-thumb:hover{background:var(--mute);background-clip:content-box}
@supports not selector(::-webkit-scrollbar){*{scrollbar-width:thin;scrollbar-color:var(--line) transparent}}
body{font:16px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink);min-height:100vh;
  padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
.top{padding:12px 16px 4px}.top h1{margin:0;font-size:19px}.top small{color:var(--mute)}
.bar{display:flex;gap:8px;align-items:center;padding:8px 16px;flex-wrap:wrap}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.seg button{border:0;background:var(--card);color:var(--ink);padding:9px 16px;font:inherit;min-height:44px}
.seg button.on{background:var(--acc);color:var(--accink);font-weight:600}
.pill{border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:10px;padding:9px 12px;font:inherit;min-height:44px}
#strip{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;padding:0 12px}
.sc{border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:10px;padding:6px 0;font:inherit;
  display:flex;flex-direction:column;align-items:center;min-height:62px}
.sc span{font-size:12px;color:var(--mute)}.sc b{font-size:18px}.sc em{display:flex;gap:2px;height:8px;margin-top:2px}
.sc.blank{border:0;background:none}.sc.sel{border-color:var(--acc);box-shadow:0 0 0 2px var(--acc)}.sc.today b{text-decoration:underline}
i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:middle}.sc em i{margin:0}
#swipe{padding:10px 12px 90px;touch-action:pan-y}
#card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
#card header{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-bottom:6px}
#card h2{margin:0;font-size:22px}.type{background:var(--acc);color:var(--accink);border-radius:8px;padding:2px 10px;font-weight:600}
.mr{color:#7030a0;font-weight:600}@media (prefers-color-scheme:dark){.mr{color:#c9a3e8}}
#card h3{margin:12px 0 2px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--mute)}
#card p{margin:2px 0;padding:3px 8px;border-radius:6px}#card p.me{background:var(--me);font-weight:600}.none{color:var(--mute)}
.foot{position:fixed;left:0;right:0;bottom:0;background:var(--card);border-top:1px solid var(--line);
  padding:8px 16px calc(8px + env(safe-area-inset-bottom));display:flex;gap:10px;align-items:center;justify-content:space-between;font-size:13px;color:var(--mute)}
#install{padding:6px 16px;font-size:13px;color:var(--mute)}
#whodlg{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px}
#whodlg[hidden],#install[hidden]{display:none}
#whodlg div.box{background:var(--card);border-radius:14px;padding:16px;max-width:380px;width:100%;max-height:85vh;overflow:auto}
#whodlg h2{margin:0 0 8px;font-size:18px}#wholist button{display:block;width:100%;margin:6px 0;padding:12px;font:inherit;
  border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);text-align:left;min-height:44px}
#wholist button.ghost{color:var(--mute)}
#grid{display:none;padding:0 12px 60px}
.gh,.gb{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}.gh span{text-align:center;font-size:12px;color:var(--mute)}
.gc{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:3px 5px;min-height:70px;font-size:11px;overflow:hidden}
.gc.blank{border:0;background:none}.gc.today{border-color:var(--acc);box-shadow:0 0 0 2px var(--acc)}
.gc b{font-size:13px;margin-right:4px}.gc small{color:var(--mute)}.gc p{margin:1px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gc i{width:6px;height:6px;margin-right:3px}
@media (orientation:landscape) and (max-height:520px){#swipe,#strip{display:none}#grid{display:block}}
`;

const toJson = v => JSON.stringify(v).replace(/</g, '\\u003c').replace(new RegExp('[\\u2028\\u2029]', 'g'), c => (c === '\u2028' ? '\\u2028' : '\\u2029'));
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function formatUpdated(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // Rendered on the Worker (UTC), so pin the zone: the team is in Fort Worth (US Central, CST/CDT).
  return d.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

// words: the team link's three words when served by the Worker (turns on the manifest, icons and service worker).
export function phoneHtml(data, { words = null } = {}) {
  const install = !!words;
  const payload = { ...data, install };
  const head = install
    ? `<link rel="manifest" href="/${escHtml(words)}.webmanifest">
<link rel="apple-touch-icon" href="/icon-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${escHtml(data.team || 'Schedule')}">
<meta name="theme-color" content="#1f6fb2">`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${escHtml(data.title)}</title>
${head}
<style>${CSS}</style></head><body>
<div class="top"><h1>${escHtml(data.title)}</h1><small id="upd" data-iso="${escHtml(data.updated)}">Updated ${escHtml(formatUpdated(data.updated))} &middot; built ${escHtml(data.version)}</small></div>
<div class="bar"><span class="seg"><button id="mode-me">Me</button><button id="mode-all">Everyone</button></span>
<button class="pill" id="who">Pick your name</button><button class="pill" id="today">Today</button></div>
<div id="install" hidden></div>
<div id="strip"></div>
<div id="swipe"><div id="card"></div></div>
<div id="grid"></div>
<div class="foot"><span>Read-only team schedule. Swipe left or right to change day.</span></div>
<div id="whodlg" hidden><div class="box"><h2>Which one are you?</h2><div id="wholist"></div></div></div>
<script>var __name=function(f){return f};(${phoneClient.toString()})(${toJson(payload)});</script>
</body></html>`;
}
