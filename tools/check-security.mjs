import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
function scripts(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? scripts(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
}
const browserFiles = [...scripts('js'), 'public-config.js', 'login/index.html', 'recharge/index.html', 'recharge/reset-password/index.html'];
const sources = browserFiles.map((path) => readFileSync(path, 'utf8')).join('\n');
assert.doesNotMatch(sources, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(/, 'Unsafe DOM execution sink');
for (const file of browserFiles.filter((file) => file !== 'js/i18n.js')) {
  assert.doesNotMatch(readFileSync(file, 'utf8'), /localStorage|sessionStorage|document\.cookie|indexedDB/, 'Credentials must remain in memory');
}
const preferences = readFileSync('js/i18n.js', 'utf8');
assert.doesNotMatch(preferences, /sessionStorage|document\.cookie|indexedDB/);
assert.deepEqual([...preferences.matchAll(/preferenceStorage\?\.([^(]+)\(([^)]*)\)/g)].map((match) => match.slice(1)), [
  ['getItem', "'ticash.language'"], ['setItem', "'ticash.language', language"],
], 'Only the non-sensitive language preference may be persisted');
assert.doesNotMatch(sources, /console\.(log|debug|info|warn|error)\(/, 'No sensitive browser logging');
assert.doesNotMatch(sources, /https?:\/\/[^\s'"<>]*reloadly\./i, 'Browser must not contact provider');
assert.doesNotMatch(sources, /RELOADLY_CLIENT_SECRET|JWT_ACCESS_SECRET|DATABASE_URL|DWOLLA_CLIENT_SECRET|DIDIT_API_KEY|BEGIN (RSA |EC )?PRIVATE KEY|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/, 'Potential browser secret');
assert.doesNotMatch(sources, /\+509|countryCode:\s*['"]HT['"]/, 'No hardcoded destination');
for (const file of ['login/index.html', 'recharge/index.html', 'recharge/reset-password/index.html']) {
  const html = readFileSync(file, 'utf8');
  assert.match(html, /TEST MODE/); assert.match(html, /Content-Security-Policy/); assert.match(html, /form-action 'none'/);
  assert.doesNotMatch(html, /analytics\.js|data-analytics/, 'Do not instrument account or transaction pages');
  assert.doesNotMatch(html, /COMING SOON|No recharge purchases are accepted/);
}
assert.match(readFileSync('public-config.js', 'utf8'), /mobileRechargeLive: false/);
console.log('Browser security and test-mode checks passed.');
