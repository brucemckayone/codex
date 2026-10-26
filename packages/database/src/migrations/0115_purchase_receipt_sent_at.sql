ALTER TABLE "purchases" ADD COLUMN "receipt_sent_at" timestamp with time zone;--> statement-breakpoint
-- Codex-mat01: one receipt per purchase, claimed on receipt_sent_at. A
-- purchase recorded before this migration has had its receipt, or was refunded
-- in full first and gets none, so every one is marked claimed: a late
-- redelivery of an old checkout must not send a second receipt. Refunded rows
-- are included because a refund that later fails puts the purchase back to
-- completed. Pending and failed rows never had one.
UPDATE "purchases"
SET "receipt_sent_at" = COALESCE("purchased_at", "created_at")
WHERE "status" IN ('completed', 'refunded') AND "receipt_sent_at" IS NULL;
