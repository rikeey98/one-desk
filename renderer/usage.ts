import type { RunUsage } from '@shared/events'
import type { Run } from '@shared/models'

/**
 * 실행 정보 한 줄의 표기 규칙 (`docs/sdlc/run-info/spec.md` §5-2).
 *
 * 컴포넌트에서 떼어 둔다 — 규칙을 단독으로 고정할 수 있어야 한다. 화면을
 * 건드리지 않고 경계값(999/1000/0.4%)을 테스트로 못박는 자리다.
 *
 * **모르는 값은 조각을 통째로 뺀다.** 0이나 `-`로 채우면 화면이 "안 썼다"는
 * 거짓말을 한다 (FR-2).
 */

/** 1,000 미만은 그대로, 그 이상은 k, 1,000,000부터는 M. */
export function formatTokens(n: number): string {
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/**
 * 컨텍스트 조각. **창 크기를 아는 경우에만 비율로 적는다** (FR-3) —
 * OpenCode는 창을 알려주지 않으므로 거기서는 토큰 수만 보인다.
 */
export function formatContext(
  tokens: number | null, window: number | null
): string | null {
  if (tokens === null) return null
  const percent = contextPercent(tokens, window)
  return percent === null ? `컨텍스트 ${formatTokens(tokens)}` : `컨텍스트 ${percent}`
}

/**
 * 점유의 퍼센트 글자만 — `5%`·`<1%`·`>99%`. 창이나 점유를 모르면 null이다(비율을 지어내지 않는다).
 *
 * 대화 헤더의 링 곁 글자다(`docs/sdlc/conversation-timeline/` spec §8의 2, 결정 2026-09-27). 링의
 * 이름(`사용량, 컨텍스트 5%`)도 `formatContext`를 거쳐 이 함수를 쓴다 — 둘이 따로 반올림하면 화면과
 * 스크린리더가 다른 수를 말한다.
 */
export function contextPercent(tokens: number | null, window: number | null): string | null {
  if (tokens === null || window === null || window <= 0) return null
  const ratio = (tokens / window) * 100
  // 0%는 "안 썼다"로 읽힌다. 99% 위로도 올리지 않는다 — iterations가 없는
  // 버전에서 과대평가될 수 있어 100%+가 그려질 수 있다 (run-info spec §8).
  if (ratio < 0.5) return '<1%'
  if (ratio > 99) return '>99%'
  return `${Math.round(ratio)}%`
}

/** 토큰 조각. 한쪽만 알아도 만든다. */
function tokenPiece(usage: RunUsage): string | null {
  const parts: string[] = []
  if (usage.inputTokens !== null) parts.push(`${formatTokens(usage.inputTokens)}↑`)
  if (usage.outputTokens !== null) parts.push(`${formatTokens(usage.outputTokens)}↓`)
  return parts.length > 0 ? parts.join(' ') : null
}

/**
 * 한 줄에 그릴 조각들. **모델 · 토큰 · 컨텍스트** 순서다 (FR-1).
 * 비어 있으면 줄 자체를 그리지 않는다.
 */
export function usagePieces(usage: RunUsage | null): string[] {
  if (!usage) return []
  // 비용은 여기 넣지 않는다 — 화면에 돈을 상시 띄우지 않는다 (FR-4). title로 읽는다.
  return [
    usage.model,
    tokenPiece(usage),
    formatContext(usage.contextTokens, usage.contextWindow)
  ].filter((piece): piece is string => piece !== null)
}

/** 호버로 읽는 정확한 수치. 줄이지 않고, 캐시와 비용까지 담는다. */
export function usageTitle(usage: RunUsage | null): string | null {
  if (!usage) return null
  const n = (value: number) => value.toLocaleString('en-US')
  const parts: string[] = []
  if (usage.inputTokens !== null) parts.push(`입력 ${n(usage.inputTokens)}`)
  if (usage.outputTokens !== null) parts.push(`출력 ${n(usage.outputTokens)}`)
  if (usage.cacheReadTokens !== null) parts.push(`캐시 읽기 ${n(usage.cacheReadTokens)}`)
  if (usage.cacheWriteTokens !== null) parts.push(`캐시 쓰기 ${n(usage.cacheWriteTokens)}`)
  if (usage.reasoningTokens !== null) parts.push(`추론 ${n(usage.reasoningTokens)}`)
  // 정가 기준 추정이다 — 청구액이 아니다 (spec §7).
  if (usage.costUsd !== null) parts.push(`$${usage.costUsd.toFixed(4)}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** 대화 하나의 누적 사용량 (`docs/sdlc/conversation-timeline/` spec FR-36). */
export interface ConversationUsage {
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  /** 정가 기준 추정이다 — 청구액이 아니다 */
  costUsd: number | null
  /** 점유를 아는 마지막 턴의 점유. 더하지 않는다 */
  contextTokens: number | null
  /** 그 **같은 턴**의 창 크기. 그 턴이 창을 모르면 null이다 — 앞 턴의 창을 빌려 오지 않는다 */
  contextWindow: number | null
}

/**
 * 대화 헤더의 링과 사용량 팝오버가 읽는 누적 (FR-36).
 *
 * 토큰·비용은 core의 `mergeUsage`처럼 아는 것만 더한다. 컨텍스트는 더하지 않는다 — 더하면 턴이
 * 쌓일수록 창을 넘는다(CLAUDE.md "사용량의 합계와 컨텍스트 점유는 다른 수다").
 *
 * **컨텍스트는 점유를 아는 마지막 턴의 (점유, 창) 한 쌍이다** (FR-36 "usage가 있는 가장 최근 턴의
 * contextTokens ÷ contextWindow", 다듬음 2026-09-27 — 리뷰가 찾은 것). 두 칸을 따로 "마지막
 * non-null"로 고르면 창을 모르는 턴의 점유를 앞 턴의 창으로 나눈다 — 모델을 바꾼 턴이면 창이 다르다.
 * 점유를 모르는 턴(사용량만 있는 턴)은 건너뛴다: 앞에서 안 점유를 지우지 않는다.
 *
 * **만든 순서로 접는다.** `Conversation.runs`는 오래된 순이지만 그 순서에 기대지 않는다 —
 * 최신순 목록이 들어오면 "마지막 턴"이 첫 턴이 된다.
 *
 * 모델·추론 토큰은 담지 않는다 — 대화의 모델은 턴마다 다를 수 있고, 팝오버가 그리지 않는다.
 * 아는 값이 하나도 없으면 null이다(화면은 링도 글자도 그리지 않는다).
 */
export function conversationUsage(runs: readonly Run[]): ConversationUsage | null {
  const add = (a: number | null, b: number | null): number | null =>
    a === null ? b : b === null ? a : a + b

  const ordered = [...runs].sort((a, b) => a.createdAt - b.createdAt)
  let total: ConversationUsage = {
    inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
    costUsd: null, contextTokens: null, contextWindow: null
  }
  for (const run of ordered) {
    const u = run.usage
    if (!u) continue
    total = {
      inputTokens: add(total.inputTokens, u.inputTokens),
      outputTokens: add(total.outputTokens, u.outputTokens),
      cacheReadTokens: add(total.cacheReadTokens, u.cacheReadTokens),
      cacheWriteTokens: add(total.cacheWriteTokens, u.cacheWriteTokens),
      costUsd: add(total.costUsd, u.costUsd),
      // 점유를 알면 그 턴의 창과 **짝으로** 가져온다. 모르면 앞의 짝을 그대로 둔다.
      ...(u.contextTokens !== null
        ? { contextTokens: u.contextTokens, contextWindow: u.contextWindow }
        : { contextTokens: total.contextTokens, contextWindow: total.contextWindow })
    }
  }
  return Object.values(total).every((value) => value === null) ? null : total
}
