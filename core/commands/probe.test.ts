import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { probeCommands } from './probe'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const FAKE = resolve(HERE, '../runner/fixtures/fake-claude.mjs')

/**
 * 여기의 CLI들은 shebang이 달린 스크립트를 실행 파일로 직접 spawn한다.
 * Windows에는 shebang 실행이 없어 성립하지 않는다 — fixtures.test.ts와 같은 규칙으로 스킵한다.
 * "실행 파일 없음"만은 아무것도 띄우지 않으므로 모든 플랫폼에서 돈다.
 */
const POSIX_ONLY = process.platform === 'win32'

let dir: string
let cliCount = 0

/** 줄 몇 개를 뱉고 원하는 대로 끝나는 가짜 CLI를 만든다. probe는 실행 파일 경로만 받으므로 진짜로 띄운다. */
function writeCli(body: string): string {
  const file = join(dir, `cli-${cliCount++}.mjs`)
  writeFileSync(file, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 })
  return file
}

function emitLine(obj: unknown): string {
  return `process.stdout.write(${JSON.stringify(JSON.stringify(obj) + '\n')})`
}

/** 전역 env를 건드리는 테스트가 되돌릴 값. probe는 `{ ...process.env }`를 그대로 넘긴다. */
const ENV_KEYS = ['ONE_DESK_FAKE_DELAY_MS', 'ONE_DESK_PROBE_MARKER', 'ONE_DESK_PROBE_ENV_MARK'] as const
let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'one-desk-probe-'))
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  rmSync(dir, { recursive: true, force: true })
})

const EMPTY = { slashCommands: [], terminalSlashCommands: [], plugins: [] }

