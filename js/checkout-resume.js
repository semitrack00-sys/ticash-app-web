import { transactionFullySettled, transactionStatus, paymentFailureMessage } from './transaction-state.js';
import { rechargePath } from './recharge-routes.js';
import { apiBaseUrl, createApiClient, isCheckoutResumeToken } from './api-client.js';
import { t, languageLocale, onLanguageChange } from './i18n.js';
import { mountLanguageHeader } from './language-page.js';

const terminal = new Set(['DELIVERED', 'FAILED', 'REFUNDED']);
const statuses = new Set(['PENDING', 'PROCESSING', ...terminal]);
const publicFields = ['status', 'testMode', 'recipientPhone', 'operatorName', 'productName', 'providerAmount', 'providerCurrency', 'feeUsd', 'totalChargeUsd'];
const recoveryFields = ['paymentStatus', 'failureReason'];
const paymentStates = new Set(['PENDING', 'SESSION_CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'VOID_PENDING', 'VOIDED', 'REFUND_PENDING', 'REFUNDED']);
const failures = new Set(['INSUFFICIENT_FUNDS', 'PAYMENT_DECLINED', 'PAYMENT_CANCELLED', 'PAYMENT_EXPIRED', 'RECHARGE_PROVIDER_FAILED']);
const receiverFields = ['countryCode', 'receiverQuote', 'deliveredValue', 'deliveredCurrency', 'receiverDiscrepancy'];
function receiverDetails(value) {
  if (!receiverFields.some(key => Object.hasOwn(value, key))) return {}; // Original public DTO compatibility.
  if (!receiverFields.every(key => Object.hasOwn(value, key)) || !/^[A-Z]{2}$/.test(value.countryCode) ||
      typeof value.receiverDiscrepancy !== 'boolean') throw new Error('Invalid receiver details.');
  const amount = n => Number.isFinite(n) && n > 0 && n < 1e12;
  const currency = c => typeof c === 'string' && /^[A-Z]{3}$/.test(c);
  const q = value.receiverQuote;
  const keys = ['amount', 'currency', 'senderAmount', 'senderCurrency', 'source', 'quotedAt', 'preferredLanguage'];
  if (q !== null && (typeof q !== 'object' || Array.isArray(q) || Object.keys(q).some(key => !keys.includes(key)) ||
      !amount(q.amount) || !currency(q.currency) || q.senderAmount !== value.providerAmount || q.senderCurrency !== 'USD' ||
      !['PROVIDER_PRODUCT', 'RELOADLY_FX'].includes(q.source) || !Number.isFinite(Date.parse(q.quotedAt)) ||
      (q.preferredLanguage !== undefined && (typeof q.preferredLanguage !== 'string' || q.preferredLanguage.length > 35)))) throw new Error('Invalid receiver quote.');
  if ((value.deliveredValue !== null || value.deliveredCurrency !== null) &&
      (value.status !== 'DELIVERED' || !amount(value.deliveredValue) || !currency(value.deliveredCurrency))) throw new Error('Invalid delivery details.');
  // Keep only what the customer can see, never operational quote metadata.
  return { countryCode: value.countryCode, receiverQuote: q && { amount: q.amount, currency: q.currency },
    deliveredValue: value.deliveredValue, deliveredCurrency: value.deliveredCurrency, receiverDiscrepancy: value.receiverDiscrepancy };
}

// Read exactly one record. Never retain account IDs, provider identifiers, hashes or snapshots.
function displayTransaction(data) {
  const value = data?.transaction;
  if (!value || typeof value !== 'object' || !publicFields.every(key => Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => ![...publicFields, ...receiverFields, ...recoveryFields].includes(key)) || value.testMode !== false ||
      !statuses.has(value.status) || value.providerCurrency !== 'USD' ||
      ![value.providerAmount, value.feeUsd, value.totalChargeUsd].every(n => Number.isFinite(n) && n >= 0) ||
      !['recipientPhone', 'operatorName', 'productName'].every(key => typeof value[key] === 'string' && value[key].length <= 300)) {
    throw new Error('Invalid checkout status.');
  }
  const hasRecovery = recoveryFields.some(key => Object.hasOwn(value, key));
  if (hasRecovery && (!paymentStates.has(value.paymentStatus) || value.failureReason !== null && !failures.has(value.failureReason))) throw new Error('Invalid recovery status.');
  return Object.freeze({
    ...(hasRecovery ? { paymentStatus: value.paymentStatus, failureReason: value.failureReason } : {}),
    status: value.status, recipientPhone: value.recipientPhone,
    operatorName: value.operatorName, productName: value.productName,
    providerAmount: value.providerAmount, feeUsd: value.feeUsd, totalChargeUsd: value.totalChargeUsd,
    ...receiverDetails(value),
  });
}

// Called before the normal app, language controls, model or network requests are initialized.
export function consumeCheckoutReturn(pageWindow) {
  const url = new URL(pageWindow.location.href);
  const values = url.searchParams.getAll('checkoutResumeToken');
  const present = values.length > 0;
  const token = values.length === 1 ? values[0] : '';
  let changed = false;
  for (const key of ['checkoutResumeToken', 'transactionId', 'orderId', 'rechargeOrderId', 'session_id', 'checkout_session_id']) {
    if (url.searchParams.has(key)) { url.searchParams.delete(key); changed = true; }
  }
  if (changed) pageWindow.history.replaceState(null, '', url.pathname + url.search + url.hash);
  return { present, token };
}

export function mountCheckoutResume(root, config, resumeToken, dependencies = {}) {
  const doc = root.ownerDocument;
  const pageWindow = doc.defaultView;
  const clock = dependencies.resumeClock || {
    setTimeout: (fn, ms) => pageWindow.setTimeout(fn, ms),
    clearTimeout: id => pageWindow.clearTimeout(id),
  };
  let client, transaction, pollTimer, requestController, generation = 0, disposed = false;
  let polls = 0;
  let message = 'checkoutResumeLoading';
  const removeLanguageHeader = mountLanguageHeader(doc);
  const node = (tag, text, className) => {
    const element = doc.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const stop = () => {
    resumeToken = '';
    generation += 1;
    requestController?.abort(); requestController = undefined;
    clock.clearTimeout(pollTimer); pollTimer = undefined;
  };
  function render() {
    if (disposed) return;
    const panel = node('section', undefined, 'panel');
    panel.setAttribute('aria-live', 'polite');
    panel.dataset.checkoutResume = 'readonly';
    const status = transactionStatus(transaction);
    const settled = transaction && transactionFullySettled(transaction);
    const title = transaction ? status === 'DELIVERED' ? 'journeySuccess' :
      ['REFUNDED', 'VOIDED'].includes(status) ? 'rechargeStatus' + status : settled ? 'journeyFailed' : 'journeyPending' : 'checkoutResumeLoading';
    panel.append(node('h2', t(message || title)), node('p', t('checkoutResumeReadOnly'), 'muted'));
    if (transaction) {
      const badge = node('p', t('rechargeStatus' + status), 'status-pill');
      badge.dataset.status = status; panel.append(badge);
      const details = node('dl', undefined, 'details');
      const money = amount => new Intl.NumberFormat(languageLocale(), { style: 'currency', currency: 'USD' }).format(amount);
      for (const [label, value] of [
        ['Operator', transaction.operatorName], ['Product', transaction.productName], ['Recipient', transaction.recipientPhone],
        ['Recharge amount', money(transaction.providerAmount)], ['FlupFlap fee', money(transaction.feeUsd)], ['Total', money(transaction.totalChargeUsd)],
      ]) {
        const row = node('div'); row.append(node('dt', t(label)), node('dd', value)); details.append(row);
      }
      const failed = ['FAILED', 'CANCELLED'].includes(transaction.status);
      if (failed && settled) panel.append(node('p', t(paymentFailureMessage(transaction)), 'message'));
      else if (['REFUND_PENDING', 'VOID_PENDING', 'REFUNDED', 'VOIDED'].includes(status)) panel.append(node('p', t('rechargeInfo' + status), 'message'));
      const receiving = transaction.deliveredValue != null
        ? { amount: transaction.deliveredValue, currency: transaction.deliveredCurrency } : transaction.receiverQuote;
      if (receiving && !failed) {
        const row = node('div'); row.append(node('dt', t(transaction.deliveredValue != null ? 'receiverDelivered' : 'Receiver gets')),
          node('dd', new Intl.NumberFormat(languageLocale(), { style: 'currency', currency: receiving.currency }).format(receiving.amount))); details.append(row);
      }
      panel.append(details);
      if (receiving && failed) {
        const quote = node('details'); quote.append(node('summary', t('journeyViewReceipt')),
          node('p', t('receiverQuoted') + ': ' + new Intl.NumberFormat(languageLocale(), { style: 'currency', currency: receiving.currency }).format(receiving.amount)));
        panel.append(quote);
      }
      if (transaction.receiverDiscrepancy) panel.append(node('p', t('receiverValueChanged'), 'message'));
    }
    if (settled || !transaction) {
      const again = node('a', t(settled ? status === 'DELIVERED' ? 'journeyAgain' : 'rechargeTryAgain' : 'checkoutResumeStart'), 'button secondary');
      // Navigate without account/transaction parameters; the normal app restores its HttpOnly session.
      again.href = rechargePath(root); again.addEventListener('click', stop); panel.append(again);
    }
    if (transaction && !settled && polls >= 120) {
      const check = node('button', t('journeyCheckStatus'), 'button secondary'); check.type = 'button';
      check.addEventListener('click', () => { polls = 0; message = ''; void poll(); render(); }); panel.append(check);
    }
    root.replaceChildren(panel);
  }
  function fail(expired = false) {
    stop(); transaction = undefined; message = expired ? 'checkoutResumeExpired' : 'checkoutResumeUnavailable'; render();
  }
  async function poll() {
    const current = generation;
    try {
      requestController = new AbortController();
      const next = displayTransaction(await client.resumeCheckout(resumeToken, { signal: requestController.signal }));
      if (disposed || current !== generation) return;
      transaction = next; message = ''; polls += 1;
      if (transactionFullySettled(next)) stop();
      else if (polls < 120) {
        // Expiry is server-authoritative (HTTP 410); it is deliberately not part of the public DTO.
        // Non-overlapping reads, below the backend's 20/minute resume limit.
        pollTimer = clock.setTimeout(poll, 5000);
      }
      render();
    } catch (error) {
      if (!disposed && current === generation) fail(error?.status === 410);
    }
  }
  const onPageHide = () => { stop(); disposed = true; transaction = undefined; root.replaceChildren(); };
  pageWindow.addEventListener('pagehide', onPageHide);
  const unsubscribe = onLanguageChange(render);
  render();
  if (!isCheckoutResumeToken(resumeToken)) fail();
  else {
    try {
      client = dependencies.api || createApiClient({
        baseUrl: apiBaseUrl(config.apiBaseUrl, pageWindow.location.href),
        identityDomain: root.dataset.loginBrand === 'flupflap' ? 'FLUPFLAP' : 'TICASH',
      });
      void poll();
    } catch { fail(); }
  }
  // No authenticated model, client, capability, protected actions or mutable state are exposed.
  return Object.freeze({
    mode: 'resume',
    dispose() {
      onPageHide(); pageWindow.removeEventListener('pagehide', onPageHide);
      unsubscribe(); removeLanguageHeader();
    },
  });
}
