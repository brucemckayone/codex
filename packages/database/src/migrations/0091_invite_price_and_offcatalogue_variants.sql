-- Journey sections — TWO SEED ARTEFACTS, removed from the stored rows.
--
-- Data-only migration (no schema change, so there is nothing for drizzle to
-- infer — scaffolded with `drizzle-kit generate --custom` so the journal entry,
-- the snapshot and the filename stay tool-generated). Same pattern as
-- `0085_journey_section_variant_collapse` and `0089_invite_card_was_a_seed_artifact`.
--
-- Beads: Codex-bb445 (the authored invite price) and Codex-ssk7s (off-catalogue
-- stored variants). Both were WRITTEN BY THE SEED GENERATOR, so this migration
-- lands together with the fix to `packages/database/scripts/seed-portals.ts`
-- `buildSections()`. Cleaning the rows without fixing the generator would let the
-- next `db:seed:portals` re-create all of it — which is exactly how these rows
-- came to exist after migrations 0087 and 0089 had already cleaned their
-- equivalents once.
--
-- ── 1. `invite.props.price` — an authored string nothing can read ─────────────
-- The invite section renders every price and every path from the AUTHORITATIVE
-- offer (`deriveOfferPaths(context.offer, ...)`), never from an authored string,
-- and `price` is declared ZERO times in `SECTION_FIELDS`. So the key was:
--   · unreachable from the editor (no field renders it),
--   · invisible to visitors (0 occurrences in the rendered public DOM — it only
--     ever appeared in the SSR hydration payload), and
--   · permanent, because the builder's save spreads section props key-by-key and
--     never drops an undeclared one.
-- It was not harmless. Until this round the BUILDER CANVAS previewed that string
-- while the published page rendered the real Stripe offer, so a creator made
-- pricing decisions against a number the page did not use. That is the whole of
-- Codex-bb445, and the code half is already fixed (the canvas now receives the
-- authoritative offer). This is the data half.
--
-- ── 2. `ache: 'default'` and `map: 'descent'` — names that are not ids ────────
-- Neither value is a composition id in `section-catalog.ts`. Both rendered
-- correctly ONLY because `resolveVariant` fell through to `def.defaultVariant`:
--   ache 'default' → 'column'  (ache ids: column, statement, paired, list, quote, checklist)
--   map  'descent' → 'spine'   (map ids:  spine, rows, cards, table, timeline, numbered-prose, ...)
-- `descent` is the map section's PROSE name, not an id. Writing the resolved id
-- makes the intent explicit and removes the dependency on a fallback: today a
-- change to either `defaultVariant` would silently re-compose every one of these
-- published pages, with nothing in the data recording what they were meant to be.
--
-- APPEARANCE IS UNCHANGED by design. Every row is rewritten to the id the
-- fallback already resolves to, so no published page changes composition. That is
-- what makes this safe to run against live data, and it is also what makes it
-- worth doing: the value is in removing the silent dependency, not in changing a
-- pixel.
--
-- ORDER IS THE PAGE. `WITH ORDINALITY` + `ORDER BY ord` is mandatory — `jsonb_agg`
-- over `jsonb_array_elements` without it may reorder the array, and section order
-- IS the page's structure.
--
-- SOFT-DELETED PAGES ARE INCLUDED DELIBERATELY (no `deleted_at IS NULL` filter):
-- a restored page must not reintroduce either artefact.
--
-- FALSIFY (run before and after; the first must be non-zero, the second zero):
--   SELECT count(*) FROM landing_pages lp, jsonb_array_elements(lp.sections) s
--    WHERE (s->>'type'='invite' AND s->'props' ? 'price')
--       OR (s->>'type'='ache'   AND s->>'variant'='default')
--       OR (s->>'type'='map'    AND s->>'variant'='descent');
-- And prove nothing else moved — this must be byte-identical before and after:
--   SELECT id, jsonb_array_length(sections),
--          (SELECT string_agg(e->>'type', ',' ORDER BY o)
--             FROM jsonb_array_elements(sections) WITH ORDINALITY t(e,o))
--     FROM landing_pages ORDER BY id;

UPDATE landing_pages lp
SET sections = (
      SELECT jsonb_agg(
               CASE
                 WHEN s->>'type' = 'invite' AND s->'props' ? 'price'
                   THEN jsonb_set(s, '{props}', (s->'props') - 'price')
                 WHEN s->>'type' = 'ache' AND s->>'variant' = 'default'
                   THEN jsonb_set(s, '{variant}', '"column"'::jsonb)
                 WHEN s->>'type' = 'map' AND s->>'variant' = 'descent'
                   THEN jsonb_set(s, '{variant}', '"spine"'::jsonb)
                 ELSE s
               END
               ORDER BY ord
             )
        FROM jsonb_array_elements(lp.sections) WITH ORDINALITY AS t(s, ord)
    )
WHERE lp.sections IS NOT NULL
  AND jsonb_typeof(lp.sections) = 'array'
  AND EXISTS (
        SELECT 1
          FROM jsonb_array_elements(lp.sections) AS e
         WHERE (e->>'type' = 'invite' AND e->'props' ? 'price')
            OR (e->>'type' = 'ache'   AND e->>'variant' = 'default')
            OR (e->>'type' = 'map'    AND e->>'variant' = 'descent')
      );
