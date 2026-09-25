import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { mountRecharge } from '../js/recharge-page.js';
import { fixtureApi } from './fixtures.mjs';
import { setLanguage, t } from '../js/i18n.js';

const pages = Object.fromEntries(['login', 'recharge'].map(route => [route, readFileSync(new URL(`../${route}/index.html`, import.meta.url), 'utf8')]));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function loginPage(run, api = fixtureApi(), route = 'login') {
  const dom = new JSDOM(pages[route], { url: `https://website.example/${route}` });
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  globalThis.history = dom.window.history;
  const root = document.querySelector('[data-recharge-root]');
  const app = mountRecharge(root, { mobileRechargeLive: false }, { api });
  const query = selector => document.querySelector(selector);
  const submit = selector => query(selector).dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true }));
  try { await run({ dom, root, app, query, submit }); }
  finally { app.dispose(); dom.window.close(); delete globalThis.document; delete globalThis.location; delete globalThis.history; }
}

for (const route of ['login', 'recharge']) {
test(`${route}: real login markup preserves credentials, busy state, in-memory transition and redirect`, async () => {
  const api = fixtureApi(); let resolveLogin; let credentials;
  api.login = (...args) => { credentials = args; return new Promise(resolve => { resolveLogin = resolve; }); };
  await loginPage(async ({ dom, root, query, submit }) => {
    assert.equal(root.dataset.loginBrand, 'flupflap');
    assert.doesNotMatch(query('.login-panel').textContent, /Sign in to TiCash/);
    assert.equal(query('#checkout').hidden, true);
    assert.equal(query('#login-title').textContent, 'Welcome back');
    assert.equal(query('.login-subheading').textContent, 'Sign in to FlupFlap');
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
  query('#first-name').value = 'Ti'; query('#register-email').value = 'tester@example.com';
  query('#register-password').value = 'test-password'; query('#register-password-visibility').click();
  for (const code of ['ht', 'fr', 'es', 'pt', 'en']) {
    setLanguage(code);
    assert.equal(query('#login-welcome').textContent, t('loginBrandTitle'));
    assert.equal(query('.login-story-description').textContent, t('loginBrandDescription'));
    assert.equal(query('#first-name').value, 'Ti');
    assert.equal(query('#register-password').value, 'test-password');
    assert.equal(query('#register-password').type, 'text');
    assert.equal(query('#register-form').hidden, false);
    assert.equal(query('.login-subheading').hidden, true);
  }
  query('#choose-login').click(); assert.equal(query('#register-password').value, '');
  assert.equal(query('#email').required, true); assert.equal(query('#password').minLength, 8);
  query('#forgot-password').click();
  assert.equal(query('#forgot-form').hidden, false); assert.equal(query('#login-form').hidden, true);
  assert.equal(query('#login-title').textContent, 'Forgot your password?');
  assert.equal(query('.login-subheading').hidden, true);
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

test('recharge FlupFlap registration submits unchanged credentials and exposes checkout', async () => {
  const api = fixtureApi(); let credentials;
  api.register = async data => { credentials = data; return { id: 'registered-user', role: 'CUSTOMER' }; };
  await loginPage(async ({ query, submit, dom }) => {
    query('#choose-register').click();
    query('#first-name').value = 'Ti'; query('#last-name').value = 'Cash';
    query('#register-email').value = 'tester@example.com'; query('#register-password').value = 'test-password';
    submit('#register-form'); await tick();
    assert.deepEqual(credentials, { firstName: 'Ti', lastName: 'Cash', email: 'tester@example.com', password: 'test-password' });
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
    assert.equal(query('.login-subheading').textContent, 'Sign in to FlupFlap');
    query('#continue-guest').click(); query('#continue-guest').click(); await tick();
    assert.equal(guests, 1);
    assert.equal(query('#checkout').hidden, false);
    assert.equal(query('#guest-note').hidden, false);
    assert.match(root.textContent, /TEST MODE/);
    assert.equal(dom.window.location.pathname, '/recharge');
    assert.ok(api.calls.every(call => !call.method || call.method === 'GET'));
    query('#sign-out').click(); await tick();
    assert.equal(query('#checkout').hidden, true);
    assert.equal(query('#login-title').textContent, 'Welcome back');
    assert.equal(root.classList.contains('recharge-active'), false);
    assert.equal(dom.window.localStorage.length, 0); assert.equal(dom.window.sessionStorage.length, 0);
  }, api, 'recharge');
});
