import { sqliteTable, text, integer, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

const nowMs = () => sql`(unixepoch() * 1000)`

export const workspace = sqliteTable('workspace', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  defaultAgentKind: text('default_agent_kind', { enum: ['claude-code', 'opencode'] })
    .notNull().default('claude-code'),
  defaultModelClaude: text('default_model_claude'),
  defaultModelOpencode: text('default_model_opencode'),
  defaultPermission: text('default_permission', { enum: ['read_only', 'edit', 'full'] })
    .notNull().default('edit'),
  claudePath: text('claude_path'),
  opencodePath: text('opencode_path'),
  createdAt: integer('created_at').notNull().default(nowMs()),
  updatedAt: integer('updated_at').notNull().default(nowMs())
})

export const repo = sqliteTable('repo', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  path: text('path').notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull().default(nowMs())
}, (t) => [index('repo_workspace_idx').on(t.workspaceId)])

export const issue = sqliteTable('issue', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  status: text('status', { enum: ['open', 'doing', 'done'] }).notNull().default('open'),
  createdAt: integer('created_at').notNull().default(nowMs()),
  updatedAt: integer('updated_at').notNull().default(nowMs()),
  closedAt: integer('closed_at'),
  // 분류 축 셋. 전부 nullable인 것이 핵심이다 — "아직 안 정해졌다"가 정상 상태다.
  source: text('source', { enum: ['customer', 'plan', 'meeting', 'dev'] }),
  kind: text('kind', { enum: ['bug', 'feature', 'refactor', 'docs', 'research'] }),
  // 순서가 있다. 나열 순서가 곧 급한 순서다.
  priority: text('priority', { enum: ['urgent', 'week', 'someday'] }),
  // 축 셋이 모두 채워지면 저장소가 찍는다. 호출자가 넘기지 않는다 (closedAt과 같은 모양).
  triagedAt: integer('triaged_at'),
  // 사람이 상세를 연 시각. updatedAt과 분리한다 — updatedAt은 agent도 MCP로 올리므로
  // 그것으로 방치를 판정하면 agent가 건드린 이슈일수록 조용해진다.
  seenAt: integer('seen_at')
}, (t) => [
  index('issue_workspace_status_idx').on(t.workspaceId, t.status),
  index('issue_triaged_idx').on(t.workspaceId, t.triagedAt)
])

export const memo = sqliteTable('memo', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  createdAt: integer('created_at').notNull().default(nowMs()),
  updatedAt: integer('updated_at').notNull().default(nowMs())
}, (t) => [index('memo_workspace_idx').on(t.workspaceId)])

export const issueRepo = sqliteTable('issue_repo', {
  issueId: text('issue_id').notNull().references(() => issue.id, { onDelete: 'cascade' }),
  repoId: text('repo_id').notNull().references(() => repo.id, { onDelete: 'cascade' })
}, (t) => [
  primaryKey({ columns: [t.issueId, t.repoId] }),
  index('issue_repo_repo_idx').on(t.repoId)
])

export const memoRepo = sqliteTable('memo_repo', {
  memoId: text('memo_id').notNull().references(() => memo.id, { onDelete: 'cascade' }),
  repoId: text('repo_id').notNull().references(() => repo.id, { onDelete: 'cascade' })
}, (t) => [
  primaryKey({ columns: [t.memoId, t.repoId] }),
  index('memo_repo_repo_idx').on(t.repoId)
])

