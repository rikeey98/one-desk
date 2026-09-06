import { access, constants } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  AgentAdapter, PreflightResult, ResolvedRunSpec, SpawnSpec, VerifyRunnableInput
} from '../types'
import { opencodePermissionConfig } from '../permission'
import { findExecutable, isBatchShim, type LookupOptions } from '../executable'
import { stripNeedsAnswer, summarize, withLoopbackBypass } from './common'
import type { RunEventInit, ToolEffect } from '@shared/events'

type RawEvent = RunEventInit

/**
 * 도구 이름 → 효과. **소문자다** — claude는 `Edit`, opencode는 `edit`이다.
 * 어느 도구가 파일을 쓰는지 아는 것은 어댑터의 책임이다 (전체 설계 §329).
 */
const TOOL_EFFECTS: Record<string, ToolEffect> = {
  read: 'read', glob: 'read', grep: 'read', list: 'read',
  webfetch: 'read', websearch: 'read', lsp: 'read',
  write: 'write', edit: 'write', patch: 'write',
  bash: 'execute'
}

function toolEffect(name: string): ToolEffect {
  return TOOL_EFFECTS[name] ?? 'other'
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
  const { stdout } = await execFileAsync(executable, ['debug', 'config'], { cwd, env })
  return stdout
}

const BATCH_SHIM_REASON =
  'opencode.cmd는 직접 실행할 수 없습니다. 네이티브 설치본(opencode.exe)을 쓰거나, workspace 설정에 opencode.exe의 절대 경로를 지정하세요.'

// `: AgentAdapter`가 아니라 `satisfies`인 이유는 claudeCode.ts와 같다 —
// preflight의 두 번째 인자(opts)가 테스트의 이음매인데, 인터페이스로 표기하면
// 타입에서 잘려 테스트가 부를 수 없다.
export const opencodeAdapter = {
  kind: 'opencode',

  async preflight(explicitPath: string | null, opts: LookupOptions = {}): Promise<PreflightResult> {
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
    if (isBatchShim(executable)) return { ok: false, reason: BATCH_SHIM_REASON }
    return { ok: true, executable }
  },

  buildCommand(spec: ResolvedRunSpec): SpawnSpec {
    const args = ['run', '--format', 'json']

    // --auto는 "명시적으로 deny가 아닌 권한을 자동 승인"이다. 전체 허용에서만
    // 쓴다 (전체 설계 §376). 다른 단계에 켜면 우리가 막은 것이 열린다.
    if (spec.permission === 'full') args.push('--auto')

    // 모델은 provider/model 형식이다 (전체 설계 §199).
    if (spec.model) args.push('-m', spec.model)
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
   * 임의 키. 셋 다 증상이 같다 — **헤드리스 실행이 아무 말 없이 영원히 멈추고
   * 동시 실행 슬롯을 계속 점유한다** (설계 §3-3·§8).
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
        '헤드리스 실행에는 답할 사람이 없어 멈춥니다. ' +
        `${input.cwd}/opencode.json 에서 해당 항목을 지우거나 allow/deny로 바꾸세요.`
    }
  },

  parseLine(line: string, runId: string): RawEvent[] {
    const at = Date.now()
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(line) as Record<string, unknown>
    } catch {
      // 깨진 줄 때문에 run 전체를 죽이지 않는다 (전체 설계 §11)
      return [{ type: 'raw', runId, at, line }]
    }

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
        const state = (typeof part['state'] === 'object' && part['state'] !== null)
          ? (part['state'] as Record<string, unknown>)
          : {}
        const toolUseId = String(part['callID'] ?? '')
        // 한 줄에 입력과 결과가 함께 온다 — 이미 끝난 도구를 보고받는 것이다.
        // (그래서 diff 뷰어의 before 스냅샷을 여기서 걸 수 없다. 설계 §10-1)
        return [
          {
            type: 'tool_use', runId, at, toolUseId, name,
            effect: toolEffect(name),
            targetPaths: targetPaths(state['input']),
            input: state['input']
          },
          {
            type: 'tool_result', runId, at, toolUseId,
            ok: state['status'] === 'completed',
            summary: summarize(state['output'])
          }
        ]
      }

      case 'text': {
        if (!part) return []
        const { text, marked } = stripNeedsAnswer(String(part['text'] ?? ''))
        // OpenCode에는 claude의 result 같은 종료 이벤트가 없다. text마다 result를
        // 함께 내면 RunManager가 덮어써서 마지막 것이 남는다 (설계 §7).
        return [
          { type: 'text', runId, at, text },
          {
            type: 'result', runId, at,
            status: 'succeeded',
            resultText: text,
            sessionId,
            needsAnswer: marked
          }
        ]
      }

      default:
        // step_finish의 토큰·비용은 아직 쓰는 곳이 없다.
        return []
    }
  }
} satisfies AgentAdapter
