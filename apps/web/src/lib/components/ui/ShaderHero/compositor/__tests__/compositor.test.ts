/**
 * The compositor on a recording stand-in for WebGL2: what it draws into what,
 * in what order, at what size, and what its three Showreel seams (`setMedia`,
 * `setStage`, `setNameMask`) do before anything calls them. The stand-in tracks
 * the bound framebuffer, the texture on each unit and the viewport, and records
 * each draw with them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const { logger } = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('$lib/observability', () => ({ logger }));

// A frame or layers in place of the plan's, for the passes the brand's stack
// cannot name (a film frame, a flashing layer). Unset, the real plan runs.
const override = vi.hoisted(() => ({
  frame: null as unknown,
  layers: null as unknown,
}));
vi.mock('../plan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../plan')>();
  return {
    ...actual,
    planStack: (...args: Parameters<typeof actual.planStack>) => {
      const plan = actual.planStack(...args);
      return {
        ...plan,
        ...(override.frame ? { frame: override.frame } : {}),
        ...(override.layers ? { layers: override.layers } : {}),
      };
    },
  };
});

import { STILL_MOTION } from '../../__tests__/motion-fixtures';
import { bindOutput } from '../../output-target';
import type { ShaderRenderer } from '../../renderer-types';
import type { ShaderConfig } from '../../shader-config';
import { type CompositeFrame, createCompositor } from '../compositor';
import { duotoneStops } from '../duotone';
import type { LayerEffect } from '../effects/effect';
import { PORTRAIT_GLSL } from '../effects/frame-film-portrait';
import type { MotionChoice } from '../effects/motion-ids';
import { POINTERS } from '../effects/motion-registry';
import { restMotion } from '../effects/motion-uniforms';
import { FRAMES, LAYERS, MEDIA } from '../effects/registry';
import type { FilmMotion } from '../film-motion';
import { governFlash } from '../flash';
import { BARE_STACK, type StackConfig } from '../stack-config';
import { pushZoom, stageBoxFrom } from '../stage';

interface Handle {
  kind: string;
  id: number;
  source?: string;
  sources?: string[];
  tex?: Handle;
}

interface Draw {
  framebuffer: Handle | null;
  units: Record<number, Handle | null>;
  viewport: number[];
  /** The fragment source of the program drawn with. */
  fragment: string;
}

const TEXTURE0 = 0x84c0;

/** The stateless WebGL calls the compositor and its helpers make. */
const GL_METHODS = new Set([
  'bindBuffer',
  'bufferData',
  'compileShader',
  'deleteBuffer',
  'deleteFramebuffer',
  'deleteProgram',
  'deleteShader',
  'deleteTexture',
  'detachShader',
  'enableVertexAttribArray',
  'getExtension',
  'getProgramInfoLog',
  'linkProgram',
  'pixelStorei',
  'texParameteri',
  'uniform1f',
  'uniform1i',
  'uniform2f',
  'uniform3f',
  'uniform4f',
  // The film pass's trail: an array, set in one call.
  'uniform4fv',
  'vertexAttribPointer',
]);

/** A WebGL2 stand-in: every call is logged; the stateful ones are tracked. */
function fakeGl({
  failCompile = () => false,
  incomplete = false,
  tainted = null as unknown,
  loseAt = null as string | null,
}: {
  failCompile?: (source: string) => boolean;
  /** Every framebuffer reports incomplete, as one whose storage the driver
   *  could not give (out of memory) does; a function: those made while it
   *  says so. */
  incomplete?: boolean | (() => boolean);
  /** A source whose upload throws, as a cross-origin one without CORS does. */
  tainted?: unknown;
  /** The context is lost at this call (mid-frame, after the top check). */
  loseAt?: string | null;
} = {}) {
  const calls: [string, unknown[]][] = [];
  const draws: Draw[] = [];
  /** Each clear: where it landed, at what size, in what colour. */
  const clears: {
    framebuffer: Handle | null;
    viewport: number[];
    color: number[];
  }[] = [];
  let clearColor = [0, 0, 0, 0];
  let lost = false;
  let id = 0;
  let framebuffer: Handle | null = null;
  let unit = 0;
  const units: Record<number, Handle | null> = {};
  let viewport = [0, 0, 0, 0];
  let program: Handle | null = null;
  const make = (kind: string): Handle => ({ kind, id: ++id });

  const impl: Record<string, (...args: never[]) => unknown> = {
    // A lost context allocates nothing.
    createTexture: () => {
      if (loseAt === 'createTexture') lost = true;
      return lost ? null : make('texture');
    },
    createFramebuffer: () => (lost ? null : make('framebuffer')),
    checkFramebufferStatus: () =>
      (typeof incomplete === 'function' ? incomplete() : incomplete)
        ? 'FRAMEBUFFER_INCOMPLETE_ATTACHMENT'
        : 'FRAMEBUFFER_COMPLETE',
    texImage2D: (...args: unknown[]) => {
      if (tainted !== null && args.at(-1) === tainted) {
        throw new DOMException('The image is tainted', 'SecurityError');
      }
    },
    createBuffer: () => make('buffer'),
    createShader: () => make('shader'),
    createProgram: () => ({ ...make('program'), sources: [] }),
    shaderSource: (shader: Handle, source: string) => {
      shader.source = source;
    },
    getShaderParameter: (shader: Handle) => !failCompile(shader.source ?? ''),
    getProgramParameter: () => true,
    attachShader: (prog: Handle, shader: Handle) => {
      prog.sources?.push(shader.source ?? '');
    },
    getUniformLocation: (_prog: Handle, name: string) => ({ uniform: name }),
    getAttribLocation: () => 0,
    getShaderInfoLog: () => 'stand-in compile failure',
    isContextLost: () => lost,
    bindFramebuffer: (_target: string, fb: Handle | null) => {
      framebuffer = fb;
    },
    framebufferTexture2D: (
      _t: string,
      _a: string,
      _tt: string,
      tex: Handle
    ) => {
      if (framebuffer) framebuffer.tex = tex;
    },
    activeTexture: (which: number) => {
      unit = which - TEXTURE0;
    },
    bindTexture: (_target: string, tex: Handle | null) => {
      units[unit] = tex;
    },
    viewport: (...box: number[]) => {
      viewport = box;
    },
    useProgram: (prog: Handle) => {
      program = prog;
    },
    clearColor: (...rgba: number[]) => {
      clearColor = rgba;
    },
    clear: () => {
      clears.push({ framebuffer, viewport, color: clearColor });
    },
    drawArrays: () => {
      draws.push({
        framebuffer,
        units: { ...units },
        viewport,
        fragment: program?.sources?.find((s) => s.includes('fragColor')) ?? '',
      });
    },
  };

  // Only WebGL's own names answer: a matcher probing it (`asymmetricMatch`,
  // `then`, a symbol) must find nothing there.
  const gl = new Proxy(
    {},
    {
      get(_target, key) {
        if (typeof key !== 'string') return undefined;
        if (key === 'TEXTURE0') return TEXTURE0;
        if (/^[A-Z][A-Z0-9_]*$/.test(key)) return key;
        if (!(key in impl) && !GL_METHODS.has(key)) return undefined;
        return (...args: never[]) => {
          calls.push([key, args]);
          return impl[key]?.(...args);
        };
      },
    }
  ) as unknown as WebGL2RenderingContext;

  return {
    gl,
    calls,
    draws,
    clears,
    clearColor: () => clearColor,
    named: (name: string) =>
      calls.filter(([k]) => k === name).map(([, a]) => a),
    lose: () => {
      lost = true;
    },
    /** The browser restores it: a new, empty context on the same object. */
    restore: () => {
      lost = false;
    },
    reset: () => {
      calls.length = 0;
      draws.length = 0;
      clears.length = 0;
    },
  };
}

