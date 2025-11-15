ALTER TABLE "content" DROP CONSTRAINT "content_creator_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "content" DROP CONSTRAINT "content_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "content" DROP CONSTRAINT "content_media_item_id_media_items_id_fk";
--> statement-breakpoint
ALTER TABLE "media_items" DROP CONSTRAINT "media_items_creator_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_media_item_id_media_items_id_fk" FOREIGN KEY ("media_item_id") REFERENCES "public"."media_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_items" ADD CONSTRAINT "media_items_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;