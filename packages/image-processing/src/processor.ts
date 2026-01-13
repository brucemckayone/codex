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
 * 5. Free Wasm memory.
 *
 * @param inputBuffer - Raw image buffer (JPEG, PNG, etc.)
 * @returns Object containing WebP buffers for each variant
 */
export function processImageVariants(inputBuffer: Uint8Array): ImageVariants {
  const image = SafePhotonImage.fromBuffer(inputBuffer);

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
      try {
        return resized.getBytesWebP();
      } finally {
        resized.free();
      }
    };

    // Serial generation (Wasm is synchronous anyway)
    return {
      sm: generateVariant(VARIANT_WIDTHS.sm),
      md: generateVariant(VARIANT_WIDTHS.md),
      lg: generateVariant(VARIANT_WIDTHS.lg),
    };
  } finally {
    image.free();
  }
}
