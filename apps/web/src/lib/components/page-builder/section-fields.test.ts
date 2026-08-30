/**
 * Section-fields model tests (Codex-2pryk.3.3 · WP-5).
 *
 * Guards the editor↔renderer contract: every catalogue section type has a field
 * set, each field names a `PageSection.props` key + a valid control, and an
 * unknown type degrades to the generic body field rather than throwing.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SECTION_CATALOG } from '$lib/page-builder';
import { deriveOfferPaths, tierPathId } from '$lib/page-builder/offer-paths';
import { SECTION_PROP_ALIASES } from '$lib/page-builder/render/coerce';
import type { SectionFieldDef } from './section-fields';
import { fieldsForSectionType, SECTION_FIELDS } from './section-fields';

const CONTROLS = [
  'text',
  'textarea',
  'select',
  'media',
  'number',
  'toggle',
  'list',
  'repeater',
];

/** Every field of a set, repeater item fields included. */
function everyField(
  fields: readonly SectionFieldDef[]
): readonly SectionFieldDef[] {
  return fields.flatMap((field) => [field, ...(field.itemFields ?? [])]);
}

describe('section-fields', () => {
  it('declares a field set for every catalogue section type', () => {
    for (const def of SECTION_CATALOG) {
      const fields = SECTION_FIELDS[def.type];
      expect(fields, `missing fields for ${def.type}`).toBeDefined();
      expect(fields.length).toBeGreaterThan(0);
    }
  });

  it('every field names a prop key and a supported control', () => {
    for (const fields of Object.values(SECTION_FIELDS)) {
      for (const field of everyField(fields)) {
        expect(field.key).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/);
        expect(CONTROLS).toContain(field.control);
        // A select must carry choices; nothing else should.
        if (field.control === 'select') {
          expect(field.options?.length ?? 0).toBeGreaterThan(0);
        } else {
          expect(field.options).toBeUndefined();
        }
      }
    }
  });

  it('only a repeater carries item fields, and nesting stops at one level', () => {
    for (const [type, fields] of Object.entries(SECTION_FIELDS)) {
      for (const field of fields) {
        if (field.control === 'repeater') {
          expect(
            field.itemFields?.length ?? 0,
            `${type}.${field.key} repeater with no item fields`
          ).toBeGreaterThan(0);
          for (const item of field.itemFields ?? []) {
            expect(
              item.control,
              `${type}.${field.key}.${item.key} nests a repeater`
            ).not.toBe('repeater');
            expect(item.itemFields).toBeUndefined();
          }
        } else {
          expect(
            field.itemFields,
            `${type}.${field.key} is not a repeater but declares item fields`
          ).toBeUndefined();
        }
      }
    }
  });

  it('a media field names a sell-media slot, and nothing else does', () => {
    // The slot is what makes the control real: the live sections read the course
    // column, never `props`, so a `media` control with no slot is a decorative
    // input that cannot change what renders.
    for (const [type, fields] of Object.entries(SECTION_FIELDS)) {
      for (const field of everyField(fields)) {
        if (field.control === 'media') {
          expect(
            field.mediaSlot,
            `${type}.${field.key} media field with no slot`
          ).toBeDefined();
        } else {
          expect(field.mediaSlot).toBeUndefined();
        }
      }
    }
  });

  it('falls back to a generic body field for an unknown type', () => {
    const fields = fieldsForSectionType('retreat-only-widget');
    expect(fields).toHaveLength(1);
    expect(fields[0].key).toBe('body');
  });
});

// ── The editor↔renderer ROUND TRIP (Codex-tqr51) ────────────────────────────
//
// The failure mode this exists for is invisible: a creator types a headline, the
// renderer reads a key nobody writes, and the page falls back to a hardcoded
// English sentence. Nothing throws, nothing logs, and the only symptom is a page
// that does not say what its author said. `HeroSection` shipped that way — the
// golden page stores `button: "Get started"` and served "Begin the journey".
//
// So both directions are asserted, and both are derived rather than listed:
//
//   → every key the editor WRITES is read by that type's renderer, proven against
//     the component source on disk (a hand-copied list of "keys the renderer
//     reads" is the same drift, one level up);
//   ← every alias the renderer PREFERS reaches a key the editor writes, proven
//     against `SECTION_PROP_ALIASES`, the machine-readable bridge table itself.
//   ← every key a renderer READS is authorable — see `UNAUTHORABLE_BY_DESIGN`.

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDER = resolve(HERE, '../../page-builder/render');

/**
 * The source that READS a type's props. `invite` needs two files: the offer
 * decorations are consumed in `offer-paths.ts`, not in the component.
 */
