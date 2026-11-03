/**
 * 홈 도크의 펼침 (`docs/sdlc/home-conversation/` FR-13a). 보기 취향이라 이 장비의 localStorage에 둔다(`dockSections.ts`와 같은 방식).
 * **기본은 접힘이다** — 홈은 이미 할 일·돌고 있는 것·타임라인으로 차 있어, 펼친 채 시작하면 노트북 창에서 할 일이 밀려난다(spec §5의 6).
 */
const KEY = 'one-desk.homeDock.open'

export function readHomeDockOpen(): boolean {
  try { return localStorage.getItem(KEY) === 'true' } catch { return false }
}

export function writeHomeDockOpen(open: boolean): void {
  try { localStorage.setItem(KEY, String(open)) } catch { /* 기억만 못 할 뿐이다 */ }
}
