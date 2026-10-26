/* Small silent loops replace multi-megabyte gameplay GIF downloads. */
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const observer = new IntersectionObserver(entries => {
    for (const {target: video, isIntersecting} of entries) {
      if (!video.isConnected) { observer.unobserve(video); continue; }
      if (isIntersecting && !reduced.matches) {
        if (!video.getAttribute('src')) video.src = video.dataset.videoSrc;
        video.play().catch(() => { video.controls = true; });
      } else video.pause();
    }
  }, {rootMargin:'120px'});
  window.wlCreateGameplayLoop = (name, label, width, height) => {
    const video = document.createElement('video');
    video.className = 'gameplay-loop'; video.muted = true;
    video.loop = true; video.playsInline = true; video.preload = 'none';
    video.width = width; video.height = height;
    video.setAttribute('aria-label', label);
    video.poster = '/assets/gameplay-' + name + '-poster.webp';
    video.dataset.videoSrc = '/assets/gameplay-' + name + '.mp4';
    if (reduced.matches) {
      video.controls = true;
      video.addEventListener('pointerdown', () => {
        if (!video.getAttribute('src')) video.src = video.dataset.videoSrc;
      }, {once:true});
    }
    observer.observe(video);
    return video;
  };
})();
