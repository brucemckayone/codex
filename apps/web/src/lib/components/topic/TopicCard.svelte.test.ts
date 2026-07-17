import type { ComponentProps } from 'svelte';
import { describe, expect, type Mock, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import TopicCard from './TopicCard.svelte';

/**
 * TopicCard unit tests.
 *
 * `browser` is `true` under Vitest (browser resolve condition), so the click
 * handler runs. We assert the presentational contract (label, cover-vs-fallback,
 * icon), the anchor href, and the dual interaction contract (onselect intercepts
 * a plain left-click; absent onselect / modified clicks stay plain navigations).
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

function render(props: ComponentProps<typeof TopicCard>) {
  component = mount(TopicCard, { target: document.body, props });
  flushSync();
  return document.querySelector<HTMLAnchorElement>('.topic-card');
}

/** A cancelable, bubbling left-click so `defaultPrevented` is observable. */
function clickAnchor(anchor: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  });
  anchor.dispatchEvent(event);
  flushSync();
  return event;
}

const base = {
  name: 'Field Recordings',
  slug: 'field-recordings',
  href: '/explore?category=field-recordings',
};

describe('TopicCard — rendering', () => {
  test('renders the topic name label', () => {
    const anchor = render(base);
    expect(anchor?.querySelector('.topic-card__name')?.textContent).toContain(
      'Field Recordings'
    );
    cleanup();
  });

  test('renders a cover <img> when coverImageUrl is present (no fallback)', () => {
    const anchor = render({
      ...base,
      coverImageUrl: 'https://cdn.test/cover/md.webp',
    });
    const media = anchor?.querySelector('.topic-card__media');
    const img = media?.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://cdn.test/cover/md.webp');
    expect(media?.classList.contains('topic-card__media--fallback')).toBe(
      false
    );
    cleanup();
  });

  test('renders the brand-gradient fallback (no <img>) when coverImageUrl is absent', () => {
    const anchor = render(base);
    const media = anchor?.querySelector('.topic-card__media');
    expect(media?.querySelector('img')).toBeNull();
    expect(media?.classList.contains('topic-card__media--fallback')).toBe(true);
    cleanup();
  });

  test('renders the icon glyph when present, and omits it when absent', () => {
    const withIcon = render({ ...base, icon: '🎧' });
    expect(withIcon?.querySelector('.topic-card__icon')?.textContent).toContain(
      '🎧'
    );
    cleanup();

    const withoutIcon = render(base);
    expect(withoutIcon?.querySelector('.topic-card__icon')).toBeNull();
    cleanup();
  });

  test('anchor points at the provided href', () => {
    const anchor = render(base);
    expect(anchor?.getAttribute('href')).toBe(
      '/explore?category=field-recordings'
    );
    cleanup();
  });
});

describe('TopicCard — interaction contract', () => {
  test('with onselect: a left-click prevents navigation and calls onselect(slug)', () => {
    const onselect: Mock<SelectFn> = vi.fn<SelectFn>();
    const anchor = render({ ...base, onselect });
    expect(anchor).not.toBeNull();

    const event = clickAnchor(anchor as Element);

    expect(event.defaultPrevented).toBe(true);
    expect(onselect).toHaveBeenCalledTimes(1);
    expect(onselect).toHaveBeenCalledWith('field-recordings');
    cleanup();
  });

  test('without onselect: a left-click is a plain, un-prevented navigation', () => {
    const anchor = render(base);
    expect(anchor).not.toBeNull();

    const event = clickAnchor(anchor as Element);

    expect(event.defaultPrevented).toBe(false);
    cleanup();
  });

  test('with onselect: a modifier click falls through so new-tab intent is preserved', () => {
    const onselect: Mock<SelectFn> = vi.fn<SelectFn>();
    const anchor = render({ ...base, onselect });

    const event = clickAnchor(anchor as Element, { metaKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(onselect).not.toHaveBeenCalled();
    cleanup();
  });
});
