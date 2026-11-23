/**
 * Shared renderer factory — dynamically imports the correct shader renderer
 * based on the preset ID. Used by both ShaderHero (org background) and
 * ImmersiveShaderPlayer (audio-reactive fullscreen mode).
 */

import type { ShaderRenderer } from './renderer-types';
import { resolvePresetId, type ShaderPresetId } from './shader-config';

type RendererLoader = () => Promise<ShaderRenderer | null>;

// Each entry is its own dynamic-import arrow, preserving per-preset code-splitting
// (Vite creates a separate chunk per import() site).
const RENDERER_LOADERS: Record<ShaderPresetId, RendererLoader> = {
  suture: async () =>
    (await import('./renderers/suture-renderer')).createSutureRenderer(),
  ether: async () =>
    (await import('./renderers/ether-renderer')).createEtherRenderer(),
  ripple: async () =>
    (await import('./renderers/ripple-renderer')).createRippleRenderer(),
  pulse: async () =>
    (await import('./renderers/pulse-renderer')).createPulseRenderer(),
  ink: async () =>
    (await import('./renderers/ink-renderer')).createInkRenderer(),
  topo: async () =>
    (await import('./renderers/topo-renderer')).createTopoRenderer(),
  glass: async () =>
    (await import('./renderers/glass-renderer')).createGlassRenderer(),
  film: async () =>
    (await import('./renderers/film-renderer')).createFilmRenderer(),
  flux: async () =>
    (await import('./renderers/flux-renderer')).createFluxRenderer(),
  lava: async () =>
    (await import('./renderers/lava-renderer')).createLavaRenderer(),
  caustic: async () =>
    (await import('./renderers/caustic-renderer')).createCausticRenderer(),
  physarum: async () =>
    (await import('./renderers/physarum-renderer')).createPhysarumRenderer(),
  aurora: async () =>
    (await import('./renderers/aurora-renderer')).createAuroraRenderer(),
  lenia: async () =>
    (await import('./renderers/lenia-renderer')).createLeniaRenderer(),
  fracture: async () =>
    (await import('./renderers/fracture-renderer')).createFractureRenderer(),
  flow: async () =>
    (await import('./renderers/flow-renderer')).createFlowRenderer(),
  none: async () => null,
};

/**
 * The renderer for a preset id; `null` for `'none'`, or for an id that names
 * no preset.
 *
 * Takes a plain string because callers hold stored ids — a content item's
 * `shader_preset`, the brand's token, a menu id — and resolves it through
 * `resolvePresetId`, so a cut preset loads its survivor's renderer rather
 * than nothing.
 */
export async function loadRenderer(
  preset: string | null | undefined
): Promise<ShaderRenderer | null> {
  const id = resolvePresetId(preset);
  return id ? RENDERER_LOADERS[id]() : null;
}
