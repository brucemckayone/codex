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
  aliasKeys,
  asBool,
  asObjectArray,
  asParagraphsFrom,
  asString,
  asStringArray,
  asStringFrom,
  asStringsFrom,
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

describe('asStringArray', () => {
  it('keeps only non-empty strings, trims, drops non-strings', () => {
    expect(asStringArray({ x: ['a', ' b ', 3, '', null] }, 'x')).toEqual([
      'a',
      'b',
    ]);
  });

  it('returns undefined for non-arrays or all-empty arrays', () => {
    expect(asStringArray({ x: 'a' }, 'x')).toBeUndefined();
    expect(asStringArray({ x: ['', '  '] }, 'x')).toBeUndefined();
    expect(asStringArray({}, 'x')).toBeUndefined();
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

describe('asBool / fieldBool', () => {
  it('asBool honours booleans and the fallback', () => {
    expect(asBool({ x: true }, 'x')).toBe(true);
    expect(asBool({ x: 'true' }, 'x')).toBe(false);
    expect(asBool({}, 'x', true)).toBe(true);
  });

  it('fieldBool is strict-true only', () => {
    expect(fieldBool({ x: true }, 'x')).toBe(true);
    expect(fieldBool({ x: 'true' }, 'x')).toBe(false);
    expect(fieldBool({}, 'x')).toBe(false);
  });
});

// ── The builder→renderer bridge (Codex-tqr51) ────────────────────────────────

describe('asStringFrom', () => {
  it('takes the first non-empty key in preference order', () => {
    expect(
      asStringFrom({ ctaLabel: 'Go', button: 'Get started' }, [
        'ctaLabel',
        'button',
      ])
    ).toBe('Go');
    // The real case: only the BUILDER's key is stored, so the alias must win.
    expect(
      asStringFrom({ button: 'Get started' }, ['ctaLabel', 'button'])
    ).toBe('Get started');
  });

  it('skips blank and non-string values rather than stopping at them', () => {
    expect(asStringFrom({ a: '   ', b: 42, c: 'ok' }, ['a', 'b', 'c'])).toBe(
      'ok'
    );
    expect(asStringFrom({}, ['a', 'b'])).toBeUndefined();
  });
});

describe('asStringsFrom', () => {
  it('synthesises a list from discrete flat fields, in key order', () => {
    expect(
      asStringsFrom({ heading: 'H', body: 'B' }, ['heading', 'body'])
    ).toEqual(['H', 'B']);
    expect(asStringsFrom({ body: 'B' }, ['heading', 'body'])).toEqual(['B']);
    expect(asStringsFrom({}, ['heading', 'body'])).toBeUndefined();
  });
});

describe('asParagraphsFrom', () => {
  it('splits a textarea string into paragraphs on any newline run', () => {
    // The guide case: the builder writes ONE `body` textarea; the renderer reads
    // `bio` as a string array, and `asStringArray` discarded the string outright,
    // so the guide's entire biography rendered as nothing.
    expect(
      asParagraphsFrom({ body: 'One\n\nTwo\nThree' }, ['bio', 'body'])
    ).toEqual(['One', 'Two', 'Three']);
    expect(
      asParagraphsFrom({ body: 'Just the one line' }, ['bio', 'body'])
    ).toEqual(['Just the one line']);
  });

  it('handles CRLF and trims each paragraph', () => {
    expect(asParagraphsFrom({ body: '  A  \r\n\r\n  B  ' }, ['body'])).toEqual([
      'A',
      'B',
    ]);
  });

  it('prefers an earlier key and degrades to undefined', () => {
    expect(
      asParagraphsFrom({ bio: 'B1', body: 'B2' }, ['bio', 'body'])
    ).toEqual(['B1']);
    expect(asParagraphsFrom({ body: '   \n  \n ' }, ['body'])).toBeUndefined();
    expect(asParagraphsFrom({ body: 42 }, ['body'])).toBeUndefined();
    expect(asParagraphsFrom({}, ['body'])).toBeUndefined();
  });
});

describe('SECTION_PROP_ALIASES / aliasKeys', () => {
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

  it('aliasKeys is total — an undeclared type or prop yields the prop itself', () => {
    expect(aliasKeys('hero', 'ctaLabel')).toEqual(['ctaLabel', 'button']);
    expect(aliasKeys('hero', 'headline')).toEqual(['headline']);
    expect(aliasKeys('retreat-x', 'anything')).toEqual(['anything']);
  });

  it('resolves the golden page’s stored hero CTA through the alias', () => {
    // End-to-end of the bridge: the golden page stores `button: "Get started"`,
    // the component read only `ctaLabel`, and the served HTML showed the
    // hardcoded 'Begin the journey'.
    const stored = { headline: 'The ground', button: 'Get started' };
    expect(asStringFrom(stored, aliasKeys('hero', 'ctaLabel'))).toBe(
      'Get started'
    );
  });
});
