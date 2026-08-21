-- Journey sections · round 2 — Candlelit's `width` never reproduced today's page.
--
-- Contract: `docs/design/journey-sections/02-axis-contract.md` A3/D8 (nothing
-- already published may change appearance) and the round-2 amendment that
-- supersedes Candlelit's `width`. Found by WT-4 (map), corroborated by WT-5
-- (proof) measuring the same class of change independently.
--
-- WHAT WENT WRONG. Migration 0084 backfilled the Candlelit bundle onto every
-- pre-existing `landing_pages` row, on the research's assertion that Candlelit
-- reproduces today's appearance exactly (A3). That bet was explicitly flagged as
-- unverified — it could not be checked before any component consumed an axis.
-- Round 2 consumed the axes and measured it. On eight of the nine axes it holds.
-- On `width` it does not, and not marginally:
--
--     section   cap today      Candlelit `narrow`   delta
--     hero      48rem          48rem                 0     (pilot TUNED it here)
--     map       60rem          48rem               -12rem
--     proof     68rem          48rem               -20rem
--     reel      72rem          48rem               -24rem
--
-- Only the hero matched, and only because the WT-3 pilot had already tuned it to
-- `--jp-content-max`. `narrow` systematically narrows every other section by
-- 12–24rem, so "Candlelit reproduces today's page" was false on this axis for
-- essentially the whole page — on 695 rows, 7 of which are live journey pages.
--
-- WHY `text` (64rem) AND NOT A PER-SECTION MAP. `text` is within 8rem of every
-- real cap (map +4, proof -4, reel -8) where `narrow` is 12–24rem off three of
-- four. A per-type override map inside the preset would be more faithful still,
-- but it needs the A21/A29 preset variant maps, which do not exist yet, and it
-- would stop the preset being nine plain axes. `text` is the closest single
-- value, which is what a preset is for.
--
-- WHY THE PRESET AND THE DATA MOVE TOGETHER. `design-vocabulary.test.ts` pins
-- SECTION_DESIGN_PRESETS.candlelit to the bundle 0084 backfilled, and its comment
-- states the reason: if the preset drifts from the stored bundle, all 695 pages
-- silently become "Custom" in the picker — a creator opens the panel and finds
-- their page matches no preset. So changing one without the other is not an
-- option; the preset edit and this migration are one change.
--
-- SCOPED TO PAGE-LEVEL `design` ONLY, DELIBERATELY. Two sections on
-- `of-blood-and-bones/pricing-smoke-test` (`turn`, `feel`) carry a section-level
-- `{"align":"center","width":"narrow"}`. That is migration 0085's collapse output:
-- the prose `centered` variant was an axis-in-disguise, and 0085 wrote the axes it
-- encoded precisely so those sections keep their published appearance. They
-- genuinely rendered narrow. Overwriting them would destroy what 0085 preserved,
-- so a section override at `narrow` correctly stays at 48rem while its page moves
-- to 64rem. Section-level design is a creator's content (F-C's principle); only
-- the backfilled page-level bundle is ours to correct.
--
-- The predicate matches the EXACT nine-key Candlelit bundle rather than
-- `design->>'width' = 'narrow'`. Measured: both currently select the same 695
-- rows, so the looser form is safe TODAY — but it would also catch a page a
-- creator had deliberately set to `narrow` later, and there is no way to tell
-- those apart after the fact. The exact-bundle form also leaves
-- `studio-alpha/fb2-design-default-probe` (F-B2's Signal probe, the only
-- non-Candlelit bundle) untouched.
--
-- Dry-run in a rolled-back transaction first, per 0087's precedent:
--   exact candlelit bundle .......... 695
--   width = narrow (any bundle) ..... 695   (same set — no narrow outside Candlelit)
--   total rows with a design ........ 696   (the +1 is the Signal probe)
--   section-level design overrides ... 2    (0085 collapse output, NOT touched)
-- Expect `UPDATE 695`, and a second run `UPDATE 0`.

UPDATE landing_pages
SET design = jsonb_set(design, '{width}', '"text"'),
    updated_at = now()
WHERE design = '{
  "edge": "none",
  "type": "monumental",
  "align": "center",
  "media": "bleed",
  "width": "narrow",
  "accent": "glow",
  "motion": "drift",
  "density": "airy",
  "surface": "media"
}'::jsonb;
