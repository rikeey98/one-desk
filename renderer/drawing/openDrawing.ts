import type { DrawingSummary } from '@shared/models'

/**
 * repo마다 마지막으로 본 그림 (docs/sdlc/drawings/ spec FR-14). 보기 취향이라 이 장비의 localStorage에 둔다(터미널의 본 탭과 같은 자리) —
 * 잃어도 된다.
 */
const key = (repoId: string) => `one-desk.drawing.open.${repoId}`

export function readOpenDrawing(repoId: string): string | null {
  try { return localStorage.getItem(key(repoId)) } catch { return null }
}

export function writeOpenDrawing(repoId: string, drawingId: string): void {
  try { localStorage.setItem(key(repoId), drawingId) } catch { /* 기억만 못 할 뿐이다 */ }
}

/** 기억한 그림이 목록에 있으면 그것, 아니면 가장 최근에 고친 그림, 없으면 null */
export function pickOpenDrawing(list: readonly DrawingSummary[], remembered: string | null): string | null {
  if (remembered !== null && list.some((d) => d.id === remembered)) return remembered
  let latest: DrawingSummary | null = null
  for (const d of list) if (!latest || d.updatedAt > latest.updatedAt) latest = d
  return latest?.id ?? null
}