const READERS: Readonly<Record<string, readonly string[]>> = {
  hero: ['sections/HeroSection.svelte'],
  introVideo: ['sections/IntroVideoSection.svelte'],
  ache: ['sections/AcheSection.svelte'],
  turn: ['sections/TurnSection.svelte'],
  reel: ['sections/ReelSection.svelte'],
  map: ['sections/MapSection.svelte'],
  feel: ['sections/FeelSection.svelte'],
  proof: ['sections/ProofSection.svelte'],
  guide: ['sections/GuideSection.svelte'],
  faq: ['sections/FaqSection.svelte'],
  invite: ['sections/InviteSection.svelte', '../offer-paths.ts'],
};

/**
 * Keys DECLARED AHEAD OF THEIR READER — the field exists so the creator can
 * author the content, and the markup that renders it lands with the owning
 * component work package.
 *
 * This set is a WORK LIST, not an exemption: the test below also asserts each
 * entry is still genuinely unread, so the worktree that wires the read has to
 * delete its line here. It should be empty by consolidation.
 *
 * The `05-bridge-table.md` rows ("not aliasable — these need new markup") plus
 * the fields F-C declared for the new compositions.
 */
const OWED_READS: Readonly<Record<string, readonly string[]>> = {
  // EMPTY, as A28 said it should be by consolidation. Round 4 wired the last
  // three entries and they were deleted here in the same change:
  //   introVideo: ['clip', 'duration']  -> IntroVideoSection.svelte:152-153
  //   reel: ['duration']                -> ReelSection.svelte:133
  //   guide: ['clip', 'duration', 'facts'] -> GuideSection.svelte:159-161
  // Leaving the map in place rather than deleting it: the checklist mechanism is
  // what future work packages will re-use, and an empty map makes the test above
  // enforce the STRONGER invariant — that every authorable field on every type is
  // read, with no exemptions outstanding.
};

function readerSource(type: string): string {
  const files = READERS[type];
  expect(files, `no reader declared for ${type}`).toBeDefined();
  return files
    .map((file) => readFileSync(resolve(RENDER, file), 'utf8'))
    .join('\n');
}

/**
 * Is `key` read for `type`? Three conventions count, because all three are how
 * the renderers actually read:
 *
 *  - a direct quoted literal in the reader — `asString(config, 'heading')`;
 *  - the NUMBERED-GROUP convention — `q1`/`a1`/`n1` are read by
 *    `asNumberedGroups(config, { question: 'q', answer: 'a' }, …)`, which names
 *    only the prefix, so a key of shape `<prefix><digits>` counts when its
 *    prefix is quoted;
 *  - membership in that type's `SECTION_PROP_ALIASES` preference list — the
 *    alias table IS part of the read boundary, consumed through `aliasKeys`.
 *    Which call sites still have to be switched over to it is tracked in
 *    `05-bridge-table.md`, per owning worktree; what THIS asserts is that the
 *    key is on the declared read path at all.
 */
function isRead(type: string, source: string, key: string): boolean {
  if (source.includes(`'${key}'`)) return true;
  const aliased = Object.values(SECTION_PROP_ALIASES[type] ?? {}).some((keys) =>
    keys.includes(key)
  );
  if (aliased) return true;
  const numbered = /^([a-z]+)\d+$/.exec(key);
  return numbered ? source.includes(`'${numbered[1]}'`) : false;
}

