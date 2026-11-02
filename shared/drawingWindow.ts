/**
 * 그림 창의 해시 (docs/sdlc/drawings/ spec FR-8). 창 하나 = 그림 하나.
 *
 * main이 이 함수로 해시를 만들고 렌더러(`main.tsx`)가 같은 함수로 읽는다 — main에는 단위 테스트가 없어 판정을 여기 둔다
 * (`panelWindow.ts`와 같은 이유). 패널 창(`#panel/…`)에 끼우지 않는 것은 범위의 모양이 달라서다 — 패널 창은
 * (종류, workspace, repo)이고 그림 창은 행 하나다.
 */
const PREFIX = 'drawing'

export function drawingHash(drawingId: string): string {
  return `#${PREFIX}/${encodeURIComponent(drawingId)}`
}

/** 그림 창의 해시가 아니거나 모양이 틀리면 null */
export function parseDrawingHash(hash: string): string | null {
  const body = hash.startsWith('#') ? hash.slice(1) : hash
  const parts = body.split('/')
  if (parts.length !== 2 || parts[0] !== PREFIX || parts[1] === '') return null
  try {
    return decodeURIComponent(parts[1]!)
  } catch {
    return null
  }
}

/** 해시가 그림 창을 가리키는가 — 모양이 틀려도 `#drawing/`로 시작하면 그림 창이다(앱 창을 그리지 않는다). */
export function isDrawingHash(hash: string): boolean {
  return hash.replace(/^#/, '').startsWith(`${PREFIX}/`)
}
