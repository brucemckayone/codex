/**
 * The one door from a renderer to "the screen".
 *
 * Every preset ends its frame by drawing into whatever output is bound: the
 * canvas (the default framebuffer), or, while the brand shader stack's
 * compositor (`compositor/compositor.ts`) renders a preset, its scene
 * framebuffer, attached here. Every renderer, unchanged, draws into it.
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
 * The compositor attaches its scene targets here around each preset's
 * render and detaches them before its own frame pass, which reaches the
 * canvas through `bindOutput` like any renderer. Pinned by
 * `__tests__/output-target.test.ts`.
 */
export function setOutputTarget(
  gl: WebGL2RenderingContext,
  fbo: WebGLFramebuffer | null
): void {
  if (fbo) targets.set(gl, fbo);
  else targets.delete(gl);
}
