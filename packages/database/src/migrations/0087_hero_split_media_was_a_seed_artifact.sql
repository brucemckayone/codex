-- Journey sections · post-pilot — the seeded `hero` variant was never a choice.
--
-- Contract: `docs/design/journey-sections/02-axis-contract.md` A33.
-- Found by: the WT-3 hero pilot, which was the first code ever to honour
-- `PageSection.variant` on the public page.
--
-- WHAT HAPPENED. `seed-portals.ts` wrote `variant: 'split'` on every hero it
-- created (its line 450, now `'stage'`). The public renderer ignored `variant`
-- entirely — that is bead `Codex-qcgo3`, "all 37 declared layout variants are
-- inert" — so for the whole life of the feature every seeded page STORED a split
-- hero while RENDERING a centred stage. Migration 0085 then renamed the id in
-- place, `split` → `split-media`, faithfully preserving a value nobody had ever
-- seen take effect.
--
-- The pilot wired the plumbing. At that moment all seven real journey pages
-- (five on `of-blood-and-bones`, two on `studio-alpha`) would have silently
-- flipped from a centred stage to a two-column split-media hero — a visible
-- change to live pages that no creator chose, approved, or had ever seen.
--
-- WHY REWRITING IT IS RESTORATION, NOT OVERRIDE. F-C's collapse migration was
-- built on the principle that a creator's design choices are their content, and
-- it merges non-destructively (`m.axes || section.design`, section wins) for
-- exactly that reason. This is the opposite case and the distinction matters:
--   • the value came from a SEED SCRIPT, not from a person;
--   • it was never expressed, because the renderer discarded it;
--   • `Candlelit`'s own variant map — the preset that documents "today's page" —
--     says `hero: stage` (research §4.1), so the data and the preset disagreed
--     and the data was the artifact.
-- Writing `stage` restores what every visitor has actually been looking at. That
-- is the programme's standing invariant (A3/D8: nothing already published may
-- change appearance), and leaving `split-media` would have broken it.
--
-- `split-media` is NOT retired and loses nothing. It remains one of the hero's
-- six compositions, selectable in the builder. What it stops being is a default
-- that arrived by accident.
--
-- SCOPED, unlike 0084/0085. Those two were deliberately unscoped because their
-- invariants were about every row that predates a column. This one is a
-- correction to one seeder's output, so it touches only `hero` sections that
-- still hold the artifact — a hero a creator has since deliberately set to
-- `split-media` in the builder is indistinguishable from the artifact by value
-- alone, which is precisely why the seeder was fixed in the same change rather
-- than relying on this running again.
--
-- IDEMPOTENT: after this runs no hero holds `split-media` unless a human set it,
-- so a second run matches nothing and updates zero rows.
UPDATE "landing_pages" AS lp
SET "sections" = (
  SELECT jsonb_agg(
    CASE
      WHEN s->>'type' = 'hero' AND s->>'variant' = 'split-media'
        THEN jsonb_set(s, '{variant}', '"stage"'::jsonb)
      ELSE s
    END
    ORDER BY idx
  )
  FROM jsonb_array_elements(lp."sections") WITH ORDINALITY AS t(s, idx)
),
"updated_at" = now()
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements(lp."sections") AS s
  WHERE s->>'type' = 'hero' AND s->>'variant' = 'split-media'
);
