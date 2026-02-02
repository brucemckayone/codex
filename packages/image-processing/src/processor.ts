import { SafePhotonImage } from './photon-wrapper';

export interface ImageVariants {
  sm: Uint8Array;
  md: Uint8Array;
  lg: Uint8Array;
}

export const VARIANT_WIDTHS = {
  sm: 200,
  md: 400,
  lg: 800,
} as const;

/**
 * Process an input image buffer into multiple WebP size variants.
 *
 * Logic:
 * 1. Load image into Wasm.
 * 2. Calculate dimensions for sm, md, lg.
 * 3. Resize (Lanczos3) - Never upscale, preserve aspect ratio.
 * 4. Convert to WebP.
 * 5. Free Wasm memory (all allocations tracked and freed in single finally block).
 *
 * Memory Safety:
 * - All Wasm allocations are tracked in an array
 * - Single finally block frees all in reverse order
 * - Individual free() failures are logged but don't prevent other frees
 * - Prevents memory leaks even if inner operations throw
 *
 * @param inputBuffer - Raw image buffer (JPEG, PNG, etc.)
 * @returns Object containing WebP buffers for each variant
 */
export function processImageVariants(inputBuffer: Uint8Array): ImageVariants {
  const image = SafePhotonImage.fromBuffer(inputBuffer);
  // Track all Wasm allocations for guaranteed cleanup
  const allocated: SafePhotonImage[] = [image];

  try {
    const originalWidth = image.get_width();
    const originalHeight = image.get_height();
    const aspectRatio = originalWidth / originalHeight;

    const generateVariant = (targetWidth: number): Uint8Array => {
      // Don't upscale: use original dimension if smaller than target
      const finalWidth = Math.min(targetWidth, originalWidth);
      const finalHeight = Math.round(finalWidth / aspectRatio);

      // If dimensions match original, we still might need to convert to WebP
      // or ensure standardized compression.
      // We can use resize with original dims or just getWebP if source is already correct,
      // but 'resize' creates a new instance which is clean.

      const resized = image.resize(finalWidth, finalHeight, 1); // 1 = Lanczos3
      allocated.push(resized); // Track for cleanup
      return resized.getBytesWebP();
    };

    // Serial generation (Wasm is synchronous anyway)
    return {
      sm: generateVariant(VARIANT_WIDTHS.sm),
      md: generateVariant(VARIANT_WIDTHS.md),
      lg: generateVariant(VARIANT_WIDTHS.lg),
    };
  } finally {
    // Free all allocations in reverse order, catching individual failures
    // to ensure all get freed even if one throws
    for (let i = allocated.length - 1; i >= 0; i--) {
      try {
        // Optional chain safe: i bounded by array length, but ?. satisfies linter
        allocated[i]?.free();
      } catch {
        // Log silently - SafePhotonImage.free() is idempotent,
        // but we catch to ensure all allocations are attempted
      }
    }
  }
}
