CREATE TABLE `supplier_item_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`supplier_id` text NOT NULL,
	`inventory_item_id` text NOT NULL,
	`supplier_item_code` text,
	`price_minor` integer NOT NULL,
	`currency_id` text NOT NULL,
	`effective_from` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`currency_id`) REFERENCES `currencies`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "supplier_item_prices_price_non_negative" CHECK("supplier_item_prices"."price_minor" >= 0)
);
--> statement-breakpoint
CREATE INDEX `supplier_item_prices_supplier_idx` ON `supplier_item_prices` (`supplier_id`,`effective_from`);--> statement-breakpoint
CREATE INDEX `supplier_item_prices_item_idx` ON `supplier_item_prices` (`inventory_item_id`,`effective_from`);--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_item_prices_supplier_item_effective_unique` ON `supplier_item_prices` (`supplier_id`,`inventory_item_id`,`effective_from`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`contact_details` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "suppliers_company_is_singleton" CHECK("suppliers"."company_id" = 'primary_company')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suppliers_company_code_unique` ON `suppliers` (`company_id`,`code`);