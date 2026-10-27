/**
 * 터미널 칸의 탭 고르기 (`docs/sdlc/terminal-tabs/spec.md` FR-2·6). 탭 목록의 진실은 core에 있고 렌더러가 쥐는 것은 **어느 탭을 보고
 * 있나** 하나뿐이다 — 그것을 이 장비의 localStorage에 repo마다 둔다(`layout.ts`와 같은 자리). 앱을 다시 켜면 탭 id가 전부 바뀌므로
 * 맨 왼쪽 탭으로 떨어진다.
 */

type Tab = { tabId: string }

/** 칸이 붙을 때 볼 탭 — 기억한 것이 목록에 있으면 그것, 없으면 맨 왼쪽 */
export function pickTab(tabs: readonly Tab[], remembered: string | null): string | null {
  if (remembered !== null && tabs.some((t) => t.tabId === remembered)) return remembered
  return tabs[0]?.tabId ?? null
}

/** 닫은 뒤에 볼 탭 — 보던 탭을 닫았으면 그 오른쪽, 없으면 왼쪽. `tabs`는 닫기 전의 목록이다 */
export function nextActiveAfterClose(tabs: readonly Tab[], closedId: string, activeId: string | null): string | null {
  if (closedId !== activeId) return activeId
  const at = tabs.findIndex((t) => t.tabId === closedId)
  return tabs[at + 1]?.tabId ?? tabs[at - 1]?.tabId ?? null
}

const key = (repoId: string) => `one-desk.terminal.tab.${repoId}`

/** 저장소 접근은 막힐 수 있다(사이트 데이터 차단 등) — 그때는 기억만 못 한다 */
export function readActiveTab(repoId: string): string | null {
  try { return localStorage.getItem(key(repoId)) } catch { return null }
}

export function writeActiveTab(repoId: string, tabId: string): void {
  try { localStorage.setItem(key(repoId), tabId) } catch { /* 기억만 못 할 뿐이다 */ }
}
