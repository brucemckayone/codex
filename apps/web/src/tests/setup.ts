// Import mocks BEFORE any other imports
// This ensures mocks are hoisted and applied before module loading
import './mocks';
import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

// JSDOM shim: Element.animate() is part of the Web Animations API and is not
// implemented in jsdom. Svelte transitions (fade/slide/fly) and Melt UI actions
// fall back to calling Element.animate() internally. Provide a minimal shim so
// these don't throw in unit tests. Real animation behaviour is covered by E2E.
type MinimalAnimation = Pick<
  Animation,
  | 'cancel'
  | 'finish'
  | 'play'
  | 'pause'
  | 'reverse'
  | 'addEventListener'
  | 'removeEventListener'
  | 'finished'
  | 'onfinish'
  | 'oncancel'
>;

if (typeof Element !== 'undefined') {
  const stubAnimate = (): MinimalAnimation => ({
    cancel: () => {},
    finish: () => {},
    play: () => {},
    pause: () => {},
    reverse: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    finished: Promise.resolve() as unknown as Animation['finished'],
    onfinish: null,
    oncancel: null,
  });
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    writable: true,
    value: stubAnimate,
  });

  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    writable: true,
    value: (): Animation[] => [],
  });
}

// JSDOM shim: window.matchMedia is not implemented in jsdom. Components read
// motion/theme preferences via `window.matchMedia('(prefers-reduced-motion: reduce)')`
// inside onMount (e.g. the journey sales-page sections), which would throw when
// those components are mounted in unit tests. Provide a minimal non-matching stub
// (matches:false = the full-motion default). Real reduced-motion / responsive
// behaviour is covered by E2E / in-browser verification.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  });
}

// Clean up DOM after each test (only if running in DOM environment)
afterEach(() => {
  if (typeof document !== 'undefined' && document.body) {
    document.body.innerHTML = '';
  }
});
