/**
 * 실행 단축키의 화면 이름. 코드는 ⌘와 Ctrl을 둘 다 받지만(RunPanel의 onPromptKeyDown),
 * 안내문은 지금 장비에 있는 키 하나만 말해야 한다 — Windows 사용자에게 ⌘를 보여주면
 * 존재하지 않는 키를 가리키는 셈이다. platform이 비어 있으면(jsdom 등) Ctrl 쪽이다.
 */
export function runShortcutLabel(platform: string): string {
  return /mac|iphone|ipad/i.test(platform) ? '⌘+Enter' : 'Ctrl+Enter'
}
