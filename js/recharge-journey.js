import { t, getLanguage } from './i18n.js';

// Navigation and presentation only. Recharge remains the source of catalog,
// quote, reservation, payment and transaction state; there is no fee calculation here.
export function mountRechargeJourney({ root, model, render, el, ui, button, action, money, date, details, icon, operatorDetail, nodes: n }) {
  let screen = 'number';
  let fallback = false;
  let continuing = false;
  let quoteRequest;
  let quoteTimer;
  let selectionKey;
  let generation = model.generation;
  let lastTransaction;
  let repeatedId;
  let resultSignature;
  let summarySignature;
  let recentSignature;
  let disposed = false;
  let statusPollTimer = null;
  let statusPollStartedAt = 0;
  let statusPollTarget = '';
  const stopStatusPoll = () => {
    if (statusPollTimer) clearTimeout(statusPollTimer);
    statusPollTimer = null;
    statusPollStartedAt = 0;
    statusPollTarget = '';
  };
  const scheduleStatusPoll = (transactionId) => {
    if (disposed || !transactionId) return;
    if (statusPollTarget !== transactionId) {
      stopStatusPoll();
      statusPollTarget = transactionId;
      statusPollStartedAt = Date.now();
    }
    if (statusPollTimer) return;
    if (Date.now() - statusPollStartedAt > 120000) return;
    statusPollTimer = setTimeout(() => {
      statusPollTimer = null;
      if (!disposed && statusPollTarget === transactionId) void model.refreshTransaction(transactionId, { silent: true });
    }, 3000);
  };
  const pending = () => {
    const txn = model.state.transaction;
    if (!txn) return Boolean(model.state.resumeTransactionId || model.state.attempt);
    return !['DELIVERED', 'SUCCESS', 'FAILED', 'CANCELLED'].includes(txn.status);
  };
  const locked = () => Boolean(model.state.attempt || model.state.submitting || pending());
  const heading = (key, id) => el('h2', { id, tabindex: '-1' }, ui(key));
  const section = (name, key) => el('section', { id: `journey-${name}`, className: 'journey-screen panel', 'aria-labelledby': `journey-${name}-title`, hidden: '' }, heading(key, `journey-${name}-title`));
  const closeMenu = () => { n.menu.hidden = true; n.menuButton.setAttribute('aria-expanded', 'false'); };
  function show(next, focus = true) {
    screen = next; closeMenu(); render();
    if (focus) root.querySelector(`[data-journey-screen="${next}"] h2`)?.focus();
  }
  const numberTitle = heading('journeyNumberTitle', 'journey-number-title');
  n.destinationPanel.querySelector('summary').replaceWith(numberTitle);
  n.destinationPanel.querySelector('.details-intro').replaceChildren(ui('journeyNumberIntro'));
  n.destinationPanel.setAttribute('aria-labelledby', numberTitle.id);
  const fallbackControls = el('div', { id: 'operator-fallback', hidden: '' },
    el('p', { className: 'small muted' }, ui('journeyOperatorFallback')),
    n.operatorControls.querySelector('.operator-actions'), n.operatorPicker.closest('.field'));
  n.destinationControls.append(fallbackControls);
  const numberContinue = button('Continue', action(async () => {
    if (continuing || locked()) return;
    model.normalizedPhone();
    continuing = true; render();
    const activeGeneration = model.generation;
    const country = model.state.country; const phone = model.state.phone;
    try {
      if (!model.state.operator) await model.detect();
      if (disposed || activeGeneration !== model.generation || country !== model.state.country || phone !== model.state.phone) return;
      if (model.state.operator && model.state.products.length) show('amount');
      else { fallback = true; render(); n.operatorPicker.querySelector('button').focus(); }
    } finally { continuing = false; render(); }
  })); numberContinue.id = 'continue-number';
  const recipientsLink = button('journeyRecipients', () => show('recipients'), true);
  recipientsLink.classList.add('text-action');
  n.destinationPanel.append(recipientsLink, numberContinue);
  const amountPanel = section('amount', 'journeyAmountTitle');
  const amountRecipient = el('div', { className: 'journey-recipient' });
  const amountSummary = el('div', { id: 'amount-summary', 'aria-live': 'polite' });
  amountPanel.prepend(amountRecipient);
  amountPanel.append(el('p', { className: 'muted' }, ui('journeyAmountIntro')), n.productKinds, n.operatorControls);
  n.operatorControls.insertBefore(amountSummary, n.quoteButton);
  const payRecipient = el('div', { className: 'journey-recipient' });
  n.reviewPanel.querySelector('summary').replaceWith(heading('journeyPaymentTitle', 'review-title'));
  n.reviewPanel.prepend(payRecipient);
  n.reviewContent.after(n.reviewPanel.querySelector('h2'));
  n.reviewPanel.querySelector('.review-helper').remove();
  n.flowPanel.querySelector('h3').replaceChildren(ui('journeyPaymentTitle'));
  n.selectionFields.replaceChildren(n.destinationPanel, amountPanel, n.reviewPanel);
  n.reassurance.remove();
  const directoryPanel = section('directory', 'journeyDirectory'); directoryPanel.append(n.coverage);
  const recipientsScreen = section('recipients', 'journeyRecipients');
  n.recipientsPanel.open = true;
  const useRecipientContinue = button('Continue', () => show('number'));
  recipientsScreen.append(n.recipientsPanel, useRecipientContinue);
  const home = section('home', 'journeyHomeTitle');
  const recent = el('div', { className: 'recent-list' });
  home.append(button('journeyRechargeNow', () => show(model.state.transaction || model.state.resumeTransactionId ? 'result' : model.state.attempt ? 'pay' : 'number')),
    el('div', { className: 'section-heading' }, el('h3', {}, ui('journeyRecent')), button('journeyViewAll', () => show('history'), true)), recent);
  n.historyPanel.querySelector('h2').replaceChildren(ui('journeyHistory'));
  n.historyPanel.querySelector('h2').tabIndex = -1;
  const ancillary = el('div', { id: 'recharge-screens' }, home, directoryPanel, n.historyPanel, recipientsScreen);
  n.checkout.after(ancillary);
  const screens = { number: n.destinationPanel, amount: amountPanel, pay: n.reviewPanel, result: n.receipt,
    home, directory: directoryPanel, history: n.historyPanel, recipients: recipientsScreen };
  for (const [name, panel] of Object.entries(screens)) panel.dataset.journeyScreen = name;
  const navEntries = [['home', 'homeLabel', 'globe'], ['number', 'mobileRecharge', 'phone'], ['recipients', 'journeyRecipients', 'recipient'],
    ['history', 'journeyHistory', 'clock'], ['directory', 'journeyDirectory', 'globe']];
  function navigation() {
    return navEntries.map(([target, key, symbol]) => {
      const link = button(key, () => show(target === 'number' && locked() ? (model.state.transaction ? 'result' : 'pay') : target), true);
      link.dataset.journeyNav = target; link.removeAttribute('data-i18n'); link.replaceChildren(icon(symbol), ui(key)); return link;
    });
  }
  n.menu.replaceChildren(...navigation(), el('a', { href: '/support' }, ui('support')),
    button('journeyAccount', () => { closeMenu(); n.accountBar.open = true; n.accountBar.querySelector('summary').focus(); }, true),
    button('Sign out', () => root.querySelector('#sign-out').click(), true));
  n.sidebar.querySelector('nav').replaceChildren(...navigation(), el('a', { className: 'sidebar-link', href: '/support' }, icon('info'), ui('support')));
  n.sidebar.querySelector('.sidebar-note').remove();
  n.hero.querySelector('.feature-row').remove();
  n.hero.querySelector('.flupflap-hero-art').hidden = true;
  n.hero.querySelector('.flupflap-hero-copy p').replaceChildren(ui('journeyTagline'));
  n.hero.classList.add('journey-brand');
  root.classList.add('recharge-journey');
  const steps = ['journeyNumber', 'journeyAmount', 'journeyPay'];
  n.progressItems.forEach((item, i) => item.lastElementChild.replaceWith(ui(steps[i])));
  function recipient(card, s) {
    const q = s.quote;
    const op = s.operator || s.operators.find(item => item.id === q?.operatorId);
    const edit = button('journeyEdit', () => show('number'), true); edit.disabled = locked();
    card.replaceChildren(el('div', {}, operatorDetail(op?.name || q?.operatorName || t('Not supplied'), op),
      el('p', {}, `${q?.recipientPhone || s.phone} · ${q?.countryCode || s.country}`)), edit);
  }
  const priceSummary = q => details([['Recharge amount', money(q.providerAmount, q.providerCurrency)],
    ['FlupFlap fee', money(q.feeUsd, 'USD')], ['Total', money(q.totalChargeUsd, 'USD')]]);
  async function freshQuote() {
    if (quoteRequest) return quoteRequest;
    if (locked() || model.busy.has('quote')) return;
    clearTimeout(quoteTimer);
    // Defer one microtask so the promise guard exists before synchronous model emits.
    const requestedSelection = selectionKey;
    quoteRequest = Promise.resolve().then(() => repeatedId && !model.state.product ? model.repeat(repeatedId) : model.getQuote());
    try { await quoteRequest; } finally {
      quoteRequest = undefined;
      if (!disposed) {
        render();
        // An edit during a slow request invalidates that response in Recharge.
        // Request the new selection once, without retrying an unchanged failure.
        if (screen === 'amount' && selectionKey && requestedSelection !== selectionKey && !model.state.quote && !locked()) {
          clearTimeout(quoteTimer); quoteTimer = setTimeout(action(freshQuote), 350);
        }
      }
    }
  }
  async function continueToPay() {
    if (locked() || continuing) return;
    continuing = true; render();
    const activeGeneration = model.generation;
    try {
      if (!model.quoteValid()) await freshQuote();
      if (!disposed && activeGeneration === model.generation && model.quoteValid()) show('pay');
    } finally { continuing = false; if (!disposed) render(); }
  }
  async function pay() {
    if (continuing || quoteRequest || model.state.submitting) return;
    if (!model.state.attempt && !model.quoteValid()) {
      await freshQuote();
      // getQuote/repeat clears reviewed. A refreshed total must always be reviewed again.
      return;
    }
    const session = await model.confirm();
    const redirectUrl = session?.checkoutSession?.url || session?.checkoutSession?.checkoutUrl || session?.checkoutSession?.redirectUrl;
    if (redirectUrl && typeof globalThis.location?.assign === 'function') {
      globalThis.location.assign(redirectUrl);
    }
  }
  async function viewTransaction(id) {
    await model.refreshTransaction(id);
    if (model.state.transaction?.id === id) show('result');
  }
  async function repeat(id) {
    if (locked() || model.busy.has('repeat')) return;
    repeatedId = id;
    await model.repeat(id);
    if (model.quoteValid()) show('pay');
  }
  function update(s, busy, signedIn) {
    if (generation !== model.generation) {
      generation = model.generation; screen = 'number'; fallback = false; selectionKey = undefined;
      lastTransaction = undefined; repeatedId = undefined; clearTimeout(quoteTimer); stopStatusPoll();
    }
    if (s.transaction && lastTransaction !== s.transaction.id) {
      lastTransaction = s.transaction.id; screen = 'result';
      queueMicrotask(() => { if (screen === 'result') n.receipt.querySelector('h2')?.focus(); });
    } else if (!s.transaction) lastTransaction = undefined;
    if (s.resumeTransactionId && !s.transaction && screen !== 'result') screen = 'result';
    if (s.checkoutSession && ['number', 'amount'].includes(screen)) screen = 'pay';
    const autoRefreshId = s.transaction?.id || s.resumeTransactionId || s.attempt?.transactionId;
    if (autoRefreshId && pending()) scheduleStatusPoll(autoRefreshId);
    else stopStatusPoll();
    ancillary.hidden = !signedIn;
    for (const [name, panel] of Object.entries(screens)) panel.hidden = !signedIn || screen !== name;
    n.selectionFields.hidden = !['number', 'amount', 'pay'].includes(screen);
    n.progress.hidden = !['number', 'amount', 'pay'].includes(screen);
    n.hero.hidden = !signedIn || !['number', 'home'].includes(screen);
    if (signedIn) { n.testTitle.textContent = t('Test mode'); n.testText.textContent = t('No real payment is collected.'); }
    fallbackControls.hidden = !fallback;
    n.destinationPanel.open = true; n.reviewPanel.open = true;
    const index = ['number', 'amount', 'pay'].indexOf(screen);
    n.progressItems.forEach((item, i) => {
      item.dataset.complete = String(i < index);
      if (i === index) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
      item.firstElementChild.textContent = i < index ? '✓' : String(i + 1);
    });
    root.querySelectorAll('[data-journey-nav]').forEach(item => {
      if (item.dataset.journeyNav === screen) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
    });
    n.destinationControls.disabled ||= pending(); n.operatorControls.disabled ||= pending();
    n.recipientsSelect.disabled = locked();
    recipientsLink.disabled = locked();
    useRecipientContinue.disabled = locked();
    const againButton = n.receipt.querySelector('#recharge-again');
    if (againButton) { againButton.disabled = locked() || busy.has('repeat'); againButton.hidden ||= locked(); }
    numberContinue.disabled = continuing || locked() || !s.ready || [...busy].some(key => /^(detect|operators:|products:)/.test(key));
    numberContinue.textContent = t(continuing ? 'Connecting…' : 'Continue');
    n.phone.setAttribute('aria-invalid', String(Boolean(s.error && /phone|number|calling code/i.test(s.error))));
    n.phone.setAttribute('aria-describedby', 'phone-hint recharge-error');
    n.quoteButton.textContent = t(quoteRequest || continuing ? 'Getting quote…' : 'journeyContinuePayment');
    n.quoteButton.disabled ||= continuing || Boolean(quoteRequest) || locked();
    n.confirmButton.hidden = Boolean(s.checkoutSession);
    if (s.quote && !model.quoteValid() && !locked()) n.confirmButton.disabled = Boolean(quoteRequest);
    n.confirmButton.textContent = t(s.submitting ? 'Confirming…' : !model.quoteValid() && !locked() ? 'journeyRefreshQuote' : s.attempt ? 'Retry same confirmation' : 'journeyPayTotal', { total: money(s.quote?.totalChargeUsd, 'USD') });
    if (!n.confirmPayment.disabled) n.confirmPayment.textContent = t('journeyPayTotal', { total: money(s.checkoutSession?.amountMinor / 100, 'USD') });
    if (s.quote && !model.quoteValid() && !locked()) n.expiry.textContent = t('journeyQuoteExpired');
    const summaryKey = JSON.stringify([s.quote, s.operator, s.phone, locked(), getLanguage()]);
    if (summarySignature !== summaryKey) {
      summarySignature = summaryKey; recipient(amountRecipient, s); recipient(payRecipient, s);
      amountSummary.replaceChildren(s.quote ? priceSummary(s.quote) : el('p', { className: 'small muted' }, ui('journeyQuoteHint')));
      if (s.quote) n.reviewContent.replaceChildren(priceSummary(s.quote), el('p', { className: 'small muted' }, s.quote.productName));
    }
    // A short debounce supports range typing; no catalog reloads when navigating.
    let nextSelection;
    try { nextSelection = JSON.stringify(model.quoteBody()); } catch { /* Incomplete input has no quote. */ }
    if (selectionKey !== nextSelection) {
      selectionKey = nextSelection; clearTimeout(quoteTimer);
      if (screen === 'amount' && nextSelection && !s.quote && !locked()) {
        const requestedGeneration = model.generation;
        quoteTimer = setTimeout(() => { if (!disposed && requestedGeneration === model.generation && screen === 'amount') void action(freshQuote)(); }, 350);
      }
    }
    const resultKey = JSON.stringify([s.transaction, s.resumeTransactionId, getLanguage()]);
    if (s.transaction && resultSignature !== resultKey) {
      resultSignature = resultKey;
      const txn = s.transaction;
      const delivered = ['DELIVERED', 'SUCCESS'].includes(txn.status);
      const failed = ['FAILED', 'CANCELLED'].includes(txn.status);
      const title = delivered ? 'journeySuccess' : failed ? 'journeyFailed' : 'journeyPending';
      const headingNode = heading(title, 'journey-result-title');
      const fullReceipt = el('details', { className: 'journey-full-receipt' }, el('summary', {}, ui('journeyViewReceipt')), ...Array.from(n.receipt.children));
      // Existing receipt retains the authoritative IDs, status, product and currency details.
      fullReceipt.querySelector('h2')?.remove();
      const again = button('journeyAgain', action(() => repeat(txn.id))); again.id = 'recharge-again';
      again.hidden = !delivered || locked(); again.disabled = busy.has('repeat');
      n.refreshReceipt.removeAttribute('data-i18n'); n.refreshReceipt.textContent = t('journeyCheckStatus');
      n.receipt.replaceChildren(el('span', { className: 'journey-result-symbol', 'aria-hidden': 'true' }, delivered ? '✓' : failed ? '!' : '…'), headingNode,
        el('p', { className: 'muted' }, ui(delivered ? 'journeySuccessInfo' : failed ? 'journeyFailedInfo' : 'journeyPendingInfo')),
        operatorDetail(txn.operatorName, s.operator?.id === txn.operatorId ? s.operator : s.operators.find(op => op.id === txn.operatorId)),
        el('p', {}, txn.recipientPhone), priceSummary(txn), el('p', { className: 'status-pill' }, String(txn.status)), n.refreshReceipt, again, fullReceipt);
      n.receipt.setAttribute('aria-labelledby', 'journey-result-title');
    } else if (!s.transaction && s.resumeTransactionId && resultSignature !== resultKey) {
      resultSignature = resultKey;
      n.receipt.replaceChildren(
        el('span', { className: 'journey-result-symbol', 'aria-hidden': 'true' }, '…'),
        heading('journeyPending', 'journey-result-title'),
        el('p', { className: 'muted' }, ui('journeyPendingInfo')),
        el('p', { className: 'status-pill' }, 'AWAITING_PAYMENT'),
        n.refreshReceipt,
      );
      n.receipt.setAttribute('aria-labelledby', 'journey-result-title');
    }
    if (!s.transaction && !s.resumeTransactionId) resultSignature = undefined;
    const recentKey = JSON.stringify([s.history, locked(), getLanguage(), s.resumeTransactionId]);
    if (recentSignature !== recentKey) {
      recentSignature = recentKey;
      recent.replaceChildren(...s.history.slice(0, 3).map(txn => {
        const item = button('', action(() => viewTransaction(txn.id)), true);
        item.removeAttribute('data-i18n'); item.classList.add('recent-item'); item.disabled = locked();
        item.replaceChildren(el('strong', {}, txn.operatorName), el('span', {}, txn.recipientPhone), el('span', {}, money(txn.totalChargeUsd, 'USD')),
          el('small', {}, date(txn.createdAt)), el('span', { className: 'status-pill' }, String(txn.status))); return item;
      }));
      if (!s.history.length) recent.append(el('p', { className: 'muted' }, ui('historyEmptyTitle')));
    }
  }
  return { update, continueToPay, pay, viewTransaction, repeat, dispose() { disposed = true; clearTimeout(quoteTimer); stopStatusPoll(); } };
}
