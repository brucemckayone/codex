-- Codex-g49b4 — Branding-settings column-drop data audit
-- Generated: 2026-05-05 (iter-6 of ds-review loop)
--
-- PURPOSE
-- Determine whether the 6 write-orphaned columns on `branding_settings`
-- (textColorHex, shadowScale, shadowColor, textScale, headingWeight, bodyWeight)
-- can be dropped via a pure schema migration (`pnpm db:generate`) — or whether
-- a `--custom` backfill migration is needed first to copy stale column values
-- into `tokenOverrides` JSON.
--
-- BACKGROUND
-- Iter-04 (Codex-2nl7) migrated the brand-editor save path off these columns
-- and into `tokenOverrides` JSON. BrandEditorMount.svelte:54-69 omits them on
-- save. The columns retain pre-iter-04 values for orgs that had data, or stay
-- null for new orgs. Fine-tune panels (audited Codex-mdg94) all write to the
-- JSON exclusively. The remaining risk is dropping columns whose value lives
-- ONLY in the column and was never migrated to JSON.
--
-- TOKEN-KEY MAPPING (verified 2026-05-05 against BrandEditorFineTune* panels)
--   text_color_hex   → 'heading-color'   (semantic rename; verified BrandEditorFineTuneColors.svelte:54)
--   shadow_scale     → 'shadow-scale'    (verified naming convention)
--   shadow_color     → 'shadow-color'    (verified naming convention)
--   text_scale       → 'text-scale'      (verified BrandEditorFineTuneTypography.svelte:10)
--   heading_weight   → 'heading-weight'  (verified BrandEditorFineTuneTypography.svelte:11)
--   body_weight      → 'body-weight'     (verified BrandEditorFineTuneTypography.svelte:12)
--
-- INTERPRETATION
--   ALL 7 stale_* counts = 0 → safe to drop columns directly via Drizzle pure
--                              schema migration (pnpm db:generate). No data
--                              loss risk; column values are either null or
--                              already represented in tokenOverrides JSON.
--   ANY stale_* count > 0  → need a `--custom` backfill migration first that
--                            copies column values into tokenOverrides JSON for
--                            those rows. See docs/brand-editor-investigation/
--                            implementation-summary.md §"What's Still Open".
--
-- RUNTIME
--   Read-only. No row modifications. Safe to run on production.
--   Uses jsonb cast on `token_overrides` (text column) — handles null/empty
--   defensively. If any row has malformed JSON, the cast will throw — that's
--   itself a finding worth investigating before any column-drop.

WITH parsed AS (
  SELECT
    organization_id,
    text_color_hex,
    shadow_scale,
    shadow_color,
    text_scale,
    heading_weight,
    body_weight,
    CASE
      WHEN token_overrides IS NULL OR token_overrides = '' THEN NULL::jsonb
      ELSE token_overrides::jsonb
    END AS overrides_json
  FROM branding_settings
)
SELECT
  COUNT(*) FILTER (
    WHERE text_color_hex IS NOT NULL
      AND (overrides_json IS NULL OR NOT overrides_json ? 'heading-color')
  ) AS stale_text_color_hex,

  -- shadow_scale and text_scale have a default of '1' — that's the
  -- "unconfigured" sentinel, not stale data. Exclude defaults.
  COUNT(*) FILTER (
    WHERE shadow_scale IS NOT NULL AND shadow_scale <> '1'
      AND (overrides_json IS NULL OR NOT overrides_json ? 'shadow-scale')
  ) AS stale_shadow_scale,

  COUNT(*) FILTER (
    WHERE shadow_color IS NOT NULL
      AND (overrides_json IS NULL OR NOT overrides_json ? 'shadow-color')
  ) AS stale_shadow_color,

  COUNT(*) FILTER (
    WHERE text_scale IS NOT NULL AND text_scale <> '1'
      AND (overrides_json IS NULL OR NOT overrides_json ? 'text-scale')
  ) AS stale_text_scale,

  COUNT(*) FILTER (
    WHERE heading_weight IS NOT NULL
      AND (overrides_json IS NULL OR NOT overrides_json ? 'heading-weight')
  ) AS stale_heading_weight,

  COUNT(*) FILTER (
    WHERE body_weight IS NOT NULL
      AND (overrides_json IS NULL OR NOT overrides_json ? 'body-weight')
  ) AS stale_body_weight,

  -- Distinct rows that have ANY stale column value not in JSON
  COUNT(*) FILTER (
    WHERE
      (text_color_hex IS NOT NULL
        AND (overrides_json IS NULL OR NOT overrides_json ? 'heading-color'))
      OR (shadow_scale IS NOT NULL AND shadow_scale <> '1'
        AND (overrides_json IS NULL OR NOT overrides_json ? 'shadow-scale'))
      OR (shadow_color IS NOT NULL
        AND (overrides_json IS NULL OR NOT overrides_json ? 'shadow-color'))
      OR (text_scale IS NOT NULL AND text_scale <> '1'
        AND (overrides_json IS NULL OR NOT overrides_json ? 'text-scale'))
      OR (heading_weight IS NOT NULL
        AND (overrides_json IS NULL OR NOT overrides_json ? 'heading-weight'))
      OR (body_weight IS NOT NULL
        AND (overrides_json IS NULL OR NOT overrides_json ? 'body-weight'))
  ) AS rows_with_any_stale_data,

  COUNT(*) AS total_rows
FROM parsed;

-- Optional: enumerate the affected rows for inspection before backfill.
-- Uncomment if rows_with_any_stale_data > 0:
--
-- SELECT
--   organization_id,
--   text_color_hex, shadow_scale, shadow_color,
--   text_scale, heading_weight, body_weight,
--   token_overrides
-- FROM branding_settings
-- WHERE
--   (text_color_hex IS NOT NULL AND (token_overrides IS NULL OR NOT token_overrides::jsonb ? 'heading-color'))
--   OR (shadow_scale IS NOT NULL AND shadow_scale <> '1' AND (token_overrides IS NULL OR NOT token_overrides::jsonb ? 'shadow-scale'))
--   OR (shadow_color IS NOT NULL AND (token_overrides IS NULL OR NOT token_overrides::jsonb ? 'shadow-color'))
--   OR (text_scale IS NOT NULL AND text_scale <> '1' AND (token_overrides IS NULL OR NOT token_overrides::jsonb ? 'text-scale'))
--   OR (heading_weight IS NOT NULL AND (token_overrides IS NULL OR NOT token_overrides::jsonb ? 'heading-weight'))
--   OR (body_weight IS NOT NULL AND (token_overrides IS NULL OR NOT token_overrides::jsonb ? 'body-weight'));
