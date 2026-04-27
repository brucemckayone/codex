/**
 * Spotlight component proof test — Codex-v5bzy.
 *
 * Pre-fix bug: SpotlightItem declared creator: {username?, displayName?, avatar?}
 * but the API (ContentWithRelations.creator) returns {id, email, name: string|null}.
 * Both `displayName ?? username ?? ''` fallbacks evaluated undefined → creatorName
 * was always '' → the {#if creatorName} block never rendered.
 *
 * This test asserts that with the canonical API shape (creator.name), the
 * rendered output shows the creator name.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from '$tests/utils/component-test-utils.svelte';

vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost:3000/') },
}));

import Spotlight from './Spotlight.svelte';

describe('Spotlight', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders creator name from API shape (creator.name)', () => {
    component = mount(Spotlight, {
      target: document.body,
      props: {
        item: {
          id: '00000000-0000-0000-0000-000000000001',
          title: 'Test Title',
          slug: 'test-title',
          contentType: 'video',
          creator: { name: 'Jane Doe' },
        },
      },
    });

    const creatorEl = document.body.querySelector('.spotlight__creator-name');
    expect(creatorEl).toBeTruthy();
    expect(creatorEl?.textContent?.trim()).toBe('Jane Doe');
    expect(document.body.textContent).toContain('Jane Doe');
  });

  test('omits creator block when name is null', () => {
    component = mount(Spotlight, {
      target: document.body,
      props: {
        item: {
          id: '00000000-0000-0000-0000-000000000002',
          title: 'No Creator',
          slug: 'no-creator',
          contentType: 'video',
          creator: { name: null },
        },
      },
    });

    expect(document.body.querySelector('.spotlight__creator')).toBeNull();
  });

  test('omits creator block when creator is absent', () => {
    component = mount(Spotlight, {
      target: document.body,
      props: {
        item: {
          id: '00000000-0000-0000-0000-000000000003',
          title: 'No Creator At All',
          slug: 'no-creator-at-all',
          contentType: 'video',
        },
      },
    });

    expect(document.body.querySelector('.spotlight__creator')).toBeNull();
  });
});
