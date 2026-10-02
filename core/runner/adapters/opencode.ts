import { access, constants, stat } from 'node:fs/promises'
import { execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  AgentAdapter, PreflightResult, ResolvedRunSpec, SpawnSpec, VerifyRunnableInput
} from '../types'
import { opencodePermissionConfig } from '../permission'
import { agentCommand, findExecutable, isBatchShim, unwrapNpmShim, type LookupOptions } from '../executable'
import {
  emptyUsage, reasoningText, stripNeedsAnswer, summarize, toolResultText, withLoopbackBypass
} from './common'
import { opencodeDeniedNotice, opencodeToolDetail } from './opencode.detail'
import type { RunEventInit, ToolEffect } from '@shared/events'

type RawEvent = RunEventInit

/**
 * 도구 이름 → 효과. **소문자다** — claude는 `Edit`, opencode는 `edit`이다.
 * 어느 도구가 파일을 쓰는지 아는 것은 어댑터의 책임이다 (전체 설계 §329).
 * `apply_patch`는 파일을 쓰는데도 빠져 있어 `other`로 떨어졌다(conversation-events FR-27).
 */
const TOOL_EFFECTS: Record<string, ToolEffect> = {
  read: 'read', glob: 'read', grep: 'read', list: 'read',
  webfetch: 'read', websearch: 'read', lsp: 'read',
  write: 'write', edit: 'write', patch: 'write', apply_patch: 'write',
  bash: 'execute'
}

