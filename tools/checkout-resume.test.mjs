import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ApiError, createApiClient } from '../js/api-client.js';
import { mountRecharge } from '../js/recharge-page.js';
import { transaction } from './fixtures.mjs';

const token = 'R'.repeat(43);
const now = Date.parse('2026-09-28T12:00:00Z');
const result = (overrides = {}) => ({ transaction: {
  status: transaction.status, testMode: true,
  recipientPhone: transaction.recipientPhone, operatorName: transaction.operatorName, productName: transaction.productName,
  providerAmount: transaction.providerAmount, providerCurrency: transaction.providerCurrency,
  feeUsd: transaction.feeUsd, totalChargeUsd: transaction.totalChargeUsd,
  ...overrides,
} });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fakeClock() {
  let time = now, id = 0;
  const tasks = new Map();
  return {
    now: () => time, setTimeout(fn, ms) { tasks.set(++id, { fn, at: time + ms }); return id; },
    clearTimeout: key => tasks.delete(key),
    get size() { return tasks.size; },
    async advance(ms) {
      const end = time + ms;
      for (;;) {
        const next = [...tasks.entries()].sort((a,b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        time = next[1].at; tasks.delete(next[0]); next[1].fn(); await flush();
      }
      time = end;
    },
  };
}
function page(handler = () => result(), query = `checkoutResumeToken=${token}`) {
  const dom = new JSDOM('<main data-recharge-root data-login-brand="flupflap"></main>', {
    url: `https://website.example/recharge?${query}`,
  });
  const root = dom.window.document.querySelector('main');
  globalThis.document = dom.window.document;
  const calls = [], clock = fakeClock();
  const api = {
    async resumeCheckout(value) {
      assert.equal(dom.window.location.search, '', 'scrub occurs before the first request');
      calls.push('resume'); assert.equal(value, token); return handler(calls.length);
    },
    request() { assert.fail('Protected request in resume mode'); },
    guest() { assert.fail('Implicit guest session'); }, login() { assert.fail('Implicit login'); },
  };
  const app = mountRecharge(root, {}, { api, resumeClock: clock });
  return { app, root, dom, clock, calls, close() { app.dispose(); dom.window.close(); delete globalThis.document; } };
}

for (const domain of ['FLUPFLAP', 'TICASH']) {
  test(`${domain} resume endpoint uses only the opaque capability, even with an authenticated client`, async () => {
    const calls = [];
    const client = createApiClient({ baseUrl: 'https://api.example/api', identityDomain: domain, fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => url.endsWith('/login') ?
        { accessToken: 'private-access', refreshToken: 'private-refresh', user: { domain } } : result() };
    } });
    await client.login('test@example.test', 'test-password');
    await client.resumeCheckout(token);
    const request = calls.at(-1);
    assert.equal(request.url, `https://api.example/api${domain === 'FLUPFLAP' ? '/flupflap' : ''}/mobile-topups/checkout-resume`);
    assert.deepEqual(JSON.parse(request.options.body), { resumeToken: token });
    assert.equal(request.options.method, 'POST'); assert.equal(request.options.headers.Authorization, undefined);
    for (const [key, value] of Object.entries({ credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' })) assert.equal(request.options[key], value);
    assert.doesNotMatch(request.url, /private-access|private-refresh|resumeToken|transactionId/);
  });
}

test('API token validation matches the backend and never sends malformed capabilities', async () => {
  let calls = 0;
  const client = createApiClient({ baseUrl: 'https://api.example/api', fetchImpl: async () => { calls++; throw new Error(token); } });
  for (const invalid of ['', undefined, 'a'.repeat(42), 'a'.repeat(513), 'a'.repeat(43) + '=', '/api/mobile-topups/transactions']) {
    await assert.rejects(client.resumeCheckout(invalid), error => error.code === 'INVALID_RESUME_TOKEN' && !error.message.includes(token));
  }
  assert.equal(calls, 0);
  for (const valid of ['a'.repeat(43), 'a'.repeat(512), '_-'.repeat(22)]) await assert.rejects(client.resumeCheckout(valid), /unavailable/);
  assert.equal(calls, 3);
});

test('resume errors never expose server text or echoed tokens and never refresh credentials', async () => {
  let count = 0;
  const client = createApiClient({ baseUrl: 'https://api.example/api', fetchImpl: async () => {
    count++; return { ok: false, status: 410, json: async () => ({ code: token, error: token }) };
  } });
  await assert.rejects(client.resumeCheckout(token), error => error.code === 'RESUME_TOKEN_EXPIRED' && !String(error).includes(token));
  assert.equal(count, 1);
});

test('full return flow uses the real unauthenticated API client and exclusively posts status reads', async () => {
  const dom = new JSDOM('<main data-recharge-root data-login-brand="flupflap"></main>', {
    url: `https://website.example/recharge?checkoutResumeToken=${token}`,
  });
  globalThis.document = dom.window.document;
  const calls = [], clock = fakeClock();
  const api = createApiClient({ baseUrl: 'https://api.example/api', identityDomain: 'FLUPFLAP', fetchImpl: async (url, options) => {
    assert.equal(dom.window.location.search, ''); calls.push({ url, options });
    return { ok: true, status: 200, json: async () => result({ status: calls.length === 1 ? 'PENDING' : 'DELIVERED' }) };
  } });
  const app = mountRecharge(document.querySelector('main'), {}, { api, resumeClock: clock });
  try {
    await flush(); assert.match(document.querySelector('main').textContent, /PENDING/);
    await clock.advance(5000); assert.match(document.querySelector('main').textContent, /DELIVERED/);
    assert.equal(calls.length, 2);
    for (const { url, options } of calls) {
      assert.equal(url, 'https://api.example/api/flupflap/mobile-topups/checkout-resume');
      assert.equal(options.method, 'POST'); assert.equal(options.headers.Authorization, undefined);
      assert.deepEqual(JSON.parse(options.body), { resumeToken: token });
    }
    await assert.rejects(api.request('/mobile-topups/transactions'), error => error.code === 'UNAUTHENTICATED');
    assert.equal(calls.length, 2); assert.equal(clock.size, 0);
    assert.equal(app.model, undefined);
  } finally { app.dispose(); dom.window.close(); delete globalThis.document; }
});

test('leaving the return screen aborts the outstanding status request', async () => {
  const controller = new AbortController();
  let signal;
  const api = createApiClient({ baseUrl: 'https://api.example/api', fetchImpl: async (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  const pending = api.resumeCheckout(token, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /unavailable/); assert.equal(signal.aborted, true);
});

test('return displays only the recovered recharge without authenticating; URL is scrubbed synchronously', async () => {
  const p = page();
  try {
    assert.equal(p.dom.window.location.search, '');
    assert.equal(p.app.mode, 'resume'); assert.equal(p.app.model, undefined);
    assert.deepEqual(Object.keys(p.app).sort(), ['dispose', 'mode']);
    await flush();
    assert.match(p.root.textContent, /Test catalog operator/);
    assert.match(p.root.textContent, /PROCESSING/);
    assert.match(p.root.textContent, /\$8\.00/);
    assert.doesNotMatch(p.root.outerHTML, new RegExp(`${token}|private-account|private-hash|private-intent|private-access|private-refresh`));
    assert.equal(p.dom.window.sessionStorage.length, 0); assert.equal(p.dom.window.localStorage.length, 0);
    assert.equal(p.dom.window.document.cookie, '');
    assert.equal(p.root.querySelector('form, input, button'), null);
    const link = p.root.querySelector('a'); assert.equal(link.getAttribute('href'), '/recharge');
    assert.match(link.textContent, /Sign in or continue as guest/);
    assert.deepEqual(p.calls, ['resume']);
  } finally { p.close(); }
});

test('pending polls only resume; a later terminal result stops all polling', async () => {
  const p = page(count => result({ status: count < 3 ? 'PENDING' : 'DELIVERED' }));
  try {
    await flush(); assert.match(p.root.textContent, /PENDING/);
    await p.clock.advance(10000); assert.deepEqual(p.calls, ['resume', 'resume', 'resume']);
    assert.match(p.root.textContent, /DELIVERED/); assert.equal(p.clock.size, 0);
    await p.clock.advance(600000); assert.equal(p.calls.length, 3);
  } finally { p.close(); }
});

for (const status of ['DELIVERED', 'FAILED', 'REFUNDED']) test(`${status} clears the capability and stops immediately`, async () => {
  const p = page(() => result({ status }));
  try { await flush(); assert.equal(p.clock.size, 0); await p.clock.advance(600000); assert.equal(p.calls.length, 1); }
  finally { p.close(); }
});

for (const query of ['checkoutResumeToken=bad', 'checkoutResumeToken=', `checkoutResumeToken=${token}&checkoutResumeToken=${token}`]) {
  test(`invalid/duplicate return capability fails closed (${query.length} characters)`, async () => {
    const p = page(undefined, query);
    try { await flush(); assert.equal(p.calls.length, 0); assert.match(p.root.textContent, /unavailable/); assert.equal(p.clock.size, 0); }
    finally { p.close(); }
  });
}

test('server expiry and fatal errors clear the capability without echoing it', async () => {
  for (const status of [410, 404, 429, 500]) {
    const p = page(() => { throw new ApiError('UNSAFE', token, status); });
    try {
      await flush(); assert.match(p.root.textContent, status === 410 ? /expired/ : /unavailable/);
      assert.ok(!p.root.textContent.includes(token)); assert.equal(p.clock.size, 0);
      await p.clock.advance(600000); assert.equal(p.calls.length, 1);
    } finally { p.close(); }
  }
});

test('public DTO needs no expiry metadata; server expiry stops pending polling and clears the capability', async () => {
  const p = page(count => {
    if (count > 1) throw new ApiError('RESUME_TOKEN_EXPIRED', 'Expired', 410);
    return result();
  });
  try {
    await flush(); assert.match(p.root.textContent, /PROCESSING/);
    await p.clock.advance(5000); assert.match(p.root.textContent, /expired/); assert.equal(p.clock.size, 0);
    await p.clock.advance(600000); assert.equal(p.calls.length, 2);
  } finally { p.close(); }
});

for (const action of ['pagehide', 'dispose']) test(`${action} stops pending recovery and ignores late responses`, async () => {
  let resolve;
  const p = page(() => new Promise(r => { resolve = r; }));
  try {
    if (action === 'pagehide') p.dom.window.dispatchEvent(new p.dom.window.Event('pagehide'));
    else p.app.dispose();
    resolve(result()); await flush(); await p.clock.advance(600000);
    assert.equal(p.root.textContent, ''); assert.equal(p.clock.size, 0); assert.equal(p.calls.length, 1);
  } finally { p.close(); }
});

test('internal transaction fields or malformed/non-sandbox DTOs fail closed', async () => {
  for (const change of [{ id: 'different' }, { testMode: false }, { paymentProvider: 'MOCK' }, { status: 'MADE_UP' }, { totalChargeUsd: NaN }]) {
    const p = page(() => result(change));
    try { await flush(); assert.match(p.root.textContent, /unavailable/); assert.equal(p.clock.size, 0); }
    finally { p.close(); }
  }
  const p = page(count => result(count > 1 ? { id: '33333333-3333-4333-8333-333333333333' } : {}));
  try { await flush(); await p.clock.advance(5000); assert.match(p.root.textContent, /unavailable/); assert.equal(p.clock.size, 0); }
  finally { p.close(); }
});

test('legacy transaction and Stripe session query IDs cannot recover a transaction', async () => {
  for (const key of ['transactionId', 'orderId', 'rechargeOrderId', 'session_id', 'checkout_session_id']) {
    const p = page(undefined, `${key}=cs_test_not_internal`);
    try { await flush(); assert.notEqual(p.app.mode, 'resume'); assert.equal(p.dom.window.location.search, ''); assert.equal(p.calls.length, 0); }
    finally { p.close(); }
  }
});

test('resume module has no protected API, browser fulfillment, token persistence, or logging path', () => {
  const source = readFileSync('js/checkout-resume.js', 'utf8');
  assert.doesNotMatch(source, /\.request\(|\.login\(|\.guest\(|signedIn|localStorage|sessionStorage|console\.|\.cookie|fulfillPaidRecharge/);
  assert.match(source, /resumeToken = ''/);
  assert.match(source, /if \(terminal\.has\(next\.status\)\) stop\(\)/);
  assert.match(source, /client\.resumeCheckout\(resumeToken, /);
});
