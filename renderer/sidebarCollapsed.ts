/**
 * 사이드바를 아이콘 줄로 접었는가. 보기 취향이라 core가 아니라 이 장비의 localStorage에 둔다(`dockSections.ts`와 같은 방식).
 */
const KEY = 'one-desk.sidebar.collapsed'

export function readSidebarCollapsed(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch { /* 기억만 못 할 뿐이다 */ }
}
