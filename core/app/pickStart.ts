/** 폴더 선택 대화상자를 어디서 여는가. 지금은 WSL 하나뿐이다 */
export type PickStart = 'wsl'

/**
 * 렌더러가 넘긴 `pickDirectory`의 인자를 믿을 수 있는 값으로 (`docs/sdlc/wsl-repo-setup/` FR-13).
 *
 * **뜻만 받고 경로는 받지 않는다** — `{ start: 'wsl' }`이면 시작 폴더를 core가 정하고(`wsl.folderStart`), 그 밖의 값은 전부
 * "OS 기본 위치"다. 렌더러가 대화상자의 시작 경로를 정하는 통로를 두지 않는 것은 `reveal.ts`가 이름만 받는 것과 같은 이유다.
 * electron IPC에는 테스트가 없어 이 판정만 여기 떼어 둔다.
 */
export function pickStartOf(options: unknown): PickStart | null {
  if (typeof options !== 'object' || options === null) return null
  return (options as { start?: unknown }).start === 'wsl' ? 'wsl' : null
}
