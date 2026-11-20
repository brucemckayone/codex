import { beforeEach, describe, expect, it, vi } from 'vitest';

// The order of allocation and destruction is the point of resizeSim, so the
// WebGL buffer helpers are replaced with recorders. `createThrows` stands in
// for mustAllocate throwing when the GPU cannot allocate.
const state = vi.hoisted(() => ({
  calls: [] as string[],
  createThrows: false,
}));
vi.mock('../webgl-utils', () => ({
  createDoubleFBO: (_gl: unknown, w: number, h: number) => {
    if (state.createThrows) {
      throw new Error('[ShaderHero] WebGL could not allocate a texture');
    }
    state.calls.push(`create ${w}x${h}`);
    return { tag: `buf ${w}x${h}` };
  },
  destroyDoubleFBO: (_gl: unknown, buf: { tag: string }) => {
    state.calls.push(`destroy ${buf.tag}`);
  },
}));

const { resizeSim } = await import('../sim-resize');
const { simGridFor } = await import('../sim-grid');

const glWith = (lost: boolean) =>
  ({ isContextLost: () => lost }) as unknown as WebGL2RenderingContext;
const oldBuf = { tag: 'old' } as never;
const phone = simGridFor(390, 844);

describe('resizeSim', () => {
  beforeEach(() => {
    state.calls.length = 0;
    state.createThrows = false;
  });

  it('keeps the grid when the shape has not really changed', () => {
    expect(resizeSim(glWith(false), phone, oldBuf, 390, 800)).toBeNull();
    expect(state.calls).toEqual([]);
  });

  it('keeps the grid on a lost context, which cannot allocate', () => {
    expect(resizeSim(glWith(true), phone, oldBuf, 844, 390)).toBeNull();
    expect(state.calls).toEqual([]);
  });

  it('keeps the grid before a buffer exists', () => {
    expect(resizeSim(glWith(false), phone, null, 844, 390)).toBeNull();
  });

  it('rebuilds on a real change of shape, allocating before destroying', () => {
    const next = simGridFor(844, 390);
    const resized = resizeSim(glWith(false), phone, oldBuf, 844, 390);
    expect(resized?.grid).toEqual(next);
    expect(state.calls).toEqual([`create ${next.w}x${next.h}`, 'destroy old']);
  });

  it('rebuilds at the texel budget it is given (lenia: 256²)', () => {
    const small = simGridFor(390, 844, 256);
    const next = simGridFor(844, 390, 256);
    const resized = resizeSim(glWith(false), small, oldBuf, 844, 390, 256);
    expect(resized?.grid).toEqual(next);
    expect(state.calls).toEqual([`create ${next.w}x${next.h}`, 'destroy old']);
  });

  it('rebuilds with the cell size it is given (lenia: 16)', () => {
    const small = simGridFor(390, 844, 256, 16);
    const resized = resizeSim(glWith(false), small, oldBuf, 1024, 768, 256, 16);
    // 288x224 in 16-texel sides; 64-texel sides give 320x192 (an oval).
    expect(resized?.grid).toMatchObject({ w: 288, h: 224 });
    expect(state.calls).toEqual(['create 288x224', 'destroy old']);
  });

  it('leaves the old buffer intact when the allocation throws', () => {
    state.createThrows = true;
    expect(() => resizeSim(glWith(false), phone, oldBuf, 844, 390)).toThrow(
      /could not allocate/
    );
    expect(state.calls).not.toContain('destroy old');
  });
});