describe.skipIf(POSIX_ONLY)('probeCommands — init 수신 후 즉시 종료 (FR-10)', () => {
  it('init의 목록을 돌려주고 프로세스를 즉시 죽인다 — 마커 파일이 생기지 않는다', async () => {
    // 픽스처는 init 200ms 뒤 마커를 쓴다. 결과를 1초 늦춰 픽스처가 마커 타이머보다 오래
    // 살게 해야 "죽였다"와 "저절로 끝났다"가 갈린다.
    const marker = join(dir, 'marker')
    process.env['ONE_DESK_FAKE_DELAY_MS'] = '1000'
    process.env['ONE_DESK_PROBE_MARKER'] = marker

    const result = await probeCommands({ executable: FAKE, cwd: dir })

    expect(result).toEqual({
      slashCommands: ['code-review', 'compact', 'doctor', 'color', 'reload-plugins', 'pinetest'],
      terminalSlashCommands: ['doctor', 'color', 'reload-plugins'],
      plugins: [],
      error: null
    })
    // 마커 타이머(200ms)가 충분히 지난 뒤에 본다. 안 죽였으면 여기서 파일이 있다.
    await new Promise((r) => setTimeout(r, 400))
    expect(existsSync(marker)).toBe(false)
  })

  it('SIGTERM을 무시하는 CLI도 init 직후 강제로 종료한다', async () => {
    const marker = join(dir, 'ignored-sigterm')
    const cli = writeCli(`
      import { writeFileSync } from 'node:fs'
      process.on('SIGTERM', () => {})
      ${emitLine({ type: 'system', subtype: 'init', slash_commands: ['review'] })}
      setTimeout(() => writeFileSync(${JSON.stringify(marker)}, ''), 100)
      setTimeout(() => {}, 1000)
    `)
    const result = await probeCommands({ executable: cli, cwd: dir })
    expect(result.error).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(existsSync(marker)).toBe(false)
  })

  it('실행 파일과 인자를 그대로 쓴다 — -p, stream-json, --verbose, --tools "", --strict-mcp-config', async () => {
    // 픽스처가 받은 argv를 init에 되비춘다. --verbose가 빠지면 진짜 CLI가 실행을 거부하고,
    // --tools ""가 빠지면 도구가 살아나며(NFR-3), --strict-mcp-config가 빠지면 사용자의 개인
    // MCP 서버가 probe마다 뜬다(실측: init 5.82s→1.16s). --mcp-config는 넘기지 않는다.
    const cli = writeCli(`
      process.stdout.write(JSON.stringify({
        type: 'system', subtype: 'init', slash_commands: process.argv.slice(2)
      }) + '\\n')
      setTimeout(() => {}, 5000)
    `)

    const result = await probeCommands({ executable: cli, cwd: dir })

    expect(result.slashCommands).toEqual(
      ['-p', '--output-format', 'stream-json', '--verbose', '--tools', '', '--strict-mcp-config']
    )
  })

  it('cwd와 env를 그대로 넘긴다 — 디렉토리별 목록(FR-12)은 이 배선 하나에 달려 있다', async () => {
    // CLI가 자기 cwd와 표식 env를 init에 되비춘다. cwd를 안 넘기면 vitest 워커의 cwd(repo 루트)가
    // 되고, env를 비우면 표식이 사라진다. macOS는 tmpdir이 /var → /private/var 심볼릭 링크라
    // realpath로 비교해야 한다.
    const work = join(dir, 'work')
    mkdirSync(work)
    process.env['ONE_DESK_PROBE_ENV_MARK'] = '표식-' + cliCount
    const cli = writeCli(`
      process.stdout.write(JSON.stringify({
        type: 'system', subtype: 'init',
        slash_commands: [process.cwd(), process.env.ONE_DESK_PROBE_ENV_MARK ?? '(없음)']
      }) + '\\n')
      setTimeout(() => {}, 5000)
    `)

    const result = await probeCommands({ executable: cli, cwd: work })

    expect(result.slashCommands).toEqual([realpathSync(work), process.env['ONE_DESK_PROBE_ENV_MARK']])
  })

  it('stdin을 닫는다 — 안 닫으면 CLI가 3초를 기다린다', async () => {
    // stdin이 끝나야 init을 뱉는 CLI. 닫지 않으면 타임아웃까지 아무것도 못 받는다.
    const cli = writeCli(`
      let prompt = ''
      process.stdin.on('data', (c) => { prompt += c })
      process.stdin.on('end', () => {
        process.stdout.write(JSON.stringify({
          type: 'system', subtype: 'init', slash_commands: [prompt]
        }) + '\\n')
        setTimeout(() => {}, 5000)
      })
    `)

    const result = await probeCommands({ executable: cli, cwd: dir, timeoutMs: 2000 })

    expect(result.slashCommands).toEqual(['hi'])
  })
})

