/**
 * `lockScroll` — one page lock, counted, shared by every modal. The page is
 * let go only by the last holder, and only once per holder, so a release
 * that runs twice (an effect's cleanup and an unmount) cannot free a page a
 * second dialog still holds.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { lockScroll } from './scroll-lock';

const LOCKED = 'data-melt-scroll-lock';
const locked = () => document.body.hasAttribute(LOCKED);

describe('lockScroll', () => {
  afterEach(() => {
    document.body.removeAttribute(LOCKED);
    document.body.style.cssText = '';
  });

  it('locks the page on the first hold and lets go on the last', () => {
    const first = lockScroll();
    expect(locked()).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');

    const second = lockScroll();
    first();
    expect(locked()).toBe(true);

    second();
    expect(locked()).toBe(false);
    expect(document.body.style.overflow).toBe('');
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
    document.body.setAttribute(LOCKED, '');
    document.body.style.overflow = 'hidden';

    const hold = lockScroll();
    hold();

    expect(locked()).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
  });
});
