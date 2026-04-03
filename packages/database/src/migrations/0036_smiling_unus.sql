ALTER TABLE "branding_settings" ADD COLUMN "secondary_color_hex" varchar(7);--> statement-breakpoint
ALTER TABLE "branding_settings" ADD COLUMN "accent_color_hex" varchar(7);--> statement-breakpoint
ALTER TABLE "branding_settings" ADD COLUMN "font_body" varchar(50);--> statement-breakpoint
ALTER TABLE "branding_settings" ADD COLUMN "font_heading" varchar(50);--> statement-breakpoint
ALTER TABLE "branding_settings" ADD COLUMN "radius_value" varchar(10) DEFAULT '0.5' NOT NULL;--> statement-breakpoint
ALTER TABLE "branding_settings" ADD COLUMN "density_value" varchar(10) DEFAULT '1' NOT NULL;