/**
 * Which part of the shader's canvas lies behind a window, and where in the
 * window it lands: CSS px into each backing store, clipped to the canvas.
 */
import { describe, expect, it } from 'vitest';
import { computeShaderPatch } from '../shader-window-math';

/** The fullpage shader: the whole 1200x800 window. */
const viewport = { left: 0, top: 0, width: 1200, height: 800 };
/** A 320x180 window at (100, 200). */
const plate = { left: 100, top: 200, width: 320, height: 180 };

function patch(
  overrides: Partial<Parameters<typeof computeShaderPatch>[0]> = {}
) {
  return computeShaderPatch({
    windowRect: plate,
    sourceRect: viewport,
    sourceWidth: 1200,
    sourceHeight: 800,
    targetWidth: 320,
    targetHeight: 180,
    ...overrides,
  });
}

describe('computeShaderPatch', () => {
  it('copies the patch behind a window inside the canvas, one to one', () => {
    expect(patch()).toEqual({
      sx: 100,
      sy: 200,
      sw: 320,
      sh: 180,
      dx: 0,
      dy: 0,
      dw: 320,
      dh: 180,
    });
  });

  it('reads a canvas drawn at DPR 2 in its own pixels', () => {
    expect(patch({ sourceWidth: 2400, sourceHeight: 1600 })).toEqual({
      sx: 200,
      sy: 400,
      sw: 640,
      sh: 360,
      dx: 0,
      dy: 0,
      dw: 320,
      dh: 180,
    });
  });

  it('draws into a window backing store of another scale', () => {
    expect(patch({ targetWidth: 160, targetHeight: 90 })).toEqual({
      sx: 100,
      sy: 200,
      sw: 320,
      sh: 180,
      dx: 0,
      dy: 0,
      dw: 160,
      dh: 90,
    });
  });

  it('measures from a canvas that does not start at the origin', () => {
    expect(
      patch({ sourceRect: { ...viewport, left: 50, top: 20 } })
    ).toMatchObject({
      sx: 50,
      sy: 180,
    });
  });

  describe('clips a window that runs past the canvas, in both rects alike', () => {
    it('past the left edge', () => {
      // 100px of 320 lie left of the canvas: the rest lands 100px in.
      expect(
        patch({
          windowRect: { ...plate, left: -100 },
          sourceWidth: 2400,
          sourceHeight: 1600,
        })
      ).toEqual({
        sx: 0,
        sy: 400,
        sw: 440,
        sh: 360,
        dx: 100,
        dy: 0,
        dw: 220,
        dh: 180,
      });
    });

    it('past the top edge', () => {
      expect(patch({ windowRect: { ...plate, top: -80 } })).toEqual({
        sx: 100,
        sy: 0,
        sw: 320,
        sh: 100,
        dx: 0,
        dy: 80,
        dw: 320,
        dh: 100,
      });
    });

    it('past the right edge', () => {
      expect(patch({ windowRect: { ...plate, left: 1000 } })).toEqual({
        sx: 1000,
        sy: 200,
        sw: 200,
        sh: 180,
        dx: 0,
        dy: 0,
        dw: 200,
        dh: 180,
      });
    });

    it('past the bottom edge, into a half-scale window', () => {
      expect(
        patch({
          windowRect: { ...plate, top: 700 },
          targetWidth: 160,
          targetHeight: 90,
        })
      ).toEqual({
        sx: 100,
        sy: 700,
        sw: 320,
        sh: 100,
        dx: 0,
        dy: 0,
        dw: 160,
        dh: 50,
      });
    });
  });

  it('is null for a window wholly off the canvas, or only touching its edge', () => {
    for (const windowRect of [
      { ...plate, top: 900 },
      { ...plate, top: -400 },
      { ...plate, left: -500 },
      { ...plate, left: 1300 },
      { ...plate, top: 800 },
      { ...plate, left: -320 },
    ])
      expect(patch({ windowRect })).toBeNull();
  });

  it('is null when there is nothing to copy from or into', () => {
    expect(patch({ sourceWidth: 0 })).toBeNull();
    expect(patch({ sourceHeight: Number.NaN })).toBeNull();
    expect(patch({ targetWidth: 0 })).toBeNull();
    expect(patch({ windowRect: { ...plate, height: 0 } })).toBeNull();
    expect(patch({ sourceRect: { ...viewport, width: 0 } })).toBeNull();
  });
});
