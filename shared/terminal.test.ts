import { describe, it, expect } from 'vitest'
import { isTerminalShellKey, TERMINAL_SHELL_KEYS } from './models'

describe('isTerminalShellKey (docs/sdlc/terminal-tabs/spec.md FR-12 · NFR-2)', () => {
  it('등록부의 키만 받는다', () => {
    for (const key of TERMINAL_SHELL_KEYS) expect(isTerminalShellKey(key)).toBe(true)
    expect(TERMINAL_SHELL_KEYS).toEqual(['default', 'pwsh', 'powershell', 'cmd', 'git-bash', 'login', 'wsl'])
  })

  it('경로·빈 문자열·대소문자가 다른 키·문자열이 아닌 값은 키가 아니다 — 렌더러가 경로를 보내는 통로가 없다', () => {
    expect(isTerminalShellKey('C:\\Windows\\System32\\cmd.exe')).toBe(false)
    expect(isTerminalShellKey('')).toBe(false)
    expect(isTerminalShellKey('CMD')).toBe(false)
    expect(isTerminalShellKey(1)).toBe(false)
    expect(isTerminalShellKey(null)).toBe(false)
    expect(isTerminalShellKey({ key: 'cmd' })).toBe(false)
  })
})
