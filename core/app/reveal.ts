import type { AppPaths, RevealTarget } from '@shared/models'

/** 정보 탭의 "폴더 열기"가 열 수 있는 대상. 이 둘뿐이다 */
export const REVEAL_TARGETS: readonly RevealTarget[] = ['data', 'logs'] as const

/**
 * 렌더러가 열어달라고 한 대상을 실제 디렉토리로 바꾼다.
 *
 * **경로가 아니라 이름을 받는다** (settings-screen spec NFR-3) — `repos.openInEditor`가
 * 경로 대신 id를 받는 것과 같은 이유다. 렌더러가 임의의 경로를 파일 탐색기로 열 수
 * 있으면 안 되므로, 정해진 둘 밖의 값은 던진다. `shell.openPath`는 electron 전용이라
 * 이 판정만 core로 떼어내 테스트한다(`core/editor/vscodeUrl.ts`와 같은 구조).
 */
export function revealDir(target: unknown, paths: AppPaths): string {
  switch (target) {
    case 'data': return paths.dataDir
    case 'logs': return paths.logDir
    default: throw new Error(`열 수 없는 대상입니다: ${String(target)}`)
  }
}
