import { describe, it, expect, beforeEach } from 'vitest'
import { createCommandService } from './service'
import type { CommandDescription, CommandPlugin, ProbeResult } from './types'
import type { AgentAuthState } from './service'

const WORKSPACE = 'ws-1'

/** 픽스처(`fake-claude.mjs`)의 init과 같은 모양 — 터미널 전용 3개가 섞여 있다. */
function init(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    slashCommands: ['code-review', 'compact', 'doctor', 'color', 'reload-plugins', 'pinetest'],
    terminalSlashCommands: ['doctor', 'color', 'reload-plugins'],
    plugins: [],
    model: 'claude-fake-5[1m]',
    version: '9.9.9-fake',
    error: null,
    ...overrides
  }
}

/**
 * 부른 횟수를 세는 가짜 probe. 캐시 검증은 이 수를 본다.
 * 배열에 `Error`를 넣으면 그 차례에 던진다 — probe는 던지지 않는 계약이지만 주입하는 쪽
 * (Task 5의 실행 파일 해석)은 던질 수 있다.
 */
function fakeProbe(results: (ProbeResult | Error)[] | ProbeResult) {
  const calls: { workspaceId: string; cwd: string }[] = []
  const queue = Array.isArray(results) ? results : null
  return Object.assign(
    async (input: { workspaceId: string; cwd: string }): Promise<ProbeResult> => {
      calls.push(input)
      const next = queue
        ? (queue[calls.length - 1] ?? queue[queue.length - 1]!)
        : (results as ProbeResult)
      if (next instanceof Error) throw next
      return next
    },
    { calls }
  )
}

function fakeDescribe(found: Record<string, CommandDescription> = {}) {
  const calls: { cwd: string; plugins: CommandPlugin[] }[] = []
  return Object.assign(
    async (input: { cwd: string; plugins: CommandPlugin[] }) => {
      calls.push(input)
      return new Map(Object.entries(found))
    },
    { calls }
  )
}

/**
 * 인증 상태를 차례로 돌려주는 가짜 (`auth status`의 `state`). 부른 횟수를 센다.
 * 배열이면 차례마다 하나씩, 끝나면 마지막 값을 반복한다. `Error`면 그 차례에 던진다.
 */
function fakeAuth(states: (AgentAuthState | Error)[] | AgentAuthState = 'ok') {
  const calls: { workspaceId: string; cwd: string }[] = []
  const queue = Array.isArray(states) ? states : [states]
  return Object.assign(
    async (input: { workspaceId: string; cwd: string }): Promise<AgentAuthState> => {
      calls.push(input)
      const next = queue[calls.length - 1] ?? queue[queue.length - 1]!
      if (next instanceof Error) throw next
      return next
    },
    { calls }
  )
}

const FAILED: ProbeResult = {
  slashCommands: [], terminalSlashCommands: [], plugins: [],
  model: null, version: null, error: 'CLI가 init 없이 종료됐습니다 (종료 코드 1)'
}

let probe: ReturnType<typeof fakeProbe>
let describeFn: ReturnType<typeof fakeDescribe>
let auth: ReturnType<typeof fakeAuth>

beforeEach(() => {
  probe = fakeProbe(init())
  describeFn = fakeDescribe()
  auth = fakeAuth()
})

describe('createCommandService', () => {
  it('터미널 전용 커맨드를 목록에서 뺀다', async () => {
    const service = createCommandService({ probe, describe: describeFn, checkAuth: auth })

    const { commands } = await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })

    expect(commands.map((c) => c.name)).toEqual(['code-review', 'compact', 'pinetest'])
  })

  it('설명을 찾지 못한 커맨드도 이름만으로 남는다', async () => {
    const service = createCommandService({ probe, describe: describeFn, checkAuth: auth })

    const { commands } = await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })

    expect(commands[0]).toEqual({ name: 'code-review', description: null, usesArguments: false })
  })

  it('지도에 있는 이름에는 설명과 인자 사용 여부를 붙인다', async () => {
    describeFn = fakeDescribe({ pinetest: { description: '솔잎 검사', usesArguments: true } })
    const service = createCommandService({ probe, describe: describeFn, checkAuth: auth })

    const { commands } = await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })

    expect(commands.find((c) => c.name === 'pinetest'))
      .toEqual({ name: 'pinetest', description: '솔잎 검사', usesArguments: true })
  })

  it('probe가 알려준 플러그인을 describe에 넘긴다', async () => {
    const plugins = [{ name: 'superpowers', path: '/plugins/superpowers' }]
    probe = fakeProbe(init({ plugins }))
    const service = createCommandService({ probe, describe: describeFn, checkAuth: auth })

    await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })

    expect(describeFn.calls).toEqual([{ cwd: '/repo', plugins }])
  })
})

