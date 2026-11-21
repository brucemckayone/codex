/**
 * The brand shader stack's compositor (Codex-1yd58.4, plan §5.1-5.8).
 *
 * One WebGL2 context, the hero's own: no second canvas. Each frame:
 *
 *   base preset   -> scene target A   (setOutputTarget: every renderer's
 *   second preset -> target B          `bindOutput` lands there, unchanged;
 *                                      no base: a plain ground of the
 *                                      brand's background, for the film)
 *   blend A+B     -> ping              (scene size)
 *   each layer    -> pong, ping, ...   (scene size, ping-pong as in the lab)
 *   the frame     -> the canvas        (output size, display DPR <= 2)
 *
 * The presets render at the scene size, today's cost; only the frame pass
 * runs at the output size. ShaderHero attaches a compositor only for a stack
 * that is more than the base, or for a film (`needsCompositor`), so a bare
 * stack never reaches this file.
 *
 * THE OUTPUT DOOR. The canvas is reached only through `bindOutput` after the
 * scene target is detached (`check:output-door`), so after `render()` the
 * canvas is bound, as after any renderer, and the tone and still readers
 * see the composited frame.
 *
 * WP-5's seams, held as plain state and turned into GL on the next render
 * (so a context restore rebuilds them): `setMedia` (the piece's video or
 * image, uploaded once per new frame, `requestVideoFrameCallback` where the
 * browser has it), `setStage` (the film's frame, `stage.ts`), `setNameMask`
 * (the org's name, for the name frames).
 *
 * WP-5b's two hooks (Codex-1yd58.6), kept to their own files: the frame rule
 * (`portrait.ts`: a portrait piece on a desktop is placed, not cropped) picks
 * the film frame, and the passes over the piece's own picture
 * (`media-pass.ts`: the stills' push-in, the surface over the footage) draw
 * into a target the film frame samples in place of the raw media.
 */
import { bindOutput, setOutputTarget } from '../output-target';
import {
  type CompositorFailure,
  reportCompositorFailure,
} from '../renderer-failure';
import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig } from '../shader-config';
import {
  createFBOWithFormat,
  createProgram,
  createQuad,
  destroyFBO,
  drawQuad,
  type FBO,
  VERTEX_SHADER,
} from '../webgl-utils';
import type { Effect } from './effects/effect';
import {
  FILM_PORTRAIT_FRAME,
  type FilmFrameId,
  PASSTHROUGH_FRAME,
} from './effects/ids';
import { assembleEffect, FRAMES } from './effects/registry';
import {
  isSampler,
  SAMPLER_UNITS,
  type UniformName,
  type UniformValues,
} from './effects/uniforms';
import { effectTime } from './flash';
import { createMediaRunner, planMedia, treatedSize } from './media-pass';
import { type PlanContext, planStack, type StackPlan } from './plan';
import { placedFrame } from './portrait';
import type { StackConfig } from './stack-config';
import {
  BAND_CODE,
  bandRamp,
  type FilmLook,
  type RectPx,
  type StageBox,
  type StageMedia,
  stageFade,
  stageRect,
  stageVisible,
} from './stage';

export type Size = readonly [number, number];

/** The uniforms every pass of a frame shares; `draw` adds the rest. */
type SharedValues = Omit<UniformValues, 'u_resolution' | 'u_amount' | 'u_time'>;

/** What one composited frame draws. */
export interface CompositeFrame {
  /** Null for no base preset: the scene is a plain ground of the brand's
   *  background (`baseConfig.colors.bg`), for the Showreel's film. */
  base: ShaderRenderer | null;
  baseConfig: ShaderConfig;
  /** Null while the second preset loads, or when there is none. */
  second: ShaderRenderer | null;
  secondConfig: ShaderConfig | null;
  stack: StackConfig;
  time: number;
  mouse: MouseState;
  /** The presets' size: today's canvas size (DPR 1 on a phone). */
  scene: Size;
  /** The second preset's size: half the scene's on a phone. */
  secondSize: Size;
  /** The canvas's backing size (display DPR <= 2). */
  output: Size;
  phone: boolean;
  reducedMotion: boolean;
  /** The canvas's client rect, as read on resize (for the stage). */
  canvasBox: { left: number; bottom: number; width: number; height: number };
  scrollY: number;
  /**
   * The second preset threw in its render. The frame goes on without it; the
   * caller drops it and logs it (it alone knows which preset it was).
   */
  onSecondFailed?: (thrown: unknown) => void;
}

