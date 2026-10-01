import type { PanelKind } from '@shared/panelWindow'

/**
 * 패널 창의 목록 폭과 숨김 (docs/sdlc/item-windows/ FR-27·28). 경계값을 렌더링 없이 고정하려고 순수 함수로 뗀다
 * (`dockHeight.ts`와 같은 이유). 화면 기하값이라 core가 아니라 이 장비의 localStorage에 둔다 — 종류마다 하나.
 */
export const DEFAULT_LIST_PX = 340
export const MIN_LIST_PX = 200
/** 상세가 사라지지 않게 */
export const MAX_LIST_RATIO = 0.6
/** 키보드 ←→ 한 번 */
export const LIST_STEP_PX = 16

/** 창 안에 들어가는 폭으로 자른다. 창이 하한보다 좁으면 상한이 이긴다(목록이 창을 넘지 않는다). */
export function clampListWidth(px: number, viewportPx: number): number {
  const wanted = Number.isFinite(px) ? px : DEFAULT_LIST_PX
  const max = viewportPx * MAX_LIST_RATIO
  return Math.min(max, Math.max(MIN_LIST_PX, wanted))
}

const widthKey = (kind: PanelKind) => `one-desk.panelWindow.${kind}.listWidth`
const hiddenKey = (kind: PanelKind) => `one-desk.panelWindow.${kind}.listHidden`

/** 저장소 접근은 막힐 수 있다(사이트 데이터 차단 등) — 그때는 기본값으로 돈다. */
function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* 기억만 못 할 뿐이다 */ }
}

export function readListWidth(kind: PanelKind): number {
  const raw = read(widthKey(kind))
  const parsed = raw === null ? Number.NaN : Number(raw)
  return Number.isFinite(parsed) ? parsed : DEFAULT_LIST_PX
}

export function writeListWidth(kind: PanelKind, px: number): void {
  write(widthKey(kind), String(Math.round(px)))
}

export function readListHidden(kind: PanelKind): boolean {
  return read(hiddenKey(kind)) === '1'
}

export function writeListHidden(kind: PanelKind, hidden: boolean): void {
  write(hiddenKey(kind), hidden ? '1' : '0')
}