/** A renderer stand-in that draws into whatever output is bound, as every preset does. */
function stubRenderer() {
  const binds: unknown[] = [];
  const renderer = {
    init: vi.fn(() => true),
    resize: vi.fn(),
    reset: vi.fn(),
    destroy: vi.fn(),
    render: vi.fn((gl: WebGL2RenderingContext) => {
      bindOutput(gl);
      binds.push('rendered');
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }),
  } satisfies ShaderRenderer;
  return renderer;
}

const config = {
  preset: 'flow',
  colors: {
    primary: [0.1, 0.2, 0.3],
    secondary: [0.4, 0.5, 0.6],
    accent: [0.7, 0.8, 0.9],
    bg: [0.05, 0.05, 0.05],
  },
  // The org's own tokens, unlike the palette above (as a brand with its own
  // shader colours on): the surfaces over the footage tint from these (5b).
  brand: { primary: [0.8, 0.1, 0.2], bg: [0.96, 0.94, 0.9] },
} as unknown as ShaderConfig;

function frame(over: Partial<CompositeFrame> = {}): CompositeFrame {
  return {
    base: stubRenderer(),
    baseConfig: config,
    second: null,
    secondConfig: null,
    stack: { ...BARE_STACK, layers: [{ id: 'grain', amount: null }] },
    time: 2.9,
    mouse: { x: 0.25, y: 0.75, active: false, burstStrength: 0 },
    scene: [390, 844],
    secondSize: [195, 422],
    output: [780, 1688],
    phone: true,
    reducedMotion: false,
    canvasBox: { left: 0, bottom: 844, width: 390, height: 844 },
    scrollY: 0,
    ...over,
  };
}

/** The effect a draw was made with, by its body. */
const drewWith = (draw: Draw, effect: { glsl: string }) =>
  draw.fragment.includes(effect.glsl);

afterEach(() => {
  override.frame = null;
  override.layers = null;
  logger.warn.mockClear();
});

