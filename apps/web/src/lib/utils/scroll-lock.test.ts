/**
 * `lockScroll` — one page lock, counted, shared by every modal. The page is
 * let go only by the last holder, and only once per holder, so a release
 * that runs twice (an effect's cleanup and an unmount) cannot free a page a
 * second dialog still holds.
 *
 * The lock holds the viewport, on <html>: base.css clips <html>'s
 * overflow-x, so a <body> `overflow: hidden` never reaches it. Whether the
 * viewport really holds is a layout question jsdom cannot answer; the
 * browser proof wheels the page in the app's layout. Here: which styles go
 * on, and that each comes back exactly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ ios: false }));
vi.mock('@melt-ui/svelte/internal/helpers', () => ({
  isIos: () => platform.ios,
}));

// A fresh module per test: a failing test cannot leave a holder behind.
let lockScroll: typeof import('./scroll-lock').lockScroll;

const LOCKED = 'data-melt-scroll-lock';
const html = document.documentElement;
const body = document.body;
const locked = () => body.hasAttribute(LOCKED);

/** A classic scrollbar `width` px wide: innerWidth less the root's clientWidth. */
function scrollbar(width: number) {
  Object.defineProperty(html, 'clientWidth', {
    configurable: true,
    get: () => window.innerWidth - width,
  });
}

/** Body's box before and after the lock goes on, as the browser would report it. */
function bodyWidths(...widths: number[]) {
  const spy = vi.spyOn(body, 'getBoundingClientRect');
  for (const width of widths)
    spy.mockReturnValueOnce(new DOMRect(0, 0, width, 100));
  return spy;
}

