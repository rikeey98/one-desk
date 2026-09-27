import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Markdown } from './Markdown'

/**
 * agent 답은 신뢰할 수 없는 입력이다 (CLAUDE.md, spec FR-20~26). 여기 있는 보안 단언은
 * "렌더링에 구멍이 있으면 그 스크립트가 preload가 연 앱 API로 runs.start({ permission: 'full' })을
 * 부를 수 있다"를 막는 첫 겹이다 — 둘째 겹은 main의 will-navigate·setWindowOpenHandler다.
 */

/** 렌더 결과 전체에서 "무엇인가를 로드·실행·탐색할 수 있는" 속성을 모은다. */
function dangerousAttributes(root: HTMLElement): string[] {
  const found: string[] = []
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on')) found.push(`${el.tagName} ${name}`)
      if (name === 'src' || name === 'srcset' || name === 'action' || name === 'formaction') {
        found.push(`${el.tagName} ${name}`)
      }
      if (name === 'href' && !(el.tagName === 'A' && /^https?:\/\//.test(attr.value))) {
        found.push(`${el.tagName} href=${attr.value}`)
      }
    }
  }
  return found
}

describe('Markdown — 원시 HTML (FR-21)', () => {
  it('<script>는 요소가 되지 않고 글자로 보인다', () => {
    const w = window as unknown as { __pwned?: number }
    delete w.__pwned
    const { container } = render(<Markdown text={'앞\n\n<script>window.__pwned=1</script>\n\n뒤'} />)
    expect(container.querySelectorAll('script')).toHaveLength(0)
    expect(container.textContent).toContain('<script>window.__pwned=1</script>')
    expect(w.__pwned).toBeUndefined()
  })

  it('인라인 HTML도 글자다 — 이벤트 속성이 붙은 요소가 생기지 않는다', () => {
    const { container } = render(
      <Markdown text={'이것은 <b onclick="alert(1)">굵게</b>, <iframe src="https://e.x"></iframe>'} />
    )
    expect(container.querySelectorAll('b, iframe')).toHaveLength(0)
    expect(container.textContent).toContain('<b onclick="alert(1)">')
    expect(dangerousAttributes(container)).toEqual([])
    // 문단 안의 HTML은 문단 안의 글자다 — 블록이 되지 않는다.
    expect(container.querySelector('.md-raw')).toBeNull()
  })

  it('여러 줄 HTML 블록은 줄을 지킨 글자 블록이다 — 한 줄로 뭉개지거나 다음 문단에 붙지 않는다', () => {
    // 그대로 두면 react-markdown이 감싸는 요소 없이 뿌리의 맨 글자로 두어, 줄바꿈이 공백이 되고
    // 블록 여백도 없다(리뷰가 찾은 것). 글자로 남기는 이유(FR-21)가 읽을 수 있어야 한다는 것이다.
    const { container } = render(
      <Markdown text={'위 문단\n\n<details>\n<summary>요약</summary>\n\n본문\n</details>'} />
    )
    expect(container.querySelector('details, summary')).toBeNull()
    const raw = [...container.querySelectorAll('.md-raw')].map((el) => el.textContent)
    expect(raw).toEqual(['<details>\n<summary>요약</summary>', '</details>'])
    expect(screen.getByText('본문').tagName).toBe('P')
    expect(dangerousAttributes(container)).toEqual([])
  })

  it('인용·목록 안의 HTML 블록도 글자 블록이다', () => {
    const { container } = render(<Markdown text={'> <div>\n> 안</div>\n\n- <p>항목</p>'} />)
    expect([...container.querySelectorAll('.md-raw')].map((el) => el.textContent)).toEqual([
      '<div>\n안</div>', '<p>항목</p>'
    ])
  })
})

