/**
 * A draft whose thumbnail is a frame of a deleted video can't be published
 * from the editor (Codex-tqvmx, mockup approved 2026-11-02): the Thumbnail
 * section warns, the readiness check says what to do, and Publish stays off.
 * Choosing another thumbnail clears it before saving. The worker refuses the
 * publish too (`THUMBNAIL_MEDIA_DELETED`).
 *
 * The harness is ContentForm.media-deleted.svelte.test.ts's.
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
const FRAME_ID = '44444444-4444-4444-8444-444444444444';
const FRAME_URL = `https://cdn-assets.example/creator-1/media-thumbnails/${FRAME_ID}/1920x1080-0a1b2c3d/lg.webp`;

const MEDIA_ITEM = {
  id: MEDIA_ID,
  title: 'Winter Light',
  mediaType: 'video',
  status: 'ready',
  durationSeconds: 1324,
  fileSizeBytes: 1_200_000_000,
  thumbnailKey: null,
  deletedAt: null,
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
  mediaItem: MEDIA_ITEM,
  contentBody: '',
  contentBodyJson: null,
  category: '',
  categoryIds: [],
  tags: [],
  thumbnailUrl: FRAME_URL,
  shaderPreset: null,
  featured: false,
  isTierGated: false,
  includedInTierIds: [],
};

const WARNING = 'This thumbnail is a frame of a deleted video.';
const CHECK = 'Choose another thumbnail: its video was deleted';

function publishButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === 'Publish'
  );
}

describe("ContentForm · a draft whose thumbnail is a deleted video's frame", () => {
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
    component = mount(ContentForm, {
      target: document.body,
      props: {
        content: {
          ...DRAFT,
          thumbnailFrame: {
            mediaItemId: FRAME_ID,
            title: 'Winter Light (first cut)',
            deletedAt,
          },
          // biome-ignore lint/suspicious/noExplicitAny: trimmed ContentWithRelations
        } as any,
        organizationId: '22222222-2222-4222-8222-222222222222',
        orgSlug: 'studio-alpha',
        mediaItems: [MEDIA_ITEM],
      },
    });
    flushSync();
  }

  it('says why, names the video, and keeps Publish off', () => {
    render('2026-11-02T09:00:00.000Z');
    const text = document.body.textContent ?? '';
    expect(text).toContain(WARNING);
    expect(text).toContain(CHECK);
    expect(text).toContain('Winter Light (first cut)');
    expect(publishButton()?.disabled).toBe(true);
  });

  it('choosing another thumbnail clears it before saving', () => {
    render('2026-11-02T09:00:00.000Z');
    fake.fields.thumbnailUrl.set('');
    flushSync();
    expect(document.body.textContent).not.toContain(WARNING);
    expect(document.body.textContent).not.toContain(CHECK);
    expect(publishButton()?.disabled).toBe(false);
  });

  it('a frame of a video still in the library warns of nothing', () => {
    render(null);
    expect(document.body.textContent).not.toContain(WARNING);
    expect(publishButton()?.disabled).toBe(false);
  });
});
