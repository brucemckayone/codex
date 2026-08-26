/**
 * R2 signing abstraction for the content-access service.
 *
 * Extracted from ContentAccessService (Codex-2pryk.1.1) — behaviour-preserving.
 */

/**
 * Interface for R2 signing functionality.
 * Can be implemented by R2Service (workers) or R2SigningClient (tests/scripts).
 */
export interface R2Signer {
  generateSignedUrl(r2Key: string, expirySeconds: number): Promise<string>;
  /**
   * Read an R2 object's body as UTF-8 text, or `null` when absent. Used by the
   * HLS playlist proxy to fetch `.m3u8` files for rewriting (WP-14).
   */
  getObjectText(r2Key: string): Promise<string | null>;
}

/**
 * Development-only R2Signer that returns unsigned dev-cdn URLs.
 * Miniflare R2 serves objects by key without signature verification.
 */
export class DevR2Signer implements R2Signer {
  constructor(private baseUrl: string) {}

  async generateSignedUrl(
    r2Key: string,
    _expirySeconds: number
  ): Promise<string> {
    return `${this.baseUrl}/${r2Key}`;
  }

  async getObjectText(r2Key: string): Promise<string | null> {
    const response = await fetch(`${this.baseUrl}/${r2Key}`);
    if (!response.ok) return null;
    return response.text();
  }
}
