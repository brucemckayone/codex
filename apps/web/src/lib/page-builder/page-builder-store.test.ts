/**
 * Page-builder store tests (Codex-2pryk.3.3 · WP-5).
 *
 * The `saved`/`pending` spine drives the whole builder + the live preview, so
 * the section mutations (add / remove / reorder / toggle / prop edits), the
 * dirty diff, per-section reset, discard, and the preview-applier entry point
 * are each proven. The store is a Svelte 5 module-level `$state` singleton, so
 * every test resets via `close()` then re-opens with a known saved draft.
 */

import type { PageBuilderState, PageSection } from '@codex/shared-types';
import { beforeEach, describe, expect, it } from 'vitest';
import { pageBuilder } from './page-builder-store.svelte';

const PAGE_ID = '00000000-0000-4000-8000-000000000000';

function makeSection(overrides: Partial<PageSection> = {}): PageSection {
  return {
    id: 'sec-hero',
    type: 'hero',
    enabled: true,
    props: {},
    ...overrides,
  };
}

function makeSaved(
  overrides: Partial<PageBuilderState> = {}
): PageBuilderState {
  return {
    pageType: 'course',
    slug: 'stillness',
    title: 'Stillness',
    status: 'draft',
    subjectType: 'course',
    subjectId: 'course-1',
    brandOverrides: null,
    sections: [
      makeSection({ id: 'sec-hero', type: 'hero' }),
      makeSection({ id: 'sec-ache', type: 'ache' }),
      makeSection({ id: 'sec-invite', type: 'invite' }),
    ],
    ...overrides,
  };
}

describe('pageBuilder — session lifecycle', () => {
  beforeEach(() => {
    pageBuilder.close();
    // Deterministic ids for addSection assertions.
    let n = 0;
    pageBuilder.setIdFactory(() => `new-${++n}`);
  });

  it('open() seeds pending from a clone of saved and focuses the first section', () => {
    pageBuilder.open(PAGE_ID, makeSaved());

    expect(pageBuilder.isOpen).toBe(true);
    expect(pageBuilder.pageId).toBe(PAGE_ID);
    expect(pageBuilder.pending?.title).toBe('Stillness');
    expect(pageBuilder.selectedSectionId).toBe('sec-hero');
    // pending is a distinct object graph — mutating it must not touch saved.
    expect(pageBuilder.pending).not.toBe(pageBuilder.saved);
    expect(pageBuilder.isDirty).toBe(false);
  });

  it('close() clears the session', () => {
    pageBuilder.open(PAGE_ID, makeSaved());
    pageBuilder.close();

    expect(pageBuilder.isOpen).toBe(false);
    expect(pageBuilder.pending).toBeNull();
    expect(pageBuilder.saved).toBeNull();
    expect(pageBuilder.pageId).toBeNull();
    expect(pageBuilder.selectedSectionId).toBeNull();
  });
});

describe('pageBuilder — section mutations', () => {
  beforeEach(() => {
    pageBuilder.close();
    let n = 0;
    pageBuilder.setIdFactory(() => `new-${++n}`);
    pageBuilder.open(PAGE_ID, makeSaved());
  });

  it('toggleSection flips enabled and marks dirty', () => {
    pageBuilder.toggleSection('sec-ache');
    expect(pageBuilder.sections.find((s) => s.id === 'sec-ache')?.enabled).toBe(
      false
    );
    expect(pageBuilder.isDirty).toBe(true);
  });

  it('addSection appends an enabled section with the injected id and focuses it', () => {
    const id = pageBuilder.addSection('faq');
    expect(id).toBe('new-1');
    const added = pageBuilder.sections.at(-1);
    expect(added).toMatchObject({
      id: 'new-1',
      type: 'faq',
      enabled: true,
      props: {},
    });
    expect(pageBuilder.selectedSectionId).toBe('new-1');
  });

  it('removeSection drops the section and re-focuses a neighbour', () => {
    pageBuilder.selectSection('sec-ache');
    pageBuilder.removeSection('sec-ache');
    expect(pageBuilder.sections.map((s) => s.id)).toEqual([
      'sec-hero',
      'sec-invite',
    ]);
    // Focus moves to the section that slid into the removed slot.
    expect(pageBuilder.selectedSectionId).toBe('sec-invite');
  });

  it('moveSection reorders up and down and clamps at the ends', () => {
    pageBuilder.moveSection('sec-ache', -1);
    expect(pageBuilder.sections.map((s) => s.id)).toEqual([
      'sec-ache',
      'sec-hero',
      'sec-invite',
    ]);
    // Already first — moving up again is a no-op.
    pageBuilder.moveSection('sec-ache', -1);
    expect(pageBuilder.sections[0].id).toBe('sec-ache');

    pageBuilder.moveSection('sec-invite', 1); // already last — no-op
    expect(pageBuilder.sections.at(-1)?.id).toBe('sec-invite');
  });

  it('setSectionProp merges one key without clobbering the rest', () => {
    pageBuilder.setSectionProp(
      'sec-hero',
      'headline',
      'Come home to stillness'
    );
    pageBuilder.setSectionProp('sec-hero', 'kicker', 'A 6-week descent');
    const hero = pageBuilder.sections.find((s) => s.id === 'sec-hero');
    expect(hero?.props).toEqual({
      headline: 'Come home to stillness',
      kicker: 'A 6-week descent',
    });
  });
});

