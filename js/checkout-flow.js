import { ApiError } from './api-client.js';

export const checkoutMode = 'STRIPE_SANDBOX';
export const isUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const checkoutUrlPattern = /^https:\/\/checkout\.stripe\.com\/[\S]+$/i;
const checkoutSessionIdPattern = /^cs_test_[A-Za-z0-9_]+$/;
const sensitiveFields = value => record(value) && Object.entries(value).some(([key, item]) =>
  /^(?:client_?secret|secret_?key|webhook_?secret|access_?token|refresh_?token|checkoutResumeToken)$/i.test(key) || sensitiveFields(item));
function safeCheckoutUrl(value) {
  if (typeof value !== 'string' || !checkoutUrlPattern.test(value)) return false;
  try {
    const url = new URL(value);
    return url.origin === 'https://checkout.stripe.com' && !url.username && !url.password &&
      ![...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()]
        .some(key => /token|secret|transaction|order/i.test(key));
  } catch { return false; }
}

export function validateCheckoutSession(data) {
  const checkoutSession = record(data) ? data.checkoutSession : null;
  if (!record(data) || sensitiveFields(data) || data.provider !== 'STRIPE' || data.environment !== 'SANDBOX' || data.testMode !== true ||
      !isUuid(data.transactionId) || !record(checkoutSession) ||
      typeof checkoutSession.id !== 'string' || !checkoutSessionIdPattern.test(checkoutSession.id) ||
      !safeCheckoutUrl(checkoutSession.url) ||
      !Number.isSafeInteger(data.amountMinor) || data.amountMinor <= 0 || data.currency !== 'USD' ||
      !['SESSION_CREATED', 'AWAITING_PAYMENT'].includes(data.paymentStatus)) {
    throw new ApiError('INVALID_CHECKOUT_SESSION', 'Unable to verify the Stripe sandbox checkout session. Keep this page open and refresh transaction status.');
  }
  return data;
}

export function loadCheckoutFactory() {
  return Promise.resolve(null);
}

export async function mountCheckoutFlow({ session, container, factory, active, onPaymentCompleted }) {
  validateCheckoutSession(session);
  const redirectUrl = session.checkoutSession.url;
  if (container) {
    container.replaceChildren();
    const note = container.ownerDocument.createElement('p');
    note.className = 'small muted';
    note.textContent = 'Stripe Checkout will open in a secure hosted page. Keep this tab open so the result screen can refresh automatically when you return.';
    container.append(note);
  }

  let confirmationInProgress = null;

  const confirm = async ({ returnUrl, onError } = {}) => {
    if (confirmationInProgress) return confirmationInProgress;

    confirmationInProgress = (async () => {
      try {
        if (!active()) {
          throw new ApiError('INVALID_CHECKOUT_SESSION', 'The Stripe sandbox checkout session is no longer active. Refresh transaction status before retrying.');
        }

        if (typeof returnUrl === 'string') {
          if (!/^\//.test(returnUrl)) {
            throw new ApiError('INVALID_CHECKOUT_SESSION', 'The Stripe sandbox checkout return URL is invalid.');
          }
          const target = new URL(returnUrl, globalThis.location?.origin || 'https://example.invalid');
          if (target.origin !== (globalThis.location?.origin || target.origin)) {
            throw new ApiError('INVALID_CHECKOUT_SESSION', 'The Stripe sandbox checkout return URL is invalid.');
          }
          target.search = '';
          target.hash = '';
        }

        return { redirectUrl, transactionId: session.transactionId };
      } catch (error) {
        if (typeof onError === 'function') onError(error);
        throw error;
      } finally {
        confirmationInProgress = null;
      }
    })();

    return confirmationInProgress;
  };

  return {
    confirm,
    unmount() {
      if (container) container.replaceChildren();
    },
  };
}
