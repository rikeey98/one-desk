import { describe, it, expect, vi } from 'vitest'
import { opencodeAdapter, type ConfigProbe } from './opencode'

const input = { executable: '/bin/opencode', cwd: '/tmp/work', permission: 'edit' as const }

function probeReturning(permission: unknown) {
  return vi.fn<ConfigProbe>(async () => JSON.stringify({ permission }))
}

describe('opencodeAdapter.verifyRunnable', () => {
  it('ask가 없으면 통과시킨다', async () => {
    const probe = probeReturning({ '*': 'deny', read: 'allow', edit: 'allow' })
    await expect(opencodeAdapter.verifyRunnable(input, probe)).resolves.toEqual({ ok: true })
  })

  it('ask가 남아 있으면 거부하고 키 이름을 알려준다', async () => {
    const probe = probeReturning({ '*': 'deny', read: 'allow', webfetch: 'ask' })
    const result = await opencodeAdapter.verifyRunnable(input, probe)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('webfetch')
    expect(result.reason).toContain('/tmp/work')
  })

  it('ask가 여럿이면 전부 알려준다', async () => {
    const probe = probeReturning({ bash: 'ask', webfetch: 'ask' })
    const result = await opencodeAdapter.verifyRunnable(input, probe)
    expect(result.reason).toContain('bash')
    expect(result.reason).toContain('webfetch')
  })

  it('우리가 실을 환경변수를 그대로 실어 확인한다', async () => {
    // 이걸 빼먹으면 실행할 때와 다른 설정을 검사하게 되어 검사가 무의미해진다.
    const probe = probeReturning({})
    await opencodeAdapter.verifyRunnable(input, probe)
    const passed = probe.mock.calls[0]![0]
    expect(passed.cwd).toBe('/tmp/work')
    expect(passed.executable).toBe('/bin/opencode')
    expect(JSON.parse(passed.env['OPENCODE_PERMISSION']!)['edit']).toBe('allow')
  })

  it('설정을 읽지 못하면 거부한다', async () => {
    // 조용히 통과시키면 검사가 있으나 마나다.
    const probe = vi.fn(async () => { throw new Error('spawn 실패') })
    const result = await opencodeAdapter.verifyRunnable(input, probe)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('확인하지 못했습니다')
  })

  it('출력이 JSON이 아니면 거부한다', async () => {
    const probe = vi.fn(async () => '이건 JSON이 아니다')
    const result = await opencodeAdapter.verifyRunnable(input, probe)
    expect(result.ok).toBe(false)
  })

  it('permission이 아예 없으면 통과시킨다', async () => {
    // 아무도 권한을 정하지 않았다는 뜻이고, 우리 환경변수가 이미 전부 정했다.
    const probe = vi.fn(async () => JSON.stringify({ permission: null }))
    await expect(opencodeAdapter.verifyRunnable(input, probe)).resolves.toEqual({ ok: true })
  })
})
