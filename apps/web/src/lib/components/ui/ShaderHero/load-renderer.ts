/**
 * Shared renderer factory — dynamically imports the correct shader renderer
 * based on the preset ID. Used by both ShaderHero (org background) and
 * ImmersiveShaderPlayer (audio-reactive fullscreen mode).
 */

import type { ShaderRenderer } from './renderer-types';
import type { ShaderPresetId } from './shader-config';

type RendererLoader = () => Promise<ShaderRenderer | null>;

// Each entry is its own dynamic-import arrow, preserving per-preset code-splitting
// (Vite creates a separate chunk per import() site).
const RENDERER_LOADERS: Record<ShaderPresetId, RendererLoader> = {
  suture: async () =>
    (await import('./renderers/suture-renderer')).createSutureRenderer(),
  ether: async () =>
    (await import('./renderers/ether-renderer')).createEtherRenderer(),
  warp: async () =>
    (await import('./renderers/warp-renderer')).createWarpRenderer(),
  ripple: async () =>
    (await import('./renderers/ripple-renderer')).createRippleRenderer(),
  pulse: async () =>
    (await import('./renderers/pulse-renderer')).createPulseRenderer(),
  ink: async () =>
    (await import('./renderers/ink-renderer')).createInkRenderer(),
  topo: async () =>
    (await import('./renderers/topo-renderer')).createTopoRenderer(),
  nebula: async () =>
    (await import('./renderers/nebula-renderer')).createNebulaRenderer(),
  turing: async () =>
    (await import('./renderers/turing-renderer')).createTuringRenderer(),
  silk: async () =>
    (await import('./renderers/silk-renderer')).createSilkRenderer(),
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
  rain: async () =>
    (await import('./renderers/rain-renderer')).createRainRenderer(),
  frost: async () =>
    (await import('./renderers/frost-renderer')).createFrostRenderer(),
  glow: async () =>
    (await import('./renderers/glow-renderer')).createGlowRenderer(),
  life: async () =>
    (await import('./renderers/life-renderer')).createLifeRenderer(),
  mycelium: async () =>
    (await import('./renderers/mycelium-renderer')).createMyceliumRenderer(),
  aurora: async () =>
    (await import('./renderers/aurora-renderer')).createAuroraRenderer(),
  tendrils: async () =>
    (await import('./renderers/tendrils-renderer')).createTendrilsRenderer(),
  pollen: async () =>
    (await import('./renderers/pollen-renderer')).createPollenRenderer(),
  growth: async () =>
    (await import('./renderers/growth-renderer')).createGrowthRenderer(),
  geode: async () =>
    (await import('./renderers/geode-renderer')).createGeodeRenderer(),
  lenia: async () =>
    (await import('./renderers/lenia-renderer')).createLeniaRenderer(),
  ocean: async () =>
    (await import('./renderers/ocean-renderer')).createOceanRenderer(),
  bismuth: async () =>
    (await import('./renderers/bismuth-renderer')).createBismuthRenderer(),
  pearl: async () =>
    (await import('./renderers/pearl-renderer')).createPearlRenderer(),
  vortex: async () =>
    (await import('./renderers/vortex-renderer')).createVortexRenderer(),
  gyroid: async () =>
    (await import('./renderers/gyroid-renderer')).createGyroidRenderer(),
  waves: async () =>
    (await import('./renderers/waves-renderer')).createWavesRenderer(),
  clouds: async () =>
    (await import('./renderers/clouds-renderer')).createCloudsRenderer(),
  fracture: async () =>
    (await import('./renderers/fracture-renderer')).createFractureRenderer(),
  julia: async () =>
    (await import('./renderers/julia-renderer')).createJuliaRenderer(),
  vapor: async () =>
    (await import('./renderers/vapor-renderer')).createVaporRenderer(),
  tunnel: async () =>
    (await import('./renderers/tunnel-renderer')).createTunnelRenderer(),
  plasma: async () =>
    (await import('./renderers/plasma-renderer')).createPlasmaRenderer(),
  flow: async () =>
    (await import('./renderers/flow-renderer')).createFlowRenderer(),
  spore: async () =>
    (await import('./renderers/spore-renderer')).createSporeRenderer(),
  none: async () => null,
};

export async function loadRenderer(
  preset: ShaderPresetId
): Promise<ShaderRenderer | null> {
  const loader = RENDERER_LOADERS[preset];
  return loader ? loader() : null;
}
