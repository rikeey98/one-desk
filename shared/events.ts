import type { RunStatus } from './models'

/** 어댑터가 판정한 도구의 효과. 파일 스냅샷 트리거에 쓴다(5단계). */
export type ToolEffect = 'read' | 'write' | 'execute' | 'other'

/**
 * 한 턴이 무엇으로 돌았고 얼마나 썼는지 (`docs/sdlc/run-info/`).
 *
 * **모든 필드가 nullable이다 — 모르는 것과 0은 다르다.** OpenCode는 모델도
 * 컨텍스트 창도 알려주지 않고, 옛 claude 스트림에는 `usage` 자체가 없을 수 있다.
 * 0으로 채우면 화면이 "안 썼다"는 거짓말을 한다.
 *
 * 병합 규칙은 필드마다 다르다 (spec §3-3) — 토큰·비용은 **더하고**, model과
 * context 둘은 **마지막 non-null이 이긴다**. 누적은 `RunManager`가 하므로
 * 어댑터는 자기가 본 한 줄만 담으면 된다.
 */
export interface RunUsage {
  /** 실제로 돈 모델. claude는 관측값(`init.model`), opencode는 알 수 없어 null */
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  reasoningTokens: number | null
  /** 정가 기준 추정이다 — 청구액이 아니다 */
  costUsd: number | null
  /**
   * **마지막 요청의 프롬프트 크기**(입력 + 캐시 읽기 + 캐시 쓰기).
   * 토큰 합계와 다른 수다 — 합계로 창 대비 비율을 그리면 100%를 넘는다(spec §3-2).
   */
  contextTokens: number | null
  /** 모델의 컨텍스트 창. 모르면 null이고, 그때는 비율을 그리지 않는다 */
  contextWindow: number | null
}

interface Base {
  runId: string
  /** run 안에서 단조 증가. UI의 key, 중복 제거, 정렬에 쓴다. */
  seq: number
  at: number
}

/**
 * jsdiff의 structured patch hunk 모양 그대로 (`docs/sdlc/conversation-events/` spec §3).
 * opencode의 unified diff는 어댑터가 이 모양으로 편다. **opencode의 줄 본문은 파일 그대로가 아니다** —
 * CLI가 공통 앞 공백을 걷어 보낸다(1.18.30 `trimDiff`, 리뷰 2026-09-27). 줄 번호는 맞다.
 */
export interface PatchHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  /** 첫 글자가 ' '·'-'·'+'인 줄. `\ No newline at end of file` 줄은 어댑터가 뺀다 */
  lines: string[]
}

export interface EditFileDetail {
  /** CLI가 준 경로 그대로(대개 절대 경로) */
  path: string
  operation: 'edit' | 'create' | 'overwrite' | 'delete'
  /** 새 파일(claude Write create)은 빈 배열이다 — 내용은 tool_use.input에 있다 */
  hunks: PatchHunk[]
  /** 상한 때문에 버린 hunk 줄 수. 0이면 전부다. 잘린 hunk는 머리(oldStart·newStart)만 믿는다 */
  hunksTruncated: number
  /** 자르기 전에 센 추가·삭제 줄 수. 모르면 null */
  added: number | null
  removed: number | null
  /** 바꾸기 전 파일 전체. claude만 준다 */
  before: string | null
  /** before가 없는 이유. 새 파일이라 원래 없으면 null */
  beforeMissing: 'unavailable' | 'too_large' | null
}

/**
 * 도구 결과의 구조화된 세부. **CLI 방언은 어댑터가 이 넷으로 접는다** — CLI의 필드 이름은
 * `core/runner/adapters/` 밖으로 나가지 않는다(spec NFR-2).
 * 새 모양이라 모르는 값은 키를 빼지 않고 null로 적는다(spec FR-7의 예외).
 */
export type ToolDetail =
  | {
      kind: 'shell'
      /** 모르면 null — claude는 실패할 때만 알려준다 */
      exitCode: number | null
      interrupted: boolean
      timedOut: boolean
    }
  | {
      kind: 'search'
      count: number
      /** count가 센 것 — claude Grep 기본은 파일, opencode grep은 일치한 줄 */
      unit: 'files' | 'matches' | 'lines'
      /** 도구가 결과를 잘랐다(더 있다) */
      truncated: boolean
    }
  | { kind: 'edit'; files: EditFileDetail[] }
  | {
      kind: 'subagent'
      /** opencode의 하위 세션 id */
      sessionId: string | null
      model: string | null
      toolCount: number | null
      durationMs: number | null
    }

/** 타임라인에 서는 공지의 종류. 문구는 어댑터가 만들고 화면은 그대로 그린다 */
export type NoticeKind = 'compact' | 'retry' | 'permission_denied' | 'model_fallback'

/**
 * 메시지 단위 출처. **값이 있을 때만 싣는다**(spec FR-7) — 메인 스레드의 모든 이벤트에
 * `"parentToolUseId":null`이 붙으면 로그가 늘기만 하고 옛 로그와 모양이 괜히 갈린다.
 * 읽는 쪽은 키가 없으면 "모른다"로 읽는다.
 */
interface Origin {
  /** 이 이벤트를 낳은 하위 에이전트 호출(tool_use id). 메인 스레드면 키가 없다 */
  parentToolUseId?: string
  /** 원본 줄의 메시지 id. 되돌리기·분기의 재료 — 저장만 한다 */
  messageId?: string
}

