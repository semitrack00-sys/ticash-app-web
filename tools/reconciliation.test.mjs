import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Recharge } from '../js/recharge.js';
import { mountRecharge } from '../js/recharge-page.js';
import { mountCheckoutResume } from '../js/checkout-resume.js';
import { transactionStatus, transactionFullySettled, canCancelTransaction, canHideTransaction } from '../js/transaction-state.js';
import { setLanguage, t } from '../js/i18n.js';
import { billingFixture, billingQuote } from './billing-fixture.mjs';
import { fixtureApi, products, operator, quote, transaction } from './fixtures.mjs';

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const live = extra => ({ ...transaction, testMode: false, ...extra });
async function page(fn) {
  const dom = new JSDOM('<main data-recharge-root data-login-brand="flupflap"></main>', { url: 'https://www.flupflap.com/' });
  globalThis.document = dom.window.document; setLanguage('en');
  const api = billingFixture(), root = document.querySelector('main');
  const app = mountRecharge(root, { mobileRechargeLive: true }, { api });
  try { await fn({ api, app, dom, root, q: selector => root.querySelector(selector) }); }
  finally { app.dispose(); dom.window.close(); delete globalThis.document; setLanguage('en'); }
}

test('selecting the current mobile navigation destination closes the menu', async () => page(async ({ q, dom }) => {
  q('#recharge-menu-toggle').click();
  assert.equal(q('#recharge-navigation').hidden, false);
  q('#recharge-navigation [data-journey-nav="number"]').click();
  assert.equal(q('#recharge-navigation').hidden, true);
  assert.equal(q('#recharge-menu-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(dom.window.document.activeElement, q('#recharge-menu-toggle'));
}));

for (const [pending, final] of [['REFUND_PENDING', 'REFUNDED'], ['VOID_PENDING', 'VOIDED']]) {
  test(`${pending} polls read-only status; confirmed ${final} stops polling`, async context => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    await page(async ({ app, api }) => {
      await app.model.start(); api.calls.length = 0;
      api.overrides.set('GET /mobile-topups/transactions/' + transaction.id, () => ({ transaction: live({ status:'FAILED', paymentStatus:final }) }));
      app.model.state.transaction = live({ status:'FAILED', paymentStatus:pending }); app.model.emit();
      context.mock.timers.tick(4999); await flush(); assert.equal(api.calls.length, 0);
      context.mock.timers.tick(1); await flush();
      assert.equal(app.model.state.transaction.paymentStatus, final);
      assert.equal(api.calls.length, 1); assert.equal(api.calls[0].method, undefined);
      assert.match(api.calls[0].path, /\?refresh=true$/);
      context.mock.timers.tick(60000); await flush(); assert.equal(api.calls.length, 1);
    });
  });
}

test('provider RANGE minimum, maximum, increment and precision are preserved without calculating fees', async () => {
  const api = fixtureApi(); api.identityDomain = 'FLUPFLAP';
  const product = { ...products[1], price:1, minimumAmount:1, maximumAmount:9, amountIncrement:0.5, amountPrecision:1 };
  api.overrides.set('GET /mobile-topups/operators/77/products', () => ({ operator, products:[product] }));
  const model = new Recharge(api); await model.start(); await model.selectCountry('JM'); model.setPhone(quote.recipientPhone); await model.selectOperator(77); model.selectProduct(product.id);
  assert.deepEqual(model.state.product, product);
  for (const amount of ['1', '1.5', '9']) { model.setAmount(amount); assert.equal(model.quoteBody().amount, Number(amount)); assert.equal(model.quoteBody().fee, undefined); }
  for (const amount of ['0.99', '9.5', '1.1', '1.55', '1.501']) { model.setAmount(amount); assert.throws(() => model.quoteBody(), /within the displayed range/); }
});

for (const [status, paymentStatus, expected, settled] of [
  ['FAILED', 'FAILED', 'FAILED', true], ['FAILED', 'REFUND_PENDING', 'REFUND_PENDING', false],
  ['FAILED', 'REFUNDED', 'REFUNDED', true], ['FAILED', 'VOID_PENDING', 'VOID_PENDING', false],
  ['FAILED', 'VOIDED', 'VOIDED', true], ['PROCESSING', 'CAPTURED', 'PROCESSING', false],
  ['PENDING', 'AUTHORIZED', 'PENDING', false], ['DELIVERED', 'CAPTURED', 'DELIVERED', true],
  ['FAILED', 'CAPTURED', 'FAILED', false], ['FAILED', 'AUTHORIZED', 'FAILED', false],
]) test(`server ${status}/${paymentStatus}: visible ${expected}, settled ${settled}`, async () => page(async ({ app, q }) => {
  const value = live({ status, paymentStatus });
  assert.equal(transactionStatus(value), expected); assert.equal(transactionFullySettled(value), settled);
  app.model.state.transaction = value; app.model.state.history = [value]; app.model.emit();
  assert.equal(q('#receipt .status-pill').dataset.status, expected);
  assert.equal(q('#history-list .status-pill').dataset.status, expected);
  assert.equal(q('#receipt .status-pill').textContent, t('rechargeStatus' + expected));
  assert.equal(q('#history-list .status-pill').textContent, t('rechargeStatus' + expected));
}));

test('declined or insufficient-funds payment is failed, with no browser fulfillment', async () => page(async ({ app, api, q }) => {
  for (const failureCode of ['PAYMENT_DECLINED', 'INSUFFICIENT_FUNDS']) {
    app.model.state.transaction = live({ status: 'FAILED', paymentStatus: 'FAILED', failureCode }); app.model.emit();
    assert.match(q('#receipt h2').textContent, /failed/i);
    assert.equal(q('#receipt .status-pill').dataset.status, 'FAILED');
  }
  assert.equal(api.calls.length, 0);
}));

test('history hide requires confirmation; rejected confirmation never sends DELETE', async () => page(async ({ app, api, dom, q }) => {
  const cancelled = live({ status: 'FAILED', paymentStatus: 'FAILED', failureCode: 'CANCELLED_BY_CUSTOMER' });
  app.model.state.history = [cancelled]; app.model.emit();
  dom.window.confirm = () => false; q('.history-delete').click(); await flush();
  assert.equal(api.calls.length, 0); assert.equal(app.model.state.history.length, 1);
  api.overrides.set('DELETE /mobile-topups/transactions/' + cancelled.id, () => ({}));
  dom.window.confirm = message => { assert.match(message, /financial record/); return true; };
  q('.history-delete').click(); q('.history-delete').click(); await flush();
  assert.equal(api.calls.filter(c => c.method === 'DELETE').length, 1); assert.equal(app.model.state.history.length, 0);
}));

test('cancel and hide match server restrictions, including payment/provider bindings', () => {
  const pending = live({ status: 'PENDING', paymentStatus: 'SESSION_CREATED' });
  const cancelled = live({ status: 'FAILED', paymentStatus: 'FAILED', failureCode: 'CANCELLED_BY_CUSTOMER' });
  assert.equal(canCancelTransaction(pending), true); assert.equal(canHideTransaction(cancelled), true);
  for (const field of ['providerTransactionId', 'paymentAuthorizationId', 'paymentProviderTransactionId']) {
    assert.equal(canCancelTransaction({ ...pending, [field]: 'bound' }), false);
    assert.equal(canHideTransaction({ ...cancelled, [field]: 'bound' }), false);
  }
  assert.equal(canCancelTransaction({ ...pending, fulfillmentStartedAt: 'now' }), false);
});

test('cancellation is single-flight, then refreshes status and history', async () => {
  const api = billingFixture(), model = new Recharge(api);
  const pending = live({ status: 'PENDING', paymentStatus: 'SESSION_CREATED' });
  const cancelled = { ...pending, status: 'FAILED', paymentStatus: 'FAILED', failureCode: 'CANCELLED_BY_CUSTOMER' };
  model.state.history = [pending]; let release;
  api.overrides.set('POST /mobile-topups/transactions/' + pending.id + '/cancel', () => new Promise(resolve => { release = () => resolve({ transaction: cancelled }); }));
  api.overrides.set('GET /mobile-topups/transactions/' + pending.id, () => ({ transaction: cancelled }));
  api.overrides.set('GET /mobile-topups/transactions', () => ({ transactions: [cancelled] }));
  const first = model.cancelTransaction(pending.id); await model.cancelTransaction(pending.id); release(); await first;
  assert.equal(api.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(model.state.history[0].failureCode, 'CANCELLED_BY_CUSTOMER');
  assert.ok(api.calls.some(c => c.path.endsWith('?refresh=true')));
});

test('provider choice uses advertised API providers only; AUTO omits filter; changes clear quotes', async () => {
  const api = fixtureApi(); api.identityDomain = 'FLUPFLAP';
  api.overrides.set('GET /mobile-topups/status', () => ({ enabled:true, environment:'SANDBOX', paymentMode:'MOCK', testMode:true, productionEnabled:false, approvedForLiveUse:false, liveRechargeEnabled:false, providers:['DTONE','RELOADLY','not-configured'] }));
  api.overrides.set('GET /mobile-topups/operators', path => ({ operators:[{ ...operator, provider:new URL(path,'https://test.invalid').searchParams.get('provider') || 'DTONE' }] }));
  api.overrides.set('GET /mobile-topups/operators/detect', () => ({ operator: { ...operator, provider:'RELOADLY' } }));
  const model = new Recharge(api); await model.start(); await model.selectCountry('JM');
  assert.deepEqual(model.state.providers, ['DTONE','RELOADLY']); assert.equal(model.state.provider, 'AUTO');
  assert.ok(api.calls.some(c => c.path === '/mobile-topups/operators?country=JM'));
  model.state.quote = quote; await model.selectProvider('RELOADLY'); assert.equal(model.state.quote, null);
  model.setPhone(quote.recipientPhone); await model.detect();
  assert.equal(model.state.operator.provider, 'RELOADLY');
  assert.ok(api.calls.some(c => c.path.includes('/detect?') && c.path.includes('provider=RELOADLY')));
  await model.selectProvider('unadvertised'); assert.equal(model.state.provider, 'RELOADLY');
});

for (const [domain, kind, price, allowed] of [['FLUPFLAP','AIRTIME',1,true], ['TICASH','AIRTIME',1,false], ['FLUPFLAP','DATA',1,false], ['FLUPFLAP','BUNDLE',12,true]]) {
  test(`${domain} ${kind} provider price ${price}: accepted ${allowed}, no browser fee`, async () => {
    const api = fixtureApi(); api.identityDomain = domain;
    api.overrides.set('GET /mobile-topups/operators/77/products', () => ({ operator, products:[{ ...products[0], kind, classification:kind, price }] }));
    const model = new Recharge(api); await model.start(); await model.selectCountry('JM'); model.setPhone(quote.recipientPhone); await model.selectOperator(77);
    assert.equal(model.state.products.length, allowed ? 1 : 0);
    if (allowed) { model.selectProduct(products[0].id); assert.deepEqual(Object.keys(model.quoteBody()).sort(), ['countryCode','operatorId','phone','productId']); }
  });
}

test('current backend resume DTO is accepted, receiver values displayed, internal fields still rejected', async () => {
  const dto = { status:'DELIVERED', testMode:false, countryCode:'JM', receiverQuote:{ amount:1170,currency:'JMD',senderAmount:7.5,senderCurrency:'USD',source:'PROVIDER_PRODUCT',quotedAt:'2026-10-01T00:00:00Z' }, deliveredValue:1170,deliveredCurrency:'JMD',receiverDiscrepancy:false,recipientPhone:quote.recipientPhone,operatorName:operator.name,productName:quote.productName,providerAmount:7.5,providerCurrency:'USD',feeUsd:quote.feeUsd,totalChargeUsd:quote.totalChargeUsd };
  for (const extra of [{}, { id:'internal-id' }, { checkoutResumeTokenHash:'secret' }, { paymentProviderTransactionId:'pi_private' }]) {
    const dom = new JSDOM('<main></main>', { url:'https://www.flupflap.com/' }); const root = dom.window.document.querySelector('main'); let reads=0;
    const app = mountCheckoutResume(root, {}, 'R'.repeat(43), { api:{ resumeCheckout:async () => { reads++; return { transaction:{ ...dto,...extra } }; } } });
    await flush(); assert.equal(reads, 1);
    if (!Object.keys(extra).length) { assert.match(root.textContent,/Delivered to receiver/); assert.match(root.textContent,/1,170/); }
    else assert.doesNotMatch(root.textContent,/1,170|internal-id|secret|pi_private/);
    app.dispose(); dom.window.close();
  }
});


test('failed authenticated A is cleared when authoritative Stripe return B mounts', async () => page(async ({ app, api, dom, root }) => {
  await app.model.start();
  const a = live({ status: 'FAILED', paymentStatus: 'FAILED', failureCode: 'INSUFFICIENT_FUNDS', operatorName: 'Attempt A' });
  app.model.state.transaction = a;
  app.model.state.checkoutSession = { transactionId: a.id };
  app.model.state.attempt = { mode: 'STRIPE_LIVE', transactionId: a.id, body: { quoteId: a.quoteId }, key: 'old-A-key' };
  app.model.emit();
  const token = 'B'.repeat(43); let reads = 0;
  dom.window.history.replaceState(null, '', '/?checkoutResumeToken=' + token);
  const b = mountRecharge(root, {}, { api: { async resumeCheckout(value) {
    assert.equal(value, token); reads++;
    return { transaction: { status: 'DELIVERED', paymentStatus: 'CAPTURED', failureReason: null, testMode: false,
      recipientPhone: '+15555550102', operatorName: 'Attempt B', productName: 'B product',
      providerAmount: 10, providerCurrency: 'USD', feeUsd: 1.64, totalChargeUsd: 11.64 } };
  } } });
  try { await flush(); assert.equal(reads, 1); assert.equal(b.model, undefined);
    assert.equal(app.model.state.transaction, null); assert.equal(app.model.state.attempt, null); assert.equal(app.model.state.checkoutSession, null);
    assert.match(root.textContent, /Attempt B/); assert.doesNotMatch(root.textContent, /Attempt A/);
    assert.equal(root.querySelector('.status-pill').dataset.status, 'DELIVERED');
  } finally { b.dispose(); }
}));

test('terminal failed A starts a fresh selection while pending and recovery-pending payments cannot restart', async () => page(async ({ app, q, api }) => {
  await app.model.start();
  const a = live({ status: 'FAILED', paymentStatus: 'FAILED', failureCode: 'INSUFFICIENT_FUNDS', deliveredValue: null, deliveredCurrency: null, receiverQuote: { amount: 987, currency: 'HTG' } });
  app.model.state.history = [a]; app.model.state.transaction = a; app.model.emit();
  assert.doesNotMatch(q('#receipt').textContent, /Receiver gets|Delivered to receiver/);
  assert.match(q('#receipt .journey-full-receipt').textContent, /Quoted receiver value \(not delivered\)/);
  assert.match(q('#receipt .journey-full-receipt').textContent, /987/);
  assert.match(q('#receipt').textContent, /Stripe reported insufficient funds/);
  assert.equal(q('#recharge-again').hidden, false); q('#recharge-again').click(); await flush();
  assert.equal(app.model.state.transaction, null); assert.equal(app.model.state.quote, null); assert.equal(app.model.state.checkoutSession, null);
  assert.deepEqual(app.model.state.history, [a]);
  assert.equal(api.calls.some(c => c.method === 'POST'), false);
  for (const value of [live({ status: 'PENDING', paymentStatus: 'SESSION_CREATED' }), live({ status: 'FAILED', paymentStatus: 'REFUND_PENDING' })]) {
    app.model.state.transaction = value; app.model.emit();
    assert.equal(q('#recharge-again').hidden, true); assert.throws(() => app.model.startNewRecharge(), /Resolve/);
    assert.throws(() => app.model.setAmount('10'), /Resolve/);
  }
}));

test('late status read for A cannot replace newly active transaction B', async () => {
  const api = fixtureApi(); const model = new Recharge(api); await model.start();
  const a = { ...transaction, status: 'PROCESSING' };
  const b = { ...transaction, id: '33333333-3333-4333-8333-333333333333', status: 'DELIVERED', operatorName: 'Attempt B' };
  let finish; api.overrides.set('GET /mobile-topups/transactions/' + a.id, () => new Promise(resolve => { finish = resolve; }));
  model.state.transaction = a; const pending = model.refreshTransaction(a.id);
  model.state.transaction = b; finish({ transaction: { ...a, status: 'FAILED' } }); await pending;
  assert.equal(model.state.transaction, b);
});


test('failed checkout A retries with a new quote, idempotency key and session for B without changing A', async () => {
  const api = billingFixture(), model = new Recharge(api);
  model.setAccount({ id: 'guest-user' }, true); await model.start();
  let count = 0;
  const ids = ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
  api.overrides.set('POST /mobile-topups/quotes', () => ({ quote: { ...billingQuote, id: ids[count] } }));
  api.overrides.set('POST /mobile-topups/payment-sessions', () => {
    const id = ids[count++];
    return { provider: 'STRIPE', environment: 'PRODUCTION', testMode: false, transactionId: id,
      checkoutSession: { id: 'cs_live_' + count, url: 'https://checkout.stripe.com/c/pay/cs_live_' + count },
      amountMinor: 5449, currency: 'USD', paymentStatus: 'SESSION_CREATED' };
  });
  const checkout = async () => {
    await model.selectCountry('HT'); model.setPhone(billingQuote.recipientPhone); await model.selectOperator(77);
    model.selectProduct(billingQuote.productId); await model.getQuote();
    model.state.billingCountry = 'US'; model.state.reviewed = true; await model.confirm();
  };
  await checkout();
  const a = Object.freeze({ ...billingQuote, id: ids[0], quoteId: ids[0], testMode: false, status: 'FAILED', paymentStatus: 'FAILED', failureCode: 'INSUFFICIENT_FUNDS' });
  assert.equal(model.reconcileCheckout(a), true); model.state.history = [a];
  model.startNewRecharge(); await checkout();
  assert.equal(model.state.transaction, null); assert.equal(model.state.attempt.transactionId, ids[1]);
  assert.equal(model.state.checkoutSession.checkoutSession.id, 'cs_live_2');
  assert.deepEqual(model.state.history, [a]); assert.equal(a.status, 'FAILED');
  const requests = api.calls.filter(c => c.path === '/mobile-topups/payment-sessions');
  assert.equal(requests.length, 2); assert.notEqual(requests[0].body.quoteId, requests[1].body.quoteId);
  assert.notEqual(requests[0].headers['Idempotency-Key'], requests[1].headers['Idempotency-Key']);
  assert.equal(api.calls.some(c => c.method === 'POST' && c.path === '/mobile-topups/transactions'), false);
});
