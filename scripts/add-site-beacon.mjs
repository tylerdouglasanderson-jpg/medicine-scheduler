// Adds the Cloudflare Web Analytics beacon to the HOSTED page only (run by the public repo's Pages
// workflow on dist/index.html). The app itself and every downloadable file ship WITHOUT it, so the
// downloaded app sends nothing anywhere unless the user presses "Report a problem".
// Usage: node scripts/add-site-beacon.mjs dist/index.html
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SITE_BEACON = `<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "df859a3058d64f2cb31a24e189c51774"}'></script><!-- End Cloudflare Web Analytics -->`;

export function addSiteBeacon(html) {
  if (html.includes('static.cloudflareinsights.com/beacon.min.js')) return html;
  const i = html.lastIndexOf('</body>');
  if (i < 0) throw new Error('add-site-beacon: no </body> in page');
  return html.slice(0, i) + SITE_BEACON + '\n' + html.slice(i);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file = process.argv[2];
  if (!file) throw new Error('usage: node scripts/add-site-beacon.mjs <page.html>');
  writeFileSync(file, addSiteBeacon(readFileSync(file, 'utf8')));
  console.log(`site beacon added to ${file}`);
}