export const appSetting = sqliteTable('app_setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

export const run = sqliteTable('run', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  agentKind: text('agent_kind', { enum: ['claude-code', 'opencode'] }).notNull(),
  model: text('model'),
  cwd: text('cwd').notNull(),
  permission: text('permission', { enum: ['read_only', 'edit', 'full'] }).notNull(),
  userPrompt: text('user_prompt').notNull(),
  assembledPrompt: text('assembled_prompt').notNull(),
  status: text('status', {
    enum: ['pending', 'running', 'succeeded', 'failed', 'canceled', 'interrupted']
  }).notNull().default('pending'),
  externalSessionId: text('external_session_id'),
  // 자기 참조 외래키를 붙이지 않는다. drizzle에서 타입 순환을 만들고,
  // 원본 run이 지워져도 이어서 실행한 run의 기록은 남아야 한다.
  parentRunId: text('parent_run_id'),
  // 대화의 뿌리. 부모가 없으면 자기 자신이다. **nullable인 것은 의도된 것이다**
  // (설계 §2) — NOT NULL로 만들려면 테이블을 다시 만들어야 하는데, 그 DROP TABLE이
  // run_context_item의 cascade를 건드려 모든 맥락 기록을 지운다. 마이그레이션의
  // PRAGMA foreign_keys=OFF는 트랜잭션 안이라 무시된다. 읽는 쪽이 `?? id`로 푼다.
  rootRunId: text('root_run_id'),
  resultText: text('result_text'),
  needsAnswer: integer('needs_answer', { mode: 'boolean' }).notNull().default(false),
  timeoutMs: integer('timeout_ms'),
  exitCode: integer('exit_code'),
  errorMessage: text('error_message'),
  logPath: text('log_path').notNull(),
  reviewedAt: integer('reviewed_at'),
  reviewedKind: text('reviewed_kind', { enum: ['confirmed', 'archived'] }),
  startedAt: integer('started_at'),
  endedAt: integer('ended_at'),
  createdAt: integer('created_at').notNull().default(nowMs())
}, (t) => [
  index('run_workspace_created_idx').on(t.workspaceId, t.createdAt),
  index('run_status_idx').on(t.status),
  index('run_root_created_idx').on(t.rootRunId, t.createdAt)
])

export const runContextItem = sqliteTable('run_context_item', {
  runId: text('run_id').notNull().references(() => run.id, { onDelete: 'cascade' }),
  itemType: text('item_type', { enum: ['repo', 'issue', 'memo', 'asset'] }).notNull(),
  // itemId가 nullable이고 외래키가 없는 것은 의도된 판단이다 (설계 §5).
  // cascade를 붙이면 이슈를 지웠을 때 그 이슈를 첨부했던 과거 run의 기록이
  // 조용히 사라진다. 무엇이 첨부됐었는지는 itemType과 assembledPrompt에 남는다.
  itemId: text('item_id')
}, (t) => [
  index('run_context_run_idx').on(t.runId)
])

export const asset = sqliteTable('asset', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['skill', 'agent'] }).notNull(),
  source: text('source', { enum: ['discovered', 'authored'] }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  // discovered일 때만 채운다. repo를 지우면 그 repo에서 발견한 것도 함께 사라진다 —
  // 사용자가 repo를 뗀 것은 의도된 행동이고, 다시 등록하면 다시 스캔된다.
  // 과거 run이 무엇을 첨부했는지는 assembledPrompt에 남는다 (설계 §5).
  repoId: text('repo_id').references(() => repo.id, { onDelete: 'cascade' }),
  filePath: text('file_path'),
  /** authored일 때만. discovered의 본문은 실행 시점에 디스크에서 읽는다 (설계 §2-2) */
  content: text('content'),
  /** discovered일 때 마지막으로 파일을 본 시각. 이 값으로 "없음"을 판정한다 */
  lastSeenAt: integer('last_seen_at'),
  createdAt: integer('created_at').notNull().default(nowMs()),
  updatedAt: integer('updated_at').notNull().default(nowMs())
}, (t) => [
  index('asset_workspace_idx').on(t.workspaceId),
  // **동일성 키.** 없으면 스캔할 때마다 같은 파일이 새 행으로 쌓인다 (설계 §3-3).
  // authored 행은 repo_id와 file_path가 둘 다 NULL인데, SQLite는 유니크 인덱스에서
  // NULL을 서로 다른 값으로 취급하므로 authored를 여러 개 만들어도 걸리지 않는다.
  uniqueIndex('asset_discovered_idx').on(t.workspaceId, t.repoId, t.filePath)
])
