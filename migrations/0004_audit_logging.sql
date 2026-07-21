CREATE TABLE `audit_log_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`entity_label` text NOT NULL,
	`action` text NOT NULL,
	`changed_fields` text,
	`actor_type` text NOT NULL,
	`user_id` text,
	`company_id` text,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "audit_log_entries_action_valid" CHECK("audit_log_entries"."action" IN ('create', 'update', 'deactivate', 'reactivate')),
	CONSTRAINT "audit_log_entries_actor_type_valid" CHECK("audit_log_entries"."actor_type" IN ('user', 'system')),
	CONSTRAINT "audit_log_entries_actor_user_consistency" CHECK(("audit_log_entries"."actor_type" = 'system' AND "audit_log_entries"."user_id" IS NULL) OR ("audit_log_entries"."actor_type" = 'user' AND "audit_log_entries"."user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `audit_log_entries_occurred_at_id_idx` ON `audit_log_entries` (`occurred_at`,`id`);--> statement-breakpoint
CREATE INDEX `audit_log_entries_entity_type_idx` ON `audit_log_entries` (`entity_type`);