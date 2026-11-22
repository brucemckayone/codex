/**
 * A slider's default is what the hero paints when the brand stored nothing
 * The editor shows HERO_FX_DEFAULTS until a value is
 * stored, and drops an override set back to it; the hero paints
 * shader-config's DEFAULTS. When the two differ, the slider shows one value
 * while the page paints another, and moving it back to "default" stores a
 * value the page never had.
 *
 * Checked for the presets reworked so far; each later rework joins the list.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { LIVE_PRESET_IDS } from '$lib/components/ui/ShaderHero/preset-fx-defaults';
import { getShaderConfig } from '$lib/components/ui/ShaderHero/shader-config';
import { HERO_FX_PRESET_CONTROLS, presetFxControls } from './hero-fx-controls';
import { updateOverride } from './hero-fx-helpers';
import { HERO_FX_DEFAULTS } from './hero-fx-presets';

/** Each control key, and the config field the hero reads it into. */
const FIELDS: Record<string, Record<string, string>> = {
  topo: {
    'shader-topo-line-count': 'lineCount',
    'shader-topo-line-width': 'lineWidth',
    'shader-topo-speed': 'speed',
    'shader-topo-scale': 'scale',
    'shader-topo-elevation': 'elevation',
    'shader-topo-octaves': 'octaves',
  },
  ether: {
    'shader-rotation-speed': 'rotationSpeed',
    'shader-complexity': 'complexity',
    'shader-zoom': 'zoom',
    'shader-glow': 'glow',
    'shader-scale': 'scale',
    'shader-aberration': 'aberration',
  },
  ink: {
    'shader-ink-diffusion': 'diffusion',
    'shader-ink-advection': 'advection',
    'shader-ink-drop-size': 'dropSize',
    'shader-ink-evaporation': 'evaporation',
    'shader-ink-curl': 'curl',
  },
  // Liquid Logo. Its colour picker is gone, so six sliders map six fields.
  pulse: {
    'shader-pulse-damping': 'damping',
    'shader-wave-scale': 'waveScale',
    'shader-cam-height': 'camHeight',
    'shader-cam-target': 'camTarget',
    'shader-specular': 'specular',
    'shader-impulse-size': 'impulseSize',
  },
  physarum: {
    'shader-physarum-diffusion': 'diffusion',
    'shader-physarum-decay': 'decay',
    'shader-physarum-deposit': 'deposit',
    'shader-physarum-sensor': 'sensor',
    'shader-physarum-turn': 'turn',
  },
  aurora: {
    'shader-aurora-layers': 'layers',
    'shader-aurora-speed': 'speed',
    'shader-aurora-height': 'height',
    'shader-aurora-spread': 'spread',
    'shader-aurora-shimmer': 'shimmer',
  },
  // Lenia: the owner's tuning. The editor showed width 0.015 while the hero
  // painted 0.04 (the audit's defect), which this catches.
  lenia: {
    'shader-lenia-radius': 'radius',
    'shader-lenia-growth': 'growth',
    'shader-lenia-width': 'width',
    'shader-lenia-speed': 'speed',
    'shader-lenia-dt': 'dt',
  },
  // The hard, dark line by default; the soft line is three settings.
  glass: {
    'shader-glass-cell-size': 'cellSize',
    'shader-glass-border': 'border',
    'shader-glass-line-softness': 'lineSoftness',
    'shader-glass-line-colour': 'lineTint',
    'shader-glass-piece-edges': 'pieceEdges',
    'shader-glass-drift': 'drift',
    'shader-glass-glow': 'glow',
    'shader-glass-light': 'light',
  },
  fracture: {
    'shader-fracture-cuts': 'cuts',
    'shader-fracture-speed': 'speed',
    'shader-fracture-border': 'border',
    'shader-fracture-line-softness': 'lineSoftness',
    'shader-fracture-line-colour': 'lineTint',
    'shader-fracture-shadow': 'shadow',
    'shader-fracture-fill': 'fill',
  },
};

function painted(preset: string): Record<string, unknown> {
  const el = document.createElement('div');
  el.className = 'org-layout';
  el.style.setProperty('--brand-shader-preset', preset);
  document.body.appendChild(el);
  return { ...getShaderConfig(el) };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe("the editor's slider defaults are what the hero paints", () => {
  it.each(Object.keys(FIELDS))('%s', (preset) => {
    const config = painted(preset);
    const keys = (HERO_FX_PRESET_CONTROLS[preset]?.controls ?? []).map(
      (c) => c.key
    );
    // Every control is mapped, so a new one cannot slip past this check.
    expect(keys.sort()).toEqual(Object.keys(FIELDS[preset]).sort());
    for (const [key, field] of Object.entries(FIELDS[preset])) {
      expect(Number(HERO_FX_DEFAULTS[key]), key).toBe(config[field]);
    }
  });
});

// A slider stores its range input's value, and an override equal to the
// default STRING is dropped (updateOverride). '0.10' is never what a range
// input reports ('0.1'), so a slider moved back to its default stored a
// needless override; a default off the step grid is snapped to another value.
// Every live preset, its own sliders and its intensity/grain/vignette.
describe("the editor's slider defaults are what a range input reports", () => {
  it.each(LIVE_PRESET_IDS)('%s', (preset) => {
    const sliders = [
      ...presetFxControls(preset),
      ...(HERO_FX_PRESET_CONTROLS[preset]?.controls ?? []),
    ].filter((c) => c.kind === 'slider');
    const wrong: string[] = [];
    for (const control of sliders) {
      const stored = HERO_FX_DEFAULTS[control.key] ?? '';
      const value = Number(stored);
      const steps = (value - control.min) / control.step;
      if (String(value) !== stored) wrong.push(`${control.key} '${stored}'`);
      else if (value < control.min || value > control.max)
        wrong.push(`${control.key} ${stored} outside the slider`);
      else if (Math.abs(steps - Math.round(steps)) > 1e-6)
        wrong.push(`${control.key} ${stored} off the step grid`);
      // What the creator sees: a slider moved back to its default stores
      // nothing (the range input reports the shortest form).
      const writes: Array<string | null> = [];
      updateOverride(control.key, String(value), (_key, v) => writes.push(v));
      if (writes[0] !== null) wrong.push(`${control.key} stored at default`);
    }
    expect(sliders.length).toBeGreaterThanOrEqual(3);
    expect(wrong).toEqual([]);
  });
});

describe('R4b labels (WP-1d)', () => {
  const control = (preset: string, key: string) =>
    HERO_FX_PRESET_CONTROLS[preset]?.controls.find((c) => c.key === key);

  it('names both border sliders Line Weight', () => {
    expect(control('glass', 'shader-glass-border')?.label).toBe('Line Weight');
    expect(control('fracture', 'shader-fracture-border')?.label).toBe(
      'Line Weight'
    );
  });

  // A higher Cell Size packs more cells across: smaller pieces.
  it('labels Cell Size from Large to Small', () => {
    const cells = control('glass', 'shader-glass-cell-size');
    expect(
      cells?.kind === 'slider' && [cells.minLabel, cells.maxLabel]
    ).toEqual(['Large', 'Small']);
  });
});
