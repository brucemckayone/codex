import { describe, expect, test } from 'vitest';
import { ownsColours } from './atmosphere-still';

describe('a page that owns its colours', () => {
  test('sets a brand colour the page paints', () => {
    expect(ownsColours({ primaryColor: '#3355ff' })).toBe(true);
    expect(ownsColours({ secondaryColor: ' #334455 ' })).toBe(true);
  });

  test('not fonts alone, nor a colour the page does not paint', () => {
    expect(ownsColours(null)).toBe(false);
    expect(ownsColours({ fontBody: 'Inter' })).toBe(false);
    // Owner, Codex-mik4h: "Same rule as backgrounds". The org's colours paint.
    expect(ownsColours({ primaryColor: 'oklch(0.6 0.4 0)' })).toBe(false);
  });
});
