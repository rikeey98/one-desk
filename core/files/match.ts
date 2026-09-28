/**
 * `@` 피커의 퍼지 순위 (docs/sdlc/input-triggers/ FR-6). 순수 함수다.
 *
 * 등급: 0 파일명 앞글자 · 1 파일명 안 · 2 경로 안 · 3 경로 글자 건너뛰기(`rnpl` → `RunPanel`).
 * 대소문자를 가리지 않는다. 같은 등급은 짧은 경로 → 사전순. 빈 질의는 얕은 경로부터 사전순.
 */
export function matchFiles(paths: readonly string[], query: string, limit = 50): string[] {
  const q = query.toLocaleLowerCase()
  if (q === '') {
    return [...paths].sort((a, b) => depth(a) - depth(b) || compare(a, b)).slice(0, limit)
  }
  const ranked: { path: string; rank: number }[] = []
  for (const path of paths) {
    const rank = rankOf(path.toLocaleLowerCase(), q)
    if (rank !== null) ranked.push({ path, rank })
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || a.path.length - b.path.length || compare(a.path, b.path))
    .slice(0, limit)
    .map((entry) => entry.path)
}

function rankOf(path: string, query: string): number | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (name.startsWith(query)) return 0
  if (name.includes(query)) return 1
  if (path.includes(query)) return 2
  if (isSubsequence(query, path)) return 3
  return null
}

function isSubsequence(query: string, text: string): boolean {
  let i = 0
  for (const ch of text) if (ch === query[i]) i++
  return i === query.length
}

function depth(path: string): number {
  let n = 0
  for (const ch of path) if (ch === '/') n++
  return n
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
