import { ApiError } from './api-client.js';

const root = '/mobile-topups';
const invalid = (message) => new ApiError('INVALID_RESPONSE', message);
export function internationalPhone(value) {
  const compact = value.trim().replace(/[\s().-]/g, '').replace(/^00/, '+');
  if (!/^\+[1-9]\d{7,14}$/.test(compact)) throw new ApiError('INVALID_TOPUP_PHONE', 'Enter the full international phone number, including + and its country code.');
  return compact;
}
export function searchCountries(countries, search) {
  const term = search.trim().toLocaleLowerCase();
  return countries.filter((country) => `${country.name} ${country.code}`.toLocaleLowerCase().includes(term));
}
export function secureId(crypto = globalThis.crypto) {
  if (crypto?.randomUUID) return crypto.randomUUID();
  if (!crypto?.getRandomValues) throw new ApiError('SECURE_CONTEXT_REQUIRED', 'A secure browser connection is required to confirm.');
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function assertTestService(status) {
  if (status?.environment !== 'SANDBOX' || status.paymentMode !== 'MOCK' || status.testMode !== true ||
      status.productionEnabled !== false || status.approvedForLiveUse !== false || status.liveRechargeEnabled !== false) {
    throw new ApiError('UNSAFE_ENVIRONMENT', 'Test recharge is unavailable: this service has not confirmed test mode.');
  }
  if (!status.enabled) throw new ApiError('MOBILE_TOPUP_DISABLED', 'Test recharge is currently disabled. Please try again later.');
}
function array(data, key) {
  if (!Array.isArray(data?.[key])) throw invalid('The service returned an incomplete catalog.');
  return data[key];
}
function validOperator(operator, country) {
  return Number.isSafeInteger(operator?.id) && operator.id > 0 && operator.countryCode === country && operator.status === true;
}
function validateQuote(quote) {
  if (!quote?.id || !quote.countryCode || !quote.recipientPhone || !quote.operatorId || !quote.productId ||
      ![quote.providerAmount, quote.feeUsd, quote.totalChargeUsd].every((v) => Number.isFinite(v) && v >= 0) ||
      !Number.isFinite(Date.parse(quote.expiresAt))) throw invalid('The service returned an incomplete quote.');
  return quote;
}

export class Recharge {
  constructor(api, { onChange = () => {}, crypto = globalThis.crypto, now = Date.now } = {}) {
    this.api = api; this.onChange = onChange; this.crypto = crypto; this.now = now;
    this.revision = 0; this.generation = 0; this.busy = new Set();
    this.reset();
  }
  reset() {
    this.generation += 1; this.revision += 1; this.busy.clear();
    this.state = { ready: false, countries: [], country: '', phone: '', operators: [], operator: null, products: [],
      product: null, amount: '', quote: null, reviewed: false, transaction: null, history: [], recipients: [],
      attempt: null, submitting: false, error: '', notice: '', historyError: '', recipientsError: '' };
    this.emit();
  }
  emit() { this.onChange(this.state, this.busy); }
  editable() {
    if (this.state.submitting || this.state.attempt) throw new ApiError('PENDING_CONFIRMATION', 'Resolve the current confirmation before starting another recharge.');
  }
  invalidate() {
    this.revision += 1;
    Object.assign(this.state, { quote: null, reviewed: false, transaction: null, error: '', notice: '' });
  }
  clearOperator() { Object.assign(this.state, { operator: null, products: [], product: null, amount: '' }); }
  async run(name, action, current = () => true) {
    if (this.busy.has(name)) return;
    const generation = this.generation;
    const active = () => generation === this.generation && current();
    this.busy.add(name); this.state.error = ''; this.emit();
    try { return await action(active); }
    catch (error) { if (active()) this.state.error = error.message || 'This request could not be completed.'; }
    finally { if (generation === this.generation) { this.busy.delete(name); this.emit(); } }
  }
  async start() {
    await this.run('catalog', async (active) => {
      assertTestService(await this.api.request(`${root}/status`));
      const countries = array(await this.api.request(`${root}/countries`), 'countries');
      if (countries.some((c) => !/^[A-Z]{2}$/.test(c.code) || typeof c.name !== 'string')) throw invalid('Invalid country catalog.');
      if (active()) { this.state.countries = countries; this.state.ready = true; }
    });
    if (this.state.ready) await Promise.all([this.loadHistory(), this.loadRecipients()]);
  }
  async selectCountry(code) {
    this.editable(); this.invalidate(); this.clearOperator();
    Object.assign(this.state, { country: code, phone: '', operators: [] }); this.emit();
    if (!this.state.countries.some((c) => c.code === code)) return;
    await this.loadOperators();
  }
  setPhone(value) {
    this.editable(); this.invalidate(); this.clearOperator(); this.state.phone = value; this.emit();
  }
  async loadOperators() {
    const country = this.state.country;
    // A country switch can overlap an older request. Each result is country-bound.
    return this.run(`operators:${country}`, async (active) => {
      const operators = array(await this.api.request(`${root}/operators?${new URLSearchParams({ country })}`), 'operators');
      if (operators.some((op) => !validOperator(op, country))) throw invalid('An operator did not match the selected country.');
      if (active()) this.state.operators = operators;
    }, () => this.state.country === country);
  }
  async detect() {
    this.editable(); this.invalidate(); this.clearOperator();
    const revision = this.revision;
    return this.run('detect', async (active) => {
      const country = this.state.country;
      const phone = internationalPhone(this.state.phone);
      const { operator } = await this.api.request(`${root}/operators/detect?${new URLSearchParams({ country, phone })}`);
      if (!validOperator(operator, country)) throw invalid('The detected operator is unavailable for this country.');
      if (active()) {
        if (!this.state.operators.some((op) => op.id === operator.id)) this.state.operators.push(operator);
        await this.selectOperator(operator.id);
      }
    }, () => this.revision === revision);
  }
  async selectOperator(id) {
    this.editable(); this.invalidate(); this.clearOperator();
    const operator = this.state.operators.find((op) => op.id === Number(id));
    this.state.operator = operator || null; this.emit();
    if (!operator) return;
    const revision = this.revision;
    return this.run(`products:${revision}`, async (active) => {
      const data = await this.api.request(`${root}/operators/${operator.id}/products?${new URLSearchParams({ country: this.state.country })}`);
      const products = array(data, 'products');
      if (!validOperator(data.operator, operator.countryCode) || data.operator.id !== operator.id || products.some((p) =>
        p.operatorId !== operator.id || p.countryCode !== operator.countryCode || !['FIXED', 'RANGE'].includes(p.amountType))) {
        throw invalid('The product catalog did not match the selected operator.');
      }
      if (active()) this.state.products = products;
    }, () => this.revision === revision);
  }
  selectProduct(id) {
    this.editable(); this.invalidate(); this.state.product = this.state.products.find((p) => p.id === id) || null;
    this.state.amount = ''; this.emit();
  }
  setAmount(value) { this.editable(); this.invalidate(); this.state.amount = value; this.emit(); }
  quoteBody() {
    const { country, phone, operator, product, amount } = this.state;
    if (!operator || !product || product.operatorId !== operator.id || product.countryCode !== country) {
      throw new ApiError('SELECTION_REQUIRED', 'Choose an operator and a recharge product.');
    }
    const body = { countryCode: country, phone: internationalPhone(phone), operatorId: operator.id, productId: product.id };
    if (product.amountType === 'RANGE') {
      if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || Number(amount) < product.minimumAmount || Number(amount) > product.maximumAmount) {
        throw new ApiError('INVALID_TOPUP_AMOUNT', 'Enter an amount within the displayed range, using up to two decimal places.');
      }
      body.amount = Number(amount);
    }
    return body;
  }
  async getQuote() {
    this.editable(); this.invalidate(); const revision = this.revision;
    return this.run('quote', async (active) => {
      const body = this.quoteBody();
      const quote = validateQuote((await this.api.request(`${root}/quotes`, { method: 'POST', body })).quote);
      if (quote.countryCode !== body.countryCode || quote.recipientPhone !== body.phone || quote.operatorId !== body.operatorId || quote.productId !== body.productId) {
        throw invalid('The quote did not match your selection. Request a new quote.');
      }
      if (active()) this.state.quote = quote;
    }, () => this.revision === revision);
  }
  review(value) { this.state.reviewed = Boolean(value) && this.quoteValid(); this.emit(); }
  quoteValid() { return Boolean(this.state.quote && Date.parse(this.state.quote.expiresAt) > this.now()); }
  async confirm() {
    if (this.state.submitting || this.state.transaction) return;
    if (!this.state.attempt && (!this.state.reviewed || !this.quoteValid())) {
      this.state.error = 'Review a current quote before confirming.'; this.emit(); return;
    }
    // Keep the exact payload/key on a timeout, server error, or lost response.
    // Never generate a second key to retry an uncertain purchase.
    if (!this.state.attempt) {
      try { this.state.attempt = { body: { quoteId: this.state.quote.id }, key: secureId(this.crypto) }; }
      catch (error) { this.state.error = error.message; this.emit(); return; }
    }
    this.state.submitting = true;
    const generation = this.generation;
    const attempt = this.state.attempt;
    await this.run('confirm', async (active) => {
      let transaction;
      try {
        assertTestService(await this.api.request(`${root}/status`));
        ({ transaction } = await this.api.request(`${root}/transactions`, {
          method: 'POST', body: attempt.body, headers: { 'Idempotency-Key': attempt.key },
        }));
      } catch (error) {
        // Only explicit pre-reservation rejections release the attempt. Provider
        // failures may occur after reservation, so all other errors retain it.
        if (active() && ['TOPUP_QUOTE_EXPIRED', 'TOPUP_QUOTE_NOT_FOUND', 'MOBILE_TOPUP_DISABLED', 'UNSAFE_ENVIRONMENT'].includes(error.code)) {
          this.state.attempt = null; this.state.quote = null; this.state.reviewed = false;
        }
        throw error;
      }
      if (!transaction?.id || transaction.testMode !== true || transaction.quoteId !== attempt.body.quoteId) throw invalid('Unable to verify the confirmation. Refresh history before trying again.');
      if (active()) {
        this.state.transaction = transaction; this.state.attempt = null; this.state.quote = null; this.state.reviewed = false;
        this.state.history = [transaction, ...this.state.history.filter((t) => t.id !== transaction.id)];
      }
    });
    if (generation === this.generation) { this.state.submitting = false; this.emit(); }
  }
  async loadHistory() {
    return this.run('history', async (active) => {
      try {
        const transactions = array(await this.api.request(`${root}/transactions`), 'transactions');
        if (active()) {
          this.state.history = transactions; this.state.historyError = '';
          const match = this.state.attempt && transactions.find((t) => t.quoteId === this.state.attempt.body.quoteId && t.testMode === true);
          if (match) { this.state.transaction = match; this.state.attempt = null; this.state.quote = null; this.state.reviewed = false; }
        }
      } catch (error) { if (active()) this.state.historyError = error.message; }
    });
  }
  async loadRecipients() {
    return this.run('recipients', async (active) => {
      try {
        const recipients = array(await this.api.request(`${root}/recipients`), 'recipients');
        if (active()) { this.state.recipients = recipients; this.state.recipientsError = ''; }
      } catch (error) { if (active()) this.state.recipientsError = error.message; }
    });
  }
  async useRecipient(id) {
    this.editable();
    const saved = this.state.recipients.find((r) => r.id === id);
    if (!saved || !this.state.countries.some((c) => c.code === saved.countryCode)) {
      this.state.error = 'This recipient’s country is not currently available.'; this.emit(); return;
    }
    const pendingCountry = this.selectCountry(saved.countryCode);
    const revision = this.revision;
    await pendingCountry;
    if (this.revision !== revision) return;
    this.setPhone(saved.phone);
    if (saved.operatorId) await this.selectOperator(saved.operatorId);
  }
  async refreshTransaction(id = this.state.transaction?.id) {
    if (!id) return;
    const revision = this.revision;
    return this.run('receipt', async (active) => {
      const { transaction } = await this.api.request(`${root}/transactions/${encodeURIComponent(id)}?refresh=true`);
      if (transaction?.id !== id || transaction.testMode !== true) throw invalid('Unable to verify the test receipt.');
      if (active()) {
        this.state.transaction = transaction;
        this.state.history = this.state.history.map((t) => t.id === id ? transaction : t);
      }
    }, () => this.revision === revision);
  }
  async repeat(id) {
    this.editable(); this.invalidate(); this.clearOperator();
    const revision = this.revision;
    return this.run('repeat', async (active) => {
      const quote = validateQuote((await this.api.request(`${root}/transactions/${encodeURIComponent(id)}/repeat`, { method: 'POST' })).quote);
      if (active()) {
        // Repeat is re-priced by the backend, never a replay of a historic charge.
        Object.assign(this.state, { country: quote.countryCode, phone: quote.recipientPhone, operators: [], quote,
          notice: 'A fresh quote was requested for this previous recharge. Review the new price before confirming.' });
      }
    }, () => this.revision === revision);
  }
}
