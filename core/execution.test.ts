import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { makeTestDb } from './db/repositories/testing'
import { createWorkspaceRepository } from './db/repositories/workspace'
import { createRepoRepository } from './db/repositories/repo'
import { createIssueRepository } from './db/repositories/issue'
import { createRunRepository } from './db/repositories/run'
import { createRunManager } from './runner/manager'
import { claudeCodeAdapter } from './runner/adapters/claudeCode'
import { createExecutionService } from './execution'
import type { Run } from '@shared/models'
import type { PreflightResult } from './runner/types'

const HERE = dirname(fileURLToPath(import.meta.url))
const FAKE = resolve(HERE, 'runner/fixtures/fake-claude.mjs')

function setup(preflight?: () => Promise<PreflightResult>) {
  const db = makeTestDb()
  const logDir = mkdtempSync(resolve(tmpdir(), 'one-desk-exec-'))
  const workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
  const repoId = createRepoRepository(db).create({ workspaceId, name: 'api', path: process.cwd() }).id
  const issueId = createIssueRepository(db).create({ workspaceId, title: '토큰 버그', body: '설명' }).id
  const runs = createRunRepository(db)
  const updates: Run[] = []
  const manager = createRunManager({
    adapters: { 'claude-code': claudeCodeAdapter, opencode: claudeCodeAdapter },
    logDir,
    onEvent: () => {}
  })
  const service = createExecutionService({
    db, runs, manager,
    resolveExecutable: preflight ?? (async () => ({ ok: true, executable: process.execPath })),
    onRunUpdate: (run) => updates.push(run),
    extraArgs: [FAKE, '--scenario', 'success']
  })
  return { db, service, runs, updates, workspaceId, repoId, issueId, logDir }
}

describe('ExecutionService', () => {
  let ctx: ReturnType<typeof setup>

  beforeEach(() => { ctx = setup() })
  afterEach(() => { rmSync(ctx.logDir, { recursive: true, force: true }) })

  function startBase() {
    return ctx.service.start({
      workspaceId: ctx.workspaceId,
      agentKind: 'claude-code' as const,
      cwd: process.cwd(),
      permission: 'edit' as const,
      userPrompt: '고쳐줘',
      context: [{ type: 'issue' as const, id: ctx.issueId }]
    })
  }

  it('맥락을 조립해 assembledPrompt에 담고 run을 저장한다', async () => {
    const run = await startBase()
    expect(run.assembledPrompt).toContain('토큰 버그')
    expect(run.assembledPrompt).toContain('고쳐줘')

    const done = await vi.waitFor(() => {
      const r = ctx.runs.get(run.id)
      expect(r.status).toBe('succeeded')
      return r
    })
    expect(done.externalSessionId).toBe('fake-session')
    expect(done.resultText).toBe('끝남')
  })

  it('완료를 기다리지 않고 running 상태로 즉시 돌아온다', async () => {
    const run = await startBase()
    // 종료까지 await하면 IPC가 몇 분씩 막히고, 렌더러는 그동안 run의 id조차 모른다.
    expect(run.status).toBe('running')
    expect(run.startedAt).toBeTypeOf('number')
    expect(run.endedAt).toBeNull()
    await vi.waitFor(() => expect(ctx.runs.get(run.id).status).toBe('succeeded'))
  })

  it('완료되면 onRunUpdate로 최종 run을 알린다', async () => {
    const run = await startBase()
    await vi.waitFor(() => {
      expect(ctx.updates.some((r) => r.id === run.id && r.status === 'succeeded')).toBe(true)
    })
  })

  it('DB에 기록한 logPath에 실제 로그 파일이 있다', async () => {
    const run = await startBase()
    await vi.waitFor(() => expect(ctx.runs.get(run.id).status).toBe('succeeded'))
    expect(existsSync(run.logPath)).toBe(true)
  })

  it('preflight가 실패하면 프로세스를 띄우지 않고 failed로 기록한다', async () => {
    const local = setup(async () => ({ ok: false, reason: 'claude를 찾을 수 없습니다' }))
    const run = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: 'x', context: []
    })
    expect(run.status).toBe('failed')
    expect(run.errorMessage).toContain('claude를 찾을 수 없습니다')
    expect(run.startedAt).toBeNull()
    rmSync(local.logDir, { recursive: true, force: true })
  })

  it('맥락에 없는 이슈 id를 넘기면 거부한다', async () => {
    await expect(ctx.service.start({
      workspaceId: ctx.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: 'x',
      context: [{ type: 'issue', id: '없는-id' }]
    })).rejects.toThrow()
  })

  it('이미 실행 중일 때 시작하면 run이 running으로 방치되지 않고 failed로 끝난다', async () => {
    const first = await startBase()
    const second = await startBase()
    await vi.waitFor(() => expect(ctx.runs.get(second.id).status).toBe('failed'))
    expect(ctx.runs.get(second.id).errorMessage).toMatch(/실행 중/)
    await vi.waitFor(() => expect(ctx.runs.get(first.id).status).toBe('succeeded'))
  })
})
