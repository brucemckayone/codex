import { describe, expect, it } from 'vitest';
import { getInitials } from '../initials';

describe('getInitials', () => {
  it('takes first chars of first two name segments', () => {
    expect(getInitials('Alex Creator', 'a@b.com')).toBe('AC');
  });

  it('falls back to email, splitting on @ for two segments', () => {
    expect(getInitials(null, 'alice@example.com')).toBe('AE');
  });

  it('returns ? when both name and email are null', () => {
    expect(getInitials(null, null)).toBe('?');
  });

  it('handles single-word name', () => {
    expect(getInitials('A', null)).toBe('A');
  });

  it('handles surrounding and interior whitespace', () => {
    expect(getInitials('  Alex  Bob ', 'x@y')).toBe('AB');
  });
});