export type RunEvent =
  | (Base & { type: 'session'; sessionId: string })
  | (Base & Origin & { type: 'text'; text: string })
  | (Base & Origin & {
      type: 'tool_use'
      toolUseId: string
      name: string
      effect: ToolEffect
      targetPaths: string[]
      input: unknown
    })
  | (Base & Origin & {
      type: 'tool_result'
      toolUseId: string
      ok: boolean
      /** 200자 요약. 옛 소비자가 읽는 필드라 규칙을 바꾸지 않는다 */
      summary: string
      /** 결과 전문의 **끝부분**(≤ 65,536자). 없으면 옛 로그이거나 결과가 비었거나 읽기 도구다 */
      output?: string
      /** output을 만들며 버린 앞부분 글자 수. 없으면 전부다 */
      outputTruncated?: number
      detail?: ToolDetail
    })
  /** 모델의 생각. 서명·암호문은 싣지 않는다 — 원본 줄째로는 raw.jsonl에 남는다 */
  | (Base & Origin & {
      type: 'reasoning'
      /** 생각 본문. **빈 문자열일 수 있다** — claude는 대부분 본문 없이 서명만 보낸다 */
      text: string
      /** opencode만 준다. claude는 null — 화면이 앞 이벤트로 추정한다 */
      startedAt: number | null
      endedAt: number | null
      /** 상한 때문에 버린 뒷부분 글자 수. 없으면 전부다 */
      truncated?: number
    })
  /** 압축·재시도·권한 거부·모델 대체. run의 상태·결과·실패 이유에 영향을 주지 않는다 */
  | (Base & Origin & {
      type: 'notice'
      kind: NoticeKind
      /** 화면에 그대로 나가는 한 줄 */
      text: string
      /** permission_denied: 막힌 호출. 같은 id의 공지는 화면에 한 번만 선다 */
      toolUseId?: string
    })
  | (Base & { type: 'error'; message: string })
  /** 모델·토큰·컨텍스트. 한 run에 여러 번 올 수 있고 manager가 접는다 */
  | (Base & { type: 'usage'; usage: RunUsage })
  | (Base & {
      type: 'result'
      status: RunStatus
      resultText: string
      sessionId: string | null
      needsAnswer: boolean
    })
  /** 파싱에 실패한 줄. 한 줄이 깨졌다고 run 전체를 죽이지 않는다 (설계 §11). */
  | (Base & { type: 'raw'; line: string })

export type RunEventType = RunEvent['type']

/**
 * run 하나가 메모리와 IPC에 들고 있는 이벤트의 창 (`docs/sdlc/conversation-events/` spec FR-29).
 *
 * **core의 `readLog`와 렌더러 스토어가 이 하나를 같이 본다** — 따로 적으면 되살린 턴과
 * 실시간 턴의 모양이 갈린다. 둘 다 **끝에서부터** 두 한계를 모두 지키는 만큼만 남긴다
 * (넘으면 가장 오래된 것부터 버린다). 전체는 로그 파일에 있다.
 *
 * 개수는 이 기능 전의 스토어 상한(2,000) 그대로이고, 글자는 무거운 이벤트(출력·hunk·
 * before로 최대 약 33만 자)가 개수 상한까지 쌓이는 것을 막는다(spec §5-1).
 */
export const RUN_EVENT_WINDOW = { maxEvents: 2000, maxChars: 8_000_000 } as const

/**
 * 이벤트의 무게 = 로그 한 줄의 길이(`JSON.stringify(event).length`, 개행 제외).
 *
 * `createLogWriter`가 쓰는 줄이 정확히 `JSON.stringify(event)`라, `readLog`는 파싱하지 않은
 * 줄의 길이로 같은 수를 얻는다. **바이트가 아니라 UTF-16 글자 수다** — 읽는 쪽이 utf8로
 * 디코드한 문자열의 길이를 보기 때문이다. 순수 함수다(spec NFR-4).
 */
export function eventWeight(event: RunEvent): number {
  return JSON.stringify(event).length
}

/**
 * detail의 개수·줄 번호·도구 수·시간이 지켜야 하는 모양 — **음이 아닌 정수**.
 *
 * 어댑터가 detail을 **싣기 전에**, 렌더러가 로그에서 되살린 detail을 **읽을 때** 같은 판정을 쓴다
 * (리뷰 반영 2026-09-27). 두 자리가 따로 적으면 어댑터를 통과한 detail(소수 시간·음수)이 로그와
 * IPC에는 실리고 화면에서만 말없이 통째로 사라진다. 종료 코드와 시각은 여기 들지 않는다 — 음수·큰
 * 수가 정상이다. 순수 함수다(spec NFR-4).
 */
export function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * seq를 채우기 전의 이벤트. 어댑터가 만들고 runner가 순번을 붙인다.
 *
 * `Omit<RunEvent, 'seq'>`를 그냥 쓰면 안 된다. Omit은 유니온에 분배되지 않고
 * `keyof`가 멤버들의 교집합(runId·seq·at·type)만 주기 때문에, 결과 타입이
 * `{ runId; at; type }`으로 쪼그라들어 text·toolUseId 같은 payload가 전부 사라진다.
 * 조건부 타입으로 감싸 유니온 각 멤버에 분배시킨다.
 */
type OmitSeq<T> = T extends unknown ? Omit<T, 'seq'> : never

export type RunEventInit = OmitSeq<RunEvent>
