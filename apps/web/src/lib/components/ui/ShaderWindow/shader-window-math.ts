/** A box on the page, in CSS px (a `getBoundingClientRect()`). */
type CssRect = Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>;

/** `drawImage`'s nine-argument rectangles: from the source's backing store
 *  (`s*`) into the window's (`d*`). */
interface ShaderPatch {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * The part of the shader's canvas that sits behind a window, and where in the
 * window it lands.
 *
 * Both rects are in CSS px. Each is mapped into its own backing store by its
 * own scale (`sourceWidth / sourceRect.width`, and the same for height), so a
 * source drawn at DPR 2 and a window drawn at 1x line up. The source is taken
 * to fill its rect (no `object-fit` crop), as the org landing's canvas does.
 * Any part of the window beyond the source canvas is clipped off both
 * rectangles alike, so what is copied still lands where it belongs; that part
 * of the window gets nothing. Null when nothing overlaps, or when any size is
 * not positive (nothing to copy from or into).
 */
export function computeShaderPatch({
  windowRect,
  sourceRect,
  sourceWidth,
  sourceHeight,
  targetWidth,
  targetHeight,
}: {
  windowRect: CssRect;
  sourceRect: CssRect;
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
}): ShaderPatch | null {
  const sizes = [
    windowRect.width,
    windowRect.height,
    sourceRect.width,
    sourceRect.height,
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
  ];
  // `!(size > 0)` also refuses NaN.
  if (sizes.some((size) => !(size > 0))) return null;

  // The overlap, in CSS px.
  const left = Math.max(windowRect.left, sourceRect.left);
  const top = Math.max(windowRect.top, sourceRect.top);
  const right = Math.min(
    windowRect.left + windowRect.width,
    sourceRect.left + sourceRect.width
  );
  const bottom = Math.min(
    windowRect.top + windowRect.height,
    sourceRect.top + sourceRect.height
  );
  if (right <= left || bottom <= top) return null;

  const toSourceX = sourceWidth / sourceRect.width;
  const toSourceY = sourceHeight / sourceRect.height;
  const toTargetX = targetWidth / windowRect.width;
  const toTargetY = targetHeight / windowRect.height;
  return {
    sx: (left - sourceRect.left) * toSourceX,
    sy: (top - sourceRect.top) * toSourceY,
    sw: (right - left) * toSourceX,
    sh: (bottom - top) * toSourceY,
    dx: (left - windowRect.left) * toTargetX,
    dy: (top - windowRect.top) * toTargetY,
    dw: (right - left) * toTargetX,
    dh: (bottom - top) * toTargetY,
  };
}
