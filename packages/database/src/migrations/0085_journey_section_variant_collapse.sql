-- Journey sections · F-C — THE VARIANT COLLAPSE, as stored data.
--
-- Contract: `docs/design/journey-sections/02-axis-contract.md` A9 stage 2.
-- Specification: `00-design-language-research.md` §3.
-- Forward map (the single source of truth for the rows below):
--   `apps/web/src/lib/page-builder/section-catalog.ts` → LEGACY_SECTION_VARIANTS.
--
-- Data-only migration (no schema change, so there is nothing for drizzle to
-- infer — scaffolded with `drizzle-kit generate --custom` so the journal entry,
-- the snapshot and the filename stay tool-generated). Same pattern as
-- `0082_gate_existing_course_practices`.
--
-- WHAT THIS IS FOR. A large share of the catalogue's original 37 section variants
-- were AXIS VALUES WEARING COMPOSITION NAMES: `hero: minimal` was `stage` at
-- `density: compact` + `accent: none` + `motion: none`; `prose: centered` and
-- `prose: wide` were the same arrangement at two alignments and two measures.
-- Those ids are retired so the same looks become reachable in COMBINATION with
-- everything else instead of only as one fixed variant each. A published page
-- stores the retired id, so each one maps forward to `{ new variant, the axes it
-- encoded }` and the page keeps the appearance it has today.
--
-- WHY IT IS A MIGRATION AND NOT ONLY CODE. `resolveVariant` and `resolveDesign`
-- already consult the same forward map, so no page renders wrong without this —
-- that is the safety net, and it is why this migration is about not silently
-- CHANGING a page rather than about avoiding a crash. What the safety net cannot
-- do is make the value visible: a creator opening the builder on a `centered`
-- hero would see a variant picker with nothing selected (the id it stores no
-- longer exists) and an alignment control that appears to be doing nothing. An
-- explicit stored value is inspectable, editable and diffable. Same argument as
-- A21's "a new page gets an explicit preset written, never implicit defaults".
--
-- NON-DESTRUCTIVE MERGE, and the direction matters: `m.axes || the section's own
-- design` puts the SECTION'S value on the right, and `||` lets the right side
-- win. A creator who deliberately set `align: start` on a `centered` section
-- keeps it. Overwriting would mean a data migration deleting a creator's design
-- choice, and their design choices are their content.
--
-- IDEMPOTENT and safe to re-run: after this runs no section holds any retired id,
-- so the LEFT JOIN matches nothing, the EXISTS guard excludes every page, and a
-- second run updates zero rows. Deliberately UNSCOPED by `deleted_at` and by
-- `status` — a soft-deleted page can be restored and a draft can be published,
-- so the invariant is about every row that stores a retired id, not just the
-- live ones.
--
-- VERIFIED against `of-blood-and-bones/journeys/pricing-smoke-test` (the golden
-- page, 11 sections, six of them on retired ids) — the served
-- `data-jp-variant` / `data-jp-align` / `data-jp-width` attributes are identical
-- before and after.
WITH mapping(section_type, from_variant, to_variant, axes) AS (
  VALUES
    -- hero: `centered` and `left` were one arrangement at two alignments; the
    -- base `.jp-hero` centred and `.jp-hero--left` set `text-align: left` +
    -- `justify-items: start`. `minimal` was a preset (shorter min-height, glow
    -- dimmed, motes and scroll cue hidden). `split` is a pure rename.
    ('hero',       'centered', 'stage',       '{"align":"center"}'::jsonb),
    ('hero',       'left',     'stage',       '{"align":"start"}'::jsonb),
    ('hero',       'minimal',  'stage',       '{"density":"compact","accent":"none","motion":"none"}'::jsonb),
    ('hero',       'split',    'split-media', '{}'::jsonb),

    -- video: renames. `plain` survives as its own composition because the meta
    -- row genuinely disappears rather than being restyled.
    ('introVideo', 'cinema',   'theatre',     '{}'::jsonb),
    ('introVideo', 'simple',   'plain',       '{}'::jsonb),
    ('reel',       'cinema',   'theatre',     '{}'::jsonb),
    ('reel',       'simple',   'plain',       '{}'::jsonb),

    -- prose (ache/turn/feel): `centered` capped its column at 46rem and centred
    -- (closest axis pair: `width: narrow` = 48rem, `align: center`); `wide`
    -- capped at 62rem and left the text start-aligned (`width: text` = 64rem).
    -- NOTE the name collision: the retired variant `wide` maps to `width: 'text'`,
    -- NOT to `width: 'wide'` — that axis value is 80rem and would render visibly
    -- wider than the page does today. The names collide; the measurements do not.
    ('ache',       'centered', 'column',      '{"align":"center","width":"narrow"}'::jsonb),
    ('ache',       'wide',     'column',      '{"align":"start","width":"text"}'::jsonb),
    ('ache',       'twocol',   'paired',      '{}'::jsonb),
    ('turn',       'centered', 'column',      '{"align":"center","width":"narrow"}'::jsonb),
    ('turn',       'wide',     'column',      '{"align":"start","width":"text"}'::jsonb),
    ('turn',       'twocol',   'paired',      '{}'::jsonb),
    ('feel',       'centered', 'column',      '{"align":"center","width":"narrow"}'::jsonb),
    ('feel',       'wide',     'column',      '{"align":"start","width":"text"}'::jsonb),
    ('feel',       'twocol',   'paired',      '{}'::jsonb),

    -- map: renames onto names that describe the arrangement rather than the
    -- of-blood-and-bones metaphor.
    ('map',        'descent',  'spine',       '{}'::jsonb),
    ('map',        'list',     'rows',        '{}'::jsonb),
    ('map',        'grid',     'cards',       '{}'::jsonb),

    -- guide: `.jp-guide--centered` hid the player, collapsed to one column,
    -- centred and capped at 46rem. The no-media arrangement IS `column`; the rest
    -- is axes.
    ('guide',      'centered', 'column',      '{"align":"center","width":"narrow"}'::jsonb),

    -- invite: rename.
    ('invite',     'descent',  'pool',        '{}'::jsonb)
),
rebuilt AS (
  SELECT
    lp.id,
    jsonb_agg(
      CASE
        -- Not a retired id (or not an object): pass the element through byte for
        -- byte, so a page with one stale section is not otherwise rewritten.
        WHEN m.to_variant IS NULL THEN e.s
        -- A pure rename touches `variant` and nothing else — no empty `design`
        -- key appears where the section had none.
        WHEN m.axes = '{}'::jsonb
          THEN e.s || jsonb_build_object('variant', m.to_variant)
        -- An axis-bearing id also writes the axes it encoded, UNDER anything the
        -- section already states.
        ELSE e.s
          || jsonb_build_object('variant', m.to_variant)
          || jsonb_build_object(
               'design',
               m.axes || COALESCE(e.s -> 'design', '{}'::jsonb)
             )
      END
      ORDER BY e.ord
    ) AS sections
  FROM "landing_pages" lp
  CROSS JOIN LATERAL jsonb_array_elements(lp."sections") WITH ORDINALITY AS e(s, ord)
  LEFT JOIN mapping m
    ON m.section_type = e.s ->> 'type'
   AND m.from_variant = e.s ->> 'variant'
  WHERE jsonb_typeof(lp."sections") = 'array'
    -- Only pages that actually hold a retired id. Without this every landing page
    -- would have its `sections` jsonb rewritten, and a re-run would no longer be
    -- a no-op.
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(lp."sections") AS probe
      JOIN mapping m2
        ON m2.section_type = probe ->> 'type'
       AND m2.from_variant = probe ->> 'variant'
    )
  GROUP BY lp.id
)
UPDATE "landing_pages" lp
SET "sections" = r.sections
FROM rebuilt r
WHERE lp.id = r.id;
