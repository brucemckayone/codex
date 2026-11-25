/**
 * What the content list says after a bulk action (Codex-a6ofh.3.5, mockup L2).
 */
import type { ContentBulkResult } from '@codex/shared-types';
import { describe, expect, it } from 'vitest';
import {
  formatLocalClockTime,
  formatShortSentenceDate,
} from '$lib/utils/format';
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
        refused('c', { code: 'SOME_OTHER_RULE' }, 'Its own reason.'),
      ],
      pieces
    );
    expect(report.line).toBe(
      `${m.studio_content_bulk_deleted_some({ done: 1, total: 2 })} ${m.studio_content_bulk_problems_delete({ count: 1 })}`
    );
    expect(report.problems[0]?.words).toBe('Its own reason.');
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

  it('a try-again says why in its own words, and is not done, never "left alone"', () => {
    const notReached = 'Not reached: the action ran out of time. Try again.';
    const report = bulkReport(
      'delete',
      [
        { id: 'a', outcome: 'done' },
        {
          id: 'b',
          outcome: 'failed',
          error: { code: 'SERVICE_UNAVAILABLE', message: notReached },
        },
      ],
      pieces
    );
    expect(report.line).toBe(
      `${m.studio_content_bulk_deleted_some({ done: 1, total: 2 })} ${m.studio_content_bulk_not_done({ count: 1 })}`
    );
    expect(report.problems[0]?.words).toBe(notReached);
    // Still selected: trying again is one click.
    expect(report.keep).toEqual(['b']);
  });

  it('a delete that finds a piece already gone counts it deleted', () => {
    const report = bulkReport(
      'delete',
      [
        { id: 'a', outcome: 'done' },
        refused('b', { code: 'CONTENT_NOT_FOUND' }),
      ],
      pieces
    );
    expect(report.line).toBe(m.studio_content_bulk_deleted_all({ count: 2 }));
    expect(report.problems).toEqual([]);
    expect(report.keep).toEqual([]);
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

// The leaving notice (Codex-a6ofh.6, mockup LN2; WP-2 review): a held
// piece's delete is `leaving`, never "Deleted 0 of 3".
describe('bulkReport: pieces that leave', () => {
  const soon = '2026-12-20T10:00:00.000Z';
  const later = '2026-12-20T11:00:00.000Z';
  const leaving = (id: string, leavesAt = soon): ContentBulkResult => ({
    id,
    outcome: 'leaving',
    leavesAt,
    holders: 3,
    started: true,
    leavingByCreator: true,
    leavingByOrg: false,
  });

  it('says how many were deleted and how many leave, by the soonest date (the mockup)', () => {
    const report = bulkReport(
      'delete',
      [{ id: 'a', outcome: 'done' }, leaving('b', later), leaving('c')],
      pieces
    );
    expect(report.line).toBe(
      m.studio_leaving_bulk_deleted_leave({
        done: 1,
        count: 2,
        date: formatShortSentenceDate(soon),
      })
    );
    // They went through: none stays selected.
    expect(report.keep).toEqual([]);
    expect(report.problems).toEqual([]);
  });

  it('says one leaves, and leaving alone, with no deleted count', () => {
    const date = formatShortSentenceDate(soon);
    expect(
      bulkReport('delete', [{ id: 'a', outcome: 'done' }, leaving('b')], pieces)
        .line
    ).toBe(m.studio_leaving_bulk_deleted_leave_one({ done: 1, date }));
    expect(
      bulkReport('delete', [leaving('a'), leaving('b'), leaving('c')], pieces)
        .line
    ).toBe(m.studio_leaving_bulk_leave({ count: 3, date }));
    expect(bulkReport('delete', [leaving('a')], pieces).line).toBe(
      m.studio_leaving_bulk_leave_one({ date })
    );
  });

  it('still counts the ones not done, and keeps them selected', () => {
    const report = bulkReport(
      'delete',
      [
        leaving('a'),
        refused('b', { code: 'CONTENT_LEAVING_TOO_SOON' }, 'Too soon.'),
      ],
      pieces
    );
    expect(report.line).toBe(
      `${m.studio_leaving_bulk_leave_one({ date: formatShortSentenceDate(soon) })} ${m.studio_content_bulk_problems_delete({ count: 1 })}`
    );
    expect(report.keep).toEqual(['b']);
  });

  it('words a delete too soon after its last notice with when it can go again', () => {
    const retryAt = new Date(Date.now() + 60 * 60 * 1000);
    const report = bulkReport(
      'delete',
      [
        refused(
          'a',
          { code: 'CONTENT_LEAVING_TOO_SOON', retryAt: retryAt.toISOString() },
          'This started leaving less than a day ago.'
        ),
      ],
      pieces
    );
    const time = formatLocalClockTime(retryAt);
    expect([
      m.studio_leaving_too_soon({ time }),
      m.studio_leaving_too_soon_tomorrow({ time }),
    ]).toContain(report.problems[0]?.words);
    // No readable time: its own words.
    const unread = bulkReport(
      'delete',
      [refused('a', { code: 'CONTENT_LEAVING_TOO_SOON' }, 'Its own words.')],
      pieces
    );
    expect(unread.problems[0]?.words).toBe('Its own words.');
  });

  it('words a publish of a piece leaving: Keep it first', () => {
    const report = bulkReport(
      'publish',
      [refused('a', { code: 'CONTENT_LEAVING' }, 'This is leaving.')],
      pieces
    );
    expect(report.problems[0]?.words).toBe(m.studio_leaving_publish_refused());
  });
});
