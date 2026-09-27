import { Component, memo, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { externalLinkOf } from '@shared/links'
import { fitsMarkdownBudget } from '../markdownBudget'
import { CopyButton } from './CopyButton'

/**
 * agent 답의 마크다운 (docs/sdlc/conversation-timeline/ spec FR-20~26).
 *
 * **agent 출력은 신뢰할 수 없는 입력이다**(CLAUDE.md). 렌더링에 구멍이 있으면 그 스크립트가
 * preload가 연 앱 API로 `runs.start({ permission: 'full' })`을 부를 수 있다. 그래서:
 *
 * - **원시 HTML은 글자다.** HTML을 요소로 되살리는 rehype 플러그인(raw)을 끼우지 않는다 —
 *   react-markdown은 그것 없이 HTML 노드를 텍스트로 바꾼다. `skipHtml`도 켜지 않는다: HTML
 *   조각을 설명하는 답에서 그 조각이 사라지면 답이 거짓말이 된다(FR-21). React의 innerHTML
 *   주입 prop도 쓰지 않는다. 둘 다 이름 그대로 grep해 0건인 것이 완료 증명이라(spec FR-20)
 *   여기에도 그 이름을 적지 않는다.
 * - **링크는 `externalLinkOf`를 통과한 http(s)만 `<a>`다**(FR-22). 새 창 요청은 main의
 *   `setWindowOpenHandler`가 같은 함수로 한 번 더 거른다(FR-24). 나머지는 글자다 — 상대
 *   경로와 `#조각`까지 막는 것은 앱 창이 다른 문서로 넘어가는 길을 하나도 두지 않기 위해서다.
 * - **이미지는 그리지 않는다**(FR-23). `<img>`가 DOM에 생기지 않는다.
 *
 * - **파서를 무너뜨리는 글은 평문이다**(FR-20 다듬음 — 리뷰가 찾은 것). 중첩이 깊으면 파서가
 *   스택을 넘기고, 흔한 모양에서도 시간이 제곱으로 는다 — 렌더 중에 던지면 React 19가 루트를
 *   통째로 내려 앱 창 전체가 빈 화면이 된다. 파싱 **전에** `fitsMarkdownBudget`이 재고, 그것을
 *   빠져나간 오류는 `MarkdownBoundary`가 받는다. 어느 쪽이든 글은 전부 보이고 서식만 빠진다.
 *
 * 쓰는 곳은 답 칸과 펼친 턴의 text 블록 둘뿐이다(FR-26) — 사용자 버블·도구 출력은 평문이다.
 */

/** 이 모듈이 다루는 hast의 모양 — `hast` 패키지를 직접 의존하지 않으려고 필요한 만큼만 적는다. */
interface HastNode {
  type: string
  value?: unknown
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

function textOf(node: HastNode | undefined): string {
  if (!node) return ''
  if (node.type === 'text' && typeof node.value === 'string') return node.value
  return (node.children ?? []).map(textOf).join('')
}

/** `className: ['language-ts']` → `ts`. 언어를 적지 않은 블록은 빈 문자열이다. */
function languageOf(code: HastNode | undefined): string {
  const names = code?.properties?.['className']
  if (!Array.isArray(names)) return ''
  const hit = names.find((name): name is string => typeof name === 'string' && name.startsWith('language-'))
  return hit ? hit.slice('language-'.length) : ''
}

function CodeBlock({ node, children }: { node: HastNode | undefined; children: ReactNode }) {
  const code = node?.children?.find((child) => child.type === 'element' && child.tagName === 'code')
  // mdast → hast가 코드 끝에 줄바꿈 하나를 덧붙인다. 복사는 원문이어야 한다.
  const source = textOf(code).replace(/\n$/, '')
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span className="md-code-lang">{languageOf(code)}</span>
        <CopyButton text={source} label="코드 복사" />
      </div>
      <pre>{children}</pre>
    </div>
  )
}

const COMPONENTS: Components = {
  // **title은 실제 목적지다** — 마크다운 링크 제목(`[a](url "제목")`)은 agent가 정한다. Electron에는
  // 상태 표시줄이 없어 누르기 전에 목적지를 볼 곳이 툴팁뿐인데, 그것을 agent가 채우면 판단 근거가
  // 거꾸로 주어진다(리뷰가 찾은 것). 글자로 남긴 링크가 원래 주소를 보이는 것과 같다.
  a: ({ href, children }) => {
    const link = externalLinkOf(href ?? '')
    if (link === null) {
      return <span className="md-link-inert" title={href}>{children}</span>
    }
    return <a href={link} title={link} target="_blank" rel="noopener noreferrer">{children}</a>
  },
  img: ({ alt }) => <span className="md-image">{alt ? `[이미지: ${alt}]` : '[이미지]'}</span>,
  pre: ({ node, children }) => <CodeBlock node={node}>{children}</CodeBlock>,
  // 넓은 표가 대화록 전체를 가로로 밀면 안 된다 — 이 상자 안에서만 스크롤한다(FR-25).
  table: ({ children }) => <div className="md-table"><table>{children}</table></div>
}

/** 이 모듈이 다루는 mdast의 모양 — `mdast` 패키지를 직접 의존하지 않으려고 필요한 만큼만 적는다. */
interface MdastNode {
  type: string
  value?: string
  children?: MdastNode[]
  data?: Record<string, unknown>
}

/** 블록을 담는 mdast 노드 — 이것의 자식인 `html`은 문단 밖의 HTML 블록이다. */
const FLOW_PARENTS = new Set(['root', 'blockquote', 'listItem', 'footnoteDefinition'])

/**
 * HTML **블록**을 줄을 지킨 글자 블록(`.md-raw`)으로 바꾼다 (FR-21 다듬음 — 리뷰가 찾은 것).
 *
 * 그대로 두면 react-markdown이 raw 노드를 감싸는 요소 없이 글자로 바꿔 뿌리에 둔다 — `.md`가
 * `white-space: normal`이라 여러 줄 조각이 한 줄로 뭉개지고 블록 여백도 없어 다음 문단에 붙는다.
 * 글자로 남기는 이유(답이 설명하는 조각이 사라지면 답이 거짓말이 된다)가 읽을 수 있어야 한다는
 * 것이라, 문단처럼 제 자리를 갖는 블록으로 세운다. **요소로 되살리지 않는다** — 자식은 글자
 * 노드 하나뿐이고 React가 이스케이프한다. 문단 안의 인라인 HTML은 이미 문단 안의 글자라 그대로다.
 *
 * 나무는 명시적 스택으로 훑는다 — 깊이의 상한은 `fitsMarkdownBudget`이 지키지만, 재귀는 그 상한이
 * 빗나갈 때 스택을 넘기는 자리 하나를 더 만든다.
 */
function remarkRawBlocks() {
  return (tree: unknown) => {
    const stack: MdastNode[] = [tree as MdastNode]
    while (stack.length > 0) {
      const node = stack.pop()!
      const children = node.children
      if (!children) continue
      const flow = FLOW_PARENTS.has(node.type)
      for (let i = 0; i < children.length; i++) {
        const child = children[i]!
        if (flow && child.type === 'html') {
          children[i] = {
            type: 'paragraph',
            data: { hName: 'div', hProperties: { className: ['md-raw'] } },
            children: [{ type: 'text', value: child.value ?? '' }]
          }
        } else {
          stack.push(child)
        }
      }
    }
  }
}

const REMARK_PLUGINS = [remarkGfm, remarkRawBlocks]

/**
 * 주소를 바꾸지 않고 그대로 넘긴다. react-markdown의 기본 변환은 위험한 주소를 빈 문자열로
 * 지워 버려, 글자로 남긴 링크의 `title`에 원래 주소를 보여줄 수 없다. **거르는 자리는 위
 * `a`와 `img`다** — 원시 HTML이 글자로 떨어지므로 마크다운에서 주소를 싣는 요소는 그 둘뿐이고,
 * 둘 다 여기서 다시 그린다. 이 가정은 Markdown.test의 "적대적인 문서 전체에서…"가 DOM
 * 전체를 훑어 고정한다.
 */
function keepUrl(url: string): string {
  return url
}

/** 서식 없이 그린 답. React가 이스케이프하므로 HTML도 글자다. 줄바꿈은 CSS(pre-wrap)가 지킨다. */
function PlainText({ text }: { text: string }) {
  return <div className="md md-plain">{text}</div>
}

interface BoundaryProps {
  text: string
  children: ReactNode
}

interface BoundaryState {
  failed: boolean
  /** 실패한 글. 이 글이 그대로면 다시 파싱하지 않는다 */
  failedFor: string | null
}

/**
 * 판정을 빠져나간 오류를 받는 마지막 겹. **경계가 없으면 React 19가 루트를 통째로 내린다** —
 * 답 하나 때문에 사이드바·이슈·도크까지 사라지고, 답은 DB에 남아 그 대화를 열 때마다 다시 터진다.
 *
 * 글이 바뀌면 다시 그려 본다(진행 중에 흐르는 답은 다음 글이 멀쩡할 수 있다). 같은 글이면 평문에
 * 머문다 — 실패한 파싱을 렌더마다 되풀이하면 그만큼 멈춘다.
 */
class MarkdownBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false, failedFor: null }

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { failed: true, failedFor: null }
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    if (!state.failed) return null
    // 방금 실패했다 — 어느 글에서 실패했는지 적어 둔다.
    if (state.failedFor === null) return { failedFor: props.text }
    if (state.failedFor !== props.text) return { failed: false, failedFor: null }
    return null
  }

  render() {
    return this.state.failed ? <PlainText text={this.props.text} /> : this.props.children
  }
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  // 파싱을 시작하면 멈출 수 없다 — 넘으면 파서에 넘기지 않는다.
  if (!fitsMarkdownBudget(text)) return <PlainText text={text} />
  return (
    <MarkdownBoundary text={text}>
      <div className="md">
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS} urlTransform={keepUrl}>
          {text}
        </ReactMarkdown>
      </div>
    </MarkdownBoundary>
  )
})
