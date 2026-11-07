/**
 * Focus `target` once something slow settles (a Try again), unless the
 * person has put focus somewhere since: only from nowhere (the pressed
 * control went, leaving <body>) or from inside `within`. A read can take
 * seconds; a creator who tabbed on into a field meanwhile keeps it, and
 * what they type next lands there (Codex-a6ofh.2.6 review R4). The shared
 * DropdownMenu's `closeFocus` keeps the same rule.
 */
export function focusIfLost(
  target: HTMLElement | null | undefined,
  within?: Element | null
): void {
  const active = document.activeElement;
  const lost = !active || active === document.body;
  if (lost || (active && within?.contains(active))) target?.focus();
}
