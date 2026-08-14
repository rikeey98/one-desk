import { access, constants } from 'node:fs/promises'
import type { AgentAdapter, PreflightResult, ResolvedRunSpec, SpawnSpec } from '../types'
import { claudeCodePermissionArgs } from '../permission'
import { findExecutable, isBatchShim, type LookupOptions } from '../executable'
import type { RunEventInit, ToolEffect } from '@shared/events'

type RawEvent = RunEventInit

/** 도구 이름 → 효과. 어느 도구가 파일을 쓰는지 아는 것은 어댑터의 책임이다. */
const TOOL_EFFECTS: Record<string, ToolEffect> = {
  Read: 'read', Glob: 'read', Grep: 'read', WebFetch: 'read', WebSearch: 'read',
  Edit: 'write', Write: 'write', NotebookEdit: 'write',
  Bash: 'execute'
}

function toolEffect(name: string): ToolEffect {
  return TOOL_EFFECTS[name] ?? 'other'
}

/** 도구 입력에서 파일 경로를 뽑는다. 5단계의 스냅샷 트리거가 이걸 쓴다. */
function targetPaths(input: unknown): string[] {
  if (typeof input !== 'object' || input === null) return []
  const record = input as Record<string, unknown>
  const path = record['file_path'] ?? record['notebook_path']
  return typeof path === 'string' ? [path] : []
}

function summarize(content: unknown): string {
  const text = typeof content === 'string' ? content : JSON.stringify(content ?? '')
  return text.length > 200 ? `${text.slice(0, 200)}…` : text
}

/** init의 `mcp_servers` 배열을 꺼낸다. 형태가 다르면 빈 배열 — 파싱 실패로 run을 죽이지 않는다. */
function mcpServers(obj: Record<string, unknown>): { name: string; status: string }[] {
  const raw = obj['mcp_servers']
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    .map((s) => ({ name: String(s['name'] ?? '?'), status: String(s['status'] ?? '?') }))
}

function readBlocks(obj: Record<string, unknown>): Record<string, unknown>[] {
  const message = obj['message']
  if (typeof message !== 'object' || message === null) return []
  const content = (message as Record<string, unknown>)['content']
  return Array.isArray(content) ? (content as Record<string, unknown>[]) : []
}

const NEEDS_ANSWER_MARK = '[NEEDS_ANSWER]'

/**
 * 첫 줄의 [NEEDS_ANSWER] 표식을 떼어낸다.
 *
 * 같은 내용이 assistant 텍스트 블록으로 먼저 흐르고 result에 다시 담기므로,
 * result에서만 벗겨내면 표식이 도크 로그에 날것으로 새어나온다. 두 경로 모두 여기를 쓴다.
 */
function stripNeedsAnswer(raw: string): { text: string; marked: boolean } {
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith(NEEDS_ANSWER_MARK)) return { text: raw, marked: false }
  return { text: trimmed.slice(NEEDS_ANSWER_MARK.length).trimStart(), marked: true }
}

/**
 * .cmd/.bat는 shell 없이 spawn할 수 없고(EINVAL), shell을 켜면 인용과 취소가
 * 함께 깨진다. 암호 같은 EINVAL 대신 행동 가능한 안내를 준다.
 */
const BATCH_SHIM_REASON =
  'claude.cmd는 직접 실행할 수 없습니다. 네이티브 설치 스크립트로 claude.exe를 설치하거나, workspace 설정에 claude.exe의 절대 경로를 지정하세요.'

