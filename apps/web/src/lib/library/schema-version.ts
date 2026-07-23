/**
 * Library Collection — localStorage schema versioning
 *
 * The library collection (`$lib/collections/library.ts`) persists a user's
 * cross-org content library into a single localStorage key. TanStack DB's
 * `localStorageCollectionOptions` stores each row as
 * `{ [contentId]: { versionKey, data } }`, where `versionKey` is a per-row
 * conflict UUID for cross-tab reconciliation — it is NOT a schema version.
 * Nothing today records the *shape* of the persisted `data`.
 *
 * That is fine until the shape changes. When the course-grouping work lands
 * (SPEC §11, HARDENING risk R-B) `LibraryItem` gains course-entitlement fields
 * and the library page groups by course. On the first load after that ships,
 * the collection would hydrate OLD-shape rows straight out of localStorage;
 * the new grouping/filter code reads fields those rows never had, so items
 * drop out of view — an empty library that stays empty until a server refetch
 * happens to overwrite every row. That is R-B: "schema change strands stale
 * localStorage".
 *
 * This module scaffolds a schema-version stamp plus a branch that runs BEFORE
 * the collection is created, so an incompatible payload is migrated or
 * discarded (discard is self-healing: the collection loads empty, then
 * `loadLibraryFromServer()` on mount refetches current-shape rows) instead of
 * hydrated as garbage.
 *
 * IMPORTANT — behaviour today is unchanged. At the introduction version (v1)
 * there is no schema change yet, so:
 *   - a payload already stamped v1 hydrates untouched (the fast path), and
 *   - an UNSTAMPED payload is, by definition, current-shape (it was written by
 *     this same code), so it is adopted (stamped, kept) — no discard, no
 *     empty-library flash for existing users.
 * The discard/migrate branch only fires once `LIBRARY_SCHEMA_VERSION` is
 * bumped for a real shape change.
 *
 * @see $lib/collections/library.ts — the collection this guards.
 * @see $lib/library/filter-by-org.ts — the cross-org filter that trusts the
 *   entries this guard keeps current-shape.
 */

/**
 * localStorage key the library collection persists into. Single source of
 * truth — imported by `library.ts` for the collection's `storageKey`.
 *
 * NOTE: `version-manifest.ts` keeps its own copy of this literal in
 * `CODEX_STORAGE_KEYS` (for logout-clear). That module is being reworked in
 * parallel (CE-5); once it settles it should import this constant too.
 */
export const LIBRARY_STORAGE_KEY = 'codex-library';

/** localStorage key holding the library payload's schema-version stamp. */
export const LIBRARY_SCHEMA_STORAGE_KEY = 'codex-library-schema';

/**
 * Current schema version of the library localStorage payload.
 *
 * BUMP THIS whenever the persisted `LibraryItem` shape changes in a way old
 * rows can't satisfy (e.g. the course-grouping change). Bumping it activates
 * the discard/migrate branch for every older payload. If the new shape can be
 * derived from the old one, register a migration in `librarySchemaMigrations`
 * instead of relying on discard.
 */
export const LIBRARY_SCHEMA_VERSION = 1;

/**
 * The version at which schema-stamping was introduced. Used to distinguish
 * "unstamped because stamping did not exist yet" (safe to adopt as current at
 * introduction) from "unstamped at a later version" (unknown provenance →
 * discard). Do not change this when bumping `LIBRARY_SCHEMA_VERSION`.
 */
const INTRODUCTION_VERSION = 1;

/**
 * Transforms a raw stored payload string (the TanStack DB
 * `{ [key]: { versionKey, data } }` JSON blob) from the version it is keyed
 * under towards the current shape, or returns `null` to signal "cannot
 * migrate — discard instead". Migrations are keyed by the version being
 * migrated FROM.
 *
 * Empty today (the scaffold discards on any mismatch). The course-grouping
 * change can register `{ 1: (raw) => addCourseFields(raw) }` here to preserve
 * a user's local library across the bump instead of forcing a refetch.
 */
