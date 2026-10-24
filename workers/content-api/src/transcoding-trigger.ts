import { TRANSCODING_TRIGGER_ITEM_ANSWER_CODES } from '@codex/constants';

/**
 * What upload-complete records when media-api answers its transcoding
 * trigger with an error: a creator-visible reason, or null when the answer
 * was about the item itself (gone, still uploading, no attempts left) and
 * nothing failed.
 *
 * Fails CLOSED: only media-api's named item answers are skipped, so a status
 * nobody listed (worker auth's 401/403 after a secret rotation, a router 404
 * from a wrong MEDIA_API_URL) marks the item waiting instead of leaving it
 * unmarked. The reason names the status only; the body goes to the logs.
 */
export function triggerFailureReason(
  status: number,
  body: string
): string | null {
  if (status >= 200 && status < 300) return null;
  return isItemAnswer(body) ? null : `Transcoding dispatch returned ${status}`;
}

/** procedure()'s envelope carries the specific code in error.details.code. */
function isItemAnswer(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as {
      error?: { details?: { code?: unknown } };
    } | null;
    const code = parsed?.error?.details?.code;
    return (
      TRANSCODING_TRIGGER_ITEM_ANSWER_CODES as readonly unknown[]
    ).includes(code);
  } catch {
    return false;
  }
}
