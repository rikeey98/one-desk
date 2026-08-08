CREATE TABLE `run` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`agent_kind` text NOT NULL,
	`model` text,
	`cwd` text NOT NULL,
	`permission` text NOT NULL,
	`user_prompt` text NOT NULL,
	`assembled_prompt` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`external_session_id` text,
	`parent_run_id` text,
	`result_text` text,
	`needs_answer` integer DEFAULT false NOT NULL,
	`timeout_ms` integer,
	`exit_code` integer,
	`error_message` text,
	`log_path` text NOT NULL,
	`reviewed_at` integer,
	`reviewed_kind` text,
	`started_at` integer,
	`ended_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `run_workspace_created_idx` ON `run` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `run_status_idx` ON `run` (`status`);--> statement-breakpoint
CREATE TABLE `run_context_item` (
	`run_id` text NOT NULL,
	`item_type` text NOT NULL,
	`item_id` text,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `run_context_run_idx` ON `run_context_item` (`run_id`);