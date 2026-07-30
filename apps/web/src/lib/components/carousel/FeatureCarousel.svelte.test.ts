import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  test,
  vi,
} from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import FeatureCarousel from './FeatureCarousel.svelte';
import type { FeatureItem } from './feature-carousel.types';

/**
 * FeatureCarousel unit tests.
 *
 * jsdom ships no IntersectionObserver and no Element.prototype.scrollIntoView,
 * and `$app/environment`'s `browser` is `true` under Vitest (browser resolve
 * condition), so the component's IO-wiring $effect runs on mount. We stub both
 * APIs and assert the *wiring* (observer created against the track, every slide
 * observed, callback drives the active dot) — not pixel geometry, which jsdom
 * cannot produce.
 */

interface FakeEntry {
  target: Element;
  isIntersecting: boolean;
  intersectionRatio: number;
}

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: (entries: FakeEntry[], observer: MockIntersectionObserver) => void;
  root: Element | Document | null;
  observed: Element[] = [];
  disconnected = false;

  constructor(
    callback: (
      entries: FakeEntry[],
      observer: MockIntersectionObserver
    ) => void,
    options?: IntersectionObserverInit
  ) {
    this.callback = callback;
    this.root = (options?.root as Element | Document | null) ?? null;
    MockIntersectionObserver.instances.push(this);
  }

  observe(el: Element) {
    this.observed.push(el);
  }

  unobserve() {}

  disconnect() {
    this.disconnected = true;
  }

  takeRecords(): FakeEntry[] {
    return [];
  }
}

const threeItems: FeatureItem[] = [
  {
    id: 'a',
    title: 'Alpha',
    kind: 'Video',
    contentType: 'video',
    description: 'First',
    href: '/a',
  },
  {
    id: 'b',
    title: 'Beta',
    kind: 'Audio',
    contentType: 'audio',
    href: '/b',
    image: null,
  },
  {
    id: 'c',
    title: 'Gamma',
    kind: 'Article',
    contentType: 'article',
    href: '/c',
    image: 'https://example.test/c.jpg',
  },
];

// vitest 4: a bare `vi.fn()` is typed `Mock<Procedure | Constructable>`, which
// is not assignable to scrollIntoView's signature. Parameterise both the mock
// and its holder with the concrete signature (see feedback_vitest4_vi_fn).
type ScrollIntoViewFn = (arg?: boolean | ScrollIntoViewOptions) => void;

let component: ReturnType<typeof mount> | null = null;
let scrollIntoView: Mock<ScrollIntoViewFn>;

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  scrollIntoView = vi.fn<ScrollIntoViewFn>();
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  if (component) {
    unmount(component);
    component = null;
  }
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function dots() {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>('.feature-carousel__dot')
  );
}

describe('FeatureCarousel — rendering', () => {
  test('renders one slide per item with the region carousel role', () => {
    component = mount(FeatureCarousel, {
      target: document.body,
      props: { items: threeItems },
    });
    flushSync();

    const region = document.querySelector('.feature-carousel');
    expect(region?.getAttribute('aria-roledescription')).toBe('carousel');

    const slides = document.querySelectorAll('.feature-carousel__slide');
    expect(slides.length).toBe(threeItems.length);
  });

  test('renders one dot per item', () => {
    component = mount(FeatureCarousel, {
      target: document.body,
      props: { items: threeItems },
    });
    flushSync();

    expect(dots().length).toBe(threeItems.length);
  });

  test('slide surfaces title (as a link to href), kind eyebrow and description', () => {
    component = mount(FeatureCarousel, {
      target: document.body,
      props: { items: threeItems },
    });
    flushSync();

    const firstSlide = document.querySelector('.feature-carousel__slide');
    const titleLink = firstSlide?.querySelector<HTMLAnchorElement>(
      '.feature-carousel__title a'
    );
    expect(titleLink?.textContent).toContain('Alpha');
    expect(titleLink?.getAttribute('href')).toBe('/a');
    expect(
      firstSlide?.querySelector('.feature-carousel__eyebrow')?.textContent
    ).toContain('Video');
    expect(
      firstSlide?.querySelector('.feature-carousel__desc')?.textContent
    ).toContain('First');
  });

  test('imageless item gets the fallback media, image item gets an <img>', () => {
    component = mount(FeatureCarousel, {
      target: document.body,
      props: { items: threeItems },
    });
    flushSync();

    const media = document.querySelectorAll('.feature-carousel__media');
    // Items a + b have no image → fallback; item c has an image.
    expect(
      media[0]?.classList.contains('feature-carousel__media--fallback')
    ).toBe(true);
    expect(media[2]?.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.test/c.jpg'
    );
  });
});

