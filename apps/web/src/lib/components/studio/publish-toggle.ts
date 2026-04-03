/**
 * Shared publish/unpublish toggle helper.
 *
 * Encapsulates the API call + toast pattern used by ContentForm and ContentTable.
 * Each caller handles its own optimistic UI independently.
 */

import { toast } from '$lib/components/ui/Toast/toast-store';
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
    const message =
      err instanceof Error
        ? err.message
        : m.studio_content_form_publish_error();
    toast.error(message);
    throw err;
  }
}