describe('캐시', () => {
  it('같은 cwd로 세 번 불러도 probe는 한 번만 돈다', async () => {
    const service = createCommandService({ probe, describe: describeFn, checkAuth: auth })

    await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })
    await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })
    const third = await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })

    expect(probe.calls).toHaveLength(1)
    expect(describeFn.calls).toHaveLength(1)
    expect(third.commands.map((c) => c.name)).toEqual(['code-review', 'compact', 'pinetest'])
  })

  it('cwd가 다르면 다시 얻는다', async () => {
    const service = createCommandService({ probe, describe: describeFn, checkAuth: auth })

    await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })
    await service.list({ workspaceId: WORKSPACE, cwd: '/다른-repo' })

    expect(probe.calls.map((c) => c.cwd)).toEqual(['/repo', '/다른-repo'])
  })

  it('workspace가 달라도 cwd가 같으면 다시 얻지 않는다', async () => {
    // 캐시 키는 cwd 하나다 — 커맨드는 작업 디렉토리에서 나온다(설계 › 데이터 모델).
    const service = createCommandService({ probe, describe: describeFn, checkAuth: auth })

    await service.list({ workspaceId: 'ws-1', cwd: '/repo' })
    const other = await service.list({ workspaceId: 'ws-2', cwd: '/repo' })

    expect(probe.calls).toHaveLength(1)
    expect(other.commands.map((c) => c.name)).toEqual(['code-review', 'compact', 'pinetest'])
  })

  it('refresh는 캐시를 버리고 다시 얻는다', async () => {
    const service = createCommandService({ probe, describe: describeFn, checkAuth: auth })

    await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })
    await service.refresh({ workspaceId: WORKSPACE, cwd: '/repo' })

    expect(probe.calls).toHaveLength(2)
  })

  it('refresh한 뒤에는 새 목록이 캐시된다', async () => {
    probe = fakeProbe([init(), init({ slashCommands: ['새것'], terminalSlashCommands: [] })])
    const service = createCommandService({ probe, describe: describeFn, checkAuth: auth })

    await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })
    const refreshed = await service.refresh({ workspaceId: WORKSPACE, cwd: '/repo' })
    const after = await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })

    expect(refreshed.commands.map((c) => c.name)).toEqual(['새것'])
    expect(after.commands.map((c) => c.name)).toEqual(['새것'])
    expect(probe.calls).toHaveLength(2)
  })

  it('refresh가 실패하면 낡은 목록을 남기지 않는다', async () => {
    // 버리지 않으면 실패 사유를 보여준 직후의 list가 옛 목록을 되돌려 화면이 스스로를 뒤집는다.
    probe = fakeProbe([
      init(),
      { slashCommands: [], terminalSlashCommands: [], plugins: [], model: null, version: null, error: '시간이 초과됐습니다' },
      init()
    ])
    const service = createCommandService({ probe, describe: describeFn, checkAuth: auth })

    await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })
    const failed = await service.refresh({ workspaceId: WORKSPACE, cwd: '/repo' })
    await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })

    expect(failed).toEqual({ commands: [], error: '시간이 초과됐습니다' })
    expect(probe.calls).toHaveLength(2)
  })

  it('같은 cwd로 동시에 불러도 probe는 한 번만 돈다', async () => {
    // 두 번 뜨면 사용자의 SessionStart 훅이 두 번 돈다 — 캐시가 채워지기 전이 가장 위험하다.
    const service = createCommandService({ probe, describe: describeFn, checkAuth: auth })

    const [a, b] = await Promise.all([
      service.list({ workspaceId: WORKSPACE, cwd: '/repo' }),
      service.list({ workspaceId: WORKSPACE, cwd: '/repo' })
    ])

    expect(probe.calls).toHaveLength(1)
    expect(a).toEqual(b)
  })

  it('probe가 던져도 다음 list가 다시 시도한다', async () => {
    // 거부된 조회를 진행 중 표시에서 지우지 않으면 그 cwd는 앱을 다시 켤 때까지 같은 실패만 돌려준다.
    probe = fakeProbe([new Error('실행 파일을 찾을 수 없습니다'), init()])
    const service = createCommandService({ probe, describe: describeFn, checkAuth: auth })

    await expect(service.list({ workspaceId: WORKSPACE, cwd: '/repo' }))
      .rejects.toThrow('실행 파일을 찾을 수 없습니다')
    const retried = await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })

    expect(retried.commands.map((c) => c.name)).toEqual(['code-review', 'compact', 'pinetest'])
    expect(probe.calls).toHaveLength(2)
  })

  it('refresh가 도는 중의 list는 낡은 목록이 아니라 새 결과를 받는다', async () => {
    probe = fakeProbe([init(), init({ slashCommands: ['새것'], terminalSlashCommands: [] })])
    const service = createCommandService({ probe, describe: describeFn, checkAuth: auth })
    await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })

    const [refreshed, listed] = await Promise.all([
      service.refresh({ workspaceId: WORKSPACE, cwd: '/repo' }),
      service.list({ workspaceId: WORKSPACE, cwd: '/repo' })
    ])

    expect(listed).toEqual(refreshed)
    expect(listed.commands.map((c) => c.name)).toEqual(['새것'])
    expect(probe.calls).toHaveLength(2)
  })

  it('실패한 탐색도 캐시하고 수동 새로고침에서만 다시 시도한다', async () => {
    // 탭을 바꿀 때마다 실패한 탐색과 SessionStart 훅이 반복되지 않아야 한다.
    probe = fakeProbe([
      { slashCommands: [], terminalSlashCommands: [], plugins: [], model: null, version: null, error: '시간이 초과됐습니다' },
      init()
    ])
    const service = createCommandService({ probe, describe: describeFn, checkAuth: auth })

    const failed = await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })
    expect(await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })).toEqual(failed)
    expect(probe.calls).toHaveLength(1)
    const retried = await service.refresh({ workspaceId: WORKSPACE, cwd: '/repo' })

    expect(failed).toEqual({ commands: [], error: '시간이 초과됐습니다' })
    expect(probe.calls).toHaveLength(2)
    expect(retried).toEqual({ commands: expect.any(Array), error: null })
    expect(retried.commands.map((c) => c.name)).toEqual(['code-review', 'compact', 'pinetest'])
  })
})

