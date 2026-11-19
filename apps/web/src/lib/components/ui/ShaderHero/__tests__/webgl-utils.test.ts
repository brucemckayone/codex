import { afterEach, describe, expect, it, vi } from 'vitest';

const { logger } = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('$lib/observability', () => ({ logger }));

import { createProgram, withProgramLabel } from '../webgl-utils';

/**
 * A program that will not build says so through the app logger, named by who
 * built it (`surface:preset`) and with whether the context was lost, and frees
 * what it did compile (Codex-1yd58.14).
 */

const VERTEX = 1;
const FRAGMENT = 2;

/** A context stand-in whose fragment compile, or link, fails. */
function context(fail: 'fragment' | 'link', lost = false) {
  const deleted: string[] = [];
  const gl = {
    VERTEX_SHADER: VERTEX,
    FRAGMENT_SHADER: FRAGMENT,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    createShader: (type: number) => ({ type }),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: (shader: { type: number }) =>
      !(fail === 'fragment' && shader.type === FRAGMENT),
    getShaderInfoLog: () => 'ERROR: 0:12: syntax error',
    deleteShader: (shader: { type: number }) => {
      deleted.push(shader.type === VERTEX ? 'vertex' : 'fragment');
    },
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => fail !== 'link',
    getProgramInfoLog: () => 'link: varying mismatch',
    deleteProgram: () => {
      deleted.push('program');
    },
    detachShader: () => {},
    isContextLost: () => lost,
  } as unknown as WebGL2RenderingContext;
  return { gl, deleted };
}

afterEach(() => {
  logger.error.mockClear();
});

describe('createProgram failures', () => {
  it('names the init it ran in, and frees the stage that compiled', () => {
    const { gl, deleted } = context('fragment');
    const program = withProgramLabel('immersive:flow', () =>
      createProgram(gl, 'v', 'f')
    );
    expect(program).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      'shader_hero.shader_compile_failed',
      {
        label: 'immersive:flow',
        contextLost: false,
        stage: 'fragment',
        info: 'ERROR: 0:12: syntax error',
      }
    );
    expect(deleted).toEqual(['fragment', 'vertex']);
  });

  it('takes an explicit label over the init it runs in', () => {
    const { gl } = context('link', true);
    withProgramLabel('shader_hero:ink', () =>
      createProgram(gl, 'v', 'f', 'jfa-seed')
    );
    expect(logger.error).toHaveBeenCalledWith(
      'shader_hero.program_link_failed',
      { label: 'jfa-seed', contextLost: true, info: 'link: varying mismatch' }
    );
  });

  it('frees the program and both stages when the link fails', () => {
    const { gl, deleted } = context('link');
    createProgram(gl, 'v', 'f');
    expect(deleted).toEqual(['program', 'vertex', 'fragment']);
  });

  it('carries no label outside any init, and the scope ends with it, throw or not', () => {
    expect(() =>
      withProgramLabel('shader_preview:lava', () => {
        throw new Error('init blew up');
      })
    ).toThrow('init blew up');
    const { gl } = context('fragment');
    createProgram(gl, 'v', 'f');
    expect(logger.error).toHaveBeenCalledWith(
      'shader_hero.shader_compile_failed',
      expect.not.objectContaining({ label: expect.anything() })
    );
  });
});
