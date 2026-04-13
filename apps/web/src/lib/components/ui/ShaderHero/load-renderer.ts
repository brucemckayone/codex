/**
 * Shared renderer factory — dynamically imports the correct shader renderer
 * based on the preset ID. Used by both ShaderHero (org background) and
 * ImmersiveShaderPlayer (audio-reactive fullscreen mode).
 */

import type { ShaderRenderer } from './renderer-types';
import type { ShaderPresetId } from './shader-config';

export async function loadRenderer(
  preset: ShaderPresetId
): Promise<ShaderRenderer | null> {
  switch (preset) {
    case 'suture': {
      const { createSutureRenderer } = await import(
        './renderers/suture-renderer'
      );
      return createSutureRenderer();
    }
    case 'ether': {
      const { createEtherRenderer } = await import(
        './renderers/ether-renderer'
      );
      return createEtherRenderer();
    }
    case 'warp': {
      const { createWarpRenderer } = await import('./renderers/warp-renderer');
      return createWarpRenderer();
    }
    case 'ripple': {
      const { createRippleRenderer } = await import(
        './renderers/ripple-renderer'
      );
      return createRippleRenderer();
    }
    case 'pulse': {
      const { createPulseRenderer } = await import(
        './renderers/pulse-renderer'
      );
      return createPulseRenderer();
    }
    case 'ink': {
      const { createInkRenderer } = await import('./renderers/ink-renderer');
      return createInkRenderer();
    }
    case 'topo': {
      const { createTopoRenderer } = await import('./renderers/topo-renderer');
      return createTopoRenderer();
    }
    case 'nebula': {
      const { createNebulaRenderer } = await import(
        './renderers/nebula-renderer'
      );
      return createNebulaRenderer();
    }
    case 'turing': {
      const { createTuringRenderer } = await import(
        './renderers/turing-renderer'
      );
      return createTuringRenderer();
    }
    case 'silk': {
      const { createSilkRenderer } = await import('./renderers/silk-renderer');
      return createSilkRenderer();
    }
    case 'glass': {
      const { createGlassRenderer } = await import(
        './renderers/glass-renderer'
      );
      return createGlassRenderer();
    }
    case 'film': {
      const { createFilmRenderer } = await import('./renderers/film-renderer');
      return createFilmRenderer();
    }
    case 'flux': {
      const { createFluxRenderer } = await import('./renderers/flux-renderer');
      return createFluxRenderer();
    }
    case 'lava': {
      const { createLavaRenderer } = await import('./renderers/lava-renderer');
      return createLavaRenderer();
    }
    case 'caustic': {
      const { createCausticRenderer } = await import(
        './renderers/caustic-renderer'
      );
      return createCausticRenderer();
    }
    case 'physarum': {
      const { createPhysarumRenderer } = await import(
        './renderers/physarum-renderer'
      );
      return createPhysarumRenderer();
    }
    case 'rain': {
      const { createRainRenderer } = await import('./renderers/rain-renderer');
      return createRainRenderer();
    }
    case 'frost': {
      const { createFrostRenderer } = await import(
        './renderers/frost-renderer'
      );
      return createFrostRenderer();
    }
    case 'glow': {
      const { createGlowRenderer } = await import('./renderers/glow-renderer');
      return createGlowRenderer();
    }
    case 'life': {
      const { createLifeRenderer } = await import('./renderers/life-renderer');
      return createLifeRenderer();
    }
    case 'mycelium': {
      const { createMyceliumRenderer } = await import(
        './renderers/mycelium-renderer'
      );
      return createMyceliumRenderer();
    }
    case 'aurora': {
      const { createAuroraRenderer } = await import(
        './renderers/aurora-renderer'
      );
      return createAuroraRenderer();
    }
    case 'tendrils': {
      const { createTendrilsRenderer } = await import(
        './renderers/tendrils-renderer'
      );
      return createTendrilsRenderer();
    }
    case 'pollen': {
      const { createPollenRenderer } = await import(
        './renderers/pollen-renderer'
      );
      return createPollenRenderer();
    }
    case 'growth': {
      const { createGrowthRenderer } = await import(
        './renderers/growth-renderer'
      );
      return createGrowthRenderer();
    }
    case 'geode': {
      const { createGeodeRenderer } = await import(
        './renderers/geode-renderer'
      );
      return createGeodeRenderer();
    }
    case 'lenia': {
      const { createLeniaRenderer } = await import(
        './renderers/lenia-renderer'
      );
      return createLeniaRenderer();
    }
    case 'ocean': {
      const { createOceanRenderer } = await import(
        './renderers/ocean-renderer'
      );
      return createOceanRenderer();
    }
    case 'bismuth': {
      const { createBismuthRenderer } = await import(
        './renderers/bismuth-renderer'
      );
      return createBismuthRenderer();
    }
    case 'pearl': {
      const { createPearlRenderer } = await import(
        './renderers/pearl-renderer'
      );
      return createPearlRenderer();
    }
    case 'vortex': {
      const { createVortexRenderer } = await import(
        './renderers/vortex-renderer'
      );
      return createVortexRenderer();
    }
    case 'gyroid': {
      const { createGyroidRenderer } = await import(
        './renderers/gyroid-renderer'
      );
      return createGyroidRenderer();
    }
    case 'waves': {
      const { createWavesRenderer } = await import(
        './renderers/waves-renderer'
      );
      return createWavesRenderer();
    }
    case 'clouds': {
      const { createCloudsRenderer } = await import(
        './renderers/clouds-renderer'
      );
      return createCloudsRenderer();
    }
    case 'fracture': {
      const { createFractureRenderer } = await import(
        './renderers/fracture-renderer'
      );
      return createFractureRenderer();
    }
    case 'julia': {
      const { createJuliaRenderer } = await import(
        './renderers/julia-renderer'
      );
      return createJuliaRenderer();
    }
    case 'vapor': {
      const { createVaporRenderer } = await import(
        './renderers/vapor-renderer'
      );
      return createVaporRenderer();
    }
    case 'tunnel': {
      const { createTunnelRenderer } = await import(
        './renderers/tunnel-renderer'
      );
      return createTunnelRenderer();
    }
    case 'plasma': {
      const { createPlasmaRenderer } = await import(
        './renderers/plasma-renderer'
      );
      return createPlasmaRenderer();
    }
    case 'flow': {
      const { createFlowRenderer } = await import('./renderers/flow-renderer');
      return createFlowRenderer();
    }
    case 'spore': {
      const { createSporeRenderer } = await import(
        './renderers/spore-renderer'
      );
      return createSporeRenderer();
    }
    default:
      return null;
  }
}
