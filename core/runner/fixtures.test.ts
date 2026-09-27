import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { opencodeAdapter, parseOpencodeVersion } from './adapters/opencode'
import { claudeCodeAdapter } from './adapters/claudeCode'
import type { ResolvedRunSpec } from './types'

const HERE = dirname(fileURLToPath(import.meta.url))
const FAKE = resolve(HERE, 'fixtures/fake-claude.mjs')
const FAKE_MCP = resolve(HERE, 'fixtures/fake-claude-mcp.mjs')
const FAKE_OPENCODE = resolve(HERE, 'fixtures/fake-opencode.mjs')

/**
 * 이 픽스처들은 shebang이 달린 .mjs 파일이고, e2e가 실행 파일로 직접 spawn한다.
 * Windows에는 실행 비트도 shebang 실행도 없어 두 검사 모두 성립하지 않는다.
 * e2e(`pnpm test:e2e`)는 개발 장비에서만 도는 것이 전제이므로 여기서 스킵한다.
 */
const POSIX_ONLY = process.platform === 'win32'

describe.skipIf(POSIX_ONLY)('fake-claude-mcp.mjs', () => {
  it('실행 권한을 갖는다', () => {
    // 앱은 이 파일을 executable로 spawn한다. preflight의 access(X_OK)가 먼저 막는다.
    expect(statSync(FAKE_MCP).mode & 0o111).toBeGreaterThan(0)
  })
})

