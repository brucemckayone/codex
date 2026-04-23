import { describe, expect, it } from 'vitest';
import { shouldScrollToTopOnNav } from './scroll-reset-on-nav';

describe('shouldScrollToTopOnNav', () => {
  it('preserves scroll on browser back/forward (popstate)', () => {
    expect(
      shouldScrollToTopOnNav({
        type: 'popstate',
        fromPathname: '/library',
        toPathname: '/',
        toHash: '',
      })
    ).toBe(false);
  });

  it('preserves scroll for anchor/hash links', () => {
    expect(
      shouldScrollToTopOnNav({
        type: 'link',
        fromPathname: '/content/foo',
        toPathname: '/content/foo',
        toHash: '#transcript',
      })
    ).toBe(false);

    expect(
      shouldScrollToTopOnNav({
        type: 'link',
        fromPathname: '/',
        toPathname: '/about',
        toHash: '#team',
      })
    ).toBe(false);
  });

  it('preserves scroll for same-pathname navs (filter/sort/query changes)', () => {
    expect(
      shouldScrollToTopOnNav({
        type: 'goto',
        fromPathname: '/library',
        toPathname: '/library',
        toHash: '',
      })
    ).toBe(false);
  });

  it('scrolls to top on genuine new-page link click', () => {
    expect(
      shouldScrollToTopOnNav({
        type: 'link',
        fromPathname: '/',
        toPathname: '/library',
        toHash: '',
      })
    ).toBe(true);
  });

  it('scrolls to top on programmatic goto to a new path', () => {
    expect(
      shouldScrollToTopOnNav({
        type: 'goto',
        fromPathname: '/content/a',
        toPathname: '/content/b',
        toHash: '',
      })
    ).toBe(true);
  });

  it('scrolls to top on form-post navigation to a new path', () => {
    expect(
      shouldScrollToTopOnNav({
        type: 'form',
        fromPathname: '/login',
        toPathname: '/library',
        toHash: '',
      })
    ).toBe(true);
  });

  it('scrolls to top on fresh enter (no fromPathname)', () => {
    expect(
      shouldScrollToTopOnNav({
        type: 'enter',
        fromPathname: null,
        toPathname: '/',
        toHash: '',
      })
    ).toBe(true);
  });
});