describe('pageBuilder — revert paths', () => {
  beforeEach(() => {
    pageBuilder.close();
    pageBuilder.open(PAGE_ID, makeSaved());
  });

  it('discard restores pending to the saved baseline', () => {
    pageBuilder.setSectionProp('sec-hero', 'headline', 'edited');
    pageBuilder.addSection('proof');
    expect(pageBuilder.isDirty).toBe(true);

    pageBuilder.discard();
    expect(pageBuilder.isDirty).toBe(false);
    expect(pageBuilder.sections.map((s) => s.id)).toEqual([
      'sec-hero',
      'sec-ache',
      'sec-invite',
    ]);
  });

  it('resetSection reverts one section, keeping other pending edits', () => {
    pageBuilder.setSectionProp('sec-hero', 'headline', 'edited hero');
    pageBuilder.setSectionProp('sec-ache', 'body', 'edited ache');

    pageBuilder.resetSection('sec-hero');

    expect(
      pageBuilder.sections.find((s) => s.id === 'sec-hero')?.props
    ).toEqual({});
    // The ache edit survives.
    expect(
      pageBuilder.sections.find((s) => s.id === 'sec-ache')?.props
    ).toEqual({
      body: 'edited ache',
    });
  });

  it('resetSection is a no-op for a section absent from saved (a newly added one)', () => {
    let n = 0;
    pageBuilder.setIdFactory(() => `new-${++n}`);
    const id = pageBuilder.addSection('faq');
    pageBuilder.setSectionProp(id, 'q', 'How long?');

    pageBuilder.resetSection(id);
    // Still present, still carries the edit — reset can't invent a saved value.
    expect(pageBuilder.sections.find((s) => s.id === id)?.props).toEqual({
      q: 'How long?',
    });
  });
});

describe('pageBuilder — save + preview applier', () => {
  beforeEach(() => {
    pageBuilder.close();
  });

  it('markSaved advances the baseline so isDirty resets', () => {
    pageBuilder.open(PAGE_ID, makeSaved());
    pageBuilder.setSectionProp('sec-hero', 'headline', 'edited');
    expect(pageBuilder.isDirty).toBe(true);

    pageBuilder.markSaved();
    expect(pageBuilder.isDirty).toBe(false);
    // getSavePayload returns a plain (non-proxy) deep snapshot.
    const payload = pageBuilder.getSavePayload();
    expect(payload?.sections.find((s) => s.id === 'sec-hero')?.props).toEqual({
      headline: 'edited',
    });
  });

  it('applyPreviewState sets pending + opens WITHOUT a pageId (inert crash-recovery)', () => {
    const incoming = makeSaved({ title: 'Live preview draft' });
    pageBuilder.applyPreviewState(incoming);

    expect(pageBuilder.isOpen).toBe(true);
    expect(pageBuilder.pending?.title).toBe('Live preview draft');
    // A preview frame must never own a persisted pageId (would pollute storage).
    expect(pageBuilder.pageId).toBeNull();
  });
});