export type LibrarySchemaMigration = (rawPayload: string) => string | null;
export type LibrarySchemaMigrations = Readonly<
  Record<number, LibrarySchemaMigration>
>;

export const librarySchemaMigrations: LibrarySchemaMigrations = {};

/**
 * Outcome of a reconcile pass, surfaced for observability/tests.
 * - `current`     — stamp already matches; payload hydrates as-is.
 * - `initialized` — no stamp at the introduction version (or no payload); the
 *                   current stamp was recorded and any payload was kept.
 * - `migrated`    — an older payload was transformed in place by a migration.
 * - `discarded`   — an incompatible payload was cleared (self-heals on next
 *                   server fetch).
 * - `unavailable` — no usable storage (SSR, blocked localStorage); no-op.
 */
export type LibrarySchemaReconcileOutcome =
  | 'current'
  | 'initialized'
  | 'migrated'
  | 'discarded'
  | 'unavailable';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Reconcile the persisted library payload's schema version.
 *
 * Call this synchronously BEFORE the collection is created — TanStack DB reads
 * localStorage the first time the collection syncs, so the payload must be
 * made compatible first.
 *
 * `currentVersion`, `introductionVersion` and `migrations` are injectable so
 * the branch is unit-testable without mutating the real module constants or
 * touching real localStorage.
 */
export function reconcileLibrarySchemaVersion(
  storage: StorageLike | null | undefined,
  options: {
    currentVersion?: number;
    introductionVersion?: number;
    migrations?: LibrarySchemaMigrations;
  } = {}
): LibrarySchemaReconcileOutcome {
  if (!storage) return 'unavailable';

  const current = options.currentVersion ?? LIBRARY_SCHEMA_VERSION;
  const introduction = options.introductionVersion ?? INTRODUCTION_VERSION;
  const migrations = options.migrations ?? librarySchemaMigrations;

  try {
    const stored = readStamp(storage);

    // Fast path: the stamp already matches — the payload is current-shape, so
    // hydrate it untouched.
    if (stored === current) return 'current';

    // Bootstrap at the introduction version: an unstamped payload was written
    // by this same code, so it is current-shape. Adopt it (record the stamp,
    // keep the data). This is the behaviour-preserving path for users who
    // predate stamping — no discard, no empty-library flash.
    if (stored === null && current === introduction) {
      writeStamp(storage, current);
      return 'initialized';
    }

    // Otherwise the stored payload predates the current shape (older/unknown
    // stamp, or unstamped once we are past the introduction version). Migrate
    // it if a migration is registered for its version, else discard so the
    // collection reloads clean from the server on next mount.
    const rawPayload = storage.getItem(LIBRARY_STORAGE_KEY);
    if (rawPayload === null) {
      // Nothing persisted to strand; just record the current stamp.
      writeStamp(storage, current);
      return 'initialized';
    }

    const migration = stored === null ? undefined : migrations[stored];
    const migrated = migration ? safeMigrate(migration, rawPayload) : null;

    if (migrated !== null) {
      storage.setItem(LIBRARY_STORAGE_KEY, migrated);
      writeStamp(storage, current);
      return 'migrated';
    }

    storage.removeItem(LIBRARY_STORAGE_KEY);
    writeStamp(storage, current);
    return 'discarded';
  } catch {
    // localStorage blocked/unavailable — never block collection creation.
    return 'unavailable';
  }
}

/** Read the stamp as an integer, or `null` when absent or corrupt. */
function readStamp(storage: StorageLike): number | null {
  const raw = storage.getItem(LIBRARY_SCHEMA_STORAGE_KEY);
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function writeStamp(storage: StorageLike, version: number): void {
  storage.setItem(LIBRARY_SCHEMA_STORAGE_KEY, String(version));
}

/** Run a migration, treating a thrown error as "unmigratable" (→ discard). */
function safeMigrate(
  migration: LibrarySchemaMigration,
  rawPayload: string
): string | null {
  try {
    return migration(rawPayload);
  } catch {
    return null;
  }
}
