import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeHtml, brandHomepage } from './optimize-ticash.mjs';
const details = ['/', 'TiCash | Support family in Haiti', 'Service in development.'];
const image = 'data:image/png;base64,aGVsbG8=';
const fixture = `<!doctype html><html><head><title>Old</title><meta name="description" content="Old"><link rel="canonical" href="https://ticash-app.com/"><link rel="stylesheet" href="/style.css"><style>.brand {background:url('${image}')}</style></head><body><h1>Support family</h1><a href="/recharge">Recharge</a><img src="${image}"><script src="/public-config.js"></script></body></html>`;
test('deduplicates embedded image bytes across CSS and HTML without changing links or scripts', () => {
  const { html, assets } = optimizeHtml(fixture, details);
  assert.equal(assets.size, 1);
  const [path, asset] = [...assets][0];
  assert.equal(asset.bytes.toString(), 'hello');
  assert.equal(html.split(path).length - 1, 2);
  assert.ok(html.includes('<a href="/recharge">Recharge</a>'));
  assert.ok(html.includes('<script src="/public-config.js"></script>'));
  assert.ok(html.includes('<link rel="stylesheet" href="/style.css">'));
});
test('replaces stale metadata and is idempotent', () => {
  const once = optimizeHtml(fixture, details).html;
  const twice = optimizeHtml(once, details).html;
  assert.equal((once.match(/rel="canonical"/g) || []).length, 1);
  assert.ok(once.includes('href="https://www.ticash-app.com/"'));
  assert.equal((once.match(/<title>/g) || []).length, 1);
  assert.ok(once.includes('Service in development.'));
  assert.equal(twice, once);
});
test('rejects malformed and oversized pages', () => {
  assert.throws(() => optimizeHtml('<html></html>', details), /Missing HTML head/);
  assert.throws(() => optimizeHtml('<html><head></head><body>'+'x'.repeat(300000)+'</body></html>', details), /larger than/);
});
test('homepage branding uses the official logo and preserves the recharge destination', () => {
  const original = '<html><head></head><body><div class="connect-copy"><h2>Keep connected</h2><a href="/recharge">Explore Mobile Recharge</a></div></body></html>';
  const html = brandHomepage(original);
  assert.ok(html.includes('alt="FlupFlap"'));
  assert.ok(html.includes('Powered by</span><strong>TiCash App</strong>'));
  assert.ok(html.includes('href="/recharge">Explore FlupFlap Recharge</a>'));
  assert.ok(html.includes('<h2>Keep connected</h2>'));
  assert.equal(brandHomepage(html), html);
  assert.throws(() => brandHomepage('<head></head>'), /Expected one/);
});
