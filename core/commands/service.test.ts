import { describe, it, expect, beforeEach } from 'vitest'
import { createCommandService } from './service'
import type { CommandDescription, CommandPlugin, ProbeResult } from './types'

const WORKSPACE = 'ws-1'

/** 픽스처(`fake-claude.mjs`)의 init과 같은 모양 — 터미널 전용 3개가 섞여 있다. */
function init(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    slashCommands: ['code-review', 'compact', 'doctor', 'color', 'reload-plugins', 'pinetest'],
    terminalSlashCommands: ['doctor', 'color', 'reload-plugins'],
    plugins: [],
    error: null,
    ...overrides
  }
}

/** 부른 횟수를 세는 가짜 probe. 캐시 검증은 이 수를 본다. */
function fakeProbe(results: ProbeResult[] | ProbeResult) {
  const calls: { workspaceId: string; cwd: string }[] = []
  const queue = Array.isArray(results) ? results : null
  return Object.assign(
    async (input: { workspaceId: string; cwd: string }): Promise<ProbeResult> => {
      calls.push(input)
      return queue ? (queue[calls.length - 1] ?? queue[queue.length - 1]!) : (results as ProbeResult)
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

let probe: ReturnType<typeof fakeProbe>
let describeFn: ReturnType<typeof fakeDescribe>

beforeEach(() => {
  probe = fakeProbe(init())
  describeFn = fakeDescribe()
})

describe('createCommandService', () => {
  it('터미널 전용 커맨드를 목록에서 뺀다', async () => {
    const service = createCommandService({ probe, describe: describeFn })

    const { commands } = await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })

    expect(commands.map((c) => c.name)).toEqual(['code-review', 'compact', 'pinetest'])
  })

  it('설명을 찾지 못한 커맨드도 이름만으로 남는다', async () => {
    const service = createCommandService({ probe, describe: describeFn })

    const { commands } = await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })

    expect(commands[0]).toEqual({ name: 'code-review', description: null, usesArguments: false })
  })

  it('지도에 있는 이름에는 설명과 인자 사용 여부를 붙인다', async () => {
    describeFn = fakeDescribe({ pinetest: { description: '솔잎 검사', usesArguments: true } })
    const service = createCommandService({ probe, describe: describeFn })

    const { commands } = await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })

    expect(commands.find((c) => c.name === 'pinetest'))
      .toEqual({ name: 'pinetest', description: '솔잎 검사', usesArguments: true })
  })

  it('probe가 알려준 플러그인을 describe에 넘긴다', async () => {
    const plugins = [{ name: 'superpowers', path: '/plugins/superpowers' }]
    probe = fakeProbe(init({ plugins }))
    const service = createCommandService({ probe, describe: describeFn })

    await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })

    expect(describeFn.calls).toEqual([{ cwd: '/repo', plugins }])
  })
})

describe('캐시', () => {
  it('같은 cwd로 세 번 불러도 probe는 한 번만 돈다', async () => {
    const service = createCommandService({ probe, describe: describeFn })

    await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })
    await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })
    const third = await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })

    expect(probe.calls).toHaveLength(1)
    expect(describeFn.calls).toHaveLength(1)
    expect(third.commands.map((c) => c.name)).toEqual(['code-review', 'compact', 'pinetest'])
  })

  it('cwd가 다르면 다시 얻는다', async () => {
    const service = createCommandService({ probe, describe: describeFn })

    await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })
    await service.list({ workspaceId: WORKSPACE, cwd: '/다른-repo' })

    expect(probe.calls.map((c) => c.cwd)).toEqual(['/repo', '/다른-repo'])
  })

  it('refresh는 캐시를 버리고 다시 얻는다', async () => {
    const service = createCommandService({ probe, describe: describeFn })

    await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })
    await service.refresh({ workspaceId: WORKSPACE, cwd: '/repo' })

    expect(probe.calls).toHaveLength(2)
  })

  it('refresh한 뒤에는 새 목록이 캐시된다', async () => {
    probe = fakeProbe([init(), init({ slashCommands: ['새것'], terminalSlashCommands: [] })])
    const service = createCommandService({ probe, describe: describeFn })

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
      { slashCommands: [], terminalSlashCommands: [], plugins: [], error: '시간이 초과됐습니다' },
      init()
    ])
    const service = createCommandService({ probe, describe: describeFn })

    await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })
    const failed = await service.refresh({ workspaceId: WORKSPACE, cwd: '/repo' })
    await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })

    expect(failed).toEqual({ commands: [], error: '시간이 초과됐습니다' })
    expect(probe.calls).toHaveLength(3)
  })

  it('같은 cwd로 동시에 불러도 probe는 한 번만 돈다', async () => {
    // 두 번 뜨면 사용자의 SessionStart 훅이 두 번 돈다 — 캐시가 채워지기 전이 가장 위험하다.
    const service = createCommandService({ probe, describe: describeFn })

    const [a, b] = await Promise.all([
      service.list({ workspaceId: WORKSPACE, cwd: '/repo' }),
      service.list({ workspaceId: WORKSPACE, cwd: '/repo' })
    ])

    expect(probe.calls).toHaveLength(1)
    expect(a).toEqual(b)
  })

  it('refresh가 도는 중의 list는 낡은 목록이 아니라 새 결과를 받는다', async () => {
    probe = fakeProbe([init(), init({ slashCommands: ['새것'], terminalSlashCommands: [] })])
    const service = createCommandService({ probe, describe: describeFn })
    await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })

    const [refreshed, listed] = await Promise.all([
      service.refresh({ workspaceId: WORKSPACE, cwd: '/repo' }),
      service.list({ workspaceId: WORKSPACE, cwd: '/repo' })
    ])

    expect(listed).toEqual(refreshed)
    expect(listed.commands.map((c) => c.name)).toEqual(['새것'])
    expect(probe.calls).toHaveLength(2)
  })

  it('probe가 실패하면 캐시하지 않고 다음 list가 다시 시도한다', async () => {
    // 실패를 캐시하면 새로고침을 누르기 전까지 영영 빈 목록이다.
    probe = fakeProbe([
      { slashCommands: [], terminalSlashCommands: [], plugins: [], error: '시간이 초과됐습니다' },
      init()
    ])
    const service = createCommandService({ probe, describe: describeFn })

    const failed = await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })
    const retried = await service.list({ workspaceId: WORKSPACE, cwd: '/repo' })

    expect(failed).toEqual({ commands: [], error: '시간이 초과됐습니다' })
    expect(probe.calls).toHaveLength(2)
    expect(retried).toEqual({ commands: expect.any(Array), error: null })
    expect(retried.commands.map((c) => c.name)).toEqual(['code-review', 'compact', 'pinetest'])
  })
})
