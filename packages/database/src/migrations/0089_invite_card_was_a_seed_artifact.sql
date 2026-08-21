-- Journey sections · round 3 — the seeded `invite` variant was never a choice.
--
-- Contract: `docs/design/journey-sections/02-axis-contract.md` A33.
-- Found by: WT-7, the first code ever to honour `PageSection.variant` for the
-- `invite` type on the public page.
--
-- This is 0087 repeating itself on a second type, and the fact that it repeated
-- is the finding. A33 was written from the hero; it turns out to describe a CLASS
-- of defect, not an incident. Every type whose renderer discarded `variant`
-- needs this check as its worktree wires it, because the seeder wrote a value
-- for each of them and none of those values was ever expressed.
--
-- WHAT HAPPENED. `packages/database/scripts/seed-portals.ts` wrote
-- `variant: 'card'` on every invite it created (its line 499, fixed to `'pool'`
-- in the same change as this migration). The public renderer ignored `variant`
-- entirely — bead `Codex-qcgo3`, "all 37 declared layout variants are inert" —
-- so for the whole life of the feature all seven real journey pages STORED a
-- `card` invite while RENDERING the cinematic pool. Verified in both directions
-- before writing this: `data-jp-variant="card"` served on a page whose DOM was
-- unambiguously pool markup.
--
-- ALL SEVEN pages carry it — `of-blood-and-bones` x 5 (`pricing-smoke-test`,
-- `bone-deep`, `tending-the-grief`, `ancestral-threads`,
-- `return-to-the-shoreline`) and `studio-alpha` x 2 (`bone-deep`,
-- `tending-the-grief`). There is no counter-example anywhere: no invite section
-- in the database holds any other variant, which is itself the evidence that no
-- human ever picked one.
--
-- WITHOUT THIS MIGRATION, merging WT-7 flips all seven live pages from the
-- atmospheric pool to a quiet single-column card with no bloom, no vignette and
-- no descent — a visible change to published pages that no creator chose,
-- approved, or has ever seen. That is precisely the A3/D8 invariant this
-- programme is built on.
--
-- WHY REWRITING IT IS RESTORATION, NOT OVERRIDE. The same three tests 0087
-- applied, answered the same way:
--   * the value came from a SEED SCRIPT, not from a person;
--   * it was never expressed, because the renderer discarded it;
--   * `Candlelit`'s own variant map — the preset that documents "today's page" —
--     says `invite: pool` (research 4.1), so the data and the preset disagreed
--     and the data was the artifact.
-- Contrast the golden page's `turn` and `feel`, which WT-1 left alone in the
-- same round: those carry section-level `{"align":"center"}` written by 0085
-- from a `centered` variant a person selected in a builder where it visibly did
-- something. Stored design that encodes a human choice is content. A stored
-- variant that encodes a seeder's literal is not. That distinction is the whole
-- of A33 and it is worth keeping sharp, because by value alone the two are
-- indistinguishable.
--
-- `card` is NOT retired and loses nothing. It remains one of the invite's six
-- compositions, selectable in the builder and now genuinely rendered. What it
-- stops being is a default that arrived by accident.
--
-- SCOPED, like 0087 and unlike 0084/0085. This is a correction to one seeder's
-- output, so it touches only `invite` sections that still hold the artifact. An
-- invite a creator has since deliberately set to `card` is indistinguishable
-- from the artifact by value alone, which is exactly why the seeder is fixed in
-- the same change rather than relying on this running again.
--
-- IDEMPOTENT: after this runs no invite holds `card` unless a human set it, so a
-- second run matches nothing and updates zero rows.
UPDATE "landing_pages" AS lp
SET "sections" = (
  SELECT jsonb_agg(
    CASE
      WHEN s->>'type' = 'invite' AND s->>'variant' = 'card'
        THEN jsonb_set(s, '{variant}', '"pool"'::jsonb)
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
  WHERE s->>'type' = 'invite' AND s->>'variant' = 'card'
);
