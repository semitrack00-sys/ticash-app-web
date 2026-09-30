import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { mountRecharge } from '../js/recharge-page.js';
import { fixtureApi } from './fixtures.mjs';
import { setLanguage, t } from '../js/i18n.js';

const pages = Object.fromEntries(['login', 'recharge'].map(route => [route, readFileSync(new URL(`../${route}/index.html`, import.meta.url), 'utf8')]));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('login illustration reuses production artwork and remains decorative with no account controls', () => {
  const css = readFileSync(new URL('../login/login.css', import.meta.url), 'utf8');
  const assets = [...css.matchAll(/url\(['"]?(\/brand\/[^)'"\s]+)['"]?\)/g)].map(match => match[1]);
  assert.ok(assets.length > 0);
  for (const asset of assets) assert.ok(existsSync(new URL(`..${asset}`, import.meta.url)), `Missing production asset ${asset}`);
  for (const html of Object.values(pages)) {
    const dom = new JSDOM(html);
    const art = dom.window.document.querySelector('.login-world-art');
    assert.equal(art.getAttribute('aria-hidden'), 'true');
    assert.equal(art.querySelectorAll('a,button,input,[tabindex]').length, 0);
    assert.equal(art.querySelectorAll('span').length, 4);
    dom.window.close();
  }
});
async function loginPage(run, api = fixtureApi(), route = 'login') {
  const dom = new JSDOM(pages[route], { url: `https://website.example/${route}` });
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  globalThis.history = dom.window.history;
  const root = document.querySelector('[data-recharge-root]');
  const app = mountRecharge(root, { mobileRechargeLive: true }, { api });
  const query = selector => document.querySelector(selector);
  const submit = selector => query(selector).dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true }));
  try { await run({ dom, root, app, query, submit }); }
  finally { app.dispose(); dom.window.close(); delete globalThis.document; delete globalThis.location; delete globalThis.history; }
}

for (const route of ['login', 'recharge']) {
test(`${route}: strict login visual order preserves labelled fields, account actions and authenticated transition`, async () => {
  const api = fixtureApi();
  await loginPage(async ({ dom, query, submit }) => {
    const order = ['.site-header','.login-service','.login-world-art','#login-title','.auth-intro',
      'label[for=email]','#email','label[for=password]','#password','#forgot-password',
      '#login-form button[type=submit]','.login-divider','#continue-guest','#choose-register'];
    for (let i = 1; i < order.length; i++) {
      assert.ok(query(order[i - 1]).compareDocumentPosition(query(order[i])) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
        `${order[i]} must follow ${order[i - 1]}`);
    }
    assert.equal(query('#password-visibility').getAttribute('aria-controls'), 'password');
    assert.equal(query('.login-service img').getAttribute('alt'), 'FlupFlap');
    query('#email').value = 'tester@example.com'; query('#password').value = 'test-password';
    submit('#login-form'); await tick();
    assert.equal(query('.checkout-main').classList.contains('recharge-active'), true);
    assert.equal(query('.login-panel').hidden, true);
    assert.equal(query('#checkout').hidden, false);
  }, api, route);
});
test(`${route}: real login markup preserves credentials, busy state, in-memory transition and redirect`, async () => {
  const api = fixtureApi(); let resolveLogin; let credentials;
  api.login = (...args) => { credentials = args; return new Promise(resolve => { resolveLogin = resolve; }); };
  await loginPage(async ({ dom, root, query, submit }) => {
    assert.equal(root.dataset.loginBrand, 'flupflap');
    assert.doesNotMatch(query('.login-panel').textContent, /Sign in to TiCash/);
    assert.equal(query('#checkout').hidden, true);
    assert.equal(query('#login-title').textContent, 'Sign in');
    assert.equal(query('.auth-intro').textContent, 'Sign in to manage your recharge account.');
    assert.equal(query('.login-world-art').getAttribute('aria-hidden'), 'true');
    assert.equal(query('#email').type, 'email');
    assert.equal(query('#email').autocomplete, 'username');
    assert.equal(query('#password').autocomplete, 'current-password');
    assert.equal(query('#password').type, 'password');
    query('#email').value = 'tester@example.com'; query('#password').value = 'test-password';
    submit('#login-form');
    assert.deepEqual(credentials, ['tester@example.com', 'test-password']);
    assert.equal(query('#login-form button[type=submit]').disabled, true);
    assert.match(query('#login-form button[type=submit]').textContent, /Signing in/);
    resolveLogin({ id: 'test-user' }); await tick();
    assert.equal(dom.window.location.pathname, '/recharge');
    assert.equal(root.classList.contains('recharge-active'), true);
    assert.equal(query('.login-panel').hidden, true);
    assert.equal(query('#checkout').hidden, false);
    assert.equal(query('#password').value, '');
    assert.equal(dom.window.localStorage.length, 0); assert.equal(dom.window.sessionStorage.length, 0);
  }, api, route);
});

test(`${route}: login branding localizes without replacing registration, recovery, validation or password controls`, async () => loginPage(async ({ query }) => {
  query('#choose-register').click();
  assert.equal(query('#first-name'), null); query('#register-email').value = 'tester@example.com';
  query('#register-password').value = 'test-password'; query('#register-password-visibility').click();
  for (const code of ['ht', 'fr', 'es', 'pt', 'en']) {
    setLanguage(code);
    assert.equal(query('.login-service span').textContent, t('loginServiceCaption'));
    assert.equal(query('.login-story-description'), null);
    assert.equal(query('#register-email').value, 'tester@example.com');
    assert.equal(query('#register-password').value, 'test-password');
    assert.equal(query('#register-password').type, 'text');
    assert.equal(query('#register-form').hidden, false);
    assert.equal(query('.login-subheading'), null);
  }
  query('#choose-login').click(); assert.equal(query('#register-password').value, '');
  assert.equal(query('#email').required, true); assert.equal(query('#password').minLength, 8);
  query('#forgot-password').click();
  assert.equal(query('#forgot-form').hidden, false); assert.equal(query('#login-form').hidden, true);
  assert.equal(query('#login-title').textContent, 'Forgot your password?');
  assert.equal(query('.login-subheading'), null);
  query('#back-to-login').click(); assert.equal(query('#login-form').hidden, false);
  assert.equal(query('#continue-guest').hidden, false);
  assert.equal(query('input[autocomplete=one-time-code]'), null); // No invented OTP or social controls.
  assert.doesNotMatch(query('.login-layout').textContent, /Sign in with Google|millions of users/i);
}, fixtureApi(), route));

test(`${route}: login card retains accessible errors and permits retry with no session established`, async () => {
  const api = fixtureApi(); api.login = async () => { throw new Error('Invalid email or password'); };
  await loginPage(async ({ root, query, submit }) => {
    query('#email').value = 'tester@example.com'; query('#password').value = 'test-password'; submit('#login-form'); await tick();
    assert.equal(query('.login-panel [role=alert]').hidden, false);
    assert.equal(query('#login-form button[type=submit]').disabled, false);
    assert.equal(query('#checkout').hidden, true);
    assert.equal(root.classList.contains('recharge-active'), false);
  }, api, route);
});

}

