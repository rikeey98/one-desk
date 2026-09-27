import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  opencodeAdapter, createVersionGate, parseOpencodeVersion, type VersionReader
} from './opencode'

/**
 * OpenCode 버전 게이트 (`docs/sdlc/conversation-fixes/` spec FR-17).
 *
 * 2.x CLI(데스크톱 번들 `opencode-cli.exe` 2.0.18)는 `--variant`가 없고 바이너리에
 * `OPENCODE_PERMISSION` 문자열이 없다 — 우리가 넘기는 권한 정책이 조용히 무시될 수 있어
 * 읽기 전용 run이 파일을 고칠 수 있다. 그래서 실행 전에(preflight) 막는다.
 */

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeFile(content = 'bin'): string {
  const dir = mkdtempSync(join(tmpdir(), 'od-version-'))
  dirs.push(dir)
  const file = join(dir, 'opencode')
  writeFileSync(file, content, { mode: 0o755 })
  return file
}

function reader(output: string | null) {
  return vi.fn<VersionReader>(async () => output)
}

describe('parseOpencodeVersion', () => {
  it.each([
    ['1.18.30\n', 1],
    ['2.0.18', 2],
    ['opencode 2.0.18\n', 2],
    ['v1.18.27', 1],
    ['\n  1.18.27  \n', 1]
  ])('%j에서 major %d를 읽는다', (output, major) => {
    expect(parseOpencodeVersion(output)?.major).toBe(major)
  })

  it.each([
    [''],
    ['error: unknown option --version'],
    ['{"type":"step_start","timestamp":1727000000000}'],
    ['사용법: opencode [명령]']
  ])('버전으로 읽을 수 없는 출력 %j는 null이다', (output) => {
    expect(parseOpencodeVersion(output)).toBeNull()
  })

  it('첫 줄만 본다 — 뒤 줄의 숫자를 버전으로 오인하지 않는다', () => {
    expect(parseOpencodeVersion('무엇인가 잘못됐다\n2.0.18')).toBeNull()
  })
})

