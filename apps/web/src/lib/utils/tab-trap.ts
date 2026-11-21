/**
 * Where Tab goes in a modal that keeps it inside (IntroVideoModal's rule,
 * and the Showreel theatre's): from outside the modal, to its first stop
 * (its last, going back); forward from its last stop, to its first; back
 * from its first stop, or from the modal itself, to its last. From inside
 * the modal but on none of its stops (a player's own `tabindex="-1"` box,
 * focused by a click), to its first stop, or its last going back: the
 * browser's next stop from there may lie outside (review L4, 2026-11-21).
 * Between two stops, null: the browser moves focus on its own.
 */
export function tabTarget<T>(
  stops: readonly T[],
  at: unknown,
  { back, inside, root }: { back: boolean; inside: boolean; root?: unknown }
): T | null {
  const first = stops[0];
  const last = stops.at(-1);
  if (first === undefined || last === undefined) return null;
  if (!inside || (at !== root && !stops.includes(at as T)))
    return back ? last : first;
  if (back && (at === first || at === root)) return last;
  if (!back && at === last) return first;
  return null;
}
