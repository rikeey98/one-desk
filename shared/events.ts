import type { RunStatus } from './models'

/** 어댑터가 판정한 도구의 효과. 파일 스냅샷 트리거에 쓴다(5단계). */
export type ToolEffect = 'read' | 'write' | 'execute' | 'other'

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
