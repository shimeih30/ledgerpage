CREATE TABLE `customer_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text,
	`phone` text,
	`email` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `customer_contacts_customer_idx` ON `customer_contacts` (`customer_id`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`contact_details` text,
	`payment_terms_days` integer,
	`credit_limit_minor` integer,
	`currency_id` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`currency_id`) REFERENCES `currencies`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "customers_company_is_singleton" CHECK("customers"."company_id" = 'primary_company'),
	CONSTRAINT "customers_payment_terms_days_non_negative" CHECK("customers"."payment_terms_days" IS NULL OR "customers"."payment_terms_days" >= 0),
	CONSTRAINT "customers_credit_limit_non_negative" CHECK("customers"."credit_limit_minor" IS NULL OR "customers"."credit_limit_minor" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_company_code_unique` ON `customers` (`company_id`,`code`);