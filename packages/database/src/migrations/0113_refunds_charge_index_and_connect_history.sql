CREATE TABLE "stripe_connect_account_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"stripe_account_id" varchar(255) NOT NULL,
	"replaced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_connect_history_user_account" ON "stripe_connect_account_history" USING btree ("user_id","stripe_account_id");--> statement-breakpoint
CREATE INDEX "idx_refunds_charge" ON "refunds" USING btree ("stripe_charge_id");--> statement-breakpoint
-- Codex-2hxff.47: remember every Connect account a user stops having, so a
-- transfer sent to it can still be found and never sent twice. A trigger,
-- not app code, so a manual support DELETE or re-key is caught too.
CREATE OR REPLACE FUNCTION record_replaced_connect_account()
RETURNS TRIGGER AS $$
BEGIN
  -- UPDATE OF fires whenever a column is in the SET list, changed or not.
  -- A row moved to another user is a replacement too: the old user loses
  -- the account their transfers went to.
  -- (A trigger's WHEN cannot test TG_OP, nor NEW on a DELETE, so the check
  -- lives here.)
  IF TG_OP = 'UPDATE'
     AND OLD.stripe_account_id IS NOT DISTINCT FROM NEW.stripe_account_id
     AND OLD.user_id IS NOT DISTINCT FROM NEW.user_id THEN
    RETURN NEW;
  END IF;
  INSERT INTO stripe_connect_account_history (user_id, stripe_account_id)
  VALUES (OLD.user_id, OLD.stripe_account_id)
  ON CONFLICT (user_id, stripe_account_id) DO NOTHING;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trigger_record_replaced_connect_account ON stripe_connect_accounts;
--> statement-breakpoint
CREATE TRIGGER trigger_record_replaced_connect_account
  AFTER DELETE OR UPDATE OF stripe_account_id, user_id ON stripe_connect_accounts
  FOR EACH ROW
  EXECUTE FUNCTION record_replaced_connect_account();