export interface Compositor {
  /** Draw one frame. False: the compositor could not draw (nothing reached
   *  the canvas); the caller draws the base alone and detaches it. */
  render(frame: CompositeFrame): boolean;
  /** The piece's film or still, or null for none (WP-5). */
  setMedia(media: StageMedia | null): void;
  /** Where the film's frame sits, or null for none (WP-5). */
  setStage(stage: StageBox | null): void;
  /** The org's name, white on black, the canvas's size (WP-5). */
  setNameMask(mask: TexImageSource | null): void;
  /** How the Showreel shows its film, or null for the brand's own frame. */
  setLook(look: FilmLook | null): void;
  /**
   * A frame of the media is on the GPU, so the canvas shows the film and
   * the page can hide its own copy of it (ShaderHero's `data-film`). A lost
   * context clears it until the media uploads again.
   */
  mediaReady(): boolean;
  /** Free every GL object it made. */
  destroy(): void;
  /** Forget every GL object WITHOUT deleting it (its context was lost):
   *  the next render rebuilds them, the media and mask included. */
  forget(): void;
}

interface Pass {
  prog: WebGLProgram;
  locs: [UniformName, WebGLUniformLocation | null][];
}

interface MediaSlot {
  el: StageMedia;
  /** A new frame waits to be uploaded. */
  fresh: boolean;
  uploaded: boolean;
  /** The video's time at the last upload (no rVFC: a moved clock is a frame). */
  lastTime: number;
  /** The pending `requestVideoFrameCallback`, to cancel. */
  frameRequest: number | null;
}

const isVideo = (el: StageMedia): el is HTMLVideoElement => 'videoWidth' in el;

/** A target the driver could not back, so it would draw nothing. */
class TargetIncompleteError extends Error {
  constructor(status: number) {
    super(`[ShaderHero] compositor target is incomplete (status ${status})`);
    this.name = 'TargetIncompleteError';
  }
}

/**
 * A colour target the size asked for. The new one is made before the old is
 * deleted, so a failed allocation leaves the old one whole.
 *
 * Made on unit 0 and unbound there: a texture left on a unit is a feedback
 * loop for a pass that samples that unit while drawing into it. And checked:
 * storage the driver could not give (out of memory) is a GL error, not a
 * throw, and the hero would go live with a black frame. An incomplete target
 * throws instead, into the caller's `targets` failure.
 */
function sized(gl: WebGL2RenderingContext, old: FBO | null, [w, h]: Size): FBO {
  if (old && old.w === w && old.h === h) return old;
  gl.activeTexture(gl.TEXTURE0);
  const next = createFBOWithFormat(
    gl,
    w,
    h,
    gl.RGBA8,
    gl.RGBA,
    gl.UNSIGNED_BYTE
  );
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  bindOutput(gl);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    destroyFBO(gl, next);
    throw new TargetIncompleteError(status);
  }
  if (old) destroyFBO(gl, old);
  return next;
}

/** A box not laid out yet: a side of 0. (A 0x0 target is incomplete, ES 3.0
 *  §4.4.4.1: it would fail as 'targets'.) */
const unsized = ([w, h]: Size): boolean => !w || !h;

/** The second preset this frame can draw: one with a config and a size. */
function offeredSecond(f: CompositeFrame): ShaderRenderer | null {
  return f.secondConfig && f.secondSize[0] > 0 && f.secondSize[1] > 0
    ? f.second
    : null;
}

