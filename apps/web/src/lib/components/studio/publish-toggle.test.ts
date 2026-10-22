/**
 * The publish toggle toasts a refusal in its own words (Codex-2hxff.14).
 *
 * `publishContent` forwards a 4xx as SvelteKit's `error(status, message)`,
 * which reaches the client as `{ status, body: { message } }`, not as an
 * Error. Reading only `err.message` turned "Set up payouts before
 * publishing…" into the generic failure line.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as m from '$paraglide/messages';

const remote = vi.hoisted(() => ({
  publishContent: vi.fn(),
  unpublishContent: vi.fn(),
}));
vi.mock('$lib/remote/content.remote', () => remote);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('$lib/components/ui/Toast/toast-store', () => ({ toast }));

import { togglePublishStatus } from './publish-toggle';

const PAYOUTS =
  'Set up payouts before publishing paid or subscriber content. Complete Stripe Connect onboarding to receive payments.';

describe('togglePublishStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a forwarded refusal toasts its own message', async () => {
    const refusal = { status: 422, body: { message: PAYOUTS } };
    remote.publishContent.mockRejectedValueOnce(refusal);

    await expect(togglePublishStatus('c1', 'draft')).rejects.toBe(refusal);
    expect(toast.error).toHaveBeenCalledWith(PAYOUTS);
  });

  it('a server error keeps our own line, not its sanitised text', async () => {
    remote.publishContent.mockRejectedValueOnce({
      status: 500,
      body: { message: 'An unexpected error occurred' },
    });

    await expect(togglePublishStatus('c1', 'draft')).rejects.toBeDefined();
    expect(toast.error).toHaveBeenCalledWith(
      m.studio_content_form_publish_error()
    );
  });

  it('a failed unpublish says so', async () => {
    remote.unpublishContent.mockRejectedValueOnce({ status: 500, body: {} });

    await expect(togglePublishStatus('c1', 'published')).rejects.toBeDefined();
    expect(toast.error).toHaveBeenCalledWith(
      m.studio_content_form_unpublish_error()
    );
  });

  it('publishes a draft', async () => {
    remote.publishContent.mockResolvedValueOnce(undefined);

    await expect(togglePublishStatus('c1', 'draft')).resolves.toBe('published');
    expect(toast.success).toHaveBeenCalledWith(
      m.studio_content_form_publish_success()
    );
  });
});
