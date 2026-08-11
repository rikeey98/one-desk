import { describe, it, expect, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRunManager } from './manager'
import { claudeCodeAdapter } from './adapters/claudeCode'
import type { RunEvent } from '@shared/events'

const HERE = dirname(fileURLToPath(import.meta.url))
const FAKE = resolve(HERE, 'fixtures/fake-claude.mjs')

function makeManager() {
  const dir = mkdtempSync(resolve(tmpdir(), 'one-desk-run-'))
  const events: RunEvent[] = []
  const manager = createRunManager({
    adapters: { 'claude-code': claudeCodeAdapter, opencode: claudeCodeAdapter },
    logDir: dir,
    onEvent: (e) => events.push(e)
  })
  return { manager, events, dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function spec(scenario: string) {
  return {
    runId: `r-${scenario}`,
    agentKind: 'claude-code' as const,
    cwd: process.cwd(),
    model: null,
    permission: 'edit' as const,
    prompt: '테스트',
    resumeSessionId: null,
    // 가짜 CLI를 실행 파일로 주입한다
    executable: process.execPath,
    extraArgs: [FAKE, '--scenario', scenario]
  }
}

describe('RunManager', () => {
  it('정상 종료하면 result 이벤트와 succeeded 상태를 낸다', async () => {
    const { manager, events, cleanup } = makeManager()
    const outcome = await manager.start(spec('success'))
    expect(outcome.status).toBe('succeeded')
    expect(outcome.resultText).toBe('끝남')
    expect(outcome.externalSessionId).toBe('fake-session')
    expect(events.map((e) => e.type)).toContain('text')
    cleanup()
  })

  it('이벤트에 단조 증가하는 seq를 붙인다', async () => {
    const { manager, events, cleanup } = makeManager()
    await manager.start(spec('success'))
    const seqs = events.map((e) => e.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(new Set(seqs).size).toBe(seqs.length)
    cleanup()
  })

  it('비정상 종료하면 failed 상태를 낸다', async () => {
    const { manager, cleanup } = makeManager()
    const outcome = await manager.start(spec('fail'))
    expect(outcome.status).toBe('failed')
    expect(outcome.exitCode).toBe(1)
    cleanup()
  })

  it('취소하면 canceled 상태로 끝난다', async () => {
    const { manager, cleanup } = makeManager()
    const promise = manager.start(spec('hang'))
    await vi.waitFor(() => expect(manager.isRunning('r-hang')).toBe(true))
    manager.cancel('r-hang')
    const outcome = await promise
    expect(outcome.status).toBe('canceled')
    cleanup()
  })

  it('타임아웃이 지나면 프로세스를 죽인다', async () => {
    const { manager, cleanup } = makeManager()
    const outcome = await manager.start({ ...spec('hang'), timeoutMs: 200 })
    expect(outcome.status).toBe('canceled')
    expect(outcome.errorMessage).toMatch(/시간/)
    cleanup()
  })

  it('같은 run을 두 번 띄우면 두 번째 시작을 거부한다', async () => {
    // 동시 실행 상한은 RunQueue가 본다. manager에 남은 가드는 같은 run을
    // 두 번 띄우지 않는다는 방어선뿐이다 — 서로 다른 run은 동시에 돌 수 있다.
    const { manager, cleanup } = makeManager()
    const first = manager.start(spec('slow'))
    await vi.waitFor(() => expect(manager.isRunning('r-slow')).toBe(true))
    await expect(manager.start(spec('slow'))).rejects.toThrow(/실행 중인 run입니다: r-slow/)
    await first
    cleanup()
  })

  it('끝난 run은 추적에서 지워져 다음 실행을 막지 않는다', async () => {
    const { manager, cleanup } = makeManager()
    await manager.start(spec('success'))
    expect(manager.isRunning('r-success')).toBe(false)
    // 이미 끝난 run을 취소해도 예외가 나지 않는다
    expect(() => manager.cancel('r-success')).not.toThrow()
    const outcome = await manager.start(spec('success'))
    expect(outcome.status).toBe('succeeded')
    cleanup()
  })

  it('로그 파일에 이벤트가 JSONL로 남는다', async () => {
    const { manager, cleanup } = makeManager()
    const outcome = await manager.start(spec('success'))
    const content = readFileSync(outcome.logPath, 'utf8')
    expect(content.trim().split('\n').length).toBeGreaterThan(1)
    expect(JSON.parse(content.trim().split('\n')[0]!)).toHaveProperty('type')
    cleanup()
  })

  it('logPathFor가 실제로 쓰는 경로와 같다', async () => {
    const { manager, cleanup } = makeManager()
    const outcome = await manager.start(spec('success'))
    expect(manager.logPathFor('r-success')).toBe(outcome.logPath)
    cleanup()
  })
})
