/**
 * Shared publish/unpublish toggle helper.
 *
 * Encapsulates the API call + toast pattern used by ContentForm and ContentTable.
 * Each caller handles its own optimistic UI independently.
 */

import { toast } from '$lib/components/ui/Toast/toast-store';
import { remoteErrorMessage } from '$lib/page-builder/builder-save';
import { publishContent, unpublishContent } from '$lib/remote/content.remote';
import * as m from '$paraglide/messages';

export type ContentStatus = 'draft' | 'published' | 'archived';

/**
 * Toggle publish status for a content item.
 * Returns the new status on success, throws on failure (with toast shown).
 */
export async function togglePublishStatus(
  contentId: string,
  currentStatus: ContentStatus
): Promise<ContentStatus> {
  try {
    if (currentStatus === 'published') {
      await unpublishContent(contentId);
      toast.success(m.studio_content_form_unpublish_success());
      return 'draft';
    }
    await publishContent(contentId);
    toast.success(m.studio_content_form_publish_success());
    return 'published';
  } catch (err) {
    // A refusal the remote forwards (a 4xx) arrives as `{ status, body:
    // { message } }`, not as an Error; its words are the creator's to act on
    // (Codex-2hxff.14: the payouts message). Anything else gets our own line.
    const status = (err as { status?: unknown } | null)?.status;
    const refusal =
      typeof status === 'number' && status >= 400 && status < 500
        ? remoteErrorMessage(err)
        : undefined;
    toast.error(
      refusal ??
        (currentStatus === 'published'
          ? m.studio_content_form_unpublish_error()
          : m.studio_content_form_publish_error())
    );
    throw err;
  }
}
