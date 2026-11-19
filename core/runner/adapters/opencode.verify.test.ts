import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { opencodeAdapter, type ConfigProbe } from './opencode'
import {
  capabilityOf, createOpencodeV2Verifier, judgeV1Config, judgeV2Agents,
  UNRECOGNIZED_STANDALONE, UNVERIFIABLE_REASON, type CliExec, type CliResult
} from './opencode.verify'
import { opencodePermissionConfig, opencodeV2Config, opencodeV2Rules, type OpencodeRule } from '../permission'
import type { VerifyRunnableInput } from '../types'
import { ORIGINAL_LD_LIBRARY_PATH } from '../userEnv'
import { asLinuxPackage, USER_LD_LIBRARY_PATH } from '../fixtures/linuxPackageEnv'

const input: VerifyRunnableInput = {
  executable: '/bin/opencode', cwd: '/tmp/work', permission: 'edit',
  dialect: 'v1', model: null, effort: null, resumeSessionId: null
}

/** 우리가 edit 권한으로 보내는 것 — 긍정 확인은 이것이 그대로 돌아와야 통과한다 */
const SENT = opencodePermissionConfig('edit')

function probeReturning(permission: unknown) {
  return vi.fn<ConfigProbe>(async () => JSON.stringify({ permission }))
}

describe('opencodeAdapter.verifyRunnable — 1.x (긍정 확인, opencode-v2 spec FR-9)', () => {
  it('보낸 권한이 그대로 걸려 있으면 통과시킨다', async () => {
    await expect(opencodeAdapter.verifyRunnable(input, probeReturning(SENT))).resolves.toEqual({ ok: true })
  })

  it('ask가 남아 있으면 거부하고 키 이름을 알려준다', async () => {
    const probe = probeReturning({ ...SENT, mytool: 'ask' })
    const result = await opencodeAdapter.verifyRunnable(input, probe)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('mytool')
    expect(result.reason).toContain('/tmp/work')
  })

  it('거부 이유는 멈춘다고 하지 않는다 — 1.18.x는 ask를 조용히 거부하고 끝난다', async () => {
    // `docs/sdlc/conversation-fixes/` spec FR-14. 예전 문구("답할 사람이 없어 멈춥니다")는
    // 틀린 증상을 가리켜, 사용자가 멈춘 적 없는 run에서 원인을 찾게 만든다.
    const result = await opencodeAdapter.verifyRunnable(input, probeReturning({ ...SENT, webfetch: 'ask' }))
    expect(result.reason).not.toContain('멈춥니다')
    expect(result.reason).toContain('거부')
  })

  it('ask가 여럿이면 전부 알려준다', async () => {
    const result = await opencodeAdapter.verifyRunnable(input, probeReturning({ ...SENT, bash: 'ask', webfetch: 'ask' }))
    expect(result.reason).toContain('bash')
    expect(result.reason).toContain('webfetch')
  })

  it('우리가 실을 환경변수를 그대로 실어 확인한다', async () => {
    // 이걸 빼먹으면 실행할 때와 다른 설정을 검사하게 되어 검사가 무의미해진다.
    const probe = probeReturning(SENT)
    await opencodeAdapter.verifyRunnable(input, probe)
    const passed = probe.mock.calls[0]![0]
    expect(passed.cwd).toBe('/tmp/work')
    expect(passed.executable).toBe('/bin/opencode')
    expect(JSON.parse(passed.env['OPENCODE_PERMISSION']!)).toEqual(SENT)
  })

  it('리눅스 패키지에서는 run과 같은 환경(사용자의 LD_LIBRARY_PATH)으로 확인한다 (linux-launch-env)', async () => {
    const probe = probeReturning(SENT)
    await asLinuxPackage(() => opencodeAdapter.verifyRunnable(input, probe))
    const passed = probe.mock.calls[0]![0]
    expect(passed.env['LD_LIBRARY_PATH']).toBe(USER_LD_LIBRARY_PATH)
    expect(passed.env[ORIGINAL_LD_LIBRARY_PATH]).toBeUndefined()
  })

  it('설정을 읽지 못하면 거부한다', async () => {
    // 조용히 통과시키면 검사가 있으나 마나다.
    const probe = vi.fn(async () => { throw new Error('spawn 실패') })
    const result = await opencodeAdapter.verifyRunnable(input, probe)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('확인하지 못했습니다')
  })

  it('출력이 JSON이 아니면 거부한다', async () => {
    const result = await opencodeAdapter.verifyRunnable(input, vi.fn(async () => '이건 JSON이 아니다'))
    expect(result.ok).toBe(false)
  })

  it('permission이 없으면 거부한다 — 우리 권한이 걸리지 않은 것이다', async () => {
    // 예전에는 통과였다("아무도 권한을 정하지 않았다"). 우리는 늘 보내므로, 없다는 것은 무시됐다는 뜻이다.
    for (const body of [{ permission: null }, {}, { permission: 'allow' }]) {
      const result = await opencodeAdapter.verifyRunnable(input, vi.fn(async () => JSON.stringify(body)))
      expect(result.ok, JSON.stringify(body)).toBe(false)
      expect(result.reason).toContain('걸리지 않았습니다')
    }
  })

  it('2.x의 출력(설정 출처의 배열)은 거부한다 — 버전을 못 읽어 1.x 방식으로 띄우려는 2.x를 여기서 막는다', async () => {
    // spec §2-2. 2.x에 OPENCODE_PERMISSION을 주면 통째로 무시되고 읽기 전용이 전부 허용으로 돈다. 2.3.2의 `debug config`는
    // 이런 배열을 낸다(실측) — `ask`가 없으므로 예전 확인은 조용히 통과시켰다.
    const v2Output = JSON.stringify([
      { type: 'document', path: 'C:\\Users\\me\\.config\\opencode\\opencode.jsonc', info: { model: { providerID: 'x', model: 'y' } } },
      { type: 'directory', path: 'C:\\Users\\me\\.config\\opencode' }
    ])
    const result = await opencodeAdapter.verifyRunnable(input, vi.fn(async () => v2Output))
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('걸리지 않았습니다')
  })

  it('보낸 값과 다른 키가 있으면 거부하고 그 키를 말한다', async () => {
    const result = await opencodeAdapter.verifyRunnable(input, probeReturning({ ...SENT, bash: 'allow' }))
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('bash')
  })

  it('방언이 없으면 확인하지 않고 거부한다 — 조용히 1.x로 떨어지지 않는다', async () => {
    const probe = probeReturning(SENT)
    const result = await opencodeAdapter.verifyRunnable({ ...input, dialect: null }, probe)
    expect(result.ok).toBe(false)
    expect(probe).not.toHaveBeenCalled()
  })
})

