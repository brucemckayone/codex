import { describeThrown } from '$lib/client-log';
import { logger } from '$lib/observability';
import type { ShaderPresetId } from './shader-config';

/** How a renderer failed: its module would not load, or `init()` refused. */
export type RendererFailure = 'load' | 'init';

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
