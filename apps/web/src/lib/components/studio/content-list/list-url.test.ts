import { CONTENT_ATTENTION_KINDS } from '@codex/constants';
import {
  contentAttentionQuerySchema,
  contentQuerySchema,
} from '@codex/validation';
import { describe, expect, it } from 'vitest';
import {
  attentionArgs,
  CATEGORY_ANY,
  CONTENT_LIST_DEFAULTS,
  CONTENT_LIST_PAGE_SIZE,
  contentListArgs,
  isContentListNarrowed,
  LIST_SORTS,
  NEEDS_NONE,
  needsPatch,
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
        '?status=draft&type=audio&access=subscribers&sort=views&view=grid&search=runes&needs=media-gone'
      )
    ).toEqual({
      search: 'runes',
      status: 'draft',
      type: 'audio',
      access: 'subscribers',
      sort: 'views',
      view: 'grid',
      where: WHERE_PERSONAL,
      category: CATEGORY_ANY,
      needs: 'media-gone',
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
      include: 'categories',
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
      include: 'categories',
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

/**
 * The org studio's Category (Codex-a6ofh.3.3): one category by id, or Any.
 * The personal studio has none (owner, 2026-11-12) and ignores the param.
 */
describe('category', () => {
  const CATEGORY = '7c000000-0000-4000-8000-000000000001';

  it('reads an id, and anything else as Any', () => {
    expect(at(`?category=${CATEGORY}`).category).toBe(CATEGORY);
    for (const query of ['', '?category=tutorials', '?category=']) {
      expect(at(query).category).toBe(CATEGORY_ANY);
    }
  });

  it('the org studio asks for its pieces in it, and the schema takes the args', () => {
    const args = contentListArgs(at(`?category=${CATEGORY}`), null, ORG, 1);
    expect(args).toMatchObject({ organizationId: ORG, categoryId: CATEGORY });
    expect(contentQuerySchema.safeParse(args).success).toBe(true);
    expect(contentListArgs(at(''), null, ORG, 1)).not.toHaveProperty(
      'categoryId'
    );
  });

  it('the personal studio ignores it, and asks for no names', () => {
    const args = contentListArgs(at(`?category=${CATEGORY}`), null, null, 1);
    expect(args).not.toHaveProperty('categoryId');
    expect(args).not.toHaveProperty('include');
    expect(isContentListNarrowed(at(`?category=${CATEGORY}`), null, null)).toBe(
      false
    );
  });

  it('narrows the org studio’s list', () => {
    expect(isContentListNarrowed(at(`?category=${CATEGORY}`), null, ORG)).toBe(
      true
    );
  });
});

describe('needs: a "Needs you" chip (Codex-a6ofh.3.4)', () => {
  it('reads each kind, and anything else as none', () => {
    for (const kind of CONTENT_ATTENTION_KINDS) {
      expect(at(`?needs=${kind}`).needs).toBe(kind);
    }
    expect(at('?needs=urgent').needs).toBe(NEEDS_NONE);
    expect(at('').needs).toBe(NEEDS_NONE);
  });

  it('asks for the chip’s pieces, in both studios, as args the API takes', () => {
    for (const organizationId of [ORG, null]) {
      const args = contentListArgs(at('?needs=ready'), null, organizationId, 1);
      expect(args).toMatchObject({ needs: 'ready' });
      expect(contentQuerySchema.safeParse(args).success).toBe(true);
    }
    expect(contentListArgs(at(''), null, ORG, 1)).not.toHaveProperty('needs');
  });

  it('narrows the list, so an empty one offers Clear filters', () => {
    expect(isContentListNarrowed(at('?needs=processing'), null, ORG)).toBe(
      true
    );
    expect(isContentListNarrowed(at('?needs=processing'), null, null)).toBe(
      true
    );
  });

  it('a chip pressed clears the status, facets and search, and leaves Where, sort and view to the URL', () => {
    const view = at(
      `?status=draft&type=video&access=paid&category=${ORG}&search=lesson&sort=title&view=grid&where=all`
    );
    expect(needsPatch('ready', view)).toEqual({
      needs: 'ready',
      search: null,
      status: null,
      type: null,
      access: null,
      category: null,
    });
  });

  it('the chip in use pressed again lets it go, and nothing else', () => {
    expect(needsPatch('ready', at('?needs=ready&type=video'))).toEqual({
      needs: null,
    });
    expect(needsPatch('processing', at('?needs=ready'))).toMatchObject({
      needs: 'processing',
    });
  });
});

describe('attentionArgs (Codex-a6ofh.3.4)', () => {
  it('looks where the list looks, and the schema takes it', () => {
    expect(attentionArgs(WHERE_PERSONAL, ORG)).toEqual({ organizationId: ORG });
    expect(attentionArgs(WHERE_PERSONAL, null)).toEqual({ scope: 'personal' });
    expect(attentionArgs(WHERE_ALL, null)).toEqual({});
    expect(attentionArgs(OTHER_ORG, null)).toEqual({
      organizationId: OTHER_ORG,
    });
    for (const where of [WHERE_PERSONAL, WHERE_ALL, OTHER_ORG]) {
      expect(
        contentAttentionQuerySchema.safeParse(attentionArgs(where, null))
          .success
      ).toBe(true);
    }
  });
});
