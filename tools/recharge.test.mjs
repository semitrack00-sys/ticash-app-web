import test from 'node:test';
import assert from 'node:assert/strict';
import { Recharge, internationalPhone, searchCountries, secureId, assertTestService } from '../js/recharge.js';
import { ApiError } from '../js/api-client.js';
import { fixtureApi, countries, operator, products, quote, transaction, status } from './fixtures.mjs';

async function setup() {
  const api = fixtureApi(); const model = new Recharge(api);
  await model.start(); await model.selectCountry('JM'); model.setPhone('+1 (876) 555-1234');
  await model.selectOperator(77); model.selectProduct(products[0].id);
  return { api, model };
}
async function reviewed(model) { await model.getQuote(); model.review(true); }
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }

test('loads only provider countries and searches name/code without a fixed destination', async () => {
  const { model } = await setup();
  assert.deepEqual(model.state.countries, countries);
  assert.deepEqual(searchCountries(countries, 'cAn'), [countries[1]]);
  assert.deepEqual(searchCountries(countries, 'jm'), [countries[0]]);
  assert.deepEqual(searchCountries(countries, 'absent'), []);
});
test('normalizes international input and rejects local or malformed phone numbers', () => {
  assert.equal(internationalPhone('00 1 (876) 555-1234'), '+18765551234');
  for (const phone of ['8765551234', '+0 123456789', '+1<script>', '+12']) assert.throws(() => internationalPhone(phone));
});
for (const change of ['country', 'phone', 'operator', 'product', 'amount']) {
  test(`${change} change clears quote, review, transaction, and the required downstream selection`, async () => {
    const { model } = await setup(); await reviewed(model); model.state.transaction = transaction;
    if (change === 'country') await model.selectCountry('CA');
    if (change === 'phone') model.setPhone('+16135551234');
    if (change === 'operator') await model.selectOperator('');
    if (change === 'product') model.selectProduct(products[1].id);
    if (change === 'amount') model.setAmount('12');
    assert.equal(model.state.quote, null); assert.equal(model.state.reviewed, false); assert.equal(model.state.transaction, null);
    if (['country', 'phone', 'operator'].includes(change)) { assert.equal(model.state.operator, null); assert.deepEqual(model.state.products, []); assert.equal(model.state.product, null); }
    if (change === 'country') assert.equal(model.state.phone, '+1');
  });
}
test('detects an operator and loads its returned products', async () => {
  const { model } = await setup(); await model.detect();
  assert.equal(model.state.operator.id, 77); assert.deepEqual(model.state.products, products);
});
test('failed detection permits manual operator fallback', async () => {
  const { model, api } = await setup();
  api.overrides.set('GET /mobile-topups/operators/detect', () => { throw new ApiError('NOT_FOUND', 'Choose an operator manually.', 404); });
  await model.detect(); assert.match(model.state.error, /manually/);
  await model.selectOperator(77); assert.equal(model.state.products.length, 2);
});
test('fixed quote sends no client price, fee or total; review uses server totals', async () => {
  const { model, api } = await setup(); await model.getQuote();
  const call = api.calls.find((c) => c.path === '/mobile-topups/quotes');
  assert.deepEqual(call.body, { countryCode: 'JM', phone: '+18765551234', operatorId: 77, productId: products[0].id });
  assert.equal(model.state.quote.totalChargeUsd, 8); assert.equal(model.state.reviewed, false);
});
test('range quote sends a valid amount and rejects out-of-range or fractional-cent input', async () => {
  const { model, api } = await setup(); model.selectProduct(products[1].id);
  for (const amount of ['4.99', '20.01', 'NaN', '8.001', '']) {
    model.setAmount(amount); await model.getQuote(); assert.equal(model.state.quote, null);
  }
  model.setAmount('13.25'); await model.getQuote();
  assert.equal(api.calls.filter((c) => c.path === '/mobile-topups/quotes').at(-1).body.amount, 13.25);
});
test('cannot confirm without review or after quote expiry', async () => {
  const { model, api } = await setup(); await model.getQuote(); await model.confirm();
  assert.equal(api.calls.filter((c) => c.path === '/mobile-topups/transactions' && c.method === 'POST').length, 0);
  model.review(true); model.now = () => Date.parse('2100-01-01'); await model.confirm();
  assert.match(model.state.error, /current quote/);
});
test('confirmation sends a secure key, only quoteId, and creates a test receipt', async () => {
  const { model, api } = await setup(); await reviewed(model); await model.confirm();
  const call = api.calls.find((c) => c.path === '/mobile-topups/transactions' && c.method === 'POST');
  assert.deepEqual(call.body, { quoteId: quote.id }); assert.match(call.headers['Idempotency-Key'], /^[\da-f-]{36}$/);
  assert.equal(model.state.transaction.status, 'PROCESSING'); assert.equal(model.state.quote, null);
  await model.confirm(); assert.equal(api.calls.filter((c) => c.path === call.path && c.method === 'POST').length, 1);
});
test('simultaneous confirmations submit once and prevent selection edits', async () => {
  const { model, api } = await setup(); await reviewed(model); const pending = deferred();
  api.overrides.set('POST /mobile-topups/transactions', () => pending.promise);
  const first = model.confirm(); await Promise.resolve(); await model.confirm();
  assert.equal(model.state.submitting, true); assert.throws(() => model.setPhone('+16135551234'));
  pending.resolve({ transaction }); await first;
  assert.equal(api.calls.filter((c) => c.path === '/mobile-topups/transactions' && c.method === 'POST').length, 1);
});
test('unknown outcome retries identical payload/key and history can resolve it', async () => {
  const { model, api } = await setup(); await reviewed(model);
  api.overrides.set('POST /mobile-topups/transactions', () => { throw new ApiError('NETWORK_ERROR', 'Connection lost.'); });
  await model.confirm(); await model.confirm();
  const calls = api.calls.filter((c) => c.method === 'POST' && c.path === '/mobile-topups/transactions');
  assert.deepEqual(calls[0], calls[1]); assert.throws(() => model.setAmount('9'));
  api.overrides.set('GET /mobile-topups/transactions', () => ({ transactions: [transaction] }));
  await model.loadHistory(); assert.equal(model.state.attempt, null); assert.equal(model.state.transaction.id, transaction.id);
});
test('expired backend quote releases rejected attempt so a new quote can be requested', async () => {
  const { model, api } = await setup(); await reviewed(model);
  api.overrides.set('POST /mobile-topups/transactions', () => { throw new ApiError('TOPUP_QUOTE_EXPIRED', 'Expired', 409); });
  await model.confirm(); assert.equal(model.state.attempt, null); assert.equal(model.state.quote, null);
  await reviewed(model); api.overrides.delete('POST /mobile-topups/transactions'); await model.confirm();
  const calls = api.calls.filter((c) => c.method === 'POST' && c.path === '/mobile-topups/transactions');
  assert.notEqual(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
});
test('transaction status refresh and repeat use exact contract; repeat requires new review', async () => {
  const { model, api } = await setup(); await reviewed(model); await model.confirm();
  await model.refreshTransaction(); assert.equal(model.state.transaction.status, 'DELIVERED');
  await model.repeat(transaction.id); assert.equal(model.state.quote.totalChargeUsd, 8.75); assert.equal(model.state.reviewed, false);
  assert.equal(api.calls.at(-1).path, `/mobile-topups/transactions/${transaction.id}/repeat`);
});
test('saved recipients repopulate destination with current provider catalog', async () => {
  const { model } = await setup(); await model.useRecipient('saved');
  assert.equal(model.state.phone, quote.recipientPhone); assert.equal(model.state.operator.id, 77); assert.equal(model.state.quote, null);
});
test('stale detection, product, and quote responses cannot restore invalidated state', async () => {
  for (const [method, path, start, response] of [
    ['GET', '/mobile-topups/operators/detect', (m) => m.detect(), { operator }],
    ['GET', '/mobile-topups/operators/77/products', (m) => m.selectOperator(77), { operator, products }],
    ['POST', '/mobile-topups/quotes', (m) => m.getQuote(), { quote }],
  ]) {
    const { model, api } = await setup(); const pending = deferred(); api.overrides.set(`${method} ${path}`, () => pending.promise);
    const promise = start(model); model.setPhone('+16135551234'); pending.resolve(response); await promise;
    assert.equal(model.state.operator, null); assert.deepEqual(model.state.products, []); assert.equal(model.state.quote, null);
  }
});
test('logout reset ignores late catalog and receipt responses', async () => {
  const { model, api } = await setup(); const pending = deferred();
  api.overrides.set(`GET /mobile-topups/transactions/${transaction.id}`, () => pending.promise);
  const promise = model.refreshTransaction(transaction.id); model.reset(); pending.resolve({ transaction }); await promise;
  assert.equal(model.state.transaction, null); assert.deepEqual(model.state.history, []);
});
test('a previous session confirmation cannot unlock a new session confirmation', async () => {
  const { model, api } = await setup(); await reviewed(model);
  const oldResponse = deferred(); const newResponse = deferred();
  api.overrides.set('POST /mobile-topups/transactions', () => oldResponse.promise);
  const oldConfirmation = model.confirm(); await Promise.resolve();
  model.reset(); await model.start(); await model.selectCountry('JM');
  model.setPhone(quote.recipientPhone); await model.selectOperator(77); model.selectProduct(products[0].id);
  await reviewed(model);
  api.overrides.set('POST /mobile-topups/transactions', () => newResponse.promise);
  const newConfirmation = model.confirm(); await Promise.resolve();
  oldResponse.resolve({ transaction }); await oldConfirmation;
  assert.equal(model.state.submitting, true); assert.equal(model.state.transaction, null);
  newResponse.resolve({ transaction }); await newConfirmation;
  assert.equal(model.state.submitting, false); assert.equal(model.state.transaction.id, transaction.id);
});
test('rejects country/operator/product/quote mismatch', async () => {
  const { model, api } = await setup();
  api.overrides.set('GET /mobile-topups/operators/detect', () => ({ operator: { ...operator, countryCode: 'CA' } }));
  await model.detect(); assert.equal(model.state.operator, null);
  api.overrides.set('GET /mobile-topups/operators/77/products', () => ({ operator, products: [{ ...products[0], operatorId: 88 }] }));
  await model.selectOperator(77); assert.deepEqual(model.state.products, []);
  api.overrides.delete('GET /mobile-topups/operators/77/products'); await model.selectOperator(77); model.selectProduct(products[0].id);
  api.overrides.set('POST /mobile-topups/quotes', () => ({ quote: { ...quote, recipientPhone: '+16135551234' } }));
  await model.getQuote(); assert.equal(model.state.quote, null);
});
test('backend unavailable and empty catalogs remain controlled states', async () => {
  const api = fixtureApi(); api.overrides.set('GET /mobile-topups/countries', () => { throw new ApiError('RELOADLY_UNAVAILABLE', 'Unavailable', 502); });
  const model = new Recharge(api); await model.start(); assert.equal(model.state.ready, false); assert.equal(model.state.error, 'Unavailable');
  api.overrides.set('GET /mobile-topups/countries', () => ({ countries: [] })); await model.start(); assert.equal(model.state.ready, true); assert.deepEqual(model.state.countries, []);
});
test('fails closed on all live/unknown safety flags, including immediately before purchase', async () => {
  for (const unsafe of [{ environment: 'PRODUCTION' }, { paymentMode: 'LIVE' }, { testMode: false }, { liveRechargeEnabled: true }, { productionEnabled: true }, { approvedForLiveUse: true }]) assert.throws(() => assertTestService({ ...status, ...unsafe }));
  assert.throws(() => assertTestService({})); assert.throws(() => assertTestService({ ...status, enabled: false }));
  const { model, api } = await setup(); await reviewed(model);
  api.overrides.set('GET /mobile-topups/status', () => ({ ...status, productionEnabled: true })); await model.confirm();
  assert.equal(api.calls.filter((c) => c.path === '/mobile-topups/transactions' && c.method === 'POST').length, 0);
});
test('UUID fallback uses secure randomness and fails closed without crypto', () => {
  assert.match(secureId({ getRandomValues: (bytes) => globalThis.crypto.getRandomValues(bytes) }), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.throws(() => secureId({}));
});

test('country calling-code search, prefills and switches preserve ISO identity', async () => {
  const { model } = await setup();
  for (const term of ['509', '+509', 'HT', 'Haiti']) assert.deepEqual(searchCountries(countries, term), [countries[2]]);
  assert.deepEqual(searchCountries(countries, '+1'), countries.slice(0, 2));
  await model.selectCountry('HT'); assert.equal(model.state.phone, '+509');
  model.setPhone('+50937050210'); assert.equal(model.normalizedPhone(), '+50937050210');
  await model.selectCountry('FR'); assert.equal(model.state.phone, '+33'); assert.equal(model.state.operator, null);
  model.setPhone('+33612345678'); assert.equal(model.normalizedPhone(), '+33612345678');
  for (const phone of ['+50937050210', '+33+33612345678', '+33']) { model.setPhone(phone); assert.throws(() => model.normalizedPhone()); }
});

test('detection and quote receive exactly one prefix; malformed prefixes never reach backend', async () => {
  const { model, api } = await setup();
  model.setPhone('+1+18765551234'); await model.detect();
  assert.equal(api.calls.filter((c) => c.path.startsWith('/mobile-topups/operators/detect')).length, 0);
  model.setPhone('00 1 (876) 555-1234'); await model.detect();
  const detection = api.calls.find((c) => c.path.startsWith('/mobile-topups/operators/detect'));
  assert.equal(new URL(detection.path, 'https://test.invalid').searchParams.get('phone'), '+18765551234');
  model.selectProduct(products[0].id); await model.getQuote();
  assert.equal(api.calls.find((c) => c.path === '/mobile-topups/quotes').body.phone, '+18765551234');
});
