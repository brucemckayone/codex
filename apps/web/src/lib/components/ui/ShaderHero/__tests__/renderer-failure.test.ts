import { afterEach, describe, expect, it, vi } from 'vitest';

const { logger } = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('$lib/observability', () => ({ logger }));

import {
  reportRendererFailure,
  reportRetryFailure,
  reportWindowNoContext,
} from '../renderer-failure';

/**
 * A ShaderHero renderer that would not load or start is logged once per
 * preset and reason per session (`shader_hero.renderer_failed`), with whether
 * the context has float render targets: the org layout's hero lives for the
 * whole SPA session and retries on every preset change, and a device that
 * cannot start a preset fails it the same way every time.
 */

/** A context stand-in with, or without, float render targets; maybe lost. */
const context = (hasFloat: boolean, lost = false) =>
  ({
    getExtension: (name: string) =>
      hasFloat && name === 'EXT_color_buffer_float' ? {} : null,
    isContextLost: () => lost,
  }) as unknown as WebGL2RenderingContext;

afterEach(() => {
  logger.warn.mockClear();
});

describe('reportRendererFailure', () => {
  it('logs the preset, how it failed, float support, and what was thrown', () => {
    reportRendererFailure(
      'lava',
      'load',
      context(true),
      new Error('chunk gone')
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'shader_hero.renderer_failed',
      expect.objectContaining({
        preset: 'lava',
        reason: 'load',
        hasFloat: true,
        name: 'Error',
        error: 'chunk gone',
      })
    );
  });

  it('says when the context has no float render targets, or was lost', () => {
    reportRendererFailure('flow', 'init', context(false, true));
    expect(logger.warn).toHaveBeenCalledWith('shader_hero.renderer_failed', {
      preset: 'flow',
      reason: 'init',
      hasFloat: false,
      contextLost: true,
    });
  });

  it('logs each preset and reason once per session, however often it fails', () => {
    reportRendererFailure('ink', 'init', context(true));
    reportRendererFailure('ink', 'init', context(true));
    expect(logger.warn).toHaveBeenCalledTimes(1);
    // The same preset failing another way is news.
    reportRendererFailure('ink', 'load', context(true), new Error('again'));
    reportRendererFailure('ink', 'load', context(true), new Error('again'));
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});

describe('reportRetryFailure', () => {
  it('says once per preset that its one load retry failed too', () => {
    reportRetryFailure('aurora');
    reportRetryFailure('aurora');
    expect(logger.warn.mock.calls).toEqual([
      ['shader_hero.renderer_retry_failed', { preset: 'aurora' }],
    ]);
  });
});

describe('reportWindowNoContext', () => {
  // Review r2: a window near the screen before the shader's first frame is
  // reported with `shaderLive: false`; the `true` that follows once the shader
  // goes live is the one that says a live shader is being missed.
  it('logs once per shaderLive value, so a later live miss is never swallowed', () => {
    reportWindowNoContext(false);
    reportWindowNoContext(false);
    reportWindowNoContext(true);
    reportWindowNoContext(true);
    expect(logger.warn.mock.calls).toEqual([
      ['shader_window.no_context', { shaderLive: false }],
      ['shader_window.no_context', { shaderLive: true }],
    ]);
  });
});
