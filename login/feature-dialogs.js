const dialog = document.getElementById('flupflap-feature-dialog');
const title = document.getElementById('feature-dialog-title');
const eyebrow = document.getElementById('feature-dialog-eyebrow');
const intro = document.getElementById('feature-dialog-intro');
const content = document.getElementById('feature-dialog-content');
const icon = dialog?.querySelector('.feature-dialog-icon');
const close = dialog?.querySelector('.feature-dialog-close');

const featureContent = {
  airtime: {
    eyebrow: 'AIRTIME TOP-UP',
    title: 'Recharge mobile airtime in a few steps',
    intro: 'FlupFlap lets you send prepaid mobile airtime to supported operators using the same TiCash-powered recharge flow.',
    iconClass: 'login-feature-recharge',
    items: [
      ['Choose a destination', 'Select the recipient country and mobile operator.'],
      ['Enter the mobile number', 'Review the recipient carefully before confirming.'],
      ['Choose an airtime amount', 'Available amounts and pricing come from the live provider catalog.'],
      ['Pay securely', 'Payment is processed through the existing TiCash checkout flow before fulfillment.'],
    ],
  },
  bundles: {
    eyebrow: 'DATA & BUNDLES',
    title: 'Send internet and mobile bundles where available',
    intro: 'Beyond airtime, FlupFlap can surface provider-backed data and bundle products for supported destinations and operators.',
    iconClass: 'login-feature-worldwide',
    items: [
      ['Internet data', 'Choose data products when the connected provider offers them.'],
      ['Mobile bundles', 'Available bundles can include data, minutes or SMS when supplied by the operator/provider.'],
      ['Worldwide reach', 'Coverage depends on the connected provider catalog, destination and operator availability.'],
      ['No invented plans', 'FlupFlap only shows products and values returned by its configured recharge providers.'],
    ],
  },
  company: {
    eyebrow: 'ABOUT FLUPFLAP',
    title: 'A TiCash-powered mobile recharge experience',
    intro: 'FlupFlap is the mobile recharge service presented by TiCash-App for sending airtime, data and supported bundles.',
    iconClass: 'login-feature-security',
    items: [
      ['Built on TiCash', 'Authentication, payments, transaction history and recharge orchestration use the TiCash platform.'],
      ['Provider-backed fulfillment', 'Recharge delivery is routed through configured providers such as DT One, Reloadly or Ding when available.'],
      ['Secure account access', 'Customers can sign in, use guest access, save recipients and review transaction history.'],
      ['Protected operational data', 'Provider credentials, payment secrets and internal administrative records are not exposed to customers.'],
    ],
  },
};

function renderFeature(key) {
  const feature = featureContent[key];
  if (!feature || !dialog) return;
  eyebrow.textContent = feature.eyebrow;
  title.textContent = feature.title;
  intro.textContent = feature.intro;
  icon.className = `feature-dialog-icon ${feature.iconClass}`;
  content.replaceChildren(...feature.items.map(([heading, body]) => {
    const section = document.createElement('section');
    const h3 = document.createElement('h3');
    const p = document.createElement('p');
    h3.textContent = heading;
    p.textContent = body;
    section.append(h3, p);
    return section;
  }));
  dialog.showModal();
}

document.querySelectorAll('[data-feature-dialog]').forEach((button) => {
  button.addEventListener('click', () => renderFeature(button.dataset.featureDialog));
});

close?.addEventListener('click', () => dialog.close());
dialog?.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});
