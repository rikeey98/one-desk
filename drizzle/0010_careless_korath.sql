ALTER TABLE `run` ADD `issue_id` text;--> statement-breakpoint
CREATE INDEX `run_issue_idx` ON `run` (`issue_id`);