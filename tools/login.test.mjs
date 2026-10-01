import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { mountRecharge } from '../js/recharge-page.js';
import { fixtureApi } from './fixtures.mjs';
import { setLanguage, t } from '../js/i18n.js';

const pages = Object.fromEntries(['login', 'recharge'].map(route => [route, readFileSync(new URL(`../${route}/index.html`, import.meta.url), 'utf8')]));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('guest action retains native keyboard semantics and a visible secondary touch target', async () => {
  const css = readFileSync(new URL('../login/login.css', import.meta.url), 'utf8');
  assert.match(css, /login-guest-link \.button\{[^}]*min-height:44px/);
  for (const state of ['hover', 'focus-visible', 'active']) assert.ok(css.includes(`login-guest-link .button:${state}`));
  await loginPage(async ({ query }) => {
    const guest = query('#continue-guest');
    assert.equal(guest.tagName, 'BUTTON');
    assert.equal(guest.type, 'button');
    assert.equal(guest.tabIndex, 0);
    assert.equal(guest.disabled, false);
    assert.equal(guest.textContent, 'Continue as Guest');
  });
});

test('guest label is explicitly translated in all five supported catalogs', async () => {
  const expected = { en: 'Continue as Guest', fr: 'Continuer comme invité', ht: 'Kontinye kòm envite', es: 'Continuar como invitado', pt: 'Continuar como convidado' };
  await loginPage(async ({ query }) => {
    try {
      for (const [language, label] of Object.entries(expected)) {
        const catalog = (await import(`../js/translations/${language}.js`)).default;
        assert.equal(catalog.loginGuest, label);
        setLanguage(language);
        assert.equal(query('#continue-guest').textContent, label);
      }
    } finally { setLanguage('en'); }
  });
});

for (const route of ['login', 'recharge']) {
  test(`${route}: guest entry waits for server approval, fails closed, and never becomes a permanent account`, async () => {
    const api = fixtureApi(); let rejectGuest; let guestCalls = 0; let logouts = 0;
    api.guest = () => { guestCalls++; return new Promise((resolve, reject) => { rejectGuest = reject; }); };
    api.logout = async () => { logouts++; };
    await loginPage(async ({ query, app, dom }) => {
      query('#continue-guest').click(); query('#continue-guest').click();
      assert.equal(guestCalls, 1);
      assert.equal(query('#continue-guest').disabled, true);
      assert.equal(query('#checkout').hidden, true);
      assert.equal(app.model.state.account, null);
      rejectGuest(new Error('Guest access is unavailable. Sign in or create an account.')); await tick();
      assert.equal(query('#checkout').hidden, true);
      assert.equal(query('.login-panel [role=alert]').hidden, false);
      assert.equal(query('#continue-guest').disabled, false);
      api.guest = async () => ({ id: 'guest-only', domain: 'FLUPFLAP', isGuest: true });
      query('#continue-guest').click(); await tick();
      assert.equal(app.model.state.guest, true);
      assert.equal(query('#guest-create-account').hidden, false);
      assert.equal(query('#save-account-country').hidden, true);
      assert.ok(api.calls.every(call => call.method !== 'PATCH'));
      assert.equal(dom.window.localStorage.length, 0);
      assert.equal(dom.window.sessionStorage.length, 0);
      query('#guest-create-account').click(); await tick();
      assert.equal(logouts, 1);
      assert.equal(app.model.state.account, null);
      assert.equal(query('#register-form').hidden, false);
      assert.equal(query('#checkout').hidden, true);
    }, api, route);
  });
}

