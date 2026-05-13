/**
 * Tests for the Stripe Connect requirement humanization map.
 *
 * Lives under `__tests__` (vitest pattern; matches the rest of the package).
 */

import { describe, expect, it } from 'vitest';
import {
  humanizeRequirement,
  isKnownRequirement,
  REQUIREMENT_HUMANIZATION,
} from '../requirement-humanization';

describe('REQUIREMENT_HUMANIZATION', () => {
  it('covers the top common Stripe Connect requirement fields', () => {
    // Sample the categories listed in the bead — every entry MUST be present
    // so the studio UI never falls back to a raw dotted path for the common
    // cases.
    const requiredKeys = [
      // Business profile
      'business_profile.url',
      'business_profile.product_description',
      'business_profile.support_email',
      // Company
      'company.name',
      'company.tax_id',
      'company.address.line1',
      'company.verification.document',
      // Individual
      'individual.first_name',
      'individual.last_name',
      'individual.dob.day',
      'individual.address.line1',
      // External account
      'external_account',
      // Terms of service
      'tos_acceptance.date',
      'tos_acceptance.ip',
    ];

    for (const key of requiredKeys) {
      expect(REQUIREMENT_HUMANIZATION).toHaveProperty(key);
      expect(REQUIREMENT_HUMANIZATION[key]).toBeTruthy();
    }
  });
});

describe('humanizeRequirement', () => {
  it('returns the mapped label for a known field path', () => {
    expect(humanizeRequirement('business_profile.url')).toBe(
      'Business website URL'
    );
    expect(humanizeRequirement('individual.dob.day')).toBe(
      'Date of birth (day)'
    );
    expect(humanizeRequirement('external_account')).toBe(
      'Bank account or debit card for payouts'
    );
  });

  it('falls back to the raw path for an unknown field', () => {
    // Unknown fields MUST surface as-is so the operator can paste them into
    // Stripe Dashboard. Anything else (e.g. throwing or returning '') would
    // mask the failure.
    const unknown = 'some_future_stripe_field.subfield.unknown';
    expect(humanizeRequirement(unknown)).toBe(unknown);
  });

  it('handles empty string gracefully', () => {
    expect(humanizeRequirement('')).toBe('');
  });
});

describe('isKnownRequirement', () => {
  it('returns true for a mapped field', () => {
    expect(isKnownRequirement('business_profile.url')).toBe(true);
  });

  it('returns false for an unmapped field', () => {
    expect(isKnownRequirement('newly.added.stripe.field')).toBe(false);
  });
});
