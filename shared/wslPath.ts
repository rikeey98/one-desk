/**
 * WSL2 UNC 경로 (`docs/sdlc/wsl-support/` spec FR-2·§0).
 *
 * WSL2는 자기 파일시스템을 Windows에 `\\wsl$\<distro>\…`(Windows 11은 `\\wsl.localhost\<distro>\…`도)로
 * 노출한다. 앱은 **UNC를 저장하고** distro와 Linux 경로를 여기서 판다 — `repo.path`를 읽는 자리(존재 검사·asset
 * `file_path` 접두사·`run.cwd`·`repoOfCwd`·폴더 선택)가 전부 Windows 파일시스템 경로를 전제하므로, UNC를 저장하면
 * 그 자리들이 한 줄도 안 바뀐다(spec §0).
 *
 * **순수 문자열 함수다** — `node:path`를 쓰지 않는다. 호스트 OS의 규칙을 타면 macOS 개발 장비의 테스트와 Windows
 * 사용자의 동작이 갈린다. `shared/`에 두는 이유: 렌더러(repo 탭의 파싱 결과·`pathKey`의 접두사 접기)와 core(실행
 * 환경 판정)가 같은 판정을 써야 한다 — 따로 적으면 설정 화면은 받는데 실행은 거부하는 경로가 생긴다.
 */

export interface WslPath {
  /** 배포판 이름 — `wsl.exe -d`에 그대로 준다 */
  distro: string
  /** WSL 안의 절대 경로, `/` 구분, 끝 구분자 없음(루트는 `/`) */
  linuxPath: string
}

/** 저장 접두사 — `wslUncOf`가 만드는 쪽. 읽을 때는 `wsl.localhost`도 받는다 */
const STORE_PREFIX = '\\\\wsl$\\'

const PREFIX = /^[\\/]{2}(?:wsl\$|wsl\.localhost)(?=[\\/]|$)/i

/** 두 접두사 중 하나로 시작하는가 — 파싱이 되는지는 보지 않는다(안내문 판정용) */
export function isWslUnc(path: string): boolean {
  return PREFIX.test(path)
}

/**
 * UNC → distro와 Linux 경로. 모양이 아니면 null.
 *
 * distro가 비거나 `-`로 시작하면 null이다 — `wsl.exe -d <distro>`의 인자가 되는 값이라 `-`로 시작하면 옵션으로
 * 읽힐 수 있다(FR-33). `..`는 접지 않는다 — 뜻을 바꾸지 않고 그대로 돌려주며, 막을지는 호출자가 정한다.
 */
export function parseWslPath(path: string): WslPath | null {
  const m = PREFIX.exec(path)
  if (!m) return null
  const rest = path.slice(m[0].length).replace(/\\/g, '/')
  const parts = rest.split('/').filter((p) => p !== '')
  const distro = parts[0]
  if (!distro || distro.startsWith('-')) return null
  const linuxPath = '/' + parts.slice(1).join('/')
  return { distro, linuxPath }
}

/** distro와 Linux 경로 → 저장 접두사(`\\wsl$\`)의 UNC. `parseWslPath`와 왕복한다 */
export function wslUncOf(distro: string, linuxPath: string): string {
  const tail = linuxPath.split('/').filter((p) => p !== '').join('\\')
  return tail ? `${STORE_PREFIX}${distro}\\${tail}` : `${STORE_PREFIX}${distro}`
}
