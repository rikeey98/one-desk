import { describe, it, expect } from 'vitest'
import { isWslUnc, parseWslPath, wslUncOf } from './wslPath'

/**
 * WSL UNC 경로 파싱 (`docs/sdlc/wsl-support/` spec FR-2·§4의 9).
 *
 * 순수 문자열 함수다 — `node:path`를 쓰지 않는다. 호스트 OS의 규칙을 타면 macOS 개발 장비의
 * 테스트와 Windows 사용자의 동작이 갈린다.
 */
describe('parseWslPath', () => {
  it('\\\\wsl$\\<distro>\\…를 distro와 Linux 경로로 가른다', () => {
    expect(parseWslPath('\\\\wsl$\\Ubuntu\\home\\me\\proj')).toEqual({ distro: 'Ubuntu', linuxPath: '/home/me/proj' })
  })

  it('\\\\wsl.localhost\\<distro>\\…도 같은 결과다', () => {
    expect(parseWslPath('\\\\wsl.localhost\\Ubuntu-22.04\\home\\me\\proj'))
      .toEqual({ distro: 'Ubuntu-22.04', linuxPath: '/home/me/proj' })
  })

  it('접두사는 대소문자를 가리지 않고 끝 구분자·슬래시 혼용을 받는다', () => {
    expect(parseWslPath('\\\\WSL$\\Ubuntu/home/me\\proj\\')).toEqual({ distro: 'Ubuntu', linuxPath: '/home/me/proj' })
    expect(parseWslPath('//wsl.localhost/Ubuntu/home/me')).toEqual({ distro: 'Ubuntu', linuxPath: '/home/me' })
  })

  it('한글·공백 경로를 그대로 둔다', () => {
    expect(parseWslPath('\\\\wsl$\\Ubuntu\\home\\me\\내 프로젝트\\api v2'))
      .toEqual({ distro: 'Ubuntu', linuxPath: '/home/me/내 프로젝트/api v2' })
  })

  it('distro만 있으면 Linux 루트다', () => {
    expect(parseWslPath('\\\\wsl$\\Ubuntu')).toEqual({ distro: 'Ubuntu', linuxPath: '/' })
    expect(parseWslPath('\\\\wsl$\\Ubuntu\\')).toEqual({ distro: 'Ubuntu', linuxPath: '/' })
  })

  it('WSL 모양이 아니면 null이다', () => {
    expect(parseWslPath('C:\\work\\api')).toBeNull()
    expect(parseWslPath('/home/me/proj')).toBeNull()
    expect(parseWslPath('\\\\server\\share\\dir')).toBeNull()
    expect(parseWslPath('\\\\wsl$')).toBeNull()
    expect(parseWslPath('\\\\wsl$\\')).toBeNull()
    expect(parseWslPath('')).toBeNull()
  })

  it('distro가 `-`로 시작하면 null이다 — wsl.exe의 옵션으로 읽힐 수 있다 (FR-33)', () => {
    expect(parseWslPath('\\\\wsl$\\-d\\home')).toBeNull()
    expect(parseWslPath('\\\\wsl$\\--list\\home')).toBeNull()
  })

  it('Linux 경로 조각의 `..`는 접지 않는다 — 검증은 호출자의 몫이고 여기서 뜻을 바꾸지 않는다', () => {
    expect(parseWslPath('\\\\wsl$\\Ubuntu\\home\\..\\etc')).toEqual({ distro: 'Ubuntu', linuxPath: '/home/../etc' })
  })
})

describe('isWslUnc', () => {
  it('두 접두사 중 하나로 시작하면 참이다 — 파싱이 되는지는 보지 않는다', () => {
    expect(isWslUnc('\\\\wsl$\\Ubuntu\\x')).toBe(true)
    expect(isWslUnc('\\\\wsl.localhost\\')).toBe(true)
    expect(isWslUnc('\\\\wsl$')).toBe(true)
    expect(isWslUnc('C:\\wsl$\\x')).toBe(false)
    expect(isWslUnc('\\\\wslx\\a')).toBe(false)
  })
})

describe('wslUncOf', () => {
  it('distro와 Linux 경로로 `\\\\wsl$\\…` UNC를 만든다 — 저장 접두사는 `wsl$` 하나다', () => {
    expect(wslUncOf('Ubuntu', '/home/me/.claude/skills')).toBe('\\\\wsl$\\Ubuntu\\home\\me\\.claude\\skills')
    expect(wslUncOf('Ubuntu', '/')).toBe('\\\\wsl$\\Ubuntu')
  })

  it('parseWslPath와 왕복한다', () => {
    const unc = wslUncOf('Debian', '/srv/내 폴더/x')
    expect(parseWslPath(unc)).toEqual({ distro: 'Debian', linuxPath: '/srv/내 폴더/x' })
  })
})
