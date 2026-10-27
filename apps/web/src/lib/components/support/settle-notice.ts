/** What a settle dialog tells the queue page once it closes (Codex-2hxff.28). */
export interface SettleNotice {
  /** `info` when it was already settled or gone: the list is refreshed. */
  variant: 'success' | 'info';
  text: string;
}
