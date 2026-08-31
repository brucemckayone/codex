/**
 * THE BUILDER'S CHROME IS LOCALISED, and every key it calls actually exists.
 *
 * The journey builder was the only surface in this feature with no localisation:
 * zero `$paraglide` imports across its components and its two routes, while nine
 * of the eleven PUBLIC sections it edits already route their chrome through
 * `m.*`. This file guards the two halves of that extraction that can regress
 * silently.
 *
 * 1. CALLED-VS-GENERATED. Paraglide emits TWO artifacts — `src/paraglide/
 *    messages/en.js` and the `src/paraglide/messages.js` barrel — and both are
 *    git-tracked. A key added to `messages/en.json` but committed without its
 *    generated pair is a `m.x is not a function` at RUNTIME, on a surface no
 *    test mounts; the build passes and so does every other test, because the
 *    calling code is only reachable with real data. So the check is
 *    source-level: every `m.<key>()` the builder calls must exist in
 *    `messages/en.json` AND in the generated barrel.
 *
 * 2. FOUR PANELS NOTHING ELSE MOUNTS. `SectionList`, `PageDesignPanel`,
 *    `PagePricingPanel` and `PageMediaPanel` are mounted only by the builder
 *    route, which is verified by source-text assertion (its remotes cannot run
 *    under vitest). Nothing compiled them, so a bad message reference in one of
 *    them was invisible. Mounting each and reading one localised string back is
 *    what makes the extraction falsifiable rather than merely typed.
 *
 * DELIBERATELY NOT ASSERTED HERE: "no English literal remains in the markup".
 * That scan is the right measurement for a review, but as a committed test it
 * fails on any sibling's legitimate new control — it would booby-trap the next
 * writer to add a button. The residual-literal sweep belongs in the PR, not in
 * the suite.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PageBuilderState } from '@codex/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
import { sellMedia } from '$lib/page-builder/sell-media-store.svelte';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import PageDesignPanel from './PageDesignPanel.svelte';
import PageMediaPanel from './PageMediaPanel.svelte';
import PagePricingPanel from './PagePricingPanel.svelte';
import SectionList from './SectionList.svelte';

/**
 * The media library read, stubbed.
 *
 * `PageMediaPanel`'s cover form declares a HIDDEN `pageId` field, and SvelteKit's
 * dev guard throws on a hidden input with an empty value — so `sellMedia` has to
 * hold a page id before the panel can mount, which means `open()` has to run. An
 * unmocked `query()` dies on `app.hooks` under vitest (there is no client app),
 * so the ONE read `open({ hasCourse: false })` still makes is stubbed. Nothing
 * else in `journeys.remote` is touched: `uploadJourneyCoverForm` must stay REAL,
 * because the panel calls `.enhance()` and `.fields.*.as()` on it at mount.
 */
vi.mock('$lib/remote/media.remote', () => ({
  listMedia: () => Promise.resolve({ items: [] }),
}));

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_SRC = join(HERE, '..', '..', '..');

/** Every file whose chrome was moved behind Paraglide. */
const LOCALISED = [
  join(HERE, 'AddSectionPicker.svelte'),
  join(HERE, 'ArrayField.svelte'),
  join(HERE, 'DesignAxisControl.svelte'),
  join(HERE, 'JourneyBuilderCanvas.svelte'),
  join(HERE, 'PageBrandPanel.svelte'),
  join(HERE, 'PageDesignPanel.svelte'),
  join(HERE, 'PageMediaPanel.svelte'),
  join(HERE, 'PagePricingPanel.svelte'),
  join(HERE, 'PageSeoPanel.svelte'),
  join(HERE, 'SectionEditor.svelte'),
  join(HERE, 'SectionList.svelte'),
  join(WEB_SRC, 'routes/_org/[slug]/studio/journeys/[id]/page/+page.svelte'),
  join(WEB_SRC, 'routes/_org/[slug]/studio/journeys/new/+page.svelte'),
];

const PAGE_ID = '00000000-0000-4000-8000-0000000000i1'.replace('i', 'a');

function draft(overrides: Partial<PageBuilderState> = {}): PageBuilderState {
  return {
    pageType: 'course',
    slug: 'stillness',
    title: 'Stillness',
    status: 'draft',
    subjectType: 'course',
    subjectId: '00000000-0000-4000-8000-00000000c001',
    brandOverrides: null,
    sections: [],
    ...overrides,
  } as PageBuilderState;
}

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  pageBuilder.close();
  sellMedia.close();
  document.body.innerHTML = '';
});