describe('compositor render', () => {
  it('draws the base into the scene target at the scene size, then the frame to the canvas at the output size', () => {
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    const f = frame({
      stack: { ...BARE_STACK, frame: 'shader-only', layers: [] },
    });
    expect(compositor.render(f)).toBe(true);

    expect(f.base.render).toHaveBeenCalledWith(
      fake.gl,
      2.9,
      f.mouse,
      config,
      390,
      844
    );
    const [base, out] = fake.draws;
    // The base's own `bindOutput` landed on the scene target.
    expect(base.framebuffer?.kind).toBe('framebuffer');
    // The frame reached the canvas, through the door, and reads the scene.
    expect(out.framebuffer).toBeNull();
    expect(out.viewport).toEqual([0, 0, 780, 1688]);
    expect(out.units[0]).toBe(base.framebuffer?.tex);
    expect(drewWith(out, FRAMES['shader-only'])).toBe(true);
    expect(fake.draws).toHaveLength(2);
    // After it, the output is the canvas again, as after any renderer.
    fake.reset();
    bindOutput(fake.gl);
    expect(fake.named('bindFramebuffer').at(-1)?.[1]).toBeNull();
  });

  it('with no base preset, draws a plain ground of the brand background into the scene', () => {
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    const f = frame({
      base: null,
      stack: { ...BARE_STACK, frame: 'shader-only', layers: [] },
    });
    expect(compositor.render(f)).toBe(true);
    // One clear, into the scene target at the scene size, in the bg colour.
    expect(fake.clears).toHaveLength(1);
    const [ground] = fake.clears;
    expect(ground.framebuffer?.kind).toBe('framebuffer');
    expect(ground.viewport).toEqual([0, 0, 390, 844]);
    expect(ground.color).toEqual([0.05, 0.05, 0.05, 1]);
    // GL's default clear colour back for the presets that follow.
    expect(fake.clearColor()).toEqual([0, 0, 0, 0]);
    // The frame reads that ground and draws it to the canvas.
    const out = fake.draws.at(-1) as Draw;
    expect(out.framebuffer).toBeNull();
    expect(out.units[0]).toBe(ground.framebuffer?.tex);
    expect(fake.draws).toHaveLength(1);
  });

  it('clears nothing when a base preset draws the scene', () => {
    const fake = fakeGl();
    createCompositor(fake.gl).render(frame());
    expect(fake.clears).toEqual([]);
  });

  it('renders the second preset into its own target at its own size, and blends the two', () => {
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    const second = stubRenderer();
    const secondConfig = {
      ...config,
      preset: 'ripple',
    } as unknown as ShaderConfig;
    const stack: StackConfig = {
      ...BARE_STACK,
      second: 'ripple',
      blend: 'mix',
    };
    compositor.render(frame({ second, secondConfig, stack }));

    expect(second.render).toHaveBeenCalledWith(
      fake.gl,
      2.9,
      expect.anything(),
      secondConfig,
      195,
      422
    );
    const [base, secondDraw, blend, out] = fake.draws;
    expect(secondDraw.framebuffer).not.toBe(base.framebuffer);
    expect(secondDraw.framebuffer?.kind).toBe('framebuffer');
    // The blend reads the base on unit 0 and the second on unit 1, into a third target.
    expect(drewWith(blend, { glsl: 'mix(a, b, u_amount)' })).toBe(true);
    expect(blend.units[0]).toBe(base.framebuffer?.tex);
    expect(blend.units[1]).toBe(secondDraw.framebuffer?.tex);
    expect(blend.viewport).toEqual([0, 0, 390, 844]);
    expect([base.framebuffer, secondDraw.framebuffer]).not.toContain(
      blend.framebuffer
    );
    expect(out.framebuffer).toBeNull();
    expect(out.units[0]).toBe(blend.framebuffer?.tex);
  });

  it('runs no blend while the second preset is not drawing', () => {
    const fake = fakeGl();
    const stack: StackConfig = { ...BARE_STACK, second: 'ripple' };
    createCompositor(fake.gl).render(frame({ stack }));
    expect(fake.draws.some((d) => d.fragment.includes('u_second'))).toBe(false);
  });

  it('runs layers in order at the scene size, ping-ponging: never into the target it reads', () => {
    const fake = fakeGl();
    const stack: StackConfig = {
      ...BARE_STACK,
      layers: [
        { id: 'grain', amount: 0.2 },
        { id: 'grain', amount: 0.4 },
        { id: 'grain', amount: 0.6 },
      ],
    };
    createCompositor(fake.gl).render(frame({ stack }));
    const layers = fake.draws.slice(1, 4);
    expect(layers.every((d) => drewWith(d, LAYERS.grain))).toBe(true);
    for (const draw of layers) {
      expect(draw.viewport).toEqual([0, 0, 390, 844]);
      expect(draw.units[0]).not.toBe(draw.framebuffer?.tex);
    }
    // Each reads what the one before it wrote; two targets between them.
    expect(layers[1].units[0]).toBe(layers[0].framebuffer?.tex);
    expect(layers[2].units[0]).toBe(layers[1].framebuffer?.tex);
    expect(layers[2].framebuffer).toBe(layers[0].framebuffer);
    expect(fake.draws[4].units[0]).toBe(layers[2].framebuffer?.tex);
    // Each with its own amount.
    const amounts = fake
      .named('uniform1f')
      .filter(([loc]) => (loc as { uniform: string }).uniform === 'u_amount')
      .map(([, v]) => v);
    expect(amounts).toEqual([0.2, 0.4, 0.6]);
  });

  /** Draws into a target whose own texture sits on a unit: a feedback loop. */
  const feedbackShaped = (draws: Draw[]) =>
    draws.filter(
      (d) =>
        d.framebuffer &&
        Object.values(d.units).some(
          (t) => t !== null && t === d.framebuffer?.tex
        )
    );

  it('never draws into a target whose texture sits on a unit, film frame and all', () => {
    // A new target is bound where it is made: made after the film's unit was
    // bound, it sat on that unit while a layer drew into it.
    override.frame = filmFrame;
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    compositor.setMedia(fakeVideo().el);
    compositor.setStage(
      stageBoxFrom({ left: 20, top: 100, width: 350, height: 600 }, 0, 600)
    );
    const second = stubRenderer();
    const stack: StackConfig = {
      ...BARE_STACK,
      second: 'ripple',
      blend: 'screen',
      layers: [
        { id: 'grain', amount: null },
        { id: 'grain', amount: null },
      ],
    };
    compositor.render(frame({ second, secondConfig: config, stack }));
    expect(fake.draws.length).toBeGreaterThanOrEqual(5);
    expect(feedbackShaped(fake.draws)).toEqual([]);
  });

  it('drops a second preset that throws, tells the hero, and draws the base on', () => {
    const fake = fakeGl();
    const second = stubRenderer();
    const boom = new Error('second.render threw');
    second.render.mockImplementation(() => {
      throw boom;
    });
    const onSecondFailed = vi.fn();
    const f = frame({
      second,
      secondConfig: config,
      stack: { ...BARE_STACK, second: 'ripple', blend: 'mix' },
      onSecondFailed,
    });
    expect(createCompositor(fake.gl).render(f)).toBe(true);
    expect(onSecondFailed).toHaveBeenCalledWith(boom);
    expect(f.base.render).toHaveBeenCalledTimes(1);
    // No blend without it, and the frame still reached the canvas.
    expect(fake.draws.some((d) => d.fragment.includes('u_second'))).toBe(false);
    expect(fake.draws.at(-1)?.framebuffer).toBeNull();
    fake.reset();
    bindOutput(fake.gl);
    expect(fake.named('bindFramebuffer').at(-1)?.[1]).toBeNull();
  });

  it('fails on a target the driver could not back, logs it, and frees it', () => {
    const fake = fakeGl({ incomplete: true });
    expect(createCompositor(fake.gl).render(frame())).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      'shader_hero.compositor_failed',
      expect.objectContaining({
        what: 'targets',
        name: 'TargetIncompleteError',
      })
    );
    // Deleted, and nothing drawn into it, the base included.
    expect(fake.named('deleteFramebuffer')).toHaveLength(1);
    expect(fake.draws).toEqual([]);
  });

  it('reports nothing for a context lost before or during a frame: the loss is the hero’s', () => {
    const before = fakeGl();
    const compositor = createCompositor(before.gl);
    compositor.render(frame());
    before.lose();
    expect(compositor.render(frame({ scene: [400, 900] }))).toBe(false);

    const during = fakeGl({ loseAt: 'createTexture' });
    expect(createCompositor(during.gl).render(frame())).toBe(false);
    expect(
      logger.warn.mock.calls.filter(
        ([event]) => event === 'shader_hero.compositor_failed'
      )
    ).toEqual([]);
  });

  it('draws nothing at 0x0 (a box not laid out yet) and calls it no failure, then composites', () => {
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    const empty = frame({ scene: [0, 0], secondSize: [0, 0], output: [0, 0] });
    expect(compositor.render(empty)).toBe(true);
    expect(fake.named('createFramebuffer')).toEqual([]);
    expect(empty.base?.render).not.toHaveBeenCalled();
    expect(compositor.render(frame())).toBe(true);
    expect(fake.draws.length).toBeGreaterThan(0);
    expect(
      logger.warn.mock.calls.filter(
        ([event]) => event === 'shader_hero.compositor_failed'
      )
    ).toEqual([]);
  });

  it('leaves no target on a texture unit after a frame (no feedback loop next frame)', () => {
    const fake = fakeGl();
    createCompositor(fake.gl).render(frame());
    fake.reset();
    // The next frame's base draws with whatever was left bound.
    stubRenderer().render(fake.gl);
    expect(Object.values(fake.draws[0].units).every((t) => t === null)).toBe(
      true
    );
  });

  it('gives a flashing effect the governed clock, and the rest the real one', () => {
    const fake = fakeGl();
    const flashing: LayerEffect = { ...LAYERS.grain, flashes: true };
    override.layers = [
      { effect: flashing, amount: 1 },
      { effect: LAYERS.grain, amount: 1 },
    ];
    createCompositor(fake.gl).render(frame({ time: 2.9 }));
    const times = fake
      .named('uniform1f')
      .filter(([loc]) => (loc as { uniform: string }).uniform === 'u_time')
      .map(([, v]) => v);
    expect(times).toEqual([governFlash(2.9), 2.9]);
    expect(governFlash(2.9)).not.toBe(2.9);
  });

  it('falls back to shader only for a frame that will not compile, and fails only when nothing will', () => {
    const fake = fakeGl({
      failCompile: (src) => src.includes(FRAMES['name-glows'].glsl),
    });
    const compositor = createCompositor(fake.gl);
    compositor.setNameMask({} as TexImageSource);
    const stack: StackConfig = { ...BARE_STACK, frame: 'name-glows' };
    expect(compositor.render(frame({ stack }))).toBe(true);
    expect(drewWith(fake.draws.at(-1) as Draw, FRAMES['shader-only'])).toBe(
      true
    );

    const broken = fakeGl({ failCompile: (src) => src.includes('fragColor') });
    expect(createCompositor(broken.gl).render(frame({ stack }))).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith('shader_hero.compositor_failed', {
      what: 'program',
    });
  });
});

