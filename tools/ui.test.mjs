import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountRecharge } from '../js/recharge-page.js';
import { t, translations, languageLocale } from '../js/i18n.js';
import { ApiError } from '../js/api-client.js';
import { fixtureApi, operator, products, quote, transaction } from './fixtures.mjs';
const tick = () => new Promise((r) => setTimeout(r, 0));

async function page(callback, { api = fixtureApi(), config = { mobileRechargeLive: false } } = {}) {
  const dom = new JSDOM('<header><nav><a data-i18n="mobileRecharge">Mobile Recharge</a></nav></header><main id="root"></main>', { url: 'https://website.example/recharge' });
  globalThis.document = dom.window.document;
  const root = document.getElementById('root'); const app = mountRecharge(root, config, { api });
  const query = (selector) => root.querySelector(selector);
  const input = (selector, value, type = 'input') => { const node = query(selector); node.value = value; node.dispatchEvent(new dom.window.Event(type, { bubbles: true })); };
  const login = async () => {
    input('#email', 'tester@example.com'); input('#password', 'test-password');
    query('#login-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true })); await tick();
  };
  try { await callback({ dom, app, api, root, query, input, login }); }
  finally { app.dispose(); dom.window.close(); delete globalThis.document; }
}

test('UI renders TEST MODE, legitimate sign-in and no card inputs', async () => page(async ({ query, root, login }) => {
  assert.match(root.textContent, /TEST MODE/); assert.equal(query('#checkout').hidden, true);
  assert.equal(root.querySelectorAll('input[type=password]').length, 2);
  assert.doesNotMatch(root.textContent, /CVV|card number/i);
  await login(); assert.equal(query('#checkout').hidden, false); assert.equal(query('#password').value, '');
}));
test('UI completes country search, manual selection, quote, review, confirm and receipt refresh', async () => page(async ({ query, input, login, root }) => {
  await login(); input('#country-search', 'jam'); assert.equal(query('#country').options.length, 2);
  input('#country', 'JM', 'change'); await tick(); input('#phone', '+18765551234');
  input('#operator', String(operator.id), 'change'); await tick(); input('#product', products[0].id, 'change');
  query('#get-quote').click(); await tick();
  assert.match(query('#quote-details').textContent, /8\.00/); assert.equal(query('#confirm-recharge').disabled, true);
  query('#reviewed').click(); assert.equal(query('#confirm-recharge').disabled, false);
  query('#confirm-recharge').click(); await tick();
  assert.equal(query('#receipt').hidden, false); assert.match(query('#receipt').textContent, /PROCESSING/);
  query('#refresh-status').click(); await tick(); assert.match(query('#receipt').textContent, /DELIVERED/);
  assert.equal(root.querySelectorAll('.history-item').length, 1);
}));
test('UI clears quote immediately when phone changes and displays range input', async () => page(async ({ app, query, input, login }) => {
  await login(); await app.model.selectCountry('JM'); app.model.setPhone(quote.recipientPhone);
  await app.model.selectOperator(77); app.model.selectProduct(products[1].id);
  assert.equal(query('#amount').parentElement.hidden, false);
  input('#amount', '12.5'); await app.model.getQuote(); assert.ok(app.model.state.quote);
  input('#phone', '+16135551234'); assert.equal(app.model.state.quote, null); assert.match(query('#quote-details').textContent, /will appear/);
}));
test('untrusted provider strings, errors and history never become HTML', async () => {
  const attack = '<img src=x onerror=alert(1)>';
  const api = fixtureApi(); api.overrides.set('GET /mobile-topups/countries', () => ({ countries: [{ code: 'JM', name: attack, callingCode: '+1' }] }));
  api.overrides.set('GET /mobile-topups/transactions', () => ({ transactions: [{ ...transaction, productName: attack }] }));
  await page(async ({ login, app, root }) => {
    await login(); app.model.state.error = attack; app.model.emit();
    assert.equal(root.querySelectorAll('[onerror], img[src=x]').length, 0); assert.match(root.textContent, /<img src=x/);
  }, { api });
});
test('signout wipes quote, phone, receipt and history', async () => page(async ({ login, app, query }) => {
  await login(); await app.model.selectCountry('JM'); app.model.setPhone(quote.recipientPhone);
  app.model.state.transaction = transaction; app.model.emit(); query('#sign-out').click(); await tick();
  assert.equal(query('#checkout').hidden, true); assert.equal(app.model.state.phone, ''); assert.deepEqual(app.model.state.history, []);
  assert.equal(query('#receipt').textContent, '');
}));
test('blank API config and live config disable login without any network', async () => {
  for (const config of [{ mobileRechargeLive: false, apiBaseUrl: '' }, { mobileRechargeLive: true, apiBaseUrl: 'https://test.example/api' }]) {
    const dom = new JSDOM('<main id="root"></main>', { url: 'https://website.example/recharge' }); globalThis.document = dom.window.document;
    const app = mountRecharge(document.getElementById('root'), config);
    try { assert.equal(document.querySelector('button[type=submit]').disabled, true); assert.equal(document.querySelector('#checkout').hidden, true); }
    finally { app.dispose(); dom.window.close(); delete globalThis.document; }
  }
});

test('sign-in and registration have accessible keyboard buttons that show/hide passwords', async () => page(async ({ query, input }) => {
  for (const [field, toggle, label] of [['#password', '#password-visibility', 'password'], ['#register-password', '#register-password-visibility', 'account password']]) {
    if (field.includes('register')) query('#choose-register').click();
    input(field, 'test-password'); assert.equal(query(field).type, 'password');
    assert.equal(query(toggle).type, 'button'); assert.equal(query(toggle).tabIndex, 0);
    assert.equal(query(toggle).getAttribute('aria-label'), `Show ${label}`);
    query(toggle).click(); assert.equal(query(field).type, 'text'); assert.equal(query(field).value, 'test-password');
    assert.equal(query(toggle).getAttribute('aria-pressed'), 'true');
    query(toggle).click(); assert.equal(query(field).type, 'password');
  }
  query('#choose-login').click(); assert.equal(query('#register-password').value, '');
}));

test('registration creates an account, automatically enters checkout and clears passwords', async () => {
  const api = fixtureApi(); let sent;
  api.register = async (data) => { sent = data; return { id: 'new-customer' }; };
  await page(async ({ dom, query, input, root }) => {
    query('#choose-register').click(); assert.equal(query('#register-form').hidden, false);
    input('#first-name', 'Ti'); input('#last-name', 'Cash'); input('#register-email', 'new@example.com'); input('#register-password', 'test-password');
    query('#register-password-visibility').click();
    query('#register-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
    assert.deepEqual(sent, { firstName: 'Ti', lastName: 'Cash', email: 'new@example.com', password: 'test-password' });
    assert.equal(query('#checkout').hidden, false); assert.equal(query('#register-password').value, ''); assert.equal(query('#register-password').type, 'password');
    assert.match(root.textContent, /Your TiCash account was created\./); assert.match(root.textContent, /Signed in · private test session/);
  }, { api });
});

test('guest enters protected checkout, sees temporary history notice and can choose a permanent account', async () => {
  const api = fixtureApi(); let guests = 0; let logouts = 0;
  api.guest = async () => { guests++; return { role: 'CUSTOMER' }; }; api.logout = async () => { logouts++; };
  await page(async ({ query, root }) => {
    query('#continue-guest').click(); query('#continue-guest').click(); await tick();
    assert.equal(guests, 1); assert.equal(query('#checkout').hidden, false);
    assert.match(root.textContent, /Guest · private test session/); assert.equal(query('#guest-note').hidden, false);
    assert.match(query('#guest-note').textContent, /Guest history is temporary/);
    assert.ok(api.calls.some((c) => c.path === '/mobile-topups/countries'));
    query('#guest-create-account').click(); await tick();
    assert.equal(logouts, 1); assert.equal(query('#checkout').hidden, true); assert.equal(query('#register-form').hidden, false);
  }, { api });
});

test('destination labels, search and phone hints show backend calling codes and replace previous prefixes', async () => page(async ({ login, query, input }) => {
  await login(); assert.ok([...query('#country').options].some((o) => o.textContent === '🇭🇹 Haiti (+509)'));
  input('#country-search', '509'); assert.equal(query('#country').options.length, 2); assert.equal(query('#country').options[1].value, 'HT');
  input('#country', 'HT', 'change'); await tick(); assert.equal(query('#phone').value, '+509'); assert.match(query('#phone-hint').textContent, /calling code: \+509/);
  input('#phone', '+50937050210'); input('#country-search', ''); input('#country', 'FR', 'change'); await tick();
  assert.equal(query('#phone').value, '+33'); assert.match(query('#phone-hint').textContent, /calling code: \+33/);
}));

test('quote displays a backend 3.50 fee and 8.50 total without deriving charges', async () => {
  const api = fixtureApi(); api.overrides.set('POST /mobile-topups/quotes', () => ({ quote: { ...quote, providerAmount: 5, feeUsd: 3.5, totalChargeUsd: 8.5 } }));
  await page(async ({ app, query, login }) => {
    await login(); await app.model.selectCountry('JM'); app.model.setPhone(quote.recipientPhone); await app.model.selectOperator(77);
    app.model.selectProduct(products[0].id); await app.model.getQuote();
    assert.match(query('#quote-details').textContent, /TiCash fee\$3\.50/); assert.match(query('#quote-details').textContent, /Quoted total\$8\.50/);
  }, { api });
});

test('all language selectors synchronize translated UI, ISO labels, search, hints and keyboard focus', async () => page(async ({ login, query, input, dom, api }) => {
  await login(); input('#country','HT','change'); await tick(); input('#country-search','Ayiti');
  const calls = structuredClone(api.calls); const url = dom.window.location.href;
  const names = { en:'Haiti',ht:'Ayiti',fr:'Haïti',es:'Haití',pt:'Haiti' };
  for (const code of ['ht','fr','es','pt','en']) {
    const picker = query('#recharge-language'); picker.focus(); input('#recharge-language',code,'change');
    assert.equal(dom.window.document.activeElement,picker);
    assert.equal(dom.window.document.documentElement.lang,code);
    assert.equal(dom.window.document.querySelector('#header-language').value,code);
    assert.equal(dom.window.document.querySelector('header a').textContent,t('mobileRecharge'));
    assert.equal(query('#get-quote').textContent,t('getQuote'));
    assert.equal(query('#country').value,'HT'); assert.equal(query('#country').options.length,2);
    assert.equal(query('#country').selectedOptions[0].textContent,`🇭🇹 ${names[code]} (+509)`);
    assert.match(query('#phone-hint').textContent,/🇭🇹/); assert.match(query('#phone-hint').textContent,/\+509/);
    assert.equal(query('#country-search').value,'Ayiti'); assert.equal(query('#phone').value,'+509');
    assert.deepEqual(api.calls,calls); assert.equal(dom.window.location.href,url);
    assert.equal(dom.window.localStorage.length,1); assert.equal(dom.window.localStorage.key(0),'ticash.language');
    assert.equal(dom.window.localStorage.getItem('ticash.language'),code);
    assert.equal(dom.window.sessionStorage.length,0);
  }
  const headerPicker=dom.window.document.querySelector('#header-language'); headerPicker.value='fr'; headerPicker.dispatchEvent(new dom.window.Event('change'));
  assert.equal(query('#recharge-language').value,'fr');
  for (const picker of dom.window.document.querySelectorAll('[data-language-selector]')) {
    assert.equal(picker.options.length,5); assert.ok(picker.labels.length); assert.equal(picker.tabIndex,0);
    assert.doesNotMatch(picker.textContent,/\p{Regional_Indicator}/u);
  }
}));

for (const session of ['account','guest']) test(`${session} language switches preserve exact quote, selections, reviewed state and authentication without requests`, async () => {
  const api=fixtureApi(); let authCalls=0;
  api.login=api.guest=async()=>{authCalls++;return {id:'fixture-customer'};};
  api.overrides.set('POST /mobile-topups/quotes',()=>({quote:{...quote,providerAmount:5,feeUsd:3.5,totalChargeUsd:8.5}}));
  await page(async ({login,app,query,input,dom})=>{
    if(session==='guest'){query('#continue-guest').click();await tick();} else await login();
    await app.model.selectCountry('JM'); app.model.setPhone(quote.recipientPhone); await app.model.selectOperator(77);
    app.model.selectProduct(products[0].id); await app.model.getQuote(); app.model.review(true);
    const state=structuredClone(app.model.state); const quoteObject=app.model.state.quote; const calls=structuredClone(api.calls);
    for(const code of ['ht','fr','es','pt','en']) {
      input('#recharge-language',code,'change');
      assert.deepEqual(app.model.state,state); assert.equal(app.model.state.quote,quoteObject); assert.deepEqual(api.calls,calls); assert.equal(authCalls,1);
      assert.equal(query('#checkout').hidden,false); assert.equal(query('#guest-note').hidden,session!=='guest');
      assert.equal(query('#country').value,'JM'); assert.equal(query('#phone').value,quote.recipientPhone);
      assert.equal(query('#operator').value,'77'); assert.equal(query('#product').value,products[0].id);
      assert.equal(query('#reviewed').checked,true); assert.equal(query('#confirm-recharge').disabled,false);
      assert.match(query('#quote-details').textContent,/🇯🇲 JM/);
      for(const value of [3.5,8.5]) assert.ok(query('#quote-details').textContent.includes(new Intl.NumberFormat(languageLocale(),{style:'currency',currency:'USD'}).format(value)));
      assert.ok(query('#quote-details').textContent.includes(quote.operatorName)); assert.ok(query('#quote-details').textContent.includes(quote.productName));
      assert.equal(dom.window.localStorage.length,1); assert.equal(dom.window.localStorage.key(0),'ticash.language');
    }
  },{api});
});

test('language change preserves registration fields, password visibility, validation and auth errors', async () => page(async ({query,input,dom,app,api})=>{
  query('#choose-register').click();
  input('#first-name','Élodie');input('#last-name','Jean');input('#register-email','test@example.com');input('#register-password','secret-password');
  query('#register-password-visibility').click(); input('#recharge-language','fr','change');
  assert.equal(query('#first-name').value,'Élodie');assert.equal(query('#last-name').value,'Jean');assert.equal(query('#register-email').value,'test@example.com');
  assert.equal(query('#register-password').value,'secret-password');assert.equal(query('#register-password').type,'text');
  assert.equal(query('#register-password-visibility').getAttribute('aria-label'),t('hideAccountPassword'));assert.equal(query('#register-form').hidden,false);
  api.register=async()=>{throw new Error(translations.en.networkError);};
  query('#register-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();
  assert.equal(query('.login-panel [role=alert]').textContent,t('networkError'));
  app.model.state.error=translations.en.fullPhone;app.model.emit();
  input('#recharge-language','ht','change');assert.equal(query('#recharge-error').textContent,t('fullPhone'));
  assert.equal(query('.login-panel [role=alert]').textContent,t('networkError'));
  assert.equal(dom.window.localStorage.length,1);
}));

test('switching during unresolved confirmation preserves attempt and exact idempotency payload', async () => {
  const api=fixtureApi();api.overrides.set('POST /mobile-topups/transactions',()=>{throw new ApiError('NETWORK_ERROR','Could not reach TiCash. Check your connection and try again.');});
  await page(async ({login,app,query,input})=>{
    await login();await app.model.selectCountry('JM');app.model.setPhone(quote.recipientPhone);await app.model.selectOperator(77);app.model.selectProduct(products[0].id);
    await app.model.getQuote();app.model.review(true);await app.model.confirm();
    assert.ok(app.model.state.attempt);const state=structuredClone(app.model.state);const calls=structuredClone(api.calls);
    input('#recharge-language','pt','change');assert.deepEqual(app.model.state,state);assert.deepEqual(api.calls,calls);
    assert.equal(query('#recovery-note').hidden,false);assert.equal(query('#confirm-recharge').textContent,t('retryConfirmation'));
    await app.model.confirm();const submissions=api.calls.filter(c=>c.path==='/mobile-topups/transactions'&&c.method==='POST');
    assert.equal(submissions.length,2);assert.deepEqual(submissions[0],submissions[1]);
  },{api});
});

test('fallback provider names remain literal text and ISO values cannot become HTML', async () => {
  const api=fixtureApi();const attack='<img src=x onerror=alert(1)>';
  api.overrides.set('GET /mobile-topups/countries',()=>({countries:[{code:'JM',name:attack,callingCode:'+1'}]}));
  const original=Intl.DisplayNames;Intl.DisplayNames=undefined;
  try { await page(async ({login,query,input,root})=>{
    await login();input('#recharge-language','es','change');
    assert.equal(query('#country').options[1].textContent,`🇯🇲 ${attack} (+1)`);assert.equal(query('#country').options[1].value,'JM');
    input('#country','JM','change');await tick();assert.ok(query('#phone-hint').textContent.includes(attack));
    assert.equal(root.querySelector('[onerror]'), null);
    for (const img of root.querySelectorAll('img')) {
      assert.equal(img.classList.contains('country-picker-flag'), true);
      assert.match(img.getAttribute('src') || '', /^\/flags\/[a-z]{2}\.svg$/);
    }
  },{api}); } finally {Intl.DisplayNames=original;}
});

test('receipt and history localize labels and dates while keeping provider values and IDs intact', async () => page(async ({login,app,query,input})=>{
  await login();await app.model.selectCountry('JM');app.model.setPhone(quote.recipientPhone);await app.model.selectOperator(77);app.model.selectProduct(products[0].id);
  await app.model.getQuote();app.model.review(true);await app.model.confirm();
  const state=structuredClone(app.model.state);
  for (const code of ['ht','fr','es','pt','en']) {
    input('#recharge-language',code,'change');assert.deepEqual(app.model.state,state);
    const text=query('#receipt').textContent;
    assert.ok(text.includes(t('testReceipt')));assert.ok(text.includes(t('reference')));assert.ok(text.includes(t('receiptHeading',{status:t('processing')})));
    for (const raw of [transaction.id,transaction.recipientPhone,transaction.operatorName,transaction.productName,'PROCESSING','AUTHORIZED','🇯🇲 JM']) assert.ok(text.includes(raw),raw);
    const date=new Intl.DateTimeFormat(languageLocale(),{dateStyle:'medium',timeStyle:'short'}).format(new Date(transaction.createdAt));
    assert.ok(text.includes(date));assert.ok(query('#history-list').textContent.includes(date));
    assert.ok(query('#history-list').textContent.includes(t('repeat')));
  }
}));


test('visible country picker uses local SVG flags instead of platform emoji glyphs', async () => page(async ({ login, query, input }) => {
  await login();
  input('#country-search', 'Haiti');
  query('#country-picker-button').click();
  const haiti = query('[data-country-code="HT"]');
  assert.ok(haiti);
  assert.equal(haiti.querySelector('img').getAttribute('src'), '/flags/ht.svg');
  assert.equal(haiti.querySelector('.country-picker-name').textContent, 'Haiti');
  assert.match(haiti.querySelector('.country-picker-code').textContent, /HT.*\+509/);
  haiti.click();
  await tick();
  assert.equal(query('#country').value, 'HT');
  assert.equal(query('#country-picker-button img').getAttribute('src'), '/flags/ht.svg');
  assert.doesNotMatch(query('#country-picker-button').textContent, /\p{Regional_Indicator}/u);
}));
