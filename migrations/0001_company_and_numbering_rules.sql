CREATE TABLE `company` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`trading_name` text,
	`address` text NOT NULL,
	`contact_details` text NOT NULL,
	`currency_id` text NOT NULL,
	`vat_registered` integer DEFAULT false NOT NULL,
	`logo_asset_path` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`currency_id`) REFERENCES `currencies`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "company_singleton_id" CHECK("company"."id" = 'primary_company')
);
--> statement-breakpoint
CREATE TABLE `numbering_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`document_type_key` text NOT NULL,
	`prefix` text NOT NULL,
	`padding_length` integer NOT NULL,
	`reset_behavior` text NOT NULL,
	`current_sequence_value` integer DEFAULT 0 NOT NULL,
	`current_sequence_year` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "numbering_rules_company_is_singleton" CHECK("numbering_rules"."company_id" = 'primary_company'),
	CONSTRAINT "numbering_rules_padding_length_sensible" CHECK("numbering_rules"."padding_length" > 0 AND "numbering_rules"."padding_length" <= 10),
	CONSTRAINT "numbering_rules_reset_behavior_valid" CHECK("numbering_rules"."reset_behavior" IN ('never', 'yearly')),
	CONSTRAINT "numbering_rules_sequence_non_negative" CHECK("numbering_rules"."current_sequence_value" >= 0),
	CONSTRAINT "numbering_rules_year_sensible" CHECK("numbering_rules"."current_sequence_year" IS NULL OR ("numbering_rules"."current_sequence_year" >= 1000 AND "numbering_rules"."current_sequence_year" <= 9999))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `numbering_rules_company_document_type_unique` ON `numbering_rules` (`company_id`,`document_type_key`);