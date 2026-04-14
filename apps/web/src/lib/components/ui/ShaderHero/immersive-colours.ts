/**
 * Shared immersive colour cycling utility.
 *
 * Produces time-based sinusoidal colour drifting across brand palette,
 * complementary, warm, and cool tones. Audio gently nudges the phase
 * but doesn't hard-drive changes. Used by all audio-reactive renderers.
 *
 * Returns new colour arrays ready for gl.uniform3f() / gl.uniform3fv().
 */

type RGB = [number, number, number];

interface BrandColours {
  primary: RGB | number[];
  secondary: RGB | number[];
  accent: RGB | number[];
  bg: RGB | number[];
}

interface ImmersiveColours {
  primary: [number, number, number];
  secondary: [number, number, number];
  accent: [number, number, number];
  bg: [number, number, number];
}

function mix3(
  a: number[] | RGB,
  b: number[] | RGB,
  t: number
): [number, number, number] {
  const u = 1 - t;
  return [a[0] * u + b[0] * t, a[1] * u + b[1] * t, a[2] * u + b[2] * t];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Fixed palette targets for drifting
const WARM: RGB = [0.95, 0.6, 0.3];
const COOL: RGB = [0.3, 0.5, 0.95];

export function computeImmersiveColours(
  time: number,
  base: BrandColours,
  amplitude: number
): ImmersiveColours {
  const p = base.primary;
  const s = base.secondary;
  const a = base.accent;
  const bg = base.bg;

  // Slow oscillating phases — each colour drifts at a different rate
  const phase1 = Math.sin(time * 0.3) * 0.5 + 0.5;
  const phase2 = Math.sin(time * 0.2 + 2.1) * 0.5 + 0.5;
  const phase3 = Math.sin(time * 0.15 + 4.2) * 0.5 + 0.5;
  const bgPhase = Math.sin(time * 0.1) * 0.5 + 0.5;

  // Audio gently nudges phase offset
  const shift = amplitude * 0.2;

  // Primary → accent → complement
  const comp: RGB = [1 - p[0], 1 - p[1], 1 - p[2]];
  const mix1 = phase1 + shift;
  const target1 = mix3(a, comp, 0.4);
  const primary = mix3(p, target1, mix1) as [number, number, number];

  // Secondary → primary → warm
  const mix2 = phase2 + shift;
  const target2 = mix3(p, WARM, 0.5);
  const secondary = mix3(s, target2, mix2) as [number, number, number];

  // Accent → cool → secondary
  const mix3val = phase3 + shift;
  const target3 = mix3(COOL, s, 0.4);
  const accent = mix3(a, target3, mix3val) as [number, number, number];

  // Background: slow subtle tonal shift
  const bgOut: [number, number, number] = [
    clamp01(bg[0] + bgPhase * 0.08),
    clamp01(bg[1] + bgPhase * 0.04),
    clamp01(bg[2] + bgPhase * 0.06),
  ];

  return { primary, secondary, accent, bg: bgOut };
}
