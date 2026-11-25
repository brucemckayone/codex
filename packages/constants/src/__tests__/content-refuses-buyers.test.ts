import { describe, expect, it } from 'vitest';
// Through the package index: access and purchase completion import them there.
import {
  BRANCH_BUYERS,
  type ContentAccessBranch,
  type ContentBuyerFacts,
  type CourseBuyerFacts,
  contentAccessBranch,
  contentRefusesBuyers,
  courseRefusesBuyers,
  isContentReleased,
  ownerKeepsInBranch,
} from '../index';

const ORG = '00000000-0000-0000-0000-0000000000a1';
const RELEASED = '2026-01-01T00:00:00.000Z';

/** Paid, published, in a live org. Each case overrides what it needs. */
const sold: ContentBuyerFacts = {
  priceCents: 1500,
  courseOnly: false,
  isTeamOnly: false,
  isFollowerGated: false,
  isTierGated: false,
  organizationId: ORG,
  status: 'published',
  publishedAt: RELEASED,
  deletedAt: null,
  organizationDeleted: false,
  leavesAt: null,
};

/** Deleted with notice: off sale (archived), its owners keep it 30 days. */
const LEAVES = '2026-12-23T00:00:00.000Z';

describe('contentAccessBranch (the access decision’s branch order, Codex-z1t3c)', () => {
  it.each([
    ['paid', sold, 'paid'],
    ['free', { ...sold, priceCents: 0 }, 'free'],
    ['unpriced', { ...sold, priceCents: null }, 'free'],
    ['tier-gated', { ...sold, isTierGated: true }, 'subscribers'],
    [
      'orgless with a tier, before every other flag',
      {
        ...sold,
        organizationId: null,
        isTierGated: true,
        courseOnly: true,
        isTeamOnly: true,
      },
      'orgless_tier_gate',
    ],
    ['orgless paid', { ...sold, organizationId: null }, 'paid'],
    [
      'course-only, before team-only',
      { ...sold, courseOnly: true, isTeamOnly: true },
      'course_only',
    ],
    [
      'team-only, before followers-only',
      { ...sold, isTeamOnly: true, isFollowerGated: true },
      'team_only',
    ],
    [
      'followers-only, before the tier',
      { ...sold, isFollowerGated: true, isTierGated: true },
      'followers_only',
    ],
  ] as const)('%s', (_name, c, branch) => {
    expect(contentAccessBranch(c)).toBe(branch);
  });
});

describe('isContentReleased (published now, or once)', () => {
  it.each([
    ['published', { status: 'published', publishedAt: RELEASED }, true],
    [
      'published, with no date yet',
      { status: 'published', publishedAt: null },
      true,
    ],
    [
      'unpublished after release',
      { status: 'draft', publishedAt: RELEASED },
      true,
    ],
    [
      'archived after release',
      { status: 'archived', publishedAt: RELEASED },
      true,
    ],
    ['a draft never released', { status: 'draft', publishedAt: null }, false],
    // Not `hasBeenLive`, which counts this one.
    [
      'archived, never released',
      { status: 'archived', publishedAt: null },
      false,
    ],
  ] as const)('%s', (_name, c, released) => {
    expect(isContentReleased(c)).toBe(released);
  });
});