describe('setNameMask', () => {
  it('draws a name frame as shader only until a mask is set, then through it', () => {
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    const stack: StackConfig = { ...BARE_STACK, frame: 'through-name' };
    compositor.render(frame({ stack }));
    expect(drewWith(fake.draws.at(-1) as Draw, FRAMES['shader-only'])).toBe(
      true
    );

    const mask = { kind: 'mask-canvas' } as unknown as TexImageSource;
    compositor.setNameMask(mask);
    fake.reset();
    compositor.render(frame({ stack }));
    // Uploaded on the next render, the right way up, and read on unit 2.
    const uploads = fake.named('texImage2D').filter((a) => a.at(-1) === mask);
    expect(uploads).toHaveLength(1);
    const out = fake.draws.at(-1) as Draw;
    expect(drewWith(out, FRAMES['through-name'])).toBe(true);
    expect(out.units[2]?.kind).toBe('texture');

    // Not uploaded again until it is set again (a resize, a font load).
    fake.reset();
    compositor.render(frame({ stack }));
    expect(
      fake.named('texImage2D').filter((a) => a.at(-1) === mask)
    ).toHaveLength(0);

    compositor.setNameMask(null);
    fake.reset();
    compositor.render(frame({ stack }));
    expect(drewWith(fake.draws.at(-1) as Draw, FRAMES['shader-only'])).toBe(
      true
    );
  });
});

/** A film frame's kind: it samples the film inside the stage. Its own id,
 *  so its pass is cached apart from the real frames'. */
const filmFrame = {
  ...FRAMES['shader-only'],
  id: 'test-film',
  uniforms: [
    'u_scene',
    'u_media',
    'u_rect',
    'u_fade',
    'u_mediaSize',
    'u_hasMedia',
  ],
  glsl: `void main() { fragColor = vec4(texture(u_media, v_uv).rgb * u_fade + u_rect.x * 0.0, u_hasMedia); }`,
};

function fakeVideo({ rvfc = true } = {}) {
  let pending: (() => void) | null = null;
  let handle = 0;
  const video = {
    videoWidth: 720,
    videoHeight: 1280,
    readyState: 4,
    currentTime: 0,
    cancelVideoFrameCallback: vi.fn(),
    ...(rvfc
      ? {
          requestVideoFrameCallback: vi.fn((cb: () => void) => {
            pending = cb;
            return ++handle;
          }),
        }
      : {}),
  };
  return {
    video,
    el: video as unknown as HTMLVideoElement,
    nextFrame: () => pending?.(),
  };
}

const uploadsOf = (fake: ReturnType<typeof fakeGl>, source: unknown) =>
  fake.named('texImage2D').filter((a) => a.at(-1) === source).length;

describe('setMedia and setStage', () => {
  // The frame 100px down a 390x844 window, page at the top; fades over 600px.
  const visible = stageBoxFrom(
    { left: 20, top: 100, width: 350, height: 600 },
    0,
    600
  );

  it('uploads a video frame once per new frame, through requestVideoFrameCallback', () => {
    override.frame = filmFrame;
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    const { video, el, nextFrame } = fakeVideo();
    compositor.setMedia(el);
    compositor.setStage(visible);
    expect(video.requestVideoFrameCallback).toHaveBeenCalledTimes(1);

    compositor.render(frame());
    expect(uploadsOf(fake, el)).toBe(1);
    compositor.render(frame());
    expect(uploadsOf(fake, el)).toBe(1);
    nextFrame();
    compositor.render(frame());
    expect(uploadsOf(fake, el)).toBe(2);
    // The callback keeps itself subscribed.
    expect(video.requestVideoFrameCallback).toHaveBeenCalledTimes(2);

    // The stage reaches the pass: its rect in output pixels, its fade, the film's size.
    const set = (name: string) =>
      fake.calls
        .filter(
          ([k, a]) =>
            k.startsWith('uniform') &&
            (a[0] as { uniform: string })?.uniform === name
        )
        .at(-1)?.[1]
        .slice(1);
    expect(set('u_rect')).toEqual([40, 288, 700, 1200]);
    expect(set('u_fade')).toEqual([1]);
    expect(set('u_mediaSize')).toEqual([720, 1280]);
    expect(set('u_hasMedia')).toEqual([1]);

    compositor.setMedia(null);
    expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(2);
  });

  it('culls: no upload once the film has faded out or sits off the canvas', () => {
    override.frame = filmFrame;
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    const { el, nextFrame } = fakeVideo();
    compositor.setMedia(el);
    compositor.setStage(visible);
    compositor.render(frame({ scrollY: 600 }));
    expect(uploadsOf(fake, el)).toBe(0);

    compositor.setStage(
      stageBoxFrom({ left: 20, top: 2000, width: 350, height: 600 }, 0, 600)
    );
    nextFrame();
    compositor.render(frame());
    expect(uploadsOf(fake, el)).toBe(0);

    compositor.setStage(visible);
    compositor.render(frame());
    expect(uploadsOf(fake, el)).toBe(1);
  });

  it('uploads nothing, however fresh, for a frame that never samples the film (every brand frame)', () => {
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    const { el } = fakeVideo();
    compositor.setMedia(el);
    compositor.setStage(visible);
    for (const id of ['shader-only', 'through-name', 'name-glows'] as const) {
      compositor.render(frame({ stack: { ...BARE_STACK, frame: id } }));
    }
    expect(uploadsOf(fake, el)).toBe(0);
  });

  it('without requestVideoFrameCallback, uploads when the video’s clock has moved', () => {
    override.frame = filmFrame;
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    const { video, el } = fakeVideo({ rvfc: false });
    compositor.setMedia(el);
    compositor.setStage(visible);
    compositor.render(frame());
    compositor.render(frame());
    expect(uploadsOf(fake, el)).toBe(1);
    video.currentTime = 0.04;
    compositor.render(frame());
    expect(uploadsOf(fake, el)).toBe(2);
  });

  it('logs a broken image once, keeps it in case it loads, and uploads nothing till then', () => {
    override.frame = filmFrame;
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    const image = { complete: true, naturalWidth: 0, naturalHeight: 0 };
    const img = image as unknown as HTMLImageElement;
    compositor.setMedia(img);
    compositor.setStage(visible);
    compositor.render(frame());
    compositor.render(frame());
    expect(uploadsOf(fake, img)).toBe(0);
    expect(
      logger.warn.mock.calls.filter(
        ([event]) => event === 'shader_hero.compositor_failed'
      )
    ).toEqual([['shader_hero.compositor_failed', { what: 'media' }]]);
    Object.assign(image, { naturalWidth: 1600, naturalHeight: 900 });
    compositor.render(frame());
    expect(uploadsOf(fake, img)).toBe(1);
  });

  it('drops a source that will not upload, and stops watching its frames', () => {
    // (Logged as 'media', once a session: the broken image above said it.)
    override.frame = filmFrame;
    const { video, el, nextFrame } = fakeVideo();
    const fake = fakeGl({ tainted: el });
    const compositor = createCompositor(fake.gl);
    compositor.setMedia(el);
    compositor.setStage(visible);
    compositor.render(frame());
    expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(1);
    nextFrame();
    compositor.render(frame());
    // The one attempt that threw, and none after it.
    expect(uploadsOf(fake, el)).toBe(1);
  });

  it('uploads nothing before the video has a frame, and an image once it has loaded', () => {
    override.frame = filmFrame;
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    const { video, el } = fakeVideo();
    video.readyState = 1;
    compositor.setMedia(el);
    compositor.setStage(visible);
    compositor.render(frame());
    expect(uploadsOf(fake, el)).toBe(0);

    const image = { complete: false, naturalWidth: 0, naturalHeight: 0 };
    const img = image as unknown as HTMLImageElement;
    compositor.setMedia(img);
    compositor.render(frame());
    expect(uploadsOf(fake, img)).toBe(0);
    Object.assign(image, {
      complete: true,
      naturalWidth: 1600,
      naturalHeight: 900,
    });
    compositor.render(frame());
    compositor.render(frame());
    expect(uploadsOf(fake, img)).toBe(1);
  });
});

