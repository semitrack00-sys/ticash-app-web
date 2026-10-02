import { t, onLanguageChange } from './i18n.js';

export function acquisitionQuery(url) {
  const q = new URL(url).searchParams;
  const r = q.get('r'), promo = q.get('promo')?.trim().toUpperCase();
  return { ...(r && /^[a-f0-9]{32}$/.test(r) ? { r } : {}),
    ...(promo && /^[A-Z0-9][A-Z0-9_-]{5,31}$/.test(promo) ? { promo } : {}) };
}
export function acquisitionLink(path, input, register = false) {
  const url = new URL(path, 'https://www.flupflap.com');
  for (const [k,v] of Object.entries(input)) if (k === 'r' || k === 'promo') url.searchParams.set(k,v);
  if (register) url.searchParams.set('mode','register');
  return url.pathname + url.search;
}
export function safeShareUrl(value) {
  return typeof value === 'string' && /^https:\/\/www\.flupflap\.com\/join\?r=[a-f0-9]{32}$/.test(value) ? value : null;
}
// Acquisition receipts grant no authentication/payment access. Kept only in memory.
// The API may reuse its HttpOnly, expiring visit cookie across signup navigation.
export function createAcquisition(client, url) {
  let input = acquisitionQuery(url), receipt = null;
  let flight = null;
  const begin = () => {
    if (!Object.keys(input).length) return Promise.resolve(null);
    flight ||= client.marketingVisit(input).then(result => {
      if (!/^[A-Za-z0-9_-]{43}$/.test(result?.capability)) throw new Error('Invalid acquisition receipt');
      receipt = result.capability; return result;
    }).catch(error => { flight = null; throw error; });
    return flight;
  };
  return {
    begin,
    async manual(code) { input = acquisitionQuery('https://www.flupflap.com/join?promo=' + encodeURIComponent(code));
      if (!input.promo) throw new Error('Invalid promotion'); receipt = null; flight = null; return begin(); },
    async signupStarted() { await begin(); if (receipt) await client.marketingSignupStarted(receipt); },
    async claim() { await begin(); if (receipt) { await client.request('/marketing/attribution', { method: 'POST', body: { capability: receipt } }); receipt = null; } },
    link: (path, register = false) => acquisitionLink(path, input, register),
    clear() { receipt = null; flight = null; input = {}; },
  };
}

export function marketingControls({ doc, client, url }) {
  const node = (tag, text, className) => { const n = doc.createElement(tag); if (text) n.textContent = text; if (className) n.className = className; return n; };
  const acquisition = createAcquisition(client, url);
  const panel = node('details', null, 'marketing-controls');
  const summary = node('summary', t('marketingShare'));
  const status = node('p'); status.setAttribute('role','status');
  const referralCode = node('p', null, 'marketing-referral-code'); referralCode.hidden = true;
  const link = node('input'); link.readOnly = true; link.setAttribute('aria-label', t('marketingReferralLink'));
  const copy = node('button', t('marketingCopy')); copy.type = 'button';
  const whatsapp = node('a','WhatsApp'); const sms = node('a','SMS');
  const qr = node('img'); qr.width = 180; qr.height = 180; qr.alt = t('marketingQr'); qr.hidden = true;
  const actions = node('div', null, 'marketing-share-actions'); actions.append(copy, whatsapp, sms);
  panel.append(summary, status, referralCode, link, actions, qr);
  let loaded = false, generation = 0, available = false;
  panel.addEventListener('toggle', async () => {
    if (!panel.open || loaded || !available) return;
    const version = generation;
    status.textContent = t('marketingLoading');
    try {
      const data = await client.request('/marketing/share');
      if (version !== generation) return;
      const safe = safeShareUrl(data.url); if (!safe) throw new Error('Invalid share link');
      if (typeof data.code !== 'string' || !/^[a-f0-9]{32}$/.test(data.code)) throw new Error('Invalid referral code');
      referralCode.textContent = `Referral code: ${data.code}`; referralCode.hidden = false;
      link.value = safe; whatsapp.href = 'https://wa.me/?text=' + encodeURIComponent(`Join FlupFlap with my referral code ${data.code}: ${safe}`); sms.href = 'sms:?body=' + encodeURIComponent(`Join FlupFlap with my referral code ${data.code}: ${safe}`);
      loaded = true; status.textContent = '';
      const image = await client.request('/marketing/share/qr');
      if (version === generation && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image.dataUrl)) { qr.src = image.dataUrl; qr.hidden = false; }
    } catch { if (version === generation) status.textContent = t('marketingUnavailable'); }
  });
  copy.addEventListener('click', async () => {
    if (!safeShareUrl(link.value)) return;
    try { await doc.defaultView.navigator.clipboard.writeText(link.value); status.textContent = t('marketingCopied'); }
    catch { link.focus(); link.select(); status.textContent = t('marketingCopyManually'); }
  });
  const promo = node('div', null, 'marketing-promo');
  const label = node('label', t('marketingPromo')); label.htmlFor = 'marketing-code';
  const code = node('input'); code.id = 'marketing-code'; code.maxLength = 32; code.autocomplete = 'off';
  const apply = node('button',t('marketingSavePromo')); apply.type = 'button';
  const feedback = node('p'); feedback.setAttribute('role','status');
  promo.append(label, code, apply, feedback);
  apply.addEventListener('click', async () => {
    apply.disabled = true;
    try { await acquisition.manual(code.value); feedback.textContent = t('marketingPromoSaved'); }
    catch { feedback.textContent = t('marketingPromoUnavailable'); }
    finally { apply.disabled = false; }
  });
  const unsubscribe = onLanguageChange(() => {
    summary.textContent = t('marketingShare'); copy.textContent = t('marketingCopy'); label.textContent = t('marketingPromo'); apply.textContent = t('marketingSavePromo');
    qr.alt = t('marketingQr'); link.setAttribute('aria-label', t('marketingReferralLink')); status.textContent = ''; feedback.textContent = '';
  });
  return { panel, promo, acquisition,
    async authenticated(user) {
      available = user?.guest !== true; panel.hidden = !available;
      try { await acquisition.claim(); } catch { feedback.textContent = t('marketingPromoUnavailable'); }
    },
    reset() { generation++; available = loaded = false; panel.open = false; panel.hidden = true; referralCode.textContent = ''; referralCode.hidden = true; link.value = ''; qr.removeAttribute('src'); qr.hidden = true; whatsapp.removeAttribute('href'); sms.removeAttribute('href'); },
    dispose() { unsubscribe(); acquisition.clear(); },
  };
}

// Display stored server quote fields only; no discount or eligibility calculation here.
export function promotionRows(quote, money) {
  const p = quote?.promotion;
  return p ? [['marketingPromotion', p.name], ['marketingOriginalFee', money(p.originalFeeCents / 100, 'USD')],
    ['marketingBenefit', money(p.benefitCents / 100, 'USD')],
    ['marketingConditions', t(p.firstRechargeOnly ? 'marketingFirstRecharge' : 'marketingQuoteOnly')]] : [];
}
