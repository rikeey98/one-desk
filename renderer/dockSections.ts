/**
 * 도크의 접은 repo 구획 (`docs/sdlc/dock-repo-sections/` FR-7). 보기 취향이라 core가 아니라 이 장비의 localStorage에 둔다
 * (`listWidth.ts`와 같은 방식). 키는 `repo:<id>`·`other` — repo id는 workspace를 넘어 유일하다.
 */
const KEY = 'one-desk.dock.collapsedSections'

export function readCollapsedSections(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [])
  } catch {
    return new Set()
  }
}

export function writeCollapsedSections(keys: ReadonlySet<string>): void {
  try { localStorage.setItem(KEY, JSON.stringify([...keys])) } catch { /* 기억만 못 할 뿐이다 */ }
}
