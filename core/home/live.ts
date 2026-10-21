import type { RunEvent } from '@shared/events'

/**
 * 돌고 있는 턴의 "지금" — 지금 도는 도구와 마지막 텍스트 (`docs/sdlc/home/` §6-1, FR-10).
 *
 * DB에는 없는 값이다(run 행은 끝나야 `resultText`가 찍힌다). 홈이 접힌 턴의 로그를 읽지 않고도 이것을 보이려면
 * core가 run마다 **메모리의 마지막 값 하나**를 쥐어야 한다 — 요금제 사용률(`plan-usage` FR-1)과 같은 모양이다.
 * 이벤트로 만들지 않고 저장하지 않는다. 앱을 다시 켜면 비어 있고 화면은 "진행 중"만 쓴다.
 *
 * 순수 함수다 — `core/index.ts`가 manager의 `onEvent`에서 `applyRunEvent`를, run 종료에서 `dropRun`을 부른다.
 */

export interface LiveSnapshot {
  /** 가장 최근 `tool_use`의 이름. 아직 도구를 안 썼으면 null */
  currentTool: string | null
  /** 가장 최근 `text`의 앞부분(`LIVE_TEXT_MAX`자). 아직 글이 없으면 null */
  lastText: string | null
}

export const LIVE_TEXT_MAX = 160

export type LiveMap = Map<string, LiveSnapshot>

/**
 * 이벤트 하나를 반영한다. `tool_use`는 도구를, `text`는 마지막 글을 갈아 끼우고, `result`는 그 run의 항목을 지운다
 * (결과가 왔으면 더는 "돌고 있는 것"이 아니다 — 종료 기록이 늦어도 홈이 낡은 도구 이름을 보이지 않게).
 * 하위 에이전트의 이벤트(`parentToolUseId`)도 그대로 반영한다 — 사람이 보기에 "지금 하는 일"이기 때문이다.
 * 그 밖의 이벤트는 아무것도 바꾸지 않는다. 맵을 제자리에서 고친다.
 */
export function applyRunEvent(map: LiveMap, event: RunEvent): void {
  if (event.type === 'result') {
    map.delete(event.runId)
    return
  }
  if (event.type !== 'tool_use' && event.type !== 'text') return
  const prev = map.get(event.runId) ?? { currentTool: null, lastText: null }
  if (event.type === 'tool_use') {
    map.set(event.runId, { ...prev, currentTool: event.name })
  } else {
    const text = event.text.trim()
    if (text === '') return
    map.set(event.runId, { ...prev, lastText: text.slice(0, LIVE_TEXT_MAX) })
  }
}

/** run이 끝났다(어떤 상태로든). 결과 없이 죽은 run(실패·취소)의 항목을 지우는 자리다 */
export function dropRun(map: LiveMap, runId: string): void {
  map.delete(runId)
}
