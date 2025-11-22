ALTER TABLE "video_playback" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "video_playback" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "video_playback" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "video_playback" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "content_access" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "content_access" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_access" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "currency" varchar(3) DEFAULT 'usd' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "stripe_payment_intent_id" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "content_access" ADD CONSTRAINT "content_access_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_content_access_organization_id" ON "content_access" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_purchases_organization_id" ON "purchases" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_purchases_stripe_payment_intent" ON "purchases" USING btree ("stripe_payment_intent_id");--> statement-breakpoint
CREATE INDEX "idx_purchases_created_at" ON "purchases" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "content_access" ADD CONSTRAINT "content_access_user_content_unique" UNIQUE("user_id","content_id");--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id");--> statement-breakpoint
ALTER TABLE "content_access" ADD CONSTRAINT "check_access_type" CHECK ("content_access"."access_type" IN ('purchased', 'subscription', 'complimentary', 'preview'));--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "check_purchase_status" CHECK ("purchases"."status" IN ('pending', 'completed', 'refunded', 'failed'));--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "check_amount_positive" CHECK ("purchases"."amount_paid_cents" >= 0);