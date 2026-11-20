/**
 * opencode의 실행 직전 확인 — **"우리가 보낸 권한이 실제로 걸려 있는가"** (`docs/sdlc/opencode-v2/` spec §2-2·FR-8·8a·9·14).
 *
 * 예전 확인은 "ask가 남지 않았다"만 봤다. 방언이 둘이 되면 그것으로는 모자라다: 2.x를 1.x 방식으로 띄우면
 * `OPENCODE_PERMISSION`이 통째로 무시되는데, 그때 `debug config`의 출력에는 `ask`도 없다 — 조용히 통과하고 읽기 전용 run이
 * 전부 허용으로 돈다. 그래서 두 방언 다 **긍정 확인**이다: 보낸 것이 해결된 설정에 그대로 있어야 통과한다.
 *
 * 판정은 순수 함수(`judge*`·`capabilityOf`)이고, 프로세스를 띄우는 것은 이음매(`CliExec`·`ConfigProbe`)로 받는다.
 * **opencode 방언은 이 파일과 `opencode.ts`·`opencode.detail.ts` 밖으로 나가지 않는다.**
 */

import { execFile, type ChildProcess } from 'node:child_process'
import { stat } from 'node:fs/promises'
import type { Permission } from '@shared/models'
import type { PreflightResult, VerifyRunnableInput } from '../types'
import { agentCommand } from '../executable'
import { OPENCODE_V2_AGENT, opencodeV2Rules, type OpencodeRule } from '../permission'
import { HOST_ENV } from '../../wsl/env'

/** 짧은 조회 한 번의 결과. **던지지 않는다** — 못 띄운 것도 결과다(exitCode null) */
export interface CliResult {
  exitCode: number | null
  stdout: string
  stderr: string
}

/** opencode를 인자와 함께 한 번 띄운다. 테스트가 갈아끼우는 이음매다 */
export type CliExec = (input: {
  executable: string
  args: string[]
  cwd: string
  env: Record<string, string>
}) => Promise<CliResult>

/** `debug agents`·`session.get`은 2초 안에 끝난다(실측). 매달린 CLI가 실행을 붙잡지 않을 만큼만 준다 */
const EXEC_TIMEOUT_MS = 20_000

/**
 * 기본 실행 — **동기 실행을 쓰면 안 된다**(같은 프로세스의 MCP 서버가 멈춘다). stdin을 곧바로 닫는다 — 닫지 않으면 stdin을
 * 기다리는 CLI(e2e의 가짜 CLI)가 타임아웃까지 매달린다. opencode는 host에서만 돈다(WSL repo는 preflight가 먼저 막는다).
 */
export const defaultCliExec: CliExec = ({ executable, args, cwd, env }) => new Promise((resolve) => {
  const launch = agentCommand(HOST_ENV, executable, args)
  let child: ChildProcess
  try {
    child = execFile(
      launch.cmd, launch.args,
      { cwd, env, timeout: EXEC_TIMEOUT_MS, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : null) : 0
        resolve({ exitCode: code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
      }
    )
  } catch {
    resolve({ exitCode: null, stdout: '', stderr: '' })
    return
  }
  child.stdin?.end()
})

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

// ── 1.x: `debug config`의 permission (FR-9) ──────────────────────────────────

const NOT_APPLIED =
  'OpenCode에 권한 설정이 걸리지 않았습니다 — 우리가 넘긴 권한(OPENCODE_PERMISSION)이 해결된 설정에 없습니다. ' +
  '이 CLI가 그 통로를 읽지 않는 버전일 수 있습니다. 권한 없이 도는 것을 막기 위해 실행하지 않습니다.'

/**
 * `opencode debug config`(1.x)의 출력에서 **우리가 보낸 키·값이 전부 그대로 있는지** 본다.
 *
 * - 출력이 객체가 아니거나(2.x는 설정 출처의 **배열**을 낸다) `permission`이 없으면 실패다 — 예전에는 통과였고, 그것이
 *   2.x를 1.x 방식으로 띄웠을 때 조용히 열리는 자리였다.
 * - `ask`가 남았으면 그 키를 말한다(1.18.x는 그 도구를 말없이 거부하고 성공으로 끝난다).
 * - 보낸 값과 다른 키가 있으면 실패다 — 환경변수가 깨져 무시됐거나, 우리 값을 이기는 출처가 있다.
 */
export function judgeV1Config(
  raw: string,
  sent: Record<string, 'allow' | 'deny'>,
  cwd: string
): PreflightResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'OpenCode 설정을 확인하지 못했습니다. 출력을 읽을 수 없습니다.' }
  }
  const permission = record(record(parsed)?.['permission'])
  if (!permission) return { ok: false, reason: NOT_APPLIED }

  const asking = Object.entries(permission).filter(([, value]) => value === 'ask').map(([key]) => key)
  if (asking.length > 0) {
    return {
      ok: false,
      reason:
        `${asking.join(', ')} 권한이 '물어보기'로 남아 있어 실행할 수 없습니다. ` +
        '헤드리스 실행에는 답할 사람이 없어 그 도구가 말없이 거부된 채 끝납니다. ' +
        `${cwd}/opencode.json 에서 해당 항목을 지우거나 allow/deny로 바꾸세요.`
    }
  }

  const differing = Object.entries(sent).filter(([key, value]) => permission[key] !== value).map(([key]) => key)
  if (differing.length === 0) return { ok: true }
  // 하나도 안 맞으면 통째로 무시된 것이다. 일부만 다르면 무엇이 다른지 말한다
  if (differing.length === Object.keys(sent).length) return { ok: false, reason: NOT_APPLIED }
  return {
    ok: false,
    reason:
      `OpenCode의 권한 설정이 우리가 넘긴 것과 다릅니다(${differing.join(', ')}). ` +
      `다른 설정이 그 항목을 덮고 있어 실행하지 않습니다 — ${cwd}/opencode.json 과 전역 설정을 확인하세요.`
  }
}

