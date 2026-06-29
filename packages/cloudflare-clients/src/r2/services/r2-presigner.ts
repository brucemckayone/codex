/**
 * Lean SigV4 presigner for R2, backed by aws4fetch.
 *
 * WHY this exists (Codex-bpjg5): the HLS variant-playlist proxy presigns many
 * segment URLs inside ONE Worker invocation, bounded by the Workers Free 10ms
 * CPU budget. `@aws-sdk/s3-request-presigner` builds a command object + runs a
 * middleware stack per call (~250µs/URL measured), which blows the budget past
 * ~40 segments. aws4fetch instead derives the SigV4 signing key ONCE and caches
 * it in an internal Map keyed by [secret, date, region, service]; reusing a
 * SINGLE AwsClient across presigns means each URL after the first costs only
 * ~1 SHA-256 (canonical request) + 1 HMAC-SHA256, not the full 4-step
 * derivation. cf. https://github.com/mhart/aws4fetch and
 * https://developers.cloudflare.com/r2/examples/aws/aws4fetch/
 *
 * IMPORTANT: keep ONE instance and reuse it. A fresh AwsClient per call discards
 * the signing-key cache and defeats the entire optimisation.
 *
 * NOTE: aws4fetch signs only `host` + the `X-Amz-*` query params by default
 * (`allHeaders` is false), so `Range` is NOT a signed header — a client may add
 * `Range: bytes=...` to a presigned GET without invalidating the signature.
 */

import { AwsClient } from 'aws4fetch';
import { R2_REGIONS } from '../constants';
import type { R2SigningConfig } from './r2-service';

export class R2Presigner {
  private readonly client: AwsClient;
  private readonly endpoint: string;
  private readonly bucketName: string;

  constructor(config: R2SigningConfig) {
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      // service + region are required by SigV4 but ignored by R2; they only
      // affect the cache key for the derived signing key.
      service: 's3',
      region: R2_REGIONS.AUTO,
    });
    this.endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`;
    this.bucketName = config.bucketName;
  }

  /**
   * Presign a GET. R2 object keys are URL-safe (UUID + fixed variant/file names
   * from the @codex/transcoding key builders), so no per-segment escaping is
   * needed — building the URL directly matches both aws4fetch's canonicalisation
   * and R2's decoding, mirroring Cloudflare's documented example.
   */
  async presignGet(r2Key: string, expirySeconds: number): Promise<string> {
    return this.sign(r2Key, expirySeconds, 'GET');
  }

  /**
   * Presign a PUT with a Content-Type restriction. aws4fetch keeps Content-Type
   * in its UNSIGNABLE_HEADERS set for query signing, so `allHeaders: true` is
   * required to fold it into SignedHeaders — matching @aws-sdk's behaviour where
   * the client MUST send a matching Content-Type or R2 rejects the upload.
   */
  async presignPut(
    r2Key: string,
    contentType: string,
    expirySeconds: number
  ): Promise<string> {
    return this.sign(r2Key, expirySeconds, 'PUT', {
      headers: { 'Content-Type': contentType },
      allHeaders: true,
    });
  }

  private async sign(
    r2Key: string,
    expirySeconds: number,
    method: 'GET' | 'PUT',
    opts: { headers?: Record<string, string>; allHeaders?: boolean } = {}
  ): Promise<string> {
    const url = new URL(`${this.endpoint}/${this.bucketName}/${r2Key}`);
    // X-Amz-Expires (seconds) sets the presigned-link validity. Must be present
    // before signing so it is folded into the signed canonical query string.
    url.searchParams.set('X-Amz-Expires', String(expirySeconds));

    const signed = await this.client.sign(
      new Request(url, { method, headers: opts.headers }),
      { aws: { signQuery: true, allHeaders: opts.allHeaders } }
    );
    return signed.url;
  }
}
