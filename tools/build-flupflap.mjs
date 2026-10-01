import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
for (const path of ['public-config.js', 'route.css', 'language.css', 'login/login.css', 'recharge/checkout.css',
  'ticash-logo.png', 'brand/flupflap/icon.svg', 'brand/flupflap/flupflap-woman-worldwide-hero.png',
  'brand/flupflap/ChatGPT Image Sep 24, 2026, 09_49_40 PM.png']) copy(path);
// Country codes arrive from the backend at runtime, so static import traversal
// cannot discover these URLs. Ship the existing flag assets without fabricating
// coverage or copying unrelated files into the published directory.
for (const name of readdirSync(resolve(root, 'flags'))) {
  if (/^[a-z][a-z-]*\.svg$/.test(name) || name === 'LICENSE.flag-icons.txt') copy('flags/' + name);
}

function page(source, target) {
  const html = readFileSync(resolve(root, source), 'utf8')
    .replace('data-recharge-root', 'data-recharge-root data-recharge-path="/"')
    .replaceAll('href="/recharge"', 'href="/"')
    // Dedicated production output must agree with the existing Render header.
    // Do not carry development localhost entries (including invalid IPv6 CSP)
    // or an arbitrary-HTTPS connect allowlist into this artifact.
    .replace(/connect-src [^;]+;/g, "connect-src 'self' https://ticash-api.onrender.com;");
  mkdirSync(dirname(resolve(output, target)), { recursive: true });
  writeFileSync(resolve(output, target), html);
}
page('recharge/index.html', 'index.html');
page('login/index.html', 'login/index.html');
page('recharge/reset-password/index.html', 'reset-password/index.html');
// Compatibility for existing emails and already-issued Stripe return URLs.
// Serve aliases directly: no redirect can drop a token/query/fragment.
page('recharge/index.html', 'recharge/index.html');
page('recharge/reset-password/index.html', 'recharge/reset-password/index.html');
if (!existsSync(resolve(output, 'index.html'))) throw new Error('Missing FlupFlap root');
checkFlupflapAssets(output, root);
console.log('Built dedicated FlupFlap site: dist/flupflap');
