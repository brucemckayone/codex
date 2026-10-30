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
 */
const STUBS: [object, string, (this: HTMLElement, ...args: never[]) => void][] =
  [
    [
      HTMLDialogElement.prototype,
      'showModal',
      function (this: HTMLElement) {
        this.setAttribute('open', '');
      },
    ],
    [
      HTMLDialogElement.prototype,
      'close',
      function (this: HTMLElement) {
        if (!this.hasAttribute('open')) return;
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
      },
    ],
    [Element.prototype, 'scrollTo', () => {}],
  ];
const stubbed: [object, string][] = [];

beforeAll(() => {
  for (const [proto, name, value] of STUBS) {
    if (name in proto) continue;
    Object.defineProperty(proto, name, { value, configurable: true });
    stubbed.push([proto, name]);
  }
});

afterAll(() => {
  for (const [proto, name] of stubbed) Reflect.deleteProperty(proto, name);
});

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

  it('follows the picture a swipe settles on, and stops watching once closed', async () => {
    const watching: {
      callback: IntersectionObserverCallback;
      options?: IntersectionObserverInit;
      targets: Element[];
      disconnected: boolean;
    }[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        private readonly watch;
        constructor(
          callback: IntersectionObserverCallback,
          options?: IntersectionObserverInit
        ) {
          this.watch = { callback, options, targets: [], disconnected: false };
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
    await render({ items: pictures(5) });
    press(tiles()[0]);
    const slides = all('.gallery-lightbox__slide');
    const row = watching.find(
      (w) => w.options?.root === one('.gallery-lightbox__track')
    );
    expect(row?.targets).toEqual(slides);
    const settle = (index: number) => {
      const entry = {
        isIntersecting: true,
        target: slides[index],
      } as IntersectionObserverEntry;
      row?.callback([entry], {} as IntersectionObserver);
      flushSync();
    };
    settle(3);
    expect(counter()).toBe('4 / 5');
    settle(4);
    expect(control(GALLERY_COPY.next).getAttribute('aria-disabled')).toBe(
      'true'
    );
    press(control(GALLERY_COPY.close));
    expect(row?.disconnected).toBe(true);
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

    // A browser with no `showModal`, or one that refuses it, fires no
    // `close`: the page stayed held and every tile went dead.
    it.each([
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
    ])('when %s: lets the page go, gives focus back, says so, and the tile still opens', async (_, breakOpening) => {
      const warned = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      await render({ items: pictures(3) });
      const tile = tiles()[1];
      breakOpening();
      press(tile);
      flushSync();
      expect(dialog()).toBeNull();
      expect(locked()).toBe(false);
      expect(document.activeElement).toBe(tile);
      expect(warned).toHaveBeenCalledWith(
        'gallery.lightbox_open_failed',
        expect.objectContaining({ error: expect.any(String) })
      );
      // A press after the browser recovers opens it, so the tile is not dead.
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      press(tile);
      expect(dialog()?.hasAttribute('open')).toBe(true);
      expect(locked()).toBe(true);
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
