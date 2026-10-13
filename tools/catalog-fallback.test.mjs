import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountRecharge } from '../js/recharge-page.js';
import { fixtureApi, operator, quote } from './fixtures.mjs';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('empty operator products explain the blocked step and recover after a catalog retry', async () => {
  const api = fixtureApi();
  api.overrides.set('GET /mobile-topups/operators/77/products', () => ({ operator: structuredClone(operator), products: [] }));
  const dom = new JSDOM('<header></header><main id="root"></main>', { url: 'https://website.example/recharge' });
  const previousDocument = globalThis.document;
  globalThis.document = dom.window.document;
  const root = document.getElementById('root');
  const app = mountRecharge(root, { mobileRechargeLive: true }, { api });
  try {
    document.querySelector('#continue-guest').click();
    for (let i = 0; i < 5; i++) await tick();
    assert.equal(document.querySelector('#checkout').hidden, false);
    await app.model.selectCountry('JM');
    app.model.setPhone(quote.recipientPhone);
    await app.model.selectOperator(77);
    document.querySelector('#continue-number').click(); await tick();
    const note = document.querySelector('#journey-catalog-status');
    assert.equal(note.hidden, false);
    assert.equal(note.parentElement.hidden, false);
    assert.match(note.textContent, /No products loaded/);
    assert.equal(document.querySelector('#journey-amount').hidden, true);
    api.overrides.delete('GET /mobile-topups/operators/77/products');
    await app.model.selectOperator(77);
    document.querySelector('#continue-number').click(); await tick();
    assert.equal(note.hidden, true);
    assert.equal(document.querySelector('#journey-amount').hidden, false);
    assert.equal(api.calls.some(call => call.path === '/mobile-topups/transactions' && call.method === 'POST'), false);
  } finally { app.dispose(); dom.window.close(); if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; }
});
