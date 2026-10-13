import { SafePhotonImage } from './photon-wrapper';

interface ImageVariants {
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
 * The largest page-image variant (Codex-61zsk.13, -61zsk.53): a full-bleed
 * picture across a 1440 window, and the column's 720px cap at 2x. Page images
 * ONLY: every other still shares {@link VARIANT_WIDTHS} and is drawn far
 * smaller, so it is not added there.
 */
export const PAGE_IMAGE_XL_WIDTH = 1600;

/** A page image's four variants, and the size of the picture they came from. */
export interface PageImageVariants {
  variants: ImageVariants & { xl: Uint8Array };
  /** The source picture's own width and height, in pixels. */
  width: number;
  height: number;
}

/**
 * Decode one image and hand `build` a function that resizes it to a target
 * width as WebP, never upscaling and always keeping its shape.
 *
 * Memory Safety:
 * - All Wasm allocations are tracked in an array
 * - Single finally block frees all in reverse order
 * - Individual free() failures are logged but don't prevent other frees
 * - Prevents memory leaks even if inner operations throw
 */
function withVariants<T>(
  inputBuffer: Uint8Array,
  build: (
    variant: (targetWidth: number) => Uint8Array,
    width: number,
    height: number
  ) => T
): T {
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

      // `resize` creates a new instance even at the original size, so every
      // variant is re-encoded with the same WebP settings.
      const resized = image.resize(finalWidth, finalHeight, 1); // 1 = Lanczos3
      allocated.push(resized); // Track for cleanup
      return resized.getBytesWebP();
    };

    // Serial generation (Wasm is synchronous anyway)
    return build(generateVariant, originalWidth, originalHeight);
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
 * @param inputBuffer - Raw image buffer (JPEG, PNG, etc.)
 * @returns Object containing WebP buffers for each variant
 */
export function processImageVariants(inputBuffer: Uint8Array): ImageVariants {
  return withVariants(inputBuffer, (variant) => ({
    sm: variant(VARIANT_WIDTHS.sm),
    md: variant(VARIANT_WIDTHS.md),
    lg: variant(VARIANT_WIDTHS.lg),
  }));
}

/**
 * A PAGE image's variants: the three every still has, plus `xl` at
 * `min(1600, width)` for a picture drawn across the band (Codex-61zsk.13),
 * and the source's own size. The page stores that size on its reference
 * (`ImageRef.w` / `.h`), which is how the renderer knows the reference has an
 * `xl` to offer, and how much room to keep for the picture before it loads.
 */
export function processPageImageVariants(
  inputBuffer: Uint8Array
): PageImageVariants {
  return withVariants(inputBuffer, (variant, width, height) => ({
    variants: {
      sm: variant(VARIANT_WIDTHS.sm),
      md: variant(VARIANT_WIDTHS.md),
      lg: variant(VARIANT_WIDTHS.lg),
      xl: variant(PAGE_IMAGE_XL_WIDTH),
    },
    width,
    height,
  }));
}
