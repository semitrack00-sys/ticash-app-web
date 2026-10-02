// Presentation of server states only. This module never confirms a payment or recharge.
export const paymentRecoveryPending = transaction =>
  ['REFUND_PENDING', 'VOID_PENDING'].includes(transaction?.paymentStatus);

export function transactionFullySettled(transaction) {
  if (!transaction || paymentRecoveryPending(transaction)) return false;
  if (['REFUNDED', 'VOIDED'].includes(transaction.paymentStatus)) return true;
  // A failed delivery with paid/authorized funds still needs server reconciliation.
  if (transaction.status === 'FAILED' && ['AUTHORIZED', 'CAPTURED'].includes(transaction.paymentStatus)) return false;
  return ['DELIVERED', 'SUCCESS', 'FAILED', 'CANCELLED', 'REFUNDED'].includes(transaction.status);
}

export function transactionStatus(transaction) {
  if (paymentRecoveryPending(transaction) || ['REFUNDED', 'VOIDED'].includes(transaction?.paymentStatus)) return transaction.paymentStatus;
  if (transaction?.failureCode === 'CANCELLED_BY_CUSTOMER') return 'CANCELLED';
  if (transaction?.paymentStatus === 'FAILED') return 'FAILED';
  return transaction?.status || 'PENDING';
}

export const canCancelTransaction = transaction => Boolean(transaction &&
  transaction.status === 'PENDING' && ['PENDING', 'SESSION_CREATED'].includes(transaction.paymentStatus) &&
  !transaction.providerTransactionId && !transaction.fulfillmentStartedAt &&
  !transaction.paymentAuthorizationId && !transaction.paymentProviderTransactionId);

export const canHideTransaction = transaction => Boolean(transaction &&
  transaction.status === 'FAILED' && transaction.paymentStatus === 'FAILED' &&
  transaction.failureCode === 'CANCELLED_BY_CUSTOMER' && !transaction.providerTransactionId &&
  !transaction.paymentAuthorizationId && !transaction.paymentProviderTransactionId);

// Only a small public vocabulary reaches the UI; never display raw Stripe messages.
export function paymentFailureMessage(transaction) {
  if (!['FAILED', 'CANCELLED'].includes(transaction?.status)) return '';
  const reason = transaction.failureReason ?? transaction.failureCode;
  return ({ INSUFFICIENT_FUNDS: 'paymentInsufficientFunds', PAYMENT_DECLINED: 'paymentDeclined',
    PAYMENT_CANCELLED: 'paymentCancelled', CANCELLED_BY_CUSTOMER: 'paymentCancelled',
    PAYMENT_EXPIRED: 'paymentExpired' })[reason] || 'journeyFailedInfo';
}
