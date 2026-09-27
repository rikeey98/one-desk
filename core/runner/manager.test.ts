import { describe, it, expect, vi, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRunManager, judgeStatus, mergeUsage, type RunManagerOptions } from './manager'
import { claudeCodeAdapter } from './adapters/claudeCode'
import { opencodeAdapter } from './adapters/opencode'
import { consoleErrorSink } from '../errors'
import type { RunEvent, RunEventInit, RunUsage } from '@shared/events'
import { emptyUsage } from './adapters/common'

const HERE = dirname(fileURLToPath(import.meta.url))
const FAKE = resolve(HERE, 'fixtures/fake-claude.mjs')

/** close가 **끝난** 원본 로그의 경로. 아래 껍데기가 적는다 */
const closedRawLogs = vi.hoisted(() => [] as string[])

/**
 * 원본 writer를 그대로 통과시키는 껍데기 — close가 끝난 순간만 적는다("돌려준 순간 원본
 * 로그는 닫혀 있다"). 파일로는 이것을 못 본다: libuv는 파일을 FILE_SHARE_DELETE로 열어
 * Windows에서도 열린 스트림째로 디렉토리가 지워지고, 쓴 줄은 닫지 않아도 곧 디스크에 간다.
 */
vi.mock('./logWriter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./logWriter')>()
  return {
    ...actual,
    createRawLogWriter: (...args: Parameters<typeof actual.createRawLogWriter>) => {
      const writer = actual.createRawLogWriter(...args)
      return {
        write: (line: string) => writer.write(line),
        close: async () => {
          await writer.close()
          closedRawLogs.push(args[0])
        }
      }
    }
  }
})

