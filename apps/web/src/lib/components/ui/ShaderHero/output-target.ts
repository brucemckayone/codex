/**
 * The one door from a renderer to "the screen" (Codex-1yd58 WP-2).
 *
 * Every preset ends its frame by drawing into whatever output is bound. Today
 * that is always the canvas (the default framebuffer). The Showreel
 * compositor (WP-3, Codex-1yd58.4, not built yet) will render a preset into
 * its own scene framebuffer, then composite it with the playing footage: it
 * will attach that framebuffer here, and every renderer, unchanged, will draw
 * into it.
 *
 * THE RULE: nothing under `ShaderHero/` calls
 * `gl.bindFramebuffer(gl.FRAMEBUFFER, null)` except this file (the
 * `check:output-door` CI gate fails on one). A renderer binds its own framebuffers for its
 * simulation passes and calls `bindOutput()` to come back, both for the
 * visible draw and when it is done with a framebuffer, so after any renderer
 * call the output is bound. Code that reads or clears the canvas after a
 * render never needs to know a compositor exists.
 *
 * Targets are per context: the studio preview and immersive player own
 * their canvases and contexts, and never see the hero's compositor.
 */
const targets = new WeakMap<WebGL2RenderingContext, WebGLFramebuffer>();

/** Bind the output for this context: the attached target, else the canvas. */
export function bindOutput(gl: WebGL2RenderingContext): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, targets.get(gl) ?? null);
}

/**
 * Attach a framebuffer as this context's output, or `null` to draw to the
 * canvas again. The caller owns the framebuffer and its size; renderers keep
 * drawing at the width and height `render()` is given.
 *
 * No caller until WP-3's compositor (Codex-1yd58.4): this is the seam it will
 * attach to, pinned by `__tests__/output-target.test.ts`.
 */
export function setOutputTarget(
  gl: WebGL2RenderingContext,
  fbo: WebGLFramebuffer | null
): void {
  if (fbo) targets.set(gl, fbo);
  else targets.delete(gl);
}
