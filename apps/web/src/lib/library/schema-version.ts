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
 * That is fine until the shape changes. Without a stamp, the collection would
 * hydrate OLD-shape rows straight out of localStorage; code that reads fields
 * those rows never had drops items out of view — an empty library that stays
 * empty until a server refetch happens to overwrite every row. That is
 * HARDENING risk R-B: "schema change strands stale localStorage".
 *
 * This module holds a schema-version stamp plus a branch that runs BEFORE the
 * collection is created, so an incompatible payload is migrated or discarded
 * (discard is self-healing: the collection loads empty, then
 * `loadLibraryFromServer()` on mount refetches current-shape rows) instead of
 * hydrated as garbage.
 *
 * Version history:
 *   - v1 — introduction. Stamping did not exist before this, so an UNSTAMPED
 *     payload found at v1 is by definition current-shape and is adopted
 *     (stamped, kept) rather than discarded.
 *   - v2 — `LibraryItem` gained `journeys` (portal provenance). Migrated
 *     in place from v1 by defaulting the field to `[]`; see
 *     `librarySchemaMigrations`.
 *   - v3 — `LibraryItem.content` gained `leavesAt` (the leaving notice).
 *     Migrated in place from v2 by defaulting it to `null`. A payload several
 *     versions old runs each migration in turn.
 *
 * @see $lib/collections/library.ts — the collection this guards.
 * @see $lib/library/filter-by-org.ts — the cross-org filter that trusts the
 *   entries this guard keeps current-shape.
 */

/**
 * localStorage key the library collection persists into. Single source of
 * truth — imported by `library.ts` for the collection's `storageKey`.
 *
 * NOTE: `$lib/client/user-scoped-state.ts` keeps its own copy of this literal
 * (and of `LIBRARY_SCHEMA_STORAGE_KEY`) in `USER_SCOPED_LOCAL_KEYS`, so that
 * both are wiped when a different user is observed on this origin. It cannot
 * import them from here: this module pulls in the migration table, and the
 * clear primitive must stay dependency-free enough to run in the root layout's
 * synchronous init on every origin.
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
export const LIBRARY_SCHEMA_VERSION = 3;

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
 * under to the NEXT version's shape, or returns `null` to signal "cannot
 * migrate — discard instead". Migrations are keyed by the version being
 * migrated FROM, and a payload several versions old runs each one in turn
 * (v1 → v2 → v3), so each migration knows only its own step.
 *
 * Registering a migration is preferred over relying on discard whenever the
 * new shape is derivable from the old one: discard leaves the library visibly
 * empty until `loadLibraryFromServer()` returns, and that request takes
 * several seconds.
 */
export type LibrarySchemaMigration = (rawPayload: string) => string | null;
export type LibrarySchemaMigrations = Readonly<
  Record<number, LibrarySchemaMigration>
>;

/**
 * Walk every stored row's `data` through `edit`, which updates it in place,
 * returning `false` for a row it cannot read. The payload must be TanStack
 * DB's `{ [contentId]: { versionKey, data } }`. Anything else, or any row
 * `edit` refuses, returns `null`, so the reconciler discards rather than write
 * back a half-understood payload.
 */
function editEachRow(
  rawPayload: string,
  edit: (data: Record<string, unknown>) => boolean
): string | null {
  const parsed: unknown = JSON.parse(rawPayload);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  for (const row of Object.values(parsed as Record<string, unknown>)) {
    if (row === null || typeof row !== 'object') return null;
    const data = (row as { data?: unknown }).data;
    if (data === null || typeof data !== 'object') return null;
    if (!edit(data as Record<string, unknown>)) return null;
  }
  return JSON.stringify(parsed);
}

const librarySchemaMigrations: LibrarySchemaMigrations = {
  /**
   * v1 → v2: `LibraryItem` gained `journeys` — the portal(s) a practice sits
   * inside, which drives the library's "part of <portal>" provenance badge.
   *
   * Old rows simply lack the field, and `[]` ("stands alone") is the correct
   * default: it is what the server returns for a practice in no portal, so a
   * migrated row renders identically to a fresh one for the common case. The
   * refetch on mount then fills in real provenance for the minority that do
   * belong to a portal. Migrating rather than discarding means existing users
   * keep a populated library through the deploy instead of staring at an empty
   * one for the duration of the library fetch.
   */
  1: (rawPayload) =>
    editEachRow(rawPayload, (item) => {
      if (!Array.isArray(item.journeys)) item.journeys = [];
      return true;
    }),

  /**
   * v2 → v3: `LibraryItem.content` gained `leavesAt` (the leaving notice,
   * Codex-a6ofh.6.3): when a deleted piece leaves its owners' shelves.
   *
   * `null` ("not leaving") is the correct default: a row cached before the
   * field existed was cached before any piece could be leaving, and the
   * refetch on mount fills in the date for one that has started to leave
   * since.
   */
  2: (rawPayload) =>
    editEachRow(rawPayload, (item) => {
      const piece = item.content;
      if (piece === null || typeof piece !== 'object') return false;
      const shelved = piece as { leavesAt?: unknown };
      if (shelved.leavesAt === undefined) shelved.leavesAt = null;
      return true;
    }),
};

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

    // Otherwise the stored payload is not current-shape: migrate it (below),
    // else discard so the collection reloads clean from the server on next
    // mount.
    const rawPayload = storage.getItem(LIBRARY_STORAGE_KEY);
    if (rawPayload === null) {
      // Nothing persisted to strand; just record the current stamp.
      writeStamp(storage, current);
      return 'initialized';
    }

    // Only an OLDER stamp migrates. Unstamped (past the introduction
    // version) and newer-than-current (a rolled-back deploy) are unknown
    // shapes, so they discard.
    const migrated =
      stored !== null && stored < current
        ? migrateFrom(migrations, stored, current, rawPayload)
        : null;

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

/**
 * Run every migration from `from` up to `to`, one version at a time, or
 * `null` (→ discard) when a step is missing, returns null or throws.
 */
function migrateFrom(
  migrations: LibrarySchemaMigrations,
  from: number,
  to: number,
  rawPayload: string
): string | null {
  let payload: string | null = rawPayload;
  try {
    for (let version = from; payload !== null && version < to; version++) {
      const migration = migrations[version];
      payload = migration ? migration(payload) : null;
    }
  } catch {
    return null;
  }
  return payload;
}
