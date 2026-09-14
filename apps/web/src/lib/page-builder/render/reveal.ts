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
 * The `motion: none` axis value takes that same baseline path, read off the
 * section wrapper rather than passed in — see `motionAxisIsNone` below.
 *
 * Usage:
 *   <div use:reveal>…</div>                    // default threshold/margin
 *   <div use:reveal={{ once: false }}>…        // re-arm when scrolled back out
 *   <div use:reveal={{ disabled: editable }}>… // studio canvas: no motion
 * Pair with `.reveal` + optional `.d1`…`.d5` stagger classes (see sell tokens).
 */
export interface RevealOptions {
  /** Visibility ratio that triggers the reveal. Default 0.12 (matches prototype). */
  threshold?: number;
  /** Observer root margin. Default trims 8% off the bottom so it fires a touch early. */
  rootMargin?: string;
  /** Re-hide + replay when the node leaves and re-enters. Default true (one-shot). */
  once?: boolean;
  /**
   * Skip the observer entirely and reveal immediately — the same resting state
   * reduced-motion and SSR already get.
   *
   * Exists for the studio canvas (Codex-eckbx W1-W3). Scroll choreography cannot
   * run correctly inside an inner-scrolling device frame: the observer's root is
   * the viewport, so a section the author has scrolled to inside the canvas may
   * never intersect it and would stay armed — i.e. invisible — while being
   * edited. Suppressing motion is therefore a CORRECTNESS requirement of the
   * editing surface, not a preference.
   *
   * Note this takes the accessible baseline path rather than a bespoke one, so
   * the canvas shows exactly the fully-revealed state the public page settles
   * into. It is no longer the only correctness reason for that path:
   * `motion: none` now takes it too, from the axis on the wrapper.
   */
  disabled?: boolean;
}

const ARMED = 'reveal--armed';
const IN = 'is-in';

/**
 * The `motion` axis as published on the section wrapper. `SectionFrame.svelte`
 * is its only emitter, and every `use:reveal` node in the eleven sections is a
 * descendant of one.
 */
const MOTION_ATTR = 'data-jp-motion';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * `motion: none` — the one axis value whose whole claim is that the page does
 * not move — resolved from the nearest section wrapper.
 *
 * WHY THIS IS ON THE NO-MOTION PATH AT ALL. `[data-jp-motion='none']` zeroes
 * `--jp-reveal-distance`, `--jp-reveal-duration` and `--jp-reveal-stagger`, and
 * journey-sections-shared.css reads that as making the armed state "a genuine
 * no-op … rather than a fast animation". It is not a no-op: `.reveal--armed
 * .jp-reveal` still sets `opacity: 0`, and a 0ms transition does not animate the
 * copy in — it HIDES it from hydration until the observer's first callback
 * lands, then pops it. Measured on a jsdom mount of the real frame + section
 * pair: at `motion: none` all fifteen call sites armed an observer and left
 * their `.jp-reveal` descendants at `opacity: 0`. So the look whose axis says
 * nothing moves was the one delivering its copy as a pop, and any node the
 * observer never reports (the inner-scrolling case the `disabled` note below
 * describes) stayed hidden for good.
 *
 * WHY THE DOM RATHER THAN AN OPTION. An action has no `design` prop, and the
 * resolved axis is already on an ancestor of every node this is applied to, in
 * the SSR HTML (so it is there before hydration begins) and on client-side
 * mount. Actions run in a USER effect — `action()` in
 * `svelte/internal/client` wraps the call in `effect()` — which flushes after
 * the `template_effect` that sets a parent's attributes, so the value is
 * readable here even though the compiled parent instantiates the child BEFORE
 * setting the attribute (verified against Svelte 5.55.0). The alternative was
 * the same test repeated at fifteen call sites, six of whose sections do not
 * derive the value at all.
 *
 * FAIL-OPEN by construction: no wrapper, or any of the other five values, arms
 * exactly as before.
 */
function motionAxisIsNone(node: HTMLElement): boolean {
  return node.closest(`[${MOTION_ATTR}]`)?.getAttribute(MOTION_ATTR) === 'none';
}

export function reveal(node: HTMLElement, options: RevealOptions = {}) {
  // No motion path: explicitly disabled (the studio canvas), reduced-motion,
  // environments without IntersectionObserver (incl. SSR), or the `motion: none`
  // axis value reveal immediately and stay put — the accessible baseline. The
  // axis test is last because it walks the ancestor chain and the three cheap
  // reads above already settle most calls.
  if (
    options.disabled ||
    typeof IntersectionObserver === 'undefined' ||
    prefersReducedMotion() ||
    motionAxisIsNone(node)
  ) {
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