describe('Markdown — 이미지 (FR-23)', () => {
  it('마크다운 이미지는 <img>가 되지 않고 [이미지: alt] 글자다', () => {
    const { container } = render(<Markdown text={'![구조도](https://e.x/p.png)'} />)
    expect(container.querySelectorAll('img')).toHaveLength(0)
    expect(screen.getByText('[이미지: 구조도]')).toHaveClass('md-image')
  })

  it('참조식 이미지와 data: 이미지도 그리지 않는다', () => {
    const { container } = render(
      <Markdown text={'![r][p] ![d](data:image/png;base64,AAAA)\n\n[p]: http://127.0.0.1:9/p.png'} />
    )
    expect(container.querySelectorAll('img')).toHaveLength(0)
    expect(screen.getByText('[이미지: r]')).toBeInTheDocument()
  })

  it('HTML <img>는 글자로 남는다', () => {
    const { container } = render(<Markdown text={'<img src="http://127.0.0.1:9/q.png">'} />)
    expect(container.querySelectorAll('img')).toHaveLength(0)
    expect(container.textContent).toContain('<img src="http://127.0.0.1:9/q.png">')
  })

  it('alt가 없으면 [이미지]다', () => {
    render(<Markdown text={'![](https://e.x/p.png)'} />)
    expect(screen.getByText('[이미지]')).toBeInTheDocument()
  })
})

describe('Markdown — 링크 (FR-22)', () => {
  it.each([
    ['javascript:', '[누름](javascript:alert(1))', 'javascript:alert(1)'],
    ['대문자 JavaScript:', '[누름](JavaScript:alert(1))', 'JavaScript:alert(1)'],
    ['file:', '[누름](file:///etc/passwd)', 'file:///etc/passwd'],
    ['data:', '[누름](data:text/html,x)', 'data:text/html,x'],
    ['vbscript:', '[누름](vbscript:msgbox)', 'vbscript:msgbox'],
    ['#조각', '[누름](#top)', '#top'],
    ['상대 경로', '[누름](/x)', '/x'],
    ['상대 경로(점)', '[누름](./a.md)', './a.md'],
    ['mailto:', '[누름](mailto:a@b.c)', 'mailto:a@b.c']
  ])('%s 링크는 <a>가 아니라 글자다 — 원래 주소는 title', (_name, text, href) => {
    const { container } = render(<Markdown text={text} />)
    expect(container.querySelectorAll('a')).toHaveLength(0)
    const inert = screen.getByText('누름')
    expect(inert).toHaveClass('md-link-inert')
    expect(inert).toHaveAttribute('title', href)
  })

  it('참조식 정의와 꺾쇠 자동 링크도 같은 규칙을 탄다', () => {
    const { container } = render(
      <Markdown text={'[참조][r] 그리고 <javascript:alert(1)>\n\n[r]: javascript:alert(1)'} />
    )
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(screen.getByText('참조')).toHaveClass('md-link-inert')
  })

  it('https 링크는 새 창 링크다 — target=_blank, rel=noopener noreferrer', () => {
    render(<Markdown text={'[문서](https://example.com/a?b=1)'} />)
    const link = screen.getByRole('link', { name: '문서' })
    expect(link).toHaveAttribute('href', 'https://example.com/a?b=1')
    expect(link).toHaveAttribute('target', '_blank')
    const rel = link.getAttribute('rel')?.split(/\s+/) ?? []
    expect(rel).toContain('noopener')
    expect(rel).toContain('noreferrer')
  })

  it('링크의 title은 실제 목적지다 — 마크다운 링크 제목은 agent가 정한다', () => {
    // Electron에는 상태 표시줄이 없어 누르기 전에 목적지를 볼 곳이 툴팁뿐이다. 그 툴팁을 agent가
    // 채우면 판단 근거가 거꾸로 주어진다(리뷰가 찾은 것). 글자로 남긴 링크처럼 원래 주소를 보인다.
    render(<Markdown text={'[docs](https://evil.example/login "https://github.com/org/repo")'} />)
    const link = screen.getByRole('link', { name: 'docs' })
    expect(link).toHaveAttribute('href', 'https://evil.example/login')
    expect(link).toHaveAttribute('title', 'https://evil.example/login')
  })

  it('사용자 정보로 위장한 맨 URL은 링크가 아니다 — 원래 주소는 title', () => {
    const { container } = render(<Markdown text={'로그인: https://github.com@evil.example/login'} />)
    expect(container.querySelectorAll('a')).toHaveLength(0)
    const inert = container.querySelector('.md-link-inert')
    expect(inert).toHaveTextContent('https://github.com@evil.example/login')
    expect(inert).toHaveAttribute('title', 'https://github.com@evil.example/login')
  })

  it('GFM 맨 URL도 링크가 되고, 맨 이메일은 글자다', () => {
    const { container } = render(<Markdown text={'보기: https://example.com/x 또는 a@b.co'} />)
    const links = container.querySelectorAll('a')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', 'https://example.com/x')
    expect(screen.getByText('a@b.co')).toHaveClass('md-link-inert')
  })

  it('각주의 앱 안 조각 링크도 만들지 않는다', () => {
    const { container } = render(<Markdown text={'본문[^1]\n\n[^1]: 각주'} />)
    expect(container.querySelectorAll('a')).toHaveLength(0)
  })

  it('적대적인 문서 전체에서 로드·실행·앱 안 탐색이 가능한 속성이 하나도 없다', () => {
    const hostile = [
      '# 제목 <img src=x onerror=alert(1)>',
      '[a](javascript:alert(1)) [b](/x) [c](#y) [d](https://ok.example/)',
      '![i](http://127.0.0.1:9/p.png) <a href="javascript:alert(2)">h</a>',
      '<form action="https://e.x"><button formaction="javascript:1">x</button></form>',
      '<svg onload=alert(3)></svg> <video src=v.mp4></video>',
      '- [ ] 할 일',
      '본문[^n]',
      '',
      '[^n]: 각주 [e](file:///etc/passwd)',
      '',
      '| a | b |', '|---|---|', '| <script>1</script> | [f](data:x) |'
    ].join('\n')
    const { container } = render(<Markdown text={hostile} />)
    expect(container.querySelectorAll('script, img, iframe, form, svg, video')).toHaveLength(0)
    expect(dangerousAttributes(container)).toEqual([])
    expect(container.querySelectorAll('a')).toHaveLength(1)
  })
})

