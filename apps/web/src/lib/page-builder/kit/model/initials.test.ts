import { describe, expect, it } from 'vitest';
import { initials } from './initials';

describe('initials', () => {
  it.each([
    ['Maya Linden', 'ML'],
    ['Nell Ashworth', 'NA'],
    ['Maya', 'M'],
    ['Mary Ann Smith', 'MS'],
    ['  maya   linden  ', 'ML'],
    ['Élodie Dupré', 'ÉD'],
    ['(Dr) Kate O’Neill', 'DO'],
  ])('%s → %s', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });

  it('is empty when the name has no letter', () => {
    expect(initials(undefined)).toBe('');
    expect(initials('   ')).toBe('');
    expect(initials('42 · —')).toBe('');
  });
});
