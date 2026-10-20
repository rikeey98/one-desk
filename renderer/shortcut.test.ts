import { describe, it, expect } from 'vitest'
import { runShortcutLabel } from './shortcut'

describe('runShortcutLabel', () => {
  it('macOS에서만 ⌘를, 그 밖에서는 Ctrl을 안내한다', () => {
    expect(runShortcutLabel('MacIntel')).toBe('⌘+Enter')
    expect(runShortcutLabel('Win32')).toBe('Ctrl+Enter')
    expect(runShortcutLabel('Linux x86_64')).toBe('Ctrl+Enter')
    // jsdom처럼 platform이 비어 있으면 macOS라고 단정하지 않는다.
    expect(runShortcutLabel('')).toBe('Ctrl+Enter')
  })
})

// ── docs/sdlc/ux-polish/ ──

import { SHORTCUTS, isEditableTarget, matchShortcut, shortcutLabel, withShortcut } from './shortcut'

describe('전역 단축키 표 (docs/sdlc/ux-polish/ FR-8)', () => {
  it('표의 (수정키, Shift, 키) 조합이 겹치지 않는다', () => {
    const keys = SHORTCUTS.map((s) => `${s.mod}:${s.shift}:${s.key.toLowerCase()}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('수정키는 Ctrl과 ⌘를 둘 다 받고, Alt가 섞이면 아무것도 아니다', () => {
    const base = { key: 'n', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }
    expect(matchShortcut({ ...base, ctrlKey: true }, false)).toBe('new-conversation')
    expect(matchShortcut({ ...base, metaKey: true }, false)).toBe('new-conversation')
    expect(matchShortcut({ ...base, ctrlKey: true, altKey: true }, false)).toBeNull()
    expect(matchShortcut(base, false)).toBeNull()
  })

  it('Shift가 인박스(Ctrl+Shift+I)와 새 이슈(Ctrl+I)를 가른다', () => {
    const base = { key: 'i', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }
    expect(matchShortcut(base, false)).toBe('new-issue')
    expect(matchShortcut({ ...base, key: 'I', shiftKey: true }, false)).toBe('inbox')
  })

  it('수정키 없는 키(?)는 입력칸 밖에서만 듣는다 — 수정키 있는 키는 입력칸 안에서도 듣는다', () => {
    const q = { key: '?', ctrlKey: false, metaKey: false, shiftKey: true, altKey: false }
    expect(matchShortcut(q, false)).toBe('help')
    expect(matchShortcut(q, true)).toBeNull()
    const j = { key: 'j', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }
    expect(matchShortcut(j, true)).toBe('toggle-dock')
  })

  it('글을 받는 자리는 input·textarea·select·contentEditable·CodeMirror·xterm이다', () => {
    const input = document.createElement('input')
    const div = document.createElement('div')
    const cm = document.createElement('div')
    cm.className = 'cm-editor'
    const inner = document.createElement('span')
    cm.appendChild(inner)
    expect(isEditableTarget(input)).toBe(true)
    expect(isEditableTarget(div)).toBe(false)
    expect(isEditableTarget(inner)).toBe(true)
    expect(isEditableTarget(null)).toBe(false)
  })

  it('화면 표기는 플랫폼의 수정키 이름을 따른다', () => {
    const inbox = SHORTCUTS.find((s) => s.action === 'inbox')!
    expect(shortcutLabel(inbox, 'Win32')).toBe('Ctrl+Shift+I')
    expect(shortcutLabel(inbox, 'MacIntel')).toBe('⌘+Shift+I')
    expect(withShortcut('새 대화', 'new-conversation', 'Win32')).toBe('새 대화 (Ctrl+N)')
  })
})
