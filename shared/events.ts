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

export type RunEvent =
  | (Base & { type: 'session'; sessionId: string })
  | (Base & { type: 'text'; text: string })
  | (Base & {
      type: 'tool_use'
      toolUseId: string
      name: string
      effect: ToolEffect
      targetPaths: string[]
      input: unknown
    })
  | (Base & { type: 'tool_result'; toolUseId: string; ok: boolean; summary: string })
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
 * seq를 채우기 전의 이벤트. 어댑터가 만들고 runner가 순번을 붙인다.
 *
 * `Omit<RunEvent, 'seq'>`를 그냥 쓰면 안 된다. Omit은 유니온에 분배되지 않고
 * `keyof`가 멤버들의 교집합(runId·seq·at·type)만 주기 때문에, 결과 타입이
 * `{ runId; at; type }`으로 쪼그라들어 text·toolUseId 같은 payload가 전부 사라진다.
 * 조건부 타입으로 감싸 유니온 각 멤버에 분배시킨다.
 */
type OmitSeq<T> = T extends unknown ? Omit<T, 'seq'> : never

export type RunEventInit = OmitSeq<RunEvent>
