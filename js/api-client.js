export class ApiError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const isCheckoutResumeToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43,512}$/.test(value);

export function apiBaseUrl(value, pageUrl = globalThis.location?.href) {
  if (!value || typeof value !== 'string') throw new ApiError('NOT_CONFIGURED', 'Recharge is not configured yet. Please contact TiCash support.');
  const page = new URL(pageUrl);
  let url;
  try { url = new URL(value, page); } catch { throw new ApiError('INVALID_CONFIG', 'The recharge service address is invalid.'); }
  const loopback = (host) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback(url.hostname) && loopback(page.hostname))) ||
      url.username || url.password || url.search || url.hash || !/\/api\/?$/.test(url.pathname)) {
    throw new ApiError('INVALID_CONFIG', 'The recharge service requires a secure API address ending in /api.');
  }
  return url.href.replace(/\/$/, '');
}

// Tokens exist only in this closure. No browser storage, URL, DOM, or analytics.
// The backend rotates refresh tokens; concurrent 401s share one refresh request.
export function createApiClient({ baseUrl, fetchImpl = globalThis.fetch, onSessionExpired = () => {}, timeoutMs = 20000, identityDomain = 'TICASH' }) {
  if (!['TICASH', 'FLUPFLAP'].includes(identityDomain)) throw new ApiError('INVALID_CONFIG', 'Unknown identity domain.');
  const flupflap = identityDomain === 'FLUPFLAP';
  const auth = flupflap ? '/flupflap/auth' : '/auth';
  let accessToken = null;
  let refreshToken = null;
  let refreshFlight = null;
  let sessionVersion = 0;

  function clear(notify = false) {
    sessionVersion += 1;
    accessToken = refreshToken = null;
    refreshFlight = null;
    if (notify) onSessionExpired();
  }

  async function send(path, { method = 'GET', body, headers = {}, signal } = {}) {
    if (!path.startsWith('/') || path.startsWith('//')) throw new ApiError('INVALID_PATH', 'Invalid API request.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(baseUrl + path, {
        method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        mode: 'cors', credentials: flupflap ? 'include' : 'omit', cache: 'no-store', redirect: 'error',
        referrerPolicy: 'no-referrer', signal: controller.signal,
      });
      const data = response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok) throw new ApiError(data?.code || 'REQUEST_FAILED', typeof data?.error === 'string' ? data.error : 'The service could not complete this request.', response.status);
      if (response.status !== 204 && (!data || typeof data !== 'object')) throw new ApiError('INVALID_RESPONSE', 'The service returned an invalid response.');
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('NETWORK_ERROR', 'Could not reach TiCash. Check your connection and try again.');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }

  function acceptTokens(data, version) {
    if (version !== sessionVersion) throw new ApiError('SESSION_CHANGED', 'Please sign in again.', 401);
    if (typeof data?.accessToken !== 'string' || !data.accessToken || typeof data?.refreshToken !== 'string' || !data.refreshToken) {
      throw new ApiError('INVALID_RESPONSE', 'The sign-in response was incomplete.');
    }
    if (flupflap && data.user?.domain !== 'FLUPFLAP') throw new ApiError('INVALID_RESPONSE', 'Invalid FlupFlap identity.');
    accessToken = data.accessToken;
    refreshToken = data.refreshToken;
  }

  async function refresh(version, { notifyOnFailure = true } = {}) {
    if (!refreshToken && !flupflap) throw new ApiError('UNAUTHENTICATED', 'Please sign in to continue.', 401);
    if (!refreshFlight) {
      const pending = send(`${auth}/refresh`, { method: 'POST', body: flupflap && !refreshToken ? {} : { refreshToken } })
        .then((data) => acceptTokens(data, version))
        .catch(() => {
          if (version === sessionVersion) clear(notifyOnFailure);
          throw new ApiError('SESSION_EXPIRED', 'Your session expired. Please sign in again.', 401);
        });
      refreshFlight = pending;
      pending.finally(() => { if (refreshFlight === pending) refreshFlight = null; }).catch(() => {});
    }
    return refreshFlight;
  }

  return {
    identityDomain,
    async resumeCheckout(resumeToken, { signal } = {}) {
      if (!isCheckoutResumeToken(resumeToken)) throw new ApiError('INVALID_RESUME_TOKEN', 'Invalid checkout return link.', 400);
      try {
        // Deliberately bypass authenticated request/refresh. This capability grants only a stored status read.
        return await send(`${flupflap ? '/flupflap' : ''}/mobile-topups/checkout-resume`, {
          method: 'POST', body: { resumeToken }, signal,
        });
      } catch (error) {
        // Never propagate provider/server error text that could echo a capability.
        throw new ApiError(error.status === 410 ? 'RESUME_TOKEN_EXPIRED' : 'RESUME_UNAVAILABLE', 'Checkout return link is unavailable.', error.status);
      } finally { resumeToken = ''; }
    },
    forgotPassword(email) {
      return send(`${auth}/forgot-password`, { method: 'POST', body: { email } });
    },
    resetPassword(token, newPassword) {
      clear();
      return send(`${auth}/reset-password`, { method: 'POST', body: flupflap ? { token, password: newPassword } : { token, newPassword } });
    },
    async login(email, password) {
      clear();
      const version = sessionVersion;
      const data = await send(`${auth}/login`, { method: 'POST', body: { email, password } });
      acceptTokens(data, version);
      return data.user;
    },
    async register({ firstName, lastName, phone, email, password, countryCode }) {
      clear();
      const version = sessionVersion;
      const data = await send(`${auth}/register`, { method: 'POST', body: { firstName, lastName, ...(flupflap ? { phone } : {}), email, password, ...(countryCode ? { countryCode } : {}) } });
      acceptTokens(data, version);
      return data.user;
    },
    async guest() {
      clear();
      const version = sessionVersion;
      const data = await send(`${auth}/guest`, { method: 'POST' });
      if (data?.guest !== true || (flupflap ? data.user?.domain !== 'FLUPFLAP' : data.user?.role !== 'CUSTOMER')) throw new ApiError('INVALID_RESPONSE', 'The service did not return a guest customer session.');
      acceptTokens(data, version);
      return data.user;
    },
    async logout() {
      const token = refreshToken;
      const access = accessToken;
      clear();
      if (flupflap && access) await send(`${auth}/logout`, { method: 'POST', headers: { Authorization: `Bearer ${access}` } });
      else if (token) await send(`${auth}/logout`, { method: 'POST', body: { refreshToken: token } });
    },
    clear,
    async restore() {
      if (!flupflap) return null;
      const version = sessionVersion;
      try {
        await refresh(version, { notifyOnFailure: false });
        return (await send('/flupflap/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } })).user;
      } catch { return null; }
    },
    async request(path, options = {}) {
      if (flupflap) {
        if (path === '/users/me') path = '/flupflap/auth/me';
        else if (/^\/mobile-topups(?:\/|$)/.test(path) && !path.split(/[?#]/)[0].includes('..') && !path.split(/[?#]/)[0].includes('%')) path = '/flupflap' + path;
        else throw new ApiError('INVALID_PATH', 'FlupFlap cannot access TiCash-only services.');
      }
      const version = sessionVersion;
      const usedToken = accessToken;
      if (!usedToken) throw new ApiError('UNAUTHENTICATED', 'Please sign in to continue.', 401);
      const perform = () => send(path, { ...options, headers: { ...options.headers, Authorization: `Bearer ${accessToken}` } });
      try {
        let data;
        try { data = await perform(); }
        catch (error) {
          if (error.status !== 401 || version !== sessionVersion) throw error;
          if (accessToken === usedToken) await refresh(version);
          if (version !== sessionVersion) throw new ApiError('SESSION_CHANGED', 'Please sign in again.', 401);
          data = await perform();
        }
        if (version !== sessionVersion) throw new ApiError('SESSION_CHANGED', 'Please sign in again.', 401);
        return data;
      } catch (error) {
        if ([401, 423].includes(error.status) && version === sessionVersion) clear(true);
        throw error;
      }
    },
  };
}