function makeManager(extra: Partial<Pick<RunManagerOptions, 'onError' | 'rawLogMaxBytes'>> = {}) {
  const dir = mkdtempSync(resolve(tmpdir(), 'one-desk-run-'))
  const events: RunEvent[] = []
  const manager = createRunManager({
    adapters: { 'claude-code': claudeCodeAdapter, opencode: opencodeAdapter },
    logDir: dir,
    onEvent: (e) => events.push(e),
    onError: consoleErrorSink,
    ...extra
  })
  return { manager, events, dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function spec(scenario: string) {
  return {
    runId: `r-${scenario}`,
    agentKind: 'claude-code' as const,
    cwd: process.cwd(),
    model: null,
    effort: null,
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

  it('타임아웃이 지나면 프로세스를 죽이고 failed로 끝낸다', async () => {
    // 사용자가 누른 취소가 아니다 (`docs/sdlc/conversation-fixes/` spec FR-10).
    // canceled로 끝내면 인박스에서 "대기 중 취소됨"과 섞이고 배지에서도 빠진다.
    const { manager, cleanup } = makeManager()
    const outcome = await manager.start({ ...spec('hang'), timeoutMs: 200 })
    expect(outcome.status).toBe('failed')
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

  it('서로 다른 run 두 개는 동시에 돈다', async () => {
    // 이 브랜치의 간판 기능이다. 같은 runId를 두 번 넘기는 위 테스트로는 가드가
    // active.has(runId)든 active.size > 0이든 똑같이 통과해서, "앱 전체에 하나"로
    // 되돌아가는 회귀를 잡지 못한다. 서로 다른 두 run이 같은 순간에 살아 있는지를
    // 봐야 한다 — 회귀하면 두 번째부터 '이미 실행 중인 run입니다'로 거부된다.
    const { manager, cleanup } = makeManager()
    const first = manager.start({ ...spec('slow'), runId: 'r-slow-a' })
    const second = manager.start({ ...spec('slow'), runId: 'r-slow-b' })
    // 거부되면 아래 waitFor가 끝나기 전에 unhandled rejection으로 새 나간다.
    // 먼저 붙잡아 두면 실패가 "둘 다 안 돈다"라는 단언으로 드러난다.
    const settled = Promise.allSettled([first, second])

    await vi.waitFor(() => {
      // 같은 동기 시점에 둘 다 true여야 한다 — 번갈아 도는 것으로는 통과하지 않는다.
      expect(manager.isRunning('r-slow-a')).toBe(true)
      expect(manager.isRunning('r-slow-b')).toBe(true)
    })

    const outcomes = await settled
    expect(outcomes.map((o) => o.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(manager.logPathFor('r-slow-a')).not.toBe(manager.logPathFor('r-slow-b'))
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

  it('로그 파일을 열지 못해도 run은 끝나고, 오류는 onError로 나간다', async () => {
    // 로그 스트림의 open은 비동기다. 리스너가 없으면 처리되지 않은 예외가 되어
    // Electron 메인 프로세스가 죽는다. 여기서는 그 실패가 (1) run을 죽이지
    // 않고 (2) onError로 나가는 것을 본다 — manager가 logWriter에 sink를
    // 건네는 한 줄이 이 단언에 걸려 있다.
    const dir = mkdtempSync(resolve(tmpdir(), 'one-desk-run-'))
    const errors: string[] = []
    const manager = createRunManager({
      adapters: { 'claude-code': claudeCodeAdapter, opencode: claudeCodeAdapter },
      logDir: dir,
      onEvent: () => {},
      onError: (message) => errors.push(message)
    })
    // 로그 파일이 놓일 자리에 같은 이름의 디렉토리를 미리 만들어 둔다.
    mkdirSync(manager.logPathFor('r-success'), { recursive: true })

    const outcome = await manager.start(spec('success'))

    expect(outcome.status).toBe('succeeded')
    expect(errors.some((m) => m.includes('run 로그를 쓸 수 없습니다'))).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

/**
 * 세션 id를 **받는 즉시** 알린다 (`docs/sdlc/conversation-fixes/` spec FR-16).
 *
 * 예전에는 세션 id가 manager의 지역 변수와 로그에만 있다가 종료 때에야 DB에 들어갔다.
 * 첫 턴이 도는 중 앱이 꺼지면 행은 interrupted가 되는데 세션 id가 없어, 그 대화를
 * 이으면 "이어받을 세션이 없습니다"로 실패했다.
 */
describe('RunManager — 세션 알림', () => {
  it('session 이벤트가 오면 프로세스가 끝나기 전에 onSession을 부른다', async () => {
    const { manager, cleanup } = makeManager()
    const onSession = vi.fn()
    // hang은 init(세션 id)만 내고 끝나지 않는다 — "도는 중"에 불렸음을 본다.
    const promise = manager.start({ ...spec('hang'), onSession })
    try {
      await vi.waitFor(() => expect(onSession).toHaveBeenCalledWith('r-hang', 'fake-session'))
      expect(manager.isRunning('r-hang')).toBe(true)
    } finally {
      manager.cancel('r-hang')
      await promise
      cleanup()
    }
  })

  it('같은 세션 id를 거듭 받아도 한 번만 부른다', async () => {
    // claude는 init과 result 둘 다에 session_id를 싣는다 — 매번 부르면 DB 쓰기가 는다.
    const { manager, cleanup } = makeManager()
    const onSession = vi.fn()
    await manager.start({ ...spec('success'), onSession })
    expect(onSession).toHaveBeenCalledTimes(1)
    expect(onSession).toHaveBeenCalledWith('r-success', 'fake-session')
    cleanup()
  })

  it('빈 세션 id(init에 session_id가 없다)는 알리지 않고, 뒤에 온 진짜 id를 알린다', async () => {
    // claude 어댑터는 init에 session_id가 없으면 ''를 싣는다. 알리면 저장이 "먼저 쓴 값이
    // 이긴다"라 진짜 id가 막히고, 도는 중 앱이 꺼지면 ''가 남아 대화를 잇지 못한다.
    const dir = mkdtempSync(resolve(tmpdir(), 'one-desk-session-'))
    const path = resolve(dir, 'fake-cli.mjs')
    const lines = [
      { type: 'system', subtype: 'init' },
      { type: 'result', subtype: 'success', is_error: false, result: '끝', session_id: 'sess-real' }
    ]
    writeFileSync(path, [
      'process.stdin.resume()',
      "process.stdin.on('end', () => {",
      ...lines.map((l) => `  process.stdout.write(${JSON.stringify(JSON.stringify(l) + '\n')})`),
      '})'
    ].join('\n'))
    const { manager, cleanup } = makeManager()
    const onSession = vi.fn()
    try {
      const outcome = await manager.start({ ...spec('empty-session'), extraArgs: [path], onSession })
      expect(onSession.mock.calls).toEqual([['r-empty-session', 'sess-real']])
      expect(outcome.externalSessionId).toBe('sess-real')
    } finally {
      cleanup()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('onSession이 던져도 run은 끝까지 가고 오류는 onError로 나간다', async () => {
    // 스트림의 data 핸들러 안에서 불린다 — 새면 처리되지 않은 예외가 되어 메인
    // 프로세스가 통째로 내려간다. 저장 실패는 이어가기를 못 할 뿐 실행의 문제가 아니다.
    const dir = mkdtempSync(resolve(tmpdir(), 'one-desk-run-'))
    const errors: string[] = []
    const manager = createRunManager({
      adapters: { 'claude-code': claudeCodeAdapter, opencode: opencodeAdapter },
      logDir: dir,
      onEvent: () => {},
      onError: (message) => errors.push(message)
    })
    try {
      const outcome = await manager.start({
        ...spec('success'),
        onSession: () => { throw new Error('database is locked') }
      })
      expect(outcome.status).toBe('succeeded')
      expect(outcome.externalSessionId).toBe('fake-session')
      expect(errors.some((m) => m.includes('세션 id'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/** pid가 살아 있는가. 신호 0은 존재만 본다(Windows에서도 된다) */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * 앱 종료 경로의 트리 종료 (`docs/sdlc/conversation-fixes/` spec FR-18).
 *
 * will-quit의 `core.shutdown()` → `cancelAll()`은 동기로 돌아오고 곧바로 메인 프로세스가
 * 끝난다. 비동기 taskkill은 그 순간 libuv의 job과 함께 죽어 손자가 남는다(실측). 그래서
 * **돌아온 순간 이미 죽어 있어야 한다** — 기다려서 확인하면 비동기판도 통과한다.
 */
describe.runIf(process.platform === 'win32')('RunManager.cancelAll — 실제 Windows 프로세스 트리', () => {
  let grandchild: number | null = null

  afterEach(() => {
    if (grandchild !== null && alive(grandchild)) process.kill(grandchild)
    grandchild = null
  })

  it('돌아오기 전에 agent가 띄운 손자까지 죽인다 — 앱이 곧바로 끝나도 남지 않는다', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'one-desk-shutdown-'))
    const pidFile = resolve(dir, 'grandchild.pid')
    const script = resolve(dir, 'fake-cli.mjs')
    // 손자는 detached다 — libuv가 띄운 non-detached 손자는 job 때문에 직계와 함께 죽어
    // 옛 코드로도 초록이 된다(terminate.test.ts와 같은 이유). Bash 도구의 손자가 이 모양이다.
    writeFileSync(script, [
      "import { spawn } from 'node:child_process'",
      "import { writeFileSync } from 'node:fs'",
      "const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: true, windowsHide: true })",
      `writeFileSync(${JSON.stringify(pidFile)}, String(g.pid))`,
      'setInterval(() => {}, 1000)'
    ].join('\n'))
    const { manager, cleanup } = makeManager()
    const run = manager.start({ ...spec('shutdown'), extraArgs: [script] })
    try {
      await vi.waitFor(() => {
        const pid = Number(readFileSync(pidFile, 'utf8'))
        expect(pid).toBeGreaterThan(0)
        grandchild = pid
      }, { timeout: 10_000 })
      expect(alive(grandchild!)).toBe(true)

      manager.cancelAll()

      expect(alive(grandchild!)).toBe(false)
      expect((await run).status).toBe('canceled')
    } finally {
      cleanup()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('RunManager — 실행 런처', () => {
  /**
   * **배선 잠금.** manager가 `agentCommand`를 거치지 않으면 이 run은 어느 OS에서도
   * 뜨지 않는다 — 실행 권한 없는 `.mjs`라 직접 spawn하면 POSIX는 EACCES,
   * Windows는 EFTYPE이다. 셔뱅도 일부러 달지 않았다.
   */
  it('ONE_DESK_AGENT_LAUNCHER가 있으면 그것으로 실행 파일을 띄운다', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'one-desk-launcher-'))
    const script = resolve(dir, 'not-executable.mjs')
    const line = JSON.stringify({
      type: 'result', subtype: 'success', is_error: false,
      result: '런처로 떴다', session_id: 'launcher-session'
    })
    writeFileSync(script, `process.stdout.write(${JSON.stringify(line + '\n')})\n`, { mode: 0o644 })

    const previous = process.env['ONE_DESK_AGENT_LAUNCHER']
    process.env['ONE_DESK_AGENT_LAUNCHER'] = process.execPath
    const { manager, cleanup } = makeManager()
    try {
      const outcome = await manager.start({ ...spec('launcher'), executable: script, extraArgs: [] })
      expect(outcome.status).toBe('succeeded')
      expect(outcome.resultText).toBe('런처로 떴다')
    } finally {
      if (previous === undefined) delete process.env['ONE_DESK_AGENT_LAUNCHER']
      else process.env['ONE_DESK_AGENT_LAUNCHER'] = previous
      cleanup()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/**
 * 판정 순서 (`docs/sdlc/conversation-fixes/` spec FR-12). 순수 함수로 표를 고정한다 —
 * 신호로 죽은 프로세스(종료 코드 null)는 OS마다 만드는 법이 달라 spawn으로는
 * 한 플랫폼에서만 검증된다.
 */
describe('judgeStatus', () => {
  const base = { canceled: false, timedOut: false, exitCode: 0, reportedStatus: null } as const

  it('어댑터가 succeeded를 보고해도 종료 코드가 0이 아니면 failed다', () => {
    // opencode는 text 줄마다 succeeded를 합성한다(설계 §7). 보고를 먼저 보면
    // 중간 텍스트를 낸 뒤 exit 1로 죽은 run이 성공이 된다.
    expect(judgeStatus({ ...base, exitCode: 1, reportedStatus: 'succeeded' })).toBe('failed')
  })

  it('신호로 죽어 종료 코드가 null이면 succeeded 보고가 있어도 failed다', () => {
    expect(judgeStatus({ ...base, exitCode: null, reportedStatus: 'succeeded' })).toBe('failed')
  })

  it('정상 종료면 어댑터의 보고가 이긴다 — claude의 is_error는 exit 0이어도 실패다', () => {
    expect(judgeStatus({ ...base, reportedStatus: 'failed' })).toBe('failed')
    expect(judgeStatus({ ...base, reportedStatus: 'succeeded' })).toBe('succeeded')
  })

  it('정상 종료에 보고가 없으면 succeeded다', () => {
    expect(judgeStatus(base)).toBe('succeeded')
  })

  it('취소가 타임아웃보다, 타임아웃이 종료 코드보다 먼저다', () => {
    expect(judgeStatus({ ...base, canceled: true, timedOut: true, exitCode: null })).toBe('canceled')
    expect(judgeStatus({ ...base, timedOut: true, reportedStatus: 'succeeded' })).toBe('failed')
  })
})

interface FakeScript {
  /** 한 줄씩 JSON으로 적는다 */
  lines?: unknown[]
  /** lines 뒤에 **그대로** 적는다 — 깨진 줄·CRLF처럼 JSON 한 줄로는 못 적는 출력 */
  stdout?: string
  stderr?: string
  exitCode: number
}

/**
 * 그 자리에서 만든 한 번짜리 가짜 CLI로 manager를 돌린다. `node <스크립트>`로 띄우므로
 * **Windows에서도 실제로 돈다** — `ONE_DESK_AGENT_PATH`만 세운 run은 Windows에서 spawn조차
 * 안 된다(CLAUDE.md).
 */
function withScript(script: FakeScript, managerOptions: Parameters<typeof makeManager>[0] = {}) {
  const dir = mkdtempSync(resolve(tmpdir(), 'one-desk-judge-'))
  const path = resolve(dir, 'fake-cli.mjs')
  // stdin을 끝까지 읽고 나서 쓴다. process.exit()은 파이프 버퍼를 버리므로
  // exitCode만 정하고 자연 종료시킨다 (fake-claude.mjs와 같은 이유).
  writeFileSync(path, [
    'process.stdin.resume()',
    "process.stdin.on('end', () => {",
    ...(script.lines ?? []).map((l) => `  process.stdout.write(${JSON.stringify(JSON.stringify(l) + '\n')})`),
    script.stdout ? `  process.stdout.write(${JSON.stringify(script.stdout)})` : '',
    script.stderr ? `  process.stderr.write(${JSON.stringify(script.stderr)})` : '',
    `  process.exitCode = ${script.exitCode}`,
    '})'
  ].join('\n'))
  const made = makeManager(managerOptions)
  return {
    ...made,
    run: (agentKind: 'claude-code' | 'opencode', extra: { preEvents?: RunEventInit[] } = {}) =>
      made.manager.start({
        ...spec('judge'), agentKind, extraArgs: [path],
        ...(extra.preEvents ? { preEvents: extra.preEvents } : {})
      }),
    cleanup: () => {
      made.cleanup()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

/**
 * 판정과 실패 이유를 실제 spawn으로 본다 (spec FR-12·FR-13).
 */
describe('RunManager — 판정과 실패 이유', () => {
  const ocText = (text: string) => ({ type: 'text', sessionID: 'ses_x', part: { type: 'text', text } })
  const ocError = (message: string) => ({
    type: 'error', sessionID: 'ses_x',
    error: { name: 'APIError', data: { message } }
  })

  it('opencode가 텍스트를 낸 뒤 exit 1로 끝나면 failed다', async () => {
    const t = withScript({ lines: [ocText('중간까지 했습니다')], exitCode: 1 })
    try {
      const outcome = await t.run('opencode')
      expect(outcome.status).toBe('failed')
      // 결과 텍스트는 버리지 않는다 — 어디까지 했는지는 여전히 쓸모 있다.
      expect(outcome.resultText).toBe('중간까지 했습니다')
    } finally { t.cleanup() }
  })

  it('claude가 성공 result를 낸 뒤 비정상 종료해도 failed다', async () => {
    // spec §5의 우려 — 지금까지 succeeded였던 이 경우가 failed가 된다. 그 편이 맞다.
    const t = withScript({
      lines: [{ type: 'result', subtype: 'success', is_error: false, result: '끝남', session_id: 's' }],
      exitCode: 3
    })
    try {
      expect((await t.run('claude-code')).status).toBe('failed')
    } finally { t.cleanup() }
  })

  it('실패하면 errorMessage는 마지막 error 이벤트의 메시지다 — stderr보다 먼저다', async () => {
    // json 모드의 opencode는 오류를 stderr가 아니라 stdout의 error 줄로 낸다.
    const t = withScript({
      lines: [ocError('첫 오류'), ocText('중간'), ocError('Error from provider: 403')],
      stderr: 'stderr에 남은 것',
      exitCode: 1
    })
    try {
      const outcome = await t.run('opencode')
      expect(outcome.status).toBe('failed')
      expect(outcome.errorMessage).toBe('Error from provider: 403')
    } finally { t.cleanup() }
  })

  it('claude의 MCP 연결 경고는 실패 이유가 되지 않는다 — 진짜 원인(stderr)을 가리면 안 된다', async () => {
    // claude 어댑터의 error 이벤트는 init의 mcp_servers가 connected가 아닐 때의 경고
    // 하나뿐이다 — run을 실패시키지 않는다(claudeCode.ts). 사내 프록시 환경에서는 이
    // 경고가 늘 붙으므로, 이것이 실패 이유 자리를 차지하면 SSO 만료·Bedrock 403 같은
    // 다른 이유로 실패한 run이 전부 "MCP에 연결하지 못했습니다"로 기록된다.
    const t = withScript({
      lines: [
        {
          type: 'system', subtype: 'init', session_id: 's',
          mcp_servers: [{ name: 'onedesk', status: 'failed' }]
        },
        { type: 'result', subtype: 'success', is_error: true, result: 'API Error: 403', session_id: 's' }
      ],
      stderr: 'Bedrock 게이트웨이가 403을 돌려줬다',
      exitCode: 1
    })
    try {
      const outcome = await t.run('claude-code')
      expect(outcome.status).toBe('failed')
      expect(outcome.errorMessage).toBe('Bedrock 게이트웨이가 403을 돌려줬다')
      // 경고 자체는 여전히 화면(이벤트)에 남는다.
      expect(t.events.some((e) => e.type === 'error' && e.message.includes('onedesk'))).toBe(true)
    } finally { t.cleanup() }
  })

  it('error 이벤트가 없으면 errorMessage는 stderr 앞 2000자다', async () => {
    const t = withScript({ lines: [], stderr: 'x'.repeat(2500), exitCode: 1 })
    try {
      const outcome = await t.run('opencode')
      expect(outcome.errorMessage).toBe('x'.repeat(2000))
    } finally { t.cleanup() }
  })

  it('성공이면 error 이벤트가 있어도 errorMessage를 채우지 않는다', async () => {
    // claude의 MCP 연결 실패처럼 run을 실패시키지 않는 경고가 error로 온다.
    const t = withScript({ lines: [ocError('경고일 뿐'), ocText('다 했습니다')], exitCode: 0 })
    try {
      const outcome = await t.run('opencode')
      expect(outcome.status).toBe('succeeded')
      expect(outcome.errorMessage).toBeNull()
    } finally { t.cleanup() }
  })

  it('spawn조차 못 하면 그 오류가 실패 이유다', async () => {
    // stderr가 비어 있어 예전에는 errorMessage가 null인 "이유 없는 실패"였다.
    const { manager, cleanup } = makeManager()
    try {
      const outcome = await manager.start({
        ...spec('no-such'), executable: resolve(tmpdir(), 'one-desk-no-such-cli'), extraArgs: []
      })
      expect(outcome.status).toBe('failed')
      expect(outcome.errorMessage).toMatch(/ENOENT/)
    } finally { cleanup() }
  })

  it('실행 전에 흘린 error(preEvents)는 실패 이유가 되지 않는다', async () => {
    // 맥락 파일을 못 읽었다는 알림은 run을 실패시키지 않는 경고다 (core/execution.ts).
    // 이것이 실패 이유 자리를 차지하면 진짜 원인(stderr)이 가려진다.
    const t = withScript({ lines: [], stderr: '진짜 원인', exitCode: 1 })
    try {
      const outcome = await t.run('opencode', {
        preEvents: [{ type: 'error', runId: 'r-judge', at: 0, message: '맥락 파일을 읽을 수 없어 빠졌습니다' }]
      })
      expect(outcome.errorMessage).toBe('진짜 원인')
    } finally { t.cleanup() }
  })
})

/**
 * 원본 줄 로그 `raw.jsonl` (`docs/sdlc/conversation-events/` spec FR-1~5, §7-A).
 *
 * 정규화 로그는 어댑터가 고른 것만 남아서 파서를 넓혀도 끝난 대화에 소급되지 않는다.
 * 원본 줄이 그 재료다 — **버리는 줄을 남기는 것이 이 파일의 존재 이유다.**
 */
describe('RunManager — 원본 줄 로그', () => {
  const SIGNATURE = `SIG-${'s'.repeat(4000)}`
  const init = { type: 'system', subtype: 'init', session_id: 's', model: 'claude-opus-5' }
  const thinking = {
    type: 'assistant', session_id: 's', uuid: 'u-1',
    message: { content: [{ type: 'thinking', thinking: '먼저 파일을 본다', signature: SIGNATURE }] }
  }
  /** 어댑터가 버리는 하위 타입 — 정규화 로그에는 없고 원본에는 있어야 한다 */
  const status = { type: 'system', subtype: 'status', status: 'compacting', session_id: 's' }
  const rateLimit = {
    type: 'rate_limit_event', session_id: 's',
    rate_limit_info: { status: 'allowed', resetsAt: 1790000000, unifiedWindows: { five_hour: { utilization: 0.03 } } }
  }
  const result = { type: 'result', subtype: 'success', is_error: false, result: '끝', session_id: 's' }
  const BROKEN = '이건 JSON이 아니다 {'

  const json = (line: unknown) => JSON.stringify(line)

  /** 파일을 줄로 돌려준다. 끝은 반드시 개행이다 */
  function readLines(path: string): string[] {
    const content = readFileSync(path, 'utf8')
    expect(content.endsWith('\n')).toBe(true)
    return content.slice(0, -1).split('\n')
  }

  it('stdout 줄을 파싱하기 전에 받은 그대로 순서대로 쓴다 — 깨진 줄과 어댑터가 버리는 줄도 (FR-1)', async () => {
    // CLI가 CRLF로 써도 원본 로그는 LF다 — 줄 분할기가 끝의 \r을 걷는다(stream.ts).
    // 원본 "그대로"는 분할기가 넘긴 줄 그대로라는 뜻이다.
    const stdout = [json(init), json(thinking), json(status), BROKEN, json(rateLimit), json(result)]
      .map((line) => `${line}\r\n`).join('')
    const t = withScript({ stdout, exitCode: 0 })
    try {
      const outcome = await t.run('claude-code')
      expect(outcome.status).toBe('succeeded')

      const rawPath = t.manager.rawLogPathFor('r-judge')
      // 경로는 정규화 로그의 옆자리다 — DB 컬럼 없이 유도된다(FR-2).
      expect(dirname(rawPath)).toBe(dirname(outcome.logPath))
      const raw = readFileSync(rawPath, 'utf8')
      expect(raw).not.toContain('\r')
      // rate_limit_event만 빠진다 (spec §7-A) — 개인 구독 정보다.
      expect(readLines(rawPath)).toEqual([json(init), json(thinking), json(status), BROKEN, json(result)])
      expect(raw).not.toContain('rate_limit')

      // 서명은 원본 줄째로만 남는다 — 정규화 로그에는 생각의 본문만 간다(E3).
      expect(raw).toContain(SIGNATURE)
      const stream = readFileSync(outcome.logPath, 'utf8')
      expect(stream).not.toContain('SIG-')
      expect(stream).toContain('먼저 파일을 본다')
      expect(stream).not.toContain('compacting')
    } finally { t.cleanup() }
  })

  it('상한을 넘기면 표식 한 줄로 끝나고, 정규화 로그와 run은 그대로다 (FR-3)', async () => {
    const limit = Buffer.byteLength(json(init)) + Buffer.byteLength(json(thinking)) + 2
    const t = withScript({ lines: [init, thinking, status, result], exitCode: 0 }, { rawLogMaxBytes: limit })
    try {
      const outcome = await t.run('claude-code')
      expect(outcome.status).toBe('succeeded')
      expect(outcome.resultText).toBe('끝')

      const lines = readLines(t.manager.rawLogPathFor('r-judge'))
      expect(lines.slice(0, 2)).toEqual([json(init), json(thinking)])
      expect(lines).toHaveLength(3)
      expect(JSON.parse(lines[2]!)).toEqual({ oneDesk: 'raw-truncated', limitBytes: limit, at: expect.any(Number) })

      const stream = readFileSync(outcome.logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as RunEvent)
      expect(stream.at(-1)?.type).toBe('result')
    } finally { t.cleanup() }
  })

  it('원본 로그를 열지 못해도 run은 끝나고, 정규화 로그는 온전하다 (FR-4)', async () => {
    const errors: string[] = []
    const t = withScript({ lines: [init, thinking, result], exitCode: 0 }, { onError: (message) => errors.push(message) })
    try {
      // 원본 로그가 놓일 자리에 같은 이름의 디렉토리 — 열기가 비동기로 실패한다.
      mkdirSync(t.manager.rawLogPathFor('r-judge'), { recursive: true })

      const outcome = await t.run('claude-code')

      expect(outcome.status).toBe('succeeded')
      expect(errors.some((m) => m.includes('run 원본 로그를 쓸 수 없습니다'))).toBe(true)
      // 두 로그는 서로 독립이다 — 한쪽이 실패해도 다른 쪽은 끝까지 쓴다.
      expect(errors.some((m) => m.includes('run 로그를 쓸 수 없습니다'))).toBe(false)
      const stream = readFileSync(outcome.logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as RunEvent)
      expect(stream).toEqual(t.events)
      expect(stream.at(-1)?.type).toBe('result')
    } finally { t.cleanup() }
  })

  it('stderr와 실행 전 이벤트(preEvents)는 원본 로그에 쓰지 않는다 (FR-5)', async () => {
    const t = withScript({ lines: [result], stderr: 'stderr에-남은-글\n', exitCode: 0 })
    try {
      const outcome = await t.run('claude-code', {
        preEvents: [{ type: 'error', runId: 'r-judge', at: 0, message: '맥락 파일을 읽을 수 없어 빠졌습니다' }]
      })
      expect(readLines(t.manager.rawLogPathFor('r-judge'))).toEqual([json(result)])
      // preEvents는 프로세스 출력이 아니다 — 정규화 로그에만 간다.
      expect(readFileSync(outcome.logPath, 'utf8')).toContain('맥락 파일을 읽을 수 없어 빠졌습니다')
    } finally { t.cleanup() }
  })

  it('돌려준 순간 원본 로그는 닫혀 있다 — 정상 종료와 spawn 실패 둘 다', async () => {
    // writer가 하나 늘었으니 닫는 자리도 하나 는다. 닫지 않으면 run마다 파일 핸들이 하나씩
    // 새고, 기다리지 않으면 돌려받은 쪽이 아직 쓰는 중인 파일을 본다.
    const t = withScript({ lines: [init, thinking, status, result], exitCode: 0 })
    const { manager, cleanup } = makeManager()
    try {
      await t.run('claude-code')
      expect(closedRawLogs).toContain(t.manager.rawLogPathFor('r-judge'))

      // 오류 경로 — 프로세스가 뜨지도 못한 run도 같은 자리에서 닫는다.
      const failed = await manager.start({
        ...spec('no-such'), executable: resolve(tmpdir(), 'one-desk-no-such-cli'), extraArgs: []
      })
      expect(failed.status).toBe('failed')
      expect(closedRawLogs).toContain(manager.rawLogPathFor('r-no-such'))
    } finally {
      t.cleanup()
      cleanup()
    }
  })
})

/**
 * 병합 규칙 (`docs/sdlc/run-info/spec.md` §3-3). 필드마다 규칙이 다르다 —
 * 토큰·비용은 더하고, 모델과 컨텍스트 둘은 마지막 non-null이 이긴다.
 *
 * 순수 함수로 검증한다. 실제 spawn에 얹으면 Windows에서 가짜 CLI가 뜨지 않아
 * OS마다 다른 것을 보게 된다(CLAUDE.md).
 */
describe('mergeUsage', () => {
  const u = (known: Partial<RunUsage>): RunUsage => emptyUsage(known)

  it('토큰과 비용은 더한다 — opencode는 스텝마다 온다', () => {
    const merged = mergeUsage(
      u({ inputTokens: 100, outputTokens: 10, cacheReadTokens: 5, cacheWriteTokens: 1, reasoningTokens: 2, costUsd: 0.1 }),
      u({ inputTokens: 200, outputTokens: 20, cacheReadTokens: 7, cacheWriteTokens: 3, reasoningTokens: 4, costUsd: 0.2 })
    )
    expect(merged).toMatchObject({
      inputTokens: 300, outputTokens: 30, cacheReadTokens: 12,
      cacheWriteTokens: 4, reasoningTokens: 6
    })
    expect(merged!.costUsd).toBeCloseTo(0.3, 10)
  })

  it('claude처럼 한 번만 오면 그 값이 그대로 남는다', () => {
    // 하나를 더하면 그 하나가 된다 — 한 규칙이 두 CLI를 모두 맞춘다.
    const merged = mergeUsage(null, u({ inputTokens: 2, outputTokens: 4 }))
    expect(merged).toMatchObject({ inputTokens: 2, outputTokens: 4 })
  })

  it('모델과 컨텍스트는 마지막 non-null이 이긴다 — 합이 아니라 상태다', () => {
    const merged = mergeUsage(
      u({ model: 'claude-opus-5[1m]' }),
      u({ contextTokens: 502, contextWindow: 1000000 })
    )
    expect(merged).toMatchObject({
      model: 'claude-opus-5[1m]', contextTokens: 502, contextWindow: 1000000
    })
  })

  it('컨텍스트는 덮어쓴다 — 더하면 창을 넘는다', () => {
    const merged = mergeUsage(u({ contextTokens: 1000 }), u({ contextTokens: 1200 }))
    expect(merged!.contextTokens).toBe(1200)
  })

  it('null은 이미 아는 값을 덮지 않는다', () => {
    const merged = mergeUsage(
      u({ model: 'claude-opus-5', contextWindow: 200000, inputTokens: 5 }),
      u({ outputTokens: 3 })
    )
    expect(merged).toMatchObject({
      model: 'claude-opus-5', contextWindow: 200000, inputTokens: 5, outputTokens: 3
    })
  })

  it('아무것도 없으면 null이다 — 빈 껍데기를 만들지 않는다', () => {
    expect(mergeUsage(null, null)).toBeNull()
  })
})
