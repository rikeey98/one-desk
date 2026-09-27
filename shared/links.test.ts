import { describe, it, expect } from 'vitest'
import { externalLinkOf, isAppNavigation } from './links'

describe('externalLinkOf', () => {
  it('http·https 절대 URL은 통과하고 정규화한다', () => {
    expect(externalLinkOf('https://example.com')).toBe('https://example.com/')
    expect(externalLinkOf('http://example.com/a?b=1#c')).toBe('http://example.com/a?b=1#c')
    expect(externalLinkOf('HTTPS://Example.COM/x')).toBe('https://example.com/x')
  })

  it('javascript:는 대소문자·앞 공백·제어 문자를 섞어도 거부한다', () => {
    expect(externalLinkOf('javascript:alert(1)')).toBeNull()
    expect(externalLinkOf('JavaScript:alert(1)')).toBeNull()
    expect(externalLinkOf('  javascript:alert(1)')).toBeNull()
    expect(externalLinkOf('java\tscript:alert(1)')).toBeNull()
    expect(externalLinkOf('java\nscript:alert(1)')).toBeNull()
    expect(externalLinkOf('\u0000javascript:alert(1)')).toBeNull()
    expect(externalLinkOf('\u001fjavascript:alert(1)')).toBeNull()
  })

  it('다른 스킴은 거부한다', () => {
    expect(externalLinkOf('file:///etc/passwd')).toBeNull()
    expect(externalLinkOf('data:text/html,<script>1</script>')).toBeNull()
    expect(externalLinkOf('vbscript:msgbox(1)')).toBeNull()
    expect(externalLinkOf('mailto:a@b.c')).toBeNull()
  })

  it('상대 경로와 조각은 거부한다 — 앱 창이 다른 문서로 넘어가면 안 된다', () => {
    expect(externalLinkOf('/x')).toBeNull()
    expect(externalLinkOf('x/y')).toBeNull()
    expect(externalLinkOf('#top')).toBeNull()
    expect(externalLinkOf('//evil.example/x')).toBeNull()
  })

  it('사용자 정보가 붙은 주소는 거부한다 — `github.com@evil.com`은 evil.com이다', () => {
    // 맨 URL로 쓰면 화면에도 github처럼 보인다. 프롬프트 인젝션을 당한 agent가 "공식 로그인"이라며
    // 건넬 수 있는 모양이라 링크로 만들지 않는다(리뷰가 찾은 것).
    expect(externalLinkOf('https://github.com@evil.com/')).toBeNull()
    expect(externalLinkOf('https://user:pass@example.com/x')).toBeNull()
    expect(externalLinkOf('http://:secret@example.com/')).toBeNull()
    // 경로·쿼리의 @는 사용자 정보가 아니다.
    expect(externalLinkOf('https://example.com/@user?by=a@b.c')).toBe('https://example.com/@user?by=a@b.c')
  })

  it('빈 문자열과 호스트 없는 URL은 거부한다', () => {
    expect(externalLinkOf('')).toBeNull()
    expect(externalLinkOf('   ')).toBeNull()
    expect(externalLinkOf('https://')).toBeNull()
  })
})

describe('isAppNavigation', () => {
  // main의 will-navigate가 쓴다 (FR-24). main에는 단위 테스트가 없어 판정을 여기서 고정한다.
  const FILE_APP = 'file:///D:/one-desk/out/renderer/index.html'
  const DEV_APP = 'http://127.0.0.1:5173'

  it('file: 앱은 같은 문서만 통과한다 — 쿼리·조각은 무시한다', () => {
    expect(isAppNavigation(FILE_APP, FILE_APP)).toBe(true)
    expect(isAppNavigation(`${FILE_APP}?a=1#x`, FILE_APP)).toBe(true)
  })

  it('file: 앱에서 다른 file: 문서는 막는다 — file:의 origin은 전부 같은 "null"이다', () => {
    expect(isAppNavigation('file:///D:/one-desk/out/renderer/other.html', FILE_APP)).toBe(false)
    expect(isAppNavigation('file:///etc/passwd', FILE_APP)).toBe(false)
    expect(isAppNavigation('file:///x', FILE_APP)).toBe(false)
    expect(isAppNavigation('file://evil-host/D:/one-desk/out/renderer/index.html', FILE_APP)).toBe(false)
  })

  it('개발 서버 앱은 같은 origin만 통과한다 — Vite의 전체 새로고침이 막히면 안 된다', () => {
    expect(isAppNavigation('http://127.0.0.1:5173/', DEV_APP)).toBe(true)
    expect(isAppNavigation('http://127.0.0.1:5173/index.html?t=1', DEV_APP)).toBe(true)
    expect(isAppNavigation('http://127.0.0.1:5174/', DEV_APP)).toBe(false)
    expect(isAppNavigation('http://localhost:5173/', DEV_APP)).toBe(false)
    expect(isAppNavigation('https://127.0.0.1:5173/', DEV_APP)).toBe(false)
  })

  it('원격 문서·다른 스킴은 어느 앱에서든 막는다', () => {
    for (const app of [FILE_APP, DEV_APP]) {
      expect(isAppNavigation('https://example.com/', app)).toBe(false)
      expect(isAppNavigation('javascript:alert(1)', app)).toBe(false)
      expect(isAppNavigation('data:text/html,<script>1</script>', app)).toBe(false)
      expect(isAppNavigation('about:blank', app)).toBe(false)
      expect(isAppNavigation('', app)).toBe(false)
    }
  })

  it('앱 주소를 모르면(파싱 실패·다른 스킴) 전부 막는다 — 닫힌 쪽으로 실패한다', () => {
    expect(isAppNavigation(FILE_APP, '')).toBe(false)
    expect(isAppNavigation('about:blank', 'about:blank')).toBe(false)
  })
})
