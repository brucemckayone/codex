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

  it('addSection appends a seeded enabled section with the injected id and focuses it', () => {
    const id = pageBuilder.addSection('faq');
    expect(id).toBe('new-1');
    const added = pageBuilder.sections.at(-1);
    expect(added).toMatchObject({
      id: 'new-1',
      type: 'faq',
      enabled: true,
      variant: 'accordion',
    });
    // Seeded from the catalogue so it renders populated the moment it is added.
    expect(added?.props.heading).toBeDefined();
    expect(pageBuilder.selectedSectionId).toBe('new-1');
  });

  it('addSection(type, afterId) inserts directly after the anchor section', () => {
    const id = pageBuilder.addSection('proof', 'sec-hero');
    expect(id).toBe('new-1');
    expect(pageBuilder.sections.map((s) => s.id)).toEqual([
      'sec-hero',
      'new-1',
      'sec-ache',
      'sec-invite',
    ]);
  });

  it('duplicateSection clones a section directly after it with a fresh id + copy name', () => {
    const id = pageBuilder.duplicateSection('sec-ache');
    expect(id).toBe('new-1');
    expect(pageBuilder.sections.map((s) => s.id)).toEqual([
      'sec-hero',
      'sec-ache',
      'new-1',
      'sec-invite',
    ]);
    expect(pageBuilder.sections.find((s) => s.id === 'new-1')?.name).toContain(
      'copy'
    );
    expect(pageBuilder.selectedSectionId).toBe('new-1');
  });

  it('setSectionVariant switches the composition and marks dirty', () => {
    pageBuilder.setSectionVariant('sec-hero', 'split');
    expect(pageBuilder.sections.find((s) => s.id === 'sec-hero')?.variant).toBe(
      'split'
    );
    expect(pageBuilder.isDirty).toBe(true);
  });

  it('moveSectionTo reorders to an absolute index and clamps to range', () => {
    pageBuilder.moveSectionTo('sec-invite', 0);
    expect(pageBuilder.sections.map((s) => s.id)).toEqual([
      'sec-invite',
      'sec-hero',
      'sec-ache',
    ]);
    // Out-of-range index clamps to the last slot.
    pageBuilder.moveSectionTo('sec-invite', 99);
    expect(pageBuilder.sections.at(-1)?.id).toBe('sec-invite');
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

describe('pageBuilder — design axes (F-B2)', () => {
  beforeEach(() => {
    pageBuilder.close();
    pageBuilder.open(PAGE_ID, makeSaved({ design: { width: 'wide' } }));
  });

  it('setPageDesign replaces the page look wholesale and marks dirty', () => {
    pageBuilder.setPageDesign({ width: 'narrow', density: 'vast' });
    // Wholesale, NOT merged: a preset is a complete look, so the previous
    // bundle's axes must not survive underneath the new one.
    expect(pageBuilder.pending?.design).toEqual({
      width: 'narrow',
      density: 'vast',
    });
    expect(pageBuilder.isDirty).toBe(true);
  });

  it('setPageDesign stores a COPY, so a later preset edit cannot mutate the draft', () => {
    const bundle = { width: 'full' as const };
    pageBuilder.setPageDesign(bundle);
    bundle.width = 'narrow' as never;
    expect(pageBuilder.pending?.design?.width).toBe('full');
  });

  it('setSectionDesignAxis overrides ONE axis, leaving the others inherited', () => {
    pageBuilder.setSectionDesignAxis('sec-hero', 'density', 'vast');
    const hero = pageBuilder.sections.find((s) => s.id === 'sec-hero');
    expect(hero?.design).toEqual({ density: 'vast' });
    // The page-level bundle is untouched — inheritance is per axis, so a section
    // opinion must never be promoted to the page.
    expect(pageBuilder.pending?.design).toEqual({ width: 'wide' });
    expect(pageBuilder.isDirty).toBe(true);
  });

  it('a second axis merges rather than replacing the first', () => {
    pageBuilder.setSectionDesignAxis('sec-hero', 'density', 'vast');
    pageBuilder.setSectionDesignAxis('sec-hero', 'accent', 'none');
    expect(
      pageBuilder.sections.find((s) => s.id === 'sec-hero')?.design
    ).toEqual({ density: 'vast', accent: 'none' });
  });

  it('clearing an axis DELETES the key, and the last one drops the whole bag', () => {
    pageBuilder.setSectionDesignAxis('sec-hero', 'density', 'vast');
    pageBuilder.setSectionDesignAxis('sec-hero', 'accent', 'none');

    pageBuilder.setSectionDesignAxis('sec-hero', 'accent', undefined);
    const partial = pageBuilder.sections.find((s) => s.id === 'sec-hero');
    // Deleted, not stored as `undefined`: "inherited" is represented by ABSENCE —
    // the shape `resolveDesign` resolves and the only one that survives a JSON
    // round trip through the save.
    expect(partial?.design).toEqual({ density: 'vast' });
    expect(Object.keys(partial?.design ?? {})).not.toContain('accent');

    pageBuilder.setSectionDesignAxis('sec-hero', 'density', undefined);
    const cleared = pageBuilder.sections.find((s) => s.id === 'sec-hero');
    expect(cleared?.design).toBeUndefined();
    expect(JSON.stringify(cleared)).not.toContain('design');
  });

  it('both design writes are undoable discrete steps', () => {
    pageBuilder.setPageDesign({ width: 'narrow' });
    pageBuilder.setSectionDesignAxis('sec-hero', 'motion', 'none');

    pageBuilder.undo();
    expect(
      pageBuilder.sections.find((s) => s.id === 'sec-hero')?.design
    ).toBeUndefined();
    expect(pageBuilder.pending?.design).toEqual({ width: 'narrow' });

    pageBuilder.undo();
    expect(pageBuilder.pending?.design).toEqual({ width: 'wide' });
  });

  it('is a no-op for an unknown section id', () => {
    pageBuilder.setSectionDesignAxis('sec-nope', 'width', 'full');
    expect(pageBuilder.isDirty).toBe(false);
  });

  it('the save payload carries the page look and the section overrides', () => {
    pageBuilder.setPageDesign({ width: 'narrow', motion: 'drift' });
    pageBuilder.setSectionDesignAxis('sec-ache', 'density', 'compact');

    const payload = pageBuilder.getSavePayload();
    expect(payload?.design).toEqual({ width: 'narrow', motion: 'drift' });
    expect(payload?.sections.find((s) => s.id === 'sec-ache')?.design).toEqual({
      density: 'compact',
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
    expect(pageBuilder.sections.find((s) => s.id === id)?.props).toMatchObject({
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

describe('pageBuilder — undo / redo', () => {
  beforeEach(() => {
    pageBuilder.close();
    let n = 0;
    pageBuilder.setIdFactory(() => `new-${++n}`);
    pageBuilder.open(PAGE_ID, makeSaved());
  });

  it('opens with an empty history', () => {
    expect(pageBuilder.canUndo).toBe(false);
    expect(pageBuilder.canRedo).toBe(false);
  });

  it('undo reverts a discrete action and redo re-applies it', () => {
    pageBuilder.addSection('faq');
    expect(pageBuilder.sections).toHaveLength(4);
    expect(pageBuilder.canUndo).toBe(true);

    pageBuilder.undo();
    expect(pageBuilder.sections.map((s) => s.id)).toEqual([
      'sec-hero',
      'sec-ache',
      'sec-invite',
    ]);
    expect(pageBuilder.canRedo).toBe(true);

    pageBuilder.redo();
    expect(pageBuilder.sections).toHaveLength(4);
    expect(pageBuilder.canRedo).toBe(false);
  });

  it('coalesces a burst of prop edits into a single undo step', () => {
    pageBuilder.setSectionProp('sec-hero', 'headline', 'a');
    pageBuilder.setSectionProp('sec-hero', 'headline', 'ab');
    pageBuilder.setSectionProp('sec-hero', 'headline', 'abc');

    pageBuilder.undo();
    expect(
      pageBuilder.sections.find((s) => s.id === 'sec-hero')?.props.headline
    ).toBeUndefined();
    expect(pageBuilder.canUndo).toBe(false);
  });

  it('a new action clears the redo stack', () => {
    pageBuilder.addSection('faq');
    pageBuilder.undo();
    expect(pageBuilder.canRedo).toBe(true);

    pageBuilder.addSection('proof');
    expect(pageBuilder.canRedo).toBe(false);
  });

  it('undo keeps the selection pointing at a section that still exists', () => {
    pageBuilder.removeSection('sec-invite');
    pageBuilder.undo();
    expect(pageBuilder.sections.map((s) => s.id)).toContain('sec-invite');
    expect(
      pageBuilder.sections.some((s) => s.id === pageBuilder.selectedSectionId)
    ).toBe(true);
  });

  it('discard and markSaved both clear the history', () => {
    pageBuilder.addSection('faq');
    expect(pageBuilder.canUndo).toBe(true);
    pageBuilder.discard();
    expect(pageBuilder.canUndo).toBe(false);

    pageBuilder.addSection('proof');
    pageBuilder.markSaved();
    expect(pageBuilder.canUndo).toBe(false);
  });
});

/**
 * PAGE-LEVEL edits — the title, the status select, the brand overrides, the SEO
 * bag and the one-off price — and their relationship with the history.
 *
 * THE BUG THESE LOCK OUT is a silent destruction, not a missing feature. `undo()`
 * replaces the WHOLE `pending` object with a snapshot, but only the section
 * mutators used to take one. So a snapshot captured by a section edit carried the
 * title, brand and price AS THEY WERE AT THAT MOMENT, and restoring it took back
 * every page-level edit made since — with nothing on screen to say so, and no way
 * to get them back (redo replays the same narrow step). The two failures were
 * therefore: (1) those edits were not undoable at all, and (2) they were destroyed
 * by an undo aimed at something else entirely.
 *
 * The rule the tests below pin: ONE undo takes back exactly ONE edit, whichever
 * kind it was, and leaves every earlier edit standing.
 */
describe('pageBuilder — page-level edits are part of the history', () => {
  beforeEach(() => {
    pageBuilder.close();
    pageBuilder.open(PAGE_ID, makeSaved());
  });

  it('an undo after a title edit takes back the TITLE, not the section edit before it', () => {
    pageBuilder.toggleSection('sec-ache');
    const toggled = pageBuilder.sections.find(
      (s) => s.id === 'sec-ache'
    )?.enabled;
    pageBuilder.updateMeta('title', 'Bone Deep');
    expect(pageBuilder.canUndo).toBe(true);

    pageBuilder.undo();

    expect(pageBuilder.pending?.title).toBe('Stillness');
    // The earlier, UNRELATED edit survives — the whole point.
    expect(pageBuilder.sections.find((s) => s.id === 'sec-ache')?.enabled).toBe(
      toggled
    );
    // And the section edit is still one further step back.
    expect(pageBuilder.canUndo).toBe(true);
  });

  it('an undo aimed at the last edit does not destroy the title or the price behind it', () => {
    // The exact sequence from the report: edit a section, then rename the page and
    // set a one-off price, then press Cmd+Z once to take back the last thing.
    pageBuilder.toggleSection('sec-ache');
    pageBuilder.updateMeta('title', 'Bone Deep');
    pageBuilder.updateOffer({ oneOffEnabled: true, oneOffPriceCents: 2700 });

    pageBuilder.undo();

    // One undo = one edit. The rename stands; only the price is taken back.
    expect(pageBuilder.pending?.title).toBe('Bone Deep');
    expect(pageBuilder.pending?.offer?.oneOffPriceCents).toBeUndefined();
  });

  it('an undo of a title edit leaves a price set BEFORE it untouched', () => {
    pageBuilder.updateOffer({ oneOffPriceCents: 2700 });
    pageBuilder.updateMeta('status', 'published');

    pageBuilder.undo();

    expect(pageBuilder.pending?.status).toBe('draft');
    // £27 was entered before the status change and must survive its undo.
    expect(pageBuilder.pending?.offer?.oneOffPriceCents).toBe(2700);
  });

  it('the SEO bag and the brand overrides are undoable too', () => {
    pageBuilder.updateSeo({ title: 'Bone Deep · a descent' });
    expect(pageBuilder.pending?.seo?.title).toBe('Bone Deep · a descent');
    pageBuilder.undo();
    expect(pageBuilder.pending?.seo?.title).toBeUndefined();

    pageBuilder.updateBrandOverrides({ primaryColor: '#a62b0c' });
    expect(pageBuilder.pending?.brandOverrides?.primaryColor).toBe('#a62b0c');
    pageBuilder.undo();
    expect(pageBuilder.pending?.brandOverrides).toBeNull();
  });

  it('a write that changes nothing takes no step and does not dirty the draft', () => {
    // `handlePublish` re-writes the same status when it rolls back a failed
    // publish, and a colour input echoes its own value while the picker is open.
    pageBuilder.updateMeta('title', 'Stillness');
    pageBuilder.updateOffer({});
    pageBuilder.updateBrandOverrides({ primaryColor: undefined });

    expect(pageBuilder.canUndo).toBe(false);
    expect(pageBuilder.isDirty).toBe(false);
  });
});

/**
 * CLEARING a brand override.
 *
 * Found while removing the shader control: the merge wrote
 * `{ primaryColor: undefined }` instead of deleting the key. That key survives
 * `structuredClone` (so the save payload carried it) but not `JSON.stringify` (so
 * the `isDirty` diff and the sessionStorage snapshot each saw a DIFFERENT draft
 * from the one the save would send). The observable damage was an override turned
 * on and off again leaving the draft permanently DIRTY against a `null` baseline —
 * Save lit with nothing to persist, and a navigation prompting over an empty
 * change, which is how a creator learns to click through the prompt that is
 * supposed to protect their work.
 *
 * The fix is the representation {@link setSectionDesignAxis} already uses:
 * absence, and `null` once the bag is empty.
 */
describe('pageBuilder — brand overrides round-trip', () => {
  beforeEach(() => {
    pageBuilder.close();
  });

  it('clearing the last override drops the bag to null, not to a phantom key', () => {
    pageBuilder.open(
      PAGE_ID,
      makeSaved({ brandOverrides: { primaryColor: '#123456' } })
    );

    pageBuilder.updateBrandOverrides({ primaryColor: undefined });

    expect(pageBuilder.pending?.brandOverrides).toBeNull();
    const payload = pageBuilder.getSavePayload();
    // The save body is `.strict()`; a key holding `undefined` is not a value the
    // endpoint should ever be asked to interpret.
    expect(JSON.stringify(payload)).not.toContain('primaryColor');
    expect(Object.keys(payload?.brandOverrides ?? {})).toEqual([]);
  });

  it('clearing one override of two keeps the others and deletes only that key', () => {
    pageBuilder.open(
      PAGE_ID,
      makeSaved({
        brandOverrides: { primaryColor: '#123456', secondaryColor: '#654321' },
      })
    );

    pageBuilder.updateBrandOverrides({ primaryColor: undefined });

    expect(pageBuilder.pending?.brandOverrides).toEqual({
      secondaryColor: '#654321',
    });
    expect(
      Object.keys(pageBuilder.pending?.brandOverrides ?? {})
    ).not.toContain('primaryColor');
  });

  it('override ON then OFF leaves the draft CLEAN against a null baseline', () => {
    pageBuilder.open(PAGE_ID, makeSaved({ brandOverrides: null }));

    pageBuilder.updateBrandOverrides({ primaryColor: '#a62b0c' });
    expect(pageBuilder.isDirty).toBe(true);

    pageBuilder.updateBrandOverrides({ primaryColor: undefined });

    // Net change: nothing. The unsaved-work prompt must not fire for this.
    expect(pageBuilder.isDirty).toBe(false);
    expect(pageBuilder.pending?.brandOverrides).toBeNull();
  });

  it('survives the save round trip: what markSaved adopts is what JSON would carry', () => {
    pageBuilder.open(
      PAGE_ID,
      makeSaved({ brandOverrides: { primaryColor: '#123456' } })
    );

    pageBuilder.updateBrandOverrides({ primaryColor: undefined });
    const payload = pageBuilder.getSavePayload();
    pageBuilder.markSaved();

    // The three views of the draft agree: the payload sent, the promoted
    // baseline, and the JSON the sessionStorage snapshot would restore.
    expect(payload?.brandOverrides).toBeNull();
    expect(pageBuilder.saved?.brandOverrides).toBeNull();
    expect(pageBuilder.isDirty).toBe(false);
    expect(JSON.parse(JSON.stringify(payload)).brandOverrides).toBeNull();
  });
});
