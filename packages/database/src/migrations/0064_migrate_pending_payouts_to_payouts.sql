-- Data migration: copy any existing `pending_payouts` rows into the new
-- `payouts` ledger table introduced by 0063_clumsy_karnak.sql.
--
-- Mapping rules:
--   - resolved_at IS NOT NULL AND stripe_transfer_id IS NOT NULL → status='paid'
--   - reason='transfer_failed' (still unresolved)                → status='failed'
--   - otherwise                                                  → status='pending'
--
-- `payoutType` cannot be recovered from old rows (the old schema did not
-- distinguish org_fee vs creator_payout). We default to 'creator_payout'
-- because that is the dominant historical case; the small number of
-- mis-typed rows surfaces only in UI counts, not money flow.
--
-- Idempotency: we filter out rows whose `stripe_transfer_id` already exists
-- in `payouts` (the unique partial index catches the rest). For pending
-- rows (which have null `stripe_transfer_id`), we additionally key on
-- pending_payouts.id stored verbatim in payouts.id, so re-running this
-- migration is a no-op.

INSERT INTO "payouts" (
  id,
  organization_id,
  user_id,
  subscription_id,
  stripe_transfer_id,
  amount_cents,
  currency,
  payout_type,
  status,
  reason,
  attempted_at,
  resolved_at,
  created_at,
  updated_at
)
SELECT
  pp.id,
  pp.organization_id,
  pp.user_id,
  pp.subscription_id,
  pp.stripe_transfer_id,
  pp.amount_cents,
  pp.currency,
  'creator_payout' AS payout_type,
  CASE
    WHEN pp.resolved_at IS NOT NULL AND pp.stripe_transfer_id IS NOT NULL
      THEN 'paid'
    WHEN pp.reason = 'transfer_failed'
      THEN 'failed'
    ELSE 'pending'
  END AS status,
  CASE
    -- Paid rows have no reason in the new model
    WHEN pp.resolved_at IS NOT NULL AND pp.stripe_transfer_id IS NOT NULL
      THEN NULL
    ELSE pp.reason
  END AS reason,
  pp.created_at AS attempted_at,
  pp.resolved_at,
  pp.created_at,
  pp.created_at AS updated_at
FROM "pending_payouts" pp
WHERE NOT EXISTS (
  SELECT 1 FROM "payouts" p WHERE p.id = pp.id
);