/** Upload a frame or image the right way up, as `logo-texture.ts` does. */
function upload(
  gl: WebGL2RenderingContext,
  tex: WebGLTexture,
  source: TexImageSource
) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  } finally {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

export function createCompositor(gl: WebGL2RenderingContext): Compositor {
  let quad: ReturnType<typeof createQuad> | null = null;
  // A pass that will not compile stays null: tried once, then skipped.
  const passes = new Map<string, Pass | null>();
  let a: FBO | null = null;
  let b: FBO | null = null;
  let ping: FBO | null = null;
  let pong: FBO | null = null;

  let maskSource: TexImageSource | null = null;
  let maskTex: WebGLTexture | null = null;
  let maskDirty = false;

  let media: MediaSlot | null = null;
  let mediaTex: WebGLTexture | null = null;
  /** The frame time this media was first drawn at: the push-in's start. */
  let mediaSince: number | null = null;
  /** The targets the passes over the media draw into (WP-5b). */
  const mediaRunner = createMediaRunner();
  let stage: StageBox | null = null;
  let look: FilmLook | null = null;
  /** The last stack given the look's film frame, kept so the plan's cache
   *  (by identity) holds while neither changes. */
  let framedFor: {
    from: StackConfig;
    frame: FilmFrameId;
    stack: StackConfig;
  } | null = null;

  let plan: StackPlan | null = null;
  let planFor: (PlanContext & { stack: StackConfig }) | null = null;

  /** The stack this frame draws: with a film frame (a film attached and a
   *  look), that frame; otherwise the brand's own. */
  function framed(from: StackConfig, frame: FilmFrameId | null): StackConfig {
    if (!frame) return from;
    if (framedFor?.from !== from || framedFor.frame !== frame) {
      framedFor = { from, frame, stack: { ...from, frame } };
    }
    return framedFor.stack;
  }

  /** The stage in output pixels, origin bottom left; 0x0 with none. */
  function stagePx(f: CompositeFrame): RectPx {
    return stage
      ? stageRect(stage, f.canvasBox, f.output[0], f.output[1])
      : [0, 0, 0, 0];
  }

  /** The look's film frame as placed for this media in this stage
   *  (`portrait.ts`), or null with no film or no look. */
  function filmFrame(f: CompositeFrame): FilmFrameId | null {
    if (!media || !look) return null;
    const [, , w, h] = stagePx(f);
    return placedFrame(look.frame, [w, h], mediaSize(), f.phone);
  }

  function passFor(effect: Effect): Pass | null {
    const known = passes.get(effect.id);
    if (known !== undefined) return known;
    const prog = createProgram(
      gl,
      VERTEX_SHADER,
      assembleEffect(effect),
      `shader_hero:compositor:${effect.id}`
    );
    const pass = prog
      ? {
          prog,
          locs: effect.uniforms.map(
            (name) =>
              [name, gl.getUniformLocation(prog, name)] as [
                UniformName,
                WebGLUniformLocation | null,
              ]
          ),
        }
      : null;
    passes.set(effect.id, pass);
    return pass;
  }

  function setUniforms(pass: Pass, values: UniformValues) {
    for (const [name, loc] of pass.locs) {
      if (loc === null) continue;
      if (isSampler(name)) {
        gl.uniform1i(loc, SAMPLER_UNITS[name]);
        continue;
      }
      const v = values[name];
      if (typeof v === 'number') gl.uniform1f(loc, v);
      else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
      else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
      else gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
    }
  }

  function bindUnit(unit: number, tex: WebGLTexture | null) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  /** Draw one pass from `input` into `into` (null: the canvas). */
  function draw(
    effect: Effect,
    input: WebGLTexture,
    into: FBO | null,
    size: Size,
    values: SharedValues,
    amount: number,
    time: number
  ): boolean {
    const pass = passFor(effect);
    if (!pass || !quad) return false;
    if (into) gl.bindFramebuffer(gl.FRAMEBUFFER, into.fbo);
    else bindOutput(gl);
    gl.viewport(0, 0, size[0], size[1]);
    gl.useProgram(pass.prog);
    quad.bind(pass.prog);
    bindUnit(SAMPLER_UNITS.u_scene, input);
    setUniforms(pass, {
      ...values,
      u_resolution: size,
      u_amount: amount,
      u_time: effectTime(effect, time),
    });
    drawQuad(gl);
    return true;
  }

  /**
   * A failure, logged once per kind (`reportCompositorFailure`). Never on a
   * lost context: every call fails then, the hero's loss handler owns it, and
   * a restore rebuilds everything. Logging it would also use up the one
   * report a later, real failure needs.
   */
  function failed(what: CompositorFailure, thrown?: unknown): false {
    if (!gl.isContextLost()) reportCompositorFailure(what, thrown);
    return false;
  }

  /** Whether a media frame is on the GPU, uploading a new one if due. */
  function uploadMedia(): boolean {
    if (!media) return false;
    const { el } = media;
    if (isVideo(el)) {
      // HAVE_CURRENT_DATA: before it there is no frame to upload.
      if (el.readyState < 2) return media.uploaded;
      const due =
        media.frameRequest !== null
          ? media.fresh
          : el.currentTime !== media.lastTime;
      if (media.uploaded && !due) return true;
      media.lastTime = el.currentTime;
    } else if (media.uploaded || !el.complete) {
      return media.uploaded;
    } else if (el.naturalWidth === 0) {
      // Loaded, with nothing in it: a broken image. Kept, in case it loads.
      return failed('media');
    }
    mediaTex ??= gl.createTexture();
    if (!mediaTex) return false;
    try {
      upload(gl, mediaTex, el);
      media.uploaded = true;
    } catch (thrown) {
      // A cross-origin source without CORS taints: it never uploads.
      unwatchMedia();
      media = null;
      return failed('media', thrown);
    }
    media.fresh = false;
    return true;
  }

  /** No base preset: the scene is the brand's background, flat. */
  function plainGround(
    [r, g, b]: readonly [number, number, number],
    [w, h]: Size
  ) {
    // Through the door: the scene target is attached.
    bindOutput(gl);
    gl.viewport(0, 0, w, h);
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // Back to GL's default, for a preset that clears without setting it.
    gl.clearColor(0, 0, 0, 0);
  }

  /** The name mask, uploaded when it changed. */
  function syncMask() {
    const source = maskDirty ? maskSource : null;
    if (!source) return;
    maskDirty = false;
    maskTex ??= gl.createTexture();
    if (!maskTex) return;
    try {
      upload(gl, maskTex, source);
    } catch (thrown) {
      // A tainted canvas: the name frames draw as shader only.
      failed('mask', thrown);
      gl.deleteTexture(maskTex);
      maskTex = null;
      maskSource = null;
    }
  }

  function mediaSize(): Size {
    if (!media) return [1, 1];
    const { el } = media;
    return isVideo(el)
      ? [el.videoWidth || 1, el.videoHeight || 1]
      : [el.naturalWidth || 1, el.naturalHeight || 1];
  }

  function stackPlan(ctx: PlanContext & { stack: StackConfig }): StackPlan {
    const same =
      plan !== null &&
      planFor !== null &&
      planFor.stack === ctx.stack &&
      planFor.phone === ctx.phone &&
      planFor.reducedMotion === ctx.reducedMotion &&
      planFor.hasSecond === ctx.hasSecond &&
      planFor.hasMask === ctx.hasMask;
    if (!same || !plan) {
      plan = planStack(ctx.stack, ctx);
      planFor = ctx;
    }
    return plan;
  }

  function unwatchMedia() {
    if (media && media.frameRequest !== null && isVideo(media.el)) {
      media.el.cancelVideoFrameCallback(media.frameRequest);
    }
  }

  function watchMedia(slot: MediaSlot) {
    const { el } = slot;
    if (!isVideo(el) || !('requestVideoFrameCallback' in el)) return;
    const onFrame = () => {
      slot.fresh = true;
      slot.frameRequest = el.requestVideoFrameCallback(onFrame);
    };
    slot.frameRequest = el.requestVideoFrameCallback(onFrame);
  }

  function dropGl(deleteThem: boolean) {
    if (deleteThem) {
      for (const pass of passes.values()) if (pass) gl.deleteProgram(pass.prog);
      for (const target of [a, b, ping, pong])
        if (target) destroyFBO(gl, target);
      if (quad) gl.deleteBuffer(quad.buffer);
      if (maskTex) gl.deleteTexture(maskTex);
      if (mediaTex) gl.deleteTexture(mediaTex);
    }
    mediaRunner.drop(deleteThem ? (target) => destroyFBO(gl, target) : null);
    passes.clear();
    quad = null;
    a = b = ping = pong = null;
    maskTex = null;
    mediaTex = null;
    maskDirty = maskSource !== null;
    if (media) {
      media.uploaded = false;
      media.fresh = true;
    }
    plan = null;
    setOutputTarget(gl, null);
  }

  // ── The frame's stages, in `render`'s order ─────────────────

  /** Scene target A, and B for a second. Null: one could not be made. */
  function sceneTargets(
    f: CompositeFrame,
    second: ShaderRenderer | null
  ): FBO | null {
    try {
      quad ??= createQuad(gl);
      a = sized(gl, a, f.scene);
      if (second) b = sized(gl, b, f.secondSize);
      return a;
    } catch (thrown) {
      // An allocation that failed: out of memory, or a context lost now.
      failed('targets', thrown);
      return null;
    }
  }

  /** The base preset into A, or, with none, the plain ground. */
  function basePass(f: CompositeFrame, into: FBO) {
    setOutputTarget(gl, into.fbo);
    if (f.base) {
      f.base.render(gl, f.time, f.mouse, f.baseConfig, f.scene[0], f.scene[1]);
    } else {
      plainGround(f.baseConfig.colors.bg, f.scene);
    }
  }

  /**
   * The second preset into B. B when it drew; null when there is none, or it
   * threw (the base drew: this frame goes on without it).
   */
  function secondPass(
    f: CompositeFrame,
    second: ShaderRenderer | null
  ): FBO | null {
    const config = f.secondConfig;
    const into = b;
    if (!second || !config || !into) return null;
    setOutputTarget(gl, into.fbo);
    try {
      second.render(
        gl,
        f.time,
        f.mouse,
        config,
        f.secondSize[0],
        f.secondSize[1]
      );
      return into;
    } catch (thrown) {
      f.onSecondFailed?.(thrown);
      return null;
    }
  }

  /** Both presets into their targets; B when the second drew. */
  function presetPasses(
    f: CompositeFrame,
    sceneA: FBO,
    second: ShaderRenderer | null
  ): FBO | null {
    try {
      basePass(f, sceneA);
      return secondPass(f, second);
    } finally {
      // Whatever a renderer did, the canvas is the output again.
      setOutputTarget(gl, null);
    }
  }

  /**
   * Every target a pass draws into, made before any sampler is bound
   * (`sized` binds as it makes). False: one could not be made.
   */
  function passTargets(
    scene: Size,
    current: StackPlan,
    sceneB: FBO | null
  ): boolean {
    const blends = current.blend !== null && sceneB !== null;
    try {
      if (blends || current.layers.length > 0) ping = sized(gl, ping, scene);
      if (current.layers.length > (blends ? 0 : 1)) {
        pong = sized(gl, pong, scene);
      }
      return true;
    } catch (thrown) {
      return failed('targets', thrown);
    }
  }

  /**
   * The uniforms every pass of the frame shares, with the mask and the film
   * bound to their units. Culling: when no film shows, or the frame never
   * samples it, nothing is uploaded.
   */
  function frameInputs(f: CompositeFrame, current: StackPlan): SharedValues {
    const [ow, oh] = f.output;
    const rect = stagePx(f);
    const fade = stage ? stageFade(f.scrollY, stage.fadeDistance) : 0;
    const hasMedia =
      current.frame.uniforms.includes('u_media') &&
      stageVisible(rect, ow, oh, fade) &&
      uploadMedia();
    const { colors } = f.baseConfig;
    const values: SharedValues = {
      u_pointer: [f.mouse.x, f.mouse.y],
      u_brandPrimary: colors.primary,
      u_brandSecondary: colors.secondary,
      u_brandAccent: colors.accent,
      u_bgColor: colors.bg,
      u_rect: rect,
      u_fade: fade,
      u_mediaSize: mediaSize(),
      u_hasMedia: hasMedia ? 1 : 0,
      u_band: look ? BAND_CODE[look.band] : 0,
      u_ramp: bandRamp(look?.band ?? 'none', f.phone),
      u_zoom: 1,
    };
    // Drawn before u_media is bound, so no unit holds a target it draws into.
    const placed = current.frame.id === FILM_PORTRAIT_FRAME;
    const treated = hasMedia ? treatMedia(f, rect, placed, values) : null;
    bindUnit(SAMPLER_UNITS.u_mask, maskTex);
    bindUnit(SAMPLER_UNITS.u_media, hasMedia ? (treated ?? mediaTex) : null);
    return values;
  }

  /**
   * The piece's picture with the look's push-in and surface drawn on it
   * (`media-pass.ts`), or null to show it as it is: no look asks for either,
   * or a target could not be made (logged once, and the film still shows).
   */
  function treatMedia(
    f: CompositeFrame,
    rect: RectPx,
    placed: boolean,
    values: SharedValues
  ): WebGLTexture | null {
    if (!media || !mediaTex) return null;
    mediaSince ??= f.time;
    const steps = planMedia(look, {
      phone: f.phone,
      reducedMotion: f.reducedMotion,
      still: !isVideo(media.el),
      elapsed: f.time - mediaSince,
    });
    if (steps.length === 0) return null;
    const size = treatedSize(
      mediaSize(),
      [rect[2], rect[3]],
      f.output,
      placed
    );
    try {
      return mediaRunner.run(steps, mediaTex, size, {
        target: (old, at) => sized(gl, old, at),
        draw: (step, from, into, at) =>
          draw(
            step.effect,
            from,
            into,
            at,
            { ...values, u_zoom: step.zoom },
            step.amount,
            f.time
          ),
      });
    } catch (thrown) {
      failed('targets', thrown);
      return null;
    }
  }

  /** A blended with B into ping. The picture so far: ping, or A unblended. */
  function blendPass(
    f: CompositeFrame,
    current: StackPlan,
    sceneA: FBO,
    sceneB: FBO | null,
    values: SharedValues
  ): FBO {
    if (!current.blend || !sceneB || !ping) return sceneA;
    bindUnit(SAMPLER_UNITS.u_second, sceneB.tex);
    const { effect, amount } = current.blend;
    return draw(effect, sceneA.tex, ping, f.scene, values, amount, f.time)
      ? ping
      : sceneA;
  }

  /** Each layer in turn, ping-pong. The picture so far. */
  function layerPasses(
    f: CompositeFrame,
    current: StackPlan,
    input: FBO,
    values: SharedValues
  ): FBO {
    let picture = input;
    for (const { effect, amount } of current.layers) {
      // Ping-pong: never draw into the target being read.
      const into = picture === ping ? pong : ping;
      if (
        into &&
        draw(effect, picture.tex, into, f.scene, values, amount, f.time)
      ) {
        picture = into;
      }
    }
    return picture;
  }

  /** The frame, onto the canvas. One that will not compile falls back to
   *  the picture as it is. False: nothing reached the canvas. The layers
   *  above treat the shader alone; the look's surface treats the film alone,
   *  drawn on the piece's picture before this pass samples it
   *  (`treatMedia`, 5b). */
  function framePass(
    f: CompositeFrame,
    current: StackPlan,
    picture: FBO,
    values: SharedValues
  ): boolean {
    const passthrough = FRAMES[PASSTHROUGH_FRAME];
    return (
      draw(current.frame, picture.tex, null, f.output, values, 1, f.time) ||
      draw(passthrough, picture.tex, null, f.output, values, 1, f.time)
    );
  }

  /**
   * Leave no target bound to a unit: a preset whose program samples a unit
   * it never binds would read its own output next frame (a GL feedback loop,
   * which draws nothing).
   */
  function unbindUnits() {
    for (const unit of Object.values(SAMPLER_UNITS)) bindUnit(unit, null);
    gl.activeTexture(gl.TEXTURE0);
  }

  return {
    render(f) {
      // Lost mid-frame (the hero checks before it calls): nothing to draw,
      // nothing to report, nothing to latch.
      if (gl.isContextLost()) return false;
      // A box not laid out yet: nothing to show, and no failure.
      if (unsized(f.scene) || unsized(f.output)) return true;

      const offered = offeredSecond(f);
      const sceneA = sceneTargets(f, offered);
      if (!sceneA) return false;
      syncMask();
      const sceneB = presetPasses(f, sceneA, offered);

      const current = stackPlan({
        stack: framed(f.stack, filmFrame(f)),
        phone: f.phone,
        reducedMotion: f.reducedMotion,
        hasSecond: sceneB !== null,
        hasMask: maskTex !== null,
      });
      if (!passTargets(f.scene, current, sceneB)) return false;

      const values = frameInputs(f, current);
      const blended = blendPass(f, current, sceneA, sceneB, values);
      const picture = layerPasses(f, current, blended, values);
      const drawn = framePass(f, current, picture, values);
      unbindUnits();
      return drawn || failed('program');
    },

    setMedia(next) {
      if (next === media?.el) return;
      unwatchMedia();
      media = null;
      if (mediaTex && !gl.isContextLost()) gl.deleteTexture(mediaTex);
      mediaTex = null;
      mediaSince = null;
      if (!next) return;
      media = {
        el: next,
        fresh: true,
        uploaded: false,
        lastTime: -1,
        frameRequest: null,
      };
      watchMedia(media);
    },

    setStage(next) {
      stage = next;
    },

    setLook(next) {
      look = next;
    },

    mediaReady() {
      return media?.uploaded === true;
    },

    setNameMask(next) {
      maskSource = next;
      maskDirty = next !== null;
      if (!next && maskTex) {
        if (!gl.isContextLost()) gl.deleteTexture(maskTex);
        maskTex = null;
      }
    },

    destroy() {
      unwatchMedia();
      media = null;
      maskSource = null;
      stage = null;
      look = null;
      dropGl(!gl.isContextLost());
    },

    forget() {
      dropGl(false);
    },
  };
}
