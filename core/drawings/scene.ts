/**
 * 그림 장면의 모양 (docs/sdlc/drawings/ spec §2·FR-3). core에게 장면은 검증한 문자열이다 — Excalidraw를 모른다(경계 1).
 *
 * 요소의 종류는 보지 않는다: 이미지·끼워 넣기를 여기서 거부하면 그것이 하나 섞인 그림은 영영 저장되지 않는다. 막는 자리는
 * 화면이다(FR-25·27).
 */

/** Excalidraw 파일과 같은 머리에 요소 배열만 — 나중에 내보내기를 붙이면 묘비만 걸러 쓰면 된다 */
export const EMPTY_SCENE = JSON.stringify({ type: 'excalidraw', version: 2, source: 'one-desk', elements: [] })

/** 8 MiB(문자 수). 이미지를 막으므로 손으로 그린 그림은 이보다 훨씬 작다 — 자동 저장마다 통째로 쓰는 값의 상한이다 */
export const MAX_SCENE_CHARS = 8 * 1024 * 1024

export function assertScene(text: string): void {
  if (text.length > MAX_SCENE_CHARS) throw new Error('그림이 너무 큽니다 (8 MiB 초과)')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('그림을 읽을 수 없습니다 (JSON이 아닙니다)')
  }
  const elements = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as { elements?: unknown }).elements
    : undefined
  if (!Array.isArray(elements)) throw new Error('그림을 읽을 수 없습니다 (elements가 배열이 아닙니다)')
  for (const el of elements) {
    if (typeof el !== 'object' || el === null || typeof (el as { id?: unknown }).id !== 'string') {
      throw new Error('그림을 읽을 수 없습니다 (id가 없는 요소가 있습니다)')
    }
  }
}
