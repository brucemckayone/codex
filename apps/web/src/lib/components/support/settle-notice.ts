/** What a settle dialog tells the queue page once it closes (Codex-2hxff.28). */
export interface SettleNotice {
  /**
   * `info` when it was already settled or gone: the list is refreshed.
   * `warning` when nothing changed and it can be tried again ("Check Stripe
   * again" that Stripe still couldn't answer, Codex-2hxff.73).
   */
  variant: 'success' | 'info' | 'warning';
  /** Read first, in bold. */
  lead?: string;
  text: string;
}
