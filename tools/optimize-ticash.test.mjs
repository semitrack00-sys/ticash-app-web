import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeHtml, brandHomepage, updateRechargeContent } from './optimize-ticash.mjs';
import homeCopy from '../js/home-copy.js';
const details = ['/', 'TiCash | Support family in Haiti', 'Service in development.'];
const image = 'data:image/png;base64,aGVsbG8=';
const fixture = `<!doctype html><html><head><title>Old</title><meta name="description" content="Old"><link rel="canonical" href="https://ticash-app.com/"><link rel="stylesheet" href="/style.css"><style>.brand {background:url('${image}')}</style></head><body><h1>Support family</h1><a href="/recharge">Recharge</a><img src="${image}"><script src="/public-config.js"></script></body></html>`;
test('homepage customer copy is complete and plain text in all 27 supported languages', () => {
  assert.equal(Object.keys(homeCopy).length, 27);
  for (const [code, values] of Object.entries(homeCopy)) {
    assert.equal(values.length, 15, code);
    for (const text of values) { assert.ok(typeof text === 'string' && text.trim()); assert.doesNotMatch(text, /<\/?[a-z]/i); }
    assert.ok(values[0].includes('FlupFlap') && values[0].includes('TiCash'), code);
  }
});
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
test('live recharge wording preserves the unpublished money-transfer status and separates the demo', () => {
  const source = '<section id="services"><p class="services-intro">Old</p><article class="service-card"><span class="service-status">COMING SOON</span><h3>Send Money</h3><p>Transfers</p></article><article class="service-card"><span class="service-status">COMING SOON</span><h3>Mobile Recharge</h3><p>Old</p><a href="/recharge">Learn more</a></article><article class="service-card"><span class="service-status">COMING SOON</span><h3>Internet &amp; Data Plans</h3><p>Old</p></article><div class="connect-copy"><p>Old</p><a href="/recharge">Explore FlupFlap Recharge</a></div><span class="demo-label">MOBILE RECHARGE</span><span class="demo-status">COMING SOON</span></section>';
  const updated = updateRechargeContent(source);
  assert.equal((updated.match(/COMING SOON/g) || []).length, 1);
  assert.ok(updated.includes('<h3>Send Money</h3><p>Transfers</p>'));
  assert.ok(updated.includes('AVAILABLE NOW'));
  assert.ok(updated.includes('mobile airtime worldwide'));
  assert.ok(updated.includes('Availability varies by country and operator'));
  assert.equal((updated.match(/AVAILABLE NOW/g) || []).length, 2);
  assert.ok(updated.includes('data-service-data'));
  assert.doesNotMatch(updated, /CHECK AVAILABILITY/);
  assert.ok(updated.includes('ILLUSTRATION'));
  assert.ok(updated.includes('applicable service fee'));
  assert.ok(updated.includes('Payment confirmation and recharge delivery are separate'));
  assert.equal(updateRechargeContent(updated), updated);
  assert.throws(() => updateRechargeContent('<html></html>'), /Missing homepage services section/);
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
