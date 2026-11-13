export function initScrollReveals() {
  if (!('IntersectionObserver' in window)) return;

  const motion = window.matchMedia('(prefers-reduced-motion: no-preference)');
  const targets = document.querySelectorAll('[data-reveal], [data-reveal-group] > *');
  const observer = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      target.classList.replace('atlas-pending', 'atlas-revealed');
      observer.unobserve(target);
    }
  }, { rootMargin: '0px 0px -24px 0px' });

  const syncPreference = () => {
    observer.disconnect();
    if (!motion.matches) {
      targets.forEach((target) => target.classList.remove('atlas-pending', 'atlas-revealed'));
      return;
    }

    // Read positions first. Content already in view stays visible on initial load.
    const belowViewport = [...targets].filter((target) => target.getBoundingClientRect().top >= window.innerHeight);
    belowViewport.forEach((target) => {
      observer.observe(target);
      target.classList.add('atlas-pending');
    });
  };

  syncPreference();
  motion.addEventListener('change', syncPreference);
}
