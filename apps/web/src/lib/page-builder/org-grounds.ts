/**
 * The org's page backgrounds per theme, as the org layout paints them
 * (03 X48): the brand editor's pending values while it is open (it re-paints
 * the layout live), else the org's saved ones.
 *
 * PURE, like `public-context.ts`: the caller reads `$app/state` and the brand
 * editor and passes the pieces in, so the page kit's `PageRenderer` takes
 * plain data and never reads a store. That is also what lets the kit render
 * under a bare `svelte/server` render with no SvelteKit runtime.
 */
import type { BrandEditorState } from '$lib/brand-editor';
import { parseDarkColorOverrides } from '$lib/brand-editor';
import { paintableColour } from '$lib/brand-editor/ground';
import { resolvePresetId } from '$lib/components/ui/ShaderHero/shader-config';
import type { ShaderLiveState } from '$lib/components/ui/ShaderHero/shader-live.svelte';
import type { OrganizationData } from '$lib/types';
import type { ThemeGrounds } from './kit/model/resolve';

export function orgGrounds(
  org:
    | Pick<OrganizationData, 'brandColors' | 'brandFineTune'>
    | null
    | undefined,
  pending: Pick<BrandEditorState, 'backgroundColor' | 'darkOverrides'> | null
): ThemeGrounds {
  if (pending) {
    return {
      light: paintableColour(pending.backgroundColor),
      dark: paintableColour(pending.darkOverrides?.backgroundColor),
    };
  }
  return {
    light: paintableColour(org?.brandColors?.background),
    dark: paintableColour(
      parseDarkColorOverrides(org?.brandFineTune?.darkModeOverrides)
        ?.backgroundColor
    ),
  };
}

/**
 * Whether the org has a moving background: a shader preset other than
 * 'none' (03 X50). The brand editor's pending preset while it is open, else
 * the org's saved one. The page kit defaults its hero to `atmosphere` on this
 * rule (03 X51), and the org layout's `data-hero-shader-active` gate starts
 * from it (`heroShaderActive` below). PURE, as `orgGrounds` above.
 *
 * The id goes through `resolvePresetId`, as `ShaderHero` reads it: a cut
 * preset paints its survivor (a shader), and an id naming no preset paints
 * nothing (no shader). Only the LIGHT `shader-preset` is read: a preset set
 * for the dark theme alone does not count. And it is a claim about the
 * tokens, not the canvas: a renderer that fails to start still counts here.
 *
 * The editor open with nothing pending reads the SAVED tokens: `open()` sets
 * `pending` as it opens the panel, so open-with-null is only a transient,
 * and then nothing pending means the saved brand.
 */
export function orgShader(
  org: Pick<OrganizationData, 'brandFineTune'> | null | undefined,
  pending: Pick<BrandEditorState, 'tokenOverrides'> | null
): boolean {
  let overrides: Record<string, unknown> = {};
  if (pending) overrides = pending.tokenOverrides ?? {};
  else {
    const raw = org?.brandFineTune?.tokenOverrides;
    if (raw) {
      try {
        overrides = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // A malformed row carries no preset, as the org layout reads it.
        overrides = {};
      }
    }
  }
  const preset = overrides['shader-preset'];
  const id = typeof preset === 'string' ? resolvePresetId(preset) : null;
  return id !== null && id !== 'none';
}

/**
 * Whether the org layout sets `data-hero-shader-active`, the gate that the
 * page kit's see-through surfaces and the layout's own clearing rules read
 * (Codex-1yd58.3).
 *
 * `expected` is `orgShader`, the tokens' claim. It is all the server can know,
 * so it stands until the shader settles. That keeps the first paint what the
 * server rendered, with no flash. After that, what the org layout's shader
 * reports (`shaderLive`) decides:
 * - It drew a frame: the gate is set, even for a dark-only preset that the
 *   tokens' claim misses.
 * - It has no preset, or it cannot draw (failed load or start, no WebGL, lost
 *   context): the gate is cleared, so the surfaces go back to opaque instead
 *   of veiling a canvas that shows nothing.
 */
export function heroShaderActive(
  expected: boolean,
  state: ShaderLiveState
): boolean {
  if (state === 'pending') return expected;
  return state === 'live';
}
