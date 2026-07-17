import { it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

it('single-file build emits dist/med-scheduler.html with no external refs', () => {
  execSync('npm run build', { stdio: 'pipe' });
  expect(existsSync('dist/med-scheduler.html')).toBe(true);
  const html = readFileSync('dist/med-scheduler.html', 'utf8');
  // no non-data external script/img refs. Tag-scoped: `[^>]*` can't cross the `>`, so a `src=`
  // attribute must live inside a <script>/<img> OPENING tag — not an inlined JS `.src="javascript:"`
  // string literal that ships inside the (inlined) ExcelJS bundle.
  expect(html).not.toMatch(/<(?:script|img)\b[^>]*\ssrc="(?!data:)[^"]/i);
  expect(html).not.toMatch(/href=".*\.css"/);      // css inlined
  expect(html.length).toBeGreaterThan(500_000);    // wasm actually inlined
}, 120_000);
