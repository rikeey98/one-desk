import { wslUncOf } from '@shared/wslPath'
import type { DistroList } from './distros'

/**
 * 등록 폼의 `WSL` 버튼이 여는 대화상자의 시작 폴더 (`docs/sdlc/wsl-repo-setup/` FR-11).
 *
 * **늘 배포판 하나의 홈이다** — Windows 대화상자는 `\\wsl$`(배포판 목록)를 시작 폴더로 받지 않는다(파일 이름 칸에 들어간다,
 * 2026-10-14 실측). 그래서 기본 배포판, 못 정했으면 목록의 첫 배포판이다. 다른 배포판은 대화상자 주소줄의 `Linux`로 간다.
 * 홈을 못 물으면 그 배포판의 루트다 — 열리기만 하면 사람이 찾아간다. 배포판이 없으면 null(OS 기본 위치).
 */
export async function folderStartOf(deps: {
  list: () => Promise<DistroList>
  /** 그 배포판의 홈(`/home/me`). 못 물으면 던진다 — `WslHome.of` */
  home: (distro: string) => Promise<string>
}): Promise<string | null> {
  const { distros, defaultDistro } = await deps.list()
  const distro = defaultDistro ?? distros[0]
  // `wsl.exe -d`의 인자가 된다 — `-`로 시작하는 이름은 옵션으로 읽힌다(wsl-support FR-33)
  if (!distro || distro.startsWith('-')) return null
  try {
    return wslUncOf(distro, await deps.home(distro))
  } catch {
    return wslUncOf(distro, '/')
  }
}
