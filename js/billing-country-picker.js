import { billingCountries } from './billing-countries.js';
import { t, getLanguage, localizeCountry, languageLocale } from './i18n.js';

// Search text is deliberately separate from the selected ISO code. Never write
// partial typing/autofill into checkout state or use recharge destination data.
export function createBillingCountryPicker(doc, onSelect) {
  const node = (tag, attributes = {}, text = '') => {
    const element = doc.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    element.textContent = text;
    return element;
  };
  const root = node('div', { class: 'billing-picker field', id: 'guest-billing-country' });
  const label = node('label', { for: 'billing-country-picker' });
  const trigger = node('button', { type: 'button', id: 'billing-country-picker', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'billing-country-menu', 'aria-describedby': 'billing-country-help' });
  const menu = node('div', { id: 'billing-country-menu', role: 'dialog', class: 'billing-picker-menu' });
  const search = node('input', { type: 'search', id: 'billing-country-search', role: 'combobox', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'none', spellcheck: 'false', 'aria-autocomplete': 'list', 'aria-controls': 'billing-country-options', 'aria-expanded': 'false' });
  const list = node('div', { id: 'billing-country-options', role: 'listbox' });
  const empty = node('p', { role: 'status', class: 'small' });
  const help = node('small', { id: 'billing-country-help' });
  menu.append(search, list, empty); root.append(label, trigger, menu, help);
  menu.hidden = true;
  let selected = '', language = '', active = -1, matches = [];
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  function close(focus = false) {
    menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); search.setAttribute('aria-expanded', 'false');
    search.removeAttribute('aria-activedescendant');
    if (focus) trigger.focus();
  }
  function highlight(index) {
    active = index;
    [...list.children].forEach((option, i) => option.classList.toggle('is-active', i === active));
    const option = list.children[active];
    if (option) { search.setAttribute('aria-activedescendant', option.id); option.scrollIntoView?.({ block: 'nearest' }); }
    else search.removeAttribute('aria-activedescendant');
  }
  function filter() {
    const query = normalize(search.value.trim());
    matches = billingCountries.filter(country => normalize(`${localizeCountry(country)} ${country.name} ${country.code}`).includes(query))
      .sort((a, b) => localizeCountry(a).localeCompare(localizeCountry(b), languageLocale()));
    list.replaceChildren(...matches.map(country => {
      const option = node('button', { type: 'button', role: 'option', tabindex: '-1', id: `billing-option-${country.code}`, 'data-billing-code': country.code, 'aria-selected': String(country.code === selected) }, localizeCountry(country));
      option.addEventListener('click', () => { close(true); onSelect(country.code); });
      return option;
    }));
    empty.hidden = matches.length > 0; empty.textContent = t('billingCountryNoResults');
    highlight(-1);
  }
  function open() {
    if (trigger.disabled) return;
    menu.hidden = false; trigger.setAttribute('aria-expanded', 'true'); search.setAttribute('aria-expanded', 'true');
    search.value = ''; filter(); search.focus();
  }
  trigger.addEventListener('click', () => menu.hidden ? open() : close());
  trigger.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open(); highlight(event.key === 'ArrowDown' ? 0 : matches.length - 1); }
  });
  search.addEventListener('input', filter);
  search.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); highlight(Math.max(0, Math.min(matches.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))));
    } else if (event.key === 'Enter') {
      event.preventDefault(); if (matches[active]) { const code = matches[active].code; close(true); onSelect(code); }
    }
  });
  root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(true); } });
  const outside = event => { if (!root.contains(event.target)) close(); };
  doc.addEventListener('click', outside);
  doc.addEventListener('focusin', outside);
  return {
    element: root,
    update(value, disabled, visible, reset = false) {
      root.hidden = !visible; trigger.disabled = disabled;
      if (!visible || disabled || reset) close();
      const changed = selected !== value || language !== getLanguage();
      selected = value; language = getLanguage();
      const country = billingCountries.find(item => item.code === selected);
      label.textContent = t('billingCountryLabel'); trigger.textContent = country ? localizeCountry(country) : t('billingCountryPlaceholder');
      menu.setAttribute('aria-label', t('billingCountryLabel'));
      search.setAttribute('aria-label', t('billingCountrySearch')); search.placeholder = t('billingCountrySearch');
      list.setAttribute('aria-label', t('billingCountryLabel')); help.textContent = t('billingCountryHelp');
      if (changed && !menu.hidden) filter();
    },
    dispose() { doc.removeEventListener('click', outside); doc.removeEventListener('focusin', outside); },
  };
}