describe('FeatureCarousel — dot navigation', () => {
  test('first dot is active on mount, others are not', () => {
    component = mount(FeatureCarousel, {
      target: document.body,
      props: { items: threeItems },
    });
    flushSync();

    const [first, second, third] = dots();
    expect(first?.getAttribute('aria-current')).toBe('true');
    expect(second?.hasAttribute('aria-current')).toBe(false);
    expect(third?.hasAttribute('aria-current')).toBe(false);
  });

  test('each dot has an addressable aria-label', () => {
    component = mount(FeatureCarousel, {
      target: document.body,
      props: { items: threeItems },
    });
    flushSync();

    dots().forEach((dot, i) => {
      expect(dot.getAttribute('aria-label')).toBe(`Go to feature ${i + 1}`);
    });
  });

  test('clicking a dot moves aria-current and scrolls its slide into view', () => {
    component = mount(FeatureCarousel, {
      target: document.body,
      props: { items: threeItems },
    });
    flushSync();

    dots()[2]?.click();
    flushSync();

    expect(dots()[0]?.hasAttribute('aria-current')).toBe(false);
    expect(dots()[2]?.getAttribute('aria-current')).toBe('true');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ inline: 'center' })
    );
  });
});

describe('FeatureCarousel — IntersectionObserver sync', () => {
  test('observes every slide against the track root', () => {
    component = mount(FeatureCarousel, {
      target: document.body,
      props: { items: threeItems },
    });
    flushSync();

    expect(MockIntersectionObserver.instances.length).toBe(1);
    const io = MockIntersectionObserver.instances[0];
    expect(io?.root).toBe(document.querySelector('.feature-carousel__track'));
    expect(io?.observed.length).toBe(threeItems.length);
  });

  test('an intersecting slide above threshold promotes its dot', () => {
    component = mount(FeatureCarousel, {
      target: document.body,
      props: { items: threeItems },
    });
    flushSync();

    const io = MockIntersectionObserver.instances[0];
    const slides = document.querySelectorAll('.feature-carousel__slide');
    // Simulate the 2nd slide (index 1) crossing the 0.6 threshold.
    io?.callback(
      [{ target: slides[1], isIntersecting: true, intersectionRatio: 0.7 }],
      io
    );
    flushSync();

    expect(dots()[1]?.getAttribute('aria-current')).toBe('true');
    expect(dots()[0]?.hasAttribute('aria-current')).toBe(false);
  });

  test('a slide below the 0.6 threshold does not steal active state', () => {
    component = mount(FeatureCarousel, {
      target: document.body,
      props: { items: threeItems },
    });
    flushSync();

    const io = MockIntersectionObserver.instances[0];
    const slides = document.querySelectorAll('.feature-carousel__slide');
    io?.callback(
      [{ target: slides[2], isIntersecting: true, intersectionRatio: 0.4 }],
      io
    );
    flushSync();

    // Still on the first slide — a half-visible neighbour must not win.
    expect(dots()[0]?.getAttribute('aria-current')).toBe('true');
    expect(dots()[2]?.hasAttribute('aria-current')).toBe(false);
  });

  test('disconnects the observer on unmount', () => {
    component = mount(FeatureCarousel, {
      target: document.body,
      props: { items: threeItems },
    });
    flushSync();

    const io = MockIntersectionObserver.instances[0];
    unmount(component);
    component = null;
    flushSync();

    expect(io?.disconnected).toBe(true);
  });
});

