import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getHlsMasterKey,
  getHlsPreviewKey,
  getHlsVariantKey,
  getMediaThumbnailKey,
  getOrgLogoKey,
  getOriginalKey,
  getThumbnailKey,
  getUserAvatarKey,
  getWaveformImageKey,
  getWaveformKey,
} from '../../../transcoding/src/paths';
import { MEDIA, ORGS, USERS } from './constants';
import {
  generateAudioMasterPlaylist,
  generateAvatarSvg,
  generateLogoSvg,
  generateMasterPlaylist,
  generateThumbnailSvg,
  generateVariantPlaylist,
  generateWaveformJson,
  PLACEHOLDER_JPEG,
  VIDEO_VARIANTS,
} from './placeholders';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../../../');
const PERSIST_PATH = path.join(PROJECT_ROOT, '.wrangler/state');
const DEV_CDN_DIR = path.join(PROJECT_ROOT, 'workers/dev-cdn');

// Bucket names must match wrangler.jsonc preview_bucket_name (used in local dev)
const MEDIA_BUCKET_NAME = 'codex-media-test';
const ASSETS_BUCKET_NAME = 'codex-assets-test';

interface R2File {
  bucket: typeof MEDIA_BUCKET_NAME | typeof ASSETS_BUCKET_NAME;
  key: string;
  data: Buffer | string;
  contentType: string;
}

/**
 * Upload a file to R2 via the wrangler CLI.
 * Uses --local + --persist-to to write to the same storage the dev-cdn reads.
 */
