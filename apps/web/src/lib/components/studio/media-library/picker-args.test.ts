import { describe, expect, it } from 'vitest';
import { pickerListArgs } from './picker-args';

describe('pickerListArgs', () => {
  it('narrows to the one type a field holds, and to ready by default', () => {
    expect(
      pickerListArgs(
        { mediaTypes: ['video'], segment: 'ready', sort: 'newest' },
        null,
        1
      )
    ).toEqual({
      page: 1,
      limit: 24,
      mediaType: 'video',
      status: 'ready',
      usage: 'any',
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
  });

  it('leaves the type open for a field that holds both', () => {
    const args = pickerListArgs(
      { mediaTypes: ['video', 'audio'], segment: 'ready', sort: 'title' },
      null,
      2
    );
    expect(args.mediaType).toBeUndefined();
    expect(args).toMatchObject({ page: 2, sortBy: 'title', sortOrder: 'asc' });
  });

  it('never offers a failed or stopped item: All is the attachable group', () => {
    const facets = { mediaTypes: ['audio'], sort: 'newest' } as const;
    expect(
      pickerListArgs({ ...facets, segment: 'processing' }, null, 1).status
    ).toBe('processing');
    expect(pickerListArgs({ ...facets, segment: 'all' }, null, 1).status).toBe(
      'attachable'
    );
  });

  it('carries a gated search, and none below the floor', () => {
    const facets = {
      mediaTypes: ['video'],
      segment: 'ready',
      sort: 'newest',
    } as const;
    expect(pickerListArgs(facets, 'svelte', 1).search).toBe('svelte');
    expect('search' in pickerListArgs(facets, null, 1)).toBe(false);
  });
});
