/**
 * The studio canvas renders the same sections the published page does, from
 * the ADMIN curriculum read. The mapping must carry every practice field the
 * public read carries, or the canvas draws a different page (Codex-61zsk.52).
 */
import { describe, expect, it } from 'vitest';
import type { EditorStageView } from '$lib/page-builder';
import { builderSalesContext } from './builder-context';

const CDN = 'https://cdn-assets.example.test';

const STAGES: EditorStageView[] = [
  {
    id: 'stage-1',
    name: 'Arriving',
    gloss: null,
    sortOrder: 0,
    practices: [
      {
        contentId: 'c-1',
        slug: 'breath',
        title: 'Breath',
        contentType: 'video',
        status: 'published',
        thumbnailUrl: `${CDN}/creator/media-thumbnails/m-1/lg.webp`,
        durationSeconds: 720,
        sortOrder: 0,
      },
      {
        contentId: 'c-2',
        slug: 'notes',
        title: 'Notes',
        contentType: 'written',
        status: 'draft',
        thumbnailUrl: null,
        durationSeconds: null,
        sortOrder: 1,
      },
    ],
  },
  {
    id: 'stage-2',
    name: 'Staying',
    gloss: 'The long middle',
    sortOrder: 1,
    practices: [
      {
        contentId: 'c-3',
        slug: 'hum',
        title: 'Hum',
        contentType: 'audio',
        status: 'published',
        thumbnailUrl: null,
        durationSeconds: 300,
        sortOrder: 0,
      },
    ],
  },
];

describe('builderSalesContext practices', () => {
  const ctx = builderSalesContext({
    course: { id: 'course-1', slug: 'roots', title: 'Roots' },
    stages: STAGES,
  });
  const practices = ctx.stages.flatMap((stage) => stage.practices);

  it('carries each practice’s length, as the public read does', () => {
    expect(practices.map((p) => p.durationSeconds)).toEqual([720, null, 300]);
  });

  it('carries each practice’s picture, as the public read does', () => {
    expect(practices.map((p) => p.thumbnailUrl)).toEqual([
      `${CDN}/creator/media-thumbnails/m-1/lg.webp`,
      null,
      null,
    ]);
  });

  it('numbers practices across the whole course, not within each stage', () => {
    expect(practices.map((p) => p.sortOrder)).toEqual([0, 1, 2]);
  });

  it('hands out no editor-only field', () => {
    for (const p of practices) expect(p).not.toHaveProperty('status');
  });
});