describe('editor ↔ renderer round trip', () => {
  it('declares a reader for every catalogue type', () => {
    for (const def of SECTION_CATALOG) {
      expect(READERS[def.type], `no reader for ${def.type}`).toBeDefined();
    }
  });

  it('every key the editor writes is READ by that type’s renderer', () => {
    for (const def of SECTION_CATALOG) {
      const source = readerSource(def.type);
      const owed = new Set(OWED_READS[def.type] ?? []);
      for (const field of SECTION_FIELDS[def.type]) {
        // A media field writes a course COLUMN, not props — its key is only the
        // `{#each}` key, so there is nothing for the renderer to read.
        if (field.mediaSlot) continue;
        // An owed repeater carries its item fields with it: nothing can read
        // `facts[].label` before something reads `facts`.
        if (owed.has(field.key)) continue;
        for (const key of [field, ...(field.itemFields ?? [])].map(
          (f) => f.key
        )) {
          expect(
            isRead(def.type, source, key),
            `${def.type}.${key} is authorable but NOTHING reads it — either wire the read or add it to OWED_READS with its worktree`
          ).toBe(true);
        }
      }
    }
  });

  it('every OWED_READS entry is a real field that is still genuinely unread', () => {
    for (const [type, keys] of Object.entries(OWED_READS)) {
      const source = readerSource(type);
      const declared = new Set(
        everyField(SECTION_FIELDS[type]).map((f) => f.key)
      );
      for (const key of keys) {
        expect(
          declared.has(key),
          `OWED_READS lists ${type}.${key}, which is not a declared field`
        ).toBe(true);
        expect(
          isRead(type, source, key),
          `${type}.${key} IS now read — delete it from OWED_READS`
        ).toBe(false);
      }
    }
  });

  it('every alias the renderer prefers reaches a key the editor writes', () => {
    for (const [type, aliases] of Object.entries(SECTION_PROP_ALIASES)) {
      expect(
        SECTION_FIELDS[type],
        `alias table names unknown type ${type}`
      ).toBeDefined();
      const declared = new Set(
        everyField(SECTION_FIELDS[type]).map((f) => f.key)
      );
      for (const [prop, keys] of Object.entries(aliases)) {
        expect(
          keys.some((key) => declared.has(key)),
          `${type}.${prop} prefers [${keys.join(', ')}] and the editor writes none of them — the bridge degrades to a hardcoded fallback, silently`
        ).toBe(true);
      }
    }
  });

  // ── THE REVERSE DIRECTION (WP-D) ──────────────────────────────────────────
  //
  // The forward assertion above has been green for four rounds, and five keys a
  // renderer READS with nothing able to author them accumulated anyway, because
  // nothing looked the other way: `guide.name` (rendered in five places, so the
  // Letter layout's sign-off was permanently absent), `faq.eyebrow` (the only one
  // of the eleven sections whose eyebrow was unauthorable — FaqSection's own CSS
  // comment said so), `hero.secondaryHref` (which GATES the secondary CTA, so the
  // `quiet` label beside it could never render), and `reel.captions` / `caption`
  // (the whisper that cross-fades over the frame, `[]` on every page ever served).
  //
  // Each of those was an element a creator could see in the design and never
  // fill, and each landed through CI green. So the guard is the durable fix and
  // the four fields are only today's instances.

  /**
   * Read forms a renderer actually uses, extracted from the reader SOURCE for the
   * same reason the forward test does it: a hand-copied list of "keys the
   * renderer reads" drifts the moment a component changes.
   *
   * Three shapes, all of them present in the tree today:
   *   - `asString(config, 'heading')` and its siblings, with an optional generic
   *     (`asObjectArray<FaqRow>(config, 'items', …)` — the generic is why a regex
   *     written without `(?:<…>)?` silently missed `faq.items`);
   *   - `config['previewDuration']`, the bracket form `FeelSection` uses;
   *   - the ALIAS-driven readers (`asStringFrom(config, aliasKeys('hero', 'sub…'))`)
   *     which name a PROP, not a key — those resolve through
   *     `SECTION_PROP_ALIASES` and are subtracted below rather than matched here.
   */
  const READ_KEY_RE =
    /(?:as(?:String|StringArray|ObjectArray|Bool|Number)(?:<[^>()]*>)?\(\s*config\s*,\s*|config\[\s*)['"]([a-zA-Z0-9]+)['"]/g;

  function keysRead(source: string): readonly string[] {
    return [...new Set([...source.matchAll(READ_KEY_RE)].map((m) => m[1]))];
  }

  /**
   * Reads that are unauthorable ON PURPOSE, each with the reason, because "no
   * field for this" is sometimes the correct design. Two kinds only:
   *
   *  - a LEGACY prop kept on the read path so a page that still holds one keeps
   *    rendering, with the authorable key preferred ahead of it;
   *  - a prop whose real value is PROJECTED from a course column by a `media`
   *    picker, so a props-level field could not affect what renders.
   *
   * It is a closed list with a companion assertion below: an exemption that stops
   * being read, or that acquires a field, fails — the same discipline
   * `OWED_READS` uses, so this cannot rot into a blanket allow-list.
   */
  const UNAUTHORABLE_BY_DESIGN: Readonly<
    Record<string, Readonly<Record<string, string>>>
  > = {
    ache: {
      beats:
        'legacy array shape, superseded by the authorable `points` — AcheSection reads `p.points ?? p.beats`',
    },
    introVideo: {
      posterUrl:
        'legacy prop; a real poster arrives with the clip the media slot picks (render/types.ts `posterUrl`)',
    },
    reel: {
      posterUrl: 'ditto introVideo.posterUrl',
      caption:
        'the singular fallback BEHIND the authorable `captions[]`, which wins the `??`',
    },
    guide: {
      credentials:
        'legacy array shape, superseded by the authorable `facts` repeater',
      portraitUrl:
        'legacy prop read FIRST so a page holding one keeps working; the real portrait is projected from `courses.guidePortraitMediaId` by the `portraitMedia` picker (contract A15)',
    },
    faq: {
      items:
        'deliberately unauthorable (A30 / Codex-wtfs1): an `items[]` repeater would shadow the `q1/a1` vocabulary a stored page holds, and the array wins the read',
    },
  };

  it('every key a renderer READS is authorable, or exempt with a reason', () => {
    // Collected across every type and asserted ONCE, deliberately: a per-key
    // expectation short-circuits on the first gap, and this guard's job is to
    // hand whoever added a read the WHOLE work list. Landed before the four
    // fields below it, this named exactly:
    //   hero.secondaryHref · reel.captions · guide.name · faq.eyebrow
    const unauthorable: string[] = [];
    for (const def of SECTION_CATALOG) {
      const source = readerSource(def.type);
      const declared = new Set(
        everyField(SECTION_FIELDS[def.type]).map((f) => f.key)
      );
      const aliased = new Set(
        Object.values(SECTION_PROP_ALIASES[def.type] ?? {}).flat()
      );
      const exempt = UNAUTHORABLE_BY_DESIGN[def.type] ?? {};
      for (const key of keysRead(source)) {
        if (declared.has(key) || aliased.has(key) || key in exempt) continue;
        unauthorable.push(`${def.type}.${key}`);
      }
    }
    expect(
      unauthorable,
      'these keys are READ by a renderer and NOTHING can author them — declare a field in SECTION_FIELDS, bridge it in SECTION_PROP_ALIASES, or add it to UNAUTHORABLE_BY_DESIGN with the reason'
    ).toEqual([]);
  });

  it('every UNAUTHORABLE_BY_DESIGN entry is still genuinely read and still undeclared', () => {
    for (const [type, entries] of Object.entries(UNAUTHORABLE_BY_DESIGN)) {
      const read = new Set(keysRead(readerSource(type)));
      const declared = new Set(
        everyField(SECTION_FIELDS[type]).map((f) => f.key)
      );
      for (const [key, reason] of Object.entries(entries)) {
        expect(
          reason.length,
          `${type}.${key} exemption has no reason`
        ).toBeGreaterThan(20);
        expect(
          read.has(key),
          `${type}.${key} is exempted but the renderer no longer reads it — delete the exemption`
        ).toBe(true);
        expect(
          declared.has(key),
          `${type}.${key} IS now a declared field — delete the exemption`
        ).toBe(false);
      }
    }
  });

  it('keeps BOTH halves of the hero secondary CTA — a label with no destination is a dead control', () => {
    // `HeroSection` gates the second button on `p.secondaryLabel && p.secondaryHref`.
    // `quiet` (aliased to `secondaryLabel`) shipped alone, so a creator could fill
    // it, save, publish, and never see a second button on any of the six hero
    // compositions. Neither half may ship without the other again.
    const keys = SECTION_FIELDS.hero.map((f) => f.key);
    expect(keys).toContain('quiet');
    expect(keys).toContain('secondaryHref');
    // …and each hint must say the other is needed, because the failure is
    // invisible: nothing errors, the button simply never appears.
    const hint = (key: string) =>
      SECTION_FIELDS.hero.find((f) => f.key === key)?.hint ?? '';
    expect(hint('quiet').toLowerCase()).toContain('destination');
    expect(hint('secondaryHref').toLowerCase()).toContain('not shown');
  });

  it('keeps `duration` a TEXT runtime on all three sections that carry it', () => {
    // Codex-eawdg. `duration` is advisory copy that lands in a fixed-width `M:SS`
    // badge, and a bare "Duration" label invited prose ("Roughly forty minutes,
    // unhurried") which then wrapped inside the badge.
    //
    // It must NOT become `control: 'number'`, and that is the assertion with teeth:
    // the catalogue seeds `'1:00'` / `'0:30'` / `'2:00'` as STRINGS, all three
    // renderers read it with `asString`, and every published page stores a string —
    // so a type change here is a data migration wearing a field change's clothes,
    // and it could not express `1:02:30` either. (`feel.previewDuration` is a real
    // number and is correctly declared `number`; they are not the same field.)
    const carriers = ['introVideo', 'reel', 'guide'] as const;
    for (const type of carriers) {
      const field = everyField(SECTION_FIELDS[type]).find(
        (f) => f.key === 'duration'
      );
      expect(field, `${type} no longer declares duration`).toBeDefined();
      expect(field?.control, `${type}.duration changed control`).toBe('text');
      // The placeholder is what stops the control asking for a sentence.
      expect(field?.placeholder).toMatch(/^\d+:\d{2}$/);
      expect(field?.hint ?? '').not.toBe('');
    }
  });

  // ── invite.offers[].id — the OPTION LIST against the REAL id set ───────────
  //
  // `offers[]` decorates a way in by naming its canonical path id, and
  // `readDecorations` matches strictly by that id: a value that is not an id
  // `deriveOfferPaths` emits decorates nothing, silently. So the select's options
  // are a machine-checkable claim about another module's vocabulary, and they
  // were checked by hand — which is how the tier gap below survived.
  //
  // The offer carries all three path kinds, so every id the platform can emit is
  // in the derived set.
  const EVERY_PATH_OFFER = {
    courseId: 'c1',
    organizationId: 'o1',
    paths: ['purchase', 'subscription', 'tier'] as const,
    purchase: { priceCents: 4900 },
    subscription: { planId: 'p1', priceMonthly: 1200, priceAnnual: 12000 },
    tiers: [
      {
        tierId: 'ec3b2f11-0000-4000-8000-000000000001',
        tierName: 'Inner circle',
        priceMonthly: 1500,
        priceAnnual: 15000,
      },
    ],
    entitled: false,
  };

  function offerIdField(): SectionFieldDef {
    const offers = SECTION_FIELDS.invite.find((f) => f.key === 'offers');
    const id = offers?.itemFields?.find((f) => f.key === 'id');
    if (!id) throw new Error('invite.offers[].id is no longer declared');
    return id;
  }

  it('every way-in a creator can SELECT is an id deriveOfferPaths really emits', () => {
    // The falsifiable half, and the durable one: rename `subscription-monthly` in
    // offer-paths.ts and this goes red instead of every such entry quietly
    // decorating nothing.
    const derived = new Set(
      deriveOfferPaths(
        { ...EVERY_PATH_OFFER, paths: [...EVERY_PATH_OFFER.paths] },
        { title: 'Bone Deep' }
      ).map((path) => path.id)
    );
    for (const option of offerIdField().options ?? []) {
      expect(
        derived,
        `invite.offers[].id offers "${option.value}", which deriveOfferPaths never emits — the entry would decorate nothing`
      ).toContain(option.value);
    }
  });

  it('KNOWN GAP: a tier path is emitted and cannot be selected — delete this when the options are derived', () => {
    // The same discipline `OWED_READS` uses: a gap is DECLARED so it cannot be
    // forgotten, and asserted to still BE a gap so it cannot rot. On a course sold
    // only through membership tiers, every id in the select is absent from the
    // derived set, so the invite section's ways-in copy is unauthorable and any
    // entry the creator makes is dropped without a word.
    //
    // The fix is not in this file: the options must be derived from the page's
    // real offer (the tiers are already in the monetisation store) and an
    // unmatched decoration must be reported in the rail. Handed off. When that
    // lands, this assertion fails — and deleting it is the point.
    const tierOnly = deriveOfferPaths(
      {
        ...EVERY_PATH_OFFER,
        paths: ['tier'],
        purchase: null,
        subscription: null,
      },
      { title: 'Bone Deep' }
    );
    const tierId = EVERY_PATH_OFFER.tiers[0].tierId;
    expect(tierOnly.map((p) => p.id)).toEqual([tierPathId(tierId)]);

    const selectable = (offerIdField().options ?? []).map((o) => o.value);
    expect(
      selectable,
      'a tier path is now selectable — delete this KNOWN GAP assertion and the hint that names it'
    ).not.toContain(tierPathId(tierId));

    // And the hint must SAY so, because until the options are derived the hint is
    // the only thing standing between a creator and lost work.
    expect(offerIdField().hint ?? '').toContain('Membership tiers');
  });

  it('never reintroduces an authored invite PRICE — not as a field, not as an alias', () => {
    // A page advertising £12 a month for a £15 tier. The field was deleted and
    // the alias deliberately never added (`05-bridge-table.md`); prices come only
    // from `JourneySalesContext.offer`.
    const forbidden = ['price', 'priceLabel', 'per'];
    for (const field of everyField(SECTION_FIELDS.invite)) {
      expect(forbidden, `invite.${field.key} authors a price`).not.toContain(
        field.key
      );
    }
    for (const prop of Object.keys(SECTION_PROP_ALIASES.invite ?? {})) {
      expect(forbidden).not.toContain(prop);
    }
  });
});
