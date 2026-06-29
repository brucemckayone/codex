/**
 * R2 Signing Client
 *
 * Standalone client for generating presigned R2 URLs using S3-compatible API.
 * This client does NOT require the R2Bucket binding, making it usable in:
 * - Integration tests (vitest outside workers runtime)
 * - Node.js scripts
 * - Any environment with network access to R2
 *
 * For Workers runtime with R2 bucket binding, use R2Service instead.
 */

import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { AWS_ERRORS, INFRA_KEYS } from '@codex/constants';
import { ValidationError } from '@codex/service-errors';
import { R2_REGIONS } from '../constants';
import { R2Presigner } from './r2-presigner';

// Import from r2-service (exported via index.ts)
import type { R2SigningConfig } from './r2-service';

export class R2SigningClient {
  private s3Client: S3Client;
  private bucketName: string;
  // Presigning goes through aws4fetch (lean SigV4, cached signing key); the
  // S3Client is retained only for object I/O (getObjectText / objectExists)
  // which has no Workers-runtime equivalent without an R2 binding.
  private presigner: R2Presigner;

  constructor(config: R2SigningConfig) {
    this.bucketName = config.bucketName;
    this.s3Client = new S3Client({
      region: R2_REGIONS.AUTO,
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    this.presigner = new R2Presigner(config);
  }

  /**
   * Generate a presigned URL for temporary read access to an R2 object.
   *
   * @param r2Key - The object key in the bucket
   * @param expirySeconds - URL validity in seconds (max 604800 = 7 days)
   * @returns Presigned URL string
   */
  async generateSignedUrl(
    r2Key: string,
    expirySeconds: number
  ): Promise<string> {
    return this.presigner.presignGet(r2Key, expirySeconds);
  }

  /**
   * Generate a presigned URL for uploading (PUT) an object to R2.
   *
   * @param r2Key - The object key in the bucket
   * @param contentType - MIME type of the file being uploaded
   * @param expirySeconds - URL validity in seconds (default: 3600 = 1 hour)
   * @returns Presigned upload URL string
   */
  async generateSignedUploadUrl(
    r2Key: string,
    contentType: string,
    expirySeconds = 3600
  ): Promise<string> {
    return this.presigner.presignPut(r2Key, contentType, expirySeconds);
  }

  /**
   * Retrieve an object's body decoded as UTF-8 text, or `null` when the object
   * is absent. Standalone (no R2 binding) sibling of `R2Service.getObjectText`
   * — used by the HLS playlist proxy in tests/scripts to read `.m3u8` files.
   *
   * @param r2Key - The object key to fetch
   */
  async getObjectText(r2Key: string): Promise<string | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: r2Key,
      });
      const response = await this.s3Client.send(command);
      const body = response.Body;
      if (!body) return null;
      return await body.transformToString();
    } catch (err) {
      const error = err as { name?: string };
      if (error.name === AWS_ERRORS.NOT_FOUND) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Check if an object exists in the bucket.
   * Useful for testing that objects are accessible.
   *
   * @param r2Key - The object key to check
   * @returns true if object exists, false otherwise
   */
  async objectExists(r2Key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: r2Key,
      });
      await this.s3Client.send(command);
      return true;
    } catch (err) {
      const error = err as { name?: string };
      if (error.name === AWS_ERRORS.NOT_FOUND) {
        return false;
      }
      throw err;
    }
  }

  /**
   * Get the bucket name this client is configured for.
   */
  getBucketName(): string {
    return this.bucketName;
  }
}

/**
 * Create an R2SigningClient from environment variables.
 * Expects: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_MEDIA
 */
export function createR2SigningClientFromEnv(): R2SigningClient {
  const accountId = process.env[INFRA_KEYS.R2.ACCOUNT_ID];
  const accessKeyId = process.env[INFRA_KEYS.R2.ACCESS_KEY_ID];
  const secretAccessKey = process.env[INFRA_KEYS.R2.SECRET_ACCESS_KEY];
  const bucketName = process.env[INFRA_KEYS.R2.BUCKET_MEDIA];

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new ValidationError(
      `Missing R2 environment variables. Required: ${INFRA_KEYS.R2.ACCOUNT_ID}, ${INFRA_KEYS.R2.ACCESS_KEY_ID}, ${INFRA_KEYS.R2.SECRET_ACCESS_KEY}, ${INFRA_KEYS.R2.BUCKET_MEDIA}`,
      {
        field: 'environment',
        required: [
          INFRA_KEYS.R2.ACCOUNT_ID,
          INFRA_KEYS.R2.ACCESS_KEY_ID,
          INFRA_KEYS.R2.SECRET_ACCESS_KEY,
          INFRA_KEYS.R2.BUCKET_MEDIA,
        ],
      }
    );
  }

  return new R2SigningClient({
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
  });
}
