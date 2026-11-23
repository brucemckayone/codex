/** `x` held to 0-1. NaN stays NaN. */
export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
