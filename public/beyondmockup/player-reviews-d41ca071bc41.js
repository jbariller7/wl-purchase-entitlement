/* Public Steam review carousel. Original screenshots stay in their source language. */
(() => {
  'use strict';
  const root = document.querySelector('.wl-player-reviews');
  if (!root) return;
  const slides = [...root.querySelectorAll('.wl-review-slide')];
  const dots = [...root.querySelectorAll('[data-review-index]')];
  const toggle = root.querySelector('[data-review-action="toggle"]');
  const label = toggle.querySelector('span');
  const status = root.querySelector('.wl-review-status');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let index = 0, timer, inView = false, hover = false, focus = false, userPaused = reduce.matches;
  let strings = {reviewsPause: 'Pause slideshow', reviewsPlay: 'Play slideshow'};
  function load(i) {
    const img = slides[i].querySelector('img');
    if (!img.src) img.src = img.dataset.reviewSrc;
  }
  function paused() { return userPaused || !inView || hover || focus || document.hidden; }
  function schedule() {
    clearTimeout(timer);
    toggle.setAttribute('aria-pressed', String(userPaused));
    label.textContent = strings[userPaused ? 'reviewsPlay' : 'reviewsPause'];
    if (!paused()) timer = setTimeout(() => show(index + 1, false), +slides[index].dataset.duration || 45000);
  }
  function show(next, manual) {
    index = (next + slides.length) % slides.length;
    slides.forEach((slide, i) => { slide.hidden = i !== index; });
    dots.forEach((dot, i) => { dot.setAttribute('aria-current', i === index ? 'true' : 'false'); });
    load(index);
    if (inView) load((index + 1) % slides.length);
    if (manual) { userPaused = true; status.textContent = (index + 1) + ' / ' + slides.length; }
    schedule();
  }
  root.querySelector('[data-review-action="previous"]').addEventListener('click', () => show(index - 1, true));
  root.querySelector('[data-review-action="next"]').addEventListener('click', () => show(index + 1, true));
  toggle.addEventListener('click', () => { userPaused = !userPaused; if (!userPaused) { focus = false; hover = false; } schedule(); });
  dots.forEach(dot => dot.addEventListener('click', () => show(+dot.dataset.reviewIndex, true)));
  root.addEventListener('mouseenter', () => { hover = true; schedule(); });
  root.addEventListener('mouseleave', () => { hover = false; schedule(); });
  root.addEventListener('focusin', () => { focus = true; schedule(); });
  root.addEventListener('focusout', e => { if (!root.contains(e.relatedTarget)) { focus = false; schedule(); } });
  root.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    show(e.key === 'Home' ? 0 : e.key === 'End' ? slides.length - 1 : index + (e.key === 'ArrowRight' ? 1 : -1), true);
  });
  document.addEventListener('visibilitychange', schedule);
  document.addEventListener('beyond:language', e => { strings = {...strings, ...e.detail.text}; schedule(); });
  reduce.addEventListener('change', e => { if (e.matches) userPaused = true; schedule(); });
  const observer = new IntersectionObserver(entries => {
    inView = entries[0].isIntersecting;
    if (inView) { load(index); load((index + 1) % slides.length); }
    schedule();
  }, {threshold: .12});
  observer.observe(root);
  show(0, false);
})();

