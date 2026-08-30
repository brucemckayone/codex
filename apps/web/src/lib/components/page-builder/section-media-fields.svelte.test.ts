/**
 * The section inspector's SIX media fields — the option list they offer, and what
 * they say when the library read fails.
 *
 * FOUND BY THE FIELD-INVENTORY SWEEP, not by a bead: nothing had ever gone
 * looking at these six rows as a set, and both defects here are the kind that
 * only an enumeration finds, because neither produces an error.
 *
 * ── 1. THE OPTION LIST ──────────────────────────────────────────────────────
 * `SectionEditor` passed `sellMedia.options` — the WHOLE ready library — while
 * `PageMediaPanel` passed `sellMedia.optionsFor(slot)`. The store's own doc
 * comment states the invariant that makes one of those wrong:
 *
 *     "Every surface with a sell-media picker calls THIS rather than reading
 *      `options` directly, so the panel and the per-section inspector cannot
 *      drift into offering different lists for the same slot."
 *
 * The inspector was the surface that had drifted. `SLOT_ACCEPTS` gives the three
 * STILL slots — `heroMediaId`, `guidePortraitMediaId`, `signatureMediaId` — video
 * ONLY, because an audio item has `thumbnailKey: null` by construction and can
 * never resolve to a frame. So the hero image, the guide portrait and the
 * signature offered a creator audio items that could only ever render as nothing:
 * picked, saved clean, no error anywhere, section unchanged. Exactly the failure
 * the panel's comment says the accept-list exists to prevent, on the surface the
 * comment claims cannot have it.
 *
 * ── 2. THE READ FAILURE ─────────────────────────────────────────────────────
 * `sellMedia.loadError` was populated by both of `open()`'s reads and rendered
 * ONLY in `PageMediaPanel`. The same store feeds the `media` control in every
 * section inspector, and those rendered nothing — so a failed library read was
 * indistinguishable from "you have no ready media": an empty picker, no message,
 * a creator who concludes their account is empty. That is the same
 * recorded-but-never-rendered shape the panel's own comment describes fixing on
 * its side, left standing on this one.
 *
 * Both are asserted BEHAVIOURALLY (real component, real store, real DOM) rather
 * than by grepping the source, because in both cases the source reads perfectly
 * well: `sellMedia.options` is a legal expression and an absent element is not a
 * syntax error.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PageBuilderState, PageSection } from '@codex/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const listMedia = vi.fn();
const getJourneySellMedia = vi.fn();

// A CLOSED factory, like `sell-media-store.test.ts`'s: `vi.mock` replaces the
// whole module, so an import the store adds later throws at first ACCESS rather
// than at load — which looks like a bug in the method that uses it.
vi.mock('$lib/remote/journeys.remote', () => ({
  getJourneySellMedia: (input: unknown) => getJourneySellMedia(input),
  updateJourneySellMedia: vi.fn(),
  uploadJourneyCoverForm: { enhance: vi.fn(), fields: {}, pending: 0 },
  deleteJourneyCover: vi.fn(),
  uploadJourneyHeroImageForm: { enhance: vi.fn(), fields: {}, pending: 0 },
  deleteJourneyHeroImage: vi.fn(),
  uploadJourneySignatureImageForm: { enhance: vi.fn(), fields: {}, pending: 0 },
  deleteJourneySignatureImage: vi.fn(),
}));
vi.mock('$lib/remote/media.remote', () => ({
  listMedia: (input: unknown) => listMedia(input),
}));

const { pageBuilder } = await import(
  '$lib/page-builder/page-builder-store.svelte'
);
const { sellMedia } = await import('$lib/page-builder/sell-media-store.svelte');
const { SLOT_ACCEPTS } = await import(
  '$lib/page-builder/sell-media-store.svelte'
);
const SectionEditor = (await import('./SectionEditor.svelte')).default;
const { SECTION_FIELDS } = await import('./section-fields');

const HERE = dirname(fileURLToPath(import.meta.url));

const PAGE_ID = '00000000-0000-4000-8000-00000000f001';
const COURSE_ID = '00000000-0000-4000-8000-00000000f0c0';

/** One video and one audio item, both `ready` — the discriminating library. */
const LIBRARY = [
  {
    id: 'v1',
    title: 'A film',
    mediaType: 'video',
    durationSeconds: 10,
    fileSizeBytes: 2048,
  },
  {
    id: 'a1',
    title: 'A recording',
    mediaType: 'audio',
    durationSeconds: 10,
    fileSizeBytes: 2048,
  },
];

