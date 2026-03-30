import {
  getHlsMasterKey,
  getHlsPreviewKey,
  getOriginalKey,
  getThumbnailKey,
  getWaveformImageKey,
  getWaveformKey,
} from '../../../transcoding/src/paths';
import type { dbWs as DbClient } from '../../src';
import { schema } from '../../src';
import { MEDIA, USERS } from './constants';

const now = new Date();

export async function seedMedia(db: typeof DbClient) {
  // Ready video items — all R2 keys from path SSOT
  const readyVideos = [MEDIA.introTs, MEDIA.advancedSvelte, MEDIA.honoApis];

  await db.insert(schema.mediaItems).values([
    // Ready videos
    ...readyVideos.map((m) => ({
      id: m.id,
      creatorId: m.creatorId,
      title: m.title,
      mediaType: m.mediaType,
      status: m.status,
      r2Key: getOriginalKey(m.creatorId, m.id, 'video.mp4'),
      fileSizeBytes: m.fileSizeBytes,
      mimeType: m.mimeType,
      durationSeconds: m.durationSeconds,
      width: m.width,
      height: m.height,
      hlsMasterPlaylistKey: getHlsMasterKey(m.creatorId, m.id),
      hlsPreviewKey: getHlsPreviewKey(m.creatorId, m.id),
      thumbnailKey: getThumbnailKey(m.creatorId, m.id),
      readyVariants: ['1080p', '720p', '480p', '360p'],
      transcodingAttempts: 1,
      transcodingPriority: 2,
      uploadedAt: now,
      createdAt: now,
      updatedAt: now,
    })),

    // Ready audio (podcast)
    {
      id: MEDIA.podcast.id,
      creatorId: MEDIA.podcast.creatorId,
      title: MEDIA.podcast.title,
      mediaType: MEDIA.podcast.mediaType,
      status: MEDIA.podcast.status,
      r2Key: getOriginalKey(
        MEDIA.podcast.creatorId,
        MEDIA.podcast.id,
        'audio.mp3'
      ),
      fileSizeBytes: MEDIA.podcast.fileSizeBytes,
      mimeType: MEDIA.podcast.mimeType,
      durationSeconds: MEDIA.podcast.durationSeconds,
      hlsMasterPlaylistKey: getHlsMasterKey(
        MEDIA.podcast.creatorId,
        MEDIA.podcast.id
      ),
      hlsPreviewKey: getHlsPreviewKey(
        MEDIA.podcast.creatorId,
        MEDIA.podcast.id
      ),
      waveformKey: getWaveformKey(MEDIA.podcast.creatorId, MEDIA.podcast.id),
      waveformImageKey: getWaveformImageKey(
        MEDIA.podcast.creatorId,
        MEDIA.podcast.id
      ),
      transcodingAttempts: 1,
      transcodingPriority: 2,
      uploadedAt: now,
      createdAt: now,
      updatedAt: now,
    },

    // Uploading (WIP) — minimal fields
    {
      id: MEDIA.wip.id,
      creatorId: MEDIA.wip.creatorId,
      title: MEDIA.wip.title,
      mediaType: MEDIA.wip.mediaType,
      status: MEDIA.wip.status,
      r2Key: getOriginalKey(MEDIA.wip.creatorId, MEDIA.wip.id, 'video.mp4'),
      transcodingAttempts: 0,
      transcodingPriority: 2,
      createdAt: now,
      updatedAt: now,
    },

    // Failed transcode
    {
      id: MEDIA.failed.id,
      creatorId: MEDIA.failed.creatorId,
      title: MEDIA.failed.title,
      mediaType: MEDIA.failed.mediaType,
      status: MEDIA.failed.status,
      r2Key: getOriginalKey(
        MEDIA.failed.creatorId,
        MEDIA.failed.id,
        'video.mp4'
      ),
      transcodingError: 'Simulated transcode failure: codec not supported',
      transcodingAttempts: 3,
      transcodingPriority: 2,
      uploadedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  console.log(`  Seeded ${Object.keys(MEDIA).length} media items`);
}
