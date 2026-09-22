import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ModelField } from './ModelField'
import { CLAUDE_MODEL_SUGGESTIONS } from '../models'

function optionValues(): string[] {
  return Array.from(document.querySelectorAll('datalist option')).map((o) => o.getAttribute('value')!)
}

describe('ModelField — 자유 입력 (FR-8)', () => {
  it('제안에 없는 이름을 쳐도 그대로 올려보낸다', () => {
    // **이것이 드롭다운 강제안 대신 이 모양을 고른 이유의 전부다.** 별칭 표는
    // 낡는데, 막히지 않으면 새 모델이 나온 날 바로 쓸 수 있다.
    const onChange = vi.fn()
    render(<ModelField agentKind="claude-code" value="" onChange={onChange} label="모델" />)

    fireEvent.change(screen.getByLabelText('모델'), { target: { value: 'claude-fable-9' } })

    expect(onChange).toHaveBeenCalledWith('claude-fable-9')
  })

  it('select가 아니라 input이다', () => {
    // select로 바뀌면 목록에 없는 값이 브라우저에서 ''로 정규화돼 조용히 사라진다.
    render(<ModelField agentKind="claude-code" value="sonnet" onChange={() => {}} label="모델" />)
    expect(screen.getByLabelText('모델').tagName).toBe('INPUT')
  })

  it('빈 값이 CLI 기본값이라는 것을 placeholder가 알려준다', () => {
    render(<ModelField agentKind="claude-code" value="" onChange={() => {}} label="모델" />)
    expect(screen.getByLabelText('모델')).toHaveAttribute('placeholder', expect.stringContaining('기본값'))
  })
})

describe('ModelField — 제안 목록 (FR-9)', () => {
  it('claude는 앱이 가진 별칭 표를 제안한다', () => {
    // 조회 수단이 없다 — 서브커맨드에 models가 없다(2026-09-22 실측).
    render(<ModelField agentKind="claude-code" value="" onChange={() => {}} label="모델" />)
    expect(optionValues()).toEqual([...CLAUDE_MODEL_SUGGESTIONS])
  })

  it('opencode는 조회된 목록을 제안한다', () => {
    render(
      <ModelField
        agentKind="opencode" value="" onChange={() => {}} label="모델"
        probed={['openrouter/anthropic/claude-sonnet-4.5', 'opencode/big-pickle']}
      />
    )
    expect(optionValues()).toEqual(['openrouter/anthropic/claude-sonnet-4.5', 'opencode/big-pickle'])
  })

  it('opencode에 claude 별칭이 섞이지 않는다', () => {
    // 섞이면 `sonnet`을 골라 provider/model 자리에 넣게 된다(설계 §199).
    render(<ModelField agentKind="opencode" value="" onChange={() => {}} label="모델" probed={[]} />)
    expect(optionValues()).toEqual([])
  })

  it('제안이 없으면 datalist를 붙이지 않는다', () => {
    render(<ModelField agentKind="opencode" value="" onChange={() => {}} label="모델" probed={[]} />)
    expect(screen.getByLabelText('모델')).not.toHaveAttribute('list')
  })

  it('입력칸이 datalist를 가리킨다', () => {
    const { container } = render(
      <ModelField agentKind="claude-code" value="" onChange={() => {}} label="모델" />
    )
    const list = screen.getByLabelText('모델').getAttribute('list')
    expect(list).toBeTruthy()
    expect(container.ownerDocument.getElementById(list!)?.tagName).toBe('DATALIST')
  })
})

describe('ModelField — 해석 결과 (FR-10)', () => {
  it('해석된 이름을 보여준다', () => {
    render(
      <ModelField
        agentKind="claude-code" value="sonnet" onChange={() => {}} label="모델"
        resolved={{ state: 'resolved', model: 'claude-sonnet-5' }}
      />
    )
    expect(screen.getByText('claude-sonnet-5')).toBeInTheDocument()
  })

  it('"이 모델로 돕니다"라고 말하지 않는다', () => {
    // init은 모델을 **검증하지 않는다** — 없는 이름 gpt-9도 그대로 되돌려 준다
    // (2026-09-22 실측). 문구가 그 선을 넘으면 화면이 확인하지 않은 것을
    // 확인했다고 말하게 된다(spec FR-10의 제약).
    const { container } = render(
      <ModelField
        agentKind="claude-code" value="gpt-9" onChange={() => {}} label="모델"
        resolved={{ state: 'resolved', model: 'gpt-9' }}
      />
    )
    expect(container.textContent).toContain('넘어갑니다')
    expect(container.textContent).not.toContain('돕니다')
  })

  it('건너뛴 이유를 그대로 보여준다', () => {
    render(
      <ModelField
        agentKind="claude-code" value="" onChange={() => {}} label="모델"
        resolved={{ state: 'skipped', reason: '로그인한 뒤에 확인합니다.' }}
      />
    )
    expect(screen.getByText('로그인한 뒤에 확인합니다.')).toBeInTheDocument()
  })

  it('조회 실패 사유도 보여준다', () => {
    render(
      <ModelField
        agentKind="claude-code" value="" onChange={() => {}} label="모델"
        resolved={{ state: 'unknown', reason: '시간이 초과됐습니다' }}
      />
    )
    expect(screen.getByText('시간이 초과됐습니다')).toBeInTheDocument()
  })

  it('해석 결과가 없으면 줄을 그리지 않는다', () => {
    const { container } = render(
      <ModelField agentKind="claude-code" value="" onChange={() => {}} label="모델" />
    )
    expect(container.querySelector('.field-note')).toBeNull()
  })
})
