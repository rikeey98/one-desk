CREATE TABLE `proposal` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`root_run_id` text NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`decided_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`root_run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `proposal_workspace_status_idx` ON `proposal` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `proposal_root_idx` ON `proposal` (`root_run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `proposal_pending_issue_idx` ON `proposal` (`root_run_id`) WHERE status = 'pending' AND kind = 'conversation-issue';