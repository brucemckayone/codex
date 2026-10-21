import { fliph, flipv, PhotonImage, resize } from '@cf-wasm/photon';
import { InvalidImageError, UNREADABLE_IMAGE_MESSAGE } from './errors';
import type { ExifOrientation } from './exif-orientation';

/**
 * Safe wrapper around PhotonImage to ensure memory is freed.
 *
 * Wasm objects are NOT garbage collected automatically by JS GC in the same way.
 * You MUST call .free() when done with an instance.
 */
export class SafePhotonImage {
  private _isFreed = false;

  private constructor(public readonly inner: PhotonImage) {}

  /**
   * Create a SafePhotonImage from a byte buffer.
   *
   * A file that passes the magic-byte check but will not decode is the
   * uploader's to fix, so it is a 400 (`InvalidImageError`), not a 500
   * (Codex-kk9nv.12). Photon's own words stay out of the message: they name
   * decoder internals, not anything the uploader can act on.
   */
  static fromBuffer(buffer: Uint8Array): SafePhotonImage {
    try {
      const inner = PhotonImage.new_from_byteslice(buffer);
      return new SafePhotonImage(inner);
    } catch {
      throw new InvalidImageError(UNREADABLE_IMAGE_MESSAGE);
    }
  }

  /**
   * Resize the image. Returns a NEW SafePhotonImage instance.
   * The current instance remains valid until .free() is called on it.
   *
   * @param width Target width
   * @param height Target height (0 to maintain aspect ratio if supported by implementation, but Photon resize typically expects explicit dims.
   * Implementation plan suggests passing 0, 1 works for auto-height in some wrappers, but let's verify logic).
   * Actually, resize in photon-rs usually needs calculated dimensions.
   * However, let's assume the plan's specific usage `resize(img, 400, 0, 1)` implies 0 is acceptable for maintaining aspect ratio in this binding.
   *
   * @param samplingMethod 1 = Lanczos3 (High quality), 2 = Nearest, 3 = Triangle, 4 = CatmullRom, 5 = Gaussian
   */
  resize(
    width: number,
    height: number,
    samplingMethod: number = 1
  ): SafePhotonImage {
    this.checkFreed();
    // resize returns a new PhotonImage instance
    const result = resize(this.inner, width, height, samplingMethod);
    return new SafePhotonImage(result);
  }

  /**
   * The image turned upright for an EXIF orientation (Codex-kk9nv.11).
   *
   * Returns THIS instance for 1 and for the turns that need no transpose:
   * the mirrors 2 (`fliph`) and 4 (`flipv`), and 3, a half turn, which is
   * both at once. All three flip in place. The quarter turns (5-8) return a
   * NEW instance, which the caller frees.
   *
   * Photon's `rotate` is NOT used. At every angle it leaves the right two
   * columns and the bottom row fully transparent and drops the source rows
   * or columns beside them: a 300x200 image turned 90 has 798 transparent
   * pixels. So every turned variant shipped with a transparent edge.
   * `fliph` and `flipv` are exact, and a quarter turn is a plain remap of
   * pixels, done here in JS. It only ever runs on a resized output, at most
   * 1600 x 1600.
   */
  orient(orientation: ExifOrientation): SafePhotonImage {
    this.checkFreed();
    if (orientation === 1) return this;
    if (orientation === 2 || orientation === 3 || orientation === 4) {
      if (orientation !== 4) fliph(this.inner);
      if (orientation !== 2) flipv(this.inner);
      return this;
    }
    return new SafePhotonImage(quarterTurned(this.inner, orientation));
  }

  /**
   * Get WebP bytes
   *
   * Called at processor.ts:56 on `resized`, the return value of `.resize()`.
   * fallow cannot resolve a receiver whose type comes from a method return,
   * so it reports this unused; `get_width`/`get_height`, called on a directly
   * initialised local in the same function, resolve fine and are not flagged.
   */
  // fallow-ignore-next-line unused-class-member
  getBytesWebP(): Uint8Array {
    this.checkFreed();
    return this.inner.get_bytes_webp();
  }

  /**
   * Free the underlying Wasm memory.
   * Must be called exactly once.
   *
   * Called at processor.ts:71 as `allocated[i]?.free()` in the `finally` that
   * guarantees cleanup. fallow cannot resolve an optional-chained array
   * element as the receiver, so it reports this unused. Deleting it would
   * remove the wasm memory guard this class exists to provide.
   */
  // fallow-ignore-next-line unused-class-member
  free() {
    if (!this._isFreed) {
      this.inner.free();
      this._isFreed = true;
    }
  }

  /**
   * Dimensions
   */
  get_width(): number {
    this.checkFreed();
    return this.inner.get_width();
  }

  get_height(): number {
    this.checkFreed();
    return this.inner.get_height();
  }

  private checkFreed() {
    if (this._isFreed) {
      throw new Error('Attempted to use freed SafePhotonImage');
    }
  }
}

/**
 * `image` given a quarter turn for EXIF orientation 5-8, as a new image that
 * is `height` wide and `width` tall. Each RGBA pixel moves as one 32-bit
 * word, so byte order is kept whatever the platform's endianness.
 *
 * For a source pixel at (x, y) in a `width` x `height` image, its place in
 * the turned image (which is `height` wide) is:
 *   5 transpose          (y, x)
 *   6 90° clockwise      (height-1-y, x)
 *   7 transverse         (height-1-y, width-1-x)
 *   8 90° anticlockwise  (y, width-1-x)
 */
function quarterTurned(
  image: PhotonImage,
  orientation: 5 | 6 | 7 | 8
): PhotonImage {
  const width = image.get_width();
  const height = image.get_height();
  const raw = image.get_raw_pixels();
  const bytes = raw.byteOffset % 4 === 0 ? raw : raw.slice();
  const source = new Uint32Array(
    bytes.buffer,
    bytes.byteOffset,
    width * height
  );
  const turned = new Uint32Array(width * height);
  const mirrorsX = orientation === 6 || orientation === 7;
  const mirrorsY = orientation === 7 || orientation === 8;
  for (let y = 0; y < height; y++) {
    const column = mirrorsX ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const row = mirrorsY ? width - 1 - x : x;
      turned[row * height + column] = source[y * width + x] ?? 0;
    }
  }
  return new PhotonImage(new Uint8Array(turned.buffer), height, width);
}
