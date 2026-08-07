import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import { mount, unmount } from '$tests/utils/component-test-utils.svelte';
import CreatorPortrait from './CreatorPortrait.svelte';

/**
 * CreatorPortrait unit tests.
 *
 * This primitive exists because four components each drew a creator figure and
 * two of them drew it wrongly. The contract worth pinning is the part that was
 * broken before, plus the two decisions that are easy to "helpfully" undo:
 *
 *  - the monogram fallback is REAL, visible identity, not a ghost at 30% opacity
 *  - no `srcset` is emitted: the stored variants do not reliably match the
 *    widths their filenames imply, so a descriptor would be a lie that makes the
 *    browser render the image SMALLER than it is
 *  - the requested variant is explicit per consumer (`md` cell, `lg` hero)
 *  - the image is decorative; the adjacent heading carries the name
 */

const AVATAR = 'http://localhost:4100/avatars/abc123/md.webp';

describe('CreatorPortrait', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  /**
   * Typed as the component's real props, not `Record<string, unknown>`. The
   * loose shape does not satisfy the required `name`, so `mount` reported
   * `TS2345` under `svelte-check` while `vitest` and `pnpm build` both stayed
   * green — the same blind spot that hid the `Props extends HTMLAttributes`
   * clash in `CreatorCard.svelte`.
   */
  const render = (props: ComponentProps<typeof CreatorPortrait>) => {
    component = mount(CreatorPortrait, { target: document.body, props });
    return document.querySelector('.portrait') as HTMLElement;
  };

  test('renders a square frame by default', () => {
    const root = render({ src: AVATAR, name: 'Mairead Nic an Bhaird' });
    expect(root.dataset.aspect).toBe('square');
  });

  test('renders a 4:5 frame when aspect="portrait"', () => {
    const root = render({ src: AVATAR, name: 'Solveig', aspect: 'portrait' });
    expect(root.dataset.aspect).toBe('portrait');
  });

  test('requests the md variant by default', () => {
    render({ src: 'http://localhost:4100/avatars/abc123/lg.webp', name: 'A' });
    const img = document.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(
      'http://localhost:4100/avatars/abc123/md.webp'
    );
  });

  test('requests the named variant when size is given', () => {
    render({ src: AVATAR, name: 'A', size: 'lg' });
    const img = document.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(
      'http://localhost:4100/avatars/abc123/lg.webp'
    );
  });

  test('never emits a srcset — the width descriptors would be unverified', () => {
    render({ src: AVATAR, name: 'A' });
    const img = document.querySelector('img') as HTMLImageElement;
    expect(img.hasAttribute('srcset')).toBe(false);
  });

  test('treats the photo as decorative, leaving the name to the heading', () => {
    render({ src: AVATAR, name: 'Mairead Nic an Bhaird' });
    const img = document.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('alt')).toBe('');
  });

  test('lazy-loads by default and eager-loads on request', () => {
    render({ src: AVATAR, name: 'A' });
    expect(document.querySelector('img')?.getAttribute('loading')).toBe('lazy');
    unmount(component!);
    component = null;
    document.body.innerHTML = '';

    render({ src: AVATAR, name: 'A', eager: true });
    expect(document.querySelector('img')?.getAttribute('loading')).toBe(
      'eager'
    );
  });

  test('falls back to a monogram when there is no photo', () => {
    render({ src: null, name: 'ffion llewellyn' });
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('.portrait__initial')?.textContent).toBe('F');
  });

  test('takes the monogram from the first non-space character', () => {
    render({ src: null, name: '  Éabha Ní Dhomhnaill' });
    expect(document.querySelector('.portrait__initial')?.textContent).toBe('É');
  });

  test('hides the monogram from assistive tech — it is not the name', () => {
    render({ src: null, name: 'Rangi Te Whaiti' });
    const fallback = document.querySelector('.portrait__fallback');
    expect(fallback?.getAttribute('aria-hidden')).toBe('true');
  });

  test('forwards class without stringifying undefined (R13)', () => {
    const root = render({ src: AVATAR, name: 'A' });
    expect(root.className).not.toContain('undefined');
  });

  test('applies a forwarded class alongside its own', () => {
    const root = render({ src: AVATAR, name: 'A', class: 'custom-frame' });
    expect(root.classList.contains('portrait')).toBe(true);
    expect(root.classList.contains('custom-frame')).toBe(true);
  });
});
