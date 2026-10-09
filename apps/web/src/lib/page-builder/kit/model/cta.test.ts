import { describe, expect, it } from 'vitest';
import { deriveOfferPaths } from '../../offer-paths';
import { COPY } from './copy';
import { isEnrolled, pathHref, resolvePrimaryCta } from './cta';
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
