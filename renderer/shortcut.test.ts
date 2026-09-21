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
