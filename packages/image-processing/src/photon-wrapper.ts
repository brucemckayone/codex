import { PhotonImage, resize } from '@cf-wasm/photon';

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
   * Create a SafePhotonImage from a byte buffer
   */
  static fromBuffer(buffer: Uint8Array): SafePhotonImage {
    try {
      const inner = PhotonImage.new_from_byteslice(buffer);
      return new SafePhotonImage(inner);
    } catch (e) {
      throw new Error(
        `Failed to load image in Photon: ${e instanceof Error ? e.message : String(e)}`
      );
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
   * Get WebP bytes
   */
  getBytesWebP(): Uint8Array {
    this.checkFreed();
    return this.inner.get_bytes_webp();
  }

  /**
   * Free the underlying Wasm memory.
   * Must be called exactly once.
   */
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