describe('judgeV1Config', () => {
  it('우리가 안 보낸 키의 allow·deny는 통과시킨다 — 남의 설정의 임의 키다', () => {
    expect(judgeV1Config(JSON.stringify({ permission: { ...SENT, mytool: 'deny' } }), SENT, '/w')).toEqual({ ok: true })
  })
})

// ── 2.x ────────────────────────────────────────────────────────────────────

const show = (rules: OpencodeRule[]) => rules.map((r) => ({ action: r.action, resource: r.resource, effect: r.effect }))
const r = (action: string, resource: string, effect: string) => ({ action, resource, effect })

/** 2.3.2의 build agent 기본 규칙 — 머리와 꼬리 (spec 0-1 실측) */
const HEAD = [
  r('*', '*', 'allow'), r('read', '*.env', 'ask'), r('read', '*.env.*', 'ask'),
  r('read', '*.env.example', 'allow'), r('question', '*', 'allow')
]
const TAIL = [r('browser', '*', 'deny'), r('skill', 'browser', 'deny')]

function agentsOutput(permissions: unknown[], id = 'build'): string {
  return JSON.stringify([
    { id, name: 'Build', mode: 'primary', permissions },
    { id: 'plan', name: 'Plan', mode: 'primary', permissions: [...HEAD, ...TAIL] }
  ])
}

