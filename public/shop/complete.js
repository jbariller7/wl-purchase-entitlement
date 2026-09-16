(() => {
  const sessionId = new URLSearchParams(location.search).get('session_id');
  if (!/^cs_(test_|live_)?[A-Za-z0-9_]+$/.test(sessionId || '')) return;
  sessionStorage.setItem('wl-purchase-pending', sessionId);
  location.replace('/account/');
})();
