import type { ComponentProps } from 'svelte';
import { describe, expect, type Mock, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import TopicCarousel from './TopicCarousel.svelte';
import type { TopicItem } from './topic-card.types';

/**
 * TopicCarousel unit tests — the thin item→card mapper over the shared Carousel
 * primitive (ported from the retired TopicGrid). Verifies it renders one card
 * per item inside a carousel region, builds the default `?category=<slug>`
 * deep-link href, forwards `onselect` to each card, and renders nothing at all
 * when there are no topics.
 */

type SelectFn = (slug: string) => void;

let component: ReturnType<typeof mount> | null = null;

function cleanup() {
  if (component) {
    unmount(component);
    component = null;
  }
  document.body.innerHTML = '';
}

const items: TopicItem[] = [
  { id: '1', name: 'Ambient', slug: 'ambient' },
  {
    id: '2',
    name: 'Field Recordings',
    slug: 'field recordings',
    coverImageUrl: 'https://cdn.test/2/md.webp',
  },
];

function render(props: ComponentProps<typeof TopicCarousel>) {
  component = mount(TopicCarousel, { target: document.body, props });
  flushSync();
}

describe('TopicCarousel', () => {
  test('renders one card per item inside a carousel region', () => {
    render({ items });
    expect(document.querySelectorAll('.topic-card').length).toBe(2);
    expect(document.querySelector('.topic-carousel')).not.toBeNull();
    cleanup();
  });

  test('is a carousel, not a grid — the track scrolls horizontally', () => {
    render({ items });
    // The rail's own container: proves we mounted the Carousel primitive rather
    // than re-implementing a wrapping grid.
    expect(document.querySelector('.carousel__track')).not.toBeNull();
    expect(document.querySelectorAll('.carousel__item').length).toBe(2);
    cleanup();
  });

  test('exposes a labelled carousel region for assistive tech', () => {
    render({ items, ariaLabel: 'Browse by topic' });
    const region = document.querySelector('[role="region"]');
    expect(region?.getAttribute('aria-label')).toBe('Browse by topic');
    expect(region?.getAttribute('aria-roledescription')).toBe('carousel');
    cleanup();
  });

  test('empty items renders nothing', () => {
    render({ items: [] });
    expect(document.querySelector('.carousel')).toBeNull();
    expect(document.querySelector('.topic-card')).toBeNull();
    cleanup();
  });

  test('builds the default ?category=<slug> href, encoding the slug', () => {
    render({ items });
    const hrefs = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('.topic-card')
    ).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '?category=ambient',
      '?category=field%20recordings',
    ]);
    cleanup();
  });

  test('a custom hrefFor overrides the default', () => {
    render({ items, hrefFor: (slug: string) => `/explore/${slug}` });
    const first = document.querySelector<HTMLAnchorElement>('.topic-card');
    expect(first?.getAttribute('href')).toBe('/explore/ambient');
    cleanup();
  });

  test('forwards onselect to each card', () => {
    const onselect: Mock<SelectFn> = vi.fn<SelectFn>();
    render({ items, onselect });

    const first = document.querySelector<HTMLAnchorElement>('.topic-card');
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    first?.dispatchEvent(event);
    flushSync();

    expect(event.defaultPrevented).toBe(true);
    expect(onselect).toHaveBeenCalledWith('ambient');
    cleanup();
  });
});
