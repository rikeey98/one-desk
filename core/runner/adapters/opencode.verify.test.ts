import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

describe('opencodeAdapter.verifyRunnable — 기본 probe', () => {
  /**
   * **배선 잠금.** 위 시나리오들은 probe를 주입해 확인하므로 기본 probe가 실제로
   * 무엇을 띄우는지는 보지 않는다. 여기서는 진짜로 띄운다 — 실행 권한도 shebang도 없는
   * `.mjs`라 `agentCommand`를 거치지 않으면 POSIX는 EACCES, Windows는 EFTYPE으로 죽고
   * "설정을 확인하지 못했습니다"가 돌아온다. ask 키를 읽어냈다는 것이 떴다는 증거다.
   */
  it('ONE_DESK_AGENT_LAUNCHER가 있으면 그것으로 실행 파일을 띄운다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'one-desk-oc-verify-'))
    const file = join(dir, 'no-exec.mjs')
    writeFileSync(
      file,
      `process.stdout.write(${JSON.stringify(JSON.stringify({ permission: { webfetch: 'ask' } }))})\n`,
      { mode: 0o644 }
    )

    const previous = process.env['ONE_DESK_AGENT_LAUNCHER']
    process.env['ONE_DESK_AGENT_LAUNCHER'] = process.execPath
    try {
      // cwd는 지우지 않는 곳을 준다 — 자식이 잡으면 Windows에서 rmSync가 EBUSY로 죽는다.
      const result = await opencodeAdapter.verifyRunnable({
        executable: file, cwd: tmpdir(), permission: 'edit'
      })
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('webfetch')
    } finally {
      if (previous === undefined) delete process.env['ONE_DESK_AGENT_LAUNCHER']
      else process.env['ONE_DESK_AGENT_LAUNCHER'] = previous
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
