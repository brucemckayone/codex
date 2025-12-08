/**
 * R2 Test Setup
 *
 * Uploads test media files to R2 bucket before E2E tests run.
 * This ensures the streaming URL generation has actual files to sign.
 *
 * R2 Structure (from research):
 * - originals/{mediaId}/video.mp4  - Original uploaded file
 * - hls/{mediaId}/master.m3u8      - HLS master playlist (after transcoding)
 * - thumbnails/{mediaId}/thumb.jpg - Thumbnail (after transcoding)
 */

import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/**
 * Get R2 credentials from environment
 * Called lazily to allow environment variables to be loaded first
 */
function getR2Config() {
  const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID!;
  const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID!;
  const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!;
  const R2_BUCKET_MEDIA = process.env.R2_BUCKET_MEDIA!;

  if (
    !R2_ACCOUNT_ID ||
    !R2_ACCESS_KEY_ID ||
    !R2_SECRET_ACCESS_KEY ||
    !R2_BUCKET_MEDIA
  ) {
    throw new Error('Missing R2 credentials in environment variables');
  }

  return {
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_BUCKET_MEDIA,
  };
}

/**
 * Create S3 client configured for R2
 * Lazy initialization to allow environment variables to be loaded first
 */
let r2ClientInstance: S3Client | null = null;
function getR2Client(): S3Client {
  if (!r2ClientInstance) {
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } =
      getR2Config();
    r2ClientInstance = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return r2ClientInstance;
}

/**
 * Check if file exists in R2
 */
async function fileExists(key: string): Promise<boolean> {
  try {
    const { R2_BUCKET_MEDIA } = getR2Config();
    await getR2Client().send(
      new HeadObjectCommand({
        Bucket: R2_BUCKET_MEDIA,
        Key: key,
      })
    );
    return true;
  } catch (error: any) {
    if (error.name === 'NotFound' || error.name === 'NoSuchKey') {
      return false;
    }
    throw error;
  }
}

/**
 * Upload test file to R2
 */
async function uploadTestFile(
  key: string,
  content: Buffer,
  contentType: string
): Promise<void> {
  const { R2_BUCKET_MEDIA } = getR2Config();
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_MEDIA,
      Key: key,
      Body: content,
      ContentType: contentType,
    })
  );
  console.log(`✅ Uploaded: ${key}`);
}

/**
 * Create minimal test video file (1KB MP4 header)
 * This isn't a real playable video, but it's enough for R2 signing tests
 */
function createTestVideoFile(): Buffer {
  // Minimal MP4 file structure (ftyp + mdat boxes)
  const ftyp = Buffer.from([
    0x00,
    0x00,
    0x00,
    0x20, // box size (32 bytes)
    0x66,
    0x74,
    0x79,
    0x70, // 'ftyp'
    0x69,
    0x73,
    0x6f,
    0x6d, // 'isom'
    0x00,
    0x00,
    0x02,
    0x00, // version
    0x69,
    0x73,
    0x6f,
    0x6d, // compatible brand 'isom'
    0x69,
    0x73,
    0x6f,
    0x32, // compatible brand 'iso2'
    0x6d,
    0x70,
    0x34,
    0x31, // compatible brand 'mp41'
  ]);

  const mdat = Buffer.from([
    0x00,
    0x00,
    0x00,
    0x10, // box size (16 bytes)
    0x6d,
    0x64,
    0x61,
    0x74, // 'mdat'
    0x00,
    0x00,
    0x00,
    0x00, // dummy data
    0x00,
    0x00,
    0x00,
    0x00,
  ]);

  return Buffer.concat([ftyp, mdat]);
}

/**
 * Create test HLS master playlist
 */
function createTestHLSPlaylist(): Buffer {
  return Buffer.from(`#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
360p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=842x480
480p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720
720p.m3u8
`);
}

/**
 * Create test thumbnail image (1x1 pixel JPEG)
 */
