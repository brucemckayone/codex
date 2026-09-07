/**
 * Bounded telemetry label for a cache `type`.
 *
 * WHY THIS EXISTS: `type` carries TWO jobs with OPPOSITE cardinality needs.
 *
 * 1. As the data-slot key suffix it MUST be high-cardinality. `public-cache.ts`
 *    folds `sort:limit:page:contentType[:cat][:feat][:slug]` into it on purpose
 *    — omitting `featured` was a real collision where `?featured=true` and the
 *    unfiltered list served each other's content. That composition stays.
 * 2. As the `statsByType` key it becomes a LOG FIELD: `getStats()` spreads it
 *    into `byType`, and `logCacheStats` spreads that into the event, so
 *    Cloudflare's log index mints `metadata.byType.<type>.{gets,hits,misses,
 *    hitRate}` — four new indexed fields per distinct value, forever.
 *
 * Measured on production 2026-09-06, hours after the gauge first deployed: 18
 * distinct families / 72 fields, three of them keyed by content slug
 * (`…:slug:embodiement-meditation`, `…:slug:some-data`,
 * `…:slug:hail-mary-prayer-in-aramaic`). Three because only three items had
 * been viewed; the count tracks the catalogue and never falls.
 *
 * TWO HARMS, and the second is the one that bites:
 * - The dimension is UNQUERYABLE. No `groupBy` can recombine per-slug fields,
 *   so the per-type split cannot answer "what is the hit rate on content
 *   detail" — the question it exists for. Confirmed in practice: the first
 *   production hit-rate reading had to aggregate on the call-site-supplied
 *   `metadata.cacheType` instead.
 * - It can BLIND the split entirely. `typeStatsFor` returns null once the map
 *   reaches MAX_TRACKED_TYPES, so an isolate that serves 64 distinct slugs
 *   stops tracking every type that arrives after — including `org:config`.
 *   Aggregate counters are unaffected, which is exactly what makes it silent.
 *
 * THE RULE IS STRUCTURAL, NOT A LIST. A label enumerated against `CacheType`
 * would normalise `org:creators:1:12` (a real prefix) and silently miss
 * `content:public:newest:…:slug:…`, because `content:public` is composed in
 * `public-cache.ts` and is not a `CacheType` value at all — the biggest
 * offender would sail straight through. Truncating at the first VARIABLE-shaped
 * segment covers composers nobody has written yet.
 */

/**
 * Segments that introduce a free-text value. The marker AND everything after
 * it is dropped, so `content:detail:slug:foo` labels as `content:detail` even
 * when no numeric segment precedes the slug.
 *
 * Bare segments only — `.split(':')` means `user:username-to-id` yields
 * `username-to-id`, which is not `id` and is correctly kept.
 */
// `/* @__PURE__ */` is load-bearing, not decoration: a module-scope CALL
// marks this module impure, which defeats tree-shaking of the @codex/cache
// barrel and drags it into every public bundle that imports anything from
// the package. apps/web routes do.
const VALUE_MARKERS = /* @__PURE__ */ new Set([
  'slug',
  'cat',
  'category',
  'search',
  'q',
  'id',
]);

/** Backstop on label depth. The deepest real label today is 3 segments. */
const MAX_LABEL_SEGMENTS = 4;

/** Label used when a type yields no stable segment at all. */
export const UNLABELLED_CACHE_TYPE = 'unlabelled';

/**
 * Literals a composer emits to stand in for an ABSENT value.
 *
 * `buildPublishedJourneysCacheType` writes `journeys:published:all:12` when a
 * limit is supplied and `journeys:published:all:default` when it is not — one
 * logical read, two log fields. A placeholder for "no value" is not a
 * dimension, so it truncates like a quantity does. `all`, `true` and `false`
 * are NOT here: those are real filter values worth keeping in the split.
 */
const ABSENT_VALUE_PLACEHOLDERS = /* @__PURE__ */ new Set([
  'default',
  'none',
  'any',
]);

/** Hoisted: `isVariableSegment` runs once per colon-segment per cache get. */
const UUID_SEGMENT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True when a segment carries data rather than naming a dimension.
 *
 * `^\d+$` and not `\d` — `org:stats:v2` must survive, and it does: `v2` is not
 * all-digits. Pagination (`1`, `12`, `50`) is.
 */
function isVariableSegment(segment: string): boolean {
  if (segment === '') return true;
  if (/^\d+$/.test(segment)) return true;
  if (ABSENT_VALUE_PLACEHOLDERS.has(segment)) return true;
  if (UUID_SEGMENT.test(segment)) return true;
  // Long enough that it is a title, a slug or a search term, not a dimension
  // name. The longest real segment is `username-to-id` at 14.
  if (segment.length > 24) return true;
  return false;
}

/**
 * Collapse a cache `type` to a bounded label safe to use as a log field name.
 *
 * Pure and total: never throws, always returns a non-empty string. Applied at
 * RECORD time (not at `getStats()` time) so `MAX_TRACKED_TYPES` guards a
 * bounded key space and slug churn can no longer evict real types.
 *
 * @example
 * cacheStatsLabel('content:public:newest:1:1:all:slug:some-post')
 * // 'content:public:newest'
 * cacheStatsLabel('org:creators:1:12')  // 'org:creators'
 * cacheStatsLabel('org:stats:v2')       // 'org:stats:v2'  (v2 is not a number)
 */
export function cacheStatsLabel(type: string): string {
  const kept: string[] = [];

  for (const segment of type.split(':')) {
    if (VALUE_MARKERS.has(segment)) break;
    if (isVariableSegment(segment)) break;
    kept.push(segment);
    if (kept.length === MAX_LABEL_SEGMENTS) break;
  }

  return kept.length > 0 ? kept.join(':') : UNLABELLED_CACHE_TYPE;
}
