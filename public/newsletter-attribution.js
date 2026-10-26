/* MailerLite custom fields: shared by the main site and Beyond signup forms. */
(() => {
  'use strict';
  const keys = ['utm_source', 'utm_medium', 'utm_campaign'];
  const storageKey = 'wl-newsletter-utm-v1';
  const pageSource = /^\/beyondmockup(?:\/|$)/.test(location.pathname) ? 'beyond' : 'site';
  function values() {
    const query = new URLSearchParams(location.search);
    let rejected = false;
    try { rejected = localStorage.getItem('wl_measurement') === 'no'; } catch {}
    const allowed = !rejected && navigator.globalPrivacyControl !== true && window.wlMarketingConsent !== false && query.get('metaOptOut') !== '1';
    if (!allowed) {
      try { sessionStorage.removeItem(storageKey); } catch {}
      return {};
    }
    // Keep one campaign together; never combine a new ad's source with an old campaign.
    let result = {};
    if (keys.some(key => query.has(key))) {
      for (const key of keys) {
        const value = (query.get(key) || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255);
        if (value) result[key] = value;
      }
      try { sessionStorage.setItem(storageKey, JSON.stringify({values: result, expires: Date.now() + 30 * 60 * 1000})); } catch {}
    } else {
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
        if (saved?.expires > Date.now()) {
          for (const key of keys) if (typeof saved.values?.[key] === 'string') result[key] = saved.values[key].slice(0, 255);
        } else sessionStorage.removeItem(storageKey);
      } catch {}
    }
    return result;
  }
  function fill(form, attribution) {
    for (const key of [...keys, 'page_source']) {
      let input = form.querySelector(`input[name="fields[${key}]"]`);
      if (!input) {
        input = document.createElement('input'); input.type = 'hidden';
        input.name = `fields[${key}]`; form.append(input);
      }
      input.value = key === 'page_source' ? pageSource : attribution[key] || '';
      // Missing UTMs must not erase attribution on an existing subscriber.
      input.disabled = !input.value;
    }
  }
  function refresh() {
    const attribution = values();
    document.querySelectorAll('.ml-subscribe-form form').forEach(form => fill(form, attribution));
  }
  refresh();
  // Capture runs before MailerLite serializes the form, including after consent changes.
  document.addEventListener('submit', event => {
    if (event.target.matches('.ml-subscribe-form form')) fill(event.target, values());
  }, true);
  window.addEventListener('pageshow', refresh);
})();