test('approved login uses the official logo, no old artwork, and three informational features', () => {
  for (const html of Object.values(pages)) {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const logo = document.querySelector('.login-service img');
    assert.ok(existsSync(new URL('..' + logo.getAttribute('src'), import.meta.url)));
    assert.match(logo.getAttribute('src'), /ChatGPT Image Sep 24/);
    assert.equal(document.querySelector('.login-world-art'), null);
    assert.equal(document.querySelector('.login-service span'), null);
    const features = document.querySelector('.login-features');
    assert.equal(features.querySelectorAll('[role=listitem]').length, 3);
    assert.equal(features.querySelectorAll('button,a,[tabindex]').length, 3);
    for (const name of ['recharge','worldwide','security']) assert.ok(features.querySelector('.login-feature-' + name));
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
test(`${route}: empty fields make no login request and unavailable configuration stays disabled`, async () => {
  const api = fixtureApi(); let calls = 0;
  api.login = async () => { calls++; throw new Error('Must not submit invalid credentials'); };
  await loginPage(async ({ query, submit }) => {
    submit('#login-form'); await tick(); assert.equal(calls, 0);
    query('#email').value = 'not-an-email'; query('#password').value = 'long-password';
    submit('#login-form'); await tick(); assert.equal(calls, 0);
    assert.equal(query('.login-panel').contains(query('#continue-guest')), true);
    assert.equal(query('#continue-guest').hidden, false);
    for (const language of ['en','ht','fr','es','pt']) {
      setLanguage(language);
      assert.equal(query('.login-feature-recharge').nextElementSibling.textContent, t('loginFeatureRecharge'));
      assert.equal(query('.login-feature-worldwide').nextElementSibling.textContent, t('loginFeatureGlobal'));
      assert.equal(query('.login-feature-security').nextElementSibling.textContent, t('loginFeatureSafe'));
    }
    setLanguage('en');
  }, api, route);
  const dom = new JSDOM(pages[route], { url: `https://website.example/${route}` });
  globalThis.document = dom.window.document;
  const app = mountRecharge(document.querySelector('[data-recharge-root]'), { mobileRechargeLive: false }, { api });
  try {
    assert.equal(document.querySelector('#login-form button[type=submit]').disabled, true);
    assert.equal(document.querySelector('#continue-guest').disabled, true);
    assert.equal(calls, 0);
  } finally { app.dispose(); dom.window.close(); delete globalThis.document; }
});
test(`${route}: strict login visual order preserves labelled fields, account actions and authenticated transition`, async () => {
  const api = fixtureApi();
  await loginPage(async ({ dom, query, submit }) => {
    const order = ['.site-header','.login-service','#login-title','.auth-intro',
      'label[for=email]','#email','label[for=password]','#password','#forgot-password',
      '#login-form button[type=submit]','.login-divider','#choose-register','#continue-guest','.login-features'];
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
    assert.equal(query('#login-title').textContent, 'Welcome');
    assert.equal(query('.auth-intro').textContent, 'Sign in to manage your recharge account.');
    assert.equal(query('.login-world-art'), null);
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
  assert.ok(query('#first-name')); assert.ok(query('#last-name')); assert.ok(query('#register-phone')); query('#register-email').value = 'tester@example.com';
  query('#register-password').value = 'test-password'; query('#register-password-visibility').click();
  for (const code of ['ht', 'fr', 'es', 'pt', 'en']) {
    setLanguage(code);
    assert.equal(query('.login-feature-recharge').nextElementSibling.textContent, t('loginFeatureRecharge'));
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

test('FlupFlap pages publish a raster social preview with the official multicolor logo', () => {
  for (const [name, html] of Object.entries({ recharge: pages.recharge, login: pages.login, reset: readFileSync(new URL('../recharge/reset-password/index.html', import.meta.url), 'utf8') })) {
    const dom = new JSDOM(html, { url: 'https://www.flupflap.com/' });
    try {
      const document = dom.window.document;
      assert.equal(document.querySelector('meta[property="og:site_name"]')?.content, 'FlupFlap', name);
      assert.match(document.querySelector('meta[property="og:title"]')?.content ?? '', /FlupFlap/, name);
      const image = document.querySelector('meta[property="og:image"]')?.content ?? '';
      assert.match(image, /^https:\/\/www\.flupflap\.com\/brand\/flupflap\/.+\.png$/i, name);
      assert.equal(document.querySelector('meta[property="og:image:type"]')?.content, 'image/png', name);
      assert.equal(document.querySelector('meta[name="twitter:card"]')?.content, 'summary_large_image', name);
      assert.equal(document.querySelector('meta[name="twitter:image"]')?.content, image, name);
    } finally { dom.window.close(); }
  }
});

test('FlupFlap recharge root exposes the same interactive product-information cards', () => {
  const dom = new JSDOM(pages.recharge, { url: 'https://www.flupflap.com/' });
  try {
    const document = dom.window.document;
    const cards = [...document.querySelectorAll('[data-feature-dialog]')];
    assert.deepEqual(cards.map(card => card.dataset.featureDialog), ['airtime', 'bundles', 'company']);
    assert.ok(document.querySelector('#flupflap-feature-dialog'));
    assert.ok(document.querySelector('.feature-dialog-actions'));
    assert.ok(document.querySelector('script[src="/login/feature-dialogs.js"]'));
  } finally { dom.window.close(); }
});

test('FlupFlap login trust cards are interactive and include airtime, bundles, and company information', () => {
  const dom = new JSDOM(pages.login, { url: 'https://www.flupflap.com/login' });
  try {
    const document = dom.window.document;
    const cards = [...document.querySelectorAll('[data-feature-dialog]')];
    assert.deepEqual(cards.map(card => card.dataset.featureDialog), ['airtime', 'bundles', 'company']);
    assert.ok(document.querySelector('#flupflap-feature-dialog'));
    assert.ok(document.querySelector('script[src="/login/feature-dialogs.js"]'));
    const source = readFileSync(new URL('../login/feature-dialogs.js', import.meta.url), 'utf8');
    assert.match(source, /AIRTIME TOP-UP/);
    assert.match(source, /DATA & BUNDLES/);
    assert.match(source, /ABOUT FLUPFLAP/);
    assert.match(source, /DT One, Reloadly or Ding/);
  } finally { dom.window.close(); }
});

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
    query('#first-name').value = 'Test'; query('#last-name').value = 'Customer'; query('#register-phone').value = '+15551234567';
    query('#register-email').value = 'tester@example.com'; query('#register-password').value = 'test-password';
    submit('#register-form'); await tick();
    assert.deepEqual(credentials, { firstName: 'Test', lastName: 'Customer', phone: '+15551234567', email: 'tester@example.com', password: 'test-password' });
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
    assert.equal(query('#login-title').textContent, 'Welcome');
    assert.equal(root.classList.contains('recharge-active'), false);
    assert.equal(dom.window.localStorage.length, 0); assert.equal(dom.window.sessionStorage.length, 0);
  }, api, 'recharge');
});

for (const route of ['login', 'recharge']) {
  test(`${route}: premium design keeps the real guest action in the auth card without extra artwork`, async () => {
    const api = fixtureApi(); let guests = 0;
    api.guest = async () => { guests++; return { id: 'guest-user', role: 'CUSTOMER' }; };
    await loginPage(async ({ query, submit }) => {
      assert.equal(query('.login-service span'), null);
      assert.equal(query('#login-title').textContent, 'Welcome');
      assert.equal(query('.auth-intro').textContent, 'Sign in to manage your recharge account.');
      assert.equal(query('#email').placeholder, 'Enter your email address');
      assert.equal(query('#password').placeholder, 'Enter your password');
      assert.equal(query('#continue-guest').textContent, 'Continue as Guest');
      assert.equal(query('#choose-register').textContent, 'Create an account');
      assert.equal(query('#continue-guest').closest('.login-panel'), query('.login-panel'));
      assert.equal(query('#continue-guest').parentNode.className, 'login-guest-link');
      assert.equal(query('#choose-login').hidden, true);
      for (const selector of ['.login-world-art', '.login-trust', '.login-subheading', '.login-story-copy', '.auth-help']) assert.equal(query(selector), null);
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
        assert.equal(query('#login-title').textContent, t('loginWelcome'));
        assert.equal(query('.auth-intro').textContent, t('loginAccess'));
        assert.equal(query('.login-feature-recharge').nextElementSibling.textContent, t('loginFeatureRecharge'));
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
