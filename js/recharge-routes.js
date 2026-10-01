// Deployment presentation only. The dedicated build sets this fixed marker;
// query parameters and host names cannot choose an API or redirect destination.
export function rechargePath(root) {
  return root.dataset.rechargePath === '/' ? '/' : '/recharge';
}

export function isRechargeResetPath(root, pathname) {
  return /^\/recharge\/reset-password\/?$/.test(pathname) ||
    (rechargePath(root) === '/' && /^\/reset-password\/?$/.test(pathname));
}

export function rechargeReturnPath(root) {
  const location = root.ownerDocument.defaultView.location;
  return rechargePath(root) + location.search + location.hash;
}
