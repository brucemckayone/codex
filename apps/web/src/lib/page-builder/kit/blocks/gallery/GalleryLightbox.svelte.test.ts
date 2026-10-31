import { tick } from 'svelte';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { logger } from '$lib/observability';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { pageImageSrcset } from '../../../page-images';
import { SECTION_LAYOUTS } from '../../model/ids';
import { sampleContext } from '../../model/sample';
import type { BlockEdit, ResolvedSection } from '../../model/types';
import { GALLERY_COPY } from './copy';
import GalleryBlock from './GalleryBlock.svelte';

/**
 * jsdom 27 draws a `<dialog>` but can neither open it as a modal nor close
 * it, and an element cannot scroll: each is stubbed here as a browser does
 * it (the `open` attribute, then a `close` event), and only where missing.
 * Nor does a modal make the page behind it inert: `focus` is held to that
 * here, so nothing outside the open modal takes focus.
 */
let modal: HTMLElement | null = null;
const STUBS: [object, string, (this: HTMLElement, ...args: never[]) => void][] =
  [
    [
      HTMLDialogElement.prototype,
      'showModal',
      function (this: HTMLElement) {
        this.setAttribute('open', '');
        modal = this;
      },
    ],
    [
      HTMLDialogElement.prototype,
      'close',
      function (this: HTMLElement) {
        if (!this.hasAttribute('open')) return;
        this.removeAttribute('open');
        if (modal === this) modal = null;
        this.dispatchEvent(new Event('close'));
      },
    ],
    [Element.prototype, 'scrollTo', () => {}],
  ];
const stubbed: [object, string][] = [];
const focus = HTMLElement.prototype.focus;

beforeAll(() => {
  for (const [proto, name, value] of STUBS) {
    if (name in proto) continue;
    Object.defineProperty(proto, name, { value, configurable: true });
    stubbed.push([proto, name]);
  }
  HTMLElement.prototype.focus = function (
    this: HTMLElement,
    options?: FocusOptions
  ) {
    if (modal?.isConnected && !modal.contains(this)) return;
    focus.call(this, options);
  };
});

afterAll(() => {
  for (const [proto, name] of stubbed) Reflect.deleteProperty(proto, name);
  HTMLElement.prototype.focus = focus;
});

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  modal = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * `window.open` as a browser answers it: the new tab, or `null` where its
 * popup blocker refuses one. Asked for `noopener`, it answers `null` either
 * way, so a refusal cannot be told from a tab, and an address it cannot
 * parse throws (`refused` as the error). jsdom cannot navigate, so
 * `location.assign` is only heard, but it ends the page as a browser's does:
 * nothing logged after it is sent. `told` is what production sends, the
 * warnings logged while the page is still there (`info` never leaves it).
 */
function popups(refused: boolean | DOMException) {
  const tab = { opener: window as Window | null };
  const opened = vi
    .spyOn(window, 'open')
    .mockImplementation((_url, _target, features) => {
      if (refused instanceof DOMException) throw refused;
      return refused || /\bnoopener\b/.test(features ?? '')
        ? null
        : (tab as unknown as Window);
    });
  let left = false;
  const assigned = vi.fn(() => {
    left = true;
  });
  vi.stubGlobal('location', { assign: assigned });
  const told: unknown[][] = [];
  vi.spyOn(logger, 'warn').mockImplementation((...record) => {
    if (!left) told.push(record);
  });
  return { tab, opened, assigned, told };
}

const CDN = 'https://cdn.test';
const HEADING = 'A look inside';
const LOCK = 'data-lp-lightbox';

/** Pictures 1…count, each captioned; the first records its size. */
function pictures(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    image: {
      key: `landing-pages/p1/images/g${i + 1}`,
      alt: `Picture ${i + 1}`,
      ...(i === 0 ? { w: 2400, h: 1600 } : {}),
    },
    caption: `Caption ${i + 1}`,
  }));
}

