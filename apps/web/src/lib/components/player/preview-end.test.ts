/**
 * The preview's end screen offers what the paywall under it offers
 * (Codex-2hxff.99): the lock's own line, then the paywall's first action, in
 * the content page's gate-chain order. Manage plan and "or purchase for" stay
 * in the paywall (owner: "Plan button only").
 *
 * How the page works the gate out, and the end screen as it mounts there,
 * are pinned in `ContentDetailView.svelte.test.ts`.
 */

import { describe, expect, test } from 'vitest';
import * as m from '$paraglide/messages';
import { describePreviewEnd, type PreviewEndGate } from './preview-end';

const PRICING = '/pricing?for=winter-light&returnTo=%2Fcontent%2Fwinter-light';
const SIGN_IN = '/login?redirect=%2Fcontent%2Fwinter-light';

const gate = (over: Partial<PreviewEndGate> = {}): PreviewEndGate => ({
  line: 'The lock’s own line.',
  isAuthenticated: true,
  organizationId: 'org-1',
  hasSubscription: false,
  upgradeOnly: false,
  accessCheckFailed: false,
  isTeamOnly: false,
  isCourseOnly: false,
  isFollowersOnly: false,
  isClosed: false,
  needsSubscription: false,
  needsPurchase: false,
  isFree: false,
  pricingHref: PRICING,
  signInHref: SIGN_IN,
  purchaseLabel: 'Purchase for £4.99',
  ...over,
});

describe('the line', () => {
  test('is the lock’s own, whatever the action', () => {
    expect(describePreviewEnd(gate({ needsPurchase: true })).line).toBe(
      'The lock’s own line.'
    );
    expect(describePreviewEnd(gate({ isTeamOnly: true })).line).toBe(
      'The lock’s own line.'
    );
  });

  test('stays empty while the plan names load', () => {
    expect(
      describePreviewEnd(gate({ line: null, needsSubscription: true })).line
    ).toBeNull();
  });
});

describe('nothing to offer', () => {
  test.each([
    ['no verdict', { accessCheckFailed: true, needsPurchase: true }],
    ['team only', { isTeamOnly: true, needsPurchase: true }],
    ['course only', { isCourseOnly: true, needsPurchase: true }],
    ['closed with no price', { isClosed: true }],
    [
      'a plan, but no org to subscribe in',
      { needsSubscription: true, organizationId: null },
    ],
    ['free, signed in', { isFree: true }],
  ])('%s: no button', (_label, over) => {
    const end = describePreviewEnd(gate(over));
    expect(end.action).toEqual({ kind: 'none' });
    expect(end.signIn).toBeNull();
  });
});

describe('a plan', () => {
  test('signed in with none: the paywall’s Subscribe, to pricing with the item marked', () => {
    expect(
      describePreviewEnd(gate({ needsSubscription: true })).action
    ).toEqual({
      kind: 'plan',
      organizationId: 'org-1',
      subscribeHref: PRICING,
      upgradeRequired: false,
      changePlan: true,
    });
  });

  test('on a plan every including plan beats on price: Upgrade', () => {
    const { action } = describePreviewEnd(
      gate({
        needsSubscription: true,
        hasSubscription: true,
        upgradeOnly: true,
      })
    );
    expect(action).toMatchObject({
      kind: 'plan',
      upgradeRequired: true,
      changePlan: false,
    });
  });

  test('on a plan a cheaper one beats: Change plan', () => {
    const { action } = describePreviewEnd(
      gate({ needsSubscription: true, hasSubscription: true })
    );
    expect(action).toMatchObject({
      kind: 'plan',
      upgradeRequired: true,
      changePlan: true,
    });
  });

  test('signed out: See plans, with the item marked, and Sign in beside Watch again', () => {
    const end = describePreviewEnd(
      gate({ needsSubscription: true, isAuthenticated: false })
    );
    expect(end.action).toEqual({
      kind: 'link',
      href: PRICING,
      label: m.subscribe_cta_see_plans(),
    });
    expect(end.signIn).toEqual({ href: SIGN_IN, label: m.auth_signin_link() });
  });
});

describe('a purchase', () => {
  test('signed in: Buy, with the price on the button', () => {
    expect(describePreviewEnd(gate({ needsPurchase: true })).action).toEqual({
      kind: 'buy',
      label: 'Purchase for £4.99',
    });
  });

  test('signed out: Sign in to purchase', () => {
    const end = describePreviewEnd(
      gate({ needsPurchase: true, isAuthenticated: false })
    );
    expect(end.action).toEqual({
      kind: 'link',
      href: '/login',
      label: m.checkout_signin_to_purchase(),
    });
    expect(end.signIn).toBeNull();
  });
});

describe('followers only', () => {
  test('signed in: Follow', () => {
    expect(describePreviewEnd(gate({ isFollowersOnly: true })).action).toEqual({
      kind: 'follow',
    });
  });

  test('signed out: the paywall’s own sign-in', () => {
    expect(
      describePreviewEnd(
        gate({ isFollowersOnly: true, isAuthenticated: false })
      ).action
    ).toEqual({
      kind: 'link',
      href: '/login',
      label: m.checkout_signin_to_purchase(),
    });
  });
});

test('free, signed out: Sign in to watch', () => {
  expect(
    describePreviewEnd(gate({ isFree: true, isAuthenticated: false })).action
  ).toEqual({
    kind: 'link',
    href: '/login',
    label: m.content_detail_signin_watch_cta(),
  });
});

describe('in the paywall’s order', () => {
  test.each([
    [
      'no verdict before a plan',
      { accessCheckFailed: true, needsSubscription: true },
      'none',
    ],
    [
      'team only before followers',
      { isTeamOnly: true, isFollowersOnly: true },
      'none',
    ],
    [
      'followers before a plan',
      { isFollowersOnly: true, needsSubscription: true },
      'follow',
    ],
    [
      'closed before a purchase',
      { isClosed: true, needsPurchase: true },
      'none',
    ],
    [
      'a plan before a purchase',
      { needsSubscription: true, needsPurchase: true },
      'plan',
    ],
  ])('%s', (_label, over, kind) => {
    expect(describePreviewEnd(gate(over)).action.kind).toBe(kind);
  });
});
