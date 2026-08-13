import { access, constants } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import type { AgentAdapter, PreflightResult, ResolvedRunSpec, SpawnSpec } from '../types'
import { claudeCodePermissionArgs } from '../permission'
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

async function findExecutable(name: string): Promise<string | null> {
  const paths = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean)
  for (const dir of paths) {
    const candidate = join(dir, name)
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // 다음 후보
    }
  }
  return null
}

export const claudeCodeAdapter: AgentAdapter = {
  kind: 'claude-code',

  async preflight(explicitPath: string | null): Promise<PreflightResult> {
    if (explicitPath) {
      try {
        await access(explicitPath, constants.X_OK)
        return { ok: true, executable: explicitPath }
      } catch {
        return { ok: false, reason: `설정된 경로에서 실행할 수 없습니다: ${explicitPath}` }
      }
    }
    const found = await findExecutable('claude')
    if (!found) {
      return {
        ok: false,
        reason: 'PATH에서 claude 실행 파일을 찾을 수 없습니다. workspace 설정에서 경로를 지정하세요.'
      }
    }
    return { ok: true, executable: found }
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
        return [{ type: 'session', runId, at, sessionId: String(obj['session_id'] ?? '') }]
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
}
