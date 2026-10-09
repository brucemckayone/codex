/**
 * The page-brand colour fields' one browser read: what colour an element is
 * ACTUALLY painted, as the 6-digit hex `OklchColorPicker` takes.
 *
 * The kit derives brand fills with OKLCH relative colour and fallback chains,
 * so the computed value may be `oklch(…)`, `color(srgb …)` or `rgb(…)`.
 * Rather than parse any of those, the browser paints the value on a 1×1
 * canvas and the pixel is read back.
 */
export function paintedHex(
  element: Element | null | undefined
): string | undefined {
  if (!element || typeof document === 'undefined') return undefined;
  const colour = getComputedStyle(element).backgroundColor;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext?.('2d', { willReadFrequently: true });
  if (!colour || !context) return undefined;
  context.fillStyle = colour;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  if (a === 0) return undefined;
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}
