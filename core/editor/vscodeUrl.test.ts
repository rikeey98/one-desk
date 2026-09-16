import { describe, it, expect } from 'vitest'
import { vscodeFolderUrl } from './vscodeUrl'

describe('vscodeFolderUrl', () => {
  it('절대 경로를 vscode://file/ URL로 만든다', () => {
    expect(vscodeFolderUrl('/Users/me/work/api')).toBe('vscode://file/Users/me/work/api')
  })

  it('공백을 인코딩한다', () => {
    // 인코딩하지 않으면 openExternal이 공백에서 URL을 끊는다.
    expect(vscodeFolderUrl('/Users/me/my repo')).toBe('vscode://file/Users/me/my%20repo')
  })

  it('한글 경로를 인코딩한다', () => {
    expect(vscodeFolderUrl('/Users/me/작업')).toBe('vscode://file/Users/me/%EC%9E%91%EC%97%85')
  })

  it('#과 ?를 인코딩한다', () => {
    // encodeURI는 이 둘을 남겨둬 프래그먼트·쿼리로 잘린다.
    expect(vscodeFolderUrl('/tmp/a#b?c')).toBe('vscode://file/tmp/a%23b%3Fc')
  })

  it('Windows 경로의 역슬래시를 슬래시로 바꾸고 드라이브 문자 앞에 /를 붙인다', () => {
    expect(vscodeFolderUrl('C:\\Users\\me\\api')).toBe('vscode://file/C:/Users/me/api')
  })

  it('경로의 콜론은 인코딩하지 않는다', () => {
    // C%3A/... 는 VS Code가 드라이브로 읽지 못한다.
    expect(vscodeFolderUrl('C:\\repo')).not.toContain('%3A')
  })

  it('끝의 구분자를 떼어 빈 세그먼트를 남기지 않는다', () => {
    expect(vscodeFolderUrl('/Users/me/api/')).toBe('vscode://file/Users/me/api')
  })

  it('빈 경로는 거부한다', () => {
    expect(() => vscodeFolderUrl('  ')).toThrow()
  })
})
