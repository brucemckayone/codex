-- Codex-g49b4 — Backfill branding_settings columns into tokenOverrides JSON
--
-- The 6 columns below were write-orphaned by iter-04 (Codex-2nl7); the brand
-- editor save path now writes exclusively to tokenOverrides JSON. Pre-iter-04
-- rows may still carry values in these columns that were never migrated to
-- the JSON blob. This migration copies any non-null column value into the
-- corresponding tokenOverrides JSON key BEFORE the column-drop migration in
-- 0060_*.sql runs, so no data is lost.
--
-- Token-key mapping (verified against BrandEditorFineTune* panels in
-- Codex-mdg94 audit):
--   text_color_hex   → 'heading-color'
--   shadow_scale     → 'shadow-scale'   (default '1' is the unconfigured sentinel; preserved)
--   shadow_color     → 'shadow-color'
--   text_scale       → 'text-scale'     (default '1' is the unconfigured sentinel; preserved)
--   heading_weight   → 'heading-weight'
--   body_weight      → 'body-weight'
--
-- Idempotent: each UPDATE only writes the JSON key when the column is non-null
-- AND the JSON key is missing. Safe to re-run; safe to run on rows where the
-- iter-04 migration has already populated the JSON. token_overrides is a
-- `text` column, so we cast to jsonb for jsonb_set, then back to text for
-- storage.

UPDATE "branding_settings"
SET "token_overrides" = jsonb_set(
  COALESCE(NULLIF("token_overrides", '')::jsonb, '{}'::jsonb),
  '{heading-color}',
  to_jsonb("text_color_hex"::text)
)::text
WHERE "text_color_hex" IS NOT NULL
  AND (
    "token_overrides" IS NULL
    OR "token_overrides" = ''
    OR NOT (NULLIF("token_overrides", '')::jsonb ? 'heading-color')
  );

--> statement-breakpoint

UPDATE "branding_settings"
SET "token_overrides" = jsonb_set(
  COALESCE(NULLIF("token_overrides", '')::jsonb, '{}'::jsonb),
  '{shadow-scale}',
  to_jsonb("shadow_scale"::text)
)::text
WHERE "shadow_scale" IS NOT NULL
  AND (
    "token_overrides" IS NULL
    OR "token_overrides" = ''
    OR NOT (NULLIF("token_overrides", '')::jsonb ? 'shadow-scale')
  );

--> statement-breakpoint

UPDATE "branding_settings"
SET "token_overrides" = jsonb_set(
  COALESCE(NULLIF("token_overrides", '')::jsonb, '{}'::jsonb),
  '{shadow-color}',
  to_jsonb("shadow_color"::text)
)::text
WHERE "shadow_color" IS NOT NULL
  AND (
    "token_overrides" IS NULL
    OR "token_overrides" = ''
    OR NOT (NULLIF("token_overrides", '')::jsonb ? 'shadow-color')
  );

--> statement-breakpoint

UPDATE "branding_settings"
SET "token_overrides" = jsonb_set(
  COALESCE(NULLIF("token_overrides", '')::jsonb, '{}'::jsonb),
  '{text-scale}',
  to_jsonb("text_scale"::text)
)::text
WHERE "text_scale" IS NOT NULL
  AND (
    "token_overrides" IS NULL
    OR "token_overrides" = ''
    OR NOT (NULLIF("token_overrides", '')::jsonb ? 'text-scale')
  );

--> statement-breakpoint

UPDATE "branding_settings"
SET "token_overrides" = jsonb_set(
  COALESCE(NULLIF("token_overrides", '')::jsonb, '{}'::jsonb),
  '{heading-weight}',
  to_jsonb("heading_weight"::text)
)::text
WHERE "heading_weight" IS NOT NULL
  AND (
    "token_overrides" IS NULL
    OR "token_overrides" = ''
    OR NOT (NULLIF("token_overrides", '')::jsonb ? 'heading-weight')
  );

--> statement-breakpoint

UPDATE "branding_settings"
SET "token_overrides" = jsonb_set(
  COALESCE(NULLIF("token_overrides", '')::jsonb, '{}'::jsonb),
  '{body-weight}',
  to_jsonb("body_weight"::text)
)::text
WHERE "body_weight" IS NOT NULL
  AND (
    "token_overrides" IS NULL
    OR "token_overrides" = ''
    OR NOT (NULLIF("token_overrides", '')::jsonb ? 'body-weight')
  );
