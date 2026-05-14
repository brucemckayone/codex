import { describe, expect, it } from 'vitest';
import { escapeCsvField } from '../csv-export';

describe('escapeCsvField', () => {
  it('returns empty string unchanged', () => {
    expect(escapeCsvField('')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(escapeCsvField('hello')).toBe('hello');
  });

  it('wraps values containing a comma in quotes', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
  });

  it('doubles internal quotes and wraps in quotes', () => {
    expect(escapeCsvField('a"b')).toBe('"a""b"');
  });

  it('wraps values containing a newline in quotes', () => {
    expect(escapeCsvField('a\nb')).toBe('"a\nb"');
  });
});
