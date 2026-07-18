CREATE TABLE `login_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`occurred_at` integer NOT NULL,
	`success` integer NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "login_events_source_valid" CHECK("login_events"."source" IN ('normal_login', 'session_unlock', 'owner_recovery'))
);
--> statement-breakpoint
CREATE TABLE `owner_recovery_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`recovery_key_hash` text NOT NULL,
	`version` integer NOT NULL,
	`is_active` integer NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "owner_recovery_credentials_version_positive" CHECK("owner_recovery_credentials"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owner_recovery_credentials_one_active_per_user` ON `owner_recovery_credentials` (`user_id`) WHERE "owner_recovery_credentials"."is_active" = 1;--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_system` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_code_unique` ON `roles` (`code`);--> statement-breakpoint
CREATE TABLE `user_roles` (
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `role_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`login_identifier` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_changed_at` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`failed_login_count` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "users_company_is_singleton" CHECK("users"."company_id" = 'primary_company'),
	CONSTRAINT "users_failed_login_count_non_negative" CHECK("users"."failed_login_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_company_login_identifier_unique` ON `users` (`company_id`,`login_identifier`);