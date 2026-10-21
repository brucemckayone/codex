ALTER TABLE "users" ADD COLUMN "avatar_width" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_height" integer;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "cover_image_width" integer;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "cover_image_height" integer;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "thumbnail_width" integer;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "thumbnail_height" integer;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "cover_image_width" integer;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "cover_image_height" integer;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "hero_image_width" integer;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "hero_image_height" integer;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "signature_image_width" integer;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "signature_image_height" integer;