describe('로그인 뒤의 실패 캐시 (docs/sdlc/command-cache-auth/)', () => {
  const target = { workspaceId: WORKSPACE, cwd: '/repo' }

  it('로그인하지 않은 채 난 실패는 로그인이 확인되면 버리고 다시 얻는다 (FR-2·FR-3)', async () => {
    probe = fakeProbe([FAILED, init()])
    auth = fakeAuth(['none', 'ok'])
    const service = createCommandService({ probe, describe: describeFn, checkAuth: auth })

    const failed = await service.list(target)
    const after = await service.list(target)

    expect(failed.error).not.toBeNull()
    expect(after.error).toBeNull()
    expect(after.commands.map((c) => c.name)).toEqual(['code-review', 'compact', 'pinetest'])
    expect(probe.calls).toHaveLength(2)
  })

  it('아직 로그인하지 않았으면 인증만 다시 묻고 probe는 띄우지 않는다', async () => {
    probe = fakeProbe([FAILED, init()])
    auth = fakeAuth('none')
    const service = createCommandService({ probe, describe: describeFn, checkAuth: auth })

    const failed = await service.list(target)
    const again = await service.list(target)

    expect(again).toEqual(failed)
    expect(probe.calls).toHaveLength(1)
    expect(auth.calls).toHaveLength(2)
  })

  it('로그인한 채로 난 실패는 probe도 인증 조회도 다시 돌리지 않는다 (FR-4)', async () => {
    probe = fakeProbe([FAILED, init()])
    auth = fakeAuth('ok')
    const service = createCommandService({ probe, describe: describeFn, checkAuth: auth })

    await service.list(target)
    await service.list(target)
    await service.list(target)

    expect(probe.calls).toHaveLength(1)
    expect(auth.calls).toHaveLength(1)
  })

  it('성공한 결과는 인증을 묻지 않는다 (FR-5)', async () => {
    const service = createCommandService({ probe, describe: describeFn, checkAuth: auth })

    await service.list(target)
    await service.list(target)

    expect(auth.calls).toHaveLength(0)
  })

  it('인증 조회가 던져도 목록 조회는 실패 결과를 정상으로 돌려준다 (FR-6)', async () => {
    probe = fakeProbe([FAILED, init()])
    auth = fakeAuth([new Error('auth 폭발'), new Error('auth 폭발')])
    const service = createCommandService({ probe, describe: describeFn, checkAuth: auth })

    const first = await service.list(target)
    const second = await service.list(target)

    expect(first.error).toBe(FAILED.error)
    expect(second.error).toBe(FAILED.error)
    expect(probe.calls).toHaveLength(1)
  })

  it('agentInfo도 로그인 뒤에는 옛 실패를 버린다 — 캐시를 나눠 쓰는 두 입구가 갈리지 않는다', async () => {
    probe = fakeProbe([FAILED, init()])
    auth = fakeAuth(['none', 'ok'])
    const service = createCommandService({ probe, describe: describeFn, checkAuth: auth })

    await service.list(target)
    const info = await service.agentInfo(target)

    expect(info).toEqual({ model: 'claude-fake-5[1m]', version: '9.9.9-fake', error: null })
    expect(probe.calls).toHaveLength(2)
  })
})
