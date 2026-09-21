ALTER TABLE `run` ADD `actual_model` text;--> statement-breakpoint
ALTER TABLE `run` ADD `input_tokens` integer;--> statement-breakpoint
ALTER TABLE `run` ADD `output_tokens` integer;--> statement-breakpoint
ALTER TABLE `run` ADD `cache_read_tokens` integer;--> statement-breakpoint
ALTER TABLE `run` ADD `cache_write_tokens` integer;--> statement-breakpoint
ALTER TABLE `run` ADD `reasoning_tokens` integer;--> statement-breakpoint
ALTER TABLE `run` ADD `cost_usd` real;--> statement-breakpoint
ALTER TABLE `run` ADD `context_tokens` integer;--> statement-breakpoint
ALTER TABLE `run` ADD `context_window` integer;