// `: AgentAdapter`가 아니라 `satisfies`인 이유: preflight의 두 번째 인자(opts)는
// 테스트가 platform과 env를 넣는 이음매다. 인터페이스로 표기하면 그 인자가
// 타입에서 잘려 테스트가 부를 수 없고, 인터페이스에 얹으면 OpenCode 어댑터까지
// 번진다. satisfies는 계약을 지키면서 구체 타입의 추가 인자를 남긴다.
export const claudeCodeAdapter = {
  kind: 'claude-code',

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
      const found = await findExecutable('claude', opts)
      if (!found) {
        return {
          ok: false,
          reason:
            'PATH에서 claude 실행 파일을 찾을 수 없습니다. workspace 설정에서 경로를 지정하세요.'
        }
      }
      executable = found
    }
    // 배치 shim 판별은 두 경로가 합류한 뒤 한 번만 한다. 명시 경로와 탐색
    // 결과에 따로 두면 한쪽이 조용히 빠져도 테스트가 못 잡는다 —
    // 탐색 쪽은 개발 장비(macOS)에서 .cmd 경로를 만들 방법이 없기 때문이다.
    if (isBatchShim(executable)) return { ok: false, reason: BATCH_SHIM_REASON }
    return { ok: true, executable }
  },

  buildCommand(spec: ResolvedRunSpec): SpawnSpec {
    // MCP 도구는 --permission-mode로 자동 승인되지 않는다 (실측 노트 Q22).
    // 서버 단위로 --allowedTools에 명시해야 하고, 빠뜨리면 agent가 issue/memo를
    // 전혀 못 고치는데 실패가 조용하다.
    const mcpToolPrefixes = spec.mcp ? [`mcp__${spec.mcp.serverName}`] : []

    const args = [
      '-p',
      '--output-format', 'stream-json',
      // --verbose 없이 stream-json을 쓰면 CLI가 실행을 거부한다 (실측 확인됨)
      '--verbose',
      ...claudeCodePermissionArgs(spec.permission, mcpToolPrefixes)
    ]

    if (spec.mcp) {
      // 토큰은 파일 안에만 둔다. --mcp-config는 JSON 문자열도 받지만 인자는
      // ps aux로 같은 머신의 다른 사용자에게 그대로 보인다.
      args.push('--mcp-config', spec.mcp.configFile)
      // 사용자의 개인 MCP 설정이 딸려 들어오지 않게 한다.
      args.push('--strict-mcp-config')
    }

    if (spec.model) args.push('--model', spec.model)
    if (spec.resumeSessionId) args.push('--resume', spec.resumeSessionId)

    // 프롬프트는 stdin으로 넘긴다. 맥락이 합쳐지면 수십 KB가 되는데
    // 커맨드 인자에는 OS별 길이 제한이 있다.
    return {
      cmd: spec.executable,
      args,
      env: { ...process.env } as Record<string, string>,
      cwd: spec.cwd
    }
  },

  parseLine(line: string, runId: string): RawEvent[] {
    const at = Date.now()
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(line) as Record<string, unknown>
    } catch {
      // 깨진 줄 때문에 run 전체를 죽이지 않는다 (설계 §11)
      return [{ type: 'raw', runId, at, line }]
    }

    switch (obj['type']) {
      case 'system': {
        if (obj['subtype'] !== 'init') return []
        const events: RawEvent[] = [
          { type: 'session', runId, at, sessionId: String(obj['session_id'] ?? '') }
        ]
        // CLI는 첫 줄에 MCP 서버의 연결 상태를 알려준다. 이걸 흘려보내면 연결
        // 실패가 화면 어디에도 남지 않고, agent가 이슈·메모를 전혀 못 건드리는
        // 채로 run이 "성공"으로 끝난다 — 사용자는 결과를 보고 나서야 뭔가
        // 이상하다는 걸 알고, 이유는 알 방법이 없다.
        //
        // run을 실패로 만들지는 않는다. MCP가 필요 없는 프롬프트도 있고,
        // agent가 이미 한 일을 무효로 돌릴 이유가 없다.
        for (const server of mcpServers(obj)) {
          if (server.status === 'connected') continue
          events.push({
            type: 'error', runId, at,
            message: `MCP 서버 '${server.name}'에 연결하지 못했습니다 (상태: ${server.status}). 이 run에서 agent는 이슈·메모를 읽거나 쓸 수 없습니다.`
          })
        }
        return events
      }

      case 'assistant': {
        const events: RawEvent[] = []
        for (const block of readBlocks(obj)) {
          if (block['type'] === 'text') {
            const { text } = stripNeedsAnswer(String(block['text'] ?? ''))
            events.push({ type: 'text', runId, at, text })
          } else if (block['type'] === 'tool_use') {
            const name = String(block['name'] ?? '')
            events.push({
              type: 'tool_use', runId, at,
              toolUseId: String(block['id'] ?? ''),
              name,
              effect: toolEffect(name),
              targetPaths: targetPaths(block['input']),
              input: block['input']
            })
          }
          // thinking은 버린다. signature가 3~5KB라 로그를 불필요하게 키운다.
        }
        return events
      }

      case 'user': {
        const events: RawEvent[] = []
        for (const block of readBlocks(obj)) {
          if (block['type'] !== 'tool_result') continue
          events.push({
            type: 'tool_result', runId, at,
            toolUseId: String(block['tool_use_id'] ?? ''),
            // 성공 시 is_error 필드가 아예 없다 (실측 확인됨)
            ok: block['is_error'] !== true,
            summary: summarize(block['content'])
          })
        }
        return events
      }

      case 'result': {
        const raw = typeof obj['result'] === 'string' ? obj['result'] : ''
        const { text: resultText, marked: needsAnswer } = stripNeedsAnswer(raw)
        return [{
          type: 'result', runId, at,
          status: obj['is_error'] === true ? 'failed' : 'succeeded',
          resultText,
          sessionId: typeof obj['session_id'] === 'string' ? obj['session_id'] : null,
          needsAnswer
        }]
      }

      default:
        return []
    }
  }
} satisfies AgentAdapter
