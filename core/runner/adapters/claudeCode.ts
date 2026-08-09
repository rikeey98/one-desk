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
    const args = [
      '-p',
      '--output-format', 'stream-json',
      // --verbose 없이 stream-json을 쓰면 CLI가 실행을 거부한다 (실측 확인됨)
      '--verbose',
      ...claudeCodePermissionArgs(spec.permission)
    ]

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
            events.push({ type: 'text', runId, at, text: String(block['text'] ?? '') })
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
        const needsAnswer = raw.trimStart().startsWith(NEEDS_ANSWER_MARK)
        const resultText = needsAnswer
          ? raw.trimStart().slice(NEEDS_ANSWER_MARK.length).trimStart()
          : raw
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
