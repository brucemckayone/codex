import { contentQuerySchema } from '@codex/validation';
import { describe, expect, it } from 'vitest';
import {
  CONTENT_LIST_DEFAULTS,
  CONTENT_LIST_PAGE_SIZE,
  contentListArgs,
  isContentListNarrowed,
  LIST_SORTS,
  readContentListState,
  WHERE_ALL,
  WHERE_PERSONAL,
} from './list-url';

const ORG = '5f0c7b2e-1d3a-4c8e-9b6f-2a7d1e4c9b30';
const OTHER_ORG = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

function at(query: string) {
  return readContentListState(
    new URL(`https://studio.test/studio/content${query}`)
  );
}

describe('readContentListState', () => {
  it('reads a bare URL as every default', () => {
    expect(at('')).toEqual({ search: '', ...CONTENT_LIST_DEFAULTS });
  });

  it('reads each param the list offers', () => {
    expect(
      at(
        '?status=draft&type=audio&access=subscribers&sort=views&view=grid&search=runes'
      )
    ).toEqual({
      search: 'runes',
      status: 'draft',
      type: 'audio',
      access: 'subscribers',
      sort: 'views',
      view: 'grid',
      where: WHERE_PERSONAL,
    });
  });

  // The personal studio's Where (Codex-a6ofh.3.2): Personal by default,
  // Everywhere, or one org by id; anything else is the default.
  it('reads the Where as Everywhere, an org id, or else Personal', () => {
    expect(at('').where).toBe(WHERE_PERSONAL);
    expect(at('?where=all').where).toBe(WHERE_ALL);
    expect(at(`?where=${ORG}`).where).toBe(ORG);
    expect(at('?where=studio-alpha').where).toBe(WHERE_PERSONAL);
    expect(at('?where=personal').where).toBe(WHERE_PERSONAL);
  });

  it('reads a value it does not offer as the default, never a refusal', () => {
    expect(
      at('?status=deleted&type=pdf&access=vip&sort=random&view=cards')
    ).toEqual({
      search: '',
      ...CONTENT_LIST_DEFAULTS,
    });
  });

  it('keeps the search as typed: the gate is the caller’s', () => {
    expect(at('?search=a').search).toBe('a');
  });
});

describe('contentListArgs', () => {
  it('asks for one page of 24, sorted by last updated, and nothing else by default', () => {
    expect(contentListArgs(at(''), null, ORG, 1)).toEqual({
      page: 1,
      limit: CONTENT_LIST_PAGE_SIZE,
      organizationId: ORG,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });
  });

  // The leak (Codex-a6ofh.3.2): the personal list asked with no org, which
  // the API reads as every org, so org pieces showed as personal ones.
  it('asks the personal studio for its own pieces by default', () => {
    const args = contentListArgs(at(''), null, null, 1);
    expect(args).toMatchObject({ scope: 'personal' });
    expect(args).not.toHaveProperty('organizationId');
  });

  it('asks the personal studio for everything, or for one org, as its Where says', () => {
    const everywhere = contentListArgs(at('?where=all'), null, null, 1);
    expect(everywhere).not.toHaveProperty('scope');
    expect(everywhere).not.toHaveProperty('organizationId');
    const oneOrg = contentListArgs(at(`?where=${ORG}`), null, null, 1);
    expect(oneOrg).toMatchObject({ organizationId: ORG });
    expect(oneOrg).not.toHaveProperty('scope');
  });

  it('keeps the org studio on its own org, whatever the URL’s Where says', () => {
    for (const query of ['?where=all', `?where=${OTHER_ORG}`, '']) {
      const args = contentListArgs(at(query), null, ORG, 1);
      expect(args.organizationId).toBe(ORG);
      expect(args).not.toHaveProperty('scope');
    }
  });

  it.each([
    '',
    '?where=all',
    `?where=${ORG}`,
  ])('builds Where args the API accepts (%s)', (query) => {
    const args = contentListArgs(at(query), null, null, 1);
    expect(contentQuerySchema.safeParse(args).success).toBe(true);
  });

  it('forwards every facet under the name the API takes', () => {
    expect(
      contentListArgs(
        at('?status=published&type=written&access=paid&sort=title'),
        'runes',
        ORG,
        3
      )
    ).toEqual({
      page: 3,
      limit: CONTENT_LIST_PAGE_SIZE,
      organizationId: ORG,
      status: 'published',
      contentType: 'written',
      accessType: 'paid',
      search: 'runes',
      sortBy: 'title',
      sortOrder: 'asc',
    });
  });

  it('leaves a gated-out search out entirely', () => {
    expect(contentListArgs(at('?search=a'), null, ORG, 1)).not.toHaveProperty(
      'search'
    );
  });

  // The args reach content-api through its own schema: a sort or facet the
  // list offers that the API refuses would be a 400 no Try again could fix.
  it.each(LIST_SORTS)('builds args the API accepts for sort=%s', (sort) => {
    const args = contentListArgs(
      at(`?sort=${sort}&type=video&access=followers&status=archived`),
      'pattern',
      ORG,
      2
    );
    expect(contentQuerySchema.safeParse(args).success).toBe(true);
  });
});

describe('narrowing', () => {
  it('is narrowed by a facet or a search that reached the API', () => {
    expect(isContentListNarrowed(at(''), null, ORG)).toBe(false);
    expect(isContentListNarrowed(at('?sort=sales&view=grid'), null, ORG)).toBe(
      false
    );
    expect(isContentListNarrowed(at('?status=draft'), null, ORG)).toBe(true);
    expect(isContentListNarrowed(at('?type=video'), null, ORG)).toBe(true);
    expect(isContentListNarrowed(at('?access=paid'), null, ORG)).toBe(true);
    expect(isContentListNarrowed(at('?search=runes'), 'runes', ORG)).toBe(true);
  });

  // Personal is the personal studio's whole own list, and Everywhere more
  // than that: only one org is part of it. The org studio has no Where.
  it('is narrowed by a Where on one org, in the personal studio only', () => {
    expect(isContentListNarrowed(at(''), null, null)).toBe(false);
    expect(isContentListNarrowed(at('?where=all'), null, null)).toBe(false);
    expect(isContentListNarrowed(at(`?where=${ORG}`), null, null)).toBe(true);
    expect(isContentListNarrowed(at(`?where=${OTHER_ORG}`), null, ORG)).toBe(
      false
    );
  });
});
