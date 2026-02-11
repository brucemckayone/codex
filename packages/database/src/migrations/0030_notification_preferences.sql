CREATE TABLE "notification_preferences" (
	"user_id" TEXT PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
	"email_marketing" BOOLEAN NOT NULL DEFAULT true,
	"email_transactional" BOOLEAN NOT NULL DEFAULT true,
	"email_digest" BOOLEAN NOT NULL DEFAULT true,
	"created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
	"updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
