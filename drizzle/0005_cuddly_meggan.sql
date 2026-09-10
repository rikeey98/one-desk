-- 새 유니크 인덱스는 (workspace_id, file_path)다. 그 전에 중복을 정리한다 —
-- 한 repo가 다른 repo 안에 있으면 같은 파일이 두 repo로 등록됐을 수 있고, 그대로
-- 두면 인덱스 생성이 실패해 **앱이 아예 뜨지 않는다**(마이그레이션은 부팅 경로다).
-- 가장 먼저 발견한 행만 남긴다. 지워진 행을 첨부했던 과거 run의 assembled_prompt는
-- 그대로 남는다.
DELETE FROM `asset` WHERE `file_path` IS NOT NULL AND `id` NOT IN (
  SELECT `id` FROM (
    SELECT `id`, ROW_NUMBER() OVER (
      PARTITION BY `workspace_id`, `file_path` ORDER BY `created_at`, `id`
    ) AS rn
    FROM `asset` WHERE `file_path` IS NOT NULL
  ) WHERE rn = 1
);--> statement-breakpoint
DROP INDEX `asset_discovered_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `asset_discovered_idx` ON `asset` (`workspace_id`,`file_path`);