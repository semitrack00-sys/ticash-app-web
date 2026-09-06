(function () {
  'use strict';

  function recordAction(action) {
    if (!action) return;
    var event = {
      event: 'ticash_web_action',
      action: action,
      page: window.location.pathname,
    };
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(event);
    window.dispatchEvent(new CustomEvent('ticash:analytics', { detail: event }));
  }

  document.addEventListener('click', function (event) {
    var target = event.target.closest('[data-analytics]');
    if (target) recordAction(target.getAttribute('data-analytics'));
  });
})();
