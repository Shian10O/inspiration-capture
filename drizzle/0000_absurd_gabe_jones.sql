CREATE TABLE `config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_token_hash_unique` ON `devices` (`token_hash`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`record_key` text NOT NULL,
	`payload_json` text NOT NULL,
	`state` text NOT NULL,
	`page_id` text,
	`error_code` text,
	`retry_at` integer,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_record_key` ON `events` (`record_key`);--> statement-breakpoint
CREATE TABLE `locks` (
	`record_key` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`acquired_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `records` (
	`record_key` text PRIMARY KEY NOT NULL,
	`root_event_id` text NOT NULL,
	`page_id` text,
	`notion_url` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `records_root_event_id_unique` ON `records` (`root_event_id`);