function createTestThumbnail(): Buffer {
  // Minimal JPEG file (1x1 pixel red)
  return Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46, // JPEG signature
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x01,
    0x00,
    0x48,
    0x00,
    0x48,
    0x00,
    0x00,
    0xff,
    0xdb,
    0x00,
    0x43,
    0x00,
    0x08,
    0x06,
    0x06,
    0x07,
    0x06,
    0x05,
    0x08,
    0x07,
    0x07,
    0x07,
    0x09,
    0x09,
    0x08,
    0x0a,
    0x0c,
    0x14,
    0x0d,
    0x0c,
    0x0b,
    0x0b,
    0x0c,
    0x19,
    0x12,
    0x13,
    0x0f,
    0x14,
    0x1d,
    0x1a,
    0x1f,
    0x1e,
    0x1d,
    0x1a,
    0x1c,
    0x1c,
    0x20,
    0x24,
    0x2e,
    0x27,
    0x20,
    0x22,
    0x2c,
    0x23,
    0x1c,
    0x1c,
    0x28,
    0x37,
    0x29,
    0x2c,
    0x30,
    0x31,
    0x34,
    0x34,
    0x34,
    0x1f,
    0x27,
    0x39,
    0x3d,
    0x38,
    0x32,
    0x3c,
    0x2e,
    0x33,
    0x34,
    0x32,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    0x00,
    0x01,
    0x00,
    0x01,
    0x01,
    0x01,
    0x11,
    0x00,
    0xff,
    0xc4,
    0x00,
    0x14,
    0x00,
    0x01,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x03,
    0xff,
    0xc4,
    0x00,
    0x14,
    0x10,
    0x01,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0xff,
    0xda,
    0x00,
    0x08,
    0x01,
    0x01,
    0x00,
    0x00,
    0x3f,
    0x00,
    0x37,
    0xff,
    0xd9,
  ]);
}

/**
 * Setup test media files in R2
 *
 * Uses the correct R2 structure with creator scoping:
 * - {creatorId}/originals/{mediaId}/original.mp4
 * - {creatorId}/hls/{mediaId}/master.m3u8
 * - {creatorId}/thumbnails/{mediaId}/thumb.jpg
 *
 * We use a stable test creator ID that will be used across test runs
 */
export async function setupTestMediaFiles(): Promise<void> {
  const { R2_BUCKET_MEDIA } = getR2Config();
  console.log('📦 Setting up test media files in R2...');
  console.log(`   Bucket: ${R2_BUCKET_MEDIA}\n`);

  // Use stable IDs so files can be reused across test runs
  const testCreatorId = 'e2e-test-creator';
  const testMediaId = 'e2e-test-video-001';

  const testFiles = [
    // Original video file (what gets uploaded first)
    {
      key: `${testCreatorId}/originals/${testMediaId}/original.mp4`,
      content: createTestVideoFile(),
      contentType: 'video/mp4',
    },
    // HLS master playlist (created by transcoding service)
    {
      key: `${testCreatorId}/hls/${testMediaId}/master.m3u8`,
      content: createTestHLSPlaylist(),
      contentType: 'application/vnd.apple.mpegurl',
    },
    // Thumbnail (created by transcoding service)
    {
      key: `${testCreatorId}/thumbnails/${testMediaId}/thumb.jpg`,
      content: createTestThumbnail(),
      contentType: 'image/jpeg',
    },
  ];

  for (const file of testFiles) {
    const exists = await fileExists(file.key);
    if (exists) {
      console.log(`⏭️  Skipped (exists): ${file.key}`);
    } else {
      await uploadTestFile(file.key, file.content, file.contentType);
    }
  }

  console.log('\n✅ Test media files ready');
  console.log(`   Test creator ID: ${testCreatorId}`);
  console.log(`   Test media ID: ${testMediaId}`);
  console.log(
    `   Use in tests: r2Key = "${testCreatorId}/originals/${testMediaId}/original.mp4"`
  );
  console.log(
    `                 hlsMasterPlaylistKey = "${testCreatorId}/hls/${testMediaId}/master.m3u8"\n`
  );
}

/**
 * Run setup if called directly (ESM module check)
 */
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  setupTestMediaFiles()
    .then(() => {
      console.log('Setup complete!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Setup failed:', error);
      process.exit(1);
    });
}