describe('judgeV2Agents — 해결된 규칙의 긍정 확인 (opencode-v2 spec FR-8)', () => {
  const sent = opencodeV2Rules('read_only')

  it('우리 규칙이 두 자리에서 와 있고 뒤가 deny뿐이면 통과한다', () => {
    // 실측한 2.3.2의 모양: 머리 → (환경변수 최상위) 우리 것 → (환경변수 agents.build) 우리 것 → 꼬리
    expect(judgeV2Agents(agentsOutput([...HEAD, ...show(sent), ...show(sent), ...TAIL]), sent)).toEqual({ ok: true })
  })

  it('프로젝트의 agent별 allow가 우리 것 사이에 끼어도, 마지막에 우리 것이 다시 오면 통과한다', () => {
    // spec 0-1의 둘째 줄 — 프로젝트 agents.build의 `shell * allow`를 환경변수의 agents.build 규칙이 뒤에서 덮는다
    const resolved = [...HEAD, ...show(sent), r('shell', '*', 'allow'), ...show(sent), ...TAIL]
    expect(judgeV2Agents(agentsOutput(resolved), sent)).toEqual({ ok: true })
  })

  it('우리 규칙 뒤에 allow가 붙으면 거부하고 그 규칙을 말한다', () => {
    // spec 0-1의 첫째 줄(구멍) — 환경변수에 agent 자리가 빠지면 이렇게 된다. 뒤가 이기므로 셸이 열린다
    const resolved = [...HEAD, ...show(sent), r('shell', '*', 'allow'), ...TAIL]
    const result = judgeV2Agents(agentsOutput(resolved), sent)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('shell * allow')
  })

  it('우리 규칙 뒤에 ask가 붙어도 거부한다 — 2.x의 ask는 샌다', () => {
    const resolved = [...HEAD, ...show(sent), r('shell', '*', 'ask'), ...TAIL]
    const result = judgeV2Agents(agentsOutput(resolved), sent)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('shell * ask')
  })

  it('우리 규칙이 없으면 거부한다 — 환경변수가 무시됐다', () => {
    const result = judgeV2Agents(agentsOutput([...HEAD, ...TAIL]), sent)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('걸리지 않았습니다')
  })

  it('순서가 다르면 우리 규칙이 아니다', () => {
    const shuffled = [...show(sent)].reverse()
    expect(judgeV2Agents(agentsOutput([...HEAD, ...shuffled, ...TAIL]), sent).ok).toBe(false)
  })

  it('전체 허용도 같은 규칙으로 본다 — 머리의 * allow를 우리 것으로 치지 않는다', () => {
    const full = opencodeV2Rules('full')
    expect(judgeV2Agents(agentsOutput([...HEAD, ...show(full), ...show(full), ...TAIL]), full)).toEqual({ ok: true })
    // 환경변수가 무시되면 머리의 `* * allow`만 남는다 — 그 뒤에 ask가 있으니 통과하지 못한다
    expect(judgeV2Agents(agentsOutput([...HEAD, ...TAIL]), full).ok).toBe(false)
  })

  it.each([
    ['JSON이 아님', '이건 JSON이 아니다'],
    ['배열이 아님', JSON.stringify({ id: 'build' })],
    ['build가 없음', agentsOutput([...HEAD], 'other')],
    ['permissions가 배열이 아님', JSON.stringify([{ id: 'build', permissions: 'x' }])],
    ['규칙이 객체가 아님', JSON.stringify([{ id: 'build', permissions: ['x'] }])],
    ['빈 출력', '']
  ])('%s — 읽을 수 없으면 거부한다', (_name, raw) => {
    const result = judgeV2Agents(raw, sent)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('확인하지 못했습니다')
  })
})

