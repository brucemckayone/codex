import { describeThrown } from '$lib/client-log';
import { logger } from '$lib/observability';
import type { ShaderPresetId } from './shader-config';

/** How a renderer failed: its module would not load, `init()` refused, or
 *  (a stack's second preset) its `render()` threw. */
export type RendererFailure = 'load' | 'init' | 'render';

/** `${preset}:${reason}` pairs already reported this session (one tab). */
const reported = new Set<string>();

/**
 * Log, once per preset and reason per session, a ShaderHero renderer that
 * would not load or start (`shader_hero.renderer_failed`).
 *
 * Once, because the org layout's hero is mounted once for the whole SPA
 * session and retries on every preset change (and a load failure once more
 * when the browser is back online), and a device that cannot start a preset
 * fails it the same way every time. Keyed on the reason too, so a preset that
 * first failed to load and later failed to start says both.
 *
 * `hasFloat` records whether the context has float render targets
 * (`EXT_color_buffer_float`): what the two-pass presets need, and the first
 * question an init failure raises. `contextLost` says whether the context was
 * gone, which fails every preset alike.
 */
export function reportRendererFailure(
  preset: ShaderPresetId,
  reason: RendererFailure,
  gl: WebGL2RenderingContext,
  thrown?: unknown
): void {
  const key = `${preset}:${reason}`;
  if (reported.has(key)) return;
  reported.add(key);
  logger.warn('shader_hero.renderer_failed', {
    preset,
    reason,
    hasFloat: Boolean(gl.getExtension('EXT_color_buffer_float')),
    contextLost: gl.isContextLost(),
    ...(thrown === undefined ? {} : describeThrown(thrown)),
  });
}

/** Presets whose one load retry has been reported as failed this session. */
const retriesReported = new Set<ShaderPresetId>();

/**
 * Log, once per preset per session, that the hero's ONE retry of a failed
 * load (back online, or the tab shown again) failed as well
 * (`shader_hero.renderer_retry_failed`): the hero gives up on it then, so
 * this is the last word on why that preset never drew.
 */
export function reportRetryFailure(preset: ShaderPresetId): void {
  if (retriesReported.has(preset)) return;
  retriesReported.add(preset);
  logger.warn('shader_hero.renderer_retry_failed', { preset });
}

/**
 * Log a lost WebGL context (`shader_hero.context_lost`): a GPU reset, or the
 * browser reclaiming the context. The hero shows its CSS fallback until the
 * browser restores the context (`reportContextRestored`), which it may never
 * do. Every loss is logged: a loss is an event, not a retry in a loop.
 */
export function reportContextLost(preset: ShaderPresetId): void {
  logger.warn('shader_hero.context_lost', { preset });
}

/**
 * Log a restored WebGL context (`shader_hero.context_restored`): the hero has
 * forgotten every object of the lost one and is starting `preset` afresh.
 * With the loss before it, the pair says how long the hero was blank.
 */
export function reportContextRestored(preset: ShaderPresetId): void {
  logger.info('shader_hero.context_restored', { preset });
}

/** `${preset}:${reason}` second-preset failures already reported. */
const secondsReported = new Set<string>();

/**
 * Log, once per preset and reason per session, a stack's SECOND preset that
 * would not load or start (`shader_hero.second_failed`). The base keeps
 * drawing; the stack goes on without the second for the session.
 */
export function reportSecondFailure(
  preset: ShaderPresetId,
  reason: RendererFailure,
  gl: WebGL2RenderingContext,
  thrown?: unknown
): void {
  const key = `${preset}:${reason}`;
  if (secondsReported.has(key)) return;
  secondsReported.add(key);
  logger.warn('shader_hero.second_failed', {
    preset,
    reason,
    hasFloat: Boolean(gl.getExtension('EXT_color_buffer_float')),
    contextLost: gl.isContextLost(),
    ...(thrown === undefined ? {} : describeThrown(thrown)),
  });
}

/**
 * Log the phone budget dropping a stack's second preset
 * (`shader_hero.stack_budget_dropped`), with the window's 95th-percentile frame
 * interval: the number the budget is tuned from.
 */
export function reportStackBudget(
  preset: ShaderPresetId,
  breach: { p95Ms: number; frames: number }
): void {
  logger.warn('shader_hero.stack_budget_dropped', {
    preset,
    p95Ms: Math.round(breach.p95Ms * 10) / 10,
    frames: breach.frames,
  });
}

/**
 * Log the phone budget cutting a layer from a layers-only stack
 * (`shader_hero.stack_budget_layer_dropped`, behind PHONE_LAYER_BUDGET): which,
 * how many are left drawing, and the window that broke it.
 */
export function reportLayerBudget(
  cut: { layer: string; remaining: number },
  breach: { p95Ms: number; frames: number }
): void {
  logger.warn('shader_hero.stack_budget_layer_dropped', {
    layer: cut.layer,
    remaining: cut.remaining,
    p95Ms: Math.round(breach.p95Ms * 10) / 10,
    frames: breach.frames,
  });
}

/** What of the compositor failed: its module, a target, a pass, an upload,
 *  or a throw out of its render. */
export type CompositorFailure =
  | 'load'
  | 'targets'
  | 'program'
  | 'media'
  | 'mask'
  | 'render';

const compositorReported = new Set<CompositorFailure>();

/**
 * Log, once per kind per session, a compositor failure
 * (`shader_hero.compositor_failed`). For `load`, `targets`, `program` and
 * `render` (a preset threw inside it) the hero detaches the compositor and
 * draws the base alone; a `media` or `mask` upload that fails (a
 * cross-origin source without CORS, a broken image) is dropped and the frame
 * draws without it.
 */
export function reportCompositorFailure(
  what: CompositorFailure,
  thrown?: unknown
): void {
  if (compositorReported.has(what)) return;
  compositorReported.add(what);
  logger.warn('shader_hero.compositor_failed', {
    what,
    ...(thrown === undefined ? {} : describeThrown(thrown)),
  });
}

let frameListenerReported = false;

/**
 * Log, once per session, a shader-frame listener that threw
 * (`shader_hero.frame_listener_failed`): a shader window whose copy failed.
 * Its frame is dropped, and the shader and every other window carry on
 * (`shader-frame.svelte.ts`). Once, because a copy that fails fails the same
 * way up to 30 times a second.
 */
export function reportFrameListenerFailure(thrown: unknown): void {
  if (frameListenerReported) return;
  frameListenerReported = true;
  logger.warn('shader_hero.frame_listener_failed', describeThrown(thrown));
}

let windowContextReported = false;

/**
 * Log, once per session, a shader window that got no 2D context
 * (`shader_window.no_context`). WebKit hands back null past its canvas-memory
 * cap, and the window then keeps its fallback while the shader is live: to a
 * visitor, and without this, to us, the same as an org with no shader
 * (Codex-8swlj review r1). Once, because every window on the page hits it.
 */
export function reportWindowNoContext(shaderLive: boolean): void {
  if (windowContextReported) return;
  windowContextReported = true;
  logger.warn('shader_window.no_context', { shaderLive });
}
