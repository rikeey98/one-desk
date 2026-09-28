import { access, constants } from 'node:fs/promises'
import type { AgentAdapter, PreflightResult, ResolvedRunSpec, SpawnSpec } from '../types'
import { claudeCodePermissionArgs } from '../permission'
import { findExecutable, isBatchShim, type LookupOptions } from '../executable'
import type { RunEventInit, RunUsage, ToolEffect } from '@shared/events'
import {
  emptyUsage, reasoningText, stripNeedsAnswer, summarize, toolResultText, withLoopbackBypass
} from './common'
import {
  claudeDenialNotices, claudeNotice, claudeResultText, claudeToolDetail, isClaudeReadResult
} from './claudeCode.detail'

type RawEvent = RunEventInit

/**
 * 도구 이름 → 효과. 어느 도구가 파일을 쓰는지 아는 것은 어댑터의 책임이다.
 * Windows의 claude는 셸로 PowerShell을 쓴다(기록 103건) — 빠지면 `other`로 떨어진다.
 */
const TOOL_EFFECTS: Record<string, ToolEffect> = {
  Read: 'read', Glob: 'read', Grep: 'read', WebFetch: 'read', WebSearch: 'read',
  Edit: 'write', Write: 'write', NotebookEdit: 'write',
  Bash: 'execute', PowerShell: 'execute'
}

function toolEffect(name: string): ToolEffect {
  return TOOL_EFFECTS[name] ?? 'other'
}