function toolEffect(name: string): ToolEffect {
  return TOOL_EFFECTS[name] ?? 'other'
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * `{"type":"error"}` 줄에서 사람이 읽을 메시지를 뽑는다 (`docs/sdlc/conversation-fixes/`
 * spec FR-13). `error`는 session.error의 NamedError(`{name, data}`)다 — CLI 자신도
 * `data.message`를 먼저, 없으면 `name`을 보여준다. 그 사이에 `message`를 한 칸 더
 * 두고, 아무것도 없으면 JSON으로 싣는다. **빈 메시지로 두지 않는다** — 이 줄이
 * 실패 이유의 유일한 출처라 비면 원인 없는 실패로 되돌아간다.
 */
function errorMessageOf(obj: Record<string, unknown>, line: string): string {
  const error = obj['error']
  if (typeof error === 'string') return error || line
  if (typeof error !== 'object' || error === null) return line
  const e = error as Record<string, unknown>
  const data = (typeof e['data'] === 'object' && e['data'] !== null)
    ? (e['data'] as Record<string, unknown>)
    : {}
  return nonEmpty(data['message']) ?? nonEmpty(e['message']) ?? nonEmpty(e['name'])
    ?? JSON.stringify(error)
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/**
 * part의 메시지 id(`part.messageID`). 되돌리기·분기의 재료 — 저장만 한다
 * (conversation-events spec §7-A: claude의 `uuid`와 대칭이 되게 opencode도 싣는다).
 * **값이 있을 때만 싣는다**(FR-7). `parentToolUseId`는 싣지 않는다 — opencode `run`은 하위
 * 세션의 part를 내보내지 않는다(FR-28).
 */
function messageOrigin(part: Record<string, unknown>): { messageId?: string } {
  const id = part['messageID']
  return typeof id === 'string' && id ? { messageId: id } : {}
}

/**
 * 도구 결과의 원문 출력 (FR-23). 실패하면 `state.error`가 모델이 본 글이다 — `output`이 없다
 * (소스 processor:186-205). 옛 모양(error 없이 output만)이면 output으로 되돌아간다.
 *
 * **읽기의 원문은 싣지 않는다**(spec §7-A) — 로그에서 가장 큰 몫인데 화면(timeline FR-16)이
 * 읽기 줄을 펼치지 않는다. 실패한 읽기의 오류 글은 파일 내용이 아니므로 싣는다(claude와 같다).
 */
function resultText(name: string, state: Record<string, unknown>): unknown {
  if (state['status'] === 'error') return state['error'] ?? state['output']
  return name === 'read' ? undefined : state['output']
}

/** 도구 입력에서 파일 경로를 뽑는다. claude의 file_path와 달리 filePath다. */
function targetPaths(input: unknown): string[] {
  if (typeof input !== 'object' || input === null) return []
  const path = (input as Record<string, unknown>)['filePath']
  return typeof path === 'string' ? [path] : []
}

const execFileAsync = promisify(execFile)

/**
 * 해결된 설정을 JSON 문자열로 가져온다. 테스트가 갈아끼우는 이음매다.
 *
 * **동기 실행을 쓰면 안 된다.** `execFileSync`는 이벤트 루프를 막아 같은
 * 프로세스에 떠 있는 MCP 서버가 연결을 받지 못하게 만든다.
 */
export type ConfigProbe = (input: {
  executable: string
  cwd: string
  env: Record<string, string>
}) => Promise<string>

const defaultProbe: ConfigProbe = async ({ executable, cwd, env }) => {
  const launch = agentCommand(executable, ['debug', 'config'])
  const { stdout } = await execFileAsync(launch.cmd, launch.args, { cwd, env })
  return stdout
}

const BATCH_SHIM_REASON =
  'opencode.cmd를 실행할 수 없습니다 — 그 안에서 node_modules의 opencode.exe를 찾지 못했습니다(설치의 postinstall이 돌지 않았을 수 있습니다). 네이티브 설치본(opencode.exe)을 쓰거나, workspace 설정에 opencode.exe의 절대 경로를 지정하세요.'

/**
 * `--version` 출력을 가져온다. 테스트가 갈아끼우는 이음매다. 못 읽으면 null.
 *
 * **동기 실행을 쓰면 안 된다** — `ConfigProbe`와 같은 이유다(같은 프로세스의 MCP 서버).
 */
export type VersionReader = (executable: string) => Promise<string | null>

/** 실행 파일을 받아 거부 사유를 돌려준다. 통과면 null이다 */
export type VersionGate = (executable: string) => Promise<string | null>

/** 지원하지 않는 첫 major. 2.x부터 권한 환경변수를 따른다는 보장이 없다 (spec FR-17) */
const FIRST_UNSUPPORTED_MAJOR = 2

/**
 * 지원하는 가장 낮은 버전. `buildCommand`가 붙이는 옵션 중 가장 늦게 생긴 것이 정한다:
 * `--thinking`(늘 붙인다, conversation-events FR-21)은 1.1.50, 전체 허용의
 * `--dangerously-skip-permissions`는 **1.4.0**에서 생겼다(1.3.17의 `run.ts`에는 없다). 1.0.0부터
 * CLI가 yargs `.strict()`라 모르는 옵션이면 **이유 없이 도움말만** 찍고 exit 1로 끝난다 — 그래서
 * 실행 전에(preflight) 이유를 말하며 막는다(리뷰 반영 2026-09-27, 2026-10-02 1.4.0으로 올림).
 * 옵션을 하나 더 붙이면 그 옵션이 생긴 버전을 여기서 다시 본다.
 */
const MIN_SUPPORTED: readonly [number, number, number] = [1, 4, 0]

/** 버전 출력은 즉시 온다. 매달린 CLI가 설정 화면을 붙잡지 않게 넉넉히만 준다 */
const VERSION_TIMEOUT_MS = 5_000

/**
 * `--version` 출력의 **첫 줄**에서 버전을 읽는다. 1.x는 `1.18.30`만 찍는다(실측) —
 * 앞에 `opencode `나 `v`가 붙는 변형까지만 받아 준다. 첫 줄이 버전이 아니면 null이다:
 * 오류 문구나 도움말 뒤쪽의 숫자를 버전으로 오인하면 멀쩡한 설치본을 막는다.
 */
export function parseOpencodeVersion(
  output: string
): { version: string; major: number; minor: number; patch: number } | null {
  const first = output.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '')
  if (!first) return null
  const m = /^(?:opencode\s+)?v?((\d+)\.(\d+)\.(\d+))\b/i.exec(first)
  if (!m) return null
  return { version: m[1]!, major: Number(m[2]), minor: Number(m[3]), patch: Number(m[4]) }
}

/** 최소 버전보다 낮은가 — major·minor·patch를 차례로 비교한다 */
function belowMinimum(v: { major: number; minor: number; patch: number }): boolean {
  const parts = [v.major, v.minor, v.patch]
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] !== MIN_SUPPORTED[i]) return parts[i]! < MIN_SUPPORTED[i]!
  }
  return false
}

