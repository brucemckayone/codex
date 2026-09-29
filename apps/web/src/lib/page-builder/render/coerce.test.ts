/**
 * Safe section-prop coercion (Codex-2pryk.3.1 · WP-3).
 *
 * `PageSection.props` is untrusted org-authored jsonb. These guards must degrade
 * a malformed/absent field to a fallback (undefined / dropped entry) rather than
 * surface a non-string into the render, so an unconfigured or corrupt section
 * never throws during SSR.
 */
import { describe, expect, it } from 'vitest';
import {
  asObjectArray,
  asString,
  fieldBool,
  fieldString,
  SECTION_PROP_ALIASES,
} from './coerce';

describe('asString', () => {
  it('returns a trimmed non-empty string, else undefined', () => {
    expect(asString({ x: '  hi  ' }, 'x')).toBe('hi');
    expect(asString({ x: '' }, 'x')).toBeUndefined();
    expect(asString({ x: '   ' }, 'x')).toBeUndefined();
    expect(asString({ x: 42 }, 'x')).toBeUndefined();
    expect(asString({}, 'x')).toBeUndefined();
  });
});

describe('asObjectArray', () => {
  it('maps plain objects, dropping entries the mapper rejects and non-objects', () => {
    const items = asObjectArray<{ q: string }>(
      { x: [{ q: 'one' }, { nope: 1 }, 'str', null, { q: '  two  ' }] },
      'x',
      (entry) => {
        const q = fieldString(entry, 'q');
        return q ? { q } : null;
      }
    );
    expect(items).toEqual([{ q: 'one' }, { q: 'two' }]);
  });

  it('returns undefined when nothing survives', () => {
    expect(
      asObjectArray({ x: [{ nope: 1 }] }, 'x', () => null)
    ).toBeUndefined();
    expect(asObjectArray({ x: 'not-array' }, 'x', () => ({}))).toBeUndefined();
  });
});

describe('fieldBool', () => {
  it('is strict-true only', () => {
    expect(fieldBool({ x: true }, 'x')).toBe(true);
    expect(fieldBool({ x: 'true' }, 'x')).toBe(false);
    expect(fieldBool({}, 'x')).toBe(false);
  });
});

// ── The builder→renderer bridge (Codex-tqr51) ────────────────────────────────
//
// `asStringFrom`/`asStringsFrom`/`asParagraphsFrom`/`aliasKeys` and their tests
// were deleted with the legacy renderer (WP-9a) — their only callers were the
// legacy sections and `JourneyRenderer`/`section-registry`. `SECTION_PROP_ALIASES`
// itself stayed: `kit/model/legacy/prop-mappers.ts` and `render/editable.ts`
// still read the table directly.

describe('SECTION_PROP_ALIASES', () => {
  it('covers all 11 catalogue types so a missing entry is visible, not silent', () => {
    expect(Object.keys(SECTION_PROP_ALIASES).sort()).toEqual(
      [
        'ache',
        'faq',
        'feel',
        'guide',
        'hero',
        'introVideo',
        'invite',
        'map',
        'proof',
        'reel',
        'turn',
      ].sort()
    );
  });

  it('always lists the RENDERER key first, so a page authored against it still wins', () => {
    for (const [type, props] of Object.entries(SECTION_PROP_ALIASES)) {
      for (const [prop, keys] of Object.entries(props)) {
        expect(keys[0], `${type}.${prop}`).toBe(prop);
        expect(keys.length, `${type}.${prop}`).toBeGreaterThan(1);
        expect(new Set(keys).size, `${type}.${prop}`).toBe(keys.length);
      }
    }
  });

  it('NEVER bridges invite.price — pricing comes only from the offer', () => {
    // Codex-2pryk.2.4.3: reading an authored price would let a page advertise a
    // price and a path that do not exist. The FIELD is deleted, never bridged.
    for (const keys of Object.values(SECTION_PROP_ALIASES.invite)) {
      expect(keys).not.toContain('price');
    }
    expect(SECTION_PROP_ALIASES.invite.priceNote).toEqual([
      'priceNote',
      'risk',
    ]);
  });

  it('bridges the confirmed live losses from the golden page', () => {
    expect(SECTION_PROP_ALIASES.hero.ctaLabel).toEqual(['ctaLabel', 'button']);
    expect(SECTION_PROP_ALIASES.hero.subheadline).toEqual([
      'subheadline',
      'sub',
    ]);
    expect(SECTION_PROP_ALIASES.map.title).toEqual(['title', 'heading']);
    expect(SECTION_PROP_ALIASES.map.foot).toEqual(['foot', 'note']);
    expect(SECTION_PROP_ALIASES.guide.bio).toEqual(['bio', 'body']);
    expect(SECTION_PROP_ALIASES.guide.eyebrow).toEqual(['eyebrow', 'role']);
  });
});