describe('FeatureCarousel — degenerate item counts', () => {
  test('a single item renders a slide but no dot row and no observer', () => {
    component = mount(FeatureCarousel, {
      target: document.body,
      props: { items: [threeItems[0]] },
    });
    flushSync();

    expect(document.querySelectorAll('.feature-carousel__slide').length).toBe(
      1
    );
    expect(document.querySelector('.feature-carousel__dots')).toBeNull();
    expect(dots().length).toBe(0);
    // No carousel behaviour → no observer wired.
    expect(MockIntersectionObserver.instances.length).toBe(0);
  });

  test('an empty item list renders nothing', () => {
    component = mount(FeatureCarousel, {
      target: document.body,
      props: { items: [] },
    });
    flushSync();

    expect(document.querySelector('.feature-carousel')).toBeNull();
  });
});

describe('FeatureCarousel — portal slides', () => {
  const portal: FeatureItem = {
    id: 'portal:p-1',
    title: 'Rootwork',
    kind: "Editor's pick",
    contentType: 'portal',
    description: 'Bone, breath and smoke.',
    href: '/journeys/rootwork',
    image: 'https://example.test/rootwork.jpg',
  };

  test('a portal renders as a full slide, badged and CTA-ed as a journey', () => {
    component = mount(FeatureCarousel, {
      target: document.body,
      props: { items: [portal, threeItems[0]] },
    });
    flushSync();

    expect(document.querySelectorAll('.feature-carousel__slide').length).toBe(
      2
    );

    const badges = Array.from(
      document.querySelectorAll('.feature-carousel__badge')
    ).map((el) => el.textContent?.trim());
    expect(badges[0]).toBe('Portal');

    // The CTA names the destination, not an action on a file — a journey is not
    // something you "Watch".
    const ctas = Array.from(
      document.querySelectorAll('.feature-carousel__cta')
    ).map((el) => el.textContent?.replace(/\s+/g, ' ').trim());
    expect(ctas[0]).toBe('See the journey →');

    const link = document.querySelector<HTMLAnchorElement>(
      '.feature-carousel__title a'
    );
    expect(link?.getAttribute('href')).toBe('/journeys/rootwork');
    expect(link?.textContent?.trim()).toBe('Rootwork');
  });

  test('a portal gets no audio waveform — that treatment is audio-only', () => {
    component = mount(FeatureCarousel, {
      target: document.body,
      props: { items: [portal] },
    });
    flushSync();

    expect(document.querySelector('.feature-carousel__waveform')).toBeNull();
  });

  /*
    THE CRASH GUARD, and it is the highest-value assertion in this file.

    The slide template resolves its per-type presentation through one lookup. That
    lookup used to be unguarded (`TYPE_META[item.contentType].Icon`), which is a
    TypeError rather than a soft `undefined` — so a single item bearing a type the
    map does not know took down the ENTIRE org landing page, for every org with a
    featured item. `apps/web` has strictNullChecks OFF, so the compiler does not
    flag the missing key either.

    Not hypothetical: the landing page builds slides by mapping
    `content.contentType` through a single `'written' → 'article'` rename, so the
    day that DB enum gains a value it arrives here unmapped.

    The cast is the point of the test — it manufactures exactly the state the type
    system forbids but the database can produce.
  */
  test('an UNKNOWN type renders a neutral slide instead of throwing', () => {
    const rogue = {
      ...portal,
      id: 'rogue',
      contentType: 'livestream',
    } as unknown as FeatureItem;

    expect(() => {
      component = mount(FeatureCarousel, {
        target: document.body,
        props: { items: [rogue, threeItems[0]] },
      });
      flushSync();
    }).not.toThrow();

    // It renders, and it does NOT claim to be something it isn't.
    expect(document.querySelectorAll('.feature-carousel__slide').length).toBe(
      2
    );
    const badge = document
      .querySelector('.feature-carousel__badge')
      ?.textContent?.trim();
    expect(badge).toBe('Featured');
    expect(badge).not.toBe('Article');
  });
});
