export class ApiError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function apiBaseUrl(value, pageUrl = globalThis.location?.href) {
  if (!value || typeof value !== 'string') throw new ApiError('NOT_CONFIGURED', 'Test recharge is not configured yet. Please contact TiCash support.');
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
export function createApiClient({ baseUrl, fetchImpl = globalThis.fetch, onSessionExpired = () => {}, timeoutMs = 20000 }) {
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

  async function send(path, { method = 'GET', body, headers = {} } = {}) {
    if (!path.startsWith('/') || path.startsWith('//')) throw new ApiError('INVALID_PATH', 'Invalid API request.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(baseUrl + path, {
        method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error',
        referrerPolicy: 'no-referrer', signal: controller.signal,
      });
      const data = response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok) throw new ApiError(data?.code || 'REQUEST_FAILED', typeof data?.error === 'string' ? data.error : 'The service could not complete this request.', response.status);
      if (response.status !== 204 && (!data || typeof data !== 'object')) throw new ApiError('INVALID_RESPONSE', 'The service returned an invalid response.');
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('NETWORK_ERROR', 'Could not reach TiCash. Check your connection and try again.');
    } finally { clearTimeout(timer); }
  }

  function acceptTokens(data, version) {
    if (version !== sessionVersion) throw new ApiError('SESSION_CHANGED', 'Please sign in again.', 401);
    if (typeof data?.accessToken !== 'string' || !data.accessToken || typeof data?.refreshToken !== 'string' || !data.refreshToken) {
      throw new ApiError('INVALID_RESPONSE', 'The sign-in response was incomplete.');
    }
    accessToken = data.accessToken;
    refreshToken = data.refreshToken;
  }

  async function refresh(version) {
    if (!refreshToken) throw new ApiError('UNAUTHENTICATED', 'Please sign in to continue.', 401);
    if (!refreshFlight) {
      const pending = send('/auth/refresh', { method: 'POST', body: { refreshToken } })
        .then((data) => acceptTokens(data, version))
        .catch(() => {
          if (version === sessionVersion) clear(true);
          throw new ApiError('SESSION_EXPIRED', 'Your session expired. Please sign in again.', 401);
        });
      refreshFlight = pending;
      pending.finally(() => { if (refreshFlight === pending) refreshFlight = null; }).catch(() => {});
    }
    return refreshFlight;
  }

  return {
    async login(email, password) {
      clear();
      const version = sessionVersion;
      const data = await send('/auth/login', { method: 'POST', body: { email, password } });
      acceptTokens(data, version);
      return data.user;
    },
    async register({ firstName, lastName, email, password }) {
      clear();
      const version = sessionVersion;
      const data = await send('/auth/register', { method: 'POST', body: { firstName, lastName, email, password } });
      acceptTokens(data, version);
      return data.user;
    },
    async guest() {
      clear();
      const version = sessionVersion;
      const data = await send('/auth/guest', { method: 'POST' });
      if (data?.guest !== true || data.user?.role !== 'CUSTOMER') throw new ApiError('INVALID_RESPONSE', 'The service did not return a guest customer session.');
      acceptTokens(data, version);
      return data.user;
    },
    async logout() {
      const token = refreshToken;
      clear();
      if (token) await send('/auth/logout', { method: 'POST', body: { refreshToken: token } });
    },
    clear,
    async request(path, options = {}) {
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
