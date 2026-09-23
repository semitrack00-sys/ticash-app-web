import { apiBaseUrl, createApiClient } from './api-client.js';
import { Recharge, countryFlag, searchCountries } from './recharge.js';
import { t, getLanguage, languageLocale, localizeCountry, onLanguageChange, translateElements, syncLanguageSelectors } from './i18n.js';
import { mountLanguageHeader } from './language-page.js';

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
  if (!Number.isFinite(value)) return t('Not supplied');
  try { return new Intl.NumberFormat(languageLocale(), { style: 'currency', currency }).format(value); }
  catch { return `${value.toFixed(2)} ${currency || ''}`; }
}
function date(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? t('Not supplied') : new Intl.DateTimeFormat(languageLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}
// Small local line icons: decorative only; controls retain translated text labels.
function icon(name, className = '') {
  const paths = {
    menu: 'M4 6h16M4 12h16M4 18h16',
    user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2',
    globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18',
    phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2M10 18h4',
    receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3M9 7h6M9 11h6M9 15h3',
    clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 7v5l3 2',
    search: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0M15 15l6 6',
    refresh: 'M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5',
    antenna: 'M12 12v9M8 21h8M8 8a6 6 0 0 0 0 8M16 8a6 6 0 0 1 0 8M5 4a11 11 0 0 0 0 16M19 4a11 11 0 0 1 0 16',
    gift: 'M3 8h18v4H3V8M5 12v9h14v-9M12 8v13M12 8H8a3 3 0 1 1 3-3l1 3 1-3a3 3 0 1 1 3 3h-4',
    flask: 'M9 3h6M10 3v6L4 19a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3M7 15h10',
    chart: 'M4 19h16M7 15v-4M12 15V6M17 15V9',
    info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 11v6M12 7v1',
    recipient: 'M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M2 21v-2a7 7 0 0 1 12-5M19 13v8M15 17h8',
    chevron: 'm8 10 4 4 4-4',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: `recharge-icon ${className}` })) svg.setAttribute(key, value);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths[name]); svg.append(path); return svg;
}
function ui(key) { return el('span', { 'data-i18n': key }, t(key)); }
function flagAssetUrl(code) {
  return typeof code === 'string' && /^[A-Z]{2}$/.test(code) ? `/flags/${code.toLowerCase()}.svg` : '';
}
function countryFlagImage(country, className = 'country-picker-flag') {
  const image = el('img', {
    className, src: flagAssetUrl(country?.code), alt: '', 'aria-hidden': 'true',
    width: '24', height: '18', loading: 'lazy', decoding: 'async',
  });
  image.addEventListener('error', () => { image.hidden = true; });
  return image;
}
function field(label, input, hint) {
  return el('div', { className: 'field' }, el('label', { for: input.id }, ui(label)), input,
    hint ? el('small', { id: `${input.id}-hint` }, ui(hint)) : null);
}
function options(select, items, selected, placeholder, label, value) {
  const signature = JSON.stringify([items.map((item) => [value(item), label(item)]), selected, placeholder]);
  if (select.dataset.signature === signature) return;
  select.dataset.signature = signature;
  select.replaceChildren(el('option', { value: '' }, placeholder), ...items.map((item) => el('option', { value: String(value(item)) }, label(item))));
  select.value = selected == null ? '' : String(selected);
}
function details(data) {
  return el('dl', { className: 'details' }, data.map(([label, value]) => el('div', {}, el('dt', {}, t(label)), el('dd', {}, String(value ?? t('Not supplied'))))));
}

