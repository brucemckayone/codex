/**
 * A piece's status in the content lists (Codex-a6ofh.2, the epic review): a
 * piece that has been live and is a draft again is off sale, never a draft.
 */
import { describe, expect, it } from 'vitest';
import * as m from '$paraglide/messages';
import { listStatus } from './list-status';

describe('listStatus', () => {
  it('a draft never live is a draft', () => {
    expect(listStatus({ status: 'draft', publishedAt: null })).toEqual({
      label: m.studio_content_status_draft(),
      variant: 'draft',
    });
  });

  it('one unpublished since is off sale, styled as a draft', () => {
    expect(
      listStatus({ status: 'draft', publishedAt: '2026-11-01T09:00:00.000Z' })
    ).toEqual({ label: m.studio_live_badge_unpublished(), variant: 'draft' });
  });

  it('published and archived say so', () => {
    expect(
      listStatus({ status: 'published', publishedAt: '2026-11-01' }).variant
    ).toBe('published');
    expect(
      listStatus({ status: 'archived', publishedAt: '2026-11-01' })
    ).toEqual({
      label: m.studio_content_status_archived(),
      variant: 'archived',
    });
  });
});
