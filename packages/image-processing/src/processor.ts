import { MAX_IMAGE_PIXELS, MAX_IMAGE_WIDTH } from '@codex/validation';
import { InvalidImageError, UNREADABLE_IMAGE_MESSAGE } from './errors';
import { readJpegOrientation } from './exif-orientation';
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
 * Every still's largest variant (Codex-61zsk.13 for page images, then every
 * still in Codex-kk9nv.5): a full-bleed picture across a 1440 window, and a
 * 720px column at 2x.
 */
export const XL_WIDTH = 1600;

/** A still's four variants, and the size of the picture they came from. */
export interface StillVariants {
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
 * Upright (Codex-kk9nv.11): a camera stores the sensor's pixels plus an EXIF
 * tag saying how to turn them, Photon ignores the tag, and the WebP variants
 * carry no EXIF, so a portrait phone photo was stored, measured and served
 * sideways. Every size here is the UPRIGHT picture's. Each variant is resized
 * in the stored orientation to the upright size's mirror image, and only that
 * small output is turned: a quarter turn clones its image several times, so
 * turning the decode itself would cost several full-size copies.
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
  const orientation = readJpegOrientation(inputBuffer);
  // 5 to 8 include a quarter turn: the stored pixels are the picture on its side.
  const sideways = orientation >= 5;
  const allocated: SafePhotonImage[] = [];
  const track = (image: SafePhotonImage): SafePhotonImage => {
    allocated.push(image);
    return image;
  };

  try {
    const decoded = track(SafePhotonImage.fromBuffer(inputBuffer));
    const width = sideways ? decoded.get_height() : decoded.get_width();
    const height = sideways ? decoded.get_width() : decoded.get_height();

    /** `source` resized, still in the stored orientation, to the upright target. */
    const resized = (source: SafePhotonImage, targetWidth: number) => {
      const finalWidth = Math.min(targetWidth, width);
      const finalHeight = Math.round(finalWidth / (width / height));
      // `resize` creates a new instance even at the original size, so every
      // variant is re-encoded with the same WebP settings.
      return track(
        sideways
          ? source.resize(finalHeight, finalWidth, 1) // 1 = Lanczos3
          : source.resize(finalWidth, finalHeight, 1)
      );
    };

    /** `image` turned upright and encoded; a turned copy is freed at once. */
    const upright = (image: SafePhotonImage): Uint8Array => {
      const turned = image.orient(orientation);
      if (turned === image) return image.getBytesWebP();
      track(turned);
      const bytes = turned.getBytesWebP();
      turned.free();
      return bytes;
    };

    const names = Object.keys(widths) as K[];
    const [largestName, ...smaller] = [...names].sort(
      (a, b) => widths[b] - widths[a]
    ) as [K, ...K[]];
    const largest = resized(decoded, widths[largestName]);
    decoded.free();

    const encoded = new Map<K, Uint8Array>();
    for (const name of smaller) {
      const variant = resized(largest, widths[name]);
      encoded.set(name, upright(variant));
      variant.free();
    }
    // Turned last: a mirror (2, 4) flips in place, and every smaller variant
    // was made from it unturned.
    encoded.set(largestName, upright(largest));

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
 * A still's variants (every raster still, Codex-kk9nv.5): sm/md/lg, plus `xl`
 * at `min(1600, width)`, and the upright picture's own size. A page image
 * stores that size on its reference (`ImageRef.w` / `.h`); every other still
 * stores it in its row's width/height columns. Either way it is how the web
 * knows the picture has an `xl` to offer, and how much room to keep for it
 * before it loads.
 *
 * Logic:
 * 1. Read the size from the header; refuse it over `MAX_IMAGE_PIXELS`.
 * 2. Load image into Wasm.
 * 3. Resize (Lanczos3) to xl from the decode, then lg, md and sm from xl,
 *    each turned upright. Never upscale, preserve aspect ratio.
 * 4. Convert to WebP.
 * 5. Free Wasm memory as each step finishes, and anything left in `finally`.
 */
export function processStillVariants(inputBuffer: Uint8Array): StillVariants {
  return withVariants(inputBuffer, { ...VARIANT_WIDTHS, xl: XL_WIDTH });
}
