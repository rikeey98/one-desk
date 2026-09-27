/**
 * 링크로 열어도 되는 주소인가 (`docs/sdlc/conversation-timeline/` spec FR-22·FR-24).
 *
 * **렌더러와 main이 같은 판정을 쓴다.** 렌더러는 agent 답의 마크다운 링크를 이것으로
 * 거르고, main은 `setWindowOpenHandler`에서 한 번 더 거른다 — 막는 자리가 한 곳이면 그
 * 한 곳의 실수가 곧 사고다. 앱 창이 원격 문서로 넘어가면 preload가 그 문서에도 붙어
 * `window.oneDesk`가 노출된다(CLAUDE.md "asset 본문은 신뢰할 수 없는 입력이다").
 *
 * **http·https 절대 URL만 통과한다.** `javascript:`·`file:`·`data:`·`mailto:`는 물론이고
 * 상대 경로·`#조각`·`//host`도 막는다 — 앱 창이 다른 문서로 넘어가는 경로를 하나도 두지
 * 않는다. 판정은 WHATWG URL 파서에 맡긴다: 앞뒤 제어 문자·공백을 걷고 스킴 안의 탭·
 * 줄바꿈을 지우는 것까지 브라우저가 하는 그대로라, 글자를 직접 훑다 빠뜨리는 틈이 없다.
 *
 * **사용자 정보(`user@`·`user:pass@`)가 붙은 주소도 막는다.** `https://github.com@evil.com/`의
 * 목적지는 evil.com인데 글자로는 github처럼 읽힌다 — 맨 URL로 쓰면 화면에도 그렇게 보인다.
 * 프롬프트 인젝션을 당한 agent가 "공식 로그인"이라며 건넬 수 있는 모양이다(리뷰가 찾은 것).
 *
 * electron·DOM을 모르는 순수 함수다 — main에는 단위 테스트가 없어 판정을 여기 둔다
 * (`core/app/reveal.ts`와 같은 구조).
 *
 * @returns 정규화한 주소, 링크가 아니면 null
 */
export function externalLinkOf(href: string): string | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.hostname === '') return null
  if (url.username !== '' || url.password !== '') return null
  return url.href
}

/**
 * 앱 창이 이 주소로 넘어가도 되는가 — main의 `will-navigate`가 쓴다 (spec FR-24).
 *
 * `appUrl`은 main이 창에 싣는 앱 자신의 주소다: 개발 서버(`ELECTRON_RENDERER_URL`)이거나
 * `index.html`의 `file:` URL. 개발 서버면 **같은 origin**이면 통과한다 — Vite의 전체
 * 새로고침이 막히면 안 된다. `file:`이면 **같은 문서**(쿼리·조각 무시)만 통과한다 —
 * `file:`의 origin은 전부 불투명한 `"null"`이라 origin을 비교하면 디스크의 아무 파일로나
 * 넘어갈 수 있다. 그 밖(원격 문서·`javascript:`·`data:`·`about:`)은 전부 막는다. 앱 주소를
 * 해석하지 못해도 막는다 — 모르면 닫힌 쪽으로 실패한다.
 */
export function isAppNavigation(target: string, appUrl: string): boolean {
  let to: URL
  let app: URL
  try {
    to = new URL(target)
    app = new URL(appUrl)
  } catch {
    return false
  }
  if (app.protocol === 'file:') {
    return to.protocol === 'file:' && to.host === app.host && to.pathname === app.pathname
  }
  if (app.protocol === 'http:' || app.protocol === 'https:') {
    return to.origin === app.origin
  }
  return false
}