describe('forget and destroy', () => {
  it('forgets every GL object without deleting one, then rebuilds them all, mask included', () => {
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    const mask = { kind: 'mask' } as unknown as TexImageSource;
    compositor.setNameMask(mask);
    const stack: StackConfig = {
      ...BARE_STACK,
      frame: 'through-name',
      layers: [{ id: 'grain', amount: null }],
    };
    compositor.render(frame({ stack }));

    fake.lose();
    compositor.forget();
    fake.restore();
    fake.reset();
    compositor.render(frame({ stack }));
    for (const call of [
      'deleteProgram',
      'deleteFramebuffer',
      'deleteTexture',
      'deleteBuffer',
    ]) {
      expect(fake.named(call)).toEqual([]);
    }
    // Rebuilt: its passes, its targets and the mask, from the source it held.
    expect(fake.named('createProgram').length).toBeGreaterThanOrEqual(2);
    expect(fake.named('createFramebuffer').length).toBeGreaterThanOrEqual(2);
    expect(uploadsOf(fake, mask)).toBe(1);
  });

  it('deletes what it made on destroy, and leaves the canvas as the output', () => {
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    compositor.render(frame());
    fake.reset();
    compositor.destroy();
    expect(fake.named('deleteProgram').length).toBeGreaterThanOrEqual(2);
    expect(fake.named('deleteFramebuffer').length).toBeGreaterThanOrEqual(2);
    expect(fake.named('deleteBuffer')).toHaveLength(1);
    bindOutput(fake.gl);
    expect(fake.named('bindFramebuffer').at(-1)?.[1]).toBeNull();
  });

  it('deletes nothing on destroy once the context is lost', () => {
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    compositor.render(frame());
    fake.lose();
    fake.reset();
    compositor.destroy();
    expect(fake.named('deleteProgram')).toEqual([]);
    expect(fake.named('deleteFramebuffer')).toEqual([]);
  });
});

describe('the Showreel look', () => {
  const visible = stageBoxFrom(
    { left: 20, top: 100, width: 350, height: 600 },
    0,
    600
  );
  const set = (fake: ReturnType<typeof fakeGl>, name: string) =>
    fake.calls
      .filter(
        ([k, a]) =>
          k.startsWith('uniform') &&
          (a[0] as { uniform: string })?.uniform === name
      )
      .at(-1)?.[1]
      .slice(1);

  it("draws the look's film frame in place of the brand's, only while a film is attached", () => {
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    const stack = { ...BARE_STACK, frame: 'shader-only' as const, layers: [] };
    compositor.setLook({ frame: 'film-fill', band: 'none' });
    compositor.render(frame({ stack }));
    // No film: the brand's own frame.
    expect(drewWith(fake.draws.at(-1) as Draw, FRAMES['shader-only'])).toBe(
      true
    );

    compositor.setMedia(fakeVideo().el);
    compositor.setStage(visible);
    compositor.render(frame({ stack }));
    expect(drewWith(fake.draws.at(-1) as Draw, FRAMES['film-fill'])).toBe(true);

    compositor.setLook(null);
    compositor.render(frame({ stack }));
    expect(drewWith(fake.draws.at(-1) as Draw, FRAMES['shader-only'])).toBe(
      true
    );
  });

  it("hands the band to the film frame: off for none, each band's code and its ramp for the screen", () => {
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    compositor.setMedia(fakeVideo().el);
    compositor.setStage(visible);
    compositor.setLook({ frame: 'film-fill', band: 'none' });
    compositor.render(frame());
    expect(set(fake, 'u_band')).toEqual([0]);

    // The codes are the film frame's GLSL contract (1 under, 2 fade, 3 edges):
    // pinned as numbers, not read back from the table that makes them. The
    // ramps (desk, phone) start a tenth below the mock's.
    const bands = [
      ['under', 1, [0.4, 0.82], [0.38, 0.76]],
      ['fade', 2, [0.5, 0.95], [0.44, 0.84]],
      ['edges', 3, [0.5, 0.95], [0.44, 0.84]],
    ] as const;
    for (const [band, code, desk, phone] of bands) {
      compositor.setLook({ frame: 'film-fill', band });
      compositor.render(frame({ phone: true }));
      expect(set(fake, 'u_band')).toEqual([code]);
      expect(set(fake, 'u_ramp')).toEqual(phone);
      compositor.render(frame({ phone: false }));
      expect(set(fake, 'u_ramp')).toEqual(desk);
    }
  });

  it('is media-ready once a frame of the film is on the GPU, and not after a lost context', () => {
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    compositor.setLook({ frame: 'film-fill', band: 'none' });
    expect(compositor.mediaReady()).toBe(false);
    compositor.setMedia(fakeVideo().el);
    expect(compositor.mediaReady()).toBe(false);
    compositor.setStage(visible);
    compositor.render(frame());
    expect(compositor.mediaReady()).toBe(true);
    compositor.forget();
    expect(compositor.mediaReady()).toBe(false);
    compositor.setMedia(null);
    expect(compositor.mediaReady()).toBe(false);
  });
});

