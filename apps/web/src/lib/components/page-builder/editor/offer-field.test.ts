/**
 * An `offer` field's choices (Codex-61zsk.14): the page's live ways in, from
 * the derivation the pricing block draws, and a stored id that is no longer
 * one of them kept and named.
 */
import { describe, expect, it } from 'vitest';
import { sampleOffer } from '$lib/page-builder/kit/model/sample';
import { deriveOfferPaths } from '$lib/page-builder/offer-paths';
import { offerOptions } from './offer-field';

const PATHS = deriveOfferPaths(sampleOffer('tiers'), { title: 'Quiet Hours' });

describe('offerOptions', () => {
  it('offers every live way in, by id, named by its name and price', () => {
    expect(offerOptions(PATHS, undefined)).toEqual(
      PATHS.map((path) => ({
        value: path.id,
        label: `${path.name} · ${path.priceLabel} ${path.cadenceLabel}`,
      }))
    );
    // Calibrated: the sample offer has a purchase and two tiers.
    expect(PATHS.map((path) => path.id)).toEqual([
      'purchase',
      'tier:studio',
      'tier:circle',
    ]);
  });

  it('adds nothing for an id that is one of them, or for none', () => {
    expect(offerOptions(PATHS, 'tier:circle')).toHaveLength(PATHS.length);
    expect(offerOptions(PATHS, '')).toHaveLength(PATHS.length);
  });

  it('keeps a stored id the offer no longer has, last, named as such', () => {
    const options = offerOptions(PATHS, 'subscription-monthly');
    expect(options).toHaveLength(PATHS.length + 1);
    expect(options.at(-1)).toEqual({
      value: 'subscription-monthly',
      label: 'No longer one of your options',
    });
  });

  it('offers only the stored id when the page has no way in left', () => {
    expect(offerOptions([], 'purchase')).toEqual([
      { value: 'purchase', label: 'No longer one of your options' },
    ]);
    expect(offerOptions([], undefined)).toEqual([]);
  });
});
