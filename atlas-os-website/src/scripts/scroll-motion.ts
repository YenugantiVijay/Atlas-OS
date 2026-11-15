export function initScrollReveals() {
  if (!('IntersectionObserver' in window)) return;

  const motion = window.matchMedia('(prefers-reduced-motion: no-preference)');
  const targets = new Set(document.querySelectorAll('[data-enter], [data-reveal], [data-reveal-group] > *'));
  document.querySelectorAll('#main-content section').forEach((section) => {
    if (section.closest('[data-enter], [data-reveal], [data-reveal-group]') ||
        section.querySelector('[data-enter], [data-reveal], [data-reveal-group], section')) return;
    const heading = section.querySelector('h1, h2, h3');
    const content = [...section.children].find((child) => child.contains(heading)) ?? section.firstElementChild;
    if (content) targets.add(content);
  });
  const observer = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      target.classList.replace('atlas-pending', 'atlas-revealed');
      observer.unobserve(target);
    }
  }, { rootMargin: '0px 0px -24px 0px' });

  let initial = true;
  const syncPreference = () => {
    observer.disconnect();
    if (!motion.matches) {
      targets.forEach((target) => target.classList.remove('atlas-pending', 'atlas-revealed', 'atlas-visible-entry'));
      initial = false;
      return;
    }

    const positions = [...targets].map((target) => ({ target, bounds: target.getBoundingClientRect() }));
    const belowViewport = positions.filter(({ bounds }) => bounds.height > 0 && bounds.top >= window.innerHeight).map(({ target }) => target);
    if (initial) {
      positions.forEach(({ target, bounds }) => {
        if (bounds.height > 0 && bounds.bottom > 0 && bounds.top < window.innerHeight && !target.closest('[data-enter]')) {
          target.classList.add('atlas-visible-entry');
        }
      });
      initial = false;
    }
    belowViewport.forEach((target) => {
      observer.observe(target);
      target.classList.add('atlas-pending');
    });
  };

  syncPreference();
  motion.addEventListener('change', syncPreference);
}