function judgeVersion(executable: string, output: string | null): string | null {
  const parsed = output === null ? null : parseOpencodeVersion(output)
  // 버전을 못 읽으면 막지 않는다 — 게이트 전의 동작 그대로다 (spec FR-17).
  if (!parsed) return null
  if (belowMinimum(parsed)) {
    const min = MIN_SUPPORTED.join('.')
    return (
      `OpenCode ${parsed.version} CLI는 너무 오래됐습니다 — one-desk가 붙여 실행하는 옵션` +
      `(--thinking·--dangerously-skip-permissions)을 ${min} 전 버전은 몰라 실행을 시작하자마자 거부합니다. ` +
      `${min} 이상으로 올리거나 설정의 CLI 경로를 새 실행 파일로 바꾸세요: ${executable}`
    )
  }
  if (parsed.major < FIRST_UNSUPPORTED_MAJOR) return null
  return (
    `OpenCode ${parsed.version} CLI는 아직 지원하지 않습니다 — 2.x는 우리가 넘기는 권한 정책` +
    '(OPENCODE_PERMISSION)을 따르지 않을 수 있어, 읽기 전용 실행이 파일을 고칠 수 있습니다. ' +
    `1.x를 쓰거나 설정의 CLI 경로를 1.x 실행 파일로 바꾸세요: ${executable}`
  )
}

/**
 * 기본 읽기 — 실행 파일을 `--version`으로 띄운다. 실패·타임아웃·0이 아닌 종료는 전부 null.
 *
 * **stdin을 곧바로 닫는다.** 닫지 않으면 stdin을 기다리는 CLI(claude가 그렇고, e2e의
 * 가짜 CLI도 그렇다)가 타임아웃까지 매달린다. 띄우는 자리는 `agentCommand`를 거친다 —
 * 가짜 CLI(`.mjs`)는 런처 없이는 Windows에서 뜨지 않는다.
 */
const readVersion: VersionReader = (executable) => new Promise((resolve) => {
  const launch = agentCommand(executable, ['--version'])
  let child: ChildProcess
  try {
    child = execFile(
      launch.cmd, launch.args,
      { timeout: VERSION_TIMEOUT_MS, windowsHide: true, encoding: 'utf8' },
      (err, stdout, stderr) => resolve(err ? null : (stdout || stderr || null))
    )
  } catch {
    resolve(null)
    return
  }
  child.stdin?.end()
})

/**
 * 버전 게이트를 만든다. 결과를 **(경로, 크기, mtime)**으로 캐시한다 (spec FR-17).
 *
 * 설정 화면의 `checkAgents`가 workspace를 고를 때마다 프로세스를 띄우지 않게 하기 위해서다
 * — 캐시 뒤에는 stat만 한다. 크기나 mtime이 바뀌면 설치본을 갈아끼운 것으로 보고 다시
 * 읽는다. **판정 자체(프로미스)를 캐시한다** — 동시에 들어온 조회(checkAgents는 두 agent를,
 * probeAgents는 같은 preflight를 함께 부른다)가 프로세스를 두 번 띄우지 않는다.
 *
 * **못 읽은 판정(실패·시간 초과·0이 아닌 종료)은 끝난 뒤 캐시에서 뺀다.** 그 판정은 통과
 * (fail-open)라, 캐시하면 한 번의 일시적 실패 — Windows에서 새 바이너리의 첫 실행이 백신
 * 검사로 시간을 넘기는 것 — 가 앱이 사는 동안 2.x 차단을 꺼 둔다. 이 게이트는 보안
 * 장치다(2.x는 읽기 전용 run이 파일을 고칠 수 있다). 대가는 `--version`에 매달리는
 * 바이너리에서 조회마다 시간 초과만큼 기다리는 것이다. 버전이 아닌 출력은 캐시한다 —
 * 같은 바이너리는 같은 것을 찍는다.
 *
 * 파일을 stat조차 못 하면 읽지 않고 통과시킨다 — 실행 파일이 있는지는 preflight 앞단이
 * 이미 봤고, 그 사이 사라졌다면 실제 spawn이 더 정확한 이유를 낸다.
 */
