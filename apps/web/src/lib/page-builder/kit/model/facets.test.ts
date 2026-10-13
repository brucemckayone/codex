/**
 * The Type facet's reader (03 X73): a page's Type is drawn only where its
 * Style may take it, so a pair not on the allow-list, or taken off it later,
 * reads as the Style's own. These tests read through a list of their own,
 * and pin the real one, the measured menu (03 X74).
 */
import { describe, expect, it } from 'vitest';
import {
  type PageStyleId,
  readPageFacets,
  TYPE_FACET_BASES,
  type TypeFacet,
} from './ids';

/** A list of the tests' own, whatever the real one offers. */
const LIST: Readonly<Record<PageStyleId, readonly TypeFacet[]>> = {
  bold: [],
  clean: ['poster', 'soft'],
  soft: [],
  cinematic: [],
  path: [],
  poster: [],
  studio: [],
  quiet: [],
};

describe('readPageFacets', () => {
  it('keeps a Type the Style may take', () => {
    expect(readPageFacets({ type: 'poster' }, 'clean', LIST)).toEqual({
      type: 'poster',
    });
  });

  it('drops a Type that Style may not take, as on a Style change', () => {
    expect(readPageFacets({ type: 'poster' }, 'bold', LIST)).toBeUndefined();
    expect(readPageFacets({ type: 'quiet' }, 'clean', LIST)).toBeUndefined();
  });

  it('drops a Type that is no Type, and a bag that is not one', () => {
    for (const value of [
      { type: 'path' },
      { type: 'POSTER' },
      {},
      'poster',
      null,
      undefined,
      ['poster'],
    ])
      expect(readPageFacets(value, 'clean', LIST)).toBeUndefined();
  });

  it('keeps only the Type, whatever else the bag carries', () => {
    expect(
      readPageFacets({ type: 'soft', surface: 'soft' }, 'clean', LIST)
    ).toEqual({
      type: 'soft',
    });
  });

  it('reads the real list by default: the menu, as measured (03 X74)', () => {
    // A change here is a change to what creators are offered: re-run
    // type-fit.spec.ts, type-lift.spec.ts and louder-fit.spec.ts's Type axis.
    expect(TYPE_FACET_BASES).toEqual({
      bold: ['poster', 'soft', 'quiet'],
      clean: ['bold', 'poster', 'soft', 'quiet'],
      soft: ['bold', 'quiet'],
      cinematic: ['bold', 'poster', 'soft', 'quiet'],
      path: [],
      poster: ['bold', 'soft', 'quiet'],
      studio: [],
      quiet: ['soft'],
    });
    for (const [style, types] of Object.entries(TYPE_FACET_BASES))
      for (const type of types)
        expect(readPageFacets({ type }, style as PageStyleId)).toEqual({
          type,
        });
  });

  it('offers no Style its own Type, and Path and Studio none', () => {
    for (const [style, types] of Object.entries(TYPE_FACET_BASES))
      expect(types, style).not.toContain(style);
    expect(TYPE_FACET_BASES.path).toEqual([]);
    expect(TYPE_FACET_BASES.studio).toEqual([]);
  });
});
