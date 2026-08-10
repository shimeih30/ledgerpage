CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`subtype` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "accounts_company_is_singleton" CHECK("accounts"."company_id" = 'primary_company'),
	CONSTRAINT "accounts_code_format" CHECK("accounts"."code" GLOB '[0-9][0-9][0-9][0-9]' OR
      "accounts"."code" GLOB '[0-9][0-9][0-9][0-9][0-9]' OR
      "accounts"."code" GLOB '[0-9][0-9][0-9][0-9][0-9][0-9]' OR
      "accounts"."code" GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9]' OR
      "accounts"."code" GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' OR
      "accounts"."code" GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' OR
      "accounts"."code" GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
	CONSTRAINT "accounts_category_valid" CHECK("accounts"."category" IN ('asset','liability','equity','revenue','cost_of_goods_sold','expense'))
);
--> statement-breakpoint
CREATE INDEX `accounts_code_idx` ON `accounts` (`code`);--> statement-breakpoint
CREATE INDEX `accounts_category_idx` ON `accounts` (`category`);--> statement-breakpoint
CREATE INDEX `accounts_active_idx` ON `accounts` (`is_active`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_company_code_unique` ON `accounts` (`company_id`,`code`);--> statement-breakpoint
CREATE TABLE `journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`entry_number` text NOT NULL,
	`entry_date` integer NOT NULL,
	`description` text NOT NULL,
	`external_reference` text,
	`currency_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`reversed_entry_id` text,
	`reversal_reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`currency_id`) REFERENCES `currencies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reversed_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "journal_entries_company_is_singleton" CHECK("journal_entries"."company_id" = 'primary_company'),
	CONSTRAINT "journal_entries_reversal_reason_matches_reversal" CHECK(("journal_entries"."reversed_entry_id" IS NULL AND "journal_entries"."reversal_reason" IS NULL) OR
          ("journal_entries"."reversed_entry_id" IS NOT NULL AND "journal_entries"."reversal_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `journal_entries_entry_date_idx` ON `journal_entries` (`entry_date`);--> statement-breakpoint
CREATE INDEX `journal_entries_entry_number_idx` ON `journal_entries` (`entry_number`);--> statement-breakpoint
CREATE INDEX `journal_entries_created_by_user_idx` ON `journal_entries` (`created_by_user_id`);--> statement-breakpoint
CREATE INDEX `journal_entries_reversed_entry_idx` ON `journal_entries` (`reversed_entry_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `journal_entries_company_entry_number_unique` ON `journal_entries` (`company_id`,`entry_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `journal_entries_reversed_entry_id_unique` ON `journal_entries` (`reversed_entry_id`);--> statement-breakpoint
CREATE TABLE `journal_entry_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`journal_entry_id` text NOT NULL,
	`account_id` text NOT NULL,
	`debit_minor` integer DEFAULT 0 NOT NULL,
	`credit_minor` integer DEFAULT 0 NOT NULL,
	`description` text,
	`line_order` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "journal_entry_lines_company_is_singleton" CHECK("journal_entry_lines"."company_id" = 'primary_company'),
	CONSTRAINT "journal_entry_lines_debit_non_negative" CHECK("journal_entry_lines"."debit_minor" >= 0),
	CONSTRAINT "journal_entry_lines_credit_non_negative" CHECK("journal_entry_lines"."credit_minor" >= 0),
	CONSTRAINT "journal_entry_lines_exactly_one_side_positive" CHECK(("journal_entry_lines"."debit_minor" > 0 AND "journal_entry_lines"."credit_minor" = 0) OR
          ("journal_entry_lines"."credit_minor" > 0 AND "journal_entry_lines"."debit_minor" = 0)),
	CONSTRAINT "journal_entry_lines_line_order_non_negative" CHECK("journal_entry_lines"."line_order" >= 0)
);
--> statement-breakpoint
CREATE INDEX `journal_entry_lines_entry_line_order_idx` ON `journal_entry_lines` (`journal_entry_id`,`line_order`);--> statement-breakpoint
CREATE INDEX `journal_entry_lines_account_idx` ON `journal_entry_lines` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `journal_entry_lines_entry_line_order_unique` ON `journal_entry_lines` (`journal_entry_id`,`line_order`);