describe('createVersionGate', () => {
  it('major가 2 이상이면 거부하고 이유에 버전과 경로를 싣는다', async () => {
    const file = makeFile()
    const gate = createVersionGate(reader('2.0.18\n'))
    const reason = await gate(file)
    expect(reason).toContain('2.x')
    expect(reason).toContain('2.0.18')
    expect(reason).toContain(file)
    expect(reason).toContain('1.x')
  })

  it('1.x는 통과시킨다', async () => {
    const gate = createVersionGate(reader('1.18.30'))
    await expect(gate(makeFile())).resolves.toBeNull()
  })

  it('--thinking이 없는 1.1.49 이하는 거부한다 — 모르는 옵션이라 모든 run이 시작하자마자 죽는다', async () => {
    // 리뷰 반영 2026-09-27: buildCommand가 늘 `--thinking`을 붙인다(conversation-events FR-21). 그 옵션은
    // 1.1.50에서 생겼고, 1.0.0부터 yargs `.strict()`라 모르는 옵션이면 도움말을 찍고 exit 1이다.
    const file = makeFile()
    for (const old of ['1.1.49', '1.0.0', '0.9.3']) {
      const reason = await createVersionGate(reader(old))(file)
      expect(reason, old).toContain(old)
      expect(reason, old).toContain('1.1.50')
      expect(reason, old).toContain(file)
    }
    await expect(createVersionGate(reader('1.1.50'))(file)).resolves.toBeNull()
    await expect(createVersionGate(reader('1.2.0'))(file)).resolves.toBeNull()
  })

  it('버전을 못 읽으면 막지 않는다 — 지금 동작 그대로다', async () => {
    await expect(createVersionGate(reader(null))(makeFile())).resolves.toBeNull()
    await expect(createVersionGate(reader('알 수 없는 출력'))(makeFile())).resolves.toBeNull()
    const throwing = vi.fn<VersionReader>(async () => { throw new Error('spawn 실패') })
    await expect(createVersionGate(throwing)(makeFile())).resolves.toBeNull()
  })

  it('못 읽은 판정은 캐시하지 않는다 — 한 번의 시간 초과가 2.x 차단을 꺼 두면 안 된다', async () => {
    // Windows에서는 새 바이너리의 첫 실행이 백신 검사로 5초를 넘기기 쉽다. 그 "통과"를
    // 캐시하면 그 2.x는 앱을 다시 켤 때까지 읽기 전용 run으로 파일을 고칠 수 있다.
    const file = makeFile()
    const read = vi.fn<VersionReader>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('2.0.18')
    const gate = createVersionGate(read)

    await expect(gate(file)).resolves.toBeNull()
    await expect(gate(file)).resolves.toContain('2.x')
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('읽기가 던져도 캐시하지 않는다', async () => {
    const file = makeFile()
    const read = vi.fn<VersionReader>()
      .mockRejectedValueOnce(new Error('spawn 실패'))
      .mockResolvedValueOnce('2.0.18')
    const gate = createVersionGate(read)

    await expect(gate(file)).resolves.toBeNull()
    await expect(gate(file)).resolves.toContain('2.x')
  })

  it('못 읽는 중에 동시에 들어온 조회는 그 한 번을 나눠 쓴다', async () => {
    // 캐시하지 않는 것은 "끝난 뒤"다. 도는 동안까지 새로 띄우면 checkAgents 한 번에
    // 프로세스가 여럿 뜬다.
    const file = makeFile()
    // 진짜 `--version`처럼 시간이 걸리는 읽기다 — 즉시 끝나는 가짜로는 "도는 동안"이 없다.
    let finish: (output: string | null) => void = () => {}
    const read = vi.fn<VersionReader>(() => new Promise((r) => { finish = r }))
    const gate = createVersionGate(read)

    const first = gate(file)
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    const second = gate(file)
    // 두 번째 조회의 stat이 끝나 도는 판정에 붙을 때까지 기다린다.
    await new Promise((r) => setTimeout(r, 50))
    finish(null)

    await expect(Promise.all([first, second])).resolves.toEqual([null, null])
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('버전이 아닌 출력은 캐시한다 — 같은 바이너리는 같은 것을 찍는다', async () => {
    const file = makeFile()
    const read = reader('알 수 없는 출력')
    const gate = createVersionGate(read)
    await gate(file)
    await gate(file)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('파일이 없으면 읽지 않고 통과시킨다 — 실행 파일 확인은 preflight 앞단의 몫이다', async () => {
    const read = reader('2.0.18')
    await expect(createVersionGate(read)(join(tmpdir(), '없는-opencode-xyz'))).resolves.toBeNull()
    expect(read).not.toHaveBeenCalled()
  })

  it('(경로, 크기, mtime)가 같으면 다시 띄우지 않는다', async () => {
    // 설정 화면의 checkAgents가 workspace를 고를 때마다 프로세스를 띄우면 안 된다.
    const file = makeFile()
    const read = reader('1.18.30')
    const gate = createVersionGate(read)
    await gate(file)
    await gate(file)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('동시에 불러도 한 번만 띄운다', async () => {
    // checkAgents는 두 agent를, probeAgents는 같은 preflight를 동시에 부른다.
    const file = makeFile()
    const read = reader('1.18.30')
    const gate = createVersionGate(read)
    await Promise.all([gate(file), gate(file), gate(file)])
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('크기가 바뀌면 다시 읽는다 — 설치본을 갈아끼운 것이다', async () => {
    const file = makeFile('1.x 바이너리')
    const read = vi.fn<VersionReader>()
      .mockResolvedValueOnce('1.18.30')
      .mockResolvedValueOnce('2.0.18')
    const gate = createVersionGate(read)
    await expect(gate(file)).resolves.toBeNull()

    writeFileSync(file, '2.x 바이너리 — 더 길다')
    await expect(gate(file)).resolves.toContain('2.x')
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('크기가 같아도 mtime이 바뀌면 다시 읽는다', async () => {
    const file = makeFile()
    const read = reader('1.18.30')
    const gate = createVersionGate(read)
    await gate(file)

    const before = statSync(file).mtime
    const later = new Date(before.getTime() + 60_000)
    utimesSync(file, later, later)
    await gate(file)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('경로가 다르면 따로 본다', async () => {
    const read = reader('1.18.30')
    const gate = createVersionGate(read)
    await gate(makeFile())
    await gate(makeFile())
    expect(read).toHaveBeenCalledTimes(2)
  })
})

describe('opencodeAdapter.preflight — 버전 게이트', () => {
  it('실행 파일이 2.x면 거부한다', async () => {
    const file = makeFile()
    const result = await opencodeAdapter.preflight(file, {
      versionGate: createVersionGate(reader('2.0.18'))
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('2.x')
  })

  it('1.x면 그 실행 파일을 그대로 쓴다', async () => {
    const file = makeFile()
    const result = await opencodeAdapter.preflight(file, {
      versionGate: createVersionGate(reader('1.18.30'))
    })
    expect(result).toEqual({ ok: true, executable: file })
  })

  it('PATH에서 찾은 실행 파일도 게이트를 지난다', async () => {
    // 명시 경로와 탐색 두 갈래가 합류한 뒤에 본다 — 한쪽에만 두면 다른 쪽이 새어나간다.
    const dir = mkdtempSync(join(tmpdir(), 'od-version-path-'))
    dirs.push(dir)
    const name = process.platform === 'win32' ? 'opencode.exe' : 'opencode'
    const file = join(dir, name)
    writeFileSync(file, 'bin', { mode: 0o755 })
    const gate = vi.fn(async () => '막았다')

    const result = await opencodeAdapter.preflight(null, {
      // 후보 이름이 PATHEXT의 대소문자를 그대로 따른다 — 위에서 만든 파일 이름과 맞춘다.
      env: { PATH: dir, PATHEXT: '.exe' },
      versionGate: gate
    })

    expect(gate).toHaveBeenCalledWith(file)
    expect(result).toEqual({ ok: false, reason: '막았다' })
  })

  it('.cmd shim은 버전을 읽기 전에 거부한다 — shell 없이는 띄울 수 없다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'od-version-cmd-'))
    dirs.push(dir)
    const shim = join(dir, 'opencode.cmd')
    writeFileSync(shim, '', { mode: 0o755 })
    const gate = vi.fn(async () => null)

    const result = await opencodeAdapter.preflight(shim, { versionGate: gate })

    expect(result.ok).toBe(false)
    expect(gate).not.toHaveBeenCalled()
  })
})

describe('opencodeAdapter.preflight — 기본 버전 읽기', () => {
  /**
   * **배선 잠금.** 위 시나리오들은 게이트를 주입하므로 기본 읽기가 실제로 무엇을 띄우는지는
   * 보지 않는다. 여기서는 진짜로 띄운다 — 실행 권한도 셔뱅도 없는 `.mjs`라
   * `agentCommand`를 거치지 않으면 어느 OS에서도 뜨지 않고, 그러면 "못 읽음 → 통과"가 되어
   * 이 테스트가 빨개진다. 스크립트는 stdin이 닫힐 때까지 기다린다 — 읽는 쪽이 stdin을
   * 닫지 않으면 타임아웃까지 매달렸다가 역시 통과로 떨어진다.
   */
  it('ONE_DESK_AGENT_LAUNCHER로 --version을 띄워 2.x를 거부한다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'od-version-real-'))
    dirs.push(dir)
    const file = join(dir, 'opencode-2.mjs')
    writeFileSync(file, [
      'process.stdin.resume()',
      "process.stdin.on('end', () => {",
      "  if (process.argv.includes('--version')) process.stdout.write('2.0.18\\n')",
      '})'
    ].join('\n'), { mode: 0o644 })

    const previous = process.env['ONE_DESK_AGENT_LAUNCHER']
    process.env['ONE_DESK_AGENT_LAUNCHER'] = process.execPath
    try {
      const started = Date.now()
      const result = await opencodeAdapter.preflight(file)
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('2.0.18')
      // 타임아웃으로 끝난 것이 아니다 — stdin을 닫아 곧바로 답을 받았다.
      expect(Date.now() - started).toBeLessThan(4_000)
    } finally {
      if (previous === undefined) delete process.env['ONE_DESK_AGENT_LAUNCHER']
      else process.env['ONE_DESK_AGENT_LAUNCHER'] = previous
    }
  })
})
