/**
 * 앱 창의 제목 줄 (`docs/sdlc/code-editor/` FR-1, 2026-10-10). 앱 창은 OS 제목 표시줄 대신 렌더러가 그린 줄(`.titlebar`)을 쓰고,
 * 최소화·최대화·닫기는 OS가 그 줄 오른쪽 끝에 겹쳐 그린다(Window Controls Overlay — `electron/windows.ts`).
 *
 * main은 CSS를 읽을 수 없으므로 OS 단추의 높이·색을 여기서 받는다. **색은 `renderer/index.css`의 `--bg-canvas`(바탕)·
 * `--text-secondary`(기호)와 같아야 한다** — `titleBar.test.ts`가 CSS를 읽어 비교한다.
 */
export const TITLEBAR_HEIGHT = 36

export const TITLEBAR_COLORS = {
  light: { color: '#f4f4f5', symbolColor: '#52525b' },
  dark: { color: '#151518', symbolColor: '#b4b4bb' }
} as const
