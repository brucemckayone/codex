/**
 * Load and start a shader renderer, with the failure handling every surface
 * that draws one outside the hero needs (immersive mode, the studio preview).
 *
 * Shared because both had to get the same four things right, and the preview
 * got none of them: a load that rejects (offline, a replaced chunk) is caught
 * and logged; an `init()` that returns false OR throws counts as an init
 * failure; a renderer whose init failed is DESTROYED, so a half-built one
 * leaks no programs or framebuffers; and an init failure is retried ONCE on
 * the single-pass `film` before the caller gives up.
 */
import { describeThrown } from '$lib/client-log';
import { logger } from '$lib/observability';
import { loadRenderer } from './load-renderer';
import type { ShaderRenderer } from './renderer-types';
import type { LivePresetId } from './shader-config';
import { withProgramLabel } from './webgl-utils';

/**
 * What a renderer that will not start is retried on, once.
 *
 * WHY. Immersive mode's last resort is `flow`, a two-pass simulation that
 * needs a float render target (`EXT_color_buffer_float`); the `nebula` it
 * replaced was single-pass and started on any WebGL 2 context. Without a
 * retry, a device with no float targets would close immersive mode on every
 * piece that has no shader of its own. `film` is single-pass, cheap, and one
 * the owner kept.
 */
export const INIT_FALLBACK_PRESET: LivePresetId = 'film';

/**
 * The preset to retry with after `failed` would not start, or null when
 * there is nothing left to try (the fallback itself failed). PURE.
 */
export function initFallbackFor(failed: LivePresetId): LivePresetId | null {
  return failed === INIT_FALLBACK_PRESET ? null : INIT_FALLBACK_PRESET;
}

/** Which surface is starting it: the prefix of every event it logs. */
export type RendererSurface = 'immersive' | 'shader_preview' | 'shader_hero';

export interface StartRendererOptions {
  gl: WebGL2RenderingContext;
  /**
   * Size the canvas and return its pixel size for `init()`, called just
   * before each init; null when the canvas is gone (the caller unmounted).
   */
  size: () => { width: number; height: number } | null;
  /** False once the caller no longer wants this renderer (closed, superseded). */
  isCurrent: () => boolean;
  surface: RendererSurface;
}

/**
 * `ok` is the discriminant: callers compare it (`=== true`), since this app
 * compiles without strictNullChecks, where a truthiness test does not narrow.
 */
export type StartRendererResult =
  | { ok: true; renderer: ShaderRenderer; preset: LivePresetId }
  | { ok: false; reason: 'load' | 'init' | 'cancelled' };

/**
 * Destroy a renderer without letting its destroy throw: one whose init failed
 * part-way may hold some resources and not others.
 */
export function destroyRenderer(
  renderer: ShaderRenderer,
  gl: WebGL2RenderingContext,
  surface: RendererSurface
): void {
  try {
    renderer.destroy(gl);
  } catch (thrown) {
    logger.warn(`${surface}.renderer_destroy_failed`, describeThrown(thrown));
  }
}

/**
 * What an init failure's log says about the context: whether it has float
 * render targets (what the two-pass presets need) and whether it was lost
 * (which fails every init, whatever the preset).
 */
function contextFacts(gl: WebGL2RenderingContext) {
  return {
    hasFloat: Boolean(gl.getExtension('EXT_color_buffer_float')),
    contextLost: gl.isContextLost(),
  };
}

/** One load-and-init; `ok` discriminates as in StartRendererResult. */
type Attempt =
  | { ok: true; renderer: ShaderRenderer }
  | { ok: false; reason: 'load' | 'cancelled' }
  | { ok: false; reason: 'init'; thrown: unknown };

async function attempt(
  preset: LivePresetId,
  { gl, size, isCurrent, surface }: StartRendererOptions
): Promise<Attempt> {
  let loaded: ShaderRenderer | null;
  try {
    loaded = await loadRenderer(preset);
  } catch (thrown) {
    logger.warn(`${surface}.renderer_load_failed`, {
      preset,
      ...describeThrown(thrown),
    });
    return { ok: false, reason: 'load' };
  }
  // Superseded or closed while it loaded: nothing was built, so nothing to free.
  if (!isCurrent()) return { ok: false, reason: 'cancelled' };
  if (!loaded) {
    logger.warn(`${surface}.renderer_load_failed`, {
      preset,
      error: 'no renderer',
    });
    return { ok: false, reason: 'load' };
  }
  const box = size();
  if (!box) return { ok: false, reason: 'cancelled' };
  let started = false;
  let thrown: unknown;
  try {
    // Its programs' compile/link events name who built them.
    const building = loaded;
    started = withProgramLabel(`${surface}:${preset}`, () =>
      building.init(gl, box.width, box.height)
    );
  } catch (error) {
    thrown = error;
  }
  if (started) return { ok: true, renderer: loaded };
  destroyRenderer(loaded, gl, surface);
  return { ok: false, reason: 'init', thrown };
}

/**
 * Load and start `preset`'s renderer; if its `init()` fails (false or a
 * throw), log `${surface}.renderer_init_failed` and retry ONCE on
 * `INIT_FALLBACK_PRESET`. The result names the preset that actually started,
 * so the caller builds its config for that one.
 */
export async function startRenderer(
  preset: LivePresetId,
  options: StartRendererOptions
): Promise<StartRendererResult> {
  const first = await attempt(preset, options);
  if (first.ok === true) return { ok: true, renderer: first.renderer, preset };
  if (first.reason !== 'init') return { ok: false, reason: first.reason };

  const fallback = initFallbackFor(preset);
  logger.warn(`${options.surface}.renderer_init_failed`, {
    preset,
    fallback,
    ...contextFacts(options.gl),
    ...(first.thrown === undefined ? {} : describeThrown(first.thrown)),
  });
  if (!fallback) return { ok: false, reason: 'init' };

  const second = await attempt(fallback, options);
  if (second.ok === true) {
    return { ok: true, renderer: second.renderer, preset: fallback };
  }
  if (second.reason === 'init') {
    logger.warn(`${options.surface}.renderer_init_failed`, {
      preset: fallback,
      fallback: null,
      ...contextFacts(options.gl),
      ...(second.thrown === undefined ? {} : describeThrown(second.thrown)),
    });
  }
  return { ok: false, reason: second.reason };
}
