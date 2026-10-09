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
import { flushSync } from 'svelte';
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

  it('open() never fabricates a design key onto a section that stored none', () => {
    // The seven published pages must render byte-identically, and `open()` is
    // the path every one of them takes.
    pageBuilder.open(PAGE_ID, makeSaved());
    expect(pageBuilder.sections.map((s) => s.design)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(pageBuilder.isDirty).toBe(false);
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

  it('duplicateSection carries the source’s own design, not the type’s default', () => {
    // A duplicate is a copy of a section the creator may have already tuned;
    // the copy must carry that section's OWN scheme/spacing, not a fresh one
    // resolved from the type. (Formerly exercised via the legacy addSection +
    // setSectionDesignAxis pair — WP9c removed both; same property, v2 setup.)
    const id = pageBuilder.addKitSection('faq', {});
    pageBuilder.setSectionStyle(id, { spacing: 'spacious' });
    const copyId = pageBuilder.duplicateSection(id);
    const copy = pageBuilder.sections.find((s) => s.id === copyId);
    expect(copy?.design?.spacing).toBe('spacious');
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

  it('setSectionProp DELETES the key when the value is undefined', () => {
    // A cleared field must leave the key ABSENT, not present holding `undefined`.
    // `toEqual` cannot see the difference — it treats {a: undefined} as {} — so
    // this asserts on the KEY LIST, which is the only thing that distinguishes them.
    pageBuilder.setSectionProp('sec-hero', 'headline', 'Come home');
    pageBuilder.setSectionProp('sec-hero', 'kicker', 'A descent');
    pageBuilder.setSectionProp('sec-hero', 'kicker', undefined);
    const hero = pageBuilder.sections.find((s) => s.id === 'sec-hero');
    expect(Object.keys(hero?.props ?? {})).toEqual(['headline']);
    expect('kicker' in (hero?.props ?? {})).toBe(false);
  });

  it('a cleared key is absent from the SAVE PAYLOAD, not present holding undefined', () => {
    // This asserts the defect's actual consequence, through the store's own
    // public path. `getSavePayload()` clones via `structuredClone($state.snapshot(…))`,
    // and BOTH of those preserve a key whose value is `undefined` — while
    // `JSON.stringify` on the way to the wire drops it. That is the disagreement:
    // the payload the builder believes it is sending carries a key the column
    // never receives, so the isDirty diff and the crash-recovery snapshot see a
    // different draft from the one that is saved.
    //
    // (My first version of this test cloned `hero.props` directly and threw
    // DataCloneError — `props` is a `$state` PROXY and structuredClone cannot
    // clone a proxy at all. The store snapshots first for exactly that reason,
    // which is why the payload is the right place to assert.)
    pageBuilder.setSectionProp('sec-hero', 'headline', 'Come home');
    pageBuilder.setSectionProp('sec-hero', 'duration', '4:30');
    pageBuilder.setSectionProp('sec-hero', 'duration', undefined);
    const payload = pageBuilder.getSavePayload();
    const hero = payload?.sections.find((s) => s.id === 'sec-hero');
    expect(Object.keys(hero?.props ?? {})).toEqual(['headline']);
    expect('duration' in (hero?.props ?? {})).toBe(false);
    // and the wire form agrees with the payload, which is the whole point
    expect(Object.keys(JSON.parse(JSON.stringify(hero?.props ?? {})))).toEqual(
      Object.keys(hero?.props ?? {})
    );
  });

  it('setSectionProp still stores falsy values that are NOT undefined', () => {
    // Negative control. Deleting on `undefined` must not become deleting on
    // anything falsy: an empty string is a real authored value (it is how a
    // creator blanks a heading while keeping the field), 0 is a real duration,
    // and false is a real toggle state.
    pageBuilder.setSectionProp('sec-hero', 'headline', '');
    pageBuilder.setSectionProp('sec-hero', 'count', 0);
    pageBuilder.setSectionProp('sec-hero', 'best', false);
    pageBuilder.setSectionProp('sec-hero', 'nulled', null);
    const hero = pageBuilder.sections.find((s) => s.id === 'sec-hero');
    expect(Object.keys(hero?.props ?? {}).sort()).toEqual([
      'best',
      'count',
      'headline',
      'nulled',
    ]);
    expect(hero?.props).toEqual({
      headline: '',
      count: 0,
      best: false,
      nulled: null,
    });
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

/**
 * Page-kit v2 actions (docs/design/landing-builder/01-contract.md, WP-7a) —
 * the additive counterparts of setPageDesign/setSectionVariant/
 * setSectionDesignAxis/addSection the NEW editor drives. `open()` here is
 * fed pages already shaped as `upgradePage()` would leave them — a
 * `design.style` rather than the legacy nine axes, and a `variant` that is a
 * LAYOUT id — exactly what the new editor's route hands the store.
 */
describe('pageBuilder — page-kit v2 actions (WP-7a)', () => {
  beforeEach(() => {
    pageBuilder.close();
    let n = 0;
    pageBuilder.setIdFactory(() => `new-${++n}`);
    pageBuilder.open(
      PAGE_ID,
      makeSaved({
        design: { style: 'clean' },
        sections: [
          makeSection({ id: 'sec-hero', type: 'hero' }),
          makeSection({ id: 'sec-benefits', type: 'benefits' }),
        ],
      })
    );
  });

  describe('setPageStyle', () => {
    it('sets the page Style and marks dirty', () => {
      pageBuilder.setPageStyle('bold');
      expect(pageBuilder.pending?.design?.style).toBe('bold');
      expect(pageBuilder.isDirty).toBe(true);
    });

    it('merges onto an existing design bag rather than replacing it', () => {
      pageBuilder.close();
      pageBuilder.open(
        PAGE_ID,
        makeSaved({ design: { width: 'wide' }, sections: [] })
      );
      pageBuilder.setPageStyle('soft');
      expect(pageBuilder.pending?.design).toEqual({
        width: 'wide',
        style: 'soft',
      });
    });

    it('is a no-op when the Style is already set — no undo step, not dirty', () => {
      pageBuilder.setPageStyle('clean'); // already the current style
      expect(pageBuilder.canUndo).toBe(false);
      expect(pageBuilder.isDirty).toBe(false);
    });

    it('is undoable as one discrete step', () => {
      pageBuilder.setPageStyle('cinematic');
      pageBuilder.undo();
      expect(pageBuilder.pending?.design?.style).toBe('clean');
    });
  });

  describe('setSectionLayout', () => {
    it('sets a valid layout for the section’s type', () => {
      pageBuilder.setSectionLayout('sec-benefits', 'checklist');
      expect(
        pageBuilder.sections.find((s) => s.id === 'sec-benefits')?.variant
      ).toBe('checklist');
      expect(pageBuilder.isDirty).toBe(true);
    });

    it('ignores a layout that does not belong to the section’s type', () => {
      // 'theatre' is a `video` layout, not a `benefits` one.
      pageBuilder.setSectionLayout('sec-benefits', 'theatre');
      expect(
        pageBuilder.sections.find((s) => s.id === 'sec-benefits')?.variant
      ).toBeUndefined();
      expect(pageBuilder.isDirty).toBe(false);
    });

    it('is a no-op for an unknown section id', () => {
      pageBuilder.setSectionLayout('sec-nope', 'grid');
      expect(pageBuilder.isDirty).toBe(false);
    });

    it('is undoable as one discrete step', () => {
      pageBuilder.setSectionLayout('sec-benefits', 'split');
      pageBuilder.undo();
      expect(
        pageBuilder.sections.find((s) => s.id === 'sec-benefits')?.variant
      ).toBeUndefined();
    });
  });

  describe('setSectionStyle', () => {
    it('merges scheme and spacing independently', () => {
      pageBuilder.setSectionStyle('sec-benefits', { scheme: 'brand' });
      pageBuilder.setSectionStyle('sec-benefits', { spacing: 'spacious' });
      expect(
        pageBuilder.sections.find((s) => s.id === 'sec-benefits')?.design
      ).toEqual({ scheme: 'brand', spacing: 'spacious' });
    });

    it('a key patched to undefined is REMOVED, not stored as undefined', () => {
      pageBuilder.setSectionStyle('sec-benefits', {
        scheme: 'brand',
        spacing: 'spacious',
      });
      pageBuilder.setSectionStyle('sec-benefits', { scheme: undefined });
      const section = pageBuilder.sections.find((s) => s.id === 'sec-benefits');
      expect(section?.design).toEqual({ spacing: 'spacious' });
      expect(Object.keys(section?.design ?? {})).not.toContain('scheme');
    });

    it('clearing the last key drops the whole design bag', () => {
      pageBuilder.setSectionStyle('sec-benefits', { scheme: 'soft' });
      pageBuilder.setSectionStyle('sec-benefits', { scheme: undefined });
      const section = pageBuilder.sections.find((s) => s.id === 'sec-benefits');
      expect(section?.design).toBeUndefined();
      expect(JSON.stringify(section)).not.toContain('design');
    });

    it('ignores an invalid id for a key and leaves the existing value standing', () => {
      pageBuilder.setSectionStyle('sec-benefits', { scheme: 'brand' });
      // @ts-expect-error — proving a runtime-invalid value (e.g. a stale
      // <select>'s .value) is ignored rather than stored.
      pageBuilder.setSectionStyle('sec-benefits', { scheme: 'not-a-scheme' });
      expect(
        pageBuilder.sections.find((s) => s.id === 'sec-benefits')?.design
      ).toEqual({ scheme: 'brand' });
    });

    it('takes no undo step and does not dirty the draft when nothing valid changes', () => {
      // @ts-expect-error — same invalid-value proof as above, from a clean draft.
      pageBuilder.setSectionStyle('sec-benefits', { scheme: 'nonsense' });
      expect(pageBuilder.canUndo).toBe(false);
      expect(pageBuilder.isDirty).toBe(false);
    });

    it('is a no-op for an unknown section id', () => {
      pageBuilder.setSectionStyle('sec-nope', { scheme: 'brand' });
      expect(pageBuilder.isDirty).toBe(false);
    });

    it('is undoable as one discrete step per call', () => {
      pageBuilder.setSectionStyle('sec-benefits', { scheme: 'brand' });
      pageBuilder.setSectionStyle('sec-benefits', { spacing: 'compact' });
      pageBuilder.undo();
      expect(
        pageBuilder.sections.find((s) => s.id === 'sec-benefits')?.design
      ).toEqual({ scheme: 'brand' });
      pageBuilder.undo();
      expect(
        pageBuilder.sections.find((s) => s.id === 'sec-benefits')?.design
      ).toBeUndefined();
    });
  });

  describe('addKitSection', () => {
    it('inserts exactly {id, type, enabled, props} — no variant, no design', () => {
      const id = pageBuilder.addKitSection('cta', { heading: 'Join now' });
      expect(id).toBe('new-1');
      const added = pageBuilder.sections.find((s) => s.id === id);
      expect(added).toEqual({
        id: 'new-1',
        type: 'cta',
        enabled: true,
        props: { heading: 'Join now' },
      });
      expect(pageBuilder.selectedSectionId).toBe('new-1');
    });

    it('never goes through the legacy rhythm path — no design key materialises', () => {
      // Falsifiable against the now-removed `addSection`'s own behaviour: on an
      // equivalent page shape it used to stamp several axes onto a new `hero`
      // section (WP9c deleted that path and its proving test). addKitSection
      // must not.
      const id = pageBuilder.addKitSection('hero', {});
      expect(
        pageBuilder.sections.find((s) => s.id === id)?.design
      ).toBeUndefined();
    });

    it('inserts after afterId, else appends', () => {
      pageBuilder.addKitSection('cta', {}, 'sec-hero');
      expect(pageBuilder.sections.map((s) => s.id)).toEqual([
        'sec-hero',
        'new-1',
        'sec-benefits',
      ]);
      pageBuilder.addKitSection('faq', {});
      expect(pageBuilder.sections.at(-1)?.id).toBe('new-2');
    });

    it('shallow-copies props so a shared literal cannot be mutated through the store', () => {
      const sample = { heading: 'Original' };
      const id = pageBuilder.addKitSection('cta', sample);
      sample.heading = 'Mutated after the fact';
      expect(pageBuilder.sections.find((s) => s.id === id)?.props.heading).toBe(
        'Original'
      );
    });

    it('is undoable as one discrete step', () => {
      pageBuilder.addKitSection('cta', {});
      expect(pageBuilder.sections).toHaveLength(3);
      pageBuilder.undo();
      expect(pageBuilder.sections).toHaveLength(2);
    });

    it('setSectionProp keystroke bursts still coalesce for a v2 section', () => {
      const id = pageBuilder.addKitSection('benefits', {});
      pageBuilder.setSectionProp(id, 'heading', 'W');
      pageBuilder.setSectionProp(id, 'heading', 'Wh');
      pageBuilder.setSectionProp(id, 'heading', 'What you get');
      pageBuilder.undo(); // undoes the whole typing burst, one step
      expect(
        pageBuilder.sections.find((s) => s.id === id)?.props.heading
      ).toBeUndefined();
      pageBuilder.undo(); // undoes the add itself
      expect(pageBuilder.sections.find((s) => s.id === id)).toBeUndefined();
    });

    it('setSectionProps round-trips a v2 array-of-objects prop', () => {
      const items = [
        { title: 'Weekly calls', detail: 'Live, recorded' },
        { title: 'Workbook', detail: undefined },
      ];
      const id = pageBuilder.addKitSection('benefits', {});
      pageBuilder.setSectionProps(id, { items });
      expect(
        pageBuilder.sections.find((s) => s.id === id)?.props.items
      ).toEqual(items);
    });
  });
});

/**
 * v2 (page-kit) pages pass through open()/getSavePayload()/resetSection()/
 * discard() untouched. These four are the ones WP-7a's brief called out for
 * audit: NONE of them calls `createSection`/`resolveDesign`/
 * `sectionDesignForType` (confirmed by reading — those three names appear
 * nowhere near open/resetSection/discard/getSavePayload in this file), so
 * each is a pure structural clone regardless of vocabulary. These tests prove
 * that conclusion rather than just asserting it: a v2 page's `design.style`
 * and a v2 section's `scheme`/`spacing` survive every one of these paths
 * byte-for-byte, with no legacy axis key ever materialising alongside them.
 * (The sessionStorage crash-recovery effect is the same kind of pure
 * `JSON.stringify`/`JSON.parse` round trip and is not separately exercised
 * here, matching the rest of this file's own choice not to drive it directly.)
 */
describe('pageBuilder — v2 (page-kit) pages pass through untouched', () => {
  function makeV2Saved(): PageBuilderState {
    return makeSaved({
      design: { style: 'clean' },
      sections: [
        {
          id: 'sec-hero',
          type: 'hero',
          enabled: true,
          variant: 'split',
          design: { scheme: 'brand', spacing: 'spacious' },
          props: { heading: 'Come home' },
        },
      ],
    });
  }

  beforeEach(() => {
    pageBuilder.close();
  });

  it('open() seeds pending byte-identical to a v2 saved page', () => {
    const saved = makeV2Saved();
    pageBuilder.open(PAGE_ID, saved);
    expect(pageBuilder.pending).toEqual(saved);
    expect(pageBuilder.isDirty).toBe(false);
  });

  it('getSavePayload returns the v2 shape verbatim', () => {
    const saved = makeV2Saved();
    pageBuilder.open(PAGE_ID, saved);
    expect(pageBuilder.getSavePayload()).toEqual(saved);
  });

  it('resetSection restores a v2 section’s exact saved bag, no legacy axis keys', () => {
    const saved = makeV2Saved();
    pageBuilder.open(PAGE_ID, saved);
    pageBuilder.setSectionStyle('sec-hero', { scheme: 'accent' });
    pageBuilder.resetSection('sec-hero');
    const hero = pageBuilder.sections.find((s) => s.id === 'sec-hero');
    expect(hero?.design).toEqual({ scheme: 'brand', spacing: 'spacious' });
    expect(Object.keys(hero?.design ?? {}).sort()).toEqual([
      'scheme',
      'spacing',
    ]);
  });

  it('discard restores the whole v2 page, no legacy axis keys introduced', () => {
    const saved = makeV2Saved();
    pageBuilder.open(PAGE_ID, saved);
    pageBuilder.setPageStyle('bold');
    pageBuilder.setSectionLayout('sec-hero', 'cover');
    pageBuilder.discard();
    expect(pageBuilder.pending).toEqual(saved);
  });
});

describe('pageBuilder — revert paths', () => {
  beforeEach(() => {
    pageBuilder.close();
    pageBuilder.open(PAGE_ID, makeSaved());
  });

  it('discard restores pending to the saved baseline', () => {
    pageBuilder.setSectionProp('sec-hero', 'headline', 'edited');
    pageBuilder.addKitSection('cta', {});
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
    const id = pageBuilder.addKitSection('faq', {});
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

  it('markSaved({ baseline }) moves the baseline to what landed, and a newer edit stays unsaved', () => {
    pageBuilder.open(PAGE_ID, makeSaved());
    pageBuilder.updateMeta('title', 'Sent');
    const sent = pageBuilder.getSavePayload() as PageBuilderState;
    pageBuilder.updateMeta('title', 'Typed while it was saving');

    pageBuilder.markSaved({ baseline: sent });

    expect(pageBuilder.saved?.title).toBe('Sent');
    expect(pageBuilder.pending?.title).toBe('Typed while it was saving');
    expect(pageBuilder.isDirty).toBe(true);
  });
});

/**
 * CRASH RECOVERY. The tab's sessionStorage row keeps its UNSAVED draft across a
 * reload, and is restored only over the page it was edited FROM. Once another
 * tab has saved the page, the draft is stale: restoring it would autosave the
 * older page over the newer one, with nothing on screen to say so.
 */
describe('pageBuilder — crash recovery', () => {
  const KEY = 'codex:page-builder';

  /** Open, edit, then "crash": the tab keeps the row a reload would find. */
  function editThenCrash(edit: () => void): string | null {
    pageBuilder.open(PAGE_ID, makeSaved());
    edit();
    flushSync();
    const row = sessionStorage.getItem(KEY);
    pageBuilder.close();
    if (row) sessionStorage.setItem(KEY, row);
    return row;
  }

  beforeEach(() => {
    pageBuilder.close();
    sessionStorage.clear();
  });

  it('restores an unsaved draft over the page it was edited from', () => {
    editThenCrash(() => pageBuilder.updateMeta('title', 'Bone Deep'));

    expect(pageBuilder.open(PAGE_ID, makeSaved())).toBe('restored');
    expect(pageBuilder.pending?.title).toBe('Bone Deep');
    expect(pageBuilder.isDirty).toBe(true);
  });

  it('discards a draft edited from a page the server no longer holds', () => {
    editThenCrash(() => pageBuilder.updateMeta('title', 'Bone Deep'));

    // Another tab saved the page in the meantime.
    const newer = makeSaved({ title: 'Stillness, revised' });
    expect(pageBuilder.open(PAGE_ID, newer)).toBe('discarded');
    expect(pageBuilder.pending?.title).toBe('Stillness, revised');
    expect(pageBuilder.isDirty).toBe(false);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('never takes the status from the row', () => {
    editThenCrash(() => {
      pageBuilder.updateMeta('status', 'published', { record: false });
      pageBuilder.updateMeta('title', 'Bone Deep');
    });

    expect(pageBuilder.open(PAGE_ID, makeSaved())).toBe('restored');
    expect(pageBuilder.pending?.title).toBe('Bone Deep');
    expect(pageBuilder.pending?.status).toBe('draft');
  });

  it('discards a row with no baseline to check it against', () => {
    // The shape the previous editor wrote: a draft with nothing to say what
    // it was edited from.
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        pageId: PAGE_ID,
        pending: makeSaved({ title: 'From an older editor' }),
      })
    );

    expect(pageBuilder.open(PAGE_ID, makeSaved())).toBe('discarded');
    expect(pageBuilder.pending?.title).toBe('Stillness');
  });

  it('keeps a row only while something is unsaved', () => {
    pageBuilder.open(PAGE_ID, makeSaved());
    pageBuilder.selectSection('sec-ache');
    flushSync();
    expect(sessionStorage.getItem(KEY)).toBeNull();

    pageBuilder.updateMeta('title', 'Bone Deep');
    flushSync();
    expect(sessionStorage.getItem(KEY)).not.toBeNull();

    pageBuilder.markSaved();
    flushSync();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('a page this tab saved still matches the copy the server hands back', () => {
    // The server trims the title, and a page whose offer was never sent has
    // no bag at all — neither is the byte-for-byte page this tab saved.
    const row = editThenCrash(() => {
      pageBuilder.updateMeta('title', 'Bone Deep ');
      pageBuilder.updateOffer(
        {
          tiersEnabled: false,
          subscriptionEnabled: false,
          subscriptionPriceCents: null,
          oneOffEnabled: false,
          oneOffPriceCents: null,
        },
        { record: false }
      );
      pageBuilder.markSaved();
      pageBuilder.setSectionProp('sec-hero', 'heading', 'Typed after the save');
    });
    expect(row).not.toBeNull();

    const reloaded = makeSaved({ title: 'Bone Deep' });
    expect(pageBuilder.open(PAGE_ID, reloaded)).toBe('restored');
    expect(pageBuilder.sections[0].props.heading).toBe('Typed after the save');
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
    pageBuilder.addKitSection('faq', {});
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
    pageBuilder.addKitSection('faq', {});
    pageBuilder.undo();
    expect(pageBuilder.canRedo).toBe(true);

    pageBuilder.addKitSection('cta', {});
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
    pageBuilder.addKitSection('faq', {});
    expect(pageBuilder.canUndo).toBe(true);
    pageBuilder.discard();
    expect(pageBuilder.canUndo).toBe(false);

    pageBuilder.addKitSection('cta', {});
    pageBuilder.markSaved();
    expect(pageBuilder.canUndo).toBe(false);
  });

  it('an autosave checkpoint (keepHistory) keeps undo reaching past it', () => {
    pageBuilder.addKitSection('faq', {});
    pageBuilder.addKitSection('cta', {});
    const count = pageBuilder.sections.length;
    pageBuilder.markSaved({ keepHistory: true });
    expect(pageBuilder.isDirty).toBe(false);
    expect(pageBuilder.canUndo).toBe(true);
    pageBuilder.undo();
    pageBuilder.undo();
    expect(pageBuilder.sections.length).toBe(count - 2);
    // Undoing past the checkpoint is a real change again.
    expect(pageBuilder.isDirty).toBe(true);
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

  it('adopting the server-normalised offer (record: false) adds no undo step', () => {
    pageBuilder.updateMeta('title', 'Renamed');
    pageBuilder.updateOffer({ oneOffEnabled: null }, { record: false });
    expect(pageBuilder.pending?.offer?.oneOffEnabled).toBeNull();
    pageBuilder.undo();
    // The one undo reaches the creator's real edit, not the invisible sync.
    expect(pageBuilder.pending?.title).not.toBe('Renamed');
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
    pageBuilder.updateMeta('title', 'Bone Deep');

    pageBuilder.undo();

    expect(pageBuilder.pending?.title).toBe('Stillness');
    // £27 was entered before the rename and must survive its undo.
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
    // A title input re-fires its own value, and a colour input echoes its own
    // value while the picker is open.
    pageBuilder.updateMeta('title', 'Stillness');
    pageBuilder.updateOffer({});
    pageBuilder.updateBrandOverrides({ primaryColor: undefined });

    expect(pageBuilder.canUndo).toBe(false);
    expect(pageBuilder.isDirty).toBe(false);
  });
});

/**
 * The STATUS is outside the history. It is the server's publish state, and a
 * snapshot's status is whatever it was when some OTHER edit was made — so an
 * undo that restored it would unpublish a live page through Cmd+Z, or show
 * "Live" over a draft.
 */
describe('pageBuilder — the status is outside the history', () => {
  beforeEach(() => {
    pageBuilder.close();
    pageBuilder.open(PAGE_ID, makeSaved());
  });

  it('a status write with record: false takes no undo step', () => {
    pageBuilder.updateMeta('status', 'published', { record: false });

    expect(pageBuilder.pending?.status).toBe('published');
    expect(pageBuilder.canUndo).toBe(false);
  });

  it('undo and redo walk the edits and keep the current status', () => {
    pageBuilder.updateMeta('title', 'Bone Deep');
    pageBuilder.updateMeta('status', 'published', { record: false });

    pageBuilder.undo();
    // The rename is taken back; the page stays live.
    expect(pageBuilder.pending?.title).toBe('Stillness');
    expect(pageBuilder.pending?.status).toBe('published');

    pageBuilder.updateMeta('status', 'draft', { record: false });
    pageBuilder.redo();
    // Redo re-applies the rename and never re-publishes.
    expect(pageBuilder.pending?.title).toBe('Bone Deep');
    expect(pageBuilder.pending?.status).toBe('draft');
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
 * The fix is the same absence-means-cleared representation
 * {@link setSectionStyle} uses for a section's own design bag: absence, and
 * `null` once the bag is empty.
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
