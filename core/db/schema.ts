import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core'
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
  closedAt: integer('closed_at')
}, (t) => [index('issue_workspace_status_idx').on(t.workspaceId, t.status)])

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
  index('run_status_idx').on(t.status)
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
