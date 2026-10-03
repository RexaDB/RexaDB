CREATE TABLE `kv_store` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `kv_store_permissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kv_id` text NOT NULL,
	`action` text NOT NULL,
	`grantee_type` text NOT NULL,
	`grantee_id` text,
	`granted_by` text NOT NULL,
	`granted_at` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`kv_id`) REFERENCES `kv_store`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kv_store_permissions_kv_id_action_grantee_type_grantee_id_unique` ON `kv_store_permissions` (`kv_id`,`action`,`grantee_type`,`grantee_id`);