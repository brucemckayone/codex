import { afterEach, describe, expect, it, vi } from 'vitest';

const { logger } = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('$lib/observability', () => ({ logger }));
vi.mock('../load-renderer', () => ({ loadRenderer: vi.fn() }));

import { loadRenderer } from '../load-renderer';
import type { ShaderRenderer } from '../renderer-types';
import {
  INIT_FALLBACK_PRESET,
  initFallbackFor,
  type StartRendererOptions,
  startRenderer,
} from '../start-renderer';

/**
 * The renderer starter immersive mode and the studio preview share: a load that
 * rejects is caught and logged, an init that returns false or throws is an init
 * failure, a renderer whose init failed is destroyed, and an init failure
 * retries ONCE on single-pass `film`.
 */

/** A renderer stand-in whose init answers `init` (or throws it). */
function stub(init: boolean | Error) {
  return {
    init: vi.fn(() => {
      if (init instanceof Error) throw init;
      return init;
    }),
    render: vi.fn(),
    resize: vi.fn(),
    reset: vi.fn(),
    destroy: vi.fn(),
  } satisfies ShaderRenderer;
}

/** A context with no float render targets, and not lost. */
const gl = {
  getExtension: () => null,
  isContextLost: () => false,
} as unknown as WebGL2RenderingContext;
const options = (
  overrides: Partial<StartRendererOptions> = {}
): StartRendererOptions => ({
  gl,
  surface: 'shader_preview',
  size: () => ({ width: 320, height: 180 }),
  isCurrent: () => true,
  ...overrides,
});
const loadedIds = () => vi.mocked(loadRenderer).mock.calls.map(([id]) => id);
const warned = (event: string) =>
  logger.warn.mock.calls
    .filter(([name]) => name === event)
    .map(([, meta]) => meta);

afterEach(() => {
  vi.mocked(loadRenderer).mockReset();
  logger.warn.mockClear();
});

describe('initFallbackFor', () => {
  it('retries any preset on film, and film on nothing', () => {
    expect(INIT_FALLBACK_PRESET).toBe('film');
    expect(initFallbackFor('flow')).toBe('film');
    expect(initFallbackFor('lenia')).toBe('film');
    expect(initFallbackFor('film')).toBeNull();
  });
});

describe('startRenderer', () => {
  it('starts the preset asked for, sized as the caller says', async () => {
    const flow = stub(true);
    vi.mocked(loadRenderer).mockResolvedValueOnce(flow);
    const result = await startRenderer('flow', options());
    expect(result).toEqual({ ok: true, renderer: flow, preset: 'flow' });
    expect(flow.init).toHaveBeenCalledWith(gl, 320, 180);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs a load that rejects, with its preset, and does not retry', async () => {
    vi.mocked(loadRenderer).mockRejectedValueOnce(new Error('chunk gone'));
    const result = await startRenderer('flow', options());
    expect(result).toEqual({ ok: false, reason: 'load' });
    expect(loadedIds()).toEqual(['flow']);
    expect(warned('shader_preview.renderer_load_failed')).toEqual([
      expect.objectContaining({ preset: 'flow', error: 'chunk gone' }),
    ]);
  });

  it('logs a load that finds no renderer', async () => {
    vi.mocked(loadRenderer).mockResolvedValueOnce(null);
    const result = await startRenderer('flow', options());
    expect(result).toEqual({ ok: false, reason: 'load' });
    expect(warned('shader_preview.renderer_load_failed')).toEqual([
      { preset: 'flow', error: 'no renderer' },
    ]);
  });

  it('destroys a renderer whose init fails, and starts film instead', async () => {
    const flow = stub(false);
    const film = stub(true);
    vi.mocked(loadRenderer)
      .mockResolvedValueOnce(flow)
      .mockResolvedValueOnce(film);
    const result = await startRenderer(
      'flow',
      options({ surface: 'immersive' })
    );
    expect(result).toEqual({ ok: true, renderer: film, preset: 'film' });
    expect(loadedIds()).toEqual(['flow', 'film']);
    expect(flow.destroy).toHaveBeenCalledWith(gl);
    expect(film.destroy).not.toHaveBeenCalled();
    expect(warned('immersive.renderer_init_failed')).toEqual([
      { preset: 'flow', fallback: 'film', hasFloat: false, contextLost: false },
    ]);
  });

  it('counts an init that THROWS as an init failure: destroyed, then film', async () => {
    const flow = stub(new Error('bad framebuffer'));
    const film = stub(true);
    vi.mocked(loadRenderer)
      .mockResolvedValueOnce(flow)
      .mockResolvedValueOnce(film);
    const result = await startRenderer('flow', options());
    expect(result).toEqual({ ok: true, renderer: film, preset: 'film' });
    expect(flow.destroy).toHaveBeenCalledTimes(1);
    expect(warned('shader_preview.renderer_init_failed')).toEqual([
      expect.objectContaining({
        preset: 'flow',
        fallback: 'film',
        error: 'bad framebuffer',
      }),
    ]);
  });

  it('gives up when film will not start either, freeing both', async () => {
    const flow = stub(false);
    const film = stub(false);
    vi.mocked(loadRenderer)
      .mockResolvedValueOnce(flow)
      .mockResolvedValueOnce(film);
    const result = await startRenderer('flow', options());
    expect(result).toEqual({ ok: false, reason: 'init' });
    expect(flow.destroy).toHaveBeenCalledTimes(1);
    expect(film.destroy).toHaveBeenCalledTimes(1);
    expect(warned('shader_preview.renderer_init_failed')).toEqual([
      { preset: 'flow', fallback: 'film', hasFloat: false, contextLost: false },
      { preset: 'film', fallback: null, hasFloat: false, contextLost: false },
    ]);
  });

  it('says in an init failure whether the context has float targets, and was lost', async () => {
    vi.mocked(loadRenderer).mockResolvedValueOnce(stub(false));
    const lostWithFloat = {
      getExtension: () => ({}),
      isContextLost: () => true,
    } as unknown as WebGL2RenderingContext;
    await startRenderer('film', options({ gl: lostWithFloat }));
    expect(warned('shader_preview.renderer_init_failed')).toEqual([
      { preset: 'film', fallback: null, hasFloat: true, contextLost: true },
    ]);
  });

  it('does not retry film on itself', async () => {
    const film = stub(false);
    vi.mocked(loadRenderer).mockResolvedValueOnce(film);
    const result = await startRenderer('film', options());
    expect(result).toEqual({ ok: false, reason: 'init' });
    expect(loadedIds()).toEqual(['film']);
    expect(warned('shader_preview.renderer_init_failed')).toEqual([
      { preset: 'film', fallback: null, hasFloat: false, contextLost: false },
    ]);
  });

  it('builds nothing for a caller that moved on while it loaded', async () => {
    const flow = stub(true);
    vi.mocked(loadRenderer).mockResolvedValueOnce(flow);
    const result = await startRenderer(
      'flow',
      options({ isCurrent: () => false })
    );
    expect(result).toEqual({ ok: false, reason: 'cancelled' });
    expect(flow.init).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('builds nothing once the canvas is gone', async () => {
    const flow = stub(true);
    vi.mocked(loadRenderer).mockResolvedValueOnce(flow);
    const result = await startRenderer('flow', options({ size: () => null }));
    expect(result).toEqual({ ok: false, reason: 'cancelled' });
    expect(flow.init).not.toHaveBeenCalled();
  });
});
