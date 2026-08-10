CREATE TABLE `inventory_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`inventory_item_id` text NOT NULL,
	`supplier_id` text,
	`received_date` integer NOT NULL,
	`quantity_received_scaled` integer NOT NULL,
	`quantity_remaining_scaled` integer NOT NULL,
	`unit_cost_minor` integer NOT NULL,
	`total_cost_minor` integer NOT NULL,
	`cost_remaining_minor` integer NOT NULL,
	`currency_id` text NOT NULL,
	`supplier_lot_number` text,
	`internal_lot_number` text NOT NULL,
	`expiry_date` integer,
	`lifecycle_status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`currency_id`) REFERENCES `currencies`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_lots_company_is_singleton" CHECK("inventory_lots"."company_id" = 'primary_company'),
	CONSTRAINT "inventory_lots_quantity_received_positive" CHECK("inventory_lots"."quantity_received_scaled" > 0),
	CONSTRAINT "inventory_lots_quantity_remaining_non_negative" CHECK("inventory_lots"."quantity_remaining_scaled" >= 0),
	CONSTRAINT "inventory_lots_quantity_remaining_lte_received" CHECK("inventory_lots"."quantity_remaining_scaled" <= "inventory_lots"."quantity_received_scaled"),
	CONSTRAINT "inventory_lots_unit_cost_non_negative" CHECK("inventory_lots"."unit_cost_minor" >= 0),
	CONSTRAINT "inventory_lots_total_cost_non_negative" CHECK("inventory_lots"."total_cost_minor" >= 0),
	CONSTRAINT "inventory_lots_cost_remaining_non_negative" CHECK("inventory_lots"."cost_remaining_minor" >= 0),
	CONSTRAINT "inventory_lots_cost_remaining_lte_total" CHECK("inventory_lots"."cost_remaining_minor" <= "inventory_lots"."total_cost_minor"),
	CONSTRAINT "inventory_lots_lifecycle_status_valid" CHECK("inventory_lots"."lifecycle_status" IN ('active','quarantined','depleted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_lots_company_internal_lot_number_unique` ON `inventory_lots` (`company_id`,`internal_lot_number`);--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`inventory_lot_id` text NOT NULL,
	`movement_type` text NOT NULL,
	`physical_quantity_delta_scaled` integer DEFAULT 0 NOT NULL,
	`reserved_quantity_delta_scaled` integer DEFAULT 0 NOT NULL,
	`cost_delta_minor` integer DEFAULT 0 NOT NULL,
	`reference_type` text NOT NULL,
	`reference_id` text,
	`reversed_movement_id` text,
	`reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inventory_lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reversed_movement_id`) REFERENCES `stock_movements`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stock_movements_company_is_singleton" CHECK("stock_movements"."company_id" = 'primary_company'),
	CONSTRAINT "stock_movements_movement_type_valid" CHECK("stock_movements"."movement_type" IN ('receipt','consumption','adjustment','reservation','release','reversal')),
	CONSTRAINT "stock_movements_reference_type_valid" CHECK("stock_movements"."reference_type" IN ('opening_stock','manual_adjustment','goods_receipt','production','sales','reservation','reversal')),
	CONSTRAINT "stock_movements_nonzero_delta" CHECK("stock_movements"."physical_quantity_delta_scaled" != 0 OR "stock_movements"."reserved_quantity_delta_scaled" != 0)
);
--> statement-breakpoint
CREATE INDEX `stock_movements_lot_history_idx` ON `stock_movements` (`inventory_lot_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `stock_movements_reference_idx` ON `stock_movements` (`reference_type`,`reference_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_reversal_idx` ON `stock_movements` (`reversed_movement_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `stock_movements_reversed_movement_id_unique` ON `stock_movements` (`reversed_movement_id`);