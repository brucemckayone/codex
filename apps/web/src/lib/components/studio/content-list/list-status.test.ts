/**
 * A piece's status in the content lists (Codex-a6ofh.2, the epic review): a
 * piece that has been live and is not on sale is off sale, never a draft. It
 * looks muted, as archived does, and goes back with "Publish again".
 */
import { describe, expect, it } from 'vitest';
import * as m from '$paraglide/messages';
import { listStatus } from './list-status';

describe('listStatus', () => {
  it('a draft never live is a draft, published with Publish', () => {
    expect(listStatus({ status: 'draft', publishedAt: null })).toEqual({
      label: m.studio_content_status_draft(),
      variant: 'draft',
      toggle: m.studio_content_form_publish(),
    });
  });

  it('one unpublished since is off sale, muted, put back with Publish again', () => {
    expect(
      listStatus({ status: 'draft', publishedAt: '2026-11-01T09:00:00.000Z' })
    ).toEqual({
      label: m.studio_live_badge_unpublished(),
      variant: 'off-sale',
      toggle: m.studio_live_republish(),
    });
  });

  it('published is on sale, taken off with Unpublish', () => {
    expect(
      listStatus({ status: 'published', publishedAt: '2026-11-01' })
    ).toEqual({
      label: m.studio_content_status_published(),
      variant: 'published',
      toggle: m.studio_content_form_unpublish(),
    });
  });

  it('archived keeps its word, and looks and goes back as off sale', () => {
    expect(
      listStatus({ status: 'archived', publishedAt: '2026-11-01' })
    ).toEqual({
      label: m.studio_content_status_archived(),
      variant: 'off-sale',
      toggle: m.studio_live_republish(),
    });
  });
});