// ── 2.x: `debug agents`의 해결된 규칙 (FR-8) ─────────────────────────────────

const show = (r: OpencodeRule | Record<string, unknown>): string => `${String(r.action)} ${String(r.resource)} ${String(r.effect)}`

function sameRule(a: Record<string, unknown>, b: OpencodeRule): boolean {
  return a['action'] === b.action && a['resource'] === b.resource && a['effect'] === b.effect
}

const V2_UNREADABLE = 'OpenCode의 권한을 확인하지 못했습니다. 해결된 권한 목록을 읽을 수 없어 실행하지 않습니다.'

/**
 * `opencode debug agents --standalone`(2.x)의 출력에서 우리 agent의 해결된 규칙을 본다. 통과 조건은 둘 다다.
 *
 * 1. 우리 목록이 **그 순서대로 이어져** 들어 있다(마지막으로 나타난 자리를 본다 — 같은 목록이 최상위·agent 두 자리에서 와
 *    두 번 나타난다).
 * 2. 그 **뒤에** 오는 규칙이 전부 `deny`다. 2.x는 뒤가 이긴다 — 뒤의 `allow`·`ask`는 우리 것을 다시 연다.
 *
 * 프로젝트 설정이 규칙을 붙이는 자리를 실측으로 넷 확인했지만(spec 0-1), 이 확인은 우리가 모르는 다섯째 자리도 잡는다.
 */
export function judgeV2Agents(raw: string, sent: OpencodeRule[]): PreflightResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: V2_UNREADABLE }
  }
  if (!Array.isArray(parsed)) return { ok: false, reason: V2_UNREADABLE }
  const agent = parsed.map(record).find((a) => a?.['id'] === OPENCODE_V2_AGENT)
  const list = agent?.['permissions']
  if (!Array.isArray(list)) return { ok: false, reason: V2_UNREADABLE }
  const rules = list.map(record)
  if (rules.some((r) => r === null)) return { ok: false, reason: V2_UNREADABLE }
  const resolved = rules as Record<string, unknown>[]

  let at = -1
  for (let i = resolved.length - sent.length; i >= 0; i--) {
    if (sent.every((rule, k) => sameRule(resolved[i + k]!, rule))) {
      at = i
      break
    }
  }
  if (at < 0) {
    return {
      ok: false,
      reason:
        'OpenCode에 권한 설정이 걸리지 않았습니다 — 우리가 넘긴 규칙이 해결된 권한 목록에 없습니다. ' +
        '권한 없이 도는 것을 막기 위해 실행하지 않습니다.'
    }
  }
  const reopening = resolved.slice(at + sent.length).filter((r) => r['effect'] !== 'deny')
  if (reopening.length === 0) return { ok: true }
  return {
    ok: false,
    reason:
      `OpenCode 설정이 우리 권한 뒤에 규칙을 붙여 실행할 수 없습니다: ${reopening.map(show).join(', ')}. ` +
      '뒤에 온 규칙이 이기므로 그대로 돌리면 막아 둔 도구가 열립니다. 프로젝트의 opencode.json과 전역 설정에서 그 규칙을 지우세요.'
  }
}

// ── 2.x: 확인할 수 있는 바이너리인가 (FR-8a) ─────────────────────────────────

/** `debug agents --standalone`을 받으면 확인할 수 있다. 2.0.18은 그 옵션을 모른다 */
export type V2Capability = 'verifiable' | 'unverifiable'

/**
 * 옛 바이너리가 `--standalone`을 거부할 때 찍는 문구(2.0.18 실측). **문구에 기대도 된다** — 이 문구를 찍는 것은 이미 나온
 * 옛 바이너리뿐이고(바뀌지 않는다), 새 바이너리는 옵션을 받는다.
 */
export const UNRECOGNIZED_STANDALONE = 'Unrecognized flag: --standalone'

/**
 * `debug agents --standalone`의 결과에서 능력을 읽는다. **판정 실패(null)를 `unverifiable`로 치지 않는다** — "못 묻는다"와
 * "물었는데 실패했다"를 섞으면, 시간 초과 한 번이 읽기 전용을 확인 없이 돌리거나 멀쩡한 바이너리를 전체 허용만으로 묶는다.
 */
