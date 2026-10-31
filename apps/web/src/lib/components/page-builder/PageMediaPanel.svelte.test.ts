/**
 * Settings → Media says "Media missing" under a slot whose media was deleted
 * from its library (Codex-6sbn1, mockup draft-after M2). The course keeps the
 * link, so the picker reads empty; the note under the slot is the reason, and
 * it goes as soon as another item (or none) is picked.
 *
 * Rendered, not read from the source: the store is the real one, fed by a
 * faked `getJourneySellMedia`.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { JourneySellMedia } from '$lib/page-builder/journey-queries';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const { getJourneySellMedia } = vi.hoisted(() => ({
  getJourneySellMedia:
    vi.fn<(input: { pageId: string }) => Promise<JourneySellMedia | null>>(),
}));

vi.mock('$lib/remote/journeys.remote', async () => {
  const { createFakeRemoteForm } = await import(
    '$tests/utils/fake-remote-form.svelte'
  );
  return {
    getJourneySellMedia: (input: { pageId: string }) =>
      getJourneySellMedia(input),
    updateJourneySellMedia: vi.fn(),
    uploadJourneyCoverForm: createFakeRemoteForm(),
    deleteJourneyCover: vi.fn(),
    uploadJourneyHeroImageForm: createFakeRemoteForm(),
    deleteJourneyHeroImage: vi.fn(),
    uploadJourneySignatureImageForm: createFakeRemoteForm(),
    deleteJourneySignatureImage: vi.fn(),
  };
});

vi.mock('$lib/remote/media.remote', () => ({
  listMedia: async () => ({ items: [] }),
}));

vi.mock('$lib/utils/shrink-photo', () => ({ shrinkPhotoAndSubmit: vi.fn() }));

const { sellMedia } = await import('$lib/page-builder/sell-media-store.svelte');
const PageMediaPanel = (await import('./PageMediaPanel.svelte')).default;

const PAGE_ID = '00000000-0000-4000-8000-0000000000b0';
const REEL_ID = '00000000-0000-4000-8000-000000000002';

const MEDIA: JourneySellMedia = {
  courseId: '00000000-0000-4000-8000-0000000000c0',
  introVideoMediaId: '00000000-0000-4000-8000-000000000001',
  previewVideoMediaId: REEL_ID,
  guideVideoMediaId: null,
  guidePortraitMediaId: null,
  heroMediaId: null,
  signatureMediaId: null,
  coverImageUrl: null,
  missingMedia: [{ id: REEL_ID, title: 'Winter Light (rough cut)' }],
};

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  sellMedia.close();
  document.body.innerHTML = '';
});

/** The slot's field, found by its visible label. */
function field(label: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('.panel__field')].find(
    (el) => el.querySelector('.panel__label')?.textContent?.trim() === label
  );
}

describe('PageMediaPanel · media missing', () => {
  test('says so under the slot whose media was deleted, and under no other', async () => {
    getJourneySellMedia.mockResolvedValue(MEDIA);
    await sellMedia.open(PAGE_ID);
    component = mount(PageMediaPanel, { target: document.body, props: {} });
    flushSync();

    expect(
      field('Practice reel')
        ?.querySelector('.panel__missing')
        ?.textContent?.trim()
    ).toBe(
      'Media missing: Winter Light (rough cut) was deleted. Choose another media item.'
    );
    expect(document.querySelectorAll('.panel__missing')).toHaveLength(1);
  });

  test('in the real order, panel up before the read lands: the note shows and no slot loses its media', async () => {
    // The builder mounts the panel, then the read answers. With the REAL
    // picker: one that echoed a slot's id the library lacks as a clear
    // emptied the slot, hid the note, and the autosave cut the link.
    getJourneySellMedia.mockResolvedValue(MEDIA);
    component = mount(PageMediaPanel, { target: document.body, props: {} });
    flushSync();
    await sellMedia.open(PAGE_ID);
    flushSync();

    expect(
      field('Practice reel')?.querySelector('.panel__missing')
    ).not.toBeNull();
    expect(sellMedia.slot('previewVideoMediaId')).toBe(REEL_ID);
    expect(sellMedia.slot('introVideoMediaId')).toBe(MEDIA.introVideoMediaId);
    expect(sellMedia.isDirty).toBe(false);
  });

  test('clearing the slot takes the note away', async () => {
    getJourneySellMedia.mockResolvedValue(MEDIA);
    await sellMedia.open(PAGE_ID);
    component = mount(PageMediaPanel, { target: document.body, props: {} });
    flushSync();

    sellMedia.setSlot('previewVideoMediaId', null);
    flushSync();
    expect(document.querySelector('.panel__missing')).toBeNull();
  });
});
