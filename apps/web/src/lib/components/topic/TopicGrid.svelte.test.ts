import type { ComponentProps } from 'svelte';
import { describe, expect, type Mock, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import TopicGrid from './TopicGrid.svelte';
import type { TopicItem } from './topic-card.types';

/**
 * TopicGrid unit tests — the thin item→card mapper. Verifies it renders one
 * card per item, builds the default `?category=<slug>` deep-link href, and
 * forwards `onselect` to each card.
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

function render(props: ComponentProps<typeof TopicGrid>) {
  component = mount(TopicGrid, { target: document.body, props });
  flushSync();
}

describe('TopicGrid', () => {
  test('renders one card per item', () => {
    render({ items });
    expect(document.querySelectorAll('.topic-card').length).toBe(2);
    cleanup();
  });

  test('empty items renders no grid', () => {
    render({ items: [] });
    expect(document.querySelector('.topic-grid')).toBeNull();
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
