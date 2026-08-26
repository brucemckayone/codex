import { afterEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from '$tests/utils/component-test-utils.svelte';
import CreatorCard from './CreatorCard.svelte';

/**
 * CreatorCard `showcase` unit tests.
 *
 * The showcase variant is the only one with a live consumer (the org creators
 * directory) and it had no test at all, which is how a wrong count and an
 * invalid heading-inside-button survived. These pin the contract the redesign
 * depends on:
 *
 *  - the count is the TRUE `contentCount`, never a sample-derived breakdown
 *  - the heading is a real `<h2>` and is NOT inside the button
 *  - each text row is always present, so cell heights stay deterministic
 *  - the owner gets no geometry change (that misaligned whole grid rows)
 *  - the hit area has a short accessible name, not the entire card's text
 */

const base = {
  variant: 'showcase' as const,
  username: 'mairead',
  displayName: 'Mairead Nic an Bhaird',
  avatar: 'http://localhost:4100/avatars/abc123/md.webp',
  bio: 'Somatic practitioner working with grief and lineage.',
  contentCount: 4,
};

describe('CreatorCard (showcase)', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  const render = (props: Record<string, unknown> = {}) => {
    component = mount(CreatorCard, {
      target: document.body,
      props: { ...base, ...props },
    });
    return document.querySelector('.showcase') as HTMLElement;
  };

  test('renders an article, not a list item, so it works outside a <ul>', () => {
    expect(render().tagName).toBe('ARTICLE');
  });

  test('renders the name as a real h2 outside the button', () => {
    const root = render();
    const heading = root.querySelector('h2.showcase__name');
    expect(heading?.textContent).toBe('Mairead Nic an Bhaird');
    expect(root.querySelector('button h2')).toBeNull();
  });

  test('states the true content count', () => {
    render({ contentCount: 22, recentContent: [] });
    expect(document.querySelector('.showcase__count')?.textContent).toContain(
      '22'
    );
  });

  test('never derives a count from a recentContent sample', () => {
    // The service caps `recentContent` at four rows, so a card that counted
    // those would say "4" for a creator with 22 items.
    render({
      contentCount: 22,
      recentContent: [
        { title: 'a', slug: 'a', thumbnailUrl: null, contentType: 'video' },
        { title: 'b', slug: 'b', thumbnailUrl: null, contentType: 'video' },
      ],
    });
    const text = document.querySelector('.showcase__count')?.textContent ?? '';
    expect(text).toContain('22');
    expect(document.querySelector('.showcase__type-badge')).toBeNull();
  });

  test('shows no count text at zero, but keeps the row for alignment', () => {
    render({ contentCount: 0 });
    const count = document.querySelector('.showcase__count');
    expect(count).not.toBeNull();
    expect(count?.textContent?.trim()).toBe('');
  });

  test('keeps the practice row present when there is no bio', () => {
    render({ bio: null });
    const practice = document.querySelector('.showcase__practice');
    expect(practice).not.toBeNull();
    expect(practice?.textContent).toBe('');
  });

  test('never renders content thumbnails on the card', () => {
    render({
      recentContent: [
        {
          title: 'a',
          slug: 'a',
          thumbnailUrl: 'http://localhost:4100/t/md.webp',
          contentType: 'video',
        },
      ],
    });
    expect(document.querySelector('.showcase__thumbs')).toBeNull();
    // Only the portrait image, never a still.
    expect(document.querySelectorAll('img')).toHaveLength(1);
  });

  test('gives the owner no separate geometry', () => {
    const owner = render({ role: 'owner' });
    const ownerAspect = owner
      .querySelector('.portrait')
      ?.getAttribute('data-aspect');
    expect(owner.classList.contains('showcase--featured')).toBe(false);

    unmount(component!);
    component = null;
    document.body.innerHTML = '';

    const member = render({ role: 'creator' });
    expect(member.querySelector('.portrait')?.getAttribute('data-aspect')).toBe(
      ownerAspect
    );
  });

  test('labels the hit area with just the creator, not the whole card', () => {
    const root = render();
    const hit = root.querySelector('.showcase__hit') as HTMLButtonElement;
    const label = hit.getAttribute('aria-label') ?? '';
    expect(label).toContain('Mairead Nic an Bhaird');
    expect(label).not.toContain('Somatic practitioner');
    expect(hit.getAttribute('aria-haspopup')).toBe('dialog');
  });

  test('invokes onclick from the hit area', () => {
    const onclick = vi.fn<() => void>();
    const root = render({ onclick });
    (root.querySelector('.showcase__hit') as HTMLButtonElement).click();
    expect(onclick).toHaveBeenCalledTimes(1);
  });

  /**
   * The event is contract, not incidental. The directory's drawer is opened
   * programmatically, so Melt has no trigger to restore focus to on close — the
   * caller recovers the restore target from `event.currentTarget`. Swallow the
   * event and Escape drops focus to `<body>` (WCAG 2.4.3).
   *
   * `currentTarget` is read INSIDE the handler, which is the only place it is
   * ever valid. Per DOM §2.9 the dispatcher resets it to `null` when dispatch
   * finishes, so asserting on a retained `mock.calls[0][0].currentTarget` after
   * `.click()` has returned reads null in every conforming implementation, jsdom
   * included — it would fail while the production path (which reads it
   * synchronously in the handler, as here) is perfectly correct.
   */
  test('forwards the click event so the caller can capture the trigger', () => {
    let capturedDuringDispatch: EventTarget | null = null;
    const onclick = vi.fn<(event: MouseEvent) => void>((event) => {
      capturedDuringDispatch = event.currentTarget;
    });
    const root = render({ onclick });
    const hit = root.querySelector('.showcase__hit') as HTMLButtonElement;
    hit.click();
    expect(onclick).toHaveBeenCalledTimes(1);
    expect(capturedDuringDispatch).toBe(hit);
  });

  test('renders a monogram when the creator has no avatar', () => {
    render({ avatar: null });
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('.portrait__initial')?.textContent).toBe('M');
  });

  test('forwards class without stringifying undefined (R13)', () => {
    expect(render().className).not.toContain('undefined');
  });
});
