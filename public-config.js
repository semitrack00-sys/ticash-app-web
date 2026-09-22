// Public configuration only. Never add credentials or secrets here.
window.TICASH_PUBLIC_CONFIG = Object.freeze({
  // Confirmed TiCash test backend URL ending in /api; empty disables sign-in.
  // HTTPS required except between a localhost page and a localhost API.
  apiBaseUrl: 'https://ticash-api.onrender.com/api',
  androidPublished: false,
  iosPublished: false,
  sendMoneyLive: false,
  mobileRechargeLive: false,
});
