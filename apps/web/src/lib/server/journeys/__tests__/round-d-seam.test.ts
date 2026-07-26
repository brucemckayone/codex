import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InCoursePracticeData } from '$lib/journeys/types';

/**
 * Round-D member seam — stored-XSS guard.
 *
 * The in-course player emits a written practice's `bodyHtml` via `{@html}`. That
 * HTML is stored content the worker returns UNSANITISED, so `fetchInCoursePractice`
 * MUST scrub it before it leaves the server. Here we mock ONLY the server API
 * client (no real worker fetch) and let the REAL sanitizer run — so the test
 * proves the SEAM wires the scrub, not just that the sanitizer exists. Removing
 * the `sanitizeContentHtml` call from the seam makes these assertions fail.
 */

const { inCoursePractice } = vi.hoisted(() => ({ inCoursePractice: vi.fn() }));

vi.mock('$lib/server/api', () => ({
  createServerApi: () => ({ access: { inCoursePractice } }),
}));

import { fetchInCoursePractice } from '../round-d-seam';

const ctx = {} as Parameters<typeof fetchInCoursePractice>[0];

const basePractice: InCoursePracticeData = {
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
  bodyHtml: null,
  initialProgressSeconds: 0,
  playlist: [],
  completions: [],
};

describe('fetchInCoursePractice', () => {
  beforeEach(() => {
    inCoursePractice.mockReset();
  });

  it('sanitises a stored-XSS bodyHtml before returning it', async () => {
    inCoursePractice.mockResolvedValue({
      ...basePractice,
      bodyHtml:
        '<p>safe</p><script>alert(1)</script><img src="x" onerror="alert(2)">',
    });

    const result = await fetchInCoursePractice(
      ctx,
      'user-1',
      basePractice.course.id,
      'field-notes'
    );

    expect(result?.bodyHtml).not.toContain('<script');
    expect(result?.bodyHtml).not.toContain('onerror');
    expect(result?.bodyHtml).toContain('<p>safe</p>');
  });

  it('leaves a null bodyHtml (media practice) untouched', async () => {
    inCoursePractice.mockResolvedValue({ ...basePractice, bodyHtml: null });

    const result = await fetchInCoursePractice(
      ctx,
      'user-1',
      basePractice.course.id,
      'field-notes'
    );

    expect(result?.bodyHtml).toBeNull();
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
