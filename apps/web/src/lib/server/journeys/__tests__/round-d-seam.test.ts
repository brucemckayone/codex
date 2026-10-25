import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InCoursePracticeResponse } from '$lib/server/api';

/**
 * Round-D member seam — the written body's render and stored-XSS guard.
 *
 * The in-course player emits a written practice's `bodyHtml` via `{@html}`. The
 * worker returns the body AS STORED (TipTap JSON or markdown), so
 * `fetchInCoursePractice` MUST render and scrub it before it leaves the server
 * (Codex-woj7k). Here we mock ONLY the server API client (no real worker
 * fetch) and let the REAL renderer run, so the test proves the SEAM wires the
 * render, not just that the renderer exists.
 */

const { inCoursePractice, courseEntry } = vi.hoisted(() => ({
  inCoursePractice: vi.fn(),
  courseEntry: vi.fn(),
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: () => ({ access: { inCoursePractice, courseEntry } }),
}));

import {
  fetchInCoursePractice,
  resolveCanEnterCourse,
  resolveCourseEntry,
} from '../round-d-seam';

const ctx = {} as Parameters<typeof fetchInCoursePractice>[0];

const basePractice: InCoursePracticeResponse = {
  course: {
    id: '2c000000-0000-4000-8000-000000000001',
    slug: 'rootwork',
    title: 'Rootwork',
    organizationSlug: null,
  },
  stage: { id: '2c000000-0000-4000-8000-0000000000a1', name: 'The Practice' },
  practice: {
    contentId: '2c000000-0000-4000-8000-000000000101',
    slug: 'field-notes',
    title: 'Field notes',
    contentType: 'written',
    durationSeconds: null,
    thumbnailUrl: null,
    sortOrder: 0,
  },
  streamingUrl: null,
  waveformUrl: null,
  body: null,
  initialProgressSeconds: 0,
  playlist: [],
  completions: [],
};

function fetchFieldNotes() {
  return fetchInCoursePractice(
    ctx,
    'user-1',
    basePractice.course.id,
    'field-notes'
  );
}

describe('fetchInCoursePractice', () => {
  beforeEach(() => {
    inCoursePractice.mockReset();
  });

  it('renders an editor-written (TipTap JSON) body, which the markdown column alone left empty', async () => {
    inCoursePractice.mockResolvedValue({
      ...basePractice,
      body: {
        contentBody: null,
        contentBodyJson: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Set your intention.' }],
            },
          ],
        },
      },
    });

    const result = await fetchFieldNotes();

    expect(result?.bodyHtml).toContain('<p>Set your intention.</p>');
  });

  it('renders a legacy markdown body and scrubs a stored-XSS payload', async () => {
    inCoursePractice.mockResolvedValue({
      ...basePractice,
      body: {
        contentBody:
          '**safe**\n\n<script>alert(1)</script><img src="x" onerror="alert(2)">',
        contentBodyJson: null,
      },
    });

    const result = await fetchFieldNotes();

    expect(result?.bodyHtml).toContain('<strong>safe</strong>');
    expect(result?.bodyHtml).not.toContain('<script');
    expect(result?.bodyHtml).not.toContain('onerror');
  });

  it('never hands the stored body to the page', async () => {
    inCoursePractice.mockResolvedValue({
      ...basePractice,
      body: { contentBody: 'text', contentBodyJson: null },
    });

    const result = await fetchFieldNotes();

    expect(result).not.toHaveProperty('body');
  });

  it('a media practice (no body) has no bodyHtml', async () => {
    inCoursePractice.mockResolvedValue(basePractice);

    const result = await fetchFieldNotes();

    expect(result?.bodyHtml).toBeNull();
    expect(result).not.toHaveProperty('body');
  });

  it('passes through a null payload (no such practice)', async () => {
    inCoursePractice.mockResolvedValue(null);

    const result = await fetchInCoursePractice(
      ctx,
      'user-1',
      basePractice.course.id,
      'missing'
    );

    expect(result).toBeNull();
  });
});

// The can-enter read, whole and as a boolean (Codex-2hxff.60): the sales page
// and the in-course player need the refusal's `disputeHold`; the dashboard
// needs only `canEnter`.
describe('resolveCourseEntry / resolveCanEnterCourse', () => {
  beforeEach(() => {
    courseEntry.mockReset();
  });

  it('returns the whole response, dispute included', async () => {
    courseEntry.mockResolvedValue({
      canEnter: false,
      disputeHold: 'subscription_dispute',
    });
    expect(await resolveCourseEntry(ctx, 'u1', 'course-1')).toEqual({
      canEnter: false,
      disputeHold: 'subscription_dispute',
    });
    expect(courseEntry).toHaveBeenCalledWith('course-1');
  });

  it('keeps the bare boolean for the gates that need only that', async () => {
    courseEntry.mockResolvedValue({ canEnter: true, disputeHold: null });
    expect(await resolveCanEnterCourse(ctx, 'u1', 'course-1')).toBe(true);
    courseEntry.mockResolvedValue({
      canEnter: false,
      disputeHold: 'purchase_dispute',
    });
    expect(await resolveCanEnterCourse(ctx, 'u1', 'course-1')).toBe(false);
  });
});
