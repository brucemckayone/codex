import { describe, expect, it } from 'vitest';
import { bindOutput, setOutputTarget } from '../output-target';

// A stand-in context that records what bindOutput binds. FRAMEBUFFER is
// the real WebGL2 enum value so the assertion reads like the GL call.
const FRAMEBUFFER = 0x8d40;
function fakeGl() {
  const binds: Array<[number, unknown]> = [];
  const gl = {
    FRAMEBUFFER,
    bindFramebuffer: (target: number, fbo: unknown) =>
      binds.push([target, fbo]),
  } as unknown as WebGL2RenderingContext;
  return { gl, binds };
}
const fbo = (name: string) => ({ name }) as unknown as WebGLFramebuffer;

describe('bindOutput', () => {
  it('binds the canvas when nothing is attached', () => {
    const { gl, binds } = fakeGl();
    bindOutput(gl);
    expect(binds).toEqual([[FRAMEBUFFER, null]]);
  });

  it('binds the attached target, and the canvas again once it is detached', () => {
    const { gl, binds } = fakeGl();
    const scene = fbo('scene');
    setOutputTarget(gl, scene);
    bindOutput(gl);
    setOutputTarget(gl, null);
    bindOutput(gl);
    expect(binds).toEqual([
      [FRAMEBUFFER, scene],
      [FRAMEBUFFER, null],
    ]);
  });

  it("keeps each context's target to itself", () => {
    // The hero's compositor must never redirect the studio preview's or
    // the immersive player's canvas, which have contexts of their own.
    const hero = fakeGl();
    const preview = fakeGl();
    setOutputTarget(hero.gl, fbo('scene'));
    bindOutput(preview.gl);
    expect(preview.binds).toEqual([[FRAMEBUFFER, null]]);
    setOutputTarget(hero.gl, null);
  });
});
