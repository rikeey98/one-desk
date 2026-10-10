/**
 * 코드 칸의 열림과 폭 (docs/sdlc/code-editor/ spec FR-4). 화면 기하값이라 core가 아니라 이 장비의 localStorage에 둔다
 * (`listWidth.ts`·`dockHeight.ts`와 같은 방식). 경계값을 렌더링 없이 고정하려고 순수 함수로 뗀다.
 */

/** 칸의 종류 — 한 번에 하나만 보인다(spec FR-3). 변경사항은 셋째 사이클에서 더한다 */
export type PaneKind = 'files' | 'terminal'
const PANE_KINDS: readonly PaneKind[] = ['files', 'terminal']

export const MIN_PANE_PX = 320
/**
 * 본문(세 패널 + 도크)의 하한. 항목을 연 패널이 180px 목록 열 둘을 옆에 남기고도 상세를 쓸 수 있는 폭이다 —
 * 칸은 창 오른쪽 끝에 위아래 전체로 서므로(안 B, 2026-10-10) 본문 전체가 그만큼 좁아진다.
 */
export const MIN_MAIN_PX = 560
/** 기억한 폭이 없을 때 — 사이드바를 뺀 창 폭의 이만큼. CSS `.code-box`의 기본 폭과 같은 값이다 */
export const DEFAULT_PANE_RATIO = 0.4
/** 키보드 ←→ 한 번 */
export const PANE_STEP_PX = 16

/**
 * 본문 + 칸에 쓸 수 있는 폭(`availablePx` — 창에서 사이드바와 경계를 뺀 것) 안으로 자른다. 기억한 값이 없으면 40%다.
 * 칸은 320px, 본문은 560px 아래로 가지 않는다 — 둘 다 못 지키면 **칸의 하한이 이긴다**(그보다 좁은 편집기는 쓸 데가
 * 없다, plan 위험 10).
 */
export function clampPaneWidth(px: number | null, availablePx: number): number {
  const wanted = px !== null && Number.isFinite(px) ? px : availablePx * DEFAULT_PANE_RATIO
  const max = availablePx - MIN_MAIN_PX
  return Math.max(MIN_PANE_PX, Math.min(max, wanted))
}

const KIND_KEY = 'one-desk.codePane.kind'
const WIDTH_KEY = 'one-desk.codePane.width'

/** 저장소 접근은 막힐 수 있다(사이트 데이터 차단 등) — 그때는 기본값으로 돈다. */
function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch { /* 기억만 못 할 뿐이다 */ }
}

/** 열려 있던 칸의 종류. 모르는 값(다른 버전이 남긴 것)이면 닫힘이다 */
export function readPaneKind(): PaneKind | null {
  const raw = read(KIND_KEY)
  return PANE_KINDS.find((k) => k === raw) ?? null
}

export function writePaneKind(kind: PaneKind | null): void {
  write(KIND_KEY, kind)
}

export function readPaneWidth(): number | null {
  const raw = read(WIDTH_KEY)
  const parsed = raw === null ? Number.NaN : Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

export function writePaneWidth(px: number): void {
  write(WIDTH_KEY, String(Math.round(px)))
}

/** 경계를 두 번 누르면 기본(반반)으로 — 기억한 폭을 지운다 */
export function resetPaneWidth(): void {
  write(WIDTH_KEY, null)
}
