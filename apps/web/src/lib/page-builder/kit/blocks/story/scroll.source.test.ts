// @vitest-environment node
/**
 * The scroll story's wide geometry, in the rules jsdom cannot run:
 *
 *   1. From 48rem the words take five twelfths and the pictures seven, the
 *      moments' own pictures square, a phone's 4:5 (each picture first).
 *   2. The sticky frame (motion only) is square, no taller than 80% of the
 *      viewport, and sticks centred in it.
 *   3. Every moment's name is drawn at the heading's size, wide, through the
 *      title's own rule, so none changes size as the moments pass; a phone
 *      keeps the title's.
 *
 * A SOURCE test, the weaker instrument: it proves the rules, not the paint.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { componentRules } from '../testing';

const PATH = join(import.meta.dirname, 'StoryScroll.svelte');
const SOURCE = readFileSync(PATH, 'utf8');
const rules = componentRules(PATH);
const WIDE = '@container (min-width: 48rem)';
const LIVE =
  ':global(.lp:not([data-lp-still], [data-lp-motion])) .story-scroll[data-live] .story-scroll__frame';

const decl = (selector: string, property: string, within: string[] = []) =>
  rules
    .filter(
      (rule) =>
        rule.selector === selector &&
        rule.within.join(' ') === within.join(' ') &&
        rule.decls.has(property)
    )
    .map((rule) => rule.decls.get(property));

describe('StoryScroll: the wide geometry', () => {
  it('splits the column five twelfths to seven from 48rem', () => {
    expect(decl('.story-scroll', 'grid-template-columns', [WIDE])).toEqual([
      'minmax(0, 5fr) minmax(0, 7fr)',
    ]);
    expect(decl('.story-scroll', '--_col')).toEqual([
      'calc((var(--lp-column) - var(--lp-gap)) * 7 / 12)',
    ]);
  });

  it('draws each moment’s picture square wide, 4:5 on a phone, and passes Media no ratio of its own', () => {
    expect(
      decl('.story-scroll__media :global(.lp-media)', 'aspect-ratio')
    ).toEqual(['4 / 5']);
    expect(
      decl('.story-scroll__media :global(.lp-media)', 'aspect-ratio', [WIDE])
    ).toEqual(['1']);
    // An inline `ratio` would beat both; calibrated on the tags it reads.
    const media = SOURCE.match(/<Media\b[^>]*>/g) ?? [];
    expect(media).toHaveLength(2);
    expect(media.filter((tag) => /\bratio=/.test(tag))).toEqual([]);
  });

  it('sticks a square frame, at most 80% of the viewport, centred in it', () => {
    expect(decl('.story-scroll', '--_frame')).toEqual([
      'min(var(--_col), 80svh)',
    ]);
    const frame = (property: string) =>
      decl(LIVE, property, [
        '@media (prefers-reduced-motion: no-preference)',
        WIDE,
      ]);
    expect(frame('position')).toEqual(['sticky']);
    expect(frame('aspect-ratio')).toEqual(['1']);
    expect(frame('inline-size')).toEqual(['var(--_frame)']);
    expect(frame('inset-block-start')).toEqual([
      'max(var(--space-6), calc((100svh - var(--_frame)) / 2))',
    ]);
  });

  it('lifts every moment’s name to the heading’s size wide, and only wide', () => {
    const words = '.story-scroll__step > :global(.story-words)';
    expect(decl(words, '--lp-title-lift', [WIDE])).toEqual(['1']);
    expect(decl(words, '--lp-leading-title', [WIDE])).toEqual([
      'var(--lp-leading-heading)',
    ]);
    expect(
      rules.filter(
        (rule) => rule.decls.has('--lp-title-lift') && rule.within.length === 0
      )
    ).toEqual([]);
  });
});
