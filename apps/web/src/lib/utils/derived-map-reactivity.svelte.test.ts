/**
 * Proves that a plain `Map` CONSTRUCTED INSIDE `$derived.by` is fully reactive,
 * so `svelte-autofixer`'s "use SvelteMap instead" suggestion does not apply to
 * that shape.
 *
 * The autofixer flags every `new Map()` it sees in a component. `SvelteMap`
 * exists for a Map held in `$state` and MUTATED IN PLACE — there, the mutation
 * is invisible to the reactivity graph, so readers never re-run. The monetisation
 * and revenue-share pages do the opposite: each `$derived.by` builds a FRESH Map
 * from its dependencies and never touches it again, so re-derivation is what
 * republishes the data and `SvelteMap` would add a proxy for nothing.
 *
 * This test is the falsifier. If a plain Map inside `$derived.by` were
 * non-reactive, `lookup.get(...)` would go stale after the source changed and
 * the assertions below would fail — which is exactly the bug that would show up
 * as per-tier subscriber counts never appearing once data streams in.
 */

import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';

describe('plain Map inside $derived.by', () => {
  it('re-derives when its source state changes', () => {
    const cleanup = $effect.root(() => {
      let rows = $state([
        { tierId: 'a', subscriberCount: 2 },
        { tierId: 'b', subscriberCount: 5 },
      ]);
      const setRows = (next: typeof rows) => {
        rows = next;
      };

      // The exact shape used by monetisation's `subscribersByTier` and
      // revenue-share's `activeByCreatorAndType` / `pendingByCreatorAndType`.
      const lookup = $derived.by(() => {
        const map = new Map<string, number>();
        for (const row of rows) map.set(row.tierId, row.subscriberCount);
        return map;
      });

      // Read through closures: referencing a rune-backed binding directly in a
      // non-reactive position triggers `state_referenced_locally`, and R16 gates
      // the production build on those warnings.
      const get = (k: string) => lookup.get(k);
      const size = () => lookup.size;

      expect(get('a')).toBe(2);
      expect(get('b')).toBe(5);
      expect(size()).toBe(2);

      // Replace the source: the derived must rebuild the Map.
      setRows([
        { tierId: 'a', subscriberCount: 9 },
        { tierId: 'c', subscriberCount: 1 },
      ]);
      flushSync();

      expect(get('a')).toBe(9);
      expect(get('c')).toBe(1);
      // 'b' is gone — proving a NEW Map was built, not the old one mutated.
      expect(get('b')).toBeUndefined();
      expect(size()).toBe(2);
    });

    cleanup();
  });

  it('reflects an append to the source array', () => {
    const cleanup = $effect.root(() => {
      let rows = $state<Array<{ id: string; n: number }>>([]);
      const lookup = $derived.by(() => {
        const map = new Map<string, number>();
        for (const r of rows) map.set(r.id, r.n);
        return map;
      });
      const size = () => lookup.size;
      const get = (k: string) => lookup.get(k);
      const append = (r: { id: string; n: number }) => {
        rows = [...rows, r];
      };

      // The streaming case: empty on first paint, populated when data lands.
      expect(size()).toBe(0);

      append({ id: 'x', n: 3 });
      flushSync();

      expect(size()).toBe(1);
      expect(get('x')).toBe(3);
    });

    cleanup();
  });
});
