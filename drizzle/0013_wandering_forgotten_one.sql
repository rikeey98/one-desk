CREATE TABLE `schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`repo_id` text,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`disabled_reason` text,
	`trigger` text NOT NULL,
	`time_zone` text NOT NULL,
	`conversation_mode` text NOT NULL,
	`conversation_id` text,
	`agent_kind` text NOT NULL,
	`model` text,
	`effort` text,
	`permission` text NOT NULL,
	`prompt` text NOT NULL,
	`context` text DEFAULT '[]' NOT NULL,
	`anchor_at` integer NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repo_id`) REFERENCES `repo`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `schedule_workspace_idx` ON `schedule` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `schedule_fire` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`cause` text NOT NULL,
	`slot_at` integer,
	`fired_at` integer NOT NULL,
	`outcome` text NOT NULL,
	`skip_reason` text,
	`message` text,
	`run_id` text,
	`dropped_context` integer DEFAULT 0 NOT NULL,
	`judged_at` integer,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedule`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `schedule_fire_schedule_idx` ON `schedule_fire` (`schedule_id`,`fired_at`);--> statement-breakpoint
CREATE INDEX `schedule_fire_run_idx` ON `schedule_fire` (`run_id`);