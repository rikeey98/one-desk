import type { RunUsage } from '@shared/events'

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
  if (window === null || window <= 0) return `컨텍스트 ${formatTokens(tokens)}`

  const ratio = (tokens / window) * 100
  // 0%는 "안 썼다"로 읽힌다. 99% 위로도 올리지 않는다 — iterations가 없는
  // 버전에서 과대평가될 수 있어 100%+가 그려질 수 있다 (spec §8).
  if (ratio < 0.5) return '컨텍스트 <1%'
  if (ratio > 99) return '컨텍스트 >99%'
  return `컨텍스트 ${Math.round(ratio)}%`
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
