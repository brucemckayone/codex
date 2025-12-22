CREATE TABLE "branding_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"logo_url" text,
	"logo_r2_path" text,
	"primary_color_hex" varchar(7) DEFAULT '#3B82F6' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"platform_name" varchar(100) DEFAULT 'Codex Platform' NOT NULL,
	"support_email" varchar(255) NOT NULL,
	"contact_url" text,
	"timezone" varchar(100) DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"enable_signups" boolean DEFAULT true NOT NULL,
	"enable_purchases" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branding_settings" ADD CONSTRAINT "branding_settings_organization_id_platform_settings_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."platform_settings"("organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_settings" ADD CONSTRAINT "contact_settings_organization_id_platform_settings_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."platform_settings"("organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_settings" ADD CONSTRAINT "feature_settings_organization_id_platform_settings_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."platform_settings"("organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;