/**
 * The Type facet's reader (03 X73): a page's Type is drawn only where its
 * Style may take it, so a pair not on the allow-list, or taken off it later,
 * reads as the Style's own. The list is empty until each pair is proven, so
 * these tests read through one of their own.
 */
import { describe, expect, it } from 'vitest';
import {
  type PageStyleId,
  readPageFacets,
  TYPE_FACET_BASES,
  type TypeFacet,
} from './ids';

const LIST: Readonly<Record<PageStyleId, readonly TypeFacet[]>> = {
  ...TYPE_FACET_BASES,
  clean: ['poster', 'soft'],
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

  it('reads the real list by default, which offers nothing until a pair is proven', () => {
    expect(Object.values(TYPE_FACET_BASES).flat()).toEqual([]);
    expect(readPageFacets({ type: 'poster' }, 'clean')).toBeUndefined();
  });
});
