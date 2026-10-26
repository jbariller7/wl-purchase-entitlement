/* Static campaign localization. No translation service or server invocation. */
(() => {
  'use strict';
  const config = JSON.parse(document.getElementById('beyond-language-config').textContent);
  const options = new Map(config.languages);
  const select = document.getElementById('wl-lang-select');
  const status = document.getElementById('wl-language-status');
  const cache = new Map();
  let sequence = 0;
  const readSaved = () => { try { return localStorage.getItem('wl_lang'); } catch { return null; } };
  const save = value => { try { localStorage.setItem('wl_lang', value); } catch {} };
  function normalize(value) {
    if (!value) return null;
    const tag = String(value).replaceAll('_', '-').toLowerCase();
    const exact = [...options.keys()].find(key => key.toLowerCase() === tag);
    if (exact) return exact;
    const base = tag.split('-')[0];
    if (base === 'zh') return 'zh-CN';
    if (base === 'pt') return tag.includes('-pt') ? 'pt-PT' : 'pt-BR';
    if (base === 'es') return tag === 'es' || tag.includes('-es') ? 'es' : 'es-MX';
    return options.has(base) ? base : null;
  }
  const available = new Set(config.available);
  function resolve(candidates) {
    for (const value of candidates) {
      const lang = normalize(value);
      if (available.has(lang)) return lang;
    }
    return 'en';
  }
  // Capture the approved source once. Locale changes never translate a translation.
  const units = [...document.querySelectorAll('[data-i18n]')].map(node => ({node, key: node.dataset.i18n, original: node.innerHTML}));
  const attributes = ['alt', 'aria-label', 'title', 'placeholder', 'content'];
  const attrs = attributes.flatMap(attr => [...document.querySelectorAll(`[data-i18n-${attr}]`)].map(node => ({node, attr, key: node.getAttribute(`data-i18n-${attr}`), original: node.getAttribute(attr)})));
  const images = [...document.querySelectorAll('img[src],img[data-asset-key]')].map(node => ({node, original: node.dataset.defaultSrc || node.getAttribute('src'), key: node.dataset.assetKey || node.getAttribute('src').split('?')[0], srcset: node.dataset.defaultSrcset || node.getAttribute('srcset') || ''}));
  const applyCaptions = lang => {
    document.querySelectorAll('video[data-subtitles]').forEach(video => {
      let track=video.querySelector('track');
      if(track?.srclang===lang){track.track.mode='showing';return;}
      video.querySelectorAll('track').forEach(old=>old.remove());
      track=document.createElement('track');track.kind='subtitles';track.srclang=lang;
      track.label=options.get(lang)||lang;
      track.src=`i18n/subtitles/${video.dataset.subtitlePrefix||''}${lang}.vtt?v=${config.version}`;
      video.append(track);track.track.mode='showing';
    });
  };
  function restoreDefaultImages(){
    for(const image of images) if(!image.node.getAttribute('src')){
      if(image.srcset)image.node.setAttribute('srcset',image.srcset);
      image.node.src=image.original;
    }
  }
  async function changeLanguage(lang, userInitiated = false) {
    const request = ++sequence;
    select.disabled = true;
    try {
      let bundle = cache.get(lang);
      if (!bundle) {
        const response = await fetch(`${config.bundlePath || 'i18n'}/${lang}.json?v=${config.version}`);
        if (!response.ok) throw Error('Locale unavailable');
        bundle = await response.json();
        if (config.keys.some(key => typeof bundle.text[key] !== 'string' || !bundle.text[key])) throw Error('Incomplete locale');
        cache.set(lang, bundle);
      }
      if (request !== sequence) return;
      for (const unit of units) unit.node.innerHTML = bundle.text[unit.key];
      for (const unit of attrs) unit.node.setAttribute(unit.attr, bundle.text[unit.key]);
      for (const image of images) {
        const path = image.key;
        const asset = bundle.responsiveAssets?.[path];
        const srcset = asset?.srcset || image.srcset;
        if(srcset) image.node.setAttribute('srcset',srcset);
        else image.node.removeAttribute('srcset');
        image.node.src = asset?.src || bundle.assets?.[path] || image.original;
        if(asset){image.node.width=asset.width;image.node.height=asset.height;}
      }
      document.documentElement.lang = lang;
      document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
      document.getElementById('wl-language-label').textContent = bundle.ui.language;
      select.setAttribute('aria-label', bundle.ui.language);
      status.textContent = '';
      select.value = lang;
      applyCaptions(lang);
      // Carry explicit language choices between the story and reservation pages.
      // Never attach checkout session tokens or mutate payment links.
      document.querySelectorAll('a[href]').forEach(link => {
        const url = new URL(link.getAttribute('href'), location.href);
        const base = new URL('./', location.href);
        const isTerms = url.pathname === base.pathname + 'reservation-terms.html';
        const onReservationPage = /\/(?:reserved|reservation-terms|checkout-error)\.html$/.test(location.pathname);
        const isReturn = onReservationPage && url.pathname === base.pathname && ['#rewards', '#top'].includes(url.hash);
        if (url.origin !== base.origin || (!isTerms && !isReturn)) return;
        url.searchParams.set('lang', lang);
        link.setAttribute('href', url.pathname + url.search + url.hash);
      });
      if (userInitiated) {
        save(lang);
        const url = new URL(location.href);
        url.searchParams.set('lang', lang);
        history.replaceState(history.state, '', url);
      }
      document.dispatchEvent(new CustomEvent('beyond:language', {detail: {language: lang, text: bundle.text, tiers: bundle.tiers || {}}}));
    } catch (error) {
      // Leave the last fully rendered language in place when offline or on failure.
      if (request === sequence) {
        restoreDefaultImages();
        select.value = document.documentElement.lang || 'en';
        status.textContent = cache.get(document.documentElement.lang)?.ui.failure || config.failure;
        console.warn('Beyond language could not be loaded', error);
      }
    } finally {
      if (request === sequence) select.disabled = false;
    }
  }
  for (const [value, label] of config.languages) {
    if (!available.has(value)) continue;
    const option = new Option(label, value);
    option.lang = value;
    select.add(option);
  }
  select.addEventListener('change', () => changeLanguage(select.value, true));
  document.querySelectorAll('video[data-subtitles]').forEach(video => video.addEventListener('loadedmetadata', () => applyCaptions(document.documentElement.lang)));
  const initial = resolve([new URLSearchParams(location.search).get('lang'), readSaved(), ...(navigator.languages || [navigator.language])]);
  changeLanguage(initial);
})();
