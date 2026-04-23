-- Repair migration: no prior migration emits the ADD COLUMN for
-- subscriptions.cancel_at_period_end even though the column appears in
-- snapshots from 0044 onward. Fresh DB provisioning therefore fails when
-- code at packages/database/src/schema/subscriptions.ts:122 expects the
-- column to exist. Idempotent via IF NOT EXISTS — safe on environments
-- that reconciled the column out-of-band.

ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "cancel_at_period_end" boolean DEFAULT false NOT NULL;
