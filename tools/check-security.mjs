import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
function scripts(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? scripts(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
}
const browserFiles = [...scripts('js'), 'public-config.js', 'login/index.html', 'recharge/index.html', 'recharge/reset-password/index.html'];
const sources = browserFiles.map((path) => readFileSync(path, 'utf8')).join('\n');
assert.doesNotMatch(sources, /Test catalog operator|Test airtime|\+18765551234|preview-user|preview-range|preview-quote|__visual-fixture|flupflap-visual-preview|fixtures\.mjs/, 'Screenshot fixtures must never become application data');
assert.doesNotMatch(sources, /(?:\.\.\/|\.\/|\/)tools\//, 'Production browser code must not import test tools');
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
assert.doesNotMatch(sources, /STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|RELOADLY_CLIENT_SECRET|JWT_ACCESS_SECRET|DATABASE_URL|DWOLLA_CLIENT_SECRET|DIDIT_API_KEY|BEGIN (RSA |EC )?PRIVATE KEY|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/, 'Potential browser secret');
assert.doesNotMatch(sources, /\+509|countryCode:\s*['"]HT['"]/, 'No hardcoded destination');
for (const file of ['login/index.html', 'recharge/index.html', 'recharge/reset-password/index.html']) {
  const html = readFileSync(file, 'utf8');
  assert.match(html, /Content-Security-Policy/); assert.match(html, /form-action 'none'/);
  assert.doesNotMatch(html, /analytics\.js|data-analytics/, 'Do not instrument account or transaction pages');
  assert.doesNotMatch(html, /COMING SOON|No recharge purchases are accepted/);
}
const publicConfig = readFileSync('public-config.js', 'utf8');
assert.match(publicConfig, /mobileRechargeLive: true/);
assert.match(publicConfig, /sendMoneyLive: false/);

const render = readFileSync('render.yaml', 'utf8');
for (const required of [
  /X-Content-Type-Options[\s\S]*nosniff/,
  /X-Frame-Options[\s\S]*DENY/,
  /Referrer-Policy[\s\S]*no-referrer/,
  /Permissions-Policy/,
  /Cross-Origin-Opener-Policy[\s\S]*same-origin/,
  /Strict-Transport-Security[\s\S]*max-age=63072000/,
  /Content-Security-Policy[\s\S]*frame-ancestors 'none'/,
  /connect-src 'self' https:\/\/ticash-api\.onrender\.com/,
  /\/login[\s\S]*Cache-Control[\s\S]*no-store/,
  /\/recharge[\s\S]*Cache-Control[\s\S]*no-store/,
]) assert.match(render, required);
assert.doesNotMatch(render, /connect-src[^\n]*https:\s*;/, 'Production CSP must not allow arbitrary HTTPS API connections');
console.log('Browser security and production hardening checks passed.');
