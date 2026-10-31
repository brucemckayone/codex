/**
 * A draft whose media item was deleted can't be published from the editor
 * (Codex-6sbn1, mockup draft-after M1). The draft keeps its link to the deleted
 * item (a support restore heals it), so "Media attached" alone would pass:
 * the readiness check says what happened instead, and Publish stays off.
 * The worker refuses the publish too (`MEDIA_DELETED`).
 *
 * The harness is ContentForm.svelte.test.ts's.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { FakeRemoteForm } from '$tests/utils/fake-remote-form.svelte';

vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  beforeNavigate: vi.fn(),
  invalidateAll: vi.fn(),
  invalidate: vi.fn(),
  afterNavigate: vi.fn(),
  preloadData: vi.fn(),
  pushState: vi.fn(),
  replaceState: vi.fn(),
}));

vi.mock('$lib/remote/content.remote', async () => {
  const { createFakeRemoteForm } = await import(
    '$tests/utils/fake-remote-form.svelte'
  );
  return {
    createContentForm: createFakeRemoteForm(),
    updateContentForm: createFakeRemoteForm(),
    uploadThumbnailForm: createFakeRemoteForm(),
    deleteContent: vi.fn(),
    deleteThumbnailCommand: vi.fn(),
    publishContent: vi.fn(),
    unpublishContent: vi.fn(),
    checkContentSlug: vi.fn(async () => ({ available: true })),
  };
});

vi.mock('$lib/remote/subscription.remote', () => ({
  getMyConnectStatus: () => ({ current: undefined, loading: false }),
  listTiers: () => ({ current: [], loading: false }),
}));

vi.mock('$lib/remote/library.remote', () => ({
  getStreamingUrl: () => ({ current: undefined, loading: false }),
}));

vi.mock('$lib/remote/categories.remote', () => ({
  getCategories: () => ({ current: [], loading: false }),
  createCategoryInline: vi.fn(),
}));

const { updateContentForm } = await import('$lib/remote/content.remote');
const fake = updateContentForm as unknown as FakeRemoteForm;

const ContentForm = (await import('./ContentForm.svelte')).default;

const MEDIA_ID = '33333333-3333-4333-8333-333333333333';

const MEDIA_ITEM = {
  id: MEDIA_ID,
  title: 'Winter Light (rough cut)',
  mediaType: 'video',
  status: 'ready',
  durationSeconds: 1324,
  fileSizeBytes: 1_200_000_000,
  thumbnailKey: null,
  deletedAt: null as string | null,
};

const DRAFT = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Winter Light',
  slug: 'winter-light',
  description: '',
  contentType: 'video',
  status: 'draft',
  visibility: 'public',
  priceCents: 0,
  mediaItemId: MEDIA_ID,
  contentBody: '',
  contentBodyJson: null,
  category: '',
  categoryIds: [],
  tags: [],
  thumbnailUrl: null,
  shaderPreset: null,
  featured: false,
  isTierGated: false,
  includedInTierIds: [],
};

function publishButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === 'Publish'
  );
}

describe('ContentForm · a draft whose media was deleted', () => {
  // biome-ignore lint/suspicious/noExplicitAny: mount()'s component handle
  let component: any;

  beforeEach(() => {
    fake.__reset();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
  });

  function render(deletedAt: string | null) {
    const mediaItem = { ...MEDIA_ITEM, deletedAt };
    component = mount(ContentForm, {
      target: document.body,
      props: {
        // biome-ignore lint/suspicious/noExplicitAny: trimmed ContentWithRelations
        content: { ...DRAFT, mediaItem } as any,
        organizationId: '22222222-2222-4222-8222-222222222222',
        orgSlug: 'studio-alpha',
        // The library list leaves a deleted item out, as the edit route's read does.
        mediaItems: deletedAt ? [] : [mediaItem],
      },
    });
    flushSync();
  }

  it('says why and keeps Publish off', () => {
    render('2026-10-30T09:00:00.000Z');
    const text = document.body.textContent ?? '';
    expect(text).toContain(
      'Choose another media item: the last one was deleted'
    );
    expect(text).toContain('This draft’s media was deleted.');
    expect(publishButton()?.disabled).toBe(true);
  });

  it('the same draft with its media in the library can publish', () => {
    render(null);
    expect(document.body.textContent).not.toContain('the last one was deleted');
    expect(publishButton()?.disabled).toBe(false);
  });
});