describe('the Showreel look over the piece', () => {
  const visible = stageBoxFrom(
    { left: 20, top: 100, width: 350, height: 600 },
    0,
    600
  );
  const stack = { ...BARE_STACK, frame: 'shader-only' as const, layers: [] };
  /** A 1440x900 desktop window at 2x, the stage filling it. */
  const desktop = (over: Partial<CompositeFrame> = {}) =>
    frame({
      stack,
      phone: false,
      scene: [1440, 900],
      secondSize: [720, 450],
      output: [2880, 1800],
      canvasBox: { left: 0, bottom: 900, width: 1440, height: 900 },
      ...over,
    });
  const wide = stageBoxFrom(
    { left: 0, top: 0, width: 1440, height: 900 },
    0,
    600
  );
  const still = (naturalWidth: number, naturalHeight: number) =>
    ({
      complete: true,
      naturalWidth,
      naturalHeight,
    }) as unknown as HTMLImageElement;
  /** The value last set for `name`, by any pass. */
  const last = (fake: ReturnType<typeof fakeGl>, name: string) =>
    fake.calls
      .filter(
        ([k, a]) =>
          k.startsWith('uniform') &&
          (a[0] as { uniform: string })?.uniform === name
      )
      .at(-1)?.[1]
      .slice(1);
  /** A piece clock the test moves by hand: the reel's seconds into it. */
  const pieceClock = (start = 0) => {
    const clock = { seconds: start };
    return { clock, seconds: () => clock.seconds };
  };
  const pushes = (fake: ReturnType<typeof fakeGl>) =>
    fake.draws.some((d) => drewWith(d, MEDIA['media-push']));

  it('places a portrait film flush right on a landscape stage, and fills a portrait phone’s stage with it', () => {
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    compositor.setLook({ frame: 'film-fill', band: 'none' });
    // 720x1280 in a 1440x900 stage: filling would crop 65% of it.
    compositor.setMedia(fakeVideo().el);
    compositor.setStage(wide);
    compositor.render(desktop());
    const out = fake.draws.at(-1) as Draw;
    expect(out.framebuffer).toBeNull();
    expect(drewWith(out, FRAMES['film-portrait'])).toBe(true);

    // The same film on a phone held upright: its stage is portrait, so the
    // film fills it.
    compositor.setStage(visible);
    compositor.render(frame({ stack }));
    expect(drewWith(fake.draws.at(-1) as Draw, FRAMES['film-fill'])).toBe(true);

    // A still too (1200x1500, 4:5), on the desktop.
    compositor.setMedia(still(1200, 1500));
    compositor.setStage(wide);
    compositor.render(desktop());
    expect(drewWith(fake.draws.at(-1) as Draw, FRAMES['film-portrait'])).toBe(
      true
    );
  });

  it('places it on a phone held sideways too: the rule is the stage’s shape, not the device (L4)', () => {
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    compositor.setLook({ frame: 'film-fill', band: 'none' });
    compositor.setMedia(fakeVideo().el);
    // a 667x375 phone on its side, at 3x: under 768 wide, so a phone
    compositor.setStage(
      stageBoxFrom({ left: 0, top: 0, width: 667, height: 375 }, 0, 600)
    );
    compositor.render(
      frame({
        stack,
        phone: true,
        scene: [667, 375],
        secondSize: [334, 188],
        output: [2001, 1125],
        canvasBox: { left: 0, bottom: 375, width: 667, height: 375 },
      })
    );
    expect(drewWith(fake.draws.at(-1) as Draw, FRAMES['film-portrait'])).toBe(
      true
    );
  });

  it('fills with a square or a landscape piece, however much it crops (M3)', () => {
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    compositor.setLook({ frame: 'film-fill', band: 'none' });
    // an ultrawide window, 2560x950, the stage filling it
    compositor.setStage(
      stageBoxFrom({ left: 0, top: 0, width: 2560, height: 950 }, 0, 600)
    );
    const ultrawide = desktop({
      scene: [2560, 950],
      secondSize: [1280, 475],
      output: [2560, 950],
      canvasBox: { left: 0, bottom: 950, width: 2560, height: 950 },
    });
    // 1:1 crops 63% of itself there, 4:3 50%, 3:2 44%
    for (const [w, h] of [
      [1000, 1000],
      [1600, 1200],
      [1500, 1000],
    ]) {
      compositor.setMedia(still(w, h));
      compositor.render(ultrawide);
      expect(
        drewWith(fake.draws.at(-1) as Draw, FRAMES['film-fill']),
        `${w}x${h}`
      ).toBe(true);
    }
  });

  it('draws the surface on the film before its frame, which samples that in its place', () => {
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    compositor.setMedia(fakeVideo().el);
    compositor.setStage(visible);
    compositor.setLook({ frame: 'film-fill', band: 'none' });
    compositor.render(frame({ stack }));
    // No surface: the base, then the frame reading the film as it is.
    expect(fake.draws).toHaveLength(2);
    const film = (fake.draws.at(-1) as Draw).units[3];
    expect(film?.kind).toBe('texture');

    fake.reset();
    compositor.setLook({
      frame: 'film-fill',
      band: 'none',
      surface: 'duotone',
    });
    compositor.render(frame({ stack }));
    expect(fake.draws).toHaveLength(3);
    const [, surface, out] = fake.draws;
    expect(drewWith(surface, MEDIA['surface-duotone'])).toBe(true);
    // From the film, into a target the size the stage shows it at: the
    // 720x1280 film covering the 700x1200 stage.
    expect(surface.units[0]).toBe(film);
    expect(surface.framebuffer?.kind).toBe('framebuffer');
    expect(surface.viewport).toEqual([0, 0, 700, 1244]);
    // The frame samples the treated film, not the film.
    expect(drewWith(out, FRAMES['film-fill'])).toBe(true);
    expect(out.units[3]).toBe(surface.framebuffer?.tex);
    expect(out.units[3]).not.toBe(film);
  });

  it('tints the surfaces from the brand’s own tokens, never the shader’s custom palette (L6)', () => {
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    compositor.setMedia(fakeVideo().el);
    compositor.setStage(visible);
    const brand = { primary: [0.8, 0.1, 0.2], bg: [0.96, 0.94, 0.9] } as const;
    // the frame's own palette: the custom shader colours, unlike the brand
    expect(config.colors.primary).not.toEqual(brand.primary);

    compositor.setLook({ frame: 'film-fill', band: 'none', surface: 'colour' });
    compositor.render(frame({ stack }));
    expect(last(fake, 'u_tint')).toEqual(brand.primary);

    compositor.setLook({
      frame: 'film-fill',
      band: 'none',
      surface: 'duotone',
    });
    compositor.render(frame({ stack }));
    const [deep, mid, pale] = duotoneStops(brand.primary, brand.bg);
    expect(last(fake, 'u_toneDeep')).toEqual(deep);
    expect(last(fake, 'u_toneMid')).toEqual(mid);
    expect(last(fake, 'u_tonePale')).toEqual(pale);
  });

  it('pushes a still in by the reel’s clock, then the surface over that', () => {
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    const { clock, seconds } = pieceClock();
    compositor.setMedia(still(1600, 900));
    compositor.setStage(visible);
    compositor.setLook({
      frame: 'film-fill',
      band: 'none',
      surface: 'grain',
      push: seconds,
    });
    compositor.render(frame({ stack, time: 10 }));
    const [, push, grain, out] = fake.draws;
    expect(drewWith(push, MEDIA['media-push'])).toBe(true);
    expect(last(fake, 'u_zoom')).toEqual([1]);
    // The surface reads the pushed picture, in the other target.
    expect(grain.units[0]).toBe(push.framebuffer?.tex);
    expect(grain.framebuffer).not.toBe(push.framebuffer);
    expect(out.units[3]).toBe(grain.framebuffer?.tex);

    clock.seconds = 3.5;
    compositor.render(frame({ stack, time: 13.5 }));
    expect(last(fake, 'u_zoom')?.[0]).toBeCloseTo(pushZoom(3.5), 6);
  });

  it('holds the push-in while the reel holds: paused 1 s in, 5 s later it goes on from there (M2)', () => {
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    const { clock, seconds } = pieceClock();
    compositor.setMedia(still(1600, 900));
    compositor.setStage(visible);
    compositor.setLook({ frame: 'film-fill', band: 'none', push: seconds });
    compositor.render(frame({ stack, time: 20 }));
    clock.seconds = 1;
    compositor.render(frame({ stack, time: 21 }));
    const paused = last(fake, 'u_zoom')?.[0] as number;
    expect(paused).toBeCloseTo(1.021, 3);
    // Paused (or the tab hidden): the page's clock runs on, the reel's holds.
    compositor.render(frame({ stack, time: 26 }));
    expect(last(fake, 'u_zoom')?.[0]).toBe(paused);
    // Played again: on from where it was, no snap.
    clock.seconds = 1 + 1 / 60;
    compositor.render(frame({ stack, time: 26 + 1 / 60 }));
    const next = last(fake, 'u_zoom')?.[0] as number;
    expect(next).toBeGreaterThan(paused);
    expect(next - paused).toBeLessThan(0.001);
  });

  it('pushes in no film, and no still under reduced motion: it holds', () => {
    const look = {
      frame: 'film-fill',
      band: 'none',
      push: pieceClock(2).seconds,
    } as const;
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    compositor.setMedia(fakeVideo().el);
    compositor.setStage(visible);
    compositor.setLook(look);
    compositor.render(frame({ stack }));
    expect(pushes(fake)).toBe(false);

    fake.reset();
    compositor.setMedia(still(1600, 900));
    compositor.render(frame({ stack, reducedMotion: true }));
    expect(pushes(fake)).toBe(false);
    expect(fake.draws).toHaveLength(2);
  });

  it('frees its two targets when the look drops the surface and the push-in, and when the film detaches (L7)', () => {
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    const treat = {
      frame: 'film-fill',
      band: 'none',
      surface: 'grain',
      push: pieceClock(1).seconds,
    } as const;
    compositor.setMedia(still(1600, 900));
    compositor.setStage(visible);
    compositor.setLook(treat);
    compositor.render(frame({ stack }));
    const [, push, grain] = fake.draws;
    const targets = [push.framebuffer, grain.framebuffer];
    const deleted = () =>
      fake
        .named('deleteFramebuffer')
        .filter(([fb]) => targets.some((target) => target === fb));
    expect(deleted()).toHaveLength(0);

    compositor.setLook({ frame: 'film-fill', band: 'none' });
    compositor.render(frame({ stack }));
    expect(deleted()).toHaveLength(2);

    // Again, and the film goes: freed with it.
    fake.reset();
    compositor.setLook(treat);
    compositor.render(frame({ stack }));
    const made = fake.draws.slice(1, 3).map((d) => d.framebuffer);
    compositor.setMedia(null);
    expect(
      fake
        .named('deleteFramebuffer')
        .filter(([fb]) => made.some((target) => target === fb))
    ).toHaveLength(2);
  });

  it('tries a target that failed once for this look and piece, then shows the film as it is (L7)', () => {
    let failing = false;
    const fake = fakeGl({ incomplete: () => failing });
    const compositor = createCompositor(fake.gl);
    compositor.setMedia(fakeVideo().el);
    compositor.setStage(visible);
    compositor.setLook({ frame: 'film-fill', band: 'none' });
    // the frame's own targets, made while the driver could
    compositor.render(frame({ stack }));
    const film = (fake.draws.at(-1) as Draw).units[3];

    failing = true;
    fake.reset();
    compositor.setLook({
      frame: 'film-fill',
      band: 'none',
      surface: 'duotone',
    });
    for (let i = 0; i < 4; i++) compositor.render(frame({ stack }));
    // One attempt, not one a frame.
    expect(fake.named('createFramebuffer')).toHaveLength(1);
    // The film still shows, untreated.
    expect((fake.draws.at(-1) as Draw).units[3]).toBe(film);
    expect(fake.draws.some((d) => drewWith(d, MEDIA['surface-duotone']))).toBe(
      false
    );

    // A new look is a new try.
    failing = false;
    compositor.setLook({ frame: 'film-fill', band: 'none', surface: 'grain' });
    compositor.render(frame({ stack }));
    expect(fake.named('createFramebuffer')).toHaveLength(2);
    expect(fake.draws.some((d) => drewWith(d, MEDIA['surface-grain']))).toBe(
      true
    );
  });
});

