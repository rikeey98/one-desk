import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { BodyField } from './BodyField'

function Harness({ initial, readOnly, onBlur }: { initial: string; readOnly?: boolean; onBlur?: () => void }) {
  const [value, setValue] = useState(initial)
  return <BodyField value={value} onChange={setValue} readOnly={readOnly} onBlur={onBlur} />
}

const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed')

describe('BodyField (docs/sdlc/item-windows/ FR-20~24)', () => {
  it('본문이 있으면 읽기(마크다운)로 시작한다', () => {
    const { container } = render(<Harness initial={'# 제목\n\n- 하나'} />)
    expect(pressed('마크다운으로 보기')).toBe('true')
    expect(screen.queryByRole('textbox', { name: '본문' })).toBeNull()
    expect(screen.getByRole('heading', { name: '제목' })).toBeInTheDocument()
    expect(container.querySelector('li')).toHaveTextContent('하나')
  })

  it('비어 있으면 편집으로 시작하고, 커서를 가져가지 않는다', () => {
    render(<Harness initial="  " />)
    expect(pressed('원문 편집')).toBe('true')
    expect(screen.getByRole('textbox', { name: '본문' })).not.toHaveFocus()
  })

  it('편집으로 옮기면 편집칸에 커서가 가고, 친 글자가 읽기에 바로 보인다 (FR-23)', async () => {
    render(<Harness initial="처음" />)
    await userEvent.click(screen.getByRole('button', { name: '원문 편집' }))
    const box = screen.getByRole('textbox', { name: '본문' })
    expect(box).toHaveFocus()
    await userEvent.type(box, ' **굵게**')
    await userEvent.click(screen.getByRole('button', { name: '마크다운으로 보기' }))
    expect(screen.getByText('굵게').tagName).toBe('STRONG')
  })

  it('읽기에서 두 번 누르면 편집으로 간다 — 링크 위는 아니다', () => {
    render(<Harness initial={'글 [링크](https://example.com)'} />)
    fireEvent.doubleClick(screen.getByRole('link', { name: '링크' }))
    expect(pressed('마크다운으로 보기')).toBe('true')
    fireEvent.doubleClick(screen.getByText(/글/))
    expect(pressed('원문 편집')).toBe('true')
  })

  it('편집칸을 떠나면 onBlur — 대기 중인 저장을 흘려보내는 자리', async () => {
    const onBlur = vi.fn()
    render(<Harness initial="" onBlur={onBlur} />)
    await userEvent.type(screen.getByRole('textbox', { name: '본문' }), 'a')
    await userEvent.click(screen.getByRole('button', { name: '마크다운으로 보기' }))
    expect(onBlur).toHaveBeenCalled()
  })

  it('discovered(readOnly)는 비어 있어도 읽기로 시작하고, 전환은 "원문 보기"이며 고칠 수 없다', async () => {
    render(<Harness initial="" readOnly />)
    expect(pressed('마크다운으로 보기')).toBe('true')
    expect(screen.queryByRole('button', { name: '원문 편집' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '원문 보기' }))
    expect(screen.getByRole('textbox', { name: '본문' })).toHaveAttribute('readonly')
  })

  it('남의 본문을 그대로 실행하지 않는다 — Markdown 규칙 그대로다 (FR-22)', () => {
    const { container } = render(<Harness initial={'<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))\n\n![i](https://e.com/a.png)'} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('a[href^="javascript"]')).toBeNull()
    expect(container.querySelector('[onerror]')).toBeNull()
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument()
  })

  it('비어 있는 본문을 읽기로 보면 그렇다고 말한다', async () => {
    render(<Harness initial="" />)
    await userEvent.click(screen.getByRole('button', { name: '마크다운으로 보기' }))
    expect(screen.getByText('본문이 비어 있습니다')).toBeInTheDocument()
  })
})

describe('BodyField — frontmatter', () => {
  it('SKILL.md의 frontmatter는 제목으로 뭉개지지 않고 위에 평문으로 선다', () => {
    const { container } = render(<Harness initial={'---\nname: 배포\ndescription: 배포 절차\n---\n# 본문 제목\n'} />)
    expect(container.querySelector('.body-frontmatter')).toHaveTextContent('name: 배포')
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['본문 제목'])
  })
})
