/**
 * 실행 단축키의 화면 이름. 코드는 ⌘와 Ctrl을 둘 다 받지만(RunPanel의 onPromptKeyDown),
 * 안내문은 지금 장비에 있는 키 하나만 말해야 한다 — Windows 사용자에게 ⌘를 보여주면
 * 존재하지 않는 키를 가리키는 셈이다. platform이 비어 있으면(jsdom 등) Ctrl 쪽이다.
 */
export function runShortcutLabel(platform: string): string {
  return `${modKeyLabel(platform)}+Enter`
}

/** 수정키의 화면 이름 — macOS는 ⌘, 그 밖은 Ctrl */
export function modKeyLabel(platform: string): string {
  return /mac|iphone|ipad/i.test(platform) ? '⌘' : 'Ctrl'
}

/** 앱 전역 단축키의 동작 (docs/sdlc/ux-polish/ FR-8) */
export type ShortcutAction =
  | 'new-conversation'
  | 'new-issue'
  | 'new-memo'
  | 'toggle-dock'
  | 'inbox'
  | 'home'
  | 'help'

export interface Shortcut {
  action: ShortcutAction
  /** 화면 이름 */
  label: string
  /** 수정키 없이 누르는 키 — `?`처럼 입력칸 밖에서만 듣는다 */
  key: string
  mod: boolean
  shift: boolean
}

/**
 * 전역 단축키 표 하나. 판정(`matchShortcut`)과 `?` 도움말이 같은 표를 읽는다 — 따로 적으면
 * 도움말이 없는 키를 말하거나 있는 키를 빠뜨린다.
 */
export const SHORTCUTS: readonly Shortcut[] = [
  { action: 'new-conversation', label: '새 대화', key: 'n', mod: true, shift: false },
  { action: 'new-issue', label: '새 이슈 입력칸으로', key: 'i', mod: true, shift: false },
  { action: 'new-memo', label: '새 메모 입력칸으로', key: 'm', mod: true, shift: false },
  { action: 'toggle-dock', label: '대화창 보이기/숨기기', key: 'j', mod: true, shift: false },
  { action: 'inbox', label: '인박스', key: 'i', mod: true, shift: true },
  // Ctrl+H는 코드 칸(CodeMirror)의 바꾸기와 겹친다 — Shift를 붙인다 (docs/sdlc/home/ FR-12·§6-3)
  { action: 'home', label: '홈', key: 'h', mod: true, shift: true },
  { action: 'help', label: '단축키 목록', key: '?', mod: false, shift: false }
]

/** 단축키의 화면 표기 — `Ctrl+Shift+I`·`?` */
export function shortcutLabel(s: Shortcut, platform: string): string {
  const parts: string[] = []
  if (s.mod) parts.push(modKeyLabel(platform))
  if (s.shift) parts.push('Shift')
  parts.push(s.key.length === 1 ? s.key.toUpperCase() : s.key)
  return parts.join('+')
}

/** 버튼 `title`에 붙일 꼬리 — `새 대화 (Ctrl+N)` */
export function withShortcut(label: string, action: ShortcutAction, platform: string): string {
  const s = SHORTCUTS.find((x) => x.action === action)
  return s ? `${label} (${shortcutLabel(s, platform)})` : label
}

interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/** 포커스가 글을 받는 자리인가 — 거기서는 수정키 없는 키(`?`)를 먹지 않는다 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    || target.closest('.cm-editor, .xterm') !== null
}

/**
 * keydown 하나를 표와 맞춰 본다. 수정키는 Ctrl과 ⌘를 둘 다 받는다(실행 단축키와 같다). Alt가 섞이면 아무것도 아니다 —
 * 한글 IME·OS 단축키와 겹친다.
 */
export function matchShortcut(e: KeyLike, editable: boolean): ShortcutAction | null {
  if (e.altKey) return null
  const mod = e.ctrlKey || e.metaKey
  for (const s of SHORTCUTS) {
    if (s.mod !== mod) continue
    if (!s.mod && editable) continue
    if (s.mod && s.shift !== e.shiftKey) continue
    if (e.key.toLowerCase() !== s.key.toLowerCase()) continue
    return s.action
  }
  return null
}
