import type { Repo } from './models'
import { parseWslPath, wslUncOf } from './wslPath'

/**
 * 경로로 등록 repo를 찾는 규칙 — 도크 구획·코드 칸·인박스 묶음(`renderer/conversation.ts`)과 홈 요약(`core/home/summary.ts`)이
 * 같이 쓴다 (`docs/sdlc/inbox-views/` NFR-2, `docs/sdlc/home/` FR-6). 따로 적으면 같은 대화를 화면마다 다른 repo로 부른다.
 */

/**
 * 경로 비교용 정규형 (`docs/sdlc/dock-repo-sections/` FR-1). 끝의 구분자를 떼고, Windows 경로(드라이브 문자로 시작하거나
 * `\`를 품은 것)는 구분자를 `\`로 맞추고 대소문자를 가리지 않는다 — posix 경로는 대소문자가 다르면 다른 디렉토리다.
 *
 * 코드 칸의 대상 repo(`renderer/code/target.ts`)와 편집 줄 경로(`renderer/code/editPath.ts`)도 이 규칙을 쓴다 — 따로 적으면 구획은
 * `api`인데 칸은 "등록된 repo가 아닙니다"인 어긋남이 생긴다.
 */
export function pathKey(path: string): string {
  // WSL UNC는 두 접두사(`\\wsl$`·`\\wsl.localhost`)가 같은 폴더다 (`docs/sdlc/wsl-support/` §4의 9). 접두사와
  // distro는 Windows 규칙(대소문자 무시)으로, 그 뒤의 Linux 경로는 posix 규칙으로 — `\\wsl$\\U\\a`와 `\\wsl$\\U\\A`는 다른 디렉토리다.
  const wsl = parseWslPath(path)
  if (wsl) return `${wslUncOf(wsl.distro.toLowerCase(), '/')}\\${wsl.linuxPath}`
  const windows = /^[a-zA-Z]:/.test(path) || path.includes('\\')
  const trimmed = path.replace(/[\\/]+$/, '')
  return windows ? trimmed.replace(/\//g, '\\').toLowerCase() : trimmed
}

/**
 * 작업 디렉토리 경로와 같은 등록 repo — 없으면 null. **경로로 repo를 찾는 자리는 이것 하나다.**
 */
export function repoOfCwd<R extends Pick<Repo, 'path'>>(cwd: string, repos: readonly R[]): R | null {
  const key = pathKey(cwd)
  return repos.find((r) => pathKey(r.path) === key) ?? null
}
