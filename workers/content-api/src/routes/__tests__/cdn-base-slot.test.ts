/**
 * A cached payload built from the CDN base is keyed on it (Codex-yjyju), and a
 * missing base is warned about rather than sent as silent null covers.
 */

import { describe, expect, it, vi } from 'vitest';
import { cdnBaseSlot, warnOnMissingCdnBase } from '../cdn-base-slot';

const PROD = 'https://cdn-assets.revelations.studio';

describe('cdnBaseSlot', () => {
  it('names the same base the same slot', () => {
    expect(cdnBaseSlot(PROD)).toBe(cdnBaseSlot(PROD));
  });

  it('names a different base, a wrong one included, a different slot', () => {
    const slots = new Set([
      cdnBaseSlot(PROD),
      cdnBaseSlot('https://cdn-assets.revelations.studi'),
      cdnBaseSlot('http://localhost:4100'),
      cdnBaseSlot(undefined),
    ]);

    expect(slots.size).toBe(4);
  });

  it('names no base, and an empty one, cdn:none', () => {
    expect(cdnBaseSlot(undefined)).toBe('cdn:none');
    expect(cdnBaseSlot('')).toBe('cdn:none');
  });

  it('carries a short hash, never the URL', () => {
    expect(cdnBaseSlot(PROD)).toMatch(/^cdn:[0-9a-f]{1,8}$/);
  });
});

describe('warnOnMissingCdnBase', () => {
  it('warns, naming the read, when no base is set', () => {
    const obs = { warn: vi.fn() };

    warnOnMissingCdnBase(undefined, obs as never, 'public:topics');

    expect(obs.warn).toHaveBeenCalledWith('r2_public_base.missing', {
      read: 'public:topics',
      assetsBaseSet: false,
    });
  });

  it('says nothing when the base is set', () => {
    const obs = { warn: vi.fn() };

    warnOnMissingCdnBase(PROD, obs as never, 'public:topics');

    expect(obs.warn).not.toHaveBeenCalled();
  });
});
