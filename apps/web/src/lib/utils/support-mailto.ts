/**
 * The `mailto:` behind every "Contact support" link (Codex-2hxff.60).
 *
 * The address is `PLATFORM_SUPPORT_EMAIL`, so it lives in one place; the
 * links used to hardcode `support@codex.example`, a reserved domain that
 * never receives mail. The subject goes through `encodeURIComponent`, so a
 * subject with a space, `&` or `?` cannot break the URL.
 */

import { PLATFORM_SUPPORT_EMAIL } from '@codex/constants';

export function supportMailto(subject: string): string {
  return `mailto:${PLATFORM_SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}