// Shared by /login and /recharge. In-page sign-in preserves memory-only tokens.
export function mountRecharge(root, config, dependencies = {}) {
  const pageWindow = root.ownerDocument.defaultView;
  const resetLocation = new URL(pageWindow.location.href);
  const isResetRoute = /^\/recharge\/reset-password\/?$/.test(resetLocation.pathname);
  let resetToken = isResetRoute ? resetLocation.searchParams.get('token') || '' : '';
  if (resetLocation.searchParams.has('token')) {
    resetLocation.searchParams.delete('token');
    pageWindow.history.replaceState(null, '', resetLocation.pathname + resetLocation.search + resetLocation.hash);
  }
  const validResetToken = () => /^[A-Za-z0-9_-]{43,512}$/.test(resetToken);
  const removeLanguageHeader = mountLanguageHeader(root.ownerDocument);
  let client;
  let model;
  let signedIn = false;
  let guestSession = false;
  let authMode = isResetRoute ? 'reset' : 'login';
  let recoveryMessage = '';
  let signingIn = false;
  let disposed = false;
  let configured = true;
  let historySignature;
  let receiptSignature;
  let quoteSignature;
  let countrySearch = '';
  let countryMenuOpen = false;
  let loginErrorMessage = '';
  const button = (label, action, secondary = false) => el('button', { type: 'button', 'data-i18n': label, className: secondary ? 'button secondary' : 'button', onclick: action }, t(label));
  const action = (fn) => async () => {
    try { await fn(); } catch (error) { model.state.error = error.message; model.emit(); }
  };
  const error = el('p', { className: 'message error', role: 'alert', id: 'recharge-error', hidden: '' });
  const notice = el('p', { className: 'message', role: 'status', id: 'recharge-notice', hidden: '' });
  const email = el('input', { id: 'email', type: 'email', autocomplete: 'username', required: '', maxlength: '254' });
  const password = el('input', { id: 'password', type: 'password', autocomplete: 'current-password', required: '', minlength: '8', maxlength: '128' });
  const passwordControls = [];
  const passwordField = (label, input) => {
    const toggle = button('Show', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      const showing = input.type === 'text';
      toggle.textContent = t(showing ? 'Hide' : 'Show');
      toggle.setAttribute('aria-label', t(`${showing ? 'Hide' : 'Show'} ${label.toLowerCase()}`));
      toggle.setAttribute('aria-pressed', String(showing));
    }, true);
    toggle.id = `${input.id}-visibility`;
    toggle.setAttribute('aria-label', t(`Show ${label.toLowerCase()}`)); toggle.setAttribute('aria-controls', input.id); toggle.setAttribute('aria-pressed', 'false');
    passwordControls.push({ input, toggle, label });
    return el('div', { className: 'field' }, el('label', { for: input.id }, ui(label)), el('div', { className: 'password-control' }, input, toggle));
  };
  const clearPasswords = () => passwordControls.forEach(({ input, toggle, label }) => {
    input.value = ''; input.type = 'password'; toggle.textContent = t('Show');
    toggle.setAttribute('aria-label', t(`Show ${label.toLowerCase()}`)); toggle.setAttribute('aria-pressed', 'false');
  });
  const loginButton = el('button', { className: 'button', type: 'submit' }, 'Sign in');
  const loginError = el('p', { role: 'alert', className: 'message error', hidden: '' });
  const setLoginError = (message) => { loginErrorMessage = message; loginError.textContent = t(message); loginError.hidden = false; };
  const loginForm = el('form', { id: 'login-form' }, field('Email address', email), passwordField('Password', password), loginButton);
  const firstName = el('input', { id: 'first-name', autocomplete: 'given-name', required: '', minlength: '1', maxlength: '80' });
  const lastName = el('input', { id: 'last-name', autocomplete: 'family-name', required: '', minlength: '1', maxlength: '80' });
  const registerEmail = el('input', { id: 'register-email', type: 'email', autocomplete: 'email', required: '', maxlength: '254' });
  const registerPassword = el('input', { id: 'register-password', type: 'password', autocomplete: 'new-password', required: '', minlength: '8', maxlength: '128' });
  const registerButton = el('button', { className: 'button', type: 'submit' }, 'Create TiCash account');
  const registerForm = el('form', { id: 'register-form', hidden: '' }, field('First name', firstName), field('Last name', lastName),
    field('Email address', registerEmail), passwordField('Account password', registerPassword),
    el('p', { className: 'small muted' }, ui('Create a permanent account to access your saved recipients and history when you sign in again.')), registerButton);
  const chooseAuth = (mode) => {
    if (signingIn) return;
    authMode = mode; resetToken = ''; recoveryMessage = ''; clearPasswords(); loginError.hidden = true; render();
    (mode === 'forgot' ? forgotEmail : mode === 'register' ? firstName : email).focus();
  };
  const signInChoice = button('Sign in', () => chooseAuth('login'), true); signInChoice.id = 'choose-login';
  const registerChoice = button('Create account', () => chooseAuth('register'), true); registerChoice.id = 'choose-register';
  const guestButton = button('Continue as guest', () => authenticate('guest'), true); guestButton.id = 'continue-guest';
  const authChoices = el('div', { className: 'auth-choices', role: 'group', 'aria-label': t('Account options'), 'data-i18n-aria-label': 'Account options' }, signInChoice, registerChoice);
  const forgotLink = button('Forgot password?', () => chooseAuth('forgot'), true);
  forgotLink.id = 'forgot-password'; forgotLink.classList.add('text-action');
  loginForm.insertBefore(forgotLink, loginButton);
  const forgotEmail = el('input', { id: 'forgot-email', type: 'email', autocomplete: 'email', required: '', maxlength: '254' });
  const forgotSubmit = el('button', { className: 'button', type: 'submit' }, t('Send reset instructions'));
  const forgotForm = el('form', { id: 'forgot-form', hidden: '' }, field('Email address', forgotEmail), forgotSubmit);
  const newPassword = el('input', { id: 'new-password', type: 'password', autocomplete: 'new-password', required: '', minlength: '8', maxlength: '128' });
  const confirmPassword = el('input', { id: 'confirm-password', type: 'password', autocomplete: 'new-password', required: '', minlength: '8', maxlength: '128' });
  const resetSubmit = el('button', { className: 'button', type: 'submit' }, t('Reset password'));
  const resetForm = el('form', { id: 'reset-form', hidden: '' }, passwordField('New password', newPassword), passwordField('Confirm new password', confirmPassword), resetSubmit);
  const recoveryStatus = el('p', { id: 'recovery-status', role: 'status', className: 'message', hidden: '' });
  const backToLogin = button('Back to Sign in', () => chooseAuth('login'), true); backToLogin.id = 'back-to-login';
  const loginTitle = el('h1', { id: 'login-title' });
  const loginIntro = el('p', { className: 'muted auth-intro' });
  const loginPanel = el('section', { className: 'panel login-panel', 'aria-labelledby': 'login-title' },
    el('span', { className: 'step' }, ui('YOUR TICASH ACCOUNT')), loginTitle, loginIntro,
    authChoices, loginError, recoveryStatus, loginForm, registerForm, forgotForm, resetForm, backToLogin,
    el('div', { className: 'auth-secondary' }, guestButton),
    el('a', { className: 'auth-help', href: '/support' }, ui('Need help signing in?')));
  const logout = button('Sign out', async () => {
    signedIn = false; guestSession = false; clearPasswords(); model.reset(); render();
    try { await client.logout(); }
    catch { setLoginError('You are signed out here. TiCash could not confirm server logout; sign in again if needed.'); }
    email.focus();
  }, true);
  logout.id = 'sign-out';
  const accountLabel = el('span', {}, 'Signed in · private test session');
  const guestNote = el('p', { className: 'small muted', id: 'guest-note', hidden: '' }, ui('Guest history is temporary.'));
  const createFromGuest = button('Create account', async () => {
    if (model.state.submitting || model.state.attempt) return;
    signedIn = false; guestSession = false; authMode = 'register'; clearPasswords(); model.reset(); render();
    try { await client.logout(); } catch { /* Local tokens are already cleared. */ }
    firstName.focus();
  }, true); createFromGuest.id = 'guest-create-account';
  const accountBar = el('details', { className: 'account-bar', hidden: '' },
    el('summary', { className: 'account-summary' }, icon('user'), el('span', {}, accountLabel, el('small', {}, ui('Test mode'))), icon('chevron')),
    el('div', { className: 'account-dropdown' }, logout));
  const countrySearchInput = el('input', { id: 'country-search', type: 'search', 'aria-label': t('Search countries'), 'data-i18n-aria-label': 'Search countries', placeholder: t('Country, ISO code, or calling code'), 'data-i18n-placeholder': 'Country, ISO code, or calling code', autocomplete: 'off' });
  const country = el('select', { id: 'country', required: '', className: 'country-native-select', tabindex: '-1', 'aria-hidden': 'true' });
  const countryPickerButton = el('button', {
    id: 'country-picker-button', type: 'button', className: 'country-picker-button',
    'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': 'country-picker-list',
  }, t('Choose a country'));
  const countryPickerList = el('div', {
    id: 'country-picker-list', role: 'listbox', 'aria-labelledby': 'country-picker-button',
  });
  const countryPickerMenu = el('div', { id: 'country-picker-menu', className: 'country-picker-list', hidden: '' }, el('div', { className: 'country-picker-search-row' }, countrySearchInput), countryPickerList);
  const countryPicker = el('div', { className: 'country-picker' }, countryPickerButton, countryPickerMenu, country);
  const phone = el('input', { id: 'phone', type: 'tel', autocomplete: 'tel', maxlength: '40', 'aria-describedby': 'phone-hint', placeholder: t('mobileNumberPlaceholder'), 'data-i18n-placeholder': 'mobileNumberPlaceholder' });
  const operator = el('select', { id: 'operator' });
  const product = el('select', { id: 'product' });
  const amount = el('input', { id: 'amount', type: 'number', inputmode: 'decimal', step: '0.01', 'aria-describedby': 'amount-hint' });
  const amountHint = el('small', { id: 'amount-hint' });
  const amountField = el('div', { className: 'field', hidden: '' }, el('label', { for: 'amount' }, ui('Recharge amount')), amount, amountHint);
  const catalogNote = el('p', { className: 'small muted catalog-note', role: 'status' });
  const detectButton = button('Find my operator', action(() => model.detect()), true); detectButton.id = 'detect-operator';
  const operatorsRetry = button('Reload operators', action(() => model.loadOperators()), true);
  const quoteButton = button('Get quote →', action(() => model.getQuote())); quoteButton.id = 'get-quote';
  const countriesRetry = button('Retry connection', action(() => model.start()), true);
  const recipientsSelect = el('select', { id: 'saved-recipient' });
  const recipientNote = el('small', { role: 'status' });
  const recipientsPanel = el('details', { className: 'saved-recipients' }, el('summary', {}, icon('recipient'), ui('Use a saved recipient'), icon('chevron')),
    field('Saved recipient', recipientsSelect), recipientNote);
  const controlField = (label, control, symbol, hint) => {
    const wrapper = field(label, control, hint);
    const frame = el('div', { className: 'icon-input' }, icon(symbol));
    control.replaceWith(frame); frame.append(control); return wrapper;
  };
  const cardHeading = (symbol, label, title, id) => el('summary', { className: 'step-heading' },
    el('span', { className: 'card-icon' }, icon(symbol)),
    el('div', {}, el('span', { className: 'step' }, ui(label)), el('h2', id ? { id } : {}, ui(title))), icon('chevron', 'collapse-icon'));
  const destinationControls = el('fieldset', {}, el('legend', {}, ui('Destination')),
    el('div', { className: 'field' }, el('label', { for: 'country-picker-button' }, ui('Destination country')), countryPicker),
    controlField('Mobile number', phone, 'phone', 'Include the international country code. Check the number carefully before confirming.'), recipientsPanel);
  const operatorControls = el('fieldset', {}, el('legend', {}, ui('Operator & Product')),
    el('div', { className: 'operator-actions' }, detectButton, operatorsRetry),
    controlField('Mobile operator', operator, 'antenna'),
    controlField('Recharge product', product, 'gift'), amountField, catalogNote, quoteButton);
  const destinationPanel = el('details', { className: 'panel checkout-step', open: '', 'data-checkout-step': '1' },
    cardHeading('globe', '1. DESTINATION', 'Who are you recharging?'), destinationControls);
  const operatorPanel = el('details', { className: 'panel checkout-step', open: '', 'data-checkout-step': '2' },
    cardHeading('phone', '2. OPERATOR & PRODUCT', 'Choose their recharge.'), operatorControls);
  const reviewContent = el('div', { id: 'quote-details' });
  const expiry = el('p', { className: 'small', role: 'status', id: 'quote-expiry' });
  const reviewed = el('input', { type: 'checkbox', id: 'reviewed' });
  const reviewCheck = el('label', { className: 'review-check', for: 'reviewed' }, reviewed, el('span', {}, ui('I checked the phone number, operator, product, and quoted total.')));
  const confirmButton = button('Confirm test recharge', action(() => model.confirm())); confirmButton.id = 'confirm-recharge';
  const recoveryNote = el('p', { className: 'message', hidden: '', role: 'status', id: 'recovery-note' }, ui('Confirmation is unresolved. Keep this page open. Retry uses the same request so it cannot create a second recharge; you can also refresh history to find the receipt.'));
  const reviewPanel = el('details', { className: 'panel checkout-step review-panel', open: '', 'data-checkout-step': '3', 'aria-labelledby': 'review-title' },
    cardHeading('receipt', '3. REVIEW & CONFIRM', 'A little connection. A lot of care.', 'review-title'),
    reviewContent, expiry, reviewCheck, confirmButton, recoveryNote,
    el('p', { className: 'review-helper small muted' }, icon('info'), ui('TEST MODE · No real payment is collected. Prices, fees, and availability are supplied by TiCash.')));
  const selectionFields = el('div', { id: 'selection-fields', className: 'checkout-stack' }, destinationPanel, operatorPanel, reviewPanel);
  const receipt = el('section', { className: 'panel receipt', id: 'receipt', 'aria-live': 'polite', hidden: '' });
  const refreshReceipt = button('Refresh transaction status', action(() => model.refreshTransaction()), true); refreshReceipt.id = 'refresh-status';
  const historyList = el('div', { className: 'history-list', id: 'history-list' });
  const historyError = el('p', { role: 'status', className: 'message error', hidden: '' });
  const historyRefresh = button('Refresh history', action(() => model.loadHistory()), true); historyRefresh.id = 'refresh-history';
  const historyIntro = el('p', { className: 'small muted' });
  historyRefresh.setAttribute('aria-label', t('Refresh history')); historyRefresh.setAttribute('data-i18n-aria-label', 'Refresh history');
  historyRefresh.removeAttribute('data-i18n');
  historyRefresh.replaceChildren(icon('refresh'), ui('Refresh'));
  operatorsRetry.removeAttribute('data-i18n');
  operatorsRetry.replaceChildren(icon('refresh'), ui('Reload operators'));
  const historyPanel = el('section', { className: 'panel history-panel' },
    el('div', { className: 'section-heading' }, el('div', { className: 'history-heading' }, el('span', { className: 'card-icon' }, icon('clock')), el('div', {}, el('span', { className: 'step' }, ui('YOUR ACTIVITY')), el('h2', {}, ui('Test recharge history')))), historyRefresh),
    historyIntro, guestNote, historyError, historyList);
  const progressItems = ['Destination', 'Operator & Product', 'Review & Confirm'].map((label, index) =>
    el('li', { 'data-step': String(index + 1) }, el('span', { className: 'progress-number', 'aria-hidden': 'true' }, String(index + 1)), ui(label)));
  const progress = el('ol', { className: 'checkout-progress', 'aria-label': t('Recharge progress'), 'data-i18n-aria-label': 'Recharge progress' }, progressItems);
  const checkout = el('div', { id: 'checkout', hidden: '' }, progress, countriesRetry, selectionFields, receipt, historyPanel);
  const menu = el('nav', { id: 'recharge-navigation', className: 'recharge-navigation', hidden: '', 'aria-label': t('navigation'), 'data-i18n-aria-label': 'navigation' },
    el('a', { href: '/' }, ui('homeLabel')), el('a', { href: '/send' }, ui('sendMoney')), el('a', { href: '/recharge', 'aria-current': 'page' }, ui('mobileRecharge')), el('a', { href: '/support' }, ui('support')));
  const menuButton = el('button', { id: 'recharge-menu-toggle', type: 'button', className: 'menu-toggle', 'aria-label': t('navigation'), 'data-i18n-aria-label': 'navigation', 'aria-expanded': 'false', 'aria-controls': 'recharge-navigation', onclick: () => {
    menu.hidden = !menu.hidden; menuButton.setAttribute('aria-expanded', String(!menu.hidden));
  } }, icon('menu'));
  const closeMenus = (event) => {
    if (event.key !== 'Escape') return;
    if (accountBar.open) { accountBar.open = false; accountBar.querySelector('summary').focus(); }
    else if (!menu.hidden) { menu.hidden = true; menuButton.setAttribute('aria-expanded', 'false'); menuButton.focus(); }
  };
  const hero = el('section', { className: 'checkout-hero', hidden: '' },
    el('div', { className: 'recharge-topbar' }, el('div', { className: 'recharge-brand-group' }, menuButton,
      el('a', { className: 'brand recharge-wordmark', href: '/', 'aria-label': t('homeLabel'), 'data-i18n-aria-label': 'homeLabel' },
        el('span', { className: 'wordmark-ti' }, 'Ti'), el('span', { className: 'wordmark-cash' }, 'Cash'))), accountBar),
    menu, el('h1', {}, ui('Mobile Recharge')), el('p', {}, ui('Stay connected, wherever they are.')));
  hero.addEventListener('keydown', closeMenus);
  const siteHeader = root.ownerDocument.querySelector('header');
  const headerLanguage = root.ownerDocument.getElementById('header-language')?.closest('label');
  const originalHeaderHidden = siteHeader?.hidden;
  const testTitle = el('strong'); const testText = el('span');
  const testIcon = el('span', { className: 'test-icon' }, icon('flask'));
  const testBanner = el('div', { className: 'test-banner', role: 'note' }, testIcon,
    el('div', { className: 'test-copy' }, testTitle, testText), createFromGuest);
  root.replaceChildren(hero, testBanner, error, notice, loginPanel, checkout);

  function render() {
    if (disposed || !model) return;
    translateElements(root);
    syncLanguageSelectors(root.ownerDocument);
    loginError.textContent = t(loginErrorMessage);
    for (const { input, toggle, label } of passwordControls) {
      const verb = input.type === 'text' ? 'Hide' : 'Show';
      toggle.textContent = t(verb);
      toggle.setAttribute('aria-label', t(`${verb} ${label.toLowerCase()}`));
    }
    const s = model.state; const busy = model.busy;
    hero.hidden = !signedIn;
    root.classList.toggle('recharge-active', signedIn);
    testIcon.hidden = !signedIn;
    if (siteHeader) siteHeader.hidden = signedIn || originalHeaderHidden;
    if (headerLanguage) {
      const languageParent = signedIn ? menu : siteHeader;
      if (headerLanguage.parentElement !== languageParent) languageParent.append(headerLanguage);
    }
    if (!signedIn) { menu.hidden = true; menuButton.setAttribute('aria-expanded', 'false'); accountBar.open = false; }
    testTitle.textContent = t(signedIn ? 'You’re in test mode' : 'TEST MODE');
    testText.textContent = t(signedIn ? 'No real payment is collected.' : 'No real money · No live recharge');
    let destinationComplete = false;
    try { model.normalizedPhone(); destinationComplete = Boolean(s.country); } catch { /* A prefix alone is not a complete destination. */ }
    const currentStep = s.quote || s.attempt || s.transaction ? 3 : destinationComplete ? 2 : 1;
    progressItems.forEach((item, index) => {
      if (index + 1 === currentStep) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
      item.dataset.complete = String(index + 1 < currentStep);
    });
    historyIntro.textContent = t('Your recent test recharges.'); historyIntro.hidden = guestSession;
    const recovering = ['forgot', 'reset'].includes(authMode);
    loginTitle.textContent = t(authMode === 'forgot' ? 'Forgot your password?' : authMode === 'reset' ? 'Reset your password' : authMode === 'register' ? 'Create TiCash account' : 'Sign in to TiCash');
    loginIntro.textContent = t(authMode === 'forgot' ? 'Enter your email to request reset instructions.' : authMode === 'reset' ? 'Choose a new password for your TiCash account.' : authMode === 'register' ? 'authRegisterIntro' : 'Sign in to continue your mobile recharge.');
    authChoices.hidden = recovering; guestButton.hidden = recovering; backToLogin.hidden = !recovering;
    forgotForm.hidden = authMode !== 'forgot'; resetForm.hidden = authMode !== 'reset';
    recoveryStatus.textContent = t(recoveryMessage); recoveryStatus.hidden = !recoveryMessage;
    forgotSubmit.textContent = t(signingIn ? 'Sending…' : 'Send reset instructions');
    resetSubmit.textContent = t(signingIn ? 'Resetting…' : 'Reset password');
    forgotSubmit.disabled = !configured || signingIn; resetSubmit.disabled = !configured || signingIn || !validResetToken();
    backToLogin.disabled = signingIn; forgotLink.disabled = signingIn;
    for (const control of [forgotEmail, newPassword, confirmPassword]) control.disabled = signingIn;
    loginPanel.hidden = signedIn; accountBar.hidden = !signedIn; checkout.hidden = !signedIn;
    loginForm.hidden = authMode !== 'login'; registerForm.hidden = authMode !== 'register';
    accountLabel.textContent = t(guestSession ? 'Guest' : 'Signed in');
    guestNote.hidden = !guestSession; createFromGuest.hidden = !guestSession;
    createFromGuest.disabled = s.submitting || Boolean(s.attempt);
    for (const control of [registerButton, signInChoice, registerChoice, guestButton]) control.disabled = !configured || signingIn;
    for (const control of [email, password, firstName, lastName, registerEmail, registerPassword]) control.disabled = signingIn;
    signInChoice.setAttribute('aria-pressed', String(authMode === 'login'));
    registerChoice.setAttribute('aria-pressed', String(authMode === 'register'));
    guestButton.textContent = t(signingIn && authMode === 'guest' ? 'Starting guest session…' : 'Continue as guest');
    registerButton.textContent = t(signingIn && authMode === 'register' ? 'Creating account…' : 'Create TiCash account');
    loginButton.disabled = !configured || signingIn;
    loginButton.textContent = t(signingIn ? 'Signing in…' : 'Sign in');
    error.textContent = t(s.error); error.hidden = !s.error;
    notice.textContent = t(s.notice); notice.hidden = !s.notice;
    const locked = s.submitting || Boolean(s.attempt);
    destinationControls.disabled = !s.ready || locked;
    operatorControls.disabled = !s.ready || locked;
    countriesRetry.hidden = s.ready; countriesRetry.disabled = busy.has('catalog');
    countriesRetry.textContent = t(busy.has('catalog') ? 'Connecting…' : 'Retry connection');
    const matches = searchCountries(s.countries, countrySearch);
    // Keep a selected country visible even while the search is being refined.
    const selectedCountry = s.countries.find((c) => c.code === s.country);
    if (selectedCountry && !matches.includes(selectedCountry)) matches.unshift(selectedCountry);
    // Keep the hidden native select synchronized for model/test compatibility,
    // while the visible picker uses local SVG assets. This avoids Windows/Chrome
    // rendering Unicode regional indicators as two-letter country codes.
    options(country, matches, s.country, t(matches.length ? 'Choose a country' : 'No matching countries'), (c) => `${countryFlag(c.code)} ${localizeCountry(c)} (${c.callingCode})`.trim(), (c) => c.code);
    countryPickerButton.disabled = !s.ready || locked;
    countryPickerButton.setAttribute('aria-expanded', String(countryMenuOpen));
    if (selectedCountry) {
      countryPickerButton.replaceChildren(
        countryFlagImage(selectedCountry),
        el('span', { className: 'country-picker-name' }, `${localizeCountry(selectedCountry)} (${selectedCountry.callingCode})`),
        el('span', { className: 'country-picker-code' }, selectedCountry.callingCode),
      );
    } else {
      countryPickerButton.replaceChildren(
        el('span', { className: 'country-picker-flag country-picker-flag-placeholder', 'aria-hidden': 'true' }),
        el('span', { className: 'country-picker-name' }, t(matches.length ? 'Choose a country' : 'No matching countries')),
        el('span', { className: 'country-picker-code' }, ''),
      );
    }

    const visualCountryOptions = matches.map((candidate) => {
      const option = el('button', {
        type: 'button', className: 'country-picker-option', role: 'option',
        'aria-selected': String(candidate.code === s.country), 'data-country-code': candidate.code,
      },
        countryFlagImage(candidate),
        el('span', { className: 'country-picker-name' }, localizeCountry(candidate)),
        el('span', { className: 'country-picker-code' }, `${candidate.code} · ${candidate.callingCode}`),
      );
      option.addEventListener('click', action(async () => {
        countryMenuOpen = false;
        countrySearch = '';
        countrySearchInput.value = '';
        await model.selectCountry(candidate.code);
        countryPickerButton.focus();
      }));
      return option;
    });
    countryPickerList.replaceChildren(...visualCountryOptions);
    countryPickerMenu.hidden = !countryMenuOpen;

    root.querySelector('#phone-hint').textContent = selectedCountry
      ? t('phoneHint', { flag: countryFlag(selectedCountry.code), country: localizeCountry(selectedCountry), code: selectedCountry.callingCode }).trim()
      : t('Choose a country to prepare its international calling code. Check the full number before confirming.');
    if (phone.value !== s.phone) phone.value = s.phone;
    phone.disabled = !s.country;
    options(operator, s.operators, s.operator?.id, t(busy.has(`operators:${s.country}`) ? 'Loading operators…' : 'Choose an operator'), (op) => op.name, (op) => op.id);
    operator.disabled = !s.country || !s.phone;
    detectButton.disabled = !s.country || !s.phone || busy.has('detect');
    detectButton.removeAttribute('data-i18n');
    detectButton.replaceChildren(icon('search'), el('span', {}, t(busy.has('detect') ? 'Finding operator…' : 'Find my operator')));
    operatorsRetry.disabled = !s.country || busy.has(`operators:${s.country}`);
    options(product, s.products, s.product?.id, t('Choose a product'), (p) => p.amountType === 'RANGE'
      ? `${p.name} · ${money(p.minimumAmount, p.priceCurrency)}–${money(p.maximumAmount, p.priceCurrency)}`
      : `${p.name} · ${money(p.price, p.priceCurrency)}`, (p) => p.id);
    product.disabled = !s.operator || !s.products.length;
    amountField.hidden = s.product?.amountType !== 'RANGE';
    if (s.product?.amountType === 'RANGE') {
      amount.min = s.product.minimumAmount; amount.max = s.product.maximumAmount;
      amountHint.textContent = t('rangeHint', { min: money(s.product.minimumAmount, s.product.priceCurrency), max: money(s.product.maximumAmount, s.product.priceCurrency) });
    }
    if (amount.value !== s.amount) amount.value = s.amount;
    catalogNote.textContent = t(busy.has(`operators:${s.country}`) ? 'Loading available operators…'
      : [...busy].some((name) => name.startsWith('products:')) ? 'Loading available products…'
      : s.operator && !s.products.length ? 'No products loaded. Select the operator again to retry, or choose another operator.'
      : s.country && !s.operators.length ? 'No operators loaded for this country. Try reloading operators or choose another destination.'
      : !s.countries.length && s.ready ? 'No destinations are currently available. Please try again later.' : 'Only currently returned catalog products are shown.');
    quoteButton.disabled = !s.product || busy.has('quote');
    quoteButton.textContent = t(busy.has('quote') ? 'Getting quote…' : 'Get quote →');
    options(recipientsSelect, s.recipients, '', t('Choose a saved recipient'), (r) => `${r.nickname} · ${r.phone} · ${r.countryCode}`, (r) => r.id);
    recipientNote.textContent = t(s.recipientsError || (s.recipients.length ? 'Availability is checked again before you get a quote.' : 'No saved recipients. You can enter a number above.'));
    const nextQuoteSignature = JSON.stringify([s.quote, getLanguage()]);
    if (quoteSignature !== nextQuoteSignature) {
      quoteSignature = nextQuoteSignature;
      reviewContent.replaceChildren(s.quote ? details([
        ['Recipient', s.quote.recipientPhone], ['Country', `${localizeCountry(s.countries.find(c => c.code === s.quote.countryCode) || {code:s.quote.countryCode,name:s.quote.countryCode})} (${s.quote.countryCode})`], ['Operator', s.quote.operatorName],
        ['Product', s.quote.productName], ['Recharge amount', money(s.quote.providerAmount, s.quote.providerCurrency)],
        ['TiCash fee', money(s.quote.feeUsd, 'USD')], ['Total', money(s.quote.totalChargeUsd, 'USD')],
      ]) : el('div', { className: 'review-empty' }, icon('chart'), el('strong', {}, ui('Your quote will appear here.')), el('p', { className: 'small muted' }, ui('quoteEmptyInstruction'))));
    }
    expiry.textContent = s.quote ? (model.quoteValid() ? t('quoteUntil', { date: date(s.quote.expiresAt) }) : t('This quote expired. Get a new quote before confirming.')) : '';
    reviewCheck.hidden = !s.quote || Boolean(s.attempt); reviewed.checked = s.reviewed;
    reviewed.disabled = !model.quoteValid() || locked;
    confirmButton.disabled = s.submitting || Boolean(s.transaction) || (!s.attempt && (!s.reviewed || !model.quoteValid()));
    confirmButton.textContent = t(s.submitting ? 'Confirming…' : s.attempt ? 'Retry same confirmation' : 'Confirm test recharge');
    recoveryNote.hidden = !s.attempt || s.submitting;
    const nextReceiptSignature = JSON.stringify([s.transaction, getLanguage()]);
    if (receiptSignature !== nextReceiptSignature) {
      receiptSignature = nextReceiptSignature; receipt.hidden = !s.transaction;
      if (s.transaction) {
        const txn = s.transaction;
        receipt.replaceChildren(el('span', { className: 'eyebrow' }, ui('TEST RECEIPT')), el('h2', {}, t('receiptHeading', { status: t(String(txn.status || 'pending').toLowerCase()) })),
          el('p', { className: 'muted' }, ui('This is a test transaction. No real money or airtime was transferred.')),
          details([['Reference', txn.id], ['Status', txn.status], ['Test payment status', txn.paymentStatus], ['Phone number', txn.recipientPhone],
            ['Destination', `${countryFlag(txn.countryCode)} ${txn.countryCode}`.trim()], ['Operator', txn.operatorName], ['Product', txn.productName],
            ['Recharge', money(txn.providerAmount, txn.providerCurrency)], ['Fee', money(txn.feeUsd, 'USD')], ['Total', money(txn.totalChargeUsd, 'USD')],
            ['Recipient value', txn.deliveredValue === undefined ? t('Awaiting confirmation') : money(txn.deliveredValue, txn.deliveredCurrency)],
            ['Updated', date(txn.updatedAt)], ...(txn.failureCode ? [['Failure reason', txn.failureCode]] : [])]), refreshReceipt);
      } else receipt.replaceChildren();
    }
    refreshReceipt.disabled = busy.has('receipt');
    historyRefresh.disabled = busy.has('history');
    historyError.textContent = t(s.historyError); historyError.hidden = !s.historyError;
    const nextHistorySignature = JSON.stringify([getLanguage(), s.history, locked, busy.has('repeat'), busy.has('receipt')]);
    if (historySignature !== nextHistorySignature) {
      historySignature = nextHistorySignature;
      historyList.replaceChildren(...(s.history.length ? s.history.map((txn) => {
        const view = button('View / refresh', action(() => model.refreshTransaction(txn.id)), true);
        const repeat = button('Repeat recharge', action(() => model.repeat(txn.id)), true);
        view.disabled = locked || busy.has('receipt'); repeat.disabled = locked || busy.has('repeat');
        return el('article', { className: 'history-item' },
          el('div', {}, el('strong', {}, txn.productName), el('p', {}, `${txn.recipientPhone} · ${txn.countryCode}`), el('small', {}, date(txn.createdAt))),
          el('div', {}, el('span', { className: 'status-pill' }, String(txn.status)), el('p', {}, money(txn.totalChargeUsd, 'USD'))),
          el('div', { className: 'compact-actions' }, view, repeat));
      }) : [busy.has('history') ? el('p', { className: 'muted' }, t('Loading your history…')) : el('div', { className: 'history-empty' }, icon('receipt'), el('strong', {}, ui('historyEmptyTitle')), el('p', { className: 'small muted' }, ui('historyEmptyInstruction')))]));
    }
  }
  const expired = () => {
    signedIn = false; guestSession = false; clearPasswords(); model?.reset(); render();
    setLoginError('Your session expired or account access changed. Sign in again, then check history before repeating a recharge.');
  };
  try {
    if (config.mobileRechargeLive !== false) throw new Error('This checkout supports test mode only.');
    client = dependencies.api || createApiClient({ baseUrl: apiBaseUrl(config.apiBaseUrl), onSessionExpired: expired });
  } catch (error) {
    configured = false; setLoginError(error.message);
  }
  model = new Recharge(client, { ...dependencies, onChange: render });
  async function authenticate(mode) {
    if (signingIn || !configured) return;
    const form = mode === 'register' ? registerForm : loginForm;
    if (mode !== 'guest' && !form.reportValidity()) return;
    authMode = mode === 'guest' ? 'guest' : mode;
    signingIn = true; loginError.hidden = true; render();
    try {
      if (mode === 'guest') await client.guest();
      else if (mode === 'register') await client.register({ firstName: firstName.value.trim(), lastName: lastName.value.trim(), email: registerEmail.value.trim(), password: registerPassword.value });
      else await client.login(email.value.trim(), password.value);
      clearPasswords(); signedIn = true; guestSession = mode === 'guest'; model.reset();
      if (mode === 'register') model.state.notice = 'Your TiCash account was created.';
      render();
      // Fixed local destination; user-supplied return URLs are never used.
      if (globalThis.location?.pathname.startsWith('/login')) globalThis.history.replaceState(null, '', '/recharge');
      await model.start();
    } catch (error) { clearPasswords(); setLoginError(error.message); }
    finally { if (authMode === 'guest') authMode = 'login'; signingIn = false; render(); }
  }
  loginForm.addEventListener('submit', (event) => { event.preventDefault(); void authenticate('login'); });
  registerForm.addEventListener('submit', (event) => { event.preventDefault(); void authenticate('register'); });
  forgotForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!configured || signingIn || !forgotForm.reportValidity()) return;
    signingIn = true; loginError.hidden = true; recoveryMessage = ''; render();
    try {
      await client.forgotPassword(forgotEmail.value.trim());
      recoveryMessage = 'If an account exists for this email, we sent password reset instructions.';
    } catch { setLoginError('Unable to request reset instructions. Please try again later.'); }
    finally { signingIn = false; render(); }
  });
  resetForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!configured || signingIn || !validResetToken() || !resetForm.reportValidity()) return;
    if (newPassword.value !== confirmPassword.value) { setLoginError('Passwords do not match.'); return; }
    signingIn = true; loginError.hidden = true; render();
    try {
      await client.resetPassword(resetToken, newPassword.value);
      resetToken = ''; clearPasswords(); authMode = 'login';
      recoveryMessage = 'Password updated. Sign in with your new password.';
      pageWindow.history.replaceState(null, '', '/recharge'); email.focus();
    } catch (error) {
      setLoginError(error.code === 'INVALID_PASSWORD' ? 'New password must be different from the current password' :
        error.code === 'INVALID_RESET_TOKEN' ? 'This reset link is invalid or expired. Request a new link.' : 'Unable to reset your password. Please try again.');
    } finally { signingIn = false; render(); if (authMode === 'login') email.focus(); }
  });
  if (isResetRoute && !validResetToken()) setLoginError('This reset link is invalid or expired. Request a new link.');
  countrySearchInput.addEventListener('input', () => {
    countrySearch = countrySearchInput.value;
    countryMenuOpen = true;
    render();
  });
  countryPickerButton.addEventListener('click', () => {
    if (countryPickerButton.disabled) return;
    countryMenuOpen = !countryMenuOpen;
    render();
    if (countryMenuOpen) queueMicrotask(() => {
      countrySearchInput.focus();
    });
  });
  countryPickerButton.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    countryMenuOpen = true;
    render();
    queueMicrotask(() => countryPickerList.querySelector('[aria-selected="true"], .country-picker-option')?.focus());
  });
  countryPickerMenu.addEventListener('keydown', (event) => {
    const options = [...countryPickerList.querySelectorAll('.country-picker-option')];
    if (event.key === 'Escape') {
      event.preventDefault();
      countryMenuOpen = false;
      render();
      countryPickerButton.focus();
      return;
    }
    if (event.target === countrySearchInput && ['Home', 'End'].includes(event.key)) return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !options.length) return;
    event.preventDefault();
    const current = options.indexOf(root.ownerDocument.activeElement);
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else if (event.key === 'ArrowDown') next = Math.min(options.length - 1, current < 0 ? 0 : current + 1);
    else next = Math.max(0, current < 0 ? options.length - 1 : current - 1);
    options[next]?.focus();
  });
  const closeCountryPicker = (event) => {
    if (!countryMenuOpen || event.composedPath().includes(countryPicker)) return;
    countryMenuOpen = false;
    render();
  };
  root.ownerDocument.addEventListener('click', closeCountryPicker);
  country.addEventListener('change', action(() => model.selectCountry(country.value)));
  phone.addEventListener('input', action(() => model.setPhone(phone.value)));
  operator.addEventListener('change', action(() => model.selectOperator(operator.value)));
  product.addEventListener('change', action(() => model.selectProduct(product.value)));
  amount.addEventListener('input', action(() => model.setAmount(amount.value)));
  reviewed.addEventListener('change', () => model.review(reviewed.checked));
  recipientsSelect.addEventListener('change', action(() => model.useRecipient(recipientsSelect.value)));
  const pageHide = () => { resetToken = ''; client?.clear(); signedIn = false; guestSession = false; clearPasswords(); model.reset(); render(); };
  globalThis.addEventListener?.('pagehide', pageHide);
  const timer = setInterval(() => { if (signedIn && model.state.quote) render(); }, 1000);
  const removeLanguageListener = onLanguageChange(render);
  render();
  return { model, dispose() { if (siteHeader) siteHeader.hidden = originalHeaderHidden; if (headerLanguage && siteHeader) siteHeader.append(headerLanguage); root.classList.remove('recharge-active'); resetToken = ''; disposed = true; removeLanguageListener(); removeLanguageHeader(); clearInterval(timer); root.ownerDocument.removeEventListener('click', closeCountryPicker); globalThis.removeEventListener?.('pagehide', pageHide); client?.clear(); } };
}

const root = typeof document === 'undefined' ? null : document.querySelector('[data-recharge-root]');
if (root) mountRecharge(root, globalThis.TICASH_PUBLIC_CONFIG || {});
