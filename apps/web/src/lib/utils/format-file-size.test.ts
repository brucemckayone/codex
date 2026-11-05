import { describe, expect, it } from 'vitest';
import { formatFileSize } from './format';

describe('formatFileSize', () => {
  it('reads nothing as nothing', () => {
    expect(formatFileSize(0)).toBe('');
    expect(formatFileSize(null)).toBe('');
  });

  it('steps KB, then MB, then GB at each 1024', () => {
    expect(formatFileSize(512 * 1024)).toBe('512 KB');
    expect(formatFileSize(210 * 1024 * 1024)).toBe('210.0 MB');
    expect(formatFileSize(1024 ** 3 - 1)).toBe('1024.0 MB');
    expect(formatFileSize(1024 ** 3)).toBe('1.0 GB');
    // The mockup's library total (M1): "6.4 GB", never "6553.6 MB".
    expect(formatFileSize(6.4 * 1024 ** 3)).toBe('6.4 GB');
  });
});
