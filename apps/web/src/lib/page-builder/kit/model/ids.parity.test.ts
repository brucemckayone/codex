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
  buttonActionSchema,
  pageDialsSchema,
  BUTTON_ACTION_IDS as VALIDATION_BUTTON_ACTION_IDS,
  COLOUR_SCHEME_IDS as VALIDATION_COLOUR_SCHEME_IDS,
  PAGE_DIALS as VALIDATION_PAGE_DIALS,
  PAGE_STYLE_IDS as VALIDATION_PAGE_STYLE_IDS,
  SECTION_LAYOUTS as VALIDATION_SECTION_LAYOUTS,
  SECTION_SPACING_IDS as VALIDATION_SECTION_SPACING_IDS,
  SECTION_TYPE_IDS as VALIDATION_SECTION_TYPE_IDS,
  isButtonHref as validationIsButtonHref,
} from '@codex/validation';
import { describe, expect, it } from 'vitest';
import { isButtonHref, readButtonAction } from './button-action';
import {
  BUTTON_ACTION_IDS,
  COLOUR_SCHEME_IDS,
  PAGE_DIALS,
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

  it('PAGE_DIALS matches exactly — every dial, every step, in order', () => {
    expect(VALIDATION_PAGE_DIALS).toEqual(PAGE_DIALS);
  });

  it('the write boundary validates every dial (an unlisted one is stripped)', () => {
    const steps = Object.fromEntries(
      Object.entries(PAGE_DIALS).map(([dial, [step]]) => [dial, step])
    );
    expect(pageDialsSchema.parse(steps)).toEqual(steps);
  });

  it('BUTTON_ACTION_IDS matches exactly (03 X64)', () => {
    expect(VALIDATION_BUTTON_ACTION_IDS).toEqual(BUTTON_ACTION_IDS);
  });
});

/**
 * A Button's link (03 X64) is judged twice: refused at the write boundary,
 * and read again by the renderer, which hides a button whose link it cannot
 * trust. The two rules must agree on every address, or a page saves a link
 * the live page then hides (or draws one the server would have refused).
 */
describe('a Button link: the renderer and the write boundary agree', () => {
  const LINKS = [
    'https://example.com',
    'https://example.com/retreat?ref=page#dates',
    'https://sub.example.co.uk:8443/path',
    'http://example.com',
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,<b>x</b>',
    'mailto:hello@example.com',
    '/checkout',
    '//evil.example',
    'https://a:b@example.com',
    'https://',
    'example.com',
    '',
    `https://example.com/${'a'.repeat(2000)}`,
  ];

  it.each(LINKS)('%s', (href) => {
    expect(isButtonHref(href)).toBe(validationIsButtonHref(href));
  });

  it('reads every action the write boundary accepts, and none it refuses', () => {
    const actions: unknown[] = [
      { kind: 'join' },
      { kind: 'preview' },
      { kind: 'section', target: 'sec-1' },
      { kind: 'section', target: '' },
      { kind: 'section' },
      ...LINKS.map((href) => ({ kind: 'link', href })),
      { kind: 'script' },
      'https://example.com',
      null,
    ];
    for (const action of actions) {
      expect(readButtonAction(action) !== undefined).toBe(
        buttonActionSchema.safeParse(action).success
      );
    }
  });
});
