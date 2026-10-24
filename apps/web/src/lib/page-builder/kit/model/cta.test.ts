import { describe, expect, it } from 'vitest';
import * as m from '$paraglide/messages';
import { deriveOfferPaths } from '../../offer-paths';
import { COPY } from './copy';
import { isEnrolled, pathHref, pausedLine, resolvePrimaryCta } from './cta';
import { pricingView } from './offer';
import { sampleContext, sampleOffer } from './sample';

describe('resolvePrimaryCta — every state has a next step', () => {
  it('sends a visitor who can buy to the checkout, with their label', () => {
    const context = sampleContext({ offer: 'buy' });
    expect(resolvePrimaryCta(context, 'Start the course')).toEqual({
      state: 'buy',
      href: context.checkoutUrl,
      label: 'Start the course',
    });
  });

  it('falls back to "Join now" for an empty or blank label', () => {
    const context = sampleContext({ offer: 'buy' });
    expect(resolvePrimaryCta(context).label).toBe(COPY.cta.buy);
    expect(resolvePrimaryCta(context, '   ').label).toBe(COPY.cta.buy);
  });

  it('keeps the buy button when the offer read FAILED (null is not "no way in")', () => {
    const context = sampleContext({ offer: 'unknown' });
    expect(context.offer).toBeNull();
    expect(resolvePrimaryCta(context).state).toBe('buy');
  });

  it('says "Continue" to a member, whatever the authored label', () => {
    const context = sampleContext({ offer: 'enrolled' });
    expect(resolvePrimaryCta(context, 'Buy it now')).toEqual({
      state: 'continue',
      href: context.dashboardUrl,
      label: COPY.cta.continue,
    });
  });

  it('treats an entitled offer as enrolled even when the context flag is false', () => {
    const context = {
      ...sampleContext({ offer: 'buy' }),
      offer: sampleOffer('enrolled'),
    };
    expect(context.enrolled).toBe(false);
    expect(isEnrolled(context)).toBe(true);
    expect(resolvePrimaryCta(context).state).toBe('continue');
  });

  it('gives a course with no way in an explicit notice and no link', () => {
    const cta = resolvePrimaryCta(
      sampleContext({ offer: 'unavailable' }),
      'Join'
    );
    expect(cta.state).toBe('unavailable');
    expect(cta.href).toBeUndefined();
    expect(cta.label).toBe(COPY.cta.unavailableTitle);
  });

  it('never emits a script URL', () => {
    const context = {
      ...sampleContext({ offer: 'buy' }),
      checkoutUrl: 'javascript:alert(1)',
    };
    expect(resolvePrimaryCta(context).href).toBe('#');
  });
});

describe('pathHref', () => {
  it('deep-links the checkout to exactly one real path', () => {
    const context = sampleContext({ offer: 'tiers' });
    const [path] = deriveOfferPaths(context.offer, context.course);
    expect(pathHref(context, path)).toBe(
      `${context.checkoutUrl}?offer=purchase`
    );
  });
});

// A disputed owner (Codex-2hxff.60): the owner's "no Buy while disputed". The
// refused can-enter's hold turns every Buy and Join slot into the content
// page's dispute notice; nothing on the page links to the checkout.
describe('a disputed owner', () => {
  const paused = (hold: 'purchase_dispute' | 'subscription_dispute') => ({
    ...sampleContext({ offer: 'buy' }),
    disputeHold: hold,
  });

  it('gets the paused notice and no link, whatever the authored label', () => {
    const cta = resolvePrimaryCta(paused('purchase_dispute'), 'Join');
    expect(cta).toEqual({ state: 'paused', label: COPY.cta.pausedTitle });
    expect(cta.href).toBeUndefined();
  });

  it('is offered no price or path in the pricing view', () => {
    expect(pricingView(paused('subscription_dispute'), {})).toEqual({
      state: 'paused',
      paths: [],
      featured: null,
      others: [],
    });
  });

  it('an entry that is granted still continues: the hold only explains a refusal', () => {
    const context = {
      ...sampleContext({ offer: 'enrolled' }),
      disputeHold: 'purchase_dispute' as const,
    };
    expect(resolvePrimaryCta(context).state).toBe('continue');
    expect(pricingView(context, {}).state).toBe('enrolled');
  });

  it('names the payment the dispute is on', () => {
    expect(pausedLine('purchase_dispute')).toBe(COPY.cta.pausedPurchase);
    expect(pausedLine('subscription_dispute')).toBe(
      COPY.cta.pausedSubscription
    );
  });

  // The kit's copy stays English by contract A20; these are the content
  // page's paraglide strings, word for word.
  it('says exactly what the content page says', () => {
    expect(COPY.cta.pausedTitle).toBe(m.access_paused_dispute_title());
    expect(COPY.cta.pausedPurchase).toBe(m.access_paused_dispute_purchase());
    expect(COPY.cta.pausedSubscription).toBe(
      m.access_paused_dispute_subscription()
    );
    expect(COPY.cta.contactSupport).toBe(m.access_contact_support());
  });
});
