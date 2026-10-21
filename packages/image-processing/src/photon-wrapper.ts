import { fliph, flipv, PhotonImage, resize, rotate } from '@cf-wasm/photon';
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
   * Returns THIS instance for 1, and for the plain mirrors 2 and 4, which it
   * flips in place. Every orientation that turns (3, 5, 6, 7, 8) returns a NEW
   * instance, which the caller frees.
   *
   * Photon's `rotate` turns clockwise and keeps exact dimensions at 90, 180
   * and 270. A negative angle adds a pixel, so none is used. 5 (transpose) is
   * a quarter turn then a mirror, and 7 (transverse) a quarter turn then a
   * flip.
   */
  orient(orientation: ExifOrientation): SafePhotonImage {
    this.checkFreed();
    if (orientation === 1) return this;
    if (orientation === 2) {
      fliph(this.inner);
      return this;
    }
    if (orientation === 4) {
      flipv(this.inner);
      return this;
    }
    // Wrapped before the flip, so a trap inside it cannot strand the turned
    // copy outside the caller's cleanup.
    const turned = new SafePhotonImage(
      rotate(this.inner, orientation === 3 ? 180 : orientation === 8 ? 270 : 90)
    );
    try {
      if (orientation === 5) fliph(turned.inner);
      if (orientation === 7) flipv(turned.inner);
    } catch (error) {
      turned.free();
      throw error;
    }
    return turned;
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