export function createVersionGate(read: VersionReader): VersionGate {
  interface Entry { size: number; mtimeMs: number; verdict: Promise<string | null> }
  const cache = new Map<string, Entry>()

  return async (executable) => {
    let info: { size: number; mtimeMs: number }
    try {
      info = await stat(executable)
    } catch {
      return null
    }
    const hit = cache.get(executable)
    if (hit && hit.size === info.size && hit.mtimeMs === info.mtimeMs) return hit.verdict

    // 그 사이 다른 조회가 새 항목을 세웠으면 그것은 건드리지 않는다.
    const forget = () => { if (cache.get(executable) === entry) cache.delete(executable) }
    const entry: Entry = {
      size: info.size,
      mtimeMs: info.mtimeMs,
      verdict: read(executable).then(
        (output) => {
          if (output === null) forget()
          return judgeVersion(executable, output)
        },
        () => {
          forget()
          return null
        }
      )
    }
    cache.set(executable, entry)
    return entry.verdict
  }
}

/**
 * 앱 전체가 나눠 쓰는 게이트. **실행(`resolveExecutable`)과 설정 화면(`checkAgents`·
 * `probeAgents`)이 같은 캐시를 본다** — 셋 다 이 어댑터의 preflight를 타기 때문이다.
 */
const defaultVersionGate = createVersionGate(readVersion)

export interface OpencodePreflightOptions extends LookupOptions {
  /** 버전 게이트. 테스트가 갈아끼우는 이음매다 — 기본은 앱 전체가 나눠 쓰는 캐시다 */
  versionGate?: VersionGate
}

