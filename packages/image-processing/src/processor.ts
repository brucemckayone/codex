import { MAX_IMAGE_PIXELS, MAX_IMAGE_WIDTH } from '@codex/validation';
import { InvalidImageError, UNREADABLE_IMAGE_MESSAGE } from './errors';
import { readImageDimensions } from './image-dimensions';
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
 * Refuse a picture whose decode cannot fit, from its header alone
 * (Codex-kk9nv.12). The decode is the one step that cannot be stopped part
 * way, and over a Worker's 128 MB it kills the isolate (error 1102), where no
 * handler or log ever sees it.
 */
function assertDecodable(inputBuffer: Uint8Array): void {
  const size = readImageDimensions(inputBuffer);
  if (!size) throw new InvalidImageError(UNREADABLE_IMAGE_MESSAGE);
  if (size.width * size.height > MAX_IMAGE_PIXELS) {
    throw new InvalidImageError(
      `This image is ${size.width} × ${size.height} pixels, more than the ${MAX_IMAGE_WIDTH} × ${MAX_IMAGE_WIDTH} we can take. Upload it through the studio, which shrinks it for you, or choose a smaller one.`
    );
  }
}

/**
 * Decode one image and make a WebP of it at each width in `widths`, never
 * upscaling and always keeping its shape. The variants come back in `widths`'
 * own key order, with the picture's size.
 *
 * Memory (Codex-kk9nv.12): a Worker has 128 MB for the JS heap and Wasm
 * together, and Photon's `resize` clones its source and builds a float
 * intermediate as wide as the source, at 16 bytes a pixel. So the LARGEST
 * variant is made from the decode, the decode is freed at once, and every
 * smaller variant is made from that largest one and freed as soon as it is
 * encoded. Making all of them from the decode and holding them to the end
 * peaked at 81 MB of Wasm on a 2000x1280 page image; this order peaks at 65.
 *
 * Every Wasm allocation is tracked, and the `finally` frees whatever is still
 * held (`free()` is idempotent), so a throw part way leaks nothing.
 */
function withVariants<K extends string>(
  inputBuffer: Uint8Array,
  widths: Readonly<Record<K, number>>
): { variants: Record<K, Uint8Array>; width: number; height: number } {
  assertDecodable(inputBuffer);
  const allocated: SafePhotonImage[] = [];
  const track = (image: SafePhotonImage): SafePhotonImage => {
    allocated.push(image);
    return image;
  };

  try {
    const decoded = track(SafePhotonImage.fromBuffer(inputBuffer));
    const width = decoded.get_width();
    const height = decoded.get_height();

    const resized = (source: SafePhotonImage, targetWidth: number) => {
      const finalWidth = Math.min(targetWidth, width);
      const finalHeight = Math.round(finalWidth / (width / height));
      // `resize` creates a new instance even at the original size, so every
      // variant is re-encoded with the same WebP settings.
      return track(source.resize(finalWidth, finalHeight, 1)); // 1 = Lanczos3
    };

    const names = Object.keys(widths) as K[];
    const encoded = new Map<K, Uint8Array>();
    let largest: SafePhotonImage | undefined;
    for (const name of [...names].sort((a, b) => widths[b] - widths[a])) {
      if (!largest) {
        largest = resized(decoded, widths[name]);
        decoded.free();
        encoded.set(name, largest.getBytesWebP());
        continue;
      }
      const variant = resized(largest, widths[name]);
      encoded.set(name, variant.getBytesWebP());
      variant.free();
    }

    const variants = {} as Record<K, Uint8Array>;
    for (const name of names) variants[name] = encoded.get(name) as Uint8Array;
    return { variants, width, height };
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
 * Process an input image buffer into its three WebP size variants.
 *
 * Logic:
 * 1. Read the size from the header; refuse it over `MAX_IMAGE_PIXELS`.
 * 2. Load image into Wasm.
 * 3. Resize (Lanczos3) to lg from the decode, then md and sm from lg. Never
 *    upscale, preserve aspect ratio.
 * 4. Convert to WebP.
 * 5. Free Wasm memory as each step finishes, and anything left in `finally`.
 *
 * @param inputBuffer - Raw image buffer (JPEG, PNG, etc.)
 * @returns Object containing WebP buffers for each variant
 */
export function processImageVariants(inputBuffer: Uint8Array): ImageVariants {
  return withVariants(inputBuffer, VARIANT_WIDTHS).variants;
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
  return withVariants(inputBuffer, {
    ...VARIANT_WIDTHS,
    xl: PAGE_IMAGE_XL_WIDTH,
  });
}
