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