// `: AgentAdapter`가 아니라 `satisfies`인 이유는 claudeCode.ts와 같다 —
// preflight의 두 번째 인자(opts)가 테스트의 이음매인데, 인터페이스로 표기하면
// 타입에서 잘려 테스트가 부를 수 없다.
export const opencodeAdapter = {
  kind: 'opencode',

  // json 모드의 opencode는 오류를 stderr가 아니라 stdout의 error 줄로만 낸다 — 이 줄이
  // 실패 이유의 유일한 출처다 (spec FR-13). 1.18.x의 `run`은 error 줄을 낸 run을 항상
  // exit 1로 끝낸다(`--attach`가 아닐 때 — 우리는 쓰지 않는다).
  errorEventsAreFailureReasons: true,

  /**
   * 실행 파일을 찾고, **지원하는 버전인지까지** 본다 (spec FR-17).
   *
   * 버전 확인이 `verifyRunnable`이 아니라 여기 있는 이유: 설정 화면의 `checkAgents`와
   * 실행이 같은 판정을 써야 한다(CLAUDE.md) — 둘 다 preflight를 타므로 여기 두면
   * 설정 화면이 초록인데 실행은 막히는 상태가 구조적으로 생기지 않는다.
   */
  async preflight(
    explicitPath: string | null,
    opts: OpencodePreflightOptions = {}
  ): Promise<PreflightResult> {
    let executable: string
    if (explicitPath) {
      try {
        await access(explicitPath, constants.X_OK)
      } catch {
        return { ok: false, reason: `설정된 경로에서 실행할 수 없습니다: ${explicitPath}` }
      }
      executable = explicitPath
    } else {
      const found = await findExecutable('opencode', opts)
      if (!found) {
        return {
          ok: false,
          reason:
            'PATH에서 opencode 실행 파일을 찾을 수 없습니다. workspace 설정에서 경로를 지정하세요.'
        }
      }
      executable = found
    }
    // 배치 shim 판별은 두 경로가 합류한 뒤 한 번만 한다 (claudeCode.ts와 같은 이유).
    // 버전보다 먼저다 — shim은 shell 없이 띄울 수조차 없다. npm 전역 설치의 껍데기는 그것이
    // 부르는 opencode.exe로 풀어 쓴다(`unwrapNpmShim`). 풀리지 않는 것만 거부한다.
    if (isBatchShim(executable)) {
      const unwrapped = await unwrapNpmShim(executable)
      if (!unwrapped) return { ok: false, reason: BATCH_SHIM_REASON }
      executable = unwrapped
    }
    // 버전 게이트도 합류한 뒤다 — 한쪽 갈래에만 두면 다른 쪽으로 2.x가 새어나간다.
    const rejected = await (opts.versionGate ?? defaultVersionGate)(executable)
    if (rejected) return { ok: false, reason: rejected }
    return { ok: true, executable }
  },

  buildCommand(spec: ResolvedRunSpec): SpawnSpec {
    // --thinking이 없으면 1.18.30의 run 루프는 reasoning 줄을 내지 않는다(`run.ts`:766). **출력만
    // 가른다** — 모델 호출 인자·권한과 무관하다(conversation-events spec FR-21, NFR-5).
    const args = ['run', '--format', 'json', '--thinking']

    // "명시적으로 deny가 아닌 권한을 자동 승인"이다. 전체 허용에서만 쓴다 (전체 설계 §376 —
    // 설계는 `--auto`라 적었다). 다른 단계에 켜면 우리가 막은 것이 열린다. **`--auto`가 아니다** —
    // 그것은 1.18.0에서 생긴 별칭이라 1.4.0~1.17.x가 모르는 옵션으로 보고 도움말만 찍고 죽는다.
    // 옛 이름은 1.4.0부터 있고 1.18.x에도 남아 있다(1.18.0 `run.ts`: auto || yolo || 이것).
    if (spec.permission === 'full') args.push('--dangerously-skip-permissions')

    // 모델은 provider/model 형식이다 (전체 설계 §199).
    if (spec.model) args.push('-m', spec.model)
    // claude의 --effort와 **같은 자리이되 다른 플래그다.** opencode의 변형은
    // provider별 reasoning effort라 값의 표가 provider마다 다르다 — 그래서
    // 저장 컬럼도 claude와 갈라 두었다(전체 설계 §199와 같은 이유).
    if (spec.effort) args.push('--variant', spec.effort)
    if (spec.resumeSessionId) args.push('--session', spec.resumeSessionId)

    const env = withLoopbackBypass(process.env)

    // **권한은 환경변수로 간다.** OPENCODE_CONFIG가 가리키는 파일은 run의 cwd에
    // 있는 opencode.json에게 지지만, 이 환경변수는 그것도 이긴다 (설계 §2-4).
    env['OPENCODE_PERMISSION'] = JSON.stringify(opencodePermissionConfig(spec.permission))

    // MCP 설정만 파일로 간다 — mcp 섹션에 해당하는 환경변수가 없다.
    // 파일이 없는 경로를 가리키면 opencode가 조용히 무시하므로(설계 §8),
    // 파일을 만드는 쪽(호스트)이 실패를 삼키지 않아야 한다.
    if (spec.mcp) env['OPENCODE_CONFIG'] = spec.mcp.configFile

    // 프롬프트는 stdin으로 넘긴다 — RunManager가 쓰고 닫는다.
    return { cmd: spec.executable, args, env, cwd: spec.cwd }
  },

  /**
   * 실행 직전 마지막 확인 — 해결된 설정에 `ask`가 남아 있지 않은지 본다.
   *
   * 15개 키를 전부 명시해도 구멍이 셋 남는다: opencode가 나중에 추가하는 키,
   * OPENCODE_PERMISSION이 깨진 JSON일 때의 조용한 무시, MCP 도구 이름 같은
   * 임의 키. 셋 다 결과가 같다 — `ask`가 남는다. **1.18.x의 `run`은 그 `ask`를
   * 자동 거부하고 조용히 exit 0으로 끝난다**(도구 실패만 남는다 — 소스 `run.ts`
   * v1.18.30:801-822, 1.18.27과 동일). 멈추지는 않지만 agent가 그 도구를 못 쓴
   * run이 성공으로 기록되고 사용자는 이유를 알 길이 없다. 이 검사가 그것을 실행 전의
   * 명시적 실패로 바꾸므로 여전히 필수다 (설계 §3-3과 그 2026-09-27 정정·§8).
   *
   * 모델을 호출하지 않으므로 비용도 지연도 작다.
   */
  async verifyRunnable(
    input: VerifyRunnableInput,
    probe: ConfigProbe = defaultProbe
  ): Promise<PreflightResult> {
    const env = withLoopbackBypass(process.env)
    // 실제로 실행에 쓸 환경변수를 그대로 실어야 검사가 의미를 갖는다.
    env['OPENCODE_PERMISSION'] = JSON.stringify(opencodePermissionConfig(input.permission))

    let raw: string
    try {
      raw = await probe({ executable: input.executable, cwd: input.cwd, env })
    } catch {
      return {
        ok: false,
        reason: `OpenCode 설정을 확인하지 못했습니다. ${input.cwd} 에서 실행할 수 있는지 보세요.`
      }
    }

    let permission: unknown
    try {
      permission = (JSON.parse(raw) as Record<string, unknown>)['permission']
    } catch {
      return { ok: false, reason: 'OpenCode 설정을 확인하지 못했습니다. 출력을 읽을 수 없습니다.' }
    }

    if (typeof permission !== 'object' || permission === null) return { ok: true }

    const asking = Object.entries(permission as Record<string, unknown>)
      .filter(([, value]) => value === 'ask')
      .map(([key]) => key)
    if (asking.length === 0) return { ok: true }

    return {
      ok: false,
      reason:
        `${asking.join(', ')} 권한이 '물어보기'로 남아 있어 실행할 수 없습니다. ` +
        '헤드리스 실행에는 답할 사람이 없어 그 도구가 말없이 거부된 채 끝납니다. ' +
        `${input.cwd}/opencode.json 에서 해당 항목을 지우거나 allow/deny로 바꾸세요.`
    }
  },

  parseLine(line: string, runId: string): RawEvent[] {
    const at = Date.now()
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      // 깨진 줄 때문에 run 전체를 죽이지 않는다 (전체 설계 §11)
      return [{ type: 'raw', runId, at, line }]
    }
    // 객체가 아닌 JSON(`null`·수·배열)도 깨진 줄이다 — 그대로 두면 `obj['part']`에서 던지고, 이
    // 함수는 stdout 핸들러 안에서 불려 메인 프로세스가 죽는다(리뷰 반영 2026-09-27, claude와 같다).
    const obj = record(parsed)
    if (!obj) return [{ type: 'raw', runId, at, line }]

    const part = (typeof obj['part'] === 'object' && obj['part'] !== null)
      ? (obj['part'] as Record<string, unknown>)
      : null
    const sessionId = typeof obj['sessionID'] === 'string' ? obj['sessionID'] : null

    switch (obj['type']) {
      case 'step_start':
        // sessionID는 모든 줄에 실려 오지만 줄마다 내면 같은 값이 로그를 채운다.
        return sessionId ? [{ type: 'session', runId, at, sessionId }] : []

      case 'tool_use': {
        if (!part) return []
        const name = String(part['tool'] ?? '')
        const state = record(part['state']) ?? {}
        const toolUseId = String(part['callID'] ?? '')
        const src = messageOrigin(part)
        const failed = state['status'] === 'error'
        const output = resultText(name, state)
        const detail = opencodeToolDetail(name, state)
        // 한 줄에 입력과 결과가 함께 온다 — 이미 끝난 도구를 보고받는 것이다.
        // (그래서 diff 뷰어의 before 스냅샷을 여기서 걸 수 없다. 설계 §10-1)
        // 순서는 tool_use → tool_result → (권한 거부면) notice다 (plan 다듬은 것 4).
        const events: RawEvent[] = [
          {
            type: 'tool_use', runId, at, toolUseId, name,
            effect: toolEffect(name),
            targetPaths: targetPaths(state['input']),
            input: state['input'],
            ...src
          },
          {
            type: 'tool_result', runId, at, toolUseId,
            ok: state['status'] === 'completed',
            // 실패하면 output이 없다 — 오류 글로 요약한다(FR-25; 전에는 `""` 두 글자였다)
            summary: summarize(failed ? state['error'] ?? state['output'] ?? '' : state['output']),
            ...toolResultText(typeof output === 'string' ? output : null),
            ...(detail ? { detail } : {}),
            ...src
          }
        ]
        // 권한 거부는 run의 상태를 건드리지 않는 공지다(FR-8·26). 도구 실패 줄은 그대로 남는다.
        const denied = failed ? opencodeDeniedNotice(name, state['error'], toolUseId) : null
        if (denied) events.push({ type: 'notice', runId, at, ...denied, ...src })
        return events
      }

      case 'reasoning': {
        if (!part) return []
        // `--thinking`이 있을 때만 오는 줄이다(buildCommand). **`part.metadata`는 버린다** —
        // provider 서명·암호문이다(E3). 원본 줄째로는 raw.jsonl에 남는다.
        // **공백뿐인 본문은 이벤트를 만들지 않는다**(FR-22). §7-A의 "빈 생각도 한 줄로 보인다"는
        // 우려 2 — claude — 의 결정이다(리뷰 반영 2026-09-27: 한동안 여기에도 넓혀 적용했다). OpenAI
        // 계열은 본문 없이 암호문만 오는 reasoning이 흔해, 내면 턴마다 펼칠 것 없는 줄이 여럿 선다.
        const text = typeof part['text'] === 'string' ? part['text'] : ''
        if (text.trim() === '') return []
        const time = record(part['time'])
        return [{
          type: 'reasoning', runId, at,
          ...reasoningText(text),
          startedAt: num(time?.['start']),
          endedAt: num(time?.['end']),
          ...messageOrigin(part)
        }]
      }

      case 'text': {
        if (!part) return []
        const { text, marked } = stripNeedsAnswer(String(part['text'] ?? ''))
        // OpenCode에는 claude의 result 같은 종료 이벤트가 없다. text마다 result를
        // 함께 내면 RunManager가 덮어써서 마지막 것이 남는다 (설계 §7).
        // 여기 적은 succeeded는 종료 코드가 0일 때만 산다 — 비정상 종료를 이기지
        // 못한다 (`docs/sdlc/conversation-fixes/` spec FR-12, manager의 judgeStatus).
        // 메시지 id는 text에만 싣는다 — result는 합성한 종료 이벤트이지 메시지가 아니다.
        return [
          { type: 'text', runId, at, text, ...messageOrigin(part) },
          {
            type: 'result', runId, at,
            status: 'succeeded',
            resultText: text,
            sessionId,
            needsAnswer: marked
          }
        ]
      }

      case 'error':
        // json 모드의 opencode는 오류를 stderr에 쓰지 않고 이 줄로만 낸다 — 버리면
        // 화면에도 로그에도 없는 "이유 없는 실패"가 된다(spec FR-13). 성패는 여기서
        // 정하지 않는다: 판정은 종료 코드를 보는 manager가 한다(FR-12).
        return [{ type: 'error', runId, at, message: errorMessageOf(obj, line) }]

      case 'step_finish': {
        // 스텝마다 그 스텝의 수치가 온다. **누적은 여기서 하지 않는다** —
        // parseLine은 앞 줄을 기억하지 못하고(설계 §7), 합치는 일은 manager 몫이다
        // (docs/sdlc/run-info/spec.md §3-3).
        const tokens = part && typeof part['tokens'] === 'object' && part['tokens'] !== null
          ? part['tokens'] as Record<string, unknown>
          : null
        if (!tokens) return []
        const cache = (typeof tokens['cache'] === 'object' && tokens['cache'] !== null)
          ? tokens['cache'] as Record<string, unknown>
          : {}

        const input = num(tokens['input'])
        const cacheRead = num(cache['read'])
        const cacheWrite = num(cache['write'])
        // 이 스텝이 모델에 넣은 프롬프트 크기. total은 출력까지 더한 값이라 다르다.
        const context = [input, cacheRead, cacheWrite].every((n) => n === null)
          ? null
          : (input ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0)

        return [{
          type: 'usage', runId, at,
          usage: emptyUsage({
            // 모델도 컨텍스트 창도 스트림에 없다 — null로 남겨 화면이 조각을 빼게 한다.
            inputTokens: input,
            outputTokens: num(tokens['output']),
            cacheReadTokens: cacheRead,
            cacheWriteTokens: cacheWrite,
            reasoningTokens: num(tokens['reasoning']),
            costUsd: num(part?.['cost']),
            contextTokens: context
          })
        }]
      }

      default:
        return []
    }
  }
} satisfies AgentAdapter