async function render(
  props: Record<string, unknown>,
  options: {
    layout?: string;
    edit?: BlockEdit | null;
    mediaBaseUrl?: string | null;
  } = {}
) {
  const section: ResolvedSection = {
    id: 'gallery-1',
    anchor: 'gallery',
    type: 'gallery',
    index: 6,
    layout: options.layout ?? 'mosaic',
    scheme: 'base',
    spacing: 'regular',
    headingLevel: 2,
  };
  app = mount(GalleryBlock, {
    target: document.body,
    props: {
      props,
      section,
      context: sampleContext({
        mediaBaseUrl:
          options.mediaBaseUrl === undefined ? CDN : options.mediaBaseUrl,
      }),
      edit: options.edit ?? null,
    },
  });
  flushSync();
  await tick();
}

const one = (selector: string) => document.body.querySelector(selector);
const all = (selector: string) => [...document.body.querySelectorAll(selector)];
const tiles = () => all('.gallery-picture__open') as HTMLButtonElement[];
const dialog = () => one('dialog') as HTMLDialogElement | null;
const counter = () => one('.gallery-lightbox__count')?.textContent?.trim();
const control = (label: string) =>
  one(`dialog button[aria-label="${label}"]`) as HTMLButtonElement;
const locked = () => document.documentElement.hasAttribute(LOCK);

function press(element: Element) {
  (element as HTMLElement).click();
  flushSync();
}

function key(name: string) {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: name, cancelable: true })
  );
  flushSync();
}