test('recharge reuses the approved FlupFlap authentication markup and stylesheet', () => {
  const documents = Object.values(pages).map(html => new JSDOM(html));
  try {
    const [login, recharge] = documents.map(dom => dom.window.document);
    assert.equal(recharge.querySelector('.login-story').outerHTML, login.querySelector('.login-story').outerHTML);
    for (const document of [login, recharge]) {
      assert.ok(document.querySelector('link[href="/login/login.css"]'));
      assert.ok(document.querySelector('.login-layout [data-recharge-root][data-login-brand="flupflap"]'));
    }
    const css = readFileSync(new URL('../login/login.css', import.meta.url), 'utf8');
    assert.match(css, /\.login-layout\{display:contents\}/);
    assert.match(css, /\.login-layout:has\(\.recharge-active\) \.login-story\{display:none\}/);
  } finally { documents.forEach(dom => dom.window.close()); }
});

test('recharge FlupFlap registration submits lightweight FlupFlap credentials and exposes checkout', async () => {
  const api = fixtureApi(); let credentials;
  api.register = async data => { credentials = data; return { id: 'registered-user', role: 'CUSTOMER' }; };
  await loginPage(async ({ query, submit, dom }) => {
    query('#choose-register').click();
    assert.equal(query('#first-name'), null); assert.equal(query('#last-name'), null);
    query('#register-email').value = 'tester@example.com'; query('#register-password').value = 'test-password';
    submit('#register-form'); await tick();
    assert.deepEqual(credentials, { email: 'tester@example.com', password: 'test-password' });
    assert.equal(query('#checkout').hidden, false);
    assert.equal(query('#register-password').value, '');
    assert.equal(dom.window.location.pathname, '/recharge');
    assert.ok(api.calls.some(call => call.path === '/mobile-topups/countries'));
    assert.ok(api.calls.every(call => !call.method || call.method === 'GET'));
  }, api, 'recharge');
});

