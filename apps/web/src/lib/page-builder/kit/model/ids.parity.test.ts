/**
 * `ids.ts` ↔ `@codex/validation` parity (docs/design/landing-builder/
 * 01-contract.md §2: "Every list here has a twin in `@codex/validation`
 * (`schemas/landing-page.ts`) that validates writes; `ids.parity.test.ts`
 * fails if the two drift").
 *
 * `ids.ts` cannot import zod (public-bundle, module-scope-call-defeats-
 * tree-shaking), so the closed vocabulary is declared twice. This is the
 * one place that duplication is checked — deep-equal, not just "same
 * length" or "same keys", so a value TYPO'd in one copy and not the other
 * fails here rather than shipping as a silently-narrower (or wider) enum on
 * one side of the write boundary.
 */
import {
  COLOUR_SCHEME_IDS as VALIDATION_COLOUR_SCHEME_IDS,
  PAGE_STYLE_IDS as VALIDATION_PAGE_STYLE_IDS,
  SECTION_LAYOUTS as VALIDATION_SECTION_LAYOUTS,
  SECTION_SPACING_IDS as VALIDATION_SECTION_SPACING_IDS,
  SECTION_TYPE_IDS as VALIDATION_SECTION_TYPE_IDS,
} from '@codex/validation';
import { describe, expect, it } from 'vitest';
import {
  COLOUR_SCHEME_IDS,
  PAGE_STYLE_IDS,
  SECTION_LAYOUTS,
  SECTION_SPACING_IDS,
  SECTION_TYPE_IDS,
} from './ids';

describe('ids.ts ↔ @codex/validation landing-page.ts', () => {
  it('PAGE_STYLE_IDS matches exactly', () => {
    expect(VALIDATION_PAGE_STYLE_IDS).toEqual(PAGE_STYLE_IDS);
  });

  it('COLOUR_SCHEME_IDS matches exactly', () => {
    expect(VALIDATION_COLOUR_SCHEME_IDS).toEqual(COLOUR_SCHEME_IDS);
  });

  it('SECTION_SPACING_IDS matches exactly', () => {
    expect(VALIDATION_SECTION_SPACING_IDS).toEqual(SECTION_SPACING_IDS);
  });

  it('SECTION_LAYOUTS matches exactly — every type, every layout, in order', () => {
    expect(VALIDATION_SECTION_LAYOUTS).toEqual(SECTION_LAYOUTS);
  });

  it('SECTION_TYPE_IDS matches exactly', () => {
    expect(VALIDATION_SECTION_TYPE_IDS).toEqual(SECTION_TYPE_IDS);
  });
});