// With the Showreel's motion, a film frame is drawn as its composed film pass,
// for the effects that run HERE (the compositor's own phone, reduced-motion and
// mask), reading the values the Showreel writes in place, and saying what it
// ran.
describe('the Showreel motion', () => {
  const visible = stageBoxFrom(
    { left: 20, top: 100, width: 350, height: 600 },
    0,
    600
  );
  const stack: StackConfig = {
    ...BARE_STACK,
    frame: 'shader-only',
    layers: [],
  };
  /** The arguments after the location of the last `method` set on `name`. */
  const lastSet = (
    fake: ReturnType<typeof fakeGl>,
    method: string,
    name: string
  ) =>
    fake.calls
      .filter(
        ([k, a]) =>
          k === method && (a[0] as { uniform: string } | null)?.uniform === name
      )
      .at(-1)?.[1]
      .slice(1);
  const motionOf = (choice: MotionChoice): FilmMotion => ({
    choice,
    values: restMotion(),
    running: null,
  });
  /** A compositor showing a film in the Fill frame. */
  function filming(fake: ReturnType<typeof fakeGl>) {
    const compositor = createCompositor(fake.gl);
    compositor.setMedia(fakeVideo().el);
    compositor.setStage(visible);
    compositor.setLook({ frame: 'film-fill', band: 'none' });
    return compositor;
  }
  /** Each compile of a composed film pass (its hooks are in no other pass). */
  const filmCompiles = (fake: ReturnType<typeof fakeGl>) =>
    fake
      .named('shaderSource')
      .filter(([, source]) => String(source).includes('void reelPointer'))
      .length;

  it('draws a portrait piece on a desktop as the portrait film pass, its motion running', () => {
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    compositor.setLook({ frame: 'film-fill', band: 'none' });
    // 720x1280 in a 1440x900 stage: filling would crop most of it.
    compositor.setMedia(fakeVideo().el);
    compositor.setStage(
      stageBoxFrom({ left: 0, top: 0, width: 1440, height: 900 }, 0, 600)
    );
    const motion = motionOf({ ...STILL_MOTION, trans: 'burn' });
    compositor.setMotion(motion);
    compositor.render(
      frame({
        stack,
        phone: false,
        scene: [1440, 900],
        secondSize: [720, 450],
        output: [2880, 1800],
        canvasBox: { left: 0, bottom: 900, width: 1440, height: 900 },
      })
    );
    const out = fake.draws.at(-1) as Draw;
    expect(out.framebuffer).toBeNull();
    // The composed pass, placing the film as the portrait frame places it:
    // a cut into a portrait piece runs, never drops to the plain frame.
    expect(out.fragment).toContain('void reelTrans');
    expect(out.fragment).toContain(PORTRAIT_GLSL);
    expect(drewWith(out, FRAMES['film-portrait'])).toBe(false);
    expect(motion.running).toEqual({ ...STILL_MOTION, trans: 'burn' });
  });

  it('draws the film frame as its composed pass, reading the motion the Showreel wrote', () => {
    const fake = fakeGl();
    const compositor = filming(fake);
    const motion = motionOf({ ...STILL_MOTION, pointer: 'smoke' });
    motion.values.u_reveal = 0.4;
    motion.values.u_trail.set([0.5, 0.25, 1, 0.1]);
    compositor.setMotion(motion);
    expect(compositor.render(frame({ stack, phone: false }))).toBe(true);

    // One pass onto the canvas at the output size, the smoke's hook in it, in
    // place of the plain film frame.
    const out = fake.draws.at(-1) as Draw;
    expect(out.framebuffer).toBeNull();
    expect(out.viewport).toEqual([0, 0, 780, 1688]);
    expect(drewWith(out, POINTERS.smoke)).toBe(true);
    expect(drewWith(out, FRAMES['film-fill'])).toBe(false);
    // The values as written: the trail as one array, by reference.
    expect(lastSet(fake, 'uniform1f', 'u_reveal')).toEqual([0.4]);
    expect(lastSet(fake, 'uniform4fv', 'u_trail')?.[0]).toBe(
      motion.values.u_trail
    );
    // The flashing effects' clock is the governed one, never the real one.
    expect(lastSet(fake, 'uniform1f', 'u_flashTime')).toEqual([
      governFlash(2.9),
    ]);
    // And what it ran, for the Showreel's driver.
    expect(motion.running).toEqual({
      trans: 'fade',
      pointer: 'smoke',
      opening: 'none',
      into: 'fade',
    });
  });

  it('runs what this frame can: reduced motion drops the glitch pointer', () => {
    const fake = fakeGl();
    const compositor = filming(fake);
    const motion = motionOf({ ...STILL_MOTION, pointer: 'glitch' });
    compositor.setMotion(motion);
    compositor.render(frame({ stack, reducedMotion: true }));
    expect(motion.running?.pointer).toBe('none');
    expect(drewWith(fake.draws.at(-1) as Draw, POINTERS.none)).toBe(true);
    compositor.render(frame({ stack, reducedMotion: false }));
    expect(motion.running?.pointer).toBe('glitch');
    expect(drewWith(fake.draws.at(-1) as Draw, POINTERS.glitch)).toBe(true);
  });

  it('runs the opening through the name only once its mask is on the GPU', () => {
    const fake = fakeGl();
    const compositor = filming(fake);
    const motion = motionOf({ ...STILL_MOTION, opening: 'name' });
    compositor.setMotion(motion);
    compositor.render(frame({ stack }));
    expect(motion.running?.opening).toBe('none');
    compositor.setNameMask({
      kind: 'mask-canvas',
    } as unknown as TexImageSource);
    compositor.render(frame({ stack }));
    expect(motion.running?.opening).toBe('name');
  });

  it('draws the plain film frame when the composed pass will not compile, tried once, and says nothing runs', () => {
    const fake = fakeGl({
      failCompile: (src) => src.includes('void reelPointer'),
    });
    const compositor = filming(fake);
    const motion = motionOf(STILL_MOTION);
    compositor.setMotion(motion);
    expect(compositor.render(frame({ stack }))).toBe(true);
    expect(drewWith(fake.draws.at(-1) as Draw, FRAMES['film-fill'])).toBe(true);
    expect(motion.running).toBeNull();
    const tried = filmCompiles(fake);
    expect(tried).toBeGreaterThan(0);
    compositor.render(frame({ stack }));
    expect(filmCompiles(fake)).toBe(tried);
  });

  it('draws the brand’s own frame while no film shows, and runs nothing', () => {
    const fake = fakeGl();
    const compositor = createCompositor(fake.gl);
    compositor.setLook({ frame: 'film-fill', band: 'none' });
    const motion = motionOf(STILL_MOTION);
    // Left from a film that has gone.
    motion.running = { ...STILL_MOTION };
    compositor.setMotion(motion);
    compositor.render(frame({ stack }));
    expect(drewWith(fake.draws.at(-1) as Draw, FRAMES['shader-only'])).toBe(
      true
    );
    expect(motion.running).toBeNull();
  });

  it('draws the plain film frame again once the motion is taken away', () => {
    const fake = fakeGl();
    const compositor = filming(fake);
    compositor.setMotion(motionOf(STILL_MOTION));
    compositor.render(frame({ stack }));
    compositor.setMotion(null);
    compositor.render(frame({ stack }));
    expect(drewWith(fake.draws.at(-1) as Draw, FRAMES['film-fill'])).toBe(true);
  });

  it('compiles each composed pass once, and again after a lost context', () => {
    const fake = fakeGl();
    const compositor = filming(fake);
    compositor.setMotion(motionOf(STILL_MOTION));
    compositor.render(frame({ stack }));
    expect(filmCompiles(fake)).toBe(1);
    compositor.render(frame({ stack }));
    expect(filmCompiles(fake)).toBe(1);
    compositor.forget();
    compositor.render(frame({ stack }));
    expect(filmCompiles(fake)).toBe(2);
  });
});
