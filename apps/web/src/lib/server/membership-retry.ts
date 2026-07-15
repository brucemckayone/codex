/**
 * Membership read-after-write retry (Codex-jko8i).
 *
 * Immediately after org creation (become-creator → `/studio`), the just-committed
 * owner membership row can be momentarily invisible to a follow-up read on a
 * different per-request DB pool connection (Neon read-your-writes lag, ~first
 * 500ms). Without a retry, the studio guard reads `role: null` and bounces a
 * brand-new owner to `/?error=access_denied`. A short bounded retry closes that
 * window.
 *
 * WHY HERE, not in `OrganizationService.getMyMembership`: that method returns
 * `role: null` **legitimately** for genuine non-members (it is a membership
 * *check*, used across public/graceful-degradation paths). Retrying inside it
 * would make every non-member lookup wait through the full backoff before
 * returning its correct `null`. In the studio guard, a `null` role for an
 * authenticated user who has navigated to `/studio` is the *unexpected* case —
 * the only place a brief retry is justified.
 */

export interface MembershipRole {
  role: string | null;
  joinedAt: string | null;
}

export interface ResolveMembershipOptions {
  /**
   * Backoff delays (ms) between attempts. The number of entries is the number
   * of RETRIES; total attempts = delaysMs.length + 1 (one initial read). Default
   * [80, 160, 240] → up to 4 reads over ~480ms, covering the observed lag window.
   */
  delaysMs?: number[];
  /** Injectable sleep — override in tests to avoid real timers. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolve a membership, re-reading while `role` is null.
 *
 * Returns as soon as a non-null role appears (fresh owner's row became visible),
 * or the last result (`role: null`) once the backoff is exhausted (genuine
 * non-member → caller redirects to access-denied as before).
 *
 * `fetchMembership` MUST perform an UNCACHED read (the raw API client, not the
 * cached remote `query()`), or every attempt returns the same stale result.
 */
export async function resolveMembershipWithRetry(
  fetchMembership: () => Promise<MembershipRole>,
  opts: ResolveMembershipOptions = {}
): Promise<MembershipRole> {
  const delaysMs = opts.delaysMs ?? [80, 160, 240];
  const sleep = opts.sleep ?? defaultSleep;

  let result = await fetchMembership();
  for (const delay of delaysMs) {
    if (result?.role != null) return result;
    await sleep(delay);
    result = await fetchMembership();
  }
  return result ?? { role: null, joinedAt: null };
}
