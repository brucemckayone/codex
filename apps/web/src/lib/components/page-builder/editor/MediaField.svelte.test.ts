/**
 * A section inspector's `media` field says, under a film slot, when the film
 * plays only its 30-second preview because paid content uses it (owner P10).
 *
 * The note reads the ONE sell-media store the Media panel reads
 * (`sellMedia.previewOnly`), loaded once with the panel, so the inspector makes
 * no request of its own and the two surfaces cannot disagree. The store is a
 * module-level singleton, so every test resets it with `close()`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JourneySellMedia } from '$lib/page-builder/journey-queries';
import type { BlockField } from '$lib/page-builder/kit';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const PAID = '00000000-0000-4000-8000-000000000001';
const FREE = '00000000-0000-4000-8000-000000000002';

const getJourneySellMedia =
  vi.fn<(input: { pageId: string }) => Promise<JourneySellMedia | null>>();

// Closed factories: every export the store imports, as in
// `sell-media-store.test.ts`.
vi.mock('$lib/remote/journeys.remote', () => ({
  getJourneySellMedia: (input: { pageId: string }) =>
    getJourneySellMedia(input),
  updateJourneySellMedia: vi.fn(),
  deleteJourneyCover: vi.fn(),
  deleteJourneyHeroImage: vi.fn(),
  deleteJourneySignatureImage: vi.fn(),
}));
// The library holds both films, so the picker knows every value a test sets.
vi.mock('$lib/remote/media.remote', () => ({
  listMedia: vi.fn(async () => ({
    items: [
      { id: PAID, title: 'Paid lesson', mediaType: 'video' },
      { id: FREE, title: 'Free trailer', mediaType: 'video' },
    ],
  })),
}));

const { sellMedia } = await import('$lib/page-builder/sell-media-store.svelte');
const { default: MediaField } = await import('./MediaField.svelte');

const NOTE =
  'Visitors see a 30-second preview of this film, because it is part of a paid practice.';

const PERSISTED: JourneySellMedia = {
  courseId: '00000000-0000-4000-8000-0000000000c0',
  introVideoMediaId: PAID,
  previewVideoMediaId: FREE,
  guideVideoMediaId: null,
  guidePortraitMediaId: null,
  heroMediaId: PAID,
  signatureMediaId: null,
  coverImageUrl: null,
  previewOnlyMediaIds: [PAID],
};

function field(mediaSlot: BlockField['mediaSlot']): BlockField {
  return { key: 'film', label: 'Film', control: 'media', mediaSlot };
}

describe('MediaField · the preview-only note (owner P10)', () => {
  let component: ReturnType<typeof mount> | null = null;

  function render(slot: BlockField['mediaSlot']): HTMLElement {
    const target = document.createElement('div');
    document.body.appendChild(target);
    component = mount(MediaField, { target, props: { field: field(slot) } });
    flushSync();
    return target;
  }

  beforeEach(async () => {
    sellMedia.close();
    getJourneySellMedia.mockReset();
    getJourneySellMedia.mockResolvedValue(PERSISTED);
    await sellMedia.open('00000000-0000-4000-8000-0000000000b0');
  });

  afterEach(() => {
    if (component) unmount(component);
    component = null;
    document.body.innerHTML = '';
  });

  it('shows the note under a film slot holding a paid film', () => {
    expect(render('introVideoMediaId').textContent).toContain(NOTE);
  });

  it('shows nothing for a free film, or for the hero loop holding the same paid film', () => {
    expect(render('previewVideoMediaId').textContent).not.toContain(NOTE);
    if (component) unmount(component);
    expect(render('heroMediaId').textContent).not.toContain(NOTE);
  });

  it('follows a pick, from the same read: no request of its own', () => {
    const target = render('guideVideoMediaId');
    expect(target.textContent).not.toContain(NOTE);

    sellMedia.setSlot('guideVideoMediaId', PAID);
    flushSync();
    expect(target.textContent).toContain(NOTE);
    expect(getJourneySellMedia).toHaveBeenCalledTimes(1);
  });
});