describe('contentRefusesBuyers (owner D54, "match access exactly")', () => {
  it.each([
    ['paid, published', sold],
    ['orgless paid, published', { ...sold, organizationId: null }],
    ['paid, unpublished after release', { ...sold, status: 'draft' }],
    ['paid, archived after release', { ...sold, status: 'archived' }],
    ['subscribers, bought', { ...sold, isTierGated: true }],
    [
      'subscribers, unpublished after release',
      { ...sold, isTierGated: true, status: 'draft' },
    ],
    ['free, published', { ...sold, priceCents: 0 }],
  ])('lets a buyer in: %s', (_name, c) => {
    expect(contentRefusesBuyers(c)).toBe(false);
  });

  it.each([
    ['deleted', { ...sold, deletedAt: new Date() }],
    ['deleted, as a string date', { ...sold, deletedAt: RELEASED }],
    ['its organisation deleted', { ...sold, organizationDeleted: true }],
    [
      'detached (migration 0004: a draft with no published_at)',
      { ...sold, organizationId: null, status: 'draft', publishedAt: null },
    ],
    ['a draft never released', { ...sold, status: 'draft', publishedAt: null }],
    [
      'archived, never released',
      { ...sold, status: 'archived', publishedAt: null },
    ],
    ['team-only', { ...sold, isTeamOnly: true }],
    ['course-only', { ...sold, courseOnly: true }],
    ['followers-only', { ...sold, isFollowerGated: true }],
    [
      'orgless with a tier',
      { ...sold, organizationId: null, isTierGated: true },
    ],
    [
      'free, unpublished after release',
      { ...sold, priceCents: 0, status: 'draft' },
    ],
    [
      'free, archived after release',
      { ...sold, priceCents: 0, status: 'archived' },
    ],
    // Gone outranks every branch: a deleted org's free or paid item alike.
    [
      'free, published, its organisation deleted',
      { ...sold, priceCents: 0, organizationDeleted: true },
    ],
    // Leaving (Codex-a6ofh.6.3): the paid and tier arms open to a buyer
    // published or withdrawn, so without the leaving check a checkout opened
    // before the delete would be charged and kept.
    ['paid, leaving', { ...sold, status: 'archived', leavesAt: LEAVES }],
    [
      'paid, leaving, as a Date',
      { ...sold, status: 'archived', leavesAt: new Date(LEAVES) },
    ],
    [
      'subscribers, leaving',
      { ...sold, isTierGated: true, status: 'archived', leavesAt: LEAVES },
    ],
  ])('refuses a buyer: %s', (_name, c) => {
    expect(contentRefusesBuyers(c)).toBe(true);
  });
});

describe('BRANCH_BUYERS (agreed with payments for the leaving notice, D2)', () => {
  // The agreed table, written out: a change to either column is a change to
  // what a buyer is charged for or what an owner keeps, so it fails here.
  const agreed: Record<
    ContentAccessBranch,
    { newBuyer: string; owner: string }
  > = {
    orgless_tier_gate: { newBuyer: 'refused', owner: 'refused' },
    course_only: { newBuyer: 'refused', owner: 'kept' },
    team_only: { newBuyer: 'refused', owner: 'kept' },
    followers_only: { newBuyer: 'refused', owner: 'kept' },
    subscribers: { newBuyer: 'opens', owner: 'kept' },
    paid: { newBuyer: 'opens', owner: 'kept' },
    free: { newBuyer: 'opens_while_published', owner: 'kept' },
  };

  it('is the agreed table', () => {
    expect(BRANCH_BUYERS).toEqual(agreed);
  });

  it.each(
    Object.entries(agreed) as Array<[ContentAccessBranch, { owner: string }]>
  )('ownerKeepsInBranch(%s) reads the owner column', (branch, row) => {
    expect(ownerKeepsInBranch(branch)).toBe(row.owner === 'kept');
  });
});

describe('courseRefusesBuyers (the course dashboard’s read, Codex-z1t3c)', () => {
  /** Published, in a live org. Each case overrides what it needs. */
  const bought: CourseBuyerFacts = {
    status: 'published',
    publishedAt: RELEASED,
    deletedAt: null,
    organizationDeleted: false,
  };

  it.each([
    ['published', bought],
    ['a legacy published row with no date', { ...bought, publishedAt: null }],
    ['unpublished after release', { ...bought, status: 'draft' }],
    [
      'archived (taken off sale) after release',
      { ...bought, status: 'archived' },
    ],
  ])('lets a buyer in: %s', (_name, c) => {
    expect(courseRefusesBuyers(c)).toBe(false);
  });

  it.each([
    ['its organisation deleted', { ...bought, organizationDeleted: true }],
    ['deleted', { ...bought, deletedAt: new Date() }],
    ['deleted, as a string date', { ...bought, deletedAt: RELEASED }],
    [
      'a draft never released',
      { ...bought, status: 'draft', publishedAt: null },
    ],
    [
      'archived, never released',
      { ...bought, status: 'archived', publishedAt: null },
    ],
  ])('refuses a buyer: %s', (_name, c) => {
    expect(courseRefusesBuyers(c)).toBe(true);
  });
});
