(() => {
  const sessionId = new URLSearchParams(location.search).get('session_id');
  if (!/^cs_(test_|live_)?[A-Za-z0-9_]+$/.test(sessionId || '')) return;
  sessionStorage.setItem('wl-purchase-pending', sessionId);
  try {
    const recovery=JSON.parse(sessionStorage.getItem('wl-purchase:'+sessionId)||'{}');
    if(recovery.locale)localStorage.setItem('wonderlang-account-language',recovery.locale);
  } catch {}
  location.replace('/account/');
})();
