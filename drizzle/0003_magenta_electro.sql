ALTER TABLE `issue` ADD `source` text;--> statement-breakpoint
ALTER TABLE `issue` ADD `kind` text;--> statement-breakpoint
ALTER TABLE `issue` ADD `priority` text;--> statement-breakpoint
ALTER TABLE `issue` ADD `triaged_at` integer;--> statement-breakpoint
ALTER TABLE `issue` ADD `seen_at` integer;--> statement-breakpoint
CREATE INDEX `issue_triaged_idx` ON `issue` (`workspace_id`,`triaged_at`);
--> statement-breakpoint
-- 이미 쓰고 있던 이슈를 훑기 대기열로 쏟아붓지 않는다. 축은 비어 있는 채로
-- triaged_at만 채운다 — 설계 §3이 인정한 유일한 예외이고, 그 이슈의 축을
-- 처음 건드리는 순간 파생 규칙이 적용돼 예외가 스스로 사라진다.
UPDATE `issue` SET `triaged_at` = `created_at` WHERE `triaged_at` IS NULL;