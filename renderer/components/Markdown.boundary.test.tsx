import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Markdown } from './Markdown'

/**
 * 판정(`fitsMarkdownBudget`)을 빠져나간 오류를 받는 마지막 겹 (spec FR-20 다듬음 — 리뷰가 찾은 것).
 *
 * 예산은 실측으로 고른 위 한계라 다른 환경(렌더러의 스택 한계가 다르다든가)에서 빗나갈 수 있다.
 * 그때 렌더 중 오류가 경계 없이 올라가면 React 19가 루트를 통째로 내린다 — 앱 창 전체가 빈 화면이
 * 된다. 파서를 모의로 바꿔 **판정을 통과한 글에서 던지는** 경우를 만든다.
 */
const parse = vi.hoisted(() => ({ fail: true }))

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => {
    if (parse.fail) throw new RangeError('Maximum call stack size exceeded')
    return <p>{children}</p>
  }
}))

describe('Markdown — 오류 경계', () => {
  beforeEach(() => {
    parse.fail = true
    // React가 받은 오류를 console.error로 알린다 — 이 파일에서는 일부러 던지므로 소음이다.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('파서가 던지면 그 답만 평문으로 떨어지고 곁의 화면은 남는다', () => {
    const { container } = render(<div><p>사이드바</p><Markdown text={'**답**'} /></div>)
    expect(screen.getByText('사이드바')).toBeInTheDocument()
    expect(container.querySelector('.md-plain')?.textContent).toBe('**답**')
  })

  it('글이 바뀌면 다시 그려 본다 — 흐르는 답의 다음 글은 다를 수 있다', () => {
    const { container, rerender } = render(<Markdown text={'첫 글'} />)
    expect(container.querySelector('.md-plain')).toHaveTextContent('첫 글')

    parse.fail = false
    rerender(<Markdown text={'다음 글'} />)
    expect(container.querySelector('.md-plain')).toBeNull()
    expect(screen.getByText('다음 글')).toBeInTheDocument()
  })

  it('같은 글이면 다시 파싱하지 않는다 — 실패한 글을 매 렌더 되풀이하지 않는다', () => {
    const { container, rerender } = render(<div><Markdown text={'같은 글'} /><span>1</span></div>)
    parse.fail = false
    rerender(<div><Markdown text={'같은 글'} /><span>2</span></div>)
    expect(container.querySelector('.md-plain')).toHaveTextContent('같은 글')
  })
})
