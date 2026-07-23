CREATE TABLE `product_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`selling_price_minor` integer NOT NULL,
	`currency_id` text NOT NULL,
	`tax_code_id` text,
	`barcode` text,
	`minimum_finished_stock_level` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`currency_id`) REFERENCES `currencies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_code_id`) REFERENCES `tax_codes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "product_variants_selling_price_non_negative" CHECK("product_variants"."selling_price_minor" >= 0),
	CONSTRAINT "product_variants_min_stock_non_negative" CHECK("product_variants"."minimum_finished_stock_level" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_barcode_unique` ON `product_variants` (`barcode`) WHERE "product_variants"."barcode" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_product_code_unique` ON `product_variants` (`product_id`,`code`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "products_company_is_singleton" CHECK("products"."company_id" = 'primary_company'),
	CONSTRAINT "products_type_valid" CHECK("products"."type" IN ('manufactured', 'service'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_company_code_unique` ON `products` (`company_id`,`code`);