/**
 * What the content list says after a bulk action (Codex-a6ofh.3.5, mockup L2).
 */
import type { ContentBulkResult } from '@codex/shared-types';
import { describe, expect, it } from 'vitest';
import * as m from '$paraglide/messages';
import { editHref, publishStepHref } from '../editor/editor-url';
import { type BulkPiece, bulkReport } from './bulk-report';

const pieces = new Map<string, BulkPiece>([
  ['a', { id: 'a', title: 'Private Notes', contentType: 'written' }],
  ['b', { id: 'b', title: 'Draft Video Lesson', contentType: 'video' }],
  ['c', { id: 'c', title: 'Svelte runes deep dive', contentType: 'video' }],
]);

const refused = (
  id: string,
  details: Record<string, unknown>,
  message = 'Refused.'
): ContentBulkResult => ({
  id,
  outcome: 'refused',
  error: { code: 'BUSINESS_LOGIC_ERROR', message, details },
});

describe('bulkReport', () => {
  it('says all of them when every piece changed', () => {
    const report = bulkReport(
      'unpublish',
      [
        { id: 'a', outcome: 'done' },
        { id: 'b', outcome: 'done' },
      ],
      pieces
    );
    expect(report.line).toBe(
      m.studio_content_bulk_unpublished_all({ count: 2 })
    );
    expect(report.problems).toEqual([]);
    expect(report.keep).toEqual([]);
  });

  it('names the one piece that goes live when its media is ready (the mockup)', () => {
    const report = bulkReport(
      'publish',
      [
        { id: 'a', outcome: 'done' },
        { id: 'b', outcome: 'scheduled' },
      ],
      pieces
    );
    expect(report.line).toBe(
      `${m.studio_content_bulk_published_some({ done: 1, total: 2 })} ${m.studio_content_bulk_scheduled_one(
        { title: 'Draft Video Lesson', type: m.studio_editor_type_video() }
      )}`
    );
  });

  it('counts the unchanged and the refused, and keeps the refused selected', () => {
    const report = bulkReport(
      'publish',
      [
        { id: 'a', outcome: 'unchanged' },
        refused('c', { code: 'MEDIA_REQUIRED' }),
      ],
      pieces
    );
    expect(report.line).toContain(
      m.studio_content_bulk_unchanged({ count: 1 })
    );
    expect(report.line).toContain(
      m.studio_content_bulk_problems_publish({ count: 1 })
    );
    expect(report.keep).toEqual(['c']);
  });

  it('words a publish refusal as the Publish checklist does, with the way to fix it', () => {
    const report = bulkReport(
      'publish',
      [refused('c', { code: 'MEDIA_REQUIRED' })],
      pieces
    );
    expect(report.problems).toEqual([
      {
        id: 'c',
        title: 'Svelte runes deep dive',
        words: m.studio_publish_gap_media({
          type: m.studio_editor_type_video(),
        }),
        fixHref: editHref('c'),
      },
    ]);
    const price = bulkReport(
      'publish',
      [refused('a', { code: 'PRICE_REQUIRED' })],
      pieces
    );
    expect(price.problems[0]?.fixHref).toBe(publishStepHref('a'));
  });

  it("keeps the server's own words for a refusal the checklist has no row for", () => {
    const report = bulkReport(
      'delete',
      [
        { id: 'a', outcome: 'done' },
        refused(
          'c',
          { code: 'CONTENT_HAS_BUYERS', buyers: 3 },
          'Bought by 3 people, so it was left alone.'
        ),
      ],
      pieces
    );
    expect(report.line).toBe(
      `${m.studio_content_bulk_deleted_some({ done: 1, total: 2 })} ${m.studio_content_bulk_problems_delete({ count: 1 })}`
    );
    expect(report.problems[0]?.words).toBe(
      'Bought by 3 people, so it was left alone.'
    );
    expect(report.problems[0]?.fixHref).toBeNull();
  });

  it('says a piece gone elsewhere is gone, and a failure is ours, never its detail', () => {
    const report = bulkReport(
      'access',
      [
        refused('a', { code: 'CONTENT_NOT_FOUND' }),
        {
          id: 'b',
          outcome: 'failed',
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
          },
        },
      ],
      pieces
    );
    expect(report.problems.map((p) => p.words)).toEqual([
      m.studio_content_bulk_gone(),
      m.studio_content_bulk_failed_piece(),
    ]);
    expect(report.keep).toEqual(['a', 'b']);
  });

  it('names the category for Add to category', () => {
    const report = bulkReport(
      'categories',
      [{ id: 'a', outcome: 'done' }],
      pieces,
      'Tutorials'
    );
    expect(report.line).toBe(
      m.studio_content_bulk_filed_all({ count: 1, category: 'Tutorials' })
    );
  });
});
