import type { dbWs as DbClient } from '../../src';
import { schema } from '../../src';
import { CONTENT, MEDIA, PLAYBACK, USERS } from './constants';

const now = new Date();

export async function seedPlayback(db: typeof DbClient) {
  await db.insert(schema.videoPlayback).values([
    {
      id: PLAYBACK.viewerIntroTs.id,
      userId: USERS.viewer.id,
      contentId: CONTENT.introTs.id,
      positionSeconds: Math.round(MEDIA.introTs.durationSeconds * 0.5), // 50%
      durationSeconds: MEDIA.introTs.durationSeconds,
      completed: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: PLAYBACK.viewerSvelte.id,
      userId: USERS.viewer.id,
      contentId: CONTENT.advancedSvelte.id,
      positionSeconds: MEDIA.advancedSvelte.durationSeconds, // 100%
      durationSeconds: MEDIA.advancedSvelte.durationSeconds,
      completed: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: PLAYBACK.viewerPodcast.id,
      userId: USERS.viewer.id,
      contentId: CONTENT.podcast.id,
      positionSeconds: Math.round(MEDIA.podcast.durationSeconds * 0.05), // 5%
      durationSeconds: MEDIA.podcast.durationSeconds,
      completed: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: PLAYBACK.adminHono.id,
      userId: USERS.admin.id,
      contentId: CONTENT.honoApis.id,
      positionSeconds: Math.round(MEDIA.honoApis.durationSeconds * 0.75), // 75%
      durationSeconds: MEDIA.honoApis.durationSeconds,
      completed: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: PLAYBACK.adminSvelte.id,
      userId: USERS.admin.id,
      contentId: CONTENT.advancedSvelte.id,
      positionSeconds: Math.round(MEDIA.advancedSvelte.durationSeconds * 0.3), // 30%
      durationSeconds: MEDIA.advancedSvelte.durationSeconds,
      completed: false,
      createdAt: now,
      updatedAt: now,
    },
    // Of Blood & Bones: viewer watching Ceremonial Cacao (40%)
    {
      id: PLAYBACK.viewerCacao.id,
      userId: USERS.viewer.id,
      contentId: CONTENT.ceremonialCacao.id,
      positionSeconds: Math.round(MEDIA.cacaoCeremony.durationSeconds * 0.4),
      durationSeconds: MEDIA.cacaoCeremony.durationSeconds,
      completed: false,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  console.log('  Seeded 6 playback progress records');
}