function obj(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 프롬프트 크기 = 비캐시 입력 + 캐시에서 읽은 것 + 캐시에 쓴 것. 셋 다 모델이 읽은 토큰이다. */
function promptSize(u: Record<string, unknown>): number | null {
  const parts = [
    num(u['input_tokens']),
    num(u['cache_read_input_tokens']),
    num(u['cache_creation_input_tokens'])
  ]
  if (parts.every((p) => p === null)) return null
  return parts.reduce<number>((sum, p) => sum + (p ?? 0), 0)
}

/**
 * `result` 줄의 사용량. 없으면 null을 돌려주고 이벤트를 만들지 않는다 —
 * 빈 껍데기를 내면 화면이 "0토큰"으로 읽는다.
 *
 * **`contextTokens`는 `iterations`의 마지막 하나로 잰다.** 최상위 `usage`는 턴 안의
 * 모든 요청을 더한 값이라, 도구를 여러 번 쓴 턴에서 그것으로 창 대비 비율을 그리면
 * 100%를 넘는다 (spec §3-2). **`iterations`가 없으면 점유를 모른다(null)** — 예전에는
 * 최상위로 폴백했는데, 그러면 도구를 쓴 턴마다 링이 100% 가까이 튀었다가 가벼운 턴에
 * 다시 떨어졌다(`docs/sdlc/context-occupancy/`). 틀린 비율보다 모름이 낫다 — 화면은 앞
 * 턴의 점유를 그대로 보인다.
 */
function resultUsage(line: Record<string, unknown>): RunUsage | null {
  const u = obj(line['usage'])
  if (!u) return null

  const iterations = Array.isArray(u['iterations']) ? u['iterations'] : []
  const last = obj(iterations[iterations.length - 1])

  return emptyUsage({
    inputTokens: num(u['input_tokens']),
    outputTokens: num(u['output_tokens']),
    cacheReadTokens: num(u['cache_read_input_tokens']),
    cacheWriteTokens: num(u['cache_creation_input_tokens']),
    reasoningTokens: num(obj(u['output_tokens_details'])?.['thinking_tokens']),
    costUsd: num(line['total_cost_usd']),
    contextTokens: last ? promptSize(last) : null,
    contextWindow: mainContextWindow(obj(line['modelUsage']))
  })
}

/**
 * `modelUsage`에서 대화를 실제로 돈 모델의 창 크기. 키는 모델 이름이라 리터럴로 박지 않는다.
 *
 * 한 턴에 보조 모델(작은 창)이 같이 쓰이면 항목이 여럿이다. **목록의 첫 항목을 쓰지 않는다** —
 * 보조 모델이 앞에 오면 창을 5배 작게 잡아 비율이 부푼다. `parseLine`은 앞 줄(init의 모델)을
 * 기억하지 못하므로, **프롬프트(입력 + 캐시 읽기 + 캐시 쓰기)를 가장 많이 처리한 모델**을 고른다
 * — 대화를 싣고 도는 모델이 그것이다. 동률이면 앞의 것이다.
 */
function mainContextWindow(models: Record<string, unknown> | null): number | null {
  if (!models) return null
  let best: { prompt: number; window: number | null } | null = null
  for (const value of Object.values(models)) {
    const m = obj(value)
    if (!m) continue
    const prompt = (num(m['inputTokens']) ?? 0)
      + (num(m['cacheReadInputTokens']) ?? 0)
      + (num(m['cacheCreationInputTokens']) ?? 0)
    if (!best || prompt > best.prompt) best = { prompt, window: num(m['contextWindow']) }
  }
  return best?.window ?? null
}

/** 도구 입력에서 파일 경로를 뽑는다. 5단계의 스냅샷 트리거가 이걸 쓴다. */
function targetPaths(input: unknown): string[] {
  if (typeof input !== 'object' || input === null) return []
  const record = input as Record<string, unknown>
  const path = record['file_path'] ?? record['notebook_path']
  return typeof path === 'string' ? [path] : []
}

/** init의 `mcp_servers` 배열을 꺼낸다. 형태가 다르면 빈 배열 — 파싱 실패로 run을 죽이지 않는다. */
function mcpServers(obj: Record<string, unknown>): { name: string; status: string }[] {
  const raw = obj['mcp_servers']
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    .map((s) => ({ name: String(s['name'] ?? '?'), status: String(s['status'] ?? '?') }))
}

/**
 * 메시지의 content 블록. **객체가 아닌 원소(null 등)는 건너뛴다** — 캐스팅만 하고 두면
 * `block['type']`에서 던지고, 이 함수는 stdout 핸들러 안에서 불려 메인 프로세스가 죽는다(리뷰 반영).
 */
function readBlocks(obj: Record<string, unknown>): Record<string, unknown>[] {
  const message = obj['message']
  if (typeof message !== 'object' || message === null) return []
  const content = (message as Record<string, unknown>)['content']
  if (!Array.isArray(content)) return []
  return content.filter((block): block is Record<string, unknown> =>
    typeof block === 'object' && block !== null && !Array.isArray(block))
}

/** 줄의 메시지 id(`uuid`). 되돌리기·분기의 재료 — 저장만 한다 (conversation-events E7) */
function messageOrigin(line: Record<string, unknown>): { messageId?: string } {
  const uuid = line['uuid']
  return typeof uuid === 'string' && uuid ? { messageId: uuid } : {}
}

/**
 * 줄의 출처 — 하위 에이전트 호출 id와 메시지 id (FR-16·17).
 *
 * **값이 있을 때만 싣는다**(FR-7). 메인 스레드의 `parent_tool_use_id`는 null로 오는데, 그것을
 * 그대로 옮기면 모든 이벤트에 `"parentToolUseId":null`이 붙어 로그가 늘기만 하고 옛 로그와 모양이
 * 갈린다. 읽는 쪽은 키가 없으면 "메인 스레드(또는 모른다)"로 읽는다.
 */
function origin(line: Record<string, unknown>): { parentToolUseId?: string; messageId?: string } {
  const parent = line['parent_tool_use_id']
  return {
    ...(typeof parent === 'string' && parent ? { parentToolUseId: parent } : {}),
    ...messageOrigin(line)
  }
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
    // --model 바로 옆자리다 — 둘 다 "무엇으로 돌릴지"다. 값은 검증하지 않는다:
    // CLI 자신도 하지 않는다(`--effort bogus`도 오류 없이 통과, 2026-09-22 실측).
    if (spec.effort) args.push('--effort', spec.effort)
    if (spec.resumeSessionId) args.push('--resume', spec.resumeSessionId)

    // 프롬프트는 stdin으로 넘긴다. 맥락이 합쳐지면 수십 KB가 되는데
    // 커맨드 인자에는 OS별 길이 제한이 있다.
    return {
      cmd: spec.executable,
      args,
      env: withLoopbackBypass(process.env),
      cwd: spec.cwd
    }
  },

  parseLine(line: string, runId: string): RawEvent[] {
    const at = Date.now()
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      // 깨진 줄 때문에 run 전체를 죽이지 않는다 (설계 §11)
      return [{ type: 'raw', runId, at, line }]
    }
    // 객체가 아닌 JSON(`null`·수·배열)도 깨진 줄이다 — 그대로 두면 아래에서 던지고, 이 함수는 stdout
    // 핸들러 안에서 불려 메인 프로세스가 죽는다(리뷰 반영 2026-09-27).
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return [{ type: 'raw', runId, at, line }]
    }
    const obj = parsed as Record<string, unknown>

    switch (obj['type']) {
      case 'system': {
        if (obj['subtype'] !== 'init') {
          // 압축·재시도·권한 거부·모델 대체 (FR-18). 그 밖의 하위 타입은 버린다 — 원본 줄은
          // raw.jsonl에 남는다. 공지는 run의 상태·실패 이유를 건드리지 않는다(FR-8).
          const notice = claudeNotice(obj)
          return notice ? [{ type: 'notice', runId, at, ...notice, ...messageOrigin(obj) }] : []
        }
        const events: RawEvent[] = [
          { type: 'session', runId, at, sessionId: String(obj['session_id'] ?? '') }
        ]
        // 실제로 쓰인 모델은 여기서만 온다 — 사용자가 모델 칸을 비웠어도
        // 무엇이 돌았는지 알 수 있는 유일한 자리다 (docs/sdlc/run-info/ FR-9).
        const model = obj['model']
        if (typeof model === 'string' && model) {
          events.push({ type: 'usage', runId, at, usage: emptyUsage({ model }) })
        }

        // CLI는 첫 줄에 MCP 서버의 연결 상태를 알려준다. 이걸 흘려보내면 연결
        // 실패가 화면 어디에도 남지 않고, agent가 이슈·메모를 전혀 못 건드리는
        // 채로 run이 "성공"으로 끝난다 — 사용자는 결과를 보고 나서야 뭔가
        // 이상하다는 걸 알고, 이유는 알 방법이 없다.
        //
        // run을 실패로 만들지는 않는다. MCP가 필요 없는 프롬프트도 있고,
        // agent가 이미 한 일을 무효로 돌릴 이유가 없다. 다른 이유로 실패한 run의
        // 실패 이유 자리도 차지하지 않는다 — 이 어댑터는 `errorEventsAreFailureReasons`를
        // 켜지 않는다(사내 프록시 환경에서는 이 경고가 늘 붙어 진짜 원인을 가린다).
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
        const src = origin(obj)
        for (const block of readBlocks(obj)) {
          if (block['type'] === 'text') {
            const { text } = stripNeedsAnswer(String(block['text'] ?? ''))
            events.push({ type: 'text', runId, at, text, ...src })
          } else if (block['type'] === 'tool_use') {
            const name = String(block['name'] ?? '')
            events.push({
              type: 'tool_use', runId, at,
              toolUseId: String(block['id'] ?? ''),
              name,
              effect: toolEffect(name),
              targetPaths: targetPaths(block['input']),
              input: block['input'],
              ...src
            })
          } else if (block['type'] === 'thinking') {
            // **본문만 싣고 signature는 정규화 이벤트 어디에도 싣지 않는다**(E3) — 3~5KB 서명이
            // 로그를 불필요하게 키운다. 원본 줄째로는 raw.jsonl에 남는다.
            // **본문이 빈(공백뿐인) thinking은 이벤트를 내지 않는다**(spec §9-1 결정, 2026-09-27 —
            // §7-A의 "빈 본문도 낸다"를 되돌렸다). claude의 생각은 대부분 서명만 온다(기록 1,851개 중
            // 1,800개) — 그것을 "생각 · N초" 줄로 내면 도구 호출마다 줄이 끼어 펼친 턴의 활동 묶음이
            // 조각나고(FR-40: reasoning은 묶음을 끊는다), 2,000개 창과 IPC push를 소비한다.
            // 시간은 claude가 주지 않는다 — 화면이 이벤트 시각으로 잰다.
            const thinking = typeof block['thinking'] === 'string' ? block['thinking'] : ''
            if (thinking.trim() === '') continue
            events.push({
              type: 'reasoning', runId, at,
              ...reasoningText(thinking),
              startedAt: null, endedAt: null,
              ...src
            })
          }
          // redacted_thinking은 버린다 — 본문이 암호문이다.
        }
        return events
      }

      case 'user': {
        const events: RawEvent[] = []
        const src = origin(obj)
        const blocks = readBlocks(obj).filter((block) => block['type'] === 'tool_result')
        // tool_use_result는 줄에 하나다. 결과 블록이 여럿인 줄이면 어느 것의 것인지 모른다 —
        // 엉뚱한 결과에 붙이느니 싣지 않는다(기록에서는 줄마다 블록 하나였다).
        const single = blocks.length === 1
        const toolUseResult = single ? obj['tool_use_result'] : undefined
        // 읽기인지 가르는 것은 그 모양뿐이다(줄에 도구 이름이 없다). 모양을 못 붙이는 줄(블록이 여럿)은
        // 원문 출력도 싣지 않는다 — 파일 내용이 로그·IPC로 새느니 요약만 남긴다(§7-A, 리뷰 반영
        // 2026-09-27). 하위 에이전트가 넘긴 줄도 tool_use_result를 싣는다(2.1.280 바이너리).
        const withOutput = single && !isClaudeReadResult(toolUseResult)
        for (const block of blocks) {
          // 성공 시 is_error 필드가 아예 없다 (실측 확인됨)
          const ok = block['is_error'] !== true
          const text = claudeResultText(block['content'])
          const detail = claudeToolDetail(toolUseResult, text, !ok)
          events.push({
            type: 'tool_result', runId, at,
            toolUseId: String(block['tool_use_id'] ?? ''),
            ok,
            summary: summarize(block['content']),
            // 읽기의 원문은 싣지 않는다(spec §7-A) — 로그의 가장 큰 몫인데 화면이 쓰지 않는다
            ...(withOutput ? toolResultText(text) : {}),
            ...(detail ? { detail } : {}),
            ...src
          })
        }
        return events
      }

      case 'result': {
        const raw = typeof obj['result'] === 'string' ? obj['result'] : ''
        const { text: resultText, marked: needsAnswer } = stripNeedsAnswer(raw)
        const events: RawEvent[] = [{
          type: 'result', runId, at,
          status: obj['is_error'] === true ? 'failed' : 'succeeded',
          resultText,
          sessionId: typeof obj['session_id'] === 'string' ? obj['session_id'] : null,
          needsAnswer
        }]
        const usage = resultUsage(obj)
        if (usage) events.push({ type: 'usage', runId, at, usage })
        // 권한 때문에 막힌 호출 — 권위 있는 기록이다(FR-19). 순서는 result → usage → notice…
        const src = messageOrigin(obj)
        for (const notice of claudeDenialNotices(obj)) {
          events.push({ type: 'notice', runId, at, ...notice, ...src })
        }
        return events
      }

      default:
        return []
    }
  }
} satisfies AgentAdapter