export function capabilityOf(result: CliResult): V2Capability | null {
  if (result.exitCode === 0) return 'verifiable'
  if (result.exitCode !== null && `${result.stderr}\n${result.stdout}`.includes(UNRECOGNIZED_STANDALONE)) {
    return 'unverifiable'
  }
  return null
}

/** 확인할 수 없는 바이너리에서 읽기 전용·편집 허용을 막는 문장 (FR-8a) */
export const UNVERIFIABLE_REASON =
  '이 OpenCode는 실행 전에 권한을 확인할 수 없어 읽기 전용·편집 허용으로 돌릴 수 없습니다. ' +
  '2.3.2 이상으로 올리거나 전체 허용으로 실행하세요.'

/** 설정 화면이 미리 보이는 안내 (FR-8a) */
export const UNVERIFIABLE_NOTE = '전체 허용만 실행됩니다 — 읽기 전용·편집 허용은 2.3.2 이상'

const DEBUG_AGENTS = ['debug', 'agents', '--standalone']

/** 세션이 없을 때의 출력(2.3.2 — `SessionNotFoundError` / `Session not found`) */
function sessionMissing(result: CliResult): boolean {
  return /SessionNotFoundError|Session not found/i.test(`${result.stdout}\n${result.stderr}`)
}

export interface OpencodeV2Verifier {
  /** 실행 직전 확인 (FR-8·8a·14). `env`는 run과 같은 환경이다 */
  verify(input: VerifyRunnableInput, env: Record<string, string>): Promise<PreflightResult>
  /**
   * 이 바이너리가 실행 직전 확인을 할 수 있는가 — 설정 화면의 안내용. 판정하지 못하면 null이다. `unverifiable`은
   * (경로, 크기, mtime)으로 기억한다 — 같은 바이너리는 같은 답이다.
   */
  capability(executable: string, cwd: string, env: Record<string, string>): Promise<V2Capability | null>
}

/**
 * 2.x의 확인기. `exec`는 이음매다.
 *
 * **`unverifiable`만 기억한다.** `verifiable`은 어차피 매번 띄워 규칙을 읽어야 하고(프로젝트 설정이 턴 사이에 바뀐다),
 * 판정 실패는 기억하면 한 번의 시간 초과가 굳는다(버전 게이트와 같은 규칙).
 */
export function createOpencodeV2Verifier(exec: CliExec = defaultCliExec): OpencodeV2Verifier {
  const unverifiable = new Set<string>()

  async function keyOf(executable: string): Promise<string | null> {
    try {
      const info = await stat(executable)
      return `${executable}|${info.size}|${info.mtimeMs}`
    } catch {
      return null
    }
  }

  /** `debug agents`를 띄운다. 이미 못 묻는 것으로 알려진 바이너리면 띄우지 않는다 */
  async function ask(
    executable: string, cwd: string, env: Record<string, string>
  ): Promise<{ capability: V2Capability | null; result: CliResult | null }> {
    const key = await keyOf(executable)
    if (key && unverifiable.has(key)) return { capability: 'unverifiable', result: null }
    const result = await exec({ executable, args: DEBUG_AGENTS, cwd, env })
    const capability = capabilityOf(result)
    if (capability === 'unverifiable' && key) unverifiable.add(key)
    return { capability, result }
  }

  return {
    async capability(executable, cwd, env) {
      return (await ask(executable, cwd, env)).capability
    },

    async verify(input, env) {
      // 2.x는 variant를 `model#variant`로만 넘긴다 — 붙일 모델이 없으면 조용히 버리지 않는다 (FR-10)
      if (input.effort && !input.model) {
        return { ok: false, reason: 'OpenCode 2.x에서 variant를 쓰려면 모델을 지정하세요 — variant는 모델 이름에 붙여 넘깁니다.' }
      }

      const { capability, result } = await ask(input.executable, input.cwd, env)
      if (capability === null) return { ok: false, reason: V2_UNREADABLE }
      if (capability === 'unverifiable') {
        // 확인할 길이 없는 바이너리는 막을 것이 없는 단계만 돈다 (FR-8a) — 조용히 올리지도 않는다
        if (!isFull(input.permission)) return { ok: false, reason: UNVERIFIABLE_REASON }
      } else {
        const judged = judgeV2Agents(result?.stdout ?? '', opencodeV2Rules(input.permission))
        if (!judged.ok) return judged
      }

      if (input.resumeSessionId) {
        // 2.3.2의 `--session`은 없는 id로 새 세션을 만든다 — 대화가 말없이 처음부터 시작한다 (FR-14)
        const session = await exec({
          executable: input.executable,
          args: ['api', '--standalone', 'session.get', '--param', `sessionID=${input.resumeSessionId}`],
          cwd: input.cwd,
          env
        })
        if (session.exitCode !== 0) {
          return sessionMissing(session)
            ? { ok: false, reason: '이어받을 세션이 없습니다. OpenCode에 그 세션이 남아 있지 않습니다 — 새 대화로 시작하세요.' }
            : { ok: false, reason: 'OpenCode에서 이어받을 세션을 확인하지 못했습니다.' }
        }
      }
      return { ok: true }
    }
  }
}

function isFull(permission: Permission): boolean {
  return permission === 'full'
}
