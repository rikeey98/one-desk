ALTER TABLE `run` ADD `root_run_id` text;--> statement-breakpoint
WITH RECURSIVE chain(id, root) AS (
  SELECT `id`, `id` FROM `run`
    WHERE `parent_run_id` IS NULL OR `parent_run_id` NOT IN (SELECT `id` FROM `run`)
  UNION ALL
  SELECT r.`id`, c.root FROM `run` r JOIN chain c ON r.`parent_run_id` = c.id
)
UPDATE `run` SET `root_run_id` = (SELECT root FROM chain WHERE chain.id = `run`.`id`);--> statement-breakpoint
UPDATE `run` SET `root_run_id` = `id` WHERE `root_run_id` IS NULL;--> statement-breakpoint
CREATE INDEX `run_root_created_idx` ON `run` (`root_run_id`,`created_at`);