describe('every message key the builder calls exists in BOTH paraglide artifacts', () => {
  const called = new Map<string, string[]>();
  for (const file of LOCALISED) {
    const source = readFileSync(file, 'utf8');
    for (const hit of source.matchAll(/\bm\.([a-z][A-Za-z0-9_]*)\s*\(/g)) {
      const key = hit[1];
      called.set(key, [...(called.get(key) ?? []), file]);
    }
  }

  it('found call sites at all — the guard is not vacuous', () => {
    // Without this, deleting every `m.*()` call would make the suite green.
    expect(called.size).toBeGreaterThan(150);
  });

  it('every file routes its chrome through $paraglide/messages', () => {
    for (const file of LOCALISED) {
      expect(
        readFileSync(file, 'utf8'),
        `${file} calls no messages / has no import`
      ).toContain("from '$paraglide/messages'");
    }
  });

  it('names a key that exists in messages/en.json', () => {
    const source = JSON.parse(
      readFileSync(join(WEB_SRC, '..', 'messages', 'en.json'), 'utf8')
    ) as Record<string, string>;
    const missing = [...called.keys()].filter((key) => !(key in source));
    expect(missing, 'called but not declared in messages/en.json').toEqual([]);
  });

  it('names a key the GENERATED barrel actually exports', () => {
    // The trap this closes: `messages/en.json` and `src/paraglide/**` are
    // separate commits waiting to happen, and only the generated side is what
    // the browser loads.
    const exported = m as unknown as Record<string, unknown>;
    const missing = [...called.keys()].filter(
      (key) => typeof exported[key] !== 'function'
    );
    expect(
      missing,
      'called but not generated into $paraglide/messages'
    ).toEqual([]);
  });
});

describe('the four panels only the route mounts render their localised chrome', () => {
  it('SectionList names itself and its empty state from messages', () => {
    pageBuilder.open(PAGE_ID, draft());
    component = mount(SectionList, { target: document.body });
    flushSync();
    const text = document.body.textContent ?? '';
    expect(text).toContain(m.studio_builder_sections());
    expect(text).toContain(m.studio_builder_sections_empty());
  });

  it('PageDesignPanel names its heading and its inherit summary', () => {
    pageBuilder.open(PAGE_ID, draft());
    component = mount(PageDesignPanel, { target: document.body });
    flushSync();
    const text = document.body.textContent ?? '';
    expect(text).toContain(m.studio_builder_look_title());
    expect(text).toContain(m.studio_builder_look_inherits());
    expect(text).toContain(m.studio_builder_look_custom());
  });

  it('PagePricingPanel names its ways in, and prices in GBP', () => {
    pageBuilder.open(PAGE_ID, draft());
    component = mount(PagePricingPanel, { target: document.body });
    flushSync();
    const text = document.body.textContent ?? '';
    expect(text).toContain(m.studio_builder_pricing_title());
    expect(text).toContain(m.studio_builder_pricing_ways_in());
    expect(text).toContain(m.studio_builder_pricing_tiers_pick());
    // Currency is GBP on this surface, never USD.
    expect(text).not.toContain('$');
  });

  it('PageMediaPanel names every sell-media slot from messages', async () => {
    pageBuilder.open(PAGE_ID, draft());
    // The cover form declares a HIDDEN `pageId` field, and SvelteKit's dev guard
    // throws on a hidden input with an empty value — so the store must hold a
    // page id before this panel can mount at all. `hasCourse: false` skips the
    // journey-media read; the library read fails soft inside the store.
    await sellMedia.open(PAGE_ID, { hasCourse: false });
    component = mount(PageMediaPanel, { target: document.body });
    flushSync();
    const text = document.body.textContent ?? '';
    expect(text).toContain(m.studio_builder_media_title());
    expect(text).toContain(m.studio_builder_media_cover());
    // The six slot labels come from a table of THUNKS — a plain-string table
    // would have resolved at module load, before the request's language tag.
    for (const label of [
      m.studio_builder_media_slot_hero(),
      m.studio_builder_media_slot_intro(),
      m.studio_builder_media_slot_reel(),
      m.studio_builder_media_slot_guide_portrait(),
      m.studio_builder_media_slot_guide_video(),
      m.studio_builder_media_slot_signature(),
    ]) {
      expect(text, `slot label ${label} did not render`).toContain(label);
    }
  });
});
