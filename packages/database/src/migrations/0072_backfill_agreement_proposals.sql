-- Codex-ppxtd (WP-1 of Codex-nk4km) — backfill negotiation history for
-- pre-existing creator_organization_agreements rows.
--
-- After 0071, every existing row already has revenue_type='subscription'
-- and status='active' (column defaults). This migration synthesises one
-- 'accepted' agreement_proposals row per existing agreement so that the
-- service layer (WP-2+) can assume `current_proposal_id` is always set on
-- an active agreement.
--
-- Semantics of the synthesised proposal:
--   round_number = 1 (initial offer)
--   proposed_by_role = 'owner'
--   proposed_by_user_id = the org's owner, resolved as the user with
--     organization_memberships.role='owner' AND status='active'. If the org
--     has no active owner membership (edge case for orphaned orgs) we fall
--     back to the agreement's own creator_id — the row is still useful as
--     historical record and the WP-2 service will treat 'creator'-authored
--     accepted-at-round-1 proposals as legacy backfill rows.
--   proposed_creator_share_percent = derived from the legacy
--     `organization_fee_percentage` column. The legacy column stored the
--     ORG's cut of post-platform-fee revenue, so the CREATOR's share is
--     10000 - organization_fee_percentage (basis points).
--   proposed_effective_from = the agreement's effective_from
--   status = 'accepted', responded_at = created_at, responded_by_user_id
--     = the same resolved owner (the same actor who'd have accepted their
--     own offer under the legacy single-side model).
--
-- IDEMPOTENCY (CR-2): The INSERT carries an explicit NOT EXISTS guard so a
-- second run after a partial failure (e.g. Neon connection drop between
-- INSERT and UPDATE) will not synthesise duplicate proposals. The guard
-- keys on (organization_id, creator_id, revenue_type) — narrow enough to
-- cover the post-WP-1 invariant (one active agreement per triple) and
-- broad enough to skip ANY pre-existing proposal on the triple, including
-- ones written by a previous successful run.
--
-- DETERMINISTIC UPDATE JOIN (CR-3): The CTE captures the SOURCE agreement
-- id directly in `RETURNING` (`source_agreement_id`). The subsequent UPDATE
-- joins by primary key — `a.id = i.source_agreement_id` — instead of by
-- the (org, creator, revenue_type, effective_from) tuple, so historical
-- rows that happen to collide on the tuple cannot match the wrong row.

WITH inserted AS (
  INSERT INTO "agreement_proposals" (
    "organization_id",
    "creator_id",
    "revenue_type",
    "parent_proposal_id",
    "round_number",
    "proposed_by_user_id",
    "proposed_by_role",
    "proposed_creator_share_percent",
    "proposed_term_months",
    "proposed_effective_from",
    "note",
    "status",
    "responded_at",
    "responded_by_user_id",
    "decline_reason",
    "created_at",
    "updated_at"
  )
  SELECT
    a."organization_id",
    a."creator_id",
    a."revenue_type",
    NULL::uuid,
    1,
    COALESCE(owner_m."user_id", a."creator_id"),
    'owner',
    10000 - a."organization_fee_percentage",
    NULL::integer,
    a."effective_from",
    'Backfilled from pre-WP-1 agreement (Codex-ppxtd).',
    'accepted',
    a."created_at",
    COALESCE(owner_m."user_id", a."creator_id"),
    NULL::text,
    a."created_at",
    a."created_at"
  FROM "creator_organization_agreements" a
  LEFT JOIN LATERAL (
    SELECT m."user_id"
    FROM "organization_memberships" m
    WHERE m."organization_id" = a."organization_id"
      AND m."role" = 'owner'
      AND m."status" = 'active'
    ORDER BY m."created_at" ASC
    LIMIT 1
  ) owner_m ON true
  WHERE a."current_proposal_id" IS NULL
    AND a."status" = 'active'
    AND NOT EXISTS (
      SELECT 1
      FROM "agreement_proposals" p
      WHERE p."organization_id" = a."organization_id"
        AND p."creator_id" = a."creator_id"
        AND p."revenue_type" = a."revenue_type"
    )
  RETURNING
    "id" AS proposal_id,
    -- The source agreement is the unique active row on this triple at
    -- INSERT time, captured via a correlated subquery so the UPDATE step
    -- can join by primary key (deterministic) instead of by tuple.
    (
      SELECT a2."id"
      FROM "creator_organization_agreements" a2
      WHERE a2."organization_id" = "agreement_proposals"."organization_id"
        AND a2."creator_id" = "agreement_proposals"."creator_id"
        AND a2."revenue_type" = "agreement_proposals"."revenue_type"
        AND a2."status" = 'active'
        AND a2."current_proposal_id" IS NULL
      ORDER BY a2."effective_from" DESC, a2."created_at" DESC
      LIMIT 1
    ) AS source_agreement_id
)
UPDATE "creator_organization_agreements" a
SET "current_proposal_id" = i.proposal_id
FROM inserted i
WHERE a."id" = i.source_agreement_id
  AND a."status" = 'active'
  AND a."current_proposal_id" IS NULL;