describe.skipIf(POSIX_ONLY)('fake-claude.mjs', () => {
  it('실행 권한을 갖는다', () => {
    // 앱은 이 파일을 executable로 spawn한다. preflight의 access(X_OK)가 먼저 막는다.
    expect(statSync(FAKE).mode & 0o111).toBeGreaterThan(0)
  })

  it('직접 실행하면 stream-json을 낸다', () => {
    const out = execFileSync(FAKE, [], { input: '', encoding: 'utf8' })
    const lines = out.trim().split('\n')
    expect(lines.length).toBeGreaterThan(1)
    expect(JSON.parse(lines[0]!)).toMatchObject({ type: 'system', subtype: 'init' })
  })

  it('ONE_DESK_FAKE_DELAY_MS만큼 결과를 늦춘다', () => {
    // e2e가 running 상태를 관찰하려면 즉시 끝나면 안 된다.
    const started = Date.now()
    execFileSync(FAKE, [], {
      input: '', encoding: 'utf8',
      env: { ...process.env, ONE_DESK_FAKE_DELAY_MS: '300' }
    })
    expect(Date.now() - started).toBeGreaterThanOrEqual(300)
  })

  it('init에 슬래시 커맨드 목록과 플러그인을 싣는다', () => {
    // 시나리오를 가르지 않고 모든 init에 싣는다 — e2e 드라이버는 --scenario를 못 넘기고
    // 기본 픽스처를 그대로 spawn하므로, 시나리오로 가르면 e2e에서 피커가 빈다.
    const out = execFileSync(FAKE, [], { input: '', encoding: 'utf8' })
    const init = JSON.parse(out.split('\n')[0]!) as Record<string, unknown>
    expect(init['slash_commands']).toEqual(
      ['code-review', 'compact', 'doctor', 'color', 'reload-plugins', 'pinetest']
    )
    expect(init['terminal_slash_commands']).toEqual(['doctor', 'color', 'reload-plugins'])
    expect(init['plugins']).toEqual([])
  })

  it('ONE_DESK_PROBE_MARKER가 있으면 init 200ms 뒤 그 경로에 파일을 만든다', () => {
    // probe 테스트의 "모델 호출이 나갔다" 신호다. probe가 init 직후 죽이면 이 파일은 없어야 한다.
    const dir = mkdtempSync(join(tmpdir(), 'one-desk-marker-'))
    try {
      const marker = join(dir, 'marker')
      const started = Date.now()
      execFileSync(FAKE, [], {
        input: '', encoding: 'utf8',
        env: { ...process.env, ONE_DESK_PROBE_MARKER: marker }
      })
      expect(existsSync(marker)).toBe(true)
      expect(Date.now() - started).toBeGreaterThanOrEqual(200)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe.skipIf(POSIX_ONLY)('fake-opencode.mjs', () => {
  it('실행 권한을 갖는다', () => {
    expect(statSync(FAKE_OPENCODE).mode & 0o111).toBeGreaterThan(0)
  })

  it('직접 실행하면 opencode 형식 NDJSON을 낸다', () => {
    const out = execFileSync(FAKE_OPENCODE, [], { input: '', encoding: 'utf8' })
    const lines = out.trim().split('\n')
    expect(lines.length).toBeGreaterThan(1)
    const first = JSON.parse(lines[0]!) as { type: string; sessionID: string }
    expect(first).toMatchObject({ type: 'step_start' })
    expect(String(first.sessionID)).toMatch(/^ses/)
    // 마지막에 최종 텍스트가 있어야 result가 합성된다.
    expect(lines.some((l) => (JSON.parse(l) as { type: string }).type === 'text')).toBe(true)
  })

  it('debug config에는 해결된 설정을 낸다', () => {
    // verifyRunnable이 실행 직전에 이걸 부른다. NDJSON을 뱉으면 JSON.parse가
    // 깨져 모든 run이 거부된다.
    const out = execFileSync(FAKE_OPENCODE, ['debug', 'config'], {
      input: '', encoding: 'utf8',
      env: { ...process.env, OPENCODE_PERMISSION: '{"bash":"deny"}' }
    })
    expect(JSON.parse(out)).toEqual({ permission: { bash: 'deny' } })
  })
})

/**
 * 가짜 opencode의 `ONE_DESK_FAKE_SCRIPT=events` (`docs/sdlc/conversation-events/` plan 2단계).
 *
 * **node로 띄운다** — `.mjs`를 직접 실행하지 않으므로 Windows에서도 실제로 돈다(위 POSIX 전용
 * 검사들과 다르다). 실제 run 루프(`run.ts`:766)처럼 `--thinking`이 있을 때만 reasoning 줄을 낸다 —
 * 그래서 인자를 **`buildCommand`에서 받아** 띄운다: 어댑터가 플래그를 빼면 여기가 빨개진다
 * (CLAUDE.md "배선도 검증 대상이다").
 */
describe('fake-opencode.mjs — events 스크립트', () => {
  const EVENTS_ENV = { ...process.env, ONE_DESK_FAKE_SCRIPT: 'events', ONE_DESK_FAKE_STEP_MS: '0' }

  function spec(): ResolvedRunSpec {
    return {
      runId: 'run-1', cwd: process.cwd(), model: null, effort: null, permission: 'edit',
      prompt: '', resumeSessionId: null, executable: FAKE_OPENCODE, mcp: null
    }
  }

  function run(args: string[], env: NodeJS.ProcessEnv = EVENTS_ENV): Record<string, unknown>[] {
    const out = execFileSync(process.execPath, [FAKE_OPENCODE, ...args], { input: '', encoding: 'utf8', env })
    return out.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as Record<string, unknown>)
  }

  const reasoningLines = (lines: Record<string, unknown>[]) => lines.filter((l) => l['type'] === 'reasoning')

  it('buildCommand가 만든 인자로 띄우면 reasoning 줄을 낸다', () => {
    expect(reasoningLines(run(opencodeAdapter.buildCommand(spec()).args)).length).toBeGreaterThan(0)
  })

  it('--thinking이 없으면 reasoning 줄을 내지 않는다 — 나머지 줄은 같다', () => {
    const withFlag = run(['run', '--format', 'json', '--thinking'])
    const without = run(['run', '--format', 'json'])
    expect(reasoningLines(without)).toEqual([])
    expect(without.map((l) => l['type'])).toEqual(
      withFlag.filter((l) => l['type'] !== 'reasoning').map((l) => l['type'])
    )
  })

  it('--version에는 1.x 버전 한 줄만 낸다 — 버전 게이트가 시나리오를 돌리며 기다리지 않는다', () => {
    const out = execFileSync(process.execPath, [FAKE_OPENCODE, '--version'], { input: '', encoding: 'utf8', env: EVENTS_ENV })
    expect(parseOpencodeVersion(out)).toEqual({ version: '1.18.30', major: 1, minor: 18, patch: 30 })
  })

  it('기본 시나리오는 --thinking이 있어도 그대로다 — reasoning이 없다', () => {
    const plain = { ...process.env, ONE_DESK_FAKE_SCRIPT: '' }
    const lines = run(['run', '--format', 'json', '--thinking'], plain)
    expect(lines.map((l) => l['type'])).toEqual(['step_start', 'tool_use', 'text', 'step_finish'])
  })

  it('어댑터가 읽으면 생각·셸·검색·편집·하위 에이전트·권한 거부가 모두 나온다', () => {
    const events = run(opencodeAdapter.buildCommand(spec()).args)
      .flatMap((l) => opencodeAdapter.parseLine(JSON.stringify(l), 'run-1'))

    // 생각 — CLI가 잰 정확한 시간(2초)
    const reasoning = events.find((e) => e.type === 'reasoning')
    expect(reasoning).toMatchObject({ text: expect.stringContaining('만료') })
    expect(reasoning && reasoning.type === 'reasoning' && reasoning.startedAt !== null && reasoning.endedAt !== null
      ? reasoning.endedAt - reasoning.startedAt : null).toBe(2000)

    const details = events.flatMap((e) => e.type === 'tool_result' && e.detail ? [e.detail] : [])
    expect(details).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'shell', exitCode: 1 }),
      expect.objectContaining({ kind: 'search', count: 12, unit: 'matches' }),
      expect.objectContaining({ kind: 'subagent' })
    ]))
    const edit = details.find((d) => d.kind === 'edit')
    expect(edit).toMatchObject({ files: [{ operation: 'edit', hunks: [{ oldStart: 41, newStart: 41 }] }] })

    expect(events.filter((e) => e.type === 'notice')).toEqual([
      expect.objectContaining({ kind: 'permission_denied', text: expect.stringContaining('권한 때문에 막힘: bash') })
    ])
    // 마지막 답이 있어야 result가 합성된다
    expect(events.at(-2)).toMatchObject({ type: 'result', status: 'succeeded' })
    expect(events.some((e) => e.type === 'raw')).toBe(false)
  })
})

