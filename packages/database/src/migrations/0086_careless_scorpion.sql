ALTER TABLE "courses" ADD COLUMN "hero_media_id" uuid;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "signature_media_id" uuid;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_hero_media_id_media_items_id_fk" FOREIGN KEY ("hero_media_id") REFERENCES "public"."media_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_signature_media_id_media_items_id_fk" FOREIGN KEY ("signature_media_id") REFERENCES "public"."media_items"("id") ON DELETE set null ON UPDATE no action;