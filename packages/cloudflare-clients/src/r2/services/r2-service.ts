// r2-single-bucket.ts

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  R2Bucket,
  R2HTTPMetadata,
  R2ListOptions,
  R2MultipartOptions,
} from '@cloudflare/workers-types';

export type R2Opts = {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
};

/**
 * S3-compatible credentials for R2 presigned URL generation.
 * These are separate from the R2Bucket binding and required for signed URLs.
 * Create tokens at: Cloudflare Dashboard → R2 → Manage R2 API Tokens
 */
export type R2SigningConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
};

export class R2Service {
  private s3Client: S3Client | null = null;
  private bucketName: string | null = null;

  constructor(
    private bucket: R2Bucket,
    private opts: R2Opts = {},
    signingConfig?: R2SigningConfig
  ) {
    this.opts.maxRetries = this.opts.maxRetries ?? 3;
    this.opts.baseDelayMs = this.opts.baseDelayMs ?? 100;
    this.opts.maxDelayMs = this.opts.maxDelayMs ?? 2000;
    this.opts.jitter = this.opts.jitter ?? true;

    // Initialize S3 client for presigned URLs if config provided
    if (signingConfig) {
      this.bucketName = signingConfig.bucketName;
      this.s3Client = new S3Client({
        region: 'auto',
        endpoint: `https://${signingConfig.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: signingConfig.accessKeyId,
          secretAccessKey: signingConfig.secretAccessKey,
        },
      });
    }
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  private backoff(attempt: number) {
    const maxDelay = this.opts.maxDelayMs ?? 2000;
    const raw = Math.min(
      (this.opts.baseDelayMs ?? 100) * 2 ** (attempt - 1),
      maxDelay
    );
    if (!this.opts.jitter) return raw;
    return raw * (0.5 + Math.random() * 0.5);
  }

  private isRetryable(err: unknown) {
    if (!err) return false;
    const e = err as { status?: number };
    if (e?.status && typeof e.status === 'number')
      return e.status >= 500 || e.status === 429;
    return true;
  }

  private async withRetries<T>(fn: () => Promise<T>) {
    let attempt = 0;
    while (true) {
      attempt++;
      try {
        return await fn();
      } catch (err) {
        if (attempt > (this.opts.maxRetries ?? 3) || !this.isRetryable(err))
          throw err;
        await this.sleep(this.backoff(attempt));
      }
    }
  }

  async put(
    key: string,
    body: Parameters<R2Bucket['put']>[1],
    metadata?: Record<string, string>,
    httpMetadata?: R2HTTPMetadata
  ) {
    return this.withRetries(() =>
      this.bucket.put(key, body, { customMetadata: metadata, httpMetadata })
    );
  }

  async get(key: string) {
    return this.withRetries(() => this.bucket.get(key));
  }

  async delete(key: string) {
    return this.withRetries(() => this.bucket.delete(key));
  }

  async list(options?: R2ListOptions) {
    return this.withRetries(() => this.bucket.list(options));
  }

  async createMultipartUpload(key: string, options?: R2MultipartOptions) {
    return this.withRetries(() =>
      this.bucket.createMultipartUpload(key, options)
    );
  }

  resumeMultipartUpload(key: string, uploadId: string) {
    return this.bucket.resumeMultipartUpload(key, uploadId);
  }
  // convenience: put JSON
  async putJson(key: string, obj: unknown, metadata?: Record<string, string>) {
    const body = JSON.stringify(obj);
    const httpMetadata = { contentType: 'application/json' };
    return this.put(key, body, metadata, httpMetadata);
  }

  /**
   * Generate a presigned URL for temporary access to an R2 object.
   * Requires R2SigningConfig to be provided in constructor.
   *
   * @param r2Key - The object key in the bucket (e.g., "{creatorId}/hls/{mediaId}/master.m3u8")
   * @param expirySeconds - URL validity in seconds (max 604800 = 7 days)
   * @returns Presigned URL string
   * @throws Error if signing config not provided or S3 client fails
   */
  async generateSignedUrl(
    r2Key: string,
    expirySeconds: number
  ): Promise<string> {
    if (!this.s3Client || !this.bucketName) {
      throw new Error(
        'R2 signing config required for presigned URLs. ' +
          'Provide R2SigningConfig (accountId, accessKeyId, secretAccessKey, bucketName) in constructor.'
      );
    }

    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: r2Key,
    });

    return getSignedUrl(this.s3Client, command, { expiresIn: expirySeconds });
  }
}