/**
 * 가짜 claude의 `ONE_DESK_FAKE_SCRIPT=events` (`docs/sdlc/conversation-events/` plan 6단계, spec §8 e2e).
 *
 * e2e(`e2e/events.e2e.ts`)가 화면에서 보는 것의 재료가 실제로 어댑터를 통과해 나오는지 여기서 먼저
 * 본다 — e2e가 빨개졌을 때 픽스처 탓인지 화면 탓인지 가를 수 있다. node로 띄우므로 Windows에서도 돈다.
 */
describe('fake-claude.mjs — events 스크립트', () => {
  const EVENTS_ENV = { ...process.env, ONE_DESK_FAKE_SCRIPT: 'events', ONE_DESK_FAKE_STEP_MS: '0' }

  function lines(env: NodeJS.ProcessEnv = EVENTS_ENV): string[] {
    const out = execFileSync(process.execPath, [FAKE], { input: '', encoding: 'utf8', env })
    return out.split('\n').filter((l) => l.trim() !== '')
  }

  it('출력은 결정적이다 — e2e가 같은 디렉토리에서 한 번 더 돌려 raw.jsonl과 줄마다 맞춘다', () => {
    expect(lines()).toEqual(lines())
  })

  it('마지막 줄은 JSON이 아니고, 나머지는 전부 claude stream-json 줄이다', () => {
    const all = lines()
    expect(all.at(-1)).toBe('fake-claude: 이 줄은 JSON이 아니다')
    for (const line of all.slice(0, -1)) expect(JSON.parse(line)).toHaveProperty('type')
    // 서명은 원본 줄에만 있다 — raw.jsonl이 그것을 남기는지 e2e가 본다
    expect(all.some((line) => line.includes('"signature"'))).toBe(true)
  })

  it('어댑터가 읽으면 생각·끝부분 출력·검색·번호 hunk·이전 내용·하위 에이전트·공지가 모두 나온다', () => {
    const events = lines().flatMap((line) => claudeCodeAdapter.parseLine(line, 'run-1'))

    // 생각 — 서명은 정규화 이벤트 어디에도 없다(E3)
    expect(events.find((e) => e.type === 'reasoning')).toMatchObject({ text: expect.stringContaining('만료 경계') })
    expect(JSON.stringify(events)).not.toContain('signature')

    // 7만 자 셸 출력 — 끝 65,536자 안쪽, 끝에 PASS. 잘린 자리의 줄 조각은 더 버려 온전한 줄로
    // 시작한다(리뷰 반영 2026-09-27) — 그래서 65,536자보다 조금 짧다
    const bash = events.find((e) => e.type === 'tool_result' && e.toolUseId === 'toolu_ev_bash')
    expect(bash).toMatchObject({ output: expect.stringMatching(/^ ✓ src\/case\d+\.test\.ts[^\n]*\n[\s\S]*PASS$/), outputTruncated: expect.any(Number) })
    const length = bash?.type === 'tool_result' ? bash.output?.length ?? 0 : 0
    expect(length).toBeLessThanOrEqual(65_536)
    expect(length).toBeGreaterThan(65_536 - 100)

    const details = events.flatMap((e) => e.type === 'tool_result' && e.detail ? [e.detail] : [])
    expect(details).toEqual(expect.arrayContaining([
      { kind: 'search', count: 3, unit: 'files', truncated: false },
      expect.objectContaining({ kind: 'subagent', toolCount: 1, durationMs: 3400, model: 'claude-fake-sonnet' }),
      expect.objectContaining({
        kind: 'edit',
        files: [expect.objectContaining({ operation: 'edit', hunks: [expect.objectContaining({ oldStart: 41 })] })]
      }),
      expect.objectContaining({
        kind: 'edit',
        files: [expect.objectContaining({ operation: 'overwrite', before: expect.stringContaining('`>`') })]
      })
    ]))

    // 하위 에이전트의 자식은 호출 id를 단다(E4)
    expect(events.filter((e) => e.type === 'tool_use' && e.parentToolUseId === 'toolu_ev_agent'))
      .toEqual([expect.objectContaining({ name: 'Read' })])

    // 재시도 · 권한 거부(system) · 압축 · 권한 거부(result) — 거부는 두 번 온다(화면이 한 번 그린다)
    expect(events.filter((e) => e.type === 'notice').map((e) => e.type === 'notice' && e.kind)).toEqual([
      'retry', 'permission_denied', 'compact', 'permission_denied'
    ])
    expect(events.at(-1)).toMatchObject({ type: 'raw', line: 'fake-claude: 이 줄은 JSON이 아니다' })
    expect(events.find((e) => e.type === 'result')).toMatchObject({ status: 'succeeded' })
  })

  it('기본 시나리오와 timeline 시나리오는 그대로다', () => {
    const types = (env: NodeJS.ProcessEnv) => lines(env).map((l) => (JSON.parse(l) as { type: string }).type)
    expect(types({ ...process.env, ONE_DESK_FAKE_SCRIPT: '' })).toEqual(['system', 'assistant', 'result'])
    const timeline = lines({ ...process.env, ONE_DESK_FAKE_SCRIPT: 'timeline', ONE_DESK_FAKE_STEP_MS: '0' })
    expect(timeline.some((l) => l.includes('toolu_ev_'))).toBe(false)
  })
})
