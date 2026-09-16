(() => {
  const script = document.currentScript;
  if (!script) return;
  const origin = new URL(script.src).origin;
  const frame = document.createElement('iframe');
  const url = new URL('/shop/', origin);
  if (script.dataset.language) url.searchParams.set('lang', script.dataset.language);
  if (script.dataset.currency) url.searchParams.set('currency', script.dataset.currency);
  frame.src = url.href;
  frame.title = 'WonderLang';
  frame.style.cssText = 'width:100%;height:1800px;border:0;display:block';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  window.addEventListener('message', event => {
    if (event.origin !== origin || event.source !== frame.contentWindow || event.data?.type !== 'wonderlang-shop-height') return;
    const height = Number(event.data.height);
    if (Number.isFinite(height) && height >= 200 && height <= 12000) frame.style.height = Math.ceil(height) + 'px';
  });
  script.after(frame);
})();
