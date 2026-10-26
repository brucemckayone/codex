import { describe, expect, it } from 'vitest';
import { formatAgreementShare, MISSING_SHARE } from './agreement-share';

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
