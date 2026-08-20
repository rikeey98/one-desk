/**
 * 도크 높이의 클램프와 보존.
 *
 * 순수 함수로 떼어낸 이유는 `conversation.ts`·`inbox.ts`와 같다 — 경계값을
 * 컴포넌트를 렌더링하지 않고 검증할 수 있다. jsdom은 실제 레이아웃을 계산하지
 * 않으므로 "정말 커 보이는가"는 어차피 테스트가 답할 수 없는 질문이고,
 * 여기서 답할 수 있는 것(범위를 벗어나지 않는가)만 여기서 답한다.
 *
 * **core의 `app_setting`이 아니라 localStorage를 쓴다.** 도크 높이는 core가
 * 알 필요가 없는 순수 UI 기하값이라, IPC를 거쳐 SQLite까지 보낼 이유가 없다.
 */

export const DOCK_HEIGHT_KEY = 'one-desk.dockHeight'

/** 저장된 값이 없을 때의 비율. 원래 CSS에 박혀 있던 34%다. */
export const DEFAULT_DOCK_RATIO = 0.34

/** 헤더와 입력만 남아 대화록이 사라지는 것을 막는 하한 */
export const MIN_DOCK_PX = 120

/** 위의 이슈·메모 영역이 완전히 사라지는 것을 막는 상한 */
export const MAX_DOCK_RATIO = 0.85

/**
 * 창 안에 들어가는 높이로 자른다.
 *
 * **창이 하한보다도 작으면 상한이 이긴다.** 하한을 지키면 도크가 창을 넘어
 * 위 영역이 음수 높이가 된다 — 좁은 도크가 넘치는 도크보다 낫다.
 */
export function clampDockHeight(px: number, viewportPx: number): number {
  // 숫자가 아니면 기본 비율로 돌아간다. NaN을 그대로 흘리면 React가 style을
  // 통째로 무시해 도크가 접힌 것처럼 보이고, 원인은 드래그 계산 한 곳에 있는데
  // 증상은 "높이가 사라졌다"라서 추적이 어렵다.
  const wanted = Number.isFinite(px) ? px : viewportPx * DEFAULT_DOCK_RATIO
  const max = viewportPx * MAX_DOCK_RATIO
  return Math.min(max, Math.max(MIN_DOCK_PX, wanted))
}

/** 저장된 높이. 없거나 망가졌으면 기본 비율. 어느 쪽이든 지금 창 크기로 클램프한다. */
export function readDockHeight(viewportPx: number): number {
  const raw = localStorage.getItem(DOCK_HEIGHT_KEY)
  const parsed = raw === null ? Number.NaN : Number(raw)
  // 큰 화면에서 저장하고 작은 화면에서 열 수 있으므로 되살릴 때도 클램프한다.
  const base = Number.isFinite(parsed) ? parsed : viewportPx * DEFAULT_DOCK_RATIO
  return clampDockHeight(base, viewportPx)
}

export function writeDockHeight(px: number): void {
  localStorage.setItem(DOCK_HEIGHT_KEY, String(px))
}
