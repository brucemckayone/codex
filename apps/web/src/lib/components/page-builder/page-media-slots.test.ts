import { describe, expect, it } from 'vitest';
import { SLOT_ACCEPTS } from '$lib/page-builder/sell-media-store.svelte';
import {
  PAGE_MEDIA_SLOTS,
  panelSlotsNamed,
  RETIRED_MEDIA_SLOTS,
} from './page-media-slots';

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

describe('the slots a publish refused over deleted media names (Codex-6sbn1)', () => {
  const named = (names: string[]) =>
    panelSlotsNamed(names).map((entry) => entry.slot);

  it('maps each course slot to the panel slot that holds it', () => {
    expect(named(['intro'])).toEqual(['introVideoMediaId']);
    expect(named(['reel'])).toEqual(['previewVideoMediaId']);
    expect(named(['guide_video'])).toEqual(['guideVideoMediaId']);
    expect(named(['hero'])).toEqual(['heroMediaId']);
    expect(named(['guide_portrait'])).toEqual(['guidePortraitMediaId']);
  });

  it('answers in panel order, each once, and drops a name it does not know', () => {
    expect(named(['reel', 'hero', 'reel', 'signature', 'toString'])).toEqual([
      'heroMediaId',
      'previewVideoMediaId',
    ]);
  });
});
