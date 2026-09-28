// Isolated UI/browser test data only. No production module imports this file.
import { fixtureApi, status, operator, products, quote } from './fixtures.mjs';
export const billingQuote = { ...quote, countryCode: 'HT', recipientPhone: '+50937050210',
  productId: 'fixture-ht-product', providerAmount: 50, feeUsd: 4.49, totalChargeUsd: 54.49 };
export function billingFixture() {
  const api = fixtureApi();
  api.identityDomain = 'FLUPFLAP';
  const carrier = { ...operator, countryCode: 'HT', logoUrl: undefined };
  const product = { ...products[0], id: billingQuote.productId, countryCode: 'HT', price: 50 };
  api.overrides.set('GET /mobile-topups/status', () => ({ ...status, paymentMode: 'STRIPE_SANDBOX' }));
  api.overrides.set('GET /mobile-topups/countries', () => ({ countries: [{ code: 'HT', name: 'Haiti', callingCode: '+509' }] }));
  api.overrides.set('GET /mobile-topups/operators', () => ({ operators: [carrier] }));
  api.overrides.set('GET /mobile-topups/operators/detect', () => ({ operator: carrier }));
  api.overrides.set('GET /mobile-topups/operators/77/products', () => ({ operator: carrier, products: [product] }));
  api.overrides.set('GET /mobile-topups/payment-methods', () => ({ methods: [{ type: 'CARD', provider: 'STRIPE', testMode: true, enabled: true }] }));
  api.overrides.set('GET /users/me', () => ({ user: { id: 'test-user', countryCode: 'CA' } }));
  api.overrides.set('POST /mobile-topups/quotes', () => ({ quote: { ...billingQuote } }));
  api.overrides.set('POST /mobile-topups/payment-sessions', () => ({ provider: 'STRIPE', environment: 'SANDBOX', testMode: true,
    transactionId: '22222222-2222-4222-8222-222222222222', paymentSession: { id: 'pi_fixture', client_secret: 'pi_fixture_secret_fixture' },
    publicKey: 'pk_test_fixture', amountMinor: 5449, currency: 'USD', paymentStatus: 'SESSION_CREATED' }));
  return api;
}
