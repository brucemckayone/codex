import { describe, expect, it } from 'vitest';
// Through the package index: access and purchase completion import them there.
import {
  type ContentBuyerFacts,
  contentAccessBranch,
  contentRefusesBuyers,
  isContentReleased,
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
};

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
  ])('refuses a buyer: %s', (_name, c) => {
    expect(contentRefusesBuyers(c)).toBe(true);
  });
});