function pageWith(section: PageSection): PageBuilderState {
  return {
    pageType: 'course',
    slug: 'media-sweep',
    title: 'Media sweep',
    status: 'draft',
    subjectType: 'course',
    subjectId: COURSE_ID,
    brandOverrides: null,
    sections: [section],
  } as PageBuilderState;
}

/** The live section out of the store's pending draft. */
function live(): PageSection {
  const section = pageBuilder.pending?.sections[0];
  if (!section)
    throw new Error('no pending section — open() did not seed the draft');
  return section;
}

function mountType(type: string) {
  pageBuilder.close();
  pageBuilder.open(
    PAGE_ID,
    pageWith({ id: 'sec', type, enabled: true, props: {} } as PageSection)
  );
  const component = mount(SectionEditor, {
    target: document.body,
    props: { section: live() },
  });
  flushSync();
  return component;
}

function blockFor(label: string): HTMLElement {
  const found = [
    ...document.body.querySelectorAll<HTMLElement>('.section-editor__field'),
  ].find(
    (el) =>
      el.querySelector('.section-editor__field-label')?.textContent?.trim() ===
      label
  );
  if (!found) throw new Error(`no field block labelled "${label}"`);
  return found;
}

/** The titles a slot's picker actually offers, read from its open dropdown. */
function offeredTitles(block: HTMLElement): string[] {
  const input = block.querySelector<HTMLInputElement>('input.picker-trigger');
  if (!input) throw new Error('picker has no combobox input');
  input.click();
  flushSync();
  const dropdown = block.querySelector('.picker-dropdown');
  if (!dropdown) throw new Error('picker did not open');
  return [...dropdown.querySelectorAll('.option-title')].map(
    (el) => el.textContent?.trim() ?? ''
  );
}

/** Every media field the catalogue declares, with the slot it targets. */
const MEDIA_FIELDS = Object.entries(SECTION_FIELDS).flatMap(([type, fields]) =>
  fields
    .filter((f) => f.control === 'media' && f.mediaSlot)
    .map((f) => ({ type, label: f.label, slot: f.mediaSlot as string }))
);

beforeEach(async () => {
  pageBuilder.close();
  sellMedia.close();
  getJourneySellMedia.mockReset();
  getJourneySellMedia.mockResolvedValue(null);
  listMedia.mockReset();
  listMedia.mockResolvedValue({ items: LIBRARY });
});

afterEach(() => {
  document.body.innerHTML = '';
  pageBuilder.close();
  sellMedia.close();
});

describe('the inspector offers each slot only what that slot can hold', () => {
  it('fields exactly six media controls, over four section types', () => {
    // The anchor. A slot that loses its field, or a seventh that appears without
    // being swept, changes this number.
    expect(MEDIA_FIELDS).toHaveLength(6);
    expect(new Set(MEDIA_FIELDS.map((f) => f.type))).toEqual(
      new Set(['hero', 'introVideo', 'reel', 'guide'])
    );
    expect(new Set(MEDIA_FIELDS.map((f) => f.slot)).size).toBe(6);
  });

  for (const field of MEDIA_FIELDS) {
    const accepts = SLOT_ACCEPTS[field.slot as keyof typeof SLOT_ACCEPTS];
    const expected = LIBRARY.filter((i) => accepts.includes(i.mediaType)).map(
      (i) => i.title
    );

    it(`${field.type}.${field.slot} offers ${JSON.stringify(expected)}`, async () => {
      await sellMedia.open(PAGE_ID);
      // The library really does hold both kinds — otherwise the assertion below
      // could pass on an empty list and prove nothing.
      expect(sellMedia.options).toHaveLength(2);

      const component = mountType(field.type);
      expect(offeredTitles(blockFor(field.label))).toEqual(expected);
      unmount(component);
    });
  }

  it('excludes an AUDIO item from all three STILL slots — the defect this pins', () => {
    // Stated once, explicitly, so the intent survives a change to `SLOT_ACCEPTS`:
    // a still slot that offered audio let a creator attach an item with no frame.
    const stills = MEDIA_FIELDS.filter(
      (f) =>
        !SLOT_ACCEPTS[f.slot as keyof typeof SLOT_ACCEPTS].includes('audio')
    );
    expect(stills.map((f) => f.slot).sort()).toEqual([
      'guidePortraitMediaId',
      'heroMediaId',
      'signatureMediaId',
    ]);
  });
});