/**
 * 파서를 무너뜨리는 입력 (spec FR-20 다듬음 — 리뷰가 찾은 것). 깊은 중첩은 스택을 넘기고, React 19는
 * 렌더 중에 던진 오류를 받을 경계가 없으면 **루트를 통째로 내린다** — 사이드바·이슈·도크까지 빈 화면이
 * 된다. 답은 DB에 남으므로 그 대화를 열 때마다 다시 터진다. 판정 자체의 경계값은
 * `markdownBudget.test.ts`가, 판정을 빠져나간 오류를 받는 경계는 `Markdown.boundary.test.tsx`가 본다.
 */
describe('Markdown — 무너뜨리는 입력', () => {
  it('깊게 중첩된 목록은 평문으로 그린다 — 곁의 화면은 살아 있다', () => {
    const text = '- '.repeat(1_000) + 'x'
    const { container } = render(<div><p>사이드바</p><Markdown text={text} /></div>)
    expect(screen.getByText('사이드바')).toBeInTheDocument()
    const plain = container.querySelector('.md-plain')
    expect(plain).toHaveClass('md')
    expect(plain?.textContent).toBe(text)
    expect(container.querySelector('li')).toBeNull()
  })

  it('파서가 오래 붙잡힐 모양은 파싱하지 않고 평문이다 — 중첩된 강조', () => {
    const text = '*a '.repeat(3_000) + 'x' + ' a*'.repeat(3_000)
    const { container } = render(<Markdown text={text} />)
    expect(container.querySelector('.md-plain')?.textContent).toBe(text)
    expect(container.querySelector('em')).toBeNull()
  })

  it('평문으로 떨어져도 HTML은 글자다', () => {
    const text = '<img src=x onerror=alert(1)>\n' + '>'.repeat(3_000) + ' x'
    const { container } = render(<Markdown text={text} />)
    expect(container.querySelectorAll('img')).toHaveLength(0)
    expect(dangerousAttributes(container)).toEqual([])
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('보통 답은 그대로 마크다운이다', () => {
    const { container } = render(<Markdown text={'- **a**\n- b'} />)
    expect(container.querySelector('.md-plain')).toBeNull()
    expect(container.querySelector('strong')).toHaveTextContent('a')
  })
})

describe('Markdown — 코드·표·목록 (FR-25)', () => {
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // jsdom에는 navigator.clipboard가 없다 — 테스트가 세운다(plan 2단계).
    writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  })

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('코드 블록은 언어 이름 머리와 본문으로 그려진다', () => {
    const { container } = render(<Markdown text={'```ts\nconst a = 1\n```'} />)
    const block = container.querySelector('.md-code')
    expect(block).not.toBeNull()
    expect(block?.querySelector('.md-code-head')).toHaveTextContent('ts')
    expect(block?.querySelector('pre code')).toHaveTextContent('const a = 1')
  })

  it('코드 복사는 원문 그대로를 클립보드에 쓴다 — 끝의 줄바꿈을 덧붙이지 않는다', async () => {
    const code = 'if (now >= expiresAt) {\n  return refresh()\n}'
    render(<Markdown text={'```ts\n' + code + '\n```'} />)
    fireEvent.click(screen.getByRole('button', { name: '코드 복사' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(code))
  })

  it('블록이 여럿이면 각자 자기 원문을 복사한다', async () => {
    render(<Markdown text={'```\n첫째\n```\n\n```sh\n둘째 <b>\n```'} />)
    const buttons = screen.getAllByRole('button', { name: '코드 복사' })
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[1]!)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('둘째 <b>'))
  })

  it('복사가 거부되면 조용히 끝나지 않고 알린다', async () => {
    writeText.mockImplementation(() => Promise.reject(new Error('denied')))
    render(<Markdown text={'```\nx\n```'} />)
    fireEvent.click(screen.getByRole('button', { name: '코드 복사' }))
    expect(await screen.findByRole('status')).toHaveTextContent('복사하지 못했습니다')
  })

  it('인라인 코드는 블록이 아니다 — 복사 버튼이 없다', () => {
    const { container } = render(<Markdown text={'`pnpm test`를 돌린다'} />)
    expect(container.querySelector('code')).toHaveTextContent('pnpm test')
    expect(container.querySelector('.md-code')).toBeNull()
    expect(screen.queryByRole('button', { name: '코드 복사' })).toBeNull()
  })

  it('표는 가로 스크롤 상자 안에 그려진다', () => {
    const { container } = render(<Markdown text={'| 이름 | 값 |\n|---|---|\n| a | 1 |'} />)
    const table = container.querySelector('.md-table > table')
    expect(table).not.toBeNull()
    expect(screen.getByRole('columnheader', { name: '이름' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '1' })).toBeInTheDocument()
  })

  it('작업 목록의 체크박스는 누를 수 없다', () => {
    render(<Markdown text={'- [x] 끝난 일\n- [ ] 남은 일'} />)
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(2)
    for (const box of boxes) expect(box).toBeDisabled()
    expect(boxes[0]).toBeChecked()
    expect(boxes[1]).not.toBeChecked()
  })

  it('목록·제목·강조가 그려진다', () => {
    const { container } = render(<Markdown text={'## 원인\n\n- **토큰** 만료\n- 검사'} />)
    expect(screen.getByRole('heading', { level: 2, name: '원인' })).toBeInTheDocument()
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(container.querySelector('strong')).toHaveTextContent('토큰')
  })

  it('.md 뿌리 하나로 감싼다', () => {
    const { container } = render(<Markdown text={'글'} />)
    expect(container.firstElementChild).toHaveClass('md')
  })
})
