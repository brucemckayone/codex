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
  hero: ['accent', 'felt', 'bg'], // WT-3
  introVideo: ['clip', 'duration'], // WT-2 — `reel.clip` IS aliased (as `tag`)
  reel: ['duration'], // WT-2
  ache: ['points'], // WT-1 — the List and Checklist compositions
  turn: ['from', 'to'], // WT-1 — the Before / after composition
  guide: ['clip', 'duration', 'facts'], // WT-6 — `facts` is the Credentials composition
  faq: ['g1', 'g2', 'g3'], // WT-5 — `asNumberedGroups` gains a `group: 'g'` field
  invite: ['accent'], // WT-7
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
