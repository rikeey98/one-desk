import { pathKey } from '../conversation'

/** Windows 경로인가 — `pathKey`와 같은 판정(드라이브 문자로 시작하거나 `\`를 품었다) */
function isWindowsPath(path: string): boolean {
  return /^[a-zA-Z]:/.test(path) || path.includes('\\')
}

function isAbsolute(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\') || /^[a-zA-Z]:/.test(path)
}

/** `/` 구분 상대 경로를 정리한다. `..`로 루트 밖에 나가면 null */
function normalizeRelative(path: string): string | null {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length === 0) return null
      out.pop()
      continue
    }
    out.push(part)
  }
  return out.length > 0 ? out.join('/') : null
}

/**
 * 대화록 편집 줄의 CLI 경로 → repo 상대 경로(`/` 구분), 또는 null (docs/sdlc/code-editor/ spec FR-23).
 *
 * CLI는 대개 절대 경로를 준다. repo 경로로 시작하면 그 뒤가 상대 경로다 — 비교는 `pathKey` 규칙(끝 구분자 무시,
 * Windows는 대소문자·구분자 무시)이고, 돌려주는 경로의 글자는 CLI가 준 그대로다. 상대 경로는 repo 기준이다.
 * repo 밖이면 null — 대화록에 `코드 칸에서 열기`가 서지 않는다. 판정을 통과해도 core가 목록·realpath로 다시 본다.
 */
export function repoRelativePath(cliPath: string, repoPath: string): string | null {
  if (cliPath === '') return null
  if (!isAbsolute(cliPath)) return normalizeRelative(cliPath.replace(/\\/g, '/'))

  const windows = isWindowsPath(cliPath) || isWindowsPath(repoPath)
  const root = pathKey(repoPath)
  const file = pathKey(cliPath)
  const sep = windows ? '\\' : '/'
  if (!file.startsWith(root + sep)) return null
  // 비교는 정규형으로, 잘라내는 것은 원래 글자에서 — 정규형과 원래 글자의 길이는 같다(구분자·대소문자만 바뀐다).
  const rest = cliPath.replace(/[\\/]+$/, '').slice(root.length + 1)
  return normalizeRelative(rest.replace(/\\/g, '/'))
}
