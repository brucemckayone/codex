import {
  SIM_BASE,
  SIM_CELL,
  type SimGrid,
  simGridChanged,
  simGridFor,
} from './sim-grid';
import {
  createDoubleFBO,
  type DoubleFBO,
  destroyDoubleFBO,
} from './webgl-utils';

// Kept out of sim-grid.ts, which shader modules import and must stay
// free of GL runtime code (webgl-utils reaches the app logger).

export interface ResizedSim {
  readonly grid: SimGrid;
  readonly buf: DoubleFBO;
}

/**
 * The simulated presets' resize, in one place so the three cannot drift.
 * Returns the grid and buffer for the caller to adopt and then reseed, or
 * null to keep what it has: no real change of shape (`simGridChanged`), no
 * buffer yet, or a lost context, which cannot allocate (restoring it is
 * WP-3, Codex-1yd58.4; until then the old grid is kept). It allocates BEFORE
 * destroying, so an allocation that throws leaves the old buffer intact.
 */
export function resizeSim(
  gl: WebGL2RenderingContext,
  grid: SimGrid,
  buf: DoubleFBO | null,
  width: number,
  height: number,
  base: number = SIM_BASE,
  cell: number = SIM_CELL
): ResizedSim | null {
  if (!buf || gl.isContextLost() || !simGridChanged(grid, width, height)) {
    return null;
  }
  const next = simGridFor(width, height, base, cell);
  const nextBuf = createDoubleFBO(gl, next.w, next.h);
  destroyDoubleFBO(gl, buf);
  return { grid: next, buf: nextBuf };
}
