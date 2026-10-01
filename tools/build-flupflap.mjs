import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFlupflapAssets } from './check-flupflap-assets.mjs';

const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(root, 'dist/flupflap');
// Only the fixed generated directory can be removed; refuse symlinked output.
mkdirSync(resolve(root, 'dist'), { recursive: true });
if (realpathSync(resolve(root, 'dist')) !== resolve(root, 'dist') ||
    (existsSync(output) && realpathSync(output) !== output)) throw new Error('Unsafe build output path');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

const copy = path => {
  const target = resolve(output, path);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(resolve(root, path), target, { recursive: true });
};
// Copy only modules reachable from the existing recharge application, never
// source maps, test fixtures, preview scripts, admin or unrelated site pages.
const copied = new Set();
function moduleFile(path) {
  if (copied.has(path)) return;
  if (!path.startsWith('js/') || !path.endsWith('.js') || path.includes('..')) throw new Error('Unexpected browser module');
  copied.add(path); copy(path);
  const source = readFileSync(resolve(root, path), 'utf8');
  for (const [, dependency] of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
    if (!dependency.startsWith('.')) throw new Error('Unexpected external browser import');
    moduleFile(relative(root, resolve(root, dirname(path), dependency)).split(sep).join('/'));
  }
}
moduleFile('js/recharge-page.js');
moduleFile('js/join-page.js');
copy('join/marketing.css');
for (const path of ['public-config.js', 'route.css', 'language.css', 'login/login.css', 'login/feature-dialogs.js', 'support/flupflap-support.css', 'legal/flupflap-legal.css', 'recharge/checkout.css',
  'ticash-logo.png', 'brand/flupflap/icon.svg', 'brand/flupflap/favicon.svg', 'brand/flupflap/flupflap-woman-worldwide-hero.png',
  'brand/flupflap/ChatGPT Image Sep 24, 2026, 09_49_40 PM.png']) copy(path);
// Country codes arrive from the backend at runtime, so static import traversal
// cannot discover these URLs. Ship the existing flag assets without fabricating
// coverage or copying unrelated files into the published directory.
for (const name of readdirSync(resolve(root, 'flags'))) {
  if (/^[a-z][a-z-]*\.svg$/.test(name) || name === 'LICENSE.flag-icons.txt') copy('flags/' + name);
}

// Every deploy gets a content-derived asset version. This prevents browsers/CDNs
// from reusing old JavaScript or CSS at stable URLs after a successful Render deploy.
const versionHash = createHash('sha256');
for (const path of [
  ...copied,
  'public-config.js', 'route.css', 'language.css', 'login/login.css', 'support/flupflap-support.css',
  'legal/flupflap-legal.css', 'recharge/checkout.css', 'join/marketing.css',
  'recharge/index.html', 'login/index.html', 'support/flupflap-support.html',
  'legal/flupflap-privacy.html', 'legal/flupflap-terms.html', 'join/index.html',
  'recharge/reset-password/index.html',
].sort()) {
  versionHash.update(path);
  versionHash.update(readFileSync(resolve(root, path)));
}
const buildVersion = versionHash.digest('hex').slice(0, 16);

for (const path of copied) {
  const target = resolve(output, path);
  const source = readFileSync(target, 'utf8').replace(
    /(['"])(\.\.?\/[^'"]+\.js)\1/g,
    (_match, quote, specifier) => `${quote}${specifier}?v=${buildVersion}${quote}`,
  );
  writeFileSync(target, source);
}

for (const path of ['recharge/checkout.css']) {
  const target = resolve(output, path);
  const source = readFileSync(target, 'utf8').replace(
    /(@import\s+url\(['"]?)(\/[^)'"]+\.css)(['"]?\))/g,
    (_match, prefix, specifier, suffix) => `${prefix}${specifier}?v=${buildVersion}${suffix}`,
  );
  writeFileSync(target, source);
}

function page(source, target) {
  const html = readFileSync(resolve(root, source), 'utf8')
    .replace('data-recharge-root', 'data-recharge-root data-recharge-path="/"')
    .replaceAll('href="/recharge"', 'href="/"')
    .replace(/((?:src|href)="\/[^"]+\.(?:js|css))"/g, `$1?v=${buildVersion}"`)
    // Dedicated production output must agree with the existing Render header.
    // Do not carry development localhost entries (including invalid IPv6 CSP)
    // or an arbitrary-HTTPS connect allowlist into this artifact.
    .replace(/connect-src [^;]+;/g, "connect-src 'self' https://ticash-api.onrender.com;");
  mkdirSync(dirname(resolve(output, target)), { recursive: true });
  writeFileSync(resolve(output, target), html);
}
page('recharge/index.html', 'index.html');
page('login/index.html', 'login/index.html');
page('support/flupflap-support.html', 'support/index.html');
page('legal/flupflap-privacy.html', 'legal/privacy/index.html');
page('legal/flupflap-terms.html', 'legal/terms/index.html');
page('join/index.html', 'join/index.html');
page('recharge/reset-password/index.html', 'reset-password/index.html');
// Compatibility for existing emails and already-issued Stripe return URLs.
// Serve aliases directly: no redirect can drop a token/query/fragment.
page('recharge/index.html', 'recharge/index.html');
page('recharge/reset-password/index.html', 'recharge/reset-password/index.html');
if (!existsSync(resolve(output, 'index.html'))) throw new Error('Missing FlupFlap root');
checkFlupflapAssets(output, root);
console.log(`Built dedicated FlupFlap site: dist/flupflap (asset version ${buildVersion})`);
