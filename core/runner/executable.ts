import { access, constants } from 'node:fs/promises'
import { posix, win32 } from 'node:path'

/**
 * PATHEXT가 비어 있을 때 쓸 기본값.
 * 실제 cmd.exe의 기본값은 더 길지만(.VBS, .JS 등) 우리가 spawn할 만한 것만 남긴다.
 * .JS를 넣으면 같은 디렉토리의 claude.js를 실행 파일로 오인할 수 있다.
 */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD'

export interface LookupOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
}

/**
 * PATH가 비어 있는 GUI 실행 환경을 위한 폴백 디렉토리.
 *
 * Finder/Dock에서 연 macOS 앱은 launchd의 최소 환경만 받아 PATH에
 * /usr/bin:/bin 정도만 있다. Linux 데스크톱 런처도 같다.
 * nvm/fnm/volta 아래의 npm 전역 설치는 경로에 Node 버전이 들어가
 * 예측할 수 없으므로 덮지 않는다 — 그 경우는 workspace 설정이 탈출구다.
 */
function fallbackDirs(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const p = platform === 'win32' ? win32 : posix
  const home = (platform === 'win32' ? env['USERPROFILE'] : env['HOME']) ?? ''
  const dirs: string[] = []
  if (home) {
    dirs.push(p.join(home, '.local', 'bin'))
    dirs.push(p.join(home, '.claude', 'local'))
  }
  if (platform !== 'win32') {
    dirs.push('/opt/homebrew/bin')
    dirs.push('/usr/local/bin')
  }
  return dirs
}

/**
 * 탐색할 절대 경로 후보를 순서대로 만든다. 파일시스템을 건드리지 않는다.
 *
 * platform을 인자로 받는 이유: node:path의 기본 join은 실행 중인 OS를 따르므로
 * macOS에서 join('C:\\bin', 'claude.exe')가 'C:\bin/claude.exe'가 된다.
 * 그러면 Windows 동작을 개발 장비에서 검증할 방법이 없다.
 */
export function executableCandidates(name: string, opts: LookupOptions = {}): string[] {
  const platform = opts.platform ?? process.platform
  const env = opts.env ?? process.env
  const p = platform === 'win32' ? win32 : posix

  const pathDirs = (env['PATH'] ?? '').split(p.delimiter).filter(Boolean)
  const dirs = [...pathDirs, ...fallbackDirs(platform, env)]

  // Windows는 확장자로 실행 가능 여부를 정한다. 확장자 없는 후보는 만들지 않는다 —
  // access(X_OK)가 Windows에서 실행 권한을 보지 않고 존재 여부처럼 동작해서,
  // npm이 Git Bash용으로 함께 까는 확장자 없는 sh 스크립트를 통과시킨다.
  const suffixes =
    platform === 'win32' ? (env['PATHEXT'] ?? DEFAULT_PATHEXT).split(';').filter(Boolean) : ['']

  return dirs.flatMap((dir) => suffixes.map((suffix) => p.join(dir, name + suffix)))
}

/** 후보를 순서대로 훑어 첫 번째로 접근 가능한 것을 돌려준다. */
export async function findExecutable(
  name: string,
  opts: LookupOptions = {}
): Promise<string | null> {
  for (const candidate of executableCandidates(name, opts)) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // 다음 후보
    }
  }
  return null
}

/**
 * shell 없이 spawn할 수 없는 배치 shim인가.
 *
 * Node는 CVE-2024-27980 대응 이후 .cmd/.bat를 shell:true 없이 spawn하면
 * EINVAL을 던진다(18.20.2+ / 20.12.2+). shell을 켜면 인자가 cmd.exe의 인용
 * 규칙을 타서 공백이 든 경로가 깨지고, terminate가 죽이는 대상이 cmd.exe
 * 껍데기가 되어 취소가 자식에 닿지 않는다. 그래서 켜지 않고 거부한다.
 */
export function isBatchShim(file: string): boolean {
  const lower = file.toLowerCase()
  return lower.endsWith('.cmd') || lower.endsWith('.bat')
}