describe('lockScroll', () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ lockScroll } = await import('./scroll-lock'));
    scrollbar(15);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    platform.ios = false;
    body.removeAttribute(LOCKED);
    html.style.cssText = '';
    body.style.cssText = '';
    Reflect.deleteProperty(html, 'clientWidth');
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });

  it('holds the viewport on the first hold and lets go on the last', () => {
    const first = lockScroll();
    expect(locked()).toBe(true);
    expect(html.style.overflow).toBe('hidden');

    const second = lockScroll();
    first();
    expect(locked()).toBe(true);
    expect(html.style.overflow).toBe('hidden');

    second();
    expect(locked()).toBe(false);
    expect(html.style.cssText).toBe('');
  });

  it('touches nothing on <body> off iOS: no overflow, no padding', () => {
    const hold = lockScroll();
    expect(body.style.cssText).toBe('');
    hold();
  });

  it('keeps a classic scrollbar’s gutter, and adds none to a page without one', () => {
    const hold = lockScroll();
    expect(html.style.scrollbarGutter).toBe('stable');
    hold();
    expect(html.style.scrollbarGutter).toBe('');

    scrollbar(0);
    const again = lockScroll();
    expect(html.style.scrollbarGutter).toBe('');
    again();
  });

  // WebKit drops the gutter of an `overflow: hidden` root: the page widens.
  // A fixed element on the right (the Toaster) reads the pad to stay put.
  it('pads the scrollbar’s side when the page widens anyway, and publishes it', () => {
    bodyWidths(1265, 1280);
    const hold = lockScroll();
    expect(html.style.paddingRight).toBe('15px');
    expect(html.style.getPropertyValue('--scroll-lock-pad')).toBe('15px');
    hold();
    expect(html.style.paddingRight).toBe('');
    expect(html.style.getPropertyValue('--scroll-lock-pad')).toBe('');
  });

  // A scrollbar on the left (an RTL page): the page widens leftwards, and
  // a fixed element on the right does not move, so nothing is published.
  it('pads the left when the scrollbar is on the left', () => {
    vi.spyOn(body, 'getBoundingClientRect')
      .mockReturnValueOnce(new DOMRect(15, 0, 1265, 100))
      .mockReturnValueOnce(new DOMRect(0, 0, 1280, 100));
    const hold = lockScroll();
    expect(html.style.paddingLeft).toBe('15px');
    expect(html.style.paddingRight).toBe('');
    expect(html.style.getPropertyValue('--scroll-lock-pad')).toBe('');
    hold();
    expect(html.style.cssText).toBe('');
  });

  it('pads nothing when the gutter holds', () => {
    bodyWidths(1265, 1265);
    const hold = lockScroll();
    expect(html.style.paddingRight).toBe('');
    expect(html.style.getPropertyValue('--scroll-lock-pad')).toBe('');
    hold();
  });

  it('puts back exactly the inline styles the page had', () => {
    html.style.setProperty('overflow', 'auto');
    html.style.setProperty('scrollbar-gutter', 'auto');
    html.style.setProperty('padding-right', '3px', 'important');
    bodyWidths(1265, 1280);

    const hold = lockScroll();
    expect(html.style.overflow).toBe('hidden');
    expect(html.style.paddingRight).toBe('18px');
    hold();

    expect(html.style.overflow).toBe('auto');
    expect(html.style.scrollbarGutter).toBe('auto');
    expect(html.style.getPropertyValue('padding-right')).toBe('3px');
    expect(html.style.getPropertyPriority('padding-right')).toBe('important');
  });

  it('on iOS fixes <body> at the scroll position and scrolls back there at once', () => {
    platform.ios = true;
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 600,
    });
    // The scroll back comes after <body> is back in flow: a still-fixed
    // body has nothing to scroll, and the browser clamps it to 0.
    const positionAtScroll: string[] = [];
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {
      positionAtScroll.push(body.style.position);
    });
    // jsdom's style parser drops a negative `top`: the call is what is checked.
    const set = vi.spyOn(body.style, 'setProperty');

    const hold = lockScroll();
    expect(body.style.position).toBe('fixed');
    expect(set).toHaveBeenCalledWith('top', '-600px');
    hold();

    expect(positionAtScroll).toEqual(['']);
    expect(body.style.cssText).toBe('');
    expect(scrollTo).toHaveBeenCalledWith({
      left: 0,
      top: 600,
      behavior: 'instant',
    });
  });

  it('on iOS a scrollTo that rejects `instant` still lets the page go, and back to its place', () => {
    platform.ios = true;
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 600,
    });
    const scrollTo = vi
      .spyOn(window, 'scrollTo')
      .mockImplementationOnce(() => {
        throw new TypeError("'instant' is not a valid ScrollBehavior");
      })
      .mockImplementation(() => {});

    const hold = lockScroll();
    hold();

    expect(locked()).toBe(false);
    expect(html.style.cssText).toBe('');
    expect(body.style.cssText).toBe('');
    expect(scrollTo).toHaveBeenLastCalledWith(0, 600);
  });

  // One restore that throws skips no other. `overflow` is put back last:
  // left `hidden`, the next hold takes it for the page's own and puts it
  // back at its release. Left on <body>, the mark reads as another lock's:
  // no hold() after it holds the page. Either way the page stays locked.
  it('a release that throws still puts every style back and takes the mark off', () => {
    const hold = lockScroll();
    // The first restore (the gutter) does its work, then throws.
    const remove = html.style.removeProperty.bind(html.style);
    vi.spyOn(html.style, 'removeProperty').mockImplementationOnce(
      (property) => {
        remove(property);
        throw new Error('restore failed');
      }
    );

    expect(() => hold()).toThrow('restore failed');
    expect(locked()).toBe(false);
    expect(html.style.cssText).toBe('');

    vi.restoreAllMocks();
    const again = lockScroll();
    expect(html.style.overflow).toBe('hidden');
    again();
    expect(html.style.cssText).toBe('');
  });

  // The first failure alone hid every other: a second broken restore went
  // unreported (review q6qjb NIT 5).
  it('a release where several restores throw reports every one of them', () => {
    const hold = lockScroll();
    // The first two restores (the gutter, then overflow) do their work, then throw.
    const remove = html.style.removeProperty.bind(html.style);
    const first = new Error('gutter restore failed');
    const second = new Error('overflow restore failed');
    vi.spyOn(html.style, 'removeProperty')
      .mockImplementationOnce((property) => {
        remove(property);
        throw first;
      })
      .mockImplementationOnce((property) => {
        remove(property);
        throw second;
      });

    let thrown: unknown;
    try {
      hold();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual([first, second]);
    expect(locked()).toBe(false);
    expect(html.style.cssText).toBe('');
  });

  it('on iOS a <body> restore that throws still puts the rest back, and the scroll', () => {
    platform.ios = true;
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 600,
    });
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const hold = lockScroll();
    // The first <body> restore (`right`) does its work, then throws.
    const remove = body.style.removeProperty.bind(body.style);
    vi.spyOn(body.style, 'removeProperty').mockImplementationOnce(
      (property) => {
        remove(property);
        throw new Error('restore failed');
      }
    );

    expect(() => hold()).toThrow('restore failed');
    expect(locked()).toBe(false);
    expect(body.style.cssText).toBe('');
    expect(html.style.cssText).toBe('');
    expect(scrollTo).toHaveBeenCalledWith({
      left: 0,
      top: 600,
      behavior: 'instant',
    });
  });

  it('counts a holder once, however often it lets go', () => {
    const first = lockScroll();
    const second = lockScroll();
    first();
    first();
    expect(locked()).toBe(true);

    second();
    expect(locked()).toBe(false);
  });

  it('leaves alone a page another lock already holds', () => {
    body.setAttribute(LOCKED, '');
    body.style.overflow = 'hidden';

    const hold = lockScroll();
    hold();

    expect(locked()).toBe(true);
    expect(body.style.overflow).toBe('hidden');
    expect(html.style.cssText).toBe('');
  });
});
