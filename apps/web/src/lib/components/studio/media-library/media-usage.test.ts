/**
 * How the Studio words and links a media item's uses (Codex-6sbn1).
 */
import type { MediaUsage, MediaUse } from '@codex/shared-types';
import { describe, expect, it } from 'vitest';
import {
  draftsLeftToast,
  firstOpenableDraft,
  liveUsesPhrase,
  newlyLiveUse,
  unlistedCounts,
  useAction,
  useHref,
  useWhere,
} from './media-usage';

const STUDIO = new URL('http://hollow-oak.lvh.me:3000/studio/media');

function use(over: Partial<MediaUse> = {}): MediaUse {
  return {
    kind: 'film',
    slot: 'media',
    live: true,
    liveReason: 'published',
    title: 'The Long Field',
    orgName: 'Hollow Oak Films',
    link: { to: 'content', contentId: 'c1', orgSlug: 'hollow-oak' },
    ...over,
  };
}

function usage(uses: MediaUse[], over: Partial<MediaUsage> = {}): MediaUsage {
  const live = uses.filter((u) => u.live).length;
  return {
    total: uses.length,
    live,
    drafts: uses.length - live,
    hidden: 0,
    uses,
    fingerprint: 'fp',
    ...over,
  };
}

const course = (over: Partial<MediaUse> = {}) =>
  use({
    kind: 'course',
    slot: 'intro',
    liveReason: 'published',
    title: 'Documentary from Idea to Festival',
    link: { to: 'journey', pageId: 'lp-1', orgSlug: 'hollow-oak' },
    ...over,
  });

const intro = use({
  kind: 'intro',
  slot: 'org_intro',
  liveReason: 'always',
  title: 'Hollow Oak Films',
  link: { to: 'brand', orgSlug: 'hollow-oak' },
});

describe('useHref', () => {
  it("a film opens its editor on its org's host", () => {
    expect(useHref(use().link, STUDIO)).toBe(
      'http://hollow-oak.lvh.me:3000/studio/content/c1/edit'
    );
  });

  it('personal content opens on the creators host', () => {
    expect(
      useHref({ to: 'content', contentId: 'c2', orgSlug: null }, STUDIO)
    ).toBe('http://creators.lvh.me:3000/studio/content/c2/edit');
  });

  it('a course opens its builder by LANDING PAGE id, on Settings', () => {
    expect(useHref(course().link, STUDIO)).toBe(
      'http://hollow-oak.lvh.me:3000/studio/journeys/lp-1/page?tab=settings'
    );
  });

  it('the intro video opens Brand', () => {
    expect(useHref(intro.link, STUDIO)).toBe(
      'http://hollow-oak.lvh.me:3000/studio/brand'
    );
  });

  it('no link, no href', () => {
    expect(useHref(null, STUDIO)).toBeNull();
  });
});

describe('useAction', () => {
  it('Replace on a published use; Open on a draft, or Replace in the blocked dialog', () => {
    expect(useAction(use())).toBe('replace');
    expect(useAction(use({ live: false, liveReason: null }))).toBe('open');
    expect(useAction(use({ live: false, liveReason: null }), 'replace')).toBe(
      'replace'
    );
  });

  it('without a link: who to ask', () => {
    expect(useAction(course({ link: null }))).toBe('ask-admin');
    expect(useAction(use({ link: null }))).toBe('ask-creator');
  });
});

describe('useWhere', () => {
  it('names what and where', () => {
    expect(useWhere(use())).toBe('Published film · Hollow Oak Films');
    expect(useWhere(use({ live: false, liveReason: null }))).toBe(
      'Draft film · Hollow Oak Films'
    );
    expect(useWhere(course())).toBe(
      'Course page · Intro film · Hollow Oak Films'
    );
    expect(
      useWhere(course({ live: false, liveReason: null, slot: 'reel' }))
    ).toBe('Draft course page · Practice reel · Hollow Oak Films');
    expect(useWhere(intro)).toBe('Hollow Oak Films home page');
  });

  it('off sale but bought says buyers can still watch', () => {
    expect(useWhere(use({ liveReason: 'bought' }))).toBe(
      'Off sale · people who bought it can still watch'
    );
  });

  it('personal content has no org part', () => {
    expect(useWhere(use({ orgName: null }))).toBe('Published film');
  });
});

describe('liveUsesPhrase', () => {
  it('B1: "2 published films, a course page and your intro video"', () => {
    const phrase = liveUsesPhrase(
      usage([
        use(),
        use({
          title: 'Commentary',
          link: { to: 'content', contentId: 'c2', orgSlug: 'hollow-oak' },
        }),
        course(),
        // The same course page in a second slot is still one course page.
        course({ slot: 'reel' }),
        intro,
        use({ live: false, liveReason: null }),
      ])
    );
    expect(phrase).toBe(
      '2 published films, a course page and your intro video'
    );
  });

  it('B2: "a film people have bought and a course page"', () => {
    expect(
      liveUsesPhrase(usage([use({ liveReason: 'bought' }), course()]))
    ).toBe('a film people have bought and a course page');
  });

  it('published uses past the 50-row cap are counted', () => {
    expect(liveUsesPhrase(usage([use()], { total: 3, live: 3 }))).toBe(
      'a published film and 2 more published uses'
    );
  });
});

describe('unlistedCounts', () => {
  it('splits what was counted but not named: hidden drafts, then the cap', () => {
    expect(unlistedCounts(usage([use()], { total: 5, hidden: 2 }))).toEqual({
      hidden: 2,
      capped: 2,
    });
    expect(unlistedCounts(usage([use()]))).toEqual({ hidden: 0, capped: 0 });
  });
});

describe('newlyLiveUse', () => {
  it('R1: the use the new read has as published that the dialog had as a draft', () => {
    const draft = use({ live: false, liveReason: null });
    const before = usage([draft]);
    const after = usage([use()]);
    expect(newlyLiveUse(before, after)?.title).toBe('The Long Field');
  });

  it('nothing new: null', () => {
    const both = usage([use()]);
    expect(newlyLiveUse(both, both)).toBeNull();
  });
});

describe('firstOpenableDraft', () => {
  it("the toast's link: the first draft with a link", () => {
    const draft = use({ live: false, liveReason: null });
    expect(
      firstOpenableDraft(
        usage([
          use(),
          use({ live: false, liveReason: null, link: null }),
          draft,
        ])
      )
    ).toBe(draft);
  });
});

describe('draftsLeftToast', () => {
  const draft = use({ live: false, liveReason: null });

  it('W2: "Deleted. 2 drafts need a new media item." with Show them on the first draft', () => {
    expect(draftsLeftToast(2, draft, STUDIO)).toEqual({
      variant: 'success',
      title: 'Deleted. 2 drafts need a new media item.',
      action: {
        label: 'Show them',
        href: 'http://hollow-oak.lvh.me:3000/studio/content/c1/edit',
      },
    });
  });

  it('one draft reads in the singular', () => {
    const data = draftsLeftToast(1, draft, STUDIO);
    expect(data.title).toBe('Deleted. 1 draft needs a new media item.');
    expect(data.action?.label).toBe('Show it');
  });

  it('no draft the creator can open: the line without a link', () => {
    expect(draftsLeftToast(1, null, STUDIO)).toEqual({
      variant: 'success',
      title: 'Deleted. 1 draft needs a new media item.',
    });
  });
});
