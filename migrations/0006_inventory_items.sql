CREATE TABLE `inventory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`item_type` text NOT NULL,
	`unit_of_measure_id` text NOT NULL,
	`minimum_stock` integer DEFAULT 0 NOT NULL,
	`reorder_quantity` integer DEFAULT 0 NOT NULL,
	`maximum_stock` integer,
	`lead_time_days` integer DEFAULT 0 NOT NULL,
	`lot_tracked` integer DEFAULT false NOT NULL,
	`expiry_tracked` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_of_measure_id`) REFERENCES `units_of_measure`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_items_company_is_singleton" CHECK("inventory_items"."company_id" = 'primary_company'),
	CONSTRAINT "inventory_items_item_type_valid" CHECK("inventory_items"."item_type" IN ('ingredient', 'packaging', 'consumable', 'other')),
	CONSTRAINT "inventory_items_minimum_stock_non_negative" CHECK("inventory_items"."minimum_stock" >= 0),
	CONSTRAINT "inventory_items_reorder_quantity_non_negative" CHECK("inventory_items"."reorder_quantity" >= 0),
	CONSTRAINT "inventory_items_lead_time_days_non_negative" CHECK("inventory_items"."lead_time_days" >= 0),
	CONSTRAINT "inventory_items_maximum_stock_non_negative" CHECK("inventory_items"."maximum_stock" IS NULL OR "inventory_items"."maximum_stock" >= 0),
	CONSTRAINT "inventory_items_maximum_stock_gte_minimum_stock" CHECK("inventory_items"."maximum_stock" IS NULL OR "inventory_items"."maximum_stock" >= "inventory_items"."minimum_stock")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_items_company_code_unique` ON `inventory_items` (`company_id`,`code`);