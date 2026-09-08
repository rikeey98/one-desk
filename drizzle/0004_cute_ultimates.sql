CREATE TABLE `asset` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`repo_id` text,
	`file_path` text,
	`content` text,
	`last_seen_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repo_id`) REFERENCES `repo`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `asset_workspace_idx` ON `asset` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `asset_discovered_idx` ON `asset` (`workspace_id`,`repo_id`,`file_path`);