describe.skipIf(POSIX_ONLY)('probeCommands — 실패 내성 (NFR-2)', () => {
  it('init 없이 끝나면 던지지 않고 빈 목록과 사유를 준다', async () => {
    const cli = writeCli(`
      ${emitLine({ type: 'assistant', message: { content: [] } })}
      process.stderr.write('로그인이 필요합니다')
      process.exitCode = 3
    `)

    const result = await probeCommands({ executable: cli, cwd: dir })

    expect(result).toMatchObject(EMPTY)
    expect(result.error).toContain('init')
    expect(result.error).toContain('로그인이 필요합니다')
  })

  it('깨진 JSON 줄은 건너뛰고 뒤에 오는 init을 잡는다', async () => {
    // 한 번의 write로 보낸다 — 청크 하나 안에서 깨진 줄이 던지면 뒤의 init까지 잃는다.
    const init = JSON.stringify({ type: 'system', subtype: 'init', slash_commands: ['살아남음'] })
    const cli = writeCli(`process.stdout.write('이건 JSON이 아니다\\n{깨짐\\n' + ${JSON.stringify(init)} + '\\n')`)

    const result = await probeCommands({ executable: cli, cwd: dir })

    expect(result.slashCommands).toEqual(['살아남음'])
    expect(result.error).toBeNull()
  })

  it('init에 없는 필드는 빈 배열로 본다', async () => {
    const cli = writeCli(`
      ${emitLine({ type: 'system', subtype: 'init', session_id: 's' })}
      setTimeout(() => {}, 5000)
    `)

    const result = await probeCommands({ executable: cli, cwd: dir })

    expect(result).toEqual({ ...EMPTY, error: null })
  })

  it('init 필드의 모양이 다르면 맞는 항목만 남긴다', async () => {
    // 이름이 문자열이 아니거나 플러그인에 name·path가 없으면 버린다. 던지지 않는다.
    const cli = writeCli(`
      ${emitLine({
        type: 'system', subtype: 'init',
        slash_commands: ['좋음', 7, null],
        terminal_slash_commands: '문자열',
        plugins: [{ name: '초능력', path: '/p/초능력' }, { name: '경로없음' }, '문자열', null]
      })}
      setTimeout(() => {}, 5000)
    `)

    const result = await probeCommands({ executable: cli, cwd: dir })

    expect(result).toEqual({
      slashCommands: ['좋음'],
      terminalSlashCommands: [],
      plugins: [{ name: '초능력', path: '/p/초능력' }],
      error: null
    })
  })

  it('타임아웃이 지나면 프로세스를 죽이고 빈 목록과 사유를 준다', async () => {
    // init을 영영 안 뱉는 CLI. 기본 10초를 기다릴 수 없으니 짧게 준다 — 타이머가 빠지면
    // 프로세스가 60초를 살아 vitest의 5초 제한에 걸린다.
    const cli = writeCli('setTimeout(() => {}, 60000)')

    const result = await probeCommands({ executable: cli, cwd: dir, timeoutMs: 300 })

    expect(result).toMatchObject(EMPTY)
    expect(result.error).toContain('시간이 초과')
  })

  it('타임아웃이 지나면 프로세스가 정말 죽는다 — 마커 파일이 생기지 않는다', async () => {
    // init 직후 경로의 마커 테스트와 대칭이다. init을 절대 안 뱉고 300ms 뒤 마커를 쓰는 CLI를
    // 100ms에 타임아웃시킨다. 타임아웃 경로에서 안 죽이면 자식이 살아남아 마커를 쓴다 —
    // 반환값만 봐서는 그 차이가 안 보인다.
    const marker = join(dir, 'timeout-marker')
    const cli = writeCli(`
      import { writeFileSync } from 'node:fs'
      setTimeout(() => writeFileSync(${JSON.stringify(marker)}, ''), 300)
    `)

    const result = await probeCommands({ executable: cli, cwd: dir, timeoutMs: 100 })

    expect(result.error).toContain('시간이 초과')
    // 마커 타이머(300ms)가 node 부팅을 더해도 충분히 지난 뒤에 본다.
    await new Promise((r) => setTimeout(r, 700))
    expect(existsSync(marker)).toBe(false)
  })
})

describe('probeCommands — 실행 파일 없음 (모든 플랫폼)', () => {
  it('실행 파일이 없으면 던지지 않고 빈 목록과 사유를 준다', async () => {
    const result = await probeCommands({ executable: join(dir, '없는-실행-파일'), cwd: dir })

    expect(result).toMatchObject(EMPTY)
    expect(result.error).toBeTypeOf('string')
  })

  it('spawn이 동기로 던져도 던지지 않는다', async () => {
    // 빈 경로는 spawn이 'error' 이벤트가 아니라 그 자리에서 던진다. Windows의 .cmd(EINVAL)가
    // 같은 길을 탄다 — 개발 장비에서 .cmd를 만들 수 없어 이 경로로 그 분기를 고정한다.
    const result = await probeCommands({ executable: '', cwd: dir })

    expect(result).toMatchObject(EMPTY)
    expect(result.error).toBeTypeOf('string')
  })
})
