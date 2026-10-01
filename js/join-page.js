import { apiBaseUrl, createApiClient } from './api-client.js';
import { marketingControls } from './marketing.js';
import { t } from './i18n.js';
import './language-page.js';

export function mountJoin(doc = document, client = createApiClient({ baseUrl: apiBaseUrl(globalThis.TICASH_PUBLIC_CONFIG?.apiBaseUrl), identityDomain: 'FLUPFLAP' })) {
  const controls = marketingControls({ doc, client, url: doc.defaultView.location.href });
  doc.querySelector('#join-promotion').append(controls.promo);
  const status = doc.querySelector('#join-status');
  const updateLinks = () => {
    doc.querySelectorAll('[data-join-register]').forEach(a => { a.href = controls.acquisition.link('/login', true); });
    doc.querySelectorAll('[data-join-recharge]').forEach(a => { a.href = controls.acquisition.link('/'); });
  };
  controls.promo.addEventListener('click', () => { setTimeout(updateLinks, 0); });
  updateLinks();
  void controls.acquisition.begin().then(result => { if (result?.promotion) status.textContent = t('marketingPromoSaved'); }).catch(() => { status.textContent = t('marketingPromoUnavailable'); });
  doc.querySelectorAll('[data-join-register]').forEach(a => a.addEventListener('click', async event => {
    event.preventDefault();
    // No account or money event is inferred from this public intent event.
    try { await controls.acquisition.signupStarted(); } catch { /* Marketing cannot block registration. */ }
    doc.defaultView.location.assign(controls.acquisition.link('/login', true));
  }));
  return controls;
}
if (typeof document !== 'undefined' && document.body.classList.contains('join-page')) mountJoin();
