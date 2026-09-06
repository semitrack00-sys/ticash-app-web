import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const pages = [
  'index.html',
  'send/index.html',
  'recharge/index.html',
  'get-ticash/index.html',
  'login/index.html',
  'support/index.html',
  'legal/privacy/index.html',
  'legal/terms/index.html',
];

for (const page of pages) {
  assert.ok(existsSync(join(root, page)), `Missing public route page: ${page}`);
}
assert.ok(existsSync(join(root, 'ticash-logo.png')), 'Missing cross-platform TiCash logo');

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    if (name === '.git' || name === 'node_modules') return [];
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

for (const path of walk(root)) {
  const name = path.slice(path.lastIndexOf('\\') + 1);
  assert.doesNotMatch(name, /[<>:"|?*]/, `Windows-incompatible filename: ${path}`);
}

const marketingPages = pages.map((page) => readFileSync(join(root, page), 'utf8')).join('\n');
assert.match(marketingPages, /United States/);
assert.match(marketingPages, /Haiti/);
assert.match(marketingPages, /COMING SOON|Coming Soon/);
assert.doesNotMatch(marketingPages, /play\.google\.com\/store\/apps/i);
assert.doesNotMatch(marketingPages, /apps\.apple\.com/i);
assert.doesNotMatch(marketingPages, /Reloadly|Dwolla|Sandbox|mock payment/i);
assert.doesNotMatch(marketingPages, /ticash-logo\.png\?v=3/i);

for (const route of ['/send', '/recharge']) {
  assert.match(marketingPages, new RegExp(`href=["']${route}["']`), `Missing fallback link for ${route}`);
}

const publicConfig = readFileSync(join(root, 'public-config.js'), 'utf8');
for (const flag of ['androidPublished', 'iosPublished', 'sendMoneyLive', 'mobileRechargeLive']) {
  assert.match(publicConfig, new RegExp(`${flag}: false`), `${flag} must fail closed`);
}

const assetLinks = JSON.parse(readFileSync(join(root, '.well-known/assetlinks.json'), 'utf8'));
assert.deepEqual(assetLinks, [], 'Android association must remain empty until the release fingerprint is known');

for (const path of ['.well-known/apple-app-site-association', 'apple-app-site-association']) {
  const association = JSON.parse(readFileSync(join(root, path), 'utf8'));
  assert.deepEqual(association.applinks.details, [], 'Apple association must remain empty until real identifiers are known');
}

const analytics = readFileSync(join(root, 'analytics.js'), 'utf8');
assert.match(analytics, /ticash_web_action/);
assert.doesNotMatch(analytics, /email|phone|amount|accountId|transactionId|kyc/i);

const renderConfig = readFileSync(join(root, 'render.yaml'), 'utf8');
assert.match(renderConfig, /path: \/\.well-known\/\*/);
assert.match(renderConfig, /path: \/apple-app-site-association/);
assert.match(renderConfig, /value: application\/json/g);

const activationChecklist = readFileSync(join(root, 'PRODUCTION_ACTIVATION_CHECKLIST.md'), 'utf8');
assert.match(activationChecklist, /SHA-256 fingerprint/);
assert.match(activationChecklist, /Apple Team ID/);
assert.match(activationChecklist, /APPROVED_FOR_LIVE_USE=false/);

console.log('TiCash website integrity checks passed.');
