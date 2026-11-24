import { describe, expect, it } from 'vitest';
import {
  IMMERSIVE_FALLBACK_PRESET,
  immersivePreset,
  noShaderPlays,
} from './immersive-preset';

/**
 * What immersive mode paints for an audio piece (owner, 2026-11-19): the
 * piece's own shader, else the org's brand shader, else flow. It used to fall
 * back to a fixed 'nebula' — one of the 25 presets cut that day.
 */
describe('immersivePreset', () => {
  it("uses the piece's own shader when it has one, over the brand's", () => {
    expect(immersivePreset('lava', 'ink')).toBe('lava');
    expect(immersivePreset('lava', null)).toBe('lava');
  });

  it("paints a piece's cut shader as its survivor", () => {
    expect(immersivePreset('nebula', 'ink')).toBe('aurora');
  });

  it("uses the org's brand shader when the piece has none", () => {
    expect(immersivePreset(null, 'ink')).toBe('ink');
    expect(immersivePreset(undefined, 'ink')).toBe('ink');
    expect(immersivePreset('', 'ink')).toBe('ink');
    expect(immersivePreset('none', 'ink')).toBe('ink');
    // An id naming no preset is no shader of its own.
    expect(immersivePreset('bogus', 'ink')).toBe('ink');
  });

  it("paints the brand's cut shader as its survivor", () => {
    expect(immersivePreset(null, 'warp')).toBe('suture');
  });

  it('falls back to flow when neither the piece nor the org has a shader', () => {
    expect(IMMERSIVE_FALLBACK_PRESET).toBe('flow');
    expect(immersivePreset(null, null)).toBe('flow');
    expect(immersivePreset('none', 'none')).toBe('flow');
    expect(immersivePreset(null, 'bogus')).toBe('flow');
  });
});

/** The studio's copy for a piece with no shader, from what actually plays. */
describe('noShaderPlays', () => {
  it("says the brand's shader where the brand has one, a cut one included", () => {
    expect(noShaderPlays('ink')).toBe("your brand's shader");
    expect(noShaderPlays('nebula')).toBe("your brand's shader");
    // The brand's shader is flow: still the brand's.
    expect(noShaderPlays('flow')).toBe("your brand's shader");
  });

  it('names Flow where the brand has none', () => {
    expect(noShaderPlays(null)).toBe('Flow');
    expect(noShaderPlays('none')).toBe('Flow');
    expect(noShaderPlays('bogus')).toBe('Flow');
  });
});
