import { apiBaseUrl, createApiClient } from './api-client.js';
import { Recharge, searchCountries } from './recharge.js';

function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'className') node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child !== undefined && child !== null) node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}
function money(value, currency) {
  if (!Number.isFinite(value)) return 'Not supplied';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value); }
  catch { return `${value.toFixed(2)} ${currency || ''}`; }
}
function date(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Not supplied' : parsed.toLocaleString();
}
function field(label, input, hint) {
  return el('div', { className: 'field' }, el('label', { for: input.id }, label), input,
    hint ? el('small', { id: `${input.id}-hint` }, hint) : null);
}
function options(select, items, selected, placeholder, label, value) {
  const signature = JSON.stringify([items.map((item) => [value(item), label(item)]), selected, placeholder]);
  if (select.dataset.signature === signature) return;
  select.dataset.signature = signature;
  select.replaceChildren(el('option', { value: '' }, placeholder), ...items.map((item) => el('option', { value: String(value(item)) }, label(item))));
  select.value = selected == null ? '' : String(selected);
}
function details(data) {
  return el('dl', { className: 'details' }, data.map(([label, value]) => el('div', {}, el('dt', {}, label), el('dd', {}, String(value ?? 'Not supplied')))));
}

// Shared by /login and /recharge. In-page sign-in preserves memory-only tokens.
export function mountRecharge(root, config, dependencies = {}) {
  let client;
  let model;
  let signedIn = false;
  let signingIn = false;
  let disposed = false;
  let configured = true;
  let historySignature;
  let receiptSignature;
  let quoteSignature;
  let countrySearch = '';
  const button = (label, action, secondary = false) => el('button', { type: 'button', className: secondary ? 'button secondary' : 'button', onclick: action }, label);
  const action = (fn) => async () => {
    try { await fn(); } catch (error) { model.state.error = error.message; model.emit(); }
  };
  const error = el('p', { className: 'message error', role: 'alert', id: 'recharge-error', hidden: '' });
  const notice = el('p', { className: 'message', role: 'status', id: 'recharge-notice', hidden: '' });
  const email = el('input', { id: 'email', type: 'email', autocomplete: 'username', required: '', maxlength: '254' });
  const password = el('input', { id: 'password', type: 'password', autocomplete: 'current-password', required: '', minlength: '8', maxlength: '128' });
  const loginButton = el('button', { className: 'button', type: 'submit' }, 'Sign in for test recharge');
  const loginError = el('p', { role: 'alert', className: 'message error', hidden: '' });
  const loginForm = el('form', { id: 'login-form' }, field('Email address', email), field('Password', password), loginError, loginButton);
  const loginPanel = el('section', { className: 'panel login-panel', 'aria-labelledby': 'login-title' },
    el('div', {}, el('span', { className: 'step' }, 'YOUR TICASH ACCOUNT'), el('h2', { id: 'login-title' }, 'Sign in to stay connected.'),
      el('p', { className: 'muted' }, 'Use your existing TiCash account. This test checkout does not move real money or deliver real airtime.'),
      el('p', { className: 'small muted' }, 'Your session lasts only while this page stays open. Reloading or leaving the page signs you out.'),
      el('a', { href: '/support' }, 'Need help with your account?')),
    loginForm);
  const logout = button('Sign out', async () => {
    signedIn = false; model.reset(); render();
    try { await client.logout(); }
    catch { loginError.textContent = 'You are signed out here. TiCash could not confirm server logout; sign in again if needed.'; loginError.hidden = false; }
    email.focus();
  }, true);
  logout.id = 'sign-out';
  const accountBar = el('div', { className: 'account-bar', hidden: '' }, el('span', {}, 'Signed in · private test session'), logout);
  const countrySearchInput = el('input', { id: 'country-search', type: 'search', placeholder: 'Search by country or code', autocomplete: 'off' });
  const country = el('select', { id: 'country', required: '' });
  const phone = el('input', { id: 'phone', type: 'tel', autocomplete: 'tel', maxlength: '40', 'aria-describedby': 'phone-hint', placeholder: '+ country code and mobile number' });
  const operator = el('select', { id: 'operator' });
  const product = el('select', { id: 'product' });
  const amount = el('input', { id: 'amount', type: 'number', inputmode: 'decimal', step: '0.01', 'aria-describedby': 'amount-hint' });
  const amountHint = el('small', { id: 'amount-hint' });
  const amountField = el('div', { className: 'field', hidden: '' }, el('label', { for: 'amount' }, 'Recharge amount'), amount, amountHint);
  const catalogNote = el('p', { className: 'small muted', role: 'status' });
  const detectButton = button('Find my operator', action(() => model.detect()), true); detectButton.id = 'detect-operator';
  const operatorsRetry = button('Reload operators', action(() => model.loadOperators()), true);
  const quoteButton = button('Get quote →', action(() => model.getQuote())); quoteButton.id = 'get-quote';
  const countriesRetry = button('Retry connection', action(() => model.start()), true);
  const recipientsSelect = el('select', { id: 'saved-recipient' });
  const recipientNote = el('small', { role: 'status' });
  const recipientsPanel = el('details', { className: 'saved-recipients' }, el('summary', {}, 'Use a saved recipient'),
    field('Saved recipient', recipientsSelect), recipientNote);
  const selectionFields = el('fieldset', { id: 'selection-fields' },
    el('legend', {}, 'Recharge details'),
    el('section', { className: 'checkout-step' }, el('span', { className: 'step' }, '01 / DESTINATION'), el('h2', {}, 'Who are you recharging?'),
      recipientsPanel, field('Search countries', countrySearchInput), field('Destination country', country),
      field('International mobile number', phone, 'Include the international country code. Check the number carefully before confirming.')),
    el('section', { className: 'checkout-step' }, el('span', { className: 'step' }, '02 / OPERATOR & PRODUCT'), el('h2', {}, 'Choose their recharge.'),
      el('div', { className: 'compact-actions' }, detectButton, operatorsRetry),
      field('Mobile operator', operator, 'If detection is unavailable, select the operator manually.'),
      field('Available recharge products', product), amountField, catalogNote, quoteButton));
  const reviewContent = el('div', { id: 'quote-details' });
  const expiry = el('p', { className: 'small', role: 'status', id: 'quote-expiry' });
  const reviewed = el('input', { type: 'checkbox', id: 'reviewed' });
  const reviewCheck = el('label', { className: 'review-check', for: 'reviewed' }, reviewed, el('span', {}, 'I checked the phone number, operator, product, and quoted total.'));
  const confirmButton = button('Confirm test recharge', action(() => model.confirm())); confirmButton.id = 'confirm-recharge';
  const recoveryNote = el('p', { className: 'message', hidden: '', role: 'status', id: 'recovery-note' },
    'Confirmation is unresolved. Keep this page open. Retry uses the same request so it cannot create a second recharge; you can also refresh history to find the receipt.');
  const reviewPanel = el('aside', { className: 'panel review-panel', 'aria-labelledby': 'review-title' },
    el('span', { className: 'step' }, '03 / REVIEW & CONFIRM'), el('h2', { id: 'review-title' }, 'A little connection. A lot of care.'),
    reviewContent, expiry, reviewCheck, confirmButton, recoveryNote,
    el('p', { className: 'small muted' }, 'TEST MODE · No real payment is collected. Prices, fees, and availability are supplied by TiCash.'));
  const receipt = el('section', { className: 'panel receipt', id: 'receipt', 'aria-live': 'polite', hidden: '' });
  const refreshReceipt = button('Refresh transaction status', action(() => model.refreshTransaction()), true); refreshReceipt.id = 'refresh-status';
  const historyList = el('div', { className: 'history-list', id: 'history-list' });
  const historyError = el('p', { role: 'status', className: 'message error', hidden: '' });
  const historyRefresh = button('Refresh history', action(() => model.loadHistory()), true); historyRefresh.id = 'refresh-history';
  const historyPanel = el('section', { className: 'panel history-panel' },
    el('div', { className: 'section-heading' }, el('div', {}, el('span', { className: 'step' }, 'YOUR ACTIVITY'), el('h2', {}, 'Test recharge history')), historyRefresh),
    el('p', { className: 'small muted' }, 'Recent test transactions from your TiCash account. Repeat always requests a new quote.'), historyError, historyList);
  const checkout = el('div', { id: 'checkout', hidden: '' },
    el('div', { className: 'checkout-grid' }, el('section', { className: 'panel selection-panel' }, countriesRetry, selectionFields), reviewPanel),
    receipt, historyPanel);
  root.replaceChildren(
    el('div', { className: 'test-banner', role: 'note' }, el('strong', {}, 'TEST MODE'), el('span', {}, 'No real money. No live recharge.')),
    el('section', { className: 'checkout-hero' }, el('span', { className: 'eyebrow' }, 'MOBILE RECHARGE'),
      el('h1', {}, 'Closer, with every call.'), el('p', {}, 'Explore available destinations and recharge products, with a clear quote before you confirm.')),
    accountBar, error, notice, loginPanel, checkout);

  function render() {
    if (disposed || !model) return;
    const s = model.state; const busy = model.busy;
    loginPanel.hidden = signedIn; accountBar.hidden = !signedIn; checkout.hidden = !signedIn;
    loginButton.disabled = !configured || signingIn;
    loginButton.textContent = signingIn ? 'Signing in…' : 'Sign in for test recharge';
    error.textContent = s.error; error.hidden = !s.error;
    notice.textContent = s.notice; notice.hidden = !s.notice;
    const locked = s.submitting || Boolean(s.attempt);
    selectionFields.disabled = !s.ready || locked;
    countriesRetry.hidden = s.ready; countriesRetry.disabled = busy.has('catalog');
    countriesRetry.textContent = busy.has('catalog') ? 'Connecting…' : 'Retry connection';
    const matches = searchCountries(s.countries, countrySearch);
    // Keep a selected country visible even while the search is being refined.
    const selectedCountry = s.countries.find((c) => c.code === s.country);
    if (selectedCountry && !matches.includes(selectedCountry)) matches.unshift(selectedCountry);
    options(country, matches, s.country, matches.length ? 'Choose a country' : 'No matching countries', (c) => c.name, (c) => c.code);
    if (phone.value !== s.phone) phone.value = s.phone;
    phone.disabled = !s.country;
    options(operator, s.operators, s.operator?.id, busy.has(`operators:${s.country}`) ? 'Loading operators…' : 'Choose an operator', (op) => op.name, (op) => op.id);
    operator.disabled = !s.country || !s.phone;
    detectButton.disabled = !s.country || !s.phone || busy.has('detect');
    detectButton.textContent = busy.has('detect') ? 'Finding operator…' : 'Find my operator';
    operatorsRetry.disabled = !s.country || busy.has(`operators:${s.country}`);
    options(product, s.products, s.product?.id, 'Choose a product', (p) => p.amountType === 'RANGE'
      ? `${p.name} · ${money(p.minimumAmount, p.priceCurrency)}–${money(p.maximumAmount, p.priceCurrency)}`
      : `${p.name} · ${money(p.price, p.priceCurrency)}`, (p) => p.id);
    product.disabled = !s.operator || !s.products.length;
    amountField.hidden = s.product?.amountType !== 'RANGE';
    if (s.product?.amountType === 'RANGE') {
      amount.min = s.product.minimumAmount; amount.max = s.product.maximumAmount;
      amountHint.textContent = `Available range: ${money(s.product.minimumAmount, s.product.priceCurrency)} to ${money(s.product.maximumAmount, s.product.priceCurrency)}. Final fee and total appear in your quote.`;
    }
    if (amount.value !== s.amount) amount.value = s.amount;
    catalogNote.textContent = busy.has(`operators:${s.country}`) ? 'Loading available operators…'
      : [...busy].some((name) => name.startsWith('products:')) ? 'Loading available products…'
      : s.operator && !s.products.length ? 'No products loaded. Select the operator again to retry, or choose another operator.'
      : s.country && !s.operators.length ? 'No operators loaded for this country. Try reloading operators or choose another destination.'
      : !s.countries.length && s.ready ? 'No destinations are currently available. Please try again later.' : 'Only currently returned catalog products are shown.';
    quoteButton.disabled = !s.product || busy.has('quote');
    quoteButton.textContent = busy.has('quote') ? 'Getting quote…' : 'Get quote →';
    options(recipientsSelect, s.recipients, '', 'Choose a saved recipient', (r) => `${r.nickname} · ${r.phone} · ${r.countryCode}`, (r) => r.id);
    recipientNote.textContent = s.recipientsError || (s.recipients.length ? 'Availability is checked again before you get a quote.' : 'No saved recipients. You can enter a number above.');
    const nextQuoteSignature = JSON.stringify(s.quote);
    if (quoteSignature !== nextQuoteSignature) {
      quoteSignature = nextQuoteSignature;
      reviewContent.replaceChildren(s.quote ? details([
        ['Destination', s.quote.countryCode], ['Phone number', s.quote.recipientPhone], ['Operator', s.quote.operatorName],
        ['Product', s.quote.productName], ['Recharge', money(s.quote.providerAmount, s.quote.providerCurrency)],
        ['Recipient value', s.quote.deliveredValue === undefined ? 'Confirmed when processed' : money(s.quote.deliveredValue, s.quote.deliveredCurrency)],
        ['TiCash fee', money(s.quote.feeUsd, 'USD')], ['Quoted total', money(s.quote.totalChargeUsd, 'USD')],
      ]) : el('div', { className: 'review-empty' }, el('span', { 'aria-hidden': 'true' }, '↗'), el('p', {}, 'Your quote will appear here.'), el('p', { className: 'small muted' }, 'Choose a destination, number, operator, and product to see the exact total.')));
    }
    expiry.textContent = s.quote ? (model.quoteValid() ? `Quote valid until ${date(s.quote.expiresAt)}` : 'This quote expired. Get a new quote before confirming.') : '';
    reviewCheck.hidden = !s.quote || Boolean(s.attempt); reviewed.checked = s.reviewed;
    reviewed.disabled = !model.quoteValid() || locked;
    confirmButton.disabled = s.submitting || Boolean(s.transaction) || (!s.attempt && (!s.reviewed || !model.quoteValid()));
    confirmButton.textContent = s.submitting ? 'Confirming…' : s.attempt ? 'Retry same confirmation' : 'Confirm test recharge';
    recoveryNote.hidden = !s.attempt || s.submitting;
    const nextReceiptSignature = JSON.stringify(s.transaction);
    if (receiptSignature !== nextReceiptSignature) {
      receiptSignature = nextReceiptSignature; receipt.hidden = !s.transaction;
      if (s.transaction) {
        const t = s.transaction;
        receipt.replaceChildren(el('span', { className: 'eyebrow' }, 'TEST RECEIPT'), el('h2', {}, `Recharge ${String(t.status || 'pending').toLowerCase()}`),
          el('p', { className: 'muted' }, 'This is a test transaction. No real money or airtime was transferred.'),
          details([['Reference', t.id], ['Status', t.status], ['Test payment status', t.paymentStatus], ['Phone number', t.recipientPhone],
            ['Destination', t.countryCode], ['Operator', t.operatorName], ['Product', t.productName],
            ['Recharge', money(t.providerAmount, t.providerCurrency)], ['Fee', money(t.feeUsd, 'USD')], ['Total', money(t.totalChargeUsd, 'USD')],
            ['Recipient value', t.deliveredValue === undefined ? 'Awaiting confirmation' : money(t.deliveredValue, t.deliveredCurrency)],
            ['Updated', date(t.updatedAt)], ...(t.failureCode ? [['Failure reason', t.failureCode]] : [])]), refreshReceipt);
      } else receipt.replaceChildren();
    }
    refreshReceipt.disabled = busy.has('receipt');
    historyRefresh.disabled = busy.has('history');
    historyError.textContent = s.historyError; historyError.hidden = !s.historyError;
    const nextHistorySignature = JSON.stringify([s.history, locked, busy.has('repeat'), busy.has('receipt')]);
    if (historySignature !== nextHistorySignature) {
      historySignature = nextHistorySignature;
      historyList.replaceChildren(...(s.history.length ? s.history.map((t) => {
        const view = button('View / refresh', action(() => model.refreshTransaction(t.id)), true);
        const repeat = button('Repeat recharge', action(() => model.repeat(t.id)), true);
        view.disabled = locked || busy.has('receipt'); repeat.disabled = locked || busy.has('repeat');
        return el('article', { className: 'history-item' },
          el('div', {}, el('strong', {}, t.productName), el('p', {}, `${t.recipientPhone} · ${t.countryCode}`), el('small', {}, date(t.createdAt))),
          el('div', {}, el('span', { className: 'status-pill' }, String(t.status)), el('p', {}, money(t.totalChargeUsd, 'USD'))),
          el('div', { className: 'compact-actions' }, view, repeat));
      }) : [el('p', { className: 'muted' }, busy.has('history') ? 'Loading your history…' : 'No test recharges yet. Your receipts will appear here.')]));
    }
  }
  const expired = () => {
    signedIn = false; model?.reset(); render();
    loginError.textContent = 'Your session expired or account access changed. Sign in again, then check history before repeating a recharge.';
    loginError.hidden = false;
  };
  try {
    if (config.mobileRechargeLive !== false) throw new Error('This checkout supports test mode only.');
    client = dependencies.api || createApiClient({ baseUrl: apiBaseUrl(config.apiBaseUrl), onSessionExpired: expired });
  } catch (error) {
    configured = false; loginError.textContent = error.message; loginError.hidden = false;
  }
  model = new Recharge(client, { ...dependencies, onChange: render });
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (signingIn || !configured || !loginForm.reportValidity()) return;
    signingIn = true; loginError.hidden = true; render();
    try {
      await client.login(email.value.trim(), password.value);
      password.value = ''; signedIn = true; model.reset(); render();
      // Fixed local destination; user-supplied return URLs are never used.
      if (globalThis.location?.pathname.startsWith('/login')) globalThis.history.replaceState(null, '', '/recharge');
      await model.start();
    } catch (error) { password.value = ''; loginError.textContent = error.message; loginError.hidden = false; }
    finally { signingIn = false; render(); }
  });
  countrySearchInput.addEventListener('input', () => { countrySearch = countrySearchInput.value; render(); });
  country.addEventListener('change', action(() => model.selectCountry(country.value)));
  phone.addEventListener('input', action(() => model.setPhone(phone.value)));
  operator.addEventListener('change', action(() => model.selectOperator(operator.value)));
  product.addEventListener('change', action(() => model.selectProduct(product.value)));
  amount.addEventListener('input', action(() => model.setAmount(amount.value)));
  reviewed.addEventListener('change', () => model.review(reviewed.checked));
  recipientsSelect.addEventListener('change', action(() => model.useRecipient(recipientsSelect.value)));
  const pageHide = () => { client?.clear(); signedIn = false; model.reset(); render(); };
  globalThis.addEventListener?.('pagehide', pageHide);
  const timer = setInterval(() => { if (signedIn && model.state.quote) render(); }, 1000);
  render();
  return { model, dispose() { disposed = true; clearInterval(timer); globalThis.removeEventListener?.('pagehide', pageHide); client?.clear(); } };
}

const root = typeof document === 'undefined' ? null : document.querySelector('[data-recharge-root]');
if (root) mountRecharge(root, globalThis.TICASH_PUBLIC_CONFIG || {});