test('recharge FlupFlap recovery and guest entry retain their existing flows', async () => {
  const api = fixtureApi(); let recovery; let guests = 0;
  api.forgotPassword = async email => { recovery = email; return {}; };
  api.guest = async () => { guests++; return { id: 'guest-user', role: 'CUSTOMER' }; };
  await loginPage(async ({ query, submit, root, dom }) => {
    query('#forgot-password').click(); query('#forgot-email').value = 'tester@example.com';
    submit('#forgot-form'); await tick();
    assert.equal(recovery, 'tester@example.com');
    assert.equal(query('#recovery-status').textContent, 'If an account exists for this email, we sent password reset instructions.');
    assert.equal(query('#checkout').hidden, true);
    query('#back-to-login').click();
    assert.equal(query('.auth-intro').textContent, 'Sign in to manage your recharge account.');
    query('#continue-guest').click(); query('#continue-guest').click(); await tick();
    assert.equal(guests, 1);
    assert.equal(query('#checkout').hidden, false);
    assert.equal(query('#guest-note').hidden, false);
    assert.match(root.textContent, /Test mode|TEST MODE/);
    assert.equal(dom.window.location.pathname, '/recharge');
    assert.ok(api.calls.every(call => !call.method || call.method === 'GET'));
    query('#sign-out').click(); await tick();
    assert.equal(query('#checkout').hidden, true);
    assert.equal(query('#login-title').textContent, 'Sign in');
    assert.equal(root.classList.contains('recharge-active'), false);
    assert.equal(dom.window.localStorage.length, 0); assert.equal(dom.window.sessionStorage.length, 0);
  }, api, 'recharge');
});

for (const route of ['login', 'recharge']) {
  test(`${route}: final design preserves the real guest handler and has no extra marketing sections`, async () => {
    const api = fixtureApi(); let guests = 0;
    api.guest = async () => { guests++; return { id: 'guest-user', role: 'CUSTOMER' }; };
    await loginPage(async ({ query, submit }) => {
      assert.equal(query('.login-service span').textContent, 'Powered by TiCash-App');
      assert.equal(query('#login-title').textContent, 'Sign in');
      assert.equal(query('.auth-intro').textContent, 'Sign in to manage your recharge account.');
      assert.equal(query('#email').placeholder, 'Enter your email address');
      assert.equal(query('#password').placeholder, 'Enter your password');
      assert.equal(query('#continue-guest').textContent, 'Continue as Guest');
      assert.equal(query('#choose-register').textContent, 'Create an account');
      assert.equal(query('#continue-guest').parentNode, query('#choose-register').parentNode);
      assert.equal(query('#choose-login').hidden, true);
      for (const selector of ['.login-features', '.login-trust', '.login-subheading', '.login-story-copy', '.auth-help']) assert.equal(query(selector), null);
      assert.doesNotMatch(query('.login-layout').textContent, /A service offered by TiCash-App|Sign in to FlupFlap/);
      assert.equal(query('.site-header a[href="/support"]').getAttribute('href'), '/support');
      query('#continue-guest').click(); query('#continue-guest').click(); await tick();
      assert.equal(guests, 1); assert.equal(query('#checkout').hidden, false);
      assert.equal(query('.login-panel').hidden, true);
    }, api, route);
  });

  test(`${route}: password visibility, keyboard form submission and language changes preserve entered credentials`, async () => {
    const api = fixtureApi(); let submitted;
    api.login = async (...credentials) => { submitted = credentials; return { id: 'user' }; };
    await loginPage(async ({ query, dom, submit }) => {
      query('#email').value = 'tester@example.com'; query('#password').value = 'test-password';
      const toggle = query('#password-visibility'); toggle.click();
      assert.equal(query('#password').type, 'text'); assert.equal(toggle.getAttribute('aria-pressed'), 'true');
      assert.equal(toggle.getAttribute('aria-controls'), 'password');
      for (const option of query('#header-language').options) {
        query('#header-language').value = option.value;
        query('#header-language').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        assert.equal(query('#login-title').textContent, t('Sign in'));
        assert.equal(query('.auth-intro').textContent, t('loginAccess'));
        assert.equal(query('.login-service span').textContent, t('loginServiceCaption'));
        assert.equal(query('#email').placeholder, t('loginEmailPlaceholder'));
        assert.equal(query('#continue-guest').textContent, t('loginGuest'));
        assert.equal(query('#choose-register').textContent, t('loginCreate'));
        assert.equal(query('#email').value, 'tester@example.com'); assert.equal(query('#password').value, 'test-password');
        assert.equal(query('#password').type, 'text');
      }
      setLanguage('en'); toggle.click();
      assert.equal(query('#password').type, 'password'); assert.equal(toggle.textContent, 'Show');
      submit('#login-form'); await tick();
      assert.deepEqual(submitted, ['tester@example.com', 'test-password']);
      assert.equal(query('#checkout').hidden, false);
    }, api, route);
  });
}