describe('capabilityOf — 확인할 수 있는 바이너리인가 (FR-8a)', () => {
  const result = (exitCode: number | null, stderr = '', stdout = ''): CliResult => ({ exitCode, stdout, stderr })

  it('옵션을 받으면 확인할 수 있다', () => {
    expect(capabilityOf(result(0, '', '[]'))).toBe('verifiable')
  })

  it('--standalone을 모른다고 거부하면 확인할 수 없다 (2.0.18 실측 문구)', () => {
    expect(capabilityOf(result(1, `ERROR\n  ${UNRECOGNIZED_STANDALONE} in command opencode debug agents`))).toBe('unverifiable')
  })

  it('다른 실패는 판정 실패다 — "못 묻는다"로 치지 않는다', () => {
    // 섞으면 시간 초과 한 번이 읽기 전용을 막거나, 반대로 진짜 오류가 "전체 허용만"으로 뭉개진다
    expect(capabilityOf(result(1, 'ERROR\n  something else'))).toBeNull()
    expect(capabilityOf(result(null, UNRECOGNIZED_STANDALONE))).toBeNull()
    expect(capabilityOf(result(2))).toBeNull()
  })
})

describe('2.x 확인기 (opencode-v2 spec FR-8·8a·10·14)', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  /** 캐시의 열쇠가 (경로, 크기, mtime)이라 진짜 파일이 있어야 한다 */
  function realFile(): string {
    const dir = mkdtempSync(join(tmpdir(), 'one-desk-oc-v2-'))
    dirs.push(dir)
    const file = join(dir, 'opencode')
    writeFileSync(file, 'bin')
    return file
  }

  const v2Input = (over: Partial<VerifyRunnableInput> = {}): VerifyRunnableInput => ({
    executable: realFile(), cwd: '/tmp/work', permission: 'read_only',
    dialect: 'v2', model: null, effort: null, resumeSessionId: null, ...over
  })

  const ok = (stdout: string): CliResult => ({ exitCode: 0, stdout, stderr: '' })
  const goodAgents = (p: VerifyRunnableInput['permission']) =>
    ok(agentsOutput([...HEAD, ...show(opencodeV2Rules(p)), ...show(opencodeV2Rules(p)), ...TAIL]))
  const UNVERIFIABLE: CliResult = { exitCode: 1, stdout: '', stderr: `ERROR\n  ${UNRECOGNIZED_STANDALONE} in command opencode debug agents` }

  /** 인자의 첫 낱말로 갈라 답하는 가짜 실행 */
  function execWith(answers: { agents?: CliResult; session?: CliResult }) {
    return vi.fn<CliExec>(async ({ args }) => {
      if (args[0] === 'debug') return answers.agents ?? { exitCode: null, stdout: '', stderr: '' }
      if (args[0] === 'api') return answers.session ?? { exitCode: null, stdout: '', stderr: '' }
      throw new Error(`예상하지 못한 호출: ${args.join(' ')}`)
    })
  }

  it('해결된 규칙이 맞으면 통과한다 — 사설 서버로, run과 같은 환경·cwd로 묻는다', async () => {
    const exec = execWith({ agents: goodAgents('read_only') })
    const given = v2Input()
    await expect(opencodeAdapter.verifyRunnable(given, undefined, createOpencodeV2Verifier(exec))).resolves.toEqual({ ok: true })

    const call = exec.mock.calls[0]![0]
    expect(call.args).toEqual(['debug', 'agents', '--standalone'])
    expect(call.cwd).toBe('/tmp/work')
    expect(call.executable).toBe(given.executable)
    // run이 쓸 것과 같은 규칙이어야 확인이 의미를 갖는다
    expect(JSON.parse(call.env['OPENCODE_CONFIG_CONTENT']!)).toEqual(opencodeV2Config('read_only'))
    expect(call.env['OPENCODE_PERMISSION']).toBeUndefined()
  })

  it('뒤에 allow가 붙은 설정이면 실행을 막는다', async () => {
    const sent = show(opencodeV2Rules('read_only'))
    const exec = execWith({ agents: ok(agentsOutput([...HEAD, ...sent, r('shell', '*', 'allow'), ...TAIL])) })
    const result = await createOpencodeV2Verifier(exec).verify(v2Input(), {})
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('shell * allow')
  })

  it('확인할 수 없는 바이너리는 읽기 전용·편집 허용을 막는다 — 조용히 올리지 않는다 (FR-8a)', async () => {
    for (const permission of ['read_only', 'edit'] as const) {
      const result = await createOpencodeV2Verifier(execWith({ agents: UNVERIFIABLE })).verify(v2Input({ permission }), {})
      expect(result, permission).toEqual({ ok: false, reason: UNVERIFIABLE_REASON })
    }
  })

  it('확인할 수 없는 바이너리도 전체 허용은 돈다 — 열릴 것이 없다', async () => {
    const result = await createOpencodeV2Verifier(execWith({ agents: UNVERIFIABLE })).verify(v2Input({ permission: 'full' }), {})
    expect(result).toEqual({ ok: true })
  })

  it('판정 실패(시간 초과·다른 오류)는 전체 허용이어도 막는다 — "못 묻는다"가 아니다', async () => {
    // 셋째: 실패한 명령이 그럴듯한 목록을 찍었어도 믿지 않는다
    const failedButPlausible = { ...goodAgents('full'), exitCode: 1, stderr: 'boom' }
    for (const agents of [{ exitCode: null, stdout: '', stderr: '' }, { exitCode: 1, stdout: '', stderr: 'boom' }, failedButPlausible]) {
      const result = await createOpencodeV2Verifier(execWith({ agents })).verify(v2Input({ permission: 'full' }), {})
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('확인하지 못했습니다')
    }
  })

  it('"확인할 수 없다"는 기억한다 — 같은 바이너리를 다시 띄우지 않는다', async () => {
    const exec = execWith({ agents: UNVERIFIABLE })
    const verifier = createOpencodeV2Verifier(exec)
    const executable = realFile()
    await verifier.verify(v2Input({ executable, permission: 'full' }), {})
    await verifier.verify(v2Input({ executable, permission: 'full' }), {})
    await expect(verifier.capability(executable, '/tmp', {})).resolves.toBe('unverifiable')
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('"확인할 수 있다"와 판정 실패는 기억하지 않는다 — 규칙은 턴마다 다시 읽는다', async () => {
    const exec = vi.fn<CliExec>()
      .mockResolvedValueOnce({ exitCode: null, stdout: '', stderr: '' })
      .mockResolvedValue(goodAgents('read_only'))
    const verifier = createOpencodeV2Verifier(exec)
    const executable = realFile()
    expect((await verifier.verify(v2Input({ executable }), {})).ok).toBe(false)
    expect((await verifier.verify(v2Input({ executable }), {})).ok).toBe(true)
    expect((await verifier.verify(v2Input({ executable }), {})).ok).toBe(true)
    expect(exec).toHaveBeenCalledTimes(3)
  })

  it('variant만 있고 모델이 없으면 묻기 전에 막는다 (FR-10)', async () => {
    const exec = execWith({ agents: goodAgents('read_only') })
    const result = await createOpencodeV2Verifier(exec).verify(v2Input({ effort: 'high' }), {})
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('모델')
    expect(exec).not.toHaveBeenCalled()
  })

  describe('이어 가는 턴의 세션 (FR-14)', () => {
    const MISSING: CliResult = {
      exitCode: 1,
      stdout: '{"_tag":"SessionNotFoundError","sessionID":"ses_x","message":"Session not found: ses_x"}',
      stderr: 'HTTP 404 Not Found'
    }

    it('세션이 있으면 통과하고, 사설 서버로 그 id를 묻는다', async () => {
      const exec = execWith({ agents: goodAgents('read_only'), session: ok('{"data":{"id":"ses_x"}}') })
      const result = await createOpencodeV2Verifier(exec).verify(v2Input({ resumeSessionId: 'ses_x' }), {})
      expect(result).toEqual({ ok: true })
      expect(exec.mock.calls[1]![0].args).toEqual(['api', '--standalone', 'session.get', '--param', 'sessionID=ses_x'])
    })

    it('세션이 없으면 실행을 막는다 — 2.3.2는 없는 id로 새 세션을 만든다', async () => {
      const exec = execWith({ agents: goodAgents('read_only'), session: MISSING })
      const result = await createOpencodeV2Verifier(exec).verify(v2Input({ resumeSessionId: 'ses_x' }), {})
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('이어받을 세션이 없습니다')
    })

    it('세션 조회가 다른 이유로 실패해도 막는다', async () => {
      const exec = execWith({ agents: goodAgents('read_only'), session: { exitCode: null, stdout: '', stderr: '' } })
      const result = await createOpencodeV2Verifier(exec).verify(v2Input({ resumeSessionId: 'ses_x' }), {})
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('확인하지 못했습니다')
    })

    it('확인할 수 없는 바이너리도 세션은 본다', async () => {
      const exec = execWith({ agents: UNVERIFIABLE, session: MISSING })
      const result = await createOpencodeV2Verifier(exec).verify(v2Input({ permission: 'full', resumeSessionId: 'ses_x' }), {})
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('이어받을 세션이 없습니다')
    })

    it('이을 세션이 없으면 묻지 않는다', async () => {
      const exec = execWith({ agents: goodAgents('read_only') })
      await createOpencodeV2Verifier(exec).verify(v2Input(), {})
      expect(exec).toHaveBeenCalledTimes(1)
    })
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
        executable: file, cwd: tmpdir(), permission: 'edit', dialect: 'v1', model: null, effort: null, resumeSessionId: null
      })
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('webfetch')
    } finally {
      if (previous === undefined) delete process.env['ONE_DESK_AGENT_LAUNCHER']
      else process.env['ONE_DESK_AGENT_LAUNCHER'] = previous
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('2.x의 기본 실행도 런처로 띄우고 stdin을 닫는다 — 가짜가 받은 규칙을 되돌려 준다', async () => {
    // stdin을 닫지 않으면 이 스크립트는 끝나지 않아 20초 타임아웃까지 매달렸다가 "확인하지 못했습니다"가 된다.
    const dir = mkdtempSync(join(tmpdir(), 'one-desk-oc-verify-v2-'))
    const file = join(dir, 'fake-v2.mjs')
    writeFileSync(file, [
      'process.stdin.resume()',
      "process.stdin.on('end', () => {",
      "  const sent = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT).agents.build.permissions",
      "  process.stdout.write(JSON.stringify([{ id: 'build', permissions: [{ action: '*', resource: '*', effect: 'allow' }, ...sent] }]))",
      '})'
    ].join('\n'), { mode: 0o644 })

    const previous = process.env['ONE_DESK_AGENT_LAUNCHER']
    process.env['ONE_DESK_AGENT_LAUNCHER'] = process.execPath
    try {
      const started = Date.now()
      const result = await opencodeAdapter.verifyRunnable({
        executable: file, cwd: tmpdir(), permission: 'read_only', dialect: 'v2', model: null, effort: null, resumeSessionId: null
      })
      expect(result).toEqual({ ok: true })
      expect(Date.now() - started).toBeLessThan(10_000)
    } finally {
      if (previous === undefined) delete process.env['ONE_DESK_AGENT_LAUNCHER']
      else process.env['ONE_DESK_AGENT_LAUNCHER'] = previous
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('opencodeAdapter.statusNote — 설정 화면의 안내 (opencode-v2 spec FR-8a)', () => {
  const verifier = (capability: 'verifiable' | 'unverifiable' | null) => ({
    verify: vi.fn(async () => ({ ok: true })),
    capability: vi.fn(async () => capability)
  })
  const V2 = { ok: true, executable: '/bin/opencode', dialect: 'v2' as const }

  it('확인할 수 없는 2.x면 전체 허용만 된다고 미리 말한다', async () => {
    await expect(opencodeAdapter.statusNote(V2, verifier('unverifiable'))).resolves.toContain('전체 허용만')
  })

  it('확인할 수 있거나 판정하지 못했으면 안내가 없다', async () => {
    await expect(opencodeAdapter.statusNote(V2, verifier('verifiable'))).resolves.toBeNull()
    await expect(opencodeAdapter.statusNote(V2, verifier(null))).resolves.toBeNull()
  })

  it('1.x와 실패한 preflight에는 묻지도 않는다', async () => {
    const v = verifier('unverifiable')
    await expect(opencodeAdapter.statusNote({ ok: true, executable: '/bin/opencode', dialect: 'v1' }, v)).resolves.toBeNull()
    await expect(opencodeAdapter.statusNote({ ok: false, reason: '없음' }, v)).resolves.toBeNull()
    expect(v.capability).not.toHaveBeenCalled()
  })
})
