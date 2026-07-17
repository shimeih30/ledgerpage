CREATE TABLE `tax_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tax_codes_company_is_singleton" CHECK("tax_codes"."company_id" = 'primary_company'),
	CONSTRAINT "tax_codes_category_valid" CHECK("tax_codes"."category" IN ('standard', 'zero_rated', 'exempt', 'other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_codes_company_code_unique` ON `tax_codes` (`company_id`,`code`);--> statement-breakpoint
CREATE TABLE `tax_rate_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`tax_code_id` text NOT NULL,
	`rate_ppm` integer,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tax_code_id`) REFERENCES `tax_codes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tax_rate_versions_rate_non_negative" CHECK("tax_rate_versions"."rate_ppm" IS NULL OR "tax_rate_versions"."rate_ppm" >= 0),
	CONSTRAINT "tax_rate_versions_rate_max" CHECK("tax_rate_versions"."rate_ppm" IS NULL OR "tax_rate_versions"."rate_ppm" <= 5000000),
	CONSTRAINT "tax_rate_versions_from_shape" CHECK("tax_rate_versions"."effective_from" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "tax_rate_versions_to_shape" CHECK("tax_rate_versions"."effective_to" IS NULL OR "tax_rate_versions"."effective_to" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "tax_rate_versions_date_order" CHECK("tax_rate_versions"."effective_to" IS NULL OR "tax_rate_versions"."effective_to" >= "tax_rate_versions"."effective_from")
);
