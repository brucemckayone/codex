/**
 * Focus `target` once something slow settles (a Try again), unless the
 * person has put focus somewhere since: only from nowhere or from inside
 * `within`. A read can take seconds; a creator who tabbed on into a field
 * meanwhile keeps it, and what they type next lands there (Codex-a6ofh.2.6
 * review R4). The shared DropdownMenu's `closeFocus` keeps the older rule
 * (<body> only): what it guards is a menu that unmounts with its items.
 *
 * "Nowhere" is more than <body>. The browser moves focus off a control
 * that went, that a region around it made inert, or that was disabled only
 * at its next rendering update, after this runs, so each of those is
 * nowhere too (Codex-a6ofh.2.9 review R2).
 */
export function focusIfLost(
  target: HTMLElement | null | undefined,
  within?: Element | null,
  options?: FocusOptions
): void {
  const active = document.activeElement;
  if (focusLost(active) || (active && within?.contains(active))) {
    target?.focus(options);
  }
}

function focusLost(active: Element | null): boolean {
  return (
    !active ||
    active === document.body ||
    !active.isConnected ||
    insideInert(active) ||
    active.matches(':disabled')
  );
}

/** By the property as well as the attribute: Svelte sets `inert` as a property. */
function insideInert(node: Element): boolean {
  for (let at: Element | null = node; at; at = at.parentElement) {
    if ((at instanceof HTMLElement && at.inert) || at.hasAttribute('inert')) {
      return true;
    }
  }
  return false;
}
