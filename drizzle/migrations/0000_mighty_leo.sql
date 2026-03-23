CREATE TABLE `seen_links` (
	`url` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`first_seen` integer NOT NULL,
	`last_checked` integer,
	`content_hash` text,
	`source` text
);
--> statement-breakpoint
CREATE TABLE `social_search_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`keywords` text NOT NULL,
	`brands` text,
	`region` text DEFAULT 'all',
	`enabled` integer DEFAULT 1,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `social_source_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`platform` text NOT NULL,
	`platform_account_id` text,
	`account_handle` text,
	`enabled` integer DEFAULT 1,
	`last_cursor` text,
	`last_fetched_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
