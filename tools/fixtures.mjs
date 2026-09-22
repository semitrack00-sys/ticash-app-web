// Deterministic test fixtures only; never imported by browser application code.
import assert from 'node:assert/strict';
import { ApiError } from '../js/api-client.js';

export const status = { enabled: true, environment: 'SANDBOX', billingCurrency: 'USD', provider: 'RELOADLY', paymentMode: 'MOCK', testMode: true, productionEnabled: false, approvedForLiveUse: false, liveRechargeEnabled: false };
export const countries = [{ code: 'JM', name: 'Jamaica' }, { code: 'CA', name: 'Canada' }];
export const operator = { id: 77, name: 'Test catalog operator', countryCode: 'JM', status: true, denominationType: 'FIXED', senderCurrencyCode: 'USD', destinationCurrencyCode: 'JMD' };
export const products = [
  { id: 'reloadly:JM:77:airtime:7.50', countryCode: 'JM', operatorId: 77, kind: 'AIRTIME', name: 'Test airtime', price: 7.5, priceCurrency: 'USD', deliveredValue: 1170, deliveredCurrency: 'JMD', amountType: 'FIXED' },
  { id: 'reloadly:JM:77:airtime:range', countryCode: 'JM', operatorId: 77, kind: 'AIRTIME', name: 'Test flexible amount', price: 5, priceCurrency: 'USD', deliveredCurrency: 'JMD', amountType: 'RANGE', minimumAmount: 5, maximumAmount: 20 },
];
export const quote = { id: '11111111-1111-4111-8111-111111111111', countryCode: 'JM', recipientPhone: '+18765551234', operatorId: 77, operatorName: operator.name, productId: products[0].id, productName: products[0].name, kind: 'AIRTIME', providerAmount: 7.5, providerCurrency: 'USD', deliveredValue: 1170, deliveredCurrency: 'JMD', feeUsd: 0.5, totalChargeUsd: 8, expiresAt: '2099-01-01T00:00:00.000Z' };
export const transaction = { ...quote, id: '22222222-2222-4222-8222-222222222222', quoteId: quote.id, status: 'PROCESSING', paymentStatus: 'AUTHORIZED', testMode: true, createdAt: '2026-09-22T12:00:00.000Z', updatedAt: '2026-09-22T12:00:00.000Z' };

export function fixtureApi() {
  const calls = [];
  let transactions = [];
  const api = {
    calls, overrides: new Map(),
    login: async () => ({ id: 'test-user' }), logout: async () => {}, clear: () => {},
    async request(path, options = {}) {
      calls.push({ path, ...options });
      const url = new URL(path, 'http://fixture.invalid');
      const route = url.pathname; const method = options.method || 'GET';
      const override = api.overrides.get(`${method} ${route}`);
      if (override) return override(path, options);
      if (route === '/mobile-topups/status' && method === 'GET') return structuredClone(status);
      if (route === '/mobile-topups/countries' && method === 'GET') return { countries: structuredClone(countries) };
      if (route === '/mobile-topups/operators' && method === 'GET') {
        assert.deepEqual([...url.searchParams.keys()], ['country']);
        return { operators: url.searchParams.get('country') === 'JM' ? [structuredClone(operator)] : [] };
      }
      if (route === '/mobile-topups/operators/detect' && method === 'GET') {
        assert.equal(url.searchParams.get('country'), 'JM'); assert.equal(url.searchParams.get('phone'), quote.recipientPhone);
        return { operator: structuredClone(operator) };
      }
      if (route === '/mobile-topups/operators/77/products' && method === 'GET') {
        assert.equal(url.searchParams.get('country'), 'JM');
        return { operator: structuredClone(operator), products: structuredClone(products) };
      }
      if (route === '/mobile-topups/quotes' && method === 'POST') {
        assert.deepEqual(Object.keys(options.body).sort(), (options.body.amount === undefined ? ['countryCode', 'phone', 'operatorId', 'productId'] : ['countryCode', 'phone', 'operatorId', 'productId', 'amount']).sort());
        return { quote: { ...quote, productId: options.body.productId } };
      }
      if (route === '/mobile-topups/transactions' && method === 'POST') {
        assert.deepEqual(options.body, { quoteId: quote.id });
        assert.match(options.headers['Idempotency-Key'], /^[0-9a-f-]{36}$/i);
        transactions = [structuredClone(transaction)]; return { transaction: transactions[0] };
      }
      if (route === '/mobile-topups/transactions' && method === 'GET') return { transactions: structuredClone(transactions) };
      if (route === `/mobile-topups/transactions/${transaction.id}` && method === 'GET') {
        assert.equal(url.searchParams.get('refresh'), 'true'); return { transaction: { ...transaction, status: 'DELIVERED' } };
      }
      if (route === `/mobile-topups/transactions/${transaction.id}/repeat` && method === 'POST') {
        assert.equal(options.body, undefined); return { quote: { ...quote, totalChargeUsd: 8.75 } };
      }
      if (route === '/mobile-topups/recipients' && method === 'GET') return { recipients: [{ id: 'saved', nickname: 'Test recipient', phone: quote.recipientPhone, countryCode: 'JM', operatorId: 77 }] };
      throw new ApiError('UNEXPECTED_TEST_REQUEST', `Unexpected test route: ${method} ${route}`, 404);
    },
  };
  return api;
}