describe('GalleryBlock: each picture opens the lightbox (p3n §4)', () => {
  it.each(
    SECTION_LAYOUTS.gallery
  )('%s: every picture is a labelled button that opens the set on itself', async (layout) => {
    await render({ heading: HEADING, items: pictures(8) }, { layout });
    expect(tiles().map((tile) => tile.getAttribute('aria-label'))).toEqual(
      Array.from(
        { length: 8 },
        (_, i) => `Open picture ${i + 1} of 8: Picture ${i + 1}`
      )
    );
    expect(dialog()).toBeNull();
    press(tiles()[2]);
    const box = dialog();
    expect(box?.hasAttribute('open')).toBe(true);
    expect(box?.getAttribute('aria-label')).toBe(HEADING);
    // On the kit's media scrim, so its ink is measured against it.
    expect(box?.hasAttribute('data-lp-on-media')).toBe(true);
    // Inside the section, so the Style's and scheme's tokens reach it.
    expect(box?.closest('.gallery')).not.toBeNull();
    expect(counter()).toBe('3 / 8');
    expect(document.activeElement).toBe(control(GALLERY_COPY.close));
  });

  it('names an untitled set, and labels a picture with no description by its place', async () => {
    const [first, second] = pictures(2);
    await render({
      items: [first, { ...second, image: { key: second.image.key } }],
    });
    expect(tiles()[1].getAttribute('aria-label')).toBe('Open picture 2 of 2');
    press(tiles()[0]);
    expect(dialog()?.getAttribute('aria-label')).toBe(GALLERY_COPY.pictures);
  });

  it('shows each picture whole, at the largest file it has, with its caption under it', async () => {
    await render({ items: pictures(3) });
    // Nothing large is fetched before a press: the lightbox is not there.
    expect(one('.gallery-lightbox__picture')).toBeNull();
    press(tiles()[0]);
    const shown = all('.gallery-lightbox__picture') as HTMLImageElement[];
    expect(
      shown.map((img) => [
        img.getAttribute('src'),
        img.getAttribute('width'),
        img.getAttribute('height'),
      ])
    ).toEqual([
      [`${CDN}/landing-pages/p1/images/g1/xl.webp`, '2400', '1600'],
      [`${CDN}/landing-pages/p1/images/g2/lg.webp`, null, null],
      [`${CDN}/landing-pages/p1/images/g3/lg.webp`, null, null],
    ]);
    // A narrow screen takes a smaller file from every size it has; a wide
    // one still reaches `xl` where the picture records its size.
    expect(shown.map((img) => img.getAttribute('srcset'))).toEqual(
      pictures(3).map(({ image }) => pageImageSrcset(image, CDN))
    );
    expect(shown[0].getAttribute('srcset')).toMatch(/\/g1\/xl\.webp 1600w$/);
    for (const img of shown) {
      expect(img.getAttribute('sizes')).toBe('100vw');
      expect(img.getAttribute('loading')).toBe('lazy');
      expect(img.getAttribute('decoding')).toBe('async');
    }
    expect(shown.map((img) => img.getAttribute('alt'))).toEqual([
      'Picture 1',
      'Picture 2',
      'Picture 3',
    ]);
    const figures = all('.gallery-lightbox__figure');
    for (const [i, figure] of figures.entries()) {
      expect(
        [...figure.children].map((child) => child.className.split(' ')[0])
      ).toEqual(['gallery-lightbox__picture', 'gallery-lightbox__caption']);
      expect(figure.querySelector('figcaption')?.textContent).toBe(
        `Caption ${i + 1}`
      );
    }
  });

  it('steps with its buttons, resting (but focusable) at either end', async () => {
    await render({ items: pictures(3) });
    press(tiles()[1]);
    const previous = control(GALLERY_COPY.previous);
    const next = control(GALLERY_COPY.next);
    expect(counter()).toBe('2 / 3');
    press(next);
    expect(counter()).toBe('3 / 3');
    expect(next.getAttribute('aria-disabled')).toBe('true');
    expect(next.disabled).toBe(false);
    press(next);
    expect(counter()).toBe('3 / 3');
    press(previous);
    press(previous);
    expect(counter()).toBe('1 / 3');
    expect(previous.getAttribute('aria-disabled')).toBe('true');
    expect(next.getAttribute('aria-disabled')).toBe('false');
    // A press on a control never closes it.
    expect(dialog()?.hasAttribute('open')).toBe(true);
  });

  it('steps with ← and → heard on the window, and only while it is open', async () => {
    await render({ items: pictures(4) });
    key('ArrowRight');
    expect(dialog()).toBeNull();
    press(tiles()[0]);
    key('ArrowRight');
    key('ArrowRight');
    expect(counter()).toBe('3 / 4');
    key('ArrowLeft');
    expect(counter()).toBe('2 / 4');
    // Not its keys: another key, or an arrow with a modifier.
    key('ArrowUp');
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', metaKey: true })
    );
    flushSync();
    expect(counter()).toBe('2 / 4');
  });

  /**
   * The row's observer, heard as a browser reports to it: each slide by how
   * much of it shows, a slide at the row's edge intersecting at 0, and only
   * when a slide crosses a threshold, or first, every slide at once.
   */
  describe('the picture the row is on', () => {
    /** A slide's width, and so the scroll between two. */
    const WIDTH = 1000;
    /** How long the row scrolls no further before it is at rest (the lightbox's). */
    const STILL_MS = 150;
    type Watch = {
      callback: IntersectionObserverCallback;
      options?: IntersectionObserverInit;
      targets: Element[];
      disconnected: boolean;
    };

    /** Opens picture `start` of `count` and gives back the row's observer. */
    async function watchRow(count: number, start: number) {
      const watching: Watch[] = [];
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          private readonly watch: Watch;
          constructor(
            callback: IntersectionObserverCallback,
            options?: IntersectionObserverInit
          ) {
            this.watch = {
              callback,
              options,
              targets: [],
              disconnected: false,
            };
            watching.push(this.watch);
          }
          observe(target: Element) {
            this.watch.targets.push(target);
          }
          unobserve() {}
          disconnect() {
            this.watch.disconnected = true;
          }
          takeRecords() {
            return [];
          }
        }
      );
      await render({ items: pictures(count) });
      press(tiles()[start]);
      const slides = all('.gallery-lightbox__slide');
      const track = one('.gallery-lightbox__track') as HTMLElement;
      const row = watching.find((w) => w.options?.root === track);
      expect(row?.targets).toEqual(slides);
      // Laid out as a browser lays it: each slide the row's width, so its
      // offset is the scroll that shows it, and the row where it was left.
      let left = start * WIDTH;
      for (const [index, slide] of slides.entries()) {
        Object.defineProperty(slide, 'offsetLeft', {
          get: () => index * WIDTH,
        });
      }
      Object.defineProperty(track, 'scrollLeft', { get: () => left });
      // Open, the row's waits run on a clock each test moves itself.
      vi.useFakeTimers();
      /**
       * The row comes to rest on slide `index`: `scrollend` says so, or,
       * in a browser without it (Safari), the row scrolls no further.
       */
      const settle = (index: number, end: 'scrollend' | 'still') => {
        left = index * WIDTH;
        if (end === 'scrollend') {
          track.dispatchEvent(new Event('scrollend'));
        } else {
          track.dispatchEvent(new Event('scroll'));
          vi.runOnlyPendingTimers();
        }
        flushSync();
      };
      /**
       * One report: each slide by its place, how much of it shows, and
       * whether it touches the row (any of it showing does; `edge`, at 0).
       */
      const report = (...seen: [index: number, ratio: number | 'edge'][]) => {
        row?.callback(
          seen.map(
            ([index, ratio]) =>
              ({
                target: slides[index],
                intersectionRatio: ratio === 'edge' ? 0 : ratio,
                isIntersecting: ratio === 'edge' || ratio > 0,
              }) as IntersectionObserverEntry
          ),
          {} as IntersectionObserver
        );
        flushSync();
      };
      return { row, track, report, settle };
    }

    it('stays on the picture it opened on through the first report, whose neighbours touch the row', async () => {
      const { report } = await watchRow(5, 2);
      // The slides either side sit at the row's edge: intersecting, at 0.
      report([0, 0], [1, 'edge'], [2, 1], [3, 'edge'], [4, 0]);
      expect(counter()).toBe('3 / 5');
      expect(control(GALLERY_COPY.next).getAttribute('aria-disabled')).toBe(
        'false'
      );
    });

    it('is not pulled back by the slide a press glides away from, so a second press steps on', async () => {
      const { report } = await watchRow(5, 0);
      report([0, 1], [1, 'edge'], [2, 0], [3, 0], [4, 0]);
      press(control(GALLERY_COPY.next));
      expect(counter()).toBe('2 / 5');
      // Mid-glide, the first slide drops under the threshold, still in view.
      report([0, 0.59]);
      expect(counter()).toBe('2 / 5');
      press(control(GALLERY_COPY.next));
      expect(counter()).toBe('3 / 5');
    });

    // Slides are the row's width: a glide over two shows the one between
    // whole on its way, crossing the threshold as it comes and as it goes.
    it('counts a press made mid-glide from where the glide is going, not the slide it passes', async () => {
      const { report } = await watchRow(5, 0);
      report([0, 1], [1, 'edge'], [2, 0], [3, 0], [4, 0]);
      const next = control(GALLERY_COPY.next);
      press(next);
      press(next);
      expect(counter()).toBe('3 / 5');
      report([0, 0.59]);
      report([1, 0.61]);
      // No flicker back for a screen reader, and a press here steps on.
      expect(counter()).toBe('3 / 5');
      press(next);
      expect(counter()).toBe('4 / 5');
      // The next slide passed is not where it is going either.
      report([1, 0.59]);
      report([2, 0.61]);
      expect(counter()).toBe('4 / 5');
      // Once there, the row is free: a swipe on is followed.
      report([2, 0.59]);
      report([3, 0.61]);
      report([3, 0.59]);
      report([4, 0.61]);
      expect(counter()).toBe('5 / 5');
    });

    it.each([
      'scrollend',
      'still',
    ] as const)('takes the picture a swipe leaves the row on when it cuts a glide short (%s)', async (end) => {
      const { report, settle } = await watchRow(5, 0);
      report([0, 1], [1, 'edge'], [2, 0], [3, 0], [4, 0]);
      const next = control(GALLERY_COPY.next);
      press(next);
      press(next);
      report([0, 0.59]);
      report([1, 0.61]);
      expect(counter()).toBe('3 / 5');
      // A finger catches it while the second slide shows whole, and holds it
      // there. Short of where the press was taking it, the row is at rest
      // once it scrolls no further, however it said it had stopped.
      settle(1, end);
      vi.advanceTimersByTime(STILL_MS);
      flushSync();
      expect(counter()).toBe('2 / 5');
      // The row is free again: the next swipe is followed.
      report([1, 0.59]);
      report([2, 0.61]);
      expect(counter()).toBe('3 / 5');
    });

    // Chrome ends the swipe a press cut short only once the press's glide is
    // under way, so that `scrollend` comes with the row still moving.
    it('is not set back by the end of the swipe a press cut short', async () => {
      const { track, report, settle } = await watchRow(5, 0);
      report([0, 1], [1, 'edge'], [2, 0], [3, 0], [4, 0]);
      report([0, 0.59]);
      report([1, 0.61]);
      press(control(GALLERY_COPY.next));
      expect(counter()).toBe('3 / 5');
      // The swipe's end, the row a little past the second slide.
      settle(1.1, 'scrollend');
      expect(counter()).toBe('3 / 5');
      // The glide scrolls on, and comes to rest where it was going.
      track.dispatchEvent(new Event('scroll'));
      report([1, 0.59]);
      report([2, 0.61]);
      settle(2, 'scrollend');
      expect(counter()).toBe('3 / 5');
    });

    it('is not set back by the rest of the scroll before a press', async () => {
      const { track } = await watchRow(5, 0);
      // A swipe has just settled on the first slide, in a browser with no
      // `scrollend`: it is at rest once it scrolls no further. The press
      // comes as that wait is nearly over.
      track.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(STILL_MS - 10);
      press(control(GALLERY_COPY.next));
      // That rest falls due before the glide has moved the row.
      vi.advanceTimersByTime(10);
      flushSync();
      expect(counter()).toBe('2 / 5');
    });

    // Next, then back within a frame: the row is already where the second
    // glide goes, so it scrolls nothing, and no scroll comes to free it. The
    // observer then heard only the slide a press had bound it to.
    it('is freed by one rest after a glide that goes nowhere, so a swipe after is followed', async () => {
      const { track, report } = await watchRow(5, 0);
      report([0, 1], [1, 'edge'], [2, 0], [3, 0], [4, 0]);
      press(control(GALLERY_COPY.next));
      press(control(GALLERY_COPY.previous));
      expect(counter()).toBe('1 / 5');
      vi.advanceTimersByTime(STILL_MS);
      flushSync();
      expect(counter()).toBe('1 / 5');
      // One rest, which never sets another: nothing is left waiting.
      expect(vi.getTimerCount()).toBe(0);
      // A swipe: the row scrolls, and the next slide comes over the threshold.
      track.dispatchEvent(new Event('scroll'));
      report([0, 0.59]);
      report([1, 0.61]);
      expect(counter()).toBe('2 / 5');
    });

    it('follows the picture a swipe settles on, and stops watching once closed', async () => {
      const { row, report } = await watchRow(5, 0);
      report([0, 1], [1, 'edge'], [2, 0], [3, 0], [4, 0]);
      // Each swipe: the slide it leaves drops under the threshold first,
      // then the one it comes to rises over it.
      for (const [from, to] of [
        [0, 1],
        [1, 2],
        [2, 3],
      ]) {
        report([from, 0.59]);
        report([to, 0.61]);
      }
      expect(counter()).toBe('4 / 5');
      report([3, 0.59]);
      report([4, 0.61]);
      expect(control(GALLERY_COPY.next).getAttribute('aria-disabled')).toBe(
        'true'
      );
      press(control(GALLERY_COPY.close));
      expect(row?.disconnected).toBe(true);
    });
  });

  describe('closing', () => {
    it.each([
      ['its close button', () => press(control(GALLERY_COPY.close))],
      [
        'Escape (the dialog’s cancel)',
        () => {
          dialog()?.dispatchEvent(new Event('cancel', { cancelable: true }));
          flushSync();
        },
      ],
      [
        'a click on the dark ground round the picture',
        () => press(one('.gallery-lightbox__slide') as Element),
      ],
      ['a click on the dialog itself', () => press(dialog() as Element)],
    ])('closes on %s, and gives focus back to the tile', async (_, close) => {
      await render({ items: pictures(4) }, { layout: 'grid' });
      const tile = tiles()[2];
      press(tile);
      expect(locked()).toBe(true);
      close();
      expect(dialog()).toBeNull();
      expect(locked()).toBe(false);
      expect(document.activeElement).toBe(tile);
    });

    it('stays open for a click on the picture or its caption', async () => {
      await render({ items: pictures(2) });
      press(tiles()[0]);
      press(one('.gallery-lightbox__picture') as Element);
      press(one('.gallery-lightbox__caption') as Element);
      expect(dialog()?.hasAttribute('open')).toBe(true);
    });

    it('stops holding the page still if it is taken away while open', async () => {
      await render({ items: pictures(2) });
      press(tiles()[1]);
      expect(locked()).toBe(true);
      if (app) unmount(app);
      app = null;
      expect(locked()).toBe(false);
    });

    /** The ways opening breaks: before the dialog is modal, or after. */
    const BREAKS: [string, () => void][] = [
      [
        'showModal throws',
        () =>
          vi
            .spyOn(HTMLDialogElement.prototype, 'showModal')
            .mockImplementation(() => {
              throw new DOMException('not connected', 'InvalidStateError');
            }),
      ],
      [
        'a later step of opening throws',
        () =>
          vi.stubGlobal(
            'IntersectionObserver',
            class {
              constructor() {
                throw new TypeError('no observer here');
              }
            }
          ),
      ],
    ];

    // A browser that refuses `showModal` fires no `close`: the page stayed
    // held and every tile went dead, and the press showed nothing. One that
    // opened it and failed after must close it first: the tile, behind a
    // modal, is inert and refuses focus, which then fell to the body as the
    // dialog went. Either way the press must still show the picture: closed
    // with nothing in its place, it only flashed.
    it.each(
      BREAKS
    )('when %s: lets the page go, gives focus back, says so, shows the picture in a tab, and the tile still opens', async (_, breakOpening) => {
      await render({ items: pictures(3) });
      const tile = tiles()[1];
      const { opened, told } = popups(false);
      breakOpening();
      press(tile);
      flushSync();
      expect(dialog()).toBeNull();
      expect(locked()).toBe(false);
      expect(document.activeElement).toBe(tile);
      expect(told).toEqual([
        [
          'gallery.lightbox_open_failed',
          expect.objectContaining({ error: expect.any(String) }),
        ],
        ['gallery.lightbox_tab_fallback', { opened: true }],
      ]);
      expect(opened).toHaveBeenCalledExactlyOnceWith(
        `${CDN}/landing-pages/p1/images/g2/lg.webp`,
        '_blank'
      );
      // A press after the browser recovers opens it, so the tile is not dead.
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      press(tile);
      expect(dialog()?.hasAttribute('open')).toBe(true);
      expect(locked()).toBe(true);
    });

    // An address the browser cannot parse makes `window.open` throw. Thrown
    // before it said it had closed, the block still held the picture open, so
    // every tile went dead; thrown out of the lightbox at all, it stopped the
    // page's updates mid-flush, and the closed lightbox stayed mounted.
    it.each(
      BREAKS
    )('when %s and the tab throws too: closes all the same, says so, and the tile still opens', async (_, breakOpening) => {
      await render({ items: pictures(3) });
      const tile = tiles()[1];
      const { told } = popups(new DOMException('bad address', 'SyntaxError'));
      breakOpening();
      press(tile);
      expect(dialog()).toBeNull();
      expect(locked()).toBe(false);
      expect(document.activeElement).toBe(tile);
      expect(told).toEqual([
        [
          'gallery.lightbox_open_failed',
          expect.objectContaining({ error: expect.any(String) }),
        ],
        [
          'gallery.lightbox_tab_failed',
          expect.objectContaining({
            error: expect.stringContaining('bad address'),
          }),
        ],
      ]);
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      press(tile);
      expect(dialog()?.hasAttribute('open')).toBe(true);
    });
  });

  describe('a picture that will not load', () => {
    const fail = (img: Element) => {
      img.dispatchEvent(new Event('error'));
      flushSync();
    };

    it('falls back to the file its tile showed, then to a line beside its caption', async () => {
      await render({ items: pictures(2) });
      press(tiles()[0]);
      const slide = () => all('.gallery-lightbox__figure')[0];
      const shown = () =>
        slide().querySelector('.gallery-lightbox__picture') as HTMLImageElement;
      expect(shown().getAttribute('src')).toBe(
        `${CDN}/landing-pages/p1/images/g1/xl.webp`
      );
      fail(shown());
      // The tile's own file, alone: its srcset would choose the failed size.
      const tile = (
        one('.gallery-picture img') as HTMLImageElement
      ).getAttribute('src');
      expect(shown().getAttribute('src')).toBe(tile);
      expect(shown().hasAttribute('srcset')).toBe(false);
      expect(shown().hasAttribute('sizes')).toBe(false);
      // The same frame: the large file's size.
      expect(shown().getAttribute('width')).toBe('2400');
      fail(shown());
      expect(slide().querySelector('img')).toBeNull();
      expect(
        [...slide().children].map((child) => child.textContent?.trim())
      ).toEqual([GALLERY_COPY.lost, 'Caption 1']);
      // The words hold it open, as the picture did; the others are untouched.
      press(slide().querySelector('.gallery-lightbox__lost') as Element);
      expect(dialog()?.hasAttribute('open')).toBe(true);
      expect(
        all('.gallery-lightbox__figure')[1]
          .querySelector('img')
          ?.getAttribute('src')
      ).toBe(`${CDN}/landing-pages/p1/images/g2/lg.webp`);
    });

    it('says so once a stage an open, by the size the browser chose, never by its address', async () => {
      const warned = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const failures = () =>
        warned.mock.calls.filter(
          ([event]) => event === 'gallery.lightbox_image_failed'
        );
      await render({ items: pictures(3) });
      const tile = tiles()[0];
      press(tile);
      const picture = (index: number) =>
        all('.gallery-lightbox__figure')[index].querySelector(
          'img'
        ) as HTMLImageElement;
      // A narrow screen chose the medium file from the large one's srcset.
      // Without one, a browser's choice is the `src` itself.
      Object.defineProperty(picture(0), 'currentSrc', {
        get(this: HTMLImageElement) {
          return this.hasAttribute('srcset')
            ? `${CDN}/landing-pages/p1/images/g1/md.webp`
            : this.src;
        },
      });
      fail(picture(0));
      expect(failures()).toEqual([
        ['gallery.lightbox_image_failed', { stage: 'full', variant: 'md' }],
      ]);
      // Its tile's file is the next stage, heard once: the large tile's own
      // (`pictureVariant`), on the same element. Another picture's large
      // file is a stage already heard: no more.
      expect(picture(0).getAttribute('src')).toBe(
        `${CDN}/landing-pages/p1/images/g1/lg.webp`
      );
      fail(picture(0));
      fail(picture(1));
      expect(failures()).toEqual([
        ['gallery.lightbox_image_failed', { stage: 'full', variant: 'md' }],
        ['gallery.lightbox_image_failed', { stage: 'tile', variant: 'lg' }],
      ]);
      // The next open is heard afresh.
      press(control(GALLERY_COPY.close));
      press(tile);
      fail(picture(2));
      expect(failures()).toEqual([
        ['gallery.lightbox_image_failed', { stage: 'full', variant: 'md' }],
        ['gallery.lightbox_image_failed', { stage: 'tile', variant: 'lg' }],
        ['gallery.lightbox_image_failed', { stage: 'full', variant: 'lg' }],
      ]);
    });
  });

  // Safari before 15.4 has no `<dialog>`; a browser can lack only its modal.
  describe('a browser with no modal dialog', () => {
    it.each([
      ['no dialog at all', undefined],
      ['a dialog that cannot be modal', class {}],
    ])('with %s: a press opens the large file in a tab of its own, cut loose from the page, and the page is drawn the same', async (_, dialogClass) => {
      await render({ items: pictures(3) });
      const drawn = one('.gallery')?.outerHTML;
      if (app) unmount(app);
      vi.stubGlobal('HTMLDialogElement', dialogClass);
      await render({ items: pictures(3) });
      expect(one('.gallery')?.outerHTML).toBe(drawn);
      const { tab, opened, assigned, told } = popups(false);
      press(tiles()[2]);
      expect(opened).toHaveBeenCalledExactlyOnceWith(
        `${CDN}/landing-pages/p1/images/g3/lg.webp`,
        '_blank'
      );
      expect(tab.opener).toBeNull();
      expect(assigned).not.toHaveBeenCalled();
      expect(told).toEqual([
        ['gallery.lightbox_tab_fallback', { opened: true }],
      ]);
      expect(dialog()).toBeNull();
      expect(locked()).toBe(false);
    });

    // Logged after the page has gone, or below `warn`, it never reaches the sink.
    it('opens the large file in this tab where the browser refuses a new one, saying so before it leaves', async () => {
      vi.stubGlobal('HTMLDialogElement', undefined);
      await render({ items: pictures(3) });
      const { assigned, told } = popups(true);
      press(tiles()[1]);
      expect(assigned).toHaveBeenCalledExactlyOnceWith(
        `${CDN}/landing-pages/p1/images/g2/lg.webp`
      );
      expect(told).toEqual([
        ['gallery.lightbox_tab_fallback', { opened: false }],
      ]);
    });

    it('opens no tab from the canvas', async () => {
      vi.stubGlobal('HTMLDialogElement', undefined);
      const opened = vi.spyOn(window, 'open').mockReturnValue(null);
      await render({ items: pictures(3) }, { edit: { commit: () => {} } });
      press(tiles()[0]);
      expect(opened).not.toHaveBeenCalled();
    });
  });

  describe('the canvas, and a gallery with nothing to open', () => {
    it('draws the same buttons on the canvas, where a press opens nothing', async () => {
      await render({ items: pictures(4) });
      const labels = tiles().map((tile) => tile.outerHTML);
      if (app) unmount(app);
      await render({ items: pictures(4) }, { edit: { commit: () => {} } });
      expect(tiles().map((tile) => tile.outerHTML)).toEqual(labels);
      press(tiles()[0]);
      expect(dialog()).toBeNull();
      expect(locked()).toBe(false);
    });

    it('has no buttons without a CDN base, or on the empty layout’s plates', async () => {
      await render({ items: pictures(3) }, { mediaBaseUrl: null });
      expect(tiles()).toHaveLength(0);
      if (app) unmount(app);
      await render({ heading: HEADING }, { edit: { commit: () => {} } });
      expect(all('.gallery__plates .lp-media').length).toBeGreaterThan(0);
      expect(tiles()).toHaveLength(0);
    });
  });
});
