/**
 * `reveal` — scroll-into-view enhancement action for journey sales sections.
 *
 * Mirrors the prototype's shared `fresh.js` reveal: the first time the node
 * crosses the viewport threshold it gains the `is-in` class and is unobserved
 * (one-shot). The paired CSS transitions `opacity`/`transform` from an armed
 * hidden state to the resting state.
 *
 * PROGRESSIVE ENHANCEMENT (SSR-safe). The hidden state is applied by THIS action
 * (`reveal--armed`), never in static CSS — so server-rendered HTML and no-JS /
 * reduced-motion clients paint the fully-revealed content and never get stuck
 * invisible. Motion is enhancement layered on top of a legible baseline, per the
 * journeys design brief (SPEC §6: "CSS-first motion, always degradable").
 *
 * Usage:
 *   <div use:reveal>…</div>              // default threshold/margin
 *   <div use:reveal={{ once: false }}>…  // re-arm when scrolled back out
 * Pair with `.reveal` + optional `.d1`…`.d5` stagger classes (see sell tokens).
 */
export interface RevealOptions {
  /** Visibility ratio that triggers the reveal. Default 0.12 (matches prototype). */
  threshold?: number;
  /** Observer root margin. Default trims 8% off the bottom so it fires a touch early. */
  rootMargin?: string;
  /** Re-hide + replay when the node leaves and re-enters. Default true (one-shot). */
  once?: boolean;
}

const ARMED = 'reveal--armed';
const IN = 'is-in';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function reveal(node: HTMLElement, options: RevealOptions = {}) {
  // No motion path: reduced-motion or environments without IntersectionObserver
  // (incl. SSR) reveal immediately and stay put — the accessible baseline.
  if (typeof IntersectionObserver === 'undefined' || prefersReducedMotion()) {
    node.classList.add(IN);
    return;
  }

  const once = options.once ?? true;

  // Arm from JS so no-JS never hides content.
  node.classList.add(ARMED);

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          node.classList.add(IN);
          if (once) observer.unobserve(entry.target);
        } else if (!once) {
          node.classList.remove(IN);
        }
      }
    },
    {
      threshold: options.threshold ?? 0.12,
      rootMargin: options.rootMargin ?? '0px 0px -8% 0px',
    }
  );

  observer.observe(node);

  return {
    destroy() {
      observer.disconnect();
    },
  };
}
