ALTER TABLE "branding_settings" ADD COLUMN "token_overrides" text;--> statement-breakpoint
ALTER TABLE "branding_settings" ADD COLUMN "text_color_hex" varchar(7);--> statement-breakpoint
ALTER TABLE "branding_settings" ADD COLUMN "shadow_scale" varchar(10) DEFAULT '1';--> statement-breakpoint
ALTER TABLE "branding_settings" ADD COLUMN "shadow_color" varchar(20);--> statement-breakpoint
ALTER TABLE "branding_settings" ADD COLUMN "text_scale" varchar(10) DEFAULT '1';--> statement-breakpoint
ALTER TABLE "branding_settings" ADD COLUMN "heading_weight" varchar(10);--> statement-breakpoint
ALTER TABLE "branding_settings" ADD COLUMN "body_weight" varchar(10);