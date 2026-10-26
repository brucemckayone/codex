import { describe, expect, it } from 'vitest';
import * as m from '$paraglide/messages';
import {
  formatAgreementShare,
  isShareMissing,
  MISSING_SHARE,
  spokenAgreementShare,
} from './agreement-share';

describe('formatAgreementShare', () => {
  it('formats basis points as a percentage', () => {
    expect(formatAgreementShare(4000)).toBe('40%');
    expect(formatAgreementShare(3250)).toBe('32.5%');
    expect(formatAgreementShare(10000)).toBe('100%');
  });

  it('a real 0 share is "0%"', () => {
    expect(formatAgreementShare(0)).toBe('0%');
  });

  it('a missing share is an em dash, never "0%"', () => {
    expect(MISSING_SHARE).toBe('—');
    expect(formatAgreementShare(null)).toBe('—');
    expect(formatAgreementShare(undefined)).toBe('—');
  });
});

describe('isShareMissing', () => {
  it('is true for null and for undefined (an older payload), so a pie never draws either', () => {
    expect(isShareMissing(null)).toBe(true);
    expect(isShareMissing(undefined)).toBe(true);
  });

  it('is false for any recorded share, 0 included', () => {
    expect(isShareMissing(0)).toBe(false);
    expect(isShareMissing(4000)).toBe(false);
  });
});

describe('spokenAgreementShare', () => {
  it('says "No share recorded" where the screen shows a dash', () => {
    expect(spokenAgreementShare(null)).toBe(m.agreement_share_missing());
    expect(spokenAgreementShare(undefined)).toBe(m.agreement_share_missing());
  });

  it('reads a recorded share as its percentage', () => {
    expect(spokenAgreementShare(4000)).toBe('40%');
  });
});