describe('the inspector says so when the media library could not be read', () => {
  it('renders the reason, not six empty pickers', async () => {
    listMedia.mockRejectedValue(new Error('nope'));
    await sellMedia.open(PAGE_ID);
    expect(sellMedia.loadError).toBeTruthy();

    const component = mountType('guide');
    const alert = document.body.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe(sellMedia.loadError);
    // And the pickers really are empty, which is why the message is the only
    // thing distinguishing a hiccup from an empty account.
    expect(sellMedia.options).toHaveLength(0);
    unmount(component);
  });

  it('says nothing about media on a section that fields no media control', async () => {
    listMedia.mockRejectedValue(new Error('nope'));
    await sellMedia.open(PAGE_ID);
    expect(sellMedia.loadError).toBeTruthy();

    const component = mountType('ache');
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
    unmount(component);
  });

  it('reports nothing at all on a clean read', async () => {
    await sellMedia.open(PAGE_ID);
    expect(sellMedia.loadError).toBeNull();

    const component = mountType('hero');
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
    unmount(component);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The Media PANEL's three upload frames — a source-text guard, and why
// ─────────────────────────────────────────────────────────────────────────────
//
// SOURCE TEXT rather than a mount, stated plainly: `PageMediaPanel` consumes
// three `form()` remote objects and calls `.enhance()`, `.fields.x.as(...)` and
// `.result` on each. Faking those well enough to mount is a fake of SvelteKit's
// remote-form runtime, not of this panel, and a test whose subject is its own
// stubs proves nothing. The behavioural half of this panel already lives in
// `builder-chrome-i18n.svelte.test.ts` (which mounts it) — this is the one
// attribute that file does not look at.
//
// THE DEFECT: `.cover__file` is hidden with the 1px clip, which keeps it in the
// TAB ORDER, and the input has no accessible name of any kind. So a keyboard
// user met three unnamed file inputs — cover, hero image, signature — before
// reaching the buttons that name them. The panel's own comment states the design
// it was half-implementing: "the file input stays visually hidden and the styled
// button opens it, then `change` submits." The button is the control; the input
// is the mechanism, and a mechanism does not belong in the tab order.

describe('the media panel keeps its proxied file inputs out of the tab order', () => {
  const panel = readFileSync(join(HERE, 'PageMediaPanel.svelte'), 'utf8');

  it('has exactly three visually-hidden file inputs, and each is tabindex="-1"', () => {
    // Count first, so the assertion cannot pass by there being none.
    const inputs = [
      ...panel.matchAll(/<input\b[^>]*class="cover__file"[^>]*>/g),
    ].map((m) => m[0]);
    expect(inputs).toHaveLength(3);
    for (const tag of inputs) {
      expect(tag, tag.slice(0, 90)).toMatch(/tabindex="-1"/);
    }
  });

  it('still hides them with the CLIP, which is what makes the tabindex necessary', () => {
    // If someone later switches to `display: none` the tabindex becomes
    // redundant rather than wrong — but a switch the other way, back to a clip
    // WITHOUT the tabindex, is the regression. Pinning the clip keeps the two
    // facts together so the next reader sees why the attribute is there.
    expect(panel).toMatch(/\.cover__file\s*\{[^}]*clip-path:\s*inset\(50%\)/);
  });

  it('leaves the naming on the BUTTON, which is the control', () => {
    // Three buttons, one per frame, each named from messages rather than by a
    // glyph or a bare icon.
    const buttons = [...panel.matchAll(/<button\b[^>]*class="cover__btn"/g)];
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    expect(panel).toMatch(/m\.studio_builder_media_upload\(\)/);
    expect(panel).toMatch(/m\.studio_builder_media_replace\(\)/);
  });

  it('is a guard that can fail — the pattern is proved on both a good and a bad tag', () => {
    // A negative assertion nobody has watched fail is not a guard (the round's
    // own rule). Proved on synthetic input so the corpus above is not the only
    // evidence the regex discriminates.
    const good = '<input class="cover__file" tabindex="-1" />';
    const bad = '<input class="cover__file" />';
    expect(/tabindex="-1"/.test(good)).toBe(true);
    expect(/tabindex="-1"/.test(bad)).toBe(false);
    expect([
      ...`${good}${bad}`.matchAll(/<input\b[^>]*class="cover__file"[^>]*>/g),
    ]).toHaveLength(2);
  });
});
