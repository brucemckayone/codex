/**
 * What the content list says after a bulk action (Codex-a6ofh.3.5, data-design
 * §4.2, mockup L2): one line, "Published 1 of 2. “Draft Video Lesson” goes
 * live when its video is ready.", and for Show, each piece that was refused or
 * failed, in the Publish checklist's own words where it has them. The pieces
 * that did not go through stay selected, so trying again is one click.
 */
import { ERROR_CODES } from '@codex/constants';
import type { ContentBulkAction, ContentBulkResult } from '@codex/shared-types';
import type { ContentWithRelations } from '$lib/types';
import * as m from '$paraglide/messages';
import { TYPE_WORD } from '../editor/canvas-text';
import {
  editHref,
  editorContentType,
  publishStepHref,
} from '../editor/editor-url';
import { asPublishGap, gapRow } from '../editor/publish-gaps';

/** A piece Show lists: what stopped it, and where that is put right. */
export interface BulkProblem {
  id: string;
  title: string;
  words: string;
  /** Where to put it right, when it is the creator's to fix. */
  fixHref: string | null;
}

export interface BulkReport {
  line: string;
  problems: BulkProblem[];
  /** The selection afterwards: the pieces that did not go through. */
  keep: string[];
}

/** A piece sent, as the list held it. */
export type BulkPiece = Pick<
  ContentWithRelations,
  'id' | 'title' | 'contentType'
>;

/** The pieces sent, by id. */
export type BulkPieces = ReadonlyMap<string, BulkPiece>;

/** Each action's words: while it runs, then what it did. */
const WORDS: Record<
  ContentBulkAction,
  {
    busy: (args: { count: number; category: string }) => string;
    all: (args: { count: number; category: string }) => string;
    some: (args: { done: number; total: number; category: string }) => string;
    problems: (args: { count: number }) => string;
  }
> = {
  publish: {
    busy: m.studio_content_bulk_busy_publish,
    all: m.studio_content_bulk_published_all,
    some: m.studio_content_bulk_published_some,
    problems: m.studio_content_bulk_problems_publish,
  },
  unpublish: {
    busy: m.studio_content_bulk_busy_unpublish,
    all: m.studio_content_bulk_unpublished_all,
    some: m.studio_content_bulk_unpublished_some,
    problems: m.studio_content_bulk_problems_unpublish,
  },
  delete: {
    busy: m.studio_content_bulk_busy_delete,
    all: m.studio_content_bulk_deleted_all,
    some: m.studio_content_bulk_deleted_some,
    problems: m.studio_content_bulk_problems_delete,
  },
  categories: {
    busy: m.studio_content_bulk_busy_categories,
    all: m.studio_content_bulk_filed_all,
    some: m.studio_content_bulk_filed_some,
    problems: m.studio_content_bulk_problems_categories,
  },
  access: {
    busy: m.studio_content_bulk_busy_access,
    all: m.studio_content_bulk_access_all,
    some: m.studio_content_bulk_access_some,
    problems: m.studio_content_bulk_problems_access,
  },
};

/** What the bar's live region says while an action runs: "Publishing 3…". */
export function bulkBusyWords(
  action: ContentBulkAction,
  count: number,
  category = ''
): string {
  return WORDS[action].busy({ count, category });
}

/** The code a refusal carries: the gate's own (`details.code`), else its class. */
function refusalCode(error: { code: string; details?: unknown }): string {
  const details = error.details;
  if (details && typeof details === 'object' && 'code' in details) {
    const code = (details as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return error.code;
}

function problemOf(
  result: Extract<ContentBulkResult, { outcome: 'refused' | 'failed' }>,
  piece: BulkPiece | undefined
): BulkProblem {
  const title = piece?.title ?? m.studio_content_bulk_unnamed();
  if (result.outcome === 'failed') {
    return {
      id: result.id,
      title,
      words: m.studio_content_bulk_failed_piece(),
      fixHref: null,
    };
  }
  const code = refusalCode(result.error);
  const contentType = piece ? editorContentType(piece.contentType) : null;
  const gap = asPublishGap(code);
  if (gap !== null && contentType !== null) {
    const row = gapRow(gap, { contentType, media: null });
    return {
      id: result.id,
      title,
      words: row.words,
      fixHref:
        row.fix === 'write' ? editHref(result.id) : publishStepHref(result.id),
    };
  }
  // Gone since the list was read (another tab): nothing left to fix.
  if (code === ERROR_CODES.CONTENT_NOT_FOUND) {
    return {
      id: result.id,
      title,
      words: m.studio_content_bulk_gone(),
      fixHref: null,
    };
  }
  // Its own words (a 4xx's message is the creator's): the buyers, a category.
  return { id: result.id, title, words: result.error.message, fixHref: null };
}

export function bulkReport(
  action: ContentBulkAction,
  results: readonly ContentBulkResult[],
  pieces: BulkPieces,
  category = ''
): BulkReport {
  const total = results.length;
  const done = results.filter((r) => r.outcome === 'done').length;
  const scheduled = results.filter((r) => r.outcome === 'scheduled');
  const unchanged = results.filter((r) => r.outcome === 'unchanged').length;
  const problems = results.flatMap((r) =>
    r.outcome === 'refused' || r.outcome === 'failed'
      ? [problemOf(r, pieces.get(r.id))]
      : []
  );
  const summary = WORDS[action];
  const parts = [
    done === total
      ? summary.all({ count: total, category })
      : summary.some({ done, total, category }),
  ];
  if (scheduled.length === 1) {
    const [only] = scheduled;
    const piece = only ? pieces.get(only.id) : undefined;
    const contentType = piece ? editorContentType(piece.contentType) : null;
    parts.push(
      m.studio_content_bulk_scheduled_one({
        title: piece?.title ?? m.studio_content_bulk_unnamed(),
        type: contentType
          ? TYPE_WORD[contentType]()
          : m.studio_editor_type_video(),
      })
    );
  } else if (scheduled.length > 1) {
    parts.push(
      m.studio_content_bulk_scheduled_many({ count: scheduled.length })
    );
  }
  if (unchanged > 0)
    parts.push(m.studio_content_bulk_unchanged({ count: unchanged }));
  if (problems.length > 0)
    parts.push(summary.problems({ count: problems.length }));
  return {
    line: parts.join(' '),
    problems,
    keep: problems.map((problem) => problem.id),
  };
}
