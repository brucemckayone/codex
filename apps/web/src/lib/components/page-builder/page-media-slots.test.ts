import { describe, expect, it } from 'vitest';
import { SLOT_ACCEPTS } from '$lib/page-builder/sell-media-store.svelte';
import { PAGE_MEDIA_SLOTS, RETIRED_MEDIA_SLOTS } from './page-media-slots';

const offered = PAGE_MEDIA_SLOTS.map((entry) => entry.slot);

describe('the Media panel’s library slots', () => {
  it('offers or retires every slot the store knows: none is left to an inspector alone, none is both', () => {
    const known = Object.keys(SLOT_ACCEPTS).sort();
    expect([...offered, ...RETIRED_MEDIA_SLOTS].sort()).toEqual(known);
    expect(
      offered.filter((slot) => RETIRED_MEDIA_SLOTS.includes(slot))
    ).toEqual([]);
  });

  it('retires the Signature film: only an uploaded mark is a signature (Codex-61zsk.47)', () => {
    expect(RETIRED_MEDIA_SLOTS).toEqual(['signatureMediaId']);
    expect(offered).not.toContain('signatureMediaId');
  });

  it('walks the page in order, the hero first, each slot named once with its hint', () => {
    expect(offered).toEqual([
      'heroMediaId',
      'introVideoMediaId',
      'previewVideoMediaId',
      'guidePortraitMediaId',
      'guideVideoMediaId',
    ]);
    for (const entry of PAGE_MEDIA_SLOTS) {
      expect(entry.label(), entry.slot).not.toBe('');
      expect(entry.hint(), entry.slot).not.toBe('');
    }
  });
});
