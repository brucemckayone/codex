/**
 * R2 signing abstraction for the content-access service.
 *
 * Extracted from ContentAccessService (Codex-2pryk.1.1) — behaviour-preserving.
 */

import { InternalServiceError } from '@codex/service-errors';

/**
 * Interface for R2 signing functionality.
 * Can be implemented by R2Service (workers) or R2SigningClient (tests/scripts).
 */
export interface R2Signer {
  /**
   * A presigned GET. `contentDisposition`, when given, is the signed
   * `Content-Disposition` R2 answers with: an owner's download of a leaving
   * piece asks for an attachment (Codex-a6ofh.6.5).
   */
  generateSignedUrl(
    r2Key: string,
    expirySeconds: number,
    contentDisposition?: string
  ): Promise<string>;
  /**
   * Read an R2 object's body as UTF-8 text, or `null` when absent. Used by the
   * HLS playlist proxy to fetch `.m3u8` files for rewriting (WP-14).
   */
  getObjectText(r2Key: string): Promise<string | null>;
  /**
   * Whether an object is stored under the key, without reading its body. The
   * leaving download asks before it signs a link to an original, so a lost
   * file is a refusal and a warning, never a link that fails (Codex-a6ofh.6.5).
   * `false` means absent; a failed lookup throws.
   */
  objectExists(r2Key: string): Promise<boolean>;
}

/**
 * Development-only R2Signer that returns unsigned dev-cdn URLs.
 * Miniflare R2 serves objects by key without signature verification, so a
 * disposition is not applied: a local download opens the file in place.
 * The one dev signer: `createContentAccessService` and the service registry
 * both build it.
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

  /**
   * A HEAD to dev-cdn. Only a 404 means the object is absent: any other
   * failed answer (a 500, dev-cdn half up) throws, so an outage is never read
   * as a lost file. A fetch that cannot connect throws on its own.
   */
  async objectExists(r2Key: string): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/${r2Key}`, {
      method: 'HEAD',
    });
    if (response.ok) return true;
    if (response.status === 404) return false;
    throw new InternalServiceError('dev-cdn HEAD failed', {
      status: response.status,
    });
  }
}
