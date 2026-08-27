/**
 * Purge a localStorage-backed TanStack DB collection on identity change.
 *
 * Codex-1g5lh.17. `clearUserScopedState()` removes the collection's
 * localStorage key, but a collection ALSO holds its rows in memory
 * (`collection.state`), seeded when the module was imported — i.e. when the
 * bundle loaded, before any layout ran. A storage-only wipe therefore leaves
 * the previous user's rows live in `state` for the rest of the document's
 * life, which is what every reader actually consults.
 *
 * Each collection module registers itself with `registerUserScopedReset` and
 * routes through this helper, rather than the registrations living in one
 * central file: a collection's rows only exist if its module was loaded, and
 * `collections/dismissals.ts` is imported directly rather than through the
 * `collections/index.ts` barrel, so a barrel-level side-effect import would
 * silently miss it.
 */

/**
 * The slice of the collection API this helper needs, declared structurally
 * rather than as `Pick<Collection<...>>`.
 *
 * `Collection`'s generics are invariant enough that any concrete
 * instantiation would reject the four differently-typed collections here, and
 * `createCollection` erases the utils generic to `UtilsRecord` — so
 * `clearStorage` is not visible on the nominal type even though
 * `localStorageCollectionOptions` always provides it. Declaring the shape we
 * use keeps every call site type-checked without an `any` at the boundary.
 */
type PurgeableCollection<TItem extends object, TKey extends string | number> = {
  readonly state: ReadonlyMap<TKey, TItem>;
  /**
   * Mirrors TanStack DB's `delete(keys | key, config?)`. The key union must be
   * spelled out (rather than just `TKey`) or contravariant inference widens
   * `TKey` to its `string | number` constraint and no concrete collection
   * matches. The returned Transaction is not used.
   */
  delete: (keys: TKey | TKey[]) => unknown;
  /** Present on every `localStorageCollectionOptions` collection. */
  utils: { clearStorage?: () => void };
};

/**
 * Delete every row from a collection, then drop its persisted payload.
 *
 * Order is deliberate. `delete()` on a `localStorageCollectionOptions`
 * collection writes through to storage, so deleting rows first and calling
 * `utils.clearStorage()` second leaves no key at all; the reverse order would
 * leave a freshly-written empty payload behind.
 *
 * Every step is individually guarded. A collection whose sync has not started
 * can reject a `delete`, and one row refusing to go must not strand the rest —
 * nor take down the root layout, which is where this runs.
 */
export function purgeLocalCollection<
  TItem extends object,
  TKey extends string | number,
>(collection: PurgeableCollection<TItem, TKey> | undefined): void {
  if (!collection) return;

  let keys: TKey[] = [];
  try {
    // Snapshot before deleting — removing entries from a live Map iterator
    // can skip the ones that follow.
    keys = Array.from(collection.state.keys());
  } catch {
    // `state` unreadable (collection not initialised). clearStorage() below
    // still drops the persisted copy.
    keys = [];
  }

  for (const key of keys) {
    try {
      collection.delete(key);
    } catch {
      // Row could not be deleted (collection not synced, key already gone).
      // One stubborn row must not strand the rest.
    }
  }

  try {
    collection.utils.clearStorage?.();
  } catch {
    // Storage blocked — clearUserScopedState() also removes the key directly.
  }
}
