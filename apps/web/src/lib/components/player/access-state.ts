/**
 * Access State Types
 *
 * Represents the current access state for content, used by
 * the PreviewPlayer and content detail page to determine
 * what UI to show.
 */

export type AccessState =
  | { status: 'loading' }
  | { status: 'preview' }
  | { status: 'unlocked' }
  | { status: 'locked'; reason: 'purchase_required' | 'auth_required' }
  | { status: 'error'; message: string };

/**
 * Derive the access state from page data.
 *
 * @param hasAccess - Whether the user has full access to the content
 * @param hasPreview - Whether a preview clip is available
 * @param isAuthenticated - Whether the user is logged in
 */
export function deriveAccessState(opts: {
  hasAccess: boolean;
  hasPreview: boolean;
  isAuthenticated: boolean;
}): AccessState {
  if (opts.hasAccess) {
    return { status: 'unlocked' };
  }

  if (opts.hasPreview) {
    return { status: 'preview' };
  }

  if (!opts.isAuthenticated) {
    return { status: 'locked', reason: 'auth_required' };
  }

  return { status: 'locked', reason: 'purchase_required' };
}
