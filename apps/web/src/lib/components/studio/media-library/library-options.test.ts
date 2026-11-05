import { describe, expect, it } from 'vitest';
import { attentionLine, soleFacetLabel } from './library-options';
import { readLibraryState } from './library-url';

const sums = (failed: number, stopped: number) => ({
  total: 12,
  totalBytes: 1,
  failed,
  stopped,
});

describe('attentionLine (mockup M1 note 6)', () => {
  it('is nothing when nothing needs the creator, or when that is the filter', () => {
    expect(attentionLine(undefined, 'any')).toBeNull();
    expect(attentionLine(sums(0, 0), 'any')).toBeNull();
    expect(attentionLine(sums(2, 1), 'attention')).toBeNull();
  });

  it('names both causes, each in its own number', () => {
    expect(attentionLine(sums(1, 1), 'any')).toEqual({
      title: '2 need attention.',
      detail: '1 failed to process, and 1 upload stopped before it finished.',
    });
    expect(attentionLine(sums(3, 2), 'ready')).toEqual({
      title: '5 need attention.',
      detail:
        '3 failed to process, and 2 uploads stopped before they finished.',
    });
  });

  it('names one cause alone, singular when one', () => {
    expect(attentionLine(sums(1, 0), 'any')).toEqual({
      title: '1 needs attention.',
      detail: '1 failed to process.',
    });
    expect(attentionLine(sums(0, 4), 'any')).toEqual({
      title: '4 need attention.',
      detail: '4 uploads stopped before they finished.',
    });
  });
});

describe('soleFacetLabel', () => {
  const at = (q: string) => readLibraryState(new URL(`https://s.test/m${q}`));

  it('names the one facet set, and nothing for none or several', () => {
    expect(soleFacetLabel(at('?usage=unused'))).toBe('Unused');
    expect(soleFacetLabel(at('?status=attention'))).toBe('Needs attention');
    expect(soleFacetLabel(at(''))).toBeNull();
    expect(soleFacetLabel(at('?usage=unused&mediaType=audio'))).toBeNull();
  });
});
