import test from 'node:test';
import assert from 'node:assert/strict';
import { apiBaseUrl, createApiClient } from '../js/api-client.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const tokens = { accessToken: 'test-access', refreshToken: '11111111-1111-4111-8111-111111111111' };
const session = { ...tokens, user: { id: 'test-user' } };

test('public URL accepts HTTPS and local-only HTTP, rejects unsafe destinations', () => {
  assert.equal(apiBaseUrl('https://test.example/api/', 'https://web.example/recharge'), 'https://test.example/api');
  assert.equal(apiBaseUrl('/api', 'https://web.example/recharge'), 'https://web.example/api');
  assert.equal(apiBaseUrl('http://127.0.0.1:4000/api', 'http://localhost:3000/recharge'), 'http://127.0.0.1:4000/api');
  for (const value of ['', 'http://test.example/api', 'https://u:p@test.example/api', 'https://test.example/api?key=secret', 'https://test.example/api#x', 'javascript:alert(1)', 'https://test.example/not-api', 'http://localhost:4000/api']) {
    assert.throws(() => apiBaseUrl(value, 'https://web.example/recharge'));
  }
});
test('logged-out requests fail before any network call', async () => {
  let calls = 0; const api = createApiClient({ baseUrl: 'https://test.example/api', fetchImpl: async () => { calls++; } });
  await assert.rejects(api.request('/mobile-topups/countries'), { status: 401 }); assert.equal(calls, 0);
});
test('login and logout match real backend bodies and never send browser cookies', async () => {
  const calls = [];
  const api = createApiClient({ baseUrl: 'https://test.example/api', fetchImpl: async (url, options) => {
    calls.push({ url, ...options }); return url.endsWith('/logout') ? new Response(null, { status: 204 }) : json(session);
  } });
  assert.deepEqual(await api.login('tester@example.com', 'test-password'), session.user);
  await api.request('/mobile-topups/status'); await api.logout();
  assert.equal(calls[0].url, 'https://test.example/api/auth/login');
  assert.deepEqual(JSON.parse(calls[0].body), { email: 'tester@example.com', password: 'test-password' });
  assert.equal(calls[1].headers.Authorization, `Bearer ${tokens.accessToken}`);
  assert.deepEqual(JSON.parse(calls[2].body), { refreshToken: tokens.refreshToken });
  for (const call of calls) { assert.equal(call.credentials, 'omit'); assert.equal(call.cache, 'no-store'); assert.equal(call.redirect, 'error'); assert.equal(call.referrerPolicy, 'no-referrer'); }
  await assert.rejects(api.request('/mobile-topups/status'), { status: 401 });
});
test('expired access token refreshes once and retries identical confirmation payload and key', async () => {
  const calls = [];
  const api = createApiClient({ baseUrl: 'https://test.example/api', fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    if (url.endsWith('/login')) return json(session);
    if (url.endsWith('/refresh')) return json({ ...tokens, accessToken: 'refreshed-access' });
    if (options.headers.Authorization === 'Bearer test-access') return json({ code: 'INVALID_TOKEN', error: 'Expired' }, 401);
    return json({ transaction: { id: 'test' } }, 201);
  } });
  await api.login('tester@example.com', 'test-password');
  await api.request('/mobile-topups/transactions', { method: 'POST', body: { quoteId: 'quote-id' }, headers: { 'Idempotency-Key': 'key-id' } });
  assert.equal(calls.length, 4); assert.equal(calls[2].url, 'https://test.example/api/auth/refresh');
  assert.deepEqual(JSON.parse(calls[2].body), { refreshToken: tokens.refreshToken });
  assert.equal(calls[1].body, calls[3].body); assert.equal(calls[1].headers['Idempotency-Key'], calls[3].headers['Idempotency-Key']);
});
test('concurrent 401s share one rotating refresh request', async () => {
  let refreshes = 0;
  const api = createApiClient({ baseUrl: 'https://test.example/api', fetchImpl: async (url, options) => {
    if (url.endsWith('/login')) return json(session);
    if (url.endsWith('/refresh')) { refreshes++; await new Promise((r) => setTimeout(r, 5)); return json({ ...tokens, accessToken: 'new-access' }); }
    return options.headers.Authorization === 'Bearer test-access' ? json({ code: 'INVALID_TOKEN' }, 401) : json({ countries: [] });
  } });
  await api.login('tester@example.com', 'test-password'); await Promise.all([api.request('/mobile-topups/countries'), api.request('/mobile-topups/status')]);
  assert.equal(refreshes, 1);
});
test('refresh failure clears session and does not loop', async () => {
  let expired = 0; let refreshes = 0;
  const api = createApiClient({ baseUrl: 'https://test.example/api', onSessionExpired: () => expired++, fetchImpl: async (url) => {
    if (url.endsWith('/login')) return json(session);
    if (url.endsWith('/refresh')) refreshes++;
    return json({ error: 'Expired', code: 'INVALID_REFRESH' }, 401);
  } });
  await api.login('tester@example.com', 'test-password'); await assert.rejects(api.request('/mobile-topups/status'), { code: 'SESSION_EXPIRED' });
  await assert.rejects(api.request('/mobile-topups/status'), { code: 'UNAUTHENTICATED' });
  assert.equal(expired, 1); assert.equal(refreshes, 1);
});
test('second 401 after refresh ends session instead of looping', async () => {
  let refreshes = 0; let ended = 0;
  const api = createApiClient({ baseUrl: 'https://test.example/api', onSessionExpired: () => ended++, fetchImpl: async (url) => {
    if (url.endsWith('/login')) return json(session);
    if (url.endsWith('/refresh')) { refreshes++; return json({ ...tokens, accessToken: 'new' }); }
    return json({ code: 'INVALID_TOKEN' }, 401);
  } });
  await api.login('tester@example.com', 'test-password'); await assert.rejects(api.request('/mobile-topups/status'), { status: 401 });
  assert.equal(refreshes, 1); assert.equal(ended, 1);
});
test('logout during refresh cannot resurrect credentials', async () => {
  let finish; let refreshStarted;
  const started = new Promise((r) => { refreshStarted = r; });
  const api = createApiClient({ baseUrl: 'https://test.example/api', fetchImpl: async (url) => {
    if (url.endsWith('/login')) return json(session);
    if (url.endsWith('/logout')) return new Response(null, { status: 204 });
    if (url.endsWith('/refresh')) { refreshStarted(); return new Promise((r) => { finish = r; }); }
    return json({ code: 'INVALID_TOKEN' }, 401);
  } });
  await api.login('tester@example.com', 'test-password'); const request = api.request('/mobile-topups/status');
  await started; await api.logout(); finish(json({ ...tokens, accessToken: 'late-access' }));
  await assert.rejects(request, { status: 401 }); await assert.rejects(api.request('/mobile-topups/status'), { code: 'UNAUTHENTICATED' });
});
test('invalid login, locked account, backend errors and timeout have controlled errors', async () => {
  const bad = createApiClient({ baseUrl: 'https://test.example/api', fetchImpl: async () => json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' }, 401) });
  await assert.rejects(bad.login('tester@example.com', 'test-password'), { code: 'INVALID_CREDENTIALS' });
  const unavailable = createApiClient({ baseUrl: 'https://test.example/api', fetchImpl: async () => { throw new TypeError('Network details must not escape'); } });
  await assert.rejects(unavailable.login('tester@example.com', 'test-password'), { code: 'NETWORK_ERROR' });
  const timeout = createApiClient({ baseUrl: 'https://test.example/api', timeoutMs: 5, fetchImpl: async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  await assert.rejects(timeout.login('tester@example.com', 'test-password'), { code: 'NETWORK_ERROR' });
  let locked = 0;
  const account = createApiClient({ baseUrl: 'https://test.example/api', onSessionExpired: () => locked++, fetchImpl: async (url) => url.endsWith('/login') ? json(session) : json({ code: 'ACCOUNT_LOCKED', error: 'Locked' }, 423) });
  await account.login('tester@example.com', 'test-password'); await assert.rejects(account.request('/mobile-topups/status'), { status: 423 }); assert.equal(locked, 1);
});

test('registration sends only account fields and authenticates through memory-only tokens', async () => {
  const calls = [];
  const api = createApiClient({ baseUrl: 'https://test.example/api', fetchImpl: async (url, options) => {
    calls.push({ url, ...options }); return json(session);
  } });
  const account = { firstName: 'Ti', lastName: 'Cash', email: 'new@example.com', password: 'test-password' };
  assert.deepEqual(await api.register({ ...account, role: 'ADMIN' }), session.user);
  await api.request('/mobile-topups/countries');
  assert.equal(calls[0].url, 'https://test.example/api/auth/register'); assert.deepEqual(JSON.parse(calls[0].body), account);
  assert.equal(calls[1].headers.Authorization, `Bearer ${tokens.accessToken}`);
  api.clear(); await assert.rejects(api.request('/mobile-topups/countries'), { code: 'UNAUTHENTICATED' });
});

test('guest entry requires explicit guest CUSTOMER response and normal tokens, never fake credentials', async () => {
  const calls = [];
  const api = createApiClient({ baseUrl: 'https://test.example/api', fetchImpl: async (url, options) => {
    calls.push({ url, ...options }); return json({ ...session, guest: true, user: { role: 'CUSTOMER' } });
  } });
  await api.guest(); await api.request('/mobile-topups/countries');
  assert.equal(calls[0].url, 'https://test.example/api/auth/guest'); assert.equal(calls[0].method, 'POST'); assert.equal(calls[0].body, undefined);
  assert.equal(calls[1].headers.Authorization, `Bearer ${tokens.accessToken}`);
  for (const response of [session, { ...session, guest: true, user: { role: 'ADMIN' } }, { guest: true, user: { role: 'CUSTOMER' } }]) {
    const bad = createApiClient({ baseUrl: 'https://test.example/api', fetchImpl: async () => json(response) });
    await assert.rejects(bad.guest(), { code: 'INVALID_RESPONSE' });
    await assert.rejects(bad.request('/mobile-topups/status'), { code: 'UNAUTHENTICATED' });
  }
});

test('all authentication choices avoid persistent browser storage and token URLs', async () => {
  const original = ['localStorage', 'sessionStorage'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  for (const [key] of original) Object.defineProperty(globalThis, key, { configurable: true, get() { throw new Error('Browser storage accessed'); } });
  try {
    for (const mode of ['login', 'register', 'guest']) {
      const api = createApiClient({ baseUrl: 'https://test.example/api', fetchImpl: async (url, options) => {
        assert.doesNotMatch(url, /test-access|11111111|test-password/); assert.equal(options.credentials, 'omit');
        return json({ ...session, guest: true, user: { role: 'CUSTOMER' } });
      } });
      if (mode === 'login') await api.login('test@example.com', 'test-password');
      if (mode === 'register') await api.register({ firstName: 'T', lastName: 'C', email: 'test@example.com', password: 'test-password' });
      if (mode === 'guest') await api.guest();
      await api.request('/mobile-topups/countries');
      const freshPage = createApiClient({ baseUrl: 'https://test.example/api' });
      await assert.rejects(freshPage.request('/mobile-topups/countries'), { code: 'UNAUTHENTICATED' });
    }
  } finally { for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }
});

test('registration conflict and unsafe guest errors leave requests unauthenticated', async () => {
  for (const [method, code, status] of [['register', 'EMAIL_EXISTS', 409], ['guest', 'GUEST_SANDBOX_REQUIRED', 403]]) {
    const api = createApiClient({ baseUrl: 'https://test.example/api', fetchImpl: async () => json({ error: 'Denied', code }, status) });
    await assert.rejects(api[method]({}), { code, status });
    await assert.rejects(api.request('/mobile-topups/status'), { code: 'UNAUTHENTICATED' });
  }
});


test('password recovery uses public POST endpoints without auth headers or token persistence', async()=>{
  const calls=[];const api=createApiClient({baseUrl:'https://test.example/api',fetchImpl:async(url,options)=>{
    calls.push({url,options});return url.endsWith('/reset-password')?new Response(null,{status:204}):json({message:'generic'});
  }});
  await api.forgotPassword('recover@example.com');await api.resetPassword('fixture-token','new-password');
  assert.deepEqual(calls.map(({url,options})=>[url,options.method,JSON.parse(options.body)]),[
    ['https://test.example/api/auth/forgot-password','POST',{email:'recover@example.com'}],
    ['https://test.example/api/auth/reset-password','POST',{token:'fixture-token',newPassword:'new-password'}]
  ]);
  for(const {options} of calls){assert.equal(options.headers.Authorization,undefined);assert.equal(options.referrerPolicy,'no-referrer');}
});
