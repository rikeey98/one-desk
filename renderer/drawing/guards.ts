/**
 * 그림 칸에 들어오는 것을 거르는 판정 (docs/sdlc/drawings/ spec FR-27·FR-30). 캔버스(`DrawingCanvas`)는 Excalidraw에 붙이기만 하고 판정은
 * 여기 둔다 — jsdom은 Excalidraw를 그리지 못해 컴포넌트에 둔 판정은 단위 테스트로 고정할 수 없다.
 */

/**
 * 붙여넣기를 막는가. 이미지 파일 붙여넣기는 `tools.image: false`가 이미 막는다(plan 0단계 4). 남는 것은 다른 Excalidraw에서 복사한
 * 요소에 이미지가 섞인 경우다 — 이 앱은 이미지 파일을 저장하지 않으므로 다시 열면 빈 칸이 된다.
 */
export function blocksPaste<T extends {
  files?: Record<string, unknown> | null
  elements?: readonly { type?: unknown }[] | null
}>(data: T): boolean {
  if (data.files && Object.keys(data.files).length > 0) return true
  return (data.elements ?? []).some((e) => e.type === 'image')
}

/**
 * 끌어 놓기를 막는가. 파일이면 막는다 — `.excalidraw`·장면이 든 PNG는 놓는 순간 지금 그림을 통째로 바꾼다(plan 0단계 4).
 * 글자(요소의 링크 등)는 둔다 — 끼워 넣기로 바뀌는 길은 `validateEmbeddable`이 막는다.
 */
export function blocksDrop(dataTransfer: { files: { length: number } } | null): boolean {
  return (dataTransfer?.files.length ?? 0) > 0
}

const REMOTE_FONT = /^url\(\s*["']?https:\/\/esm\.sh\/@excalidraw\/excalidraw@/

/**
 * `FontFace`의 원본 목록에서 Excalidraw의 원격 대체 원본을 걷는다. Excalidraw는 글꼴마다 로컬 다음에 esm.sh를 붙이고, Chromium은
 * 그것을 등록할 때마다 CSP 위반으로 알린다(실제로 내려받지는 않는다 — plan 0단계 3). 원본이 그것 하나뿐이면 그대로 둔다.
 */
export function stripRemoteFontSources(source: string): string {
  const parts = source.split(/,\s*(?=url\(|local\()/)
  const kept = parts.filter((p) => !REMOTE_FONT.test(p.trim()))
  return kept.length > 0 && kept.length < parts.length ? kept.join(', ') : source
}
