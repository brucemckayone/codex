/**
 * Identity Response Types
 *
 * Canonical home for identity/account response types.
 * Previously in @codex/shared-types — moved here for domain ownership.
 */

/**
 * Response for POST /api/user/avatar
 * Returns the uploaded avatar URL and metadata
 */
export interface AvatarUploadResponse {
  avatarUrl: string;
  size: number;
  mimeType: string;
}