function putR2Object(file: R2File) {
  const tmpFile = path.join(
    os.tmpdir(),
    `codex-seed-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  try {
    const data =
      typeof file.data === 'string'
        ? Buffer.from(file.data, 'utf-8')
        : file.data;
    fs.writeFileSync(tmpFile, data);

    execSync(
      `npx wrangler r2 object put "${file.bucket}/${file.key}" --file "${tmpFile}" --content-type "${file.contentType}" --local --persist-to "${PERSIST_PATH}"`,
      { cwd: DEV_CDN_DIR, stdio: 'pipe' }
    );
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

/**
 * Delete all objects from an R2 bucket via wrangler CLI.
 */
function clearBucket(bucketName: string) {
  try {
    // List all objects
    const output = execSync(
      `npx wrangler r2 object list "${bucketName}" --local --persist-to "${PERSIST_PATH}"`,
      { cwd: DEV_CDN_DIR, stdio: 'pipe' }
    ).toString();

    // Parse JSON output — wrangler returns { objects: [...] } or empty
    const parsed = JSON.parse(output || '{"objects":[]}');
    const objects = parsed.objects ?? [];

    // Delete each object
    for (const obj of objects) {
      execSync(
        `npx wrangler r2 object delete "${bucketName}/${obj.key}" --local --persist-to "${PERSIST_PATH}"`,
        { cwd: DEV_CDN_DIR, stdio: 'pipe' }
      );
    }

    return objects.length;
  } catch {
    // Bucket might not exist yet
    return 0;
  }
}

/**
 * Clear all objects from both R2 buckets.
 */
export async function clearR2Buckets() {
  const mediaCount = clearBucket(MEDIA_BUCKET_NAME);
  const assetsCount = clearBucket(ASSETS_BUCKET_NAME);
  console.log(
    `  Cleared R2 buckets (${mediaCount} media, ${assetsCount} assets)`
  );
}

/**
 * Collect all placeholder files for ready media items.
 */
function collectMediaFiles(): R2File[] {
  const files: R2File[] = [];

  const readyVideos = [
    { media: MEDIA.introTs, creatorId: USERS.creator.id },
    { media: MEDIA.advancedSvelte, creatorId: USERS.creator.id },
    { media: MEDIA.honoApis, creatorId: USERS.admin.id },
  ];

  for (const { media, creatorId } of readyVideos) {
    files.push({
      bucket: MEDIA_BUCKET_NAME,
      key: getOriginalKey(creatorId, media.id, 'video.mp4'),
      data: PLACEHOLDER_JPEG,
      contentType: 'video/mp4',
    });

    files.push({
      bucket: MEDIA_BUCKET_NAME,
      key: getHlsMasterKey(creatorId, media.id),
      data: Buffer.from(generateMasterPlaylist([...VIDEO_VARIANTS]), 'utf-8'),
      contentType: 'application/vnd.apple.mpegurl',
    });

    files.push({
      bucket: MEDIA_BUCKET_NAME,
      key: getHlsPreviewKey(creatorId, media.id),
      data: Buffer.from(generateVariantPlaylist(30), 'utf-8'),
      contentType: 'application/vnd.apple.mpegurl',
    });

    for (const variant of VIDEO_VARIANTS) {
      files.push({
        bucket: MEDIA_BUCKET_NAME,
        key: getHlsVariantKey(creatorId, media.id, variant.name),
        data: Buffer.from(
          generateVariantPlaylist(media.durationSeconds),
          'utf-8'
        ),
        contentType: 'application/vnd.apple.mpegurl',
      });
    }

    files.push({
      bucket: MEDIA_BUCKET_NAME,
      key: getThumbnailKey(creatorId, media.id),
      data: generateThumbnailSvg(media.title),
      contentType: 'image/svg+xml',
    });

    const sizes = { sm: [320, 180], md: [640, 360], lg: [800, 450] } as const;
    for (const size of ['sm', 'md', 'lg'] as const) {
      files.push({
        bucket: ASSETS_BUCKET_NAME,
        key: getMediaThumbnailKey(creatorId, media.id, size),
        data: generateThumbnailSvg(
          media.title,
          '#1e293b',
          '#60a5fa',
          sizes[size][0],
          sizes[size][1]
        ),
        contentType: 'image/svg+xml',
      });
    }
  }

  // Audio: Tech Podcast
  const podcastCreatorId = USERS.creator.id;
  const podcast = MEDIA.podcast;

  files.push({
    bucket: MEDIA_BUCKET_NAME,
    key: getOriginalKey(podcastCreatorId, podcast.id, 'audio.mp3'),
    data: PLACEHOLDER_JPEG,
    contentType: 'audio/mpeg',
  });

  files.push({
    bucket: MEDIA_BUCKET_NAME,
    key: getHlsMasterKey(podcastCreatorId, podcast.id),
    data: Buffer.from(generateAudioMasterPlaylist(), 'utf-8'),
    contentType: 'application/vnd.apple.mpegurl',
  });

  files.push({
    bucket: MEDIA_BUCKET_NAME,
    key: getHlsVariantKey(podcastCreatorId, podcast.id, 'audio'),
    data: Buffer.from(
      generateVariantPlaylist(podcast.durationSeconds),
      'utf-8'
    ),
    contentType: 'application/vnd.apple.mpegurl',
  });

  files.push({
    bucket: MEDIA_BUCKET_NAME,
    key: getWaveformKey(podcastCreatorId, podcast.id),
    data: Buffer.from(generateWaveformJson(200), 'utf-8'),
    contentType: 'application/json',
  });

  files.push({
    bucket: MEDIA_BUCKET_NAME,
    key: getWaveformImageKey(podcastCreatorId, podcast.id),
    data: PLACEHOLDER_JPEG,
    contentType: 'image/png',
  });

  return files;
}

/**
 * Collect user avatar and org logo files.
 */
function collectAssetFiles(): R2File[] {
  const files: R2File[] = [];

  const avatarColors: Record<string, string> = {
    [USERS.creator.id]: '#6366f1',
    [USERS.viewer.id]: '#0891b2',
    [USERS.admin.id]: '#059669',
  };
  const avatarSizes = { sm: 64, md: 128, lg: 256 } as const;
  for (const user of Object.values(USERS)) {
    for (const size of ['sm', 'md', 'lg'] as const) {
      files.push({
        bucket: ASSETS_BUCKET_NAME,
        key: getUserAvatarKey(user.id, size),
        data: generateAvatarSvg(
          user.name,
          avatarColors[user.id] ?? '#6366f1',
          avatarSizes[size]
        ),
        contentType: 'image/svg+xml',
      });
    }
  }

  for (const org of Object.values(ORGS)) {
    const logoSizes = { sm: 64, md: 128, lg: 256 } as const;
    for (const size of ['sm', 'md', 'lg'] as const) {
      files.push({
        bucket: ASSETS_BUCKET_NAME,
        key: getOrgLogoKey(org.id, size),
        data: generateLogoSvg(org.name, org.primaryColor, logoSizes[size]),
        contentType: 'image/svg+xml',
      });
    }
  }

  return files;
}

/**
 * Write all placeholder files to local R2 via wrangler CLI.
 * Uses the same persistence path as dev-cdn, so files are immediately servable.
 */
export async function seedR2Files() {
  const allFiles = [...collectMediaFiles(), ...collectAssetFiles()];

  let count = 0;
  for (const file of allFiles) {
    putR2Object(file);
    count++;
    // Progress indicator every 10 files
    if (count % 10 === 0)
      process.stdout.write(`  R2: ${count}/${allFiles.length}\r`);
  }

  const mediaCount = allFiles.filter(
    (f) => f.bucket === MEDIA_BUCKET_NAME
  ).length;
  const assetsCount = allFiles.filter(
    (f) => f.bucket === ASSETS_BUCKET_NAME
  ).length;
  console.log(
    `  Wrote ${count} files to R2 (${mediaCount} media, ${assetsCount} assets)`
  );

  // Workaround: wrangler CLI writes R2 metadata to v3/r2/miniflare-R2BucketObject/
  // but wrangler dev reads from v3/miniflare-R2BucketObject/. Copy metadata files
  // so the dev-cdn can find them after a restart.
  const cliMetadataDir = path.join(
    PERSIST_PATH,
    'v3',
    'r2',
    'miniflare-R2BucketObject'
  );
  const devMetadataDir = path.join(
    PERSIST_PATH,
    'v3',
    'miniflare-R2BucketObject'
  );
  if (fs.existsSync(cliMetadataDir)) {
    fs.mkdirSync(devMetadataDir, { recursive: true });
    for (const file of fs.readdirSync(cliMetadataDir)) {
      if (file.endsWith('.sqlite')) {
        fs.copyFileSync(
          path.join(cliMetadataDir, file),
          path.join(devMetadataDir, file)
        );
      }
    }
    console.log('  Synced R2 metadata for dev-cdn compatibility');
  }
}
