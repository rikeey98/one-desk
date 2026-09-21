import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Transcript } from './Transcript'
import { groupConversations } from '../conversation'
import { useRunEvents } from '../hooks/useRunEvents'
import type { Run } from '@shared/models'

// vi.fn()으로 감싸 호출 여부·횟수·인자를 단언할 수 있게 한다.
// DOM에 텍스트가 있는지만 보면 "훅이 안 불렸다"와 "훅은 불렸지만 JSX만 감췄다"를
// 구분하지 못한다 — 후자도 회귀지만 텍스트 단언만으로는 초록으로 남는다.
vi.mock('../hooks/useRunEvents', () => ({
  useRunEvents: vi.fn(() => ({ events: [{ type: 'text', seq: 1, runId: 'a1', at: 0, text: '도구 로그' }], error: null }))
}))

const useRunEventsMock = vi.mocked(useRunEvents)

beforeEach(() => {
  useRunEventsMock.mockClear()
})

function makeRun(over: Partial<Run> & { id: string }): Run {
  return {
    workspaceId: 'ws', agentKind: 'claude-code', model: null, cwd: '/tmp',
    permission: 'edit', userPrompt: '지시', assembledPrompt: '지시', status: 'succeeded',
    externalSessionId: null, parentRunId: null, rootRunId: over.id, resultText: null,
    needsAnswer: false, timeoutMs: null, exitCode: null, errorMessage: null,
    logPath: '/tmp/x.log', reviewedAt: null, reviewedKind: null, startedAt: null,
    endedAt: null, createdAt: 0, contextItems: [], usage: null, ...over
  }
}

describe('Transcript', () => {
  it('턴마다 지시와 답변을 그린다', () => {
    const conv = groupConversations([
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, userPrompt: '첫 지시', resultText: '첫 답변' })
    ])[0]!
    render(<Transcript conversation={conv} onCancel={() => {}} />)
    expect(screen.getByText('첫 지시')).toBeInTheDocument()
    expect(screen.getByText('첫 답변')).toBeInTheDocument()
  })

  it('지난 턴의 로그는 접혀 있고 눌러야 펼쳐진다', async () => {
    const conv = groupConversations([
      makeRun({ id: 'a1', rootRunId: 'a1', status: 'succeeded', resultText: '답변' })
    ])[0]!
    render(<Transcript conversation={conv} onCancel={() => {}} />)
    expect(screen.queryByText('도구 로그')).not.toBeInTheDocument()
    // DOM 단언만으로는 "TurnLog가 마운트 안 됨"과 "마운트됐지만 JSX만 숨김"을 구분 못 한다.
    // 훅 자체가 안 불렸다는 것을 직접 확인한다.
    expect(useRunEventsMock).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '자세히' }))
    expect(screen.getByText('도구 로그')).toBeInTheDocument()
    expect(useRunEventsMock).toHaveBeenCalledWith('a1')
  })

  it('진행 중인 턴은 로그가 처음부터 펼쳐져 있다', () => {
    const conv = groupConversations([
      makeRun({ id: 'a1', rootRunId: 'a1', status: 'running' })
    ])[0]!
    render(<Transcript conversation={conv} onCancel={() => {}} />)
    expect(screen.getByText('도구 로그')).toBeInTheDocument()
  })

  it('예약된 턴이 자동으로 시작되면(재마운트 없이) 로그가 펼쳐진다 (I-1)', () => {
    // useState의 초기값은 마운트 때 한 번만 평가된다. 예약된 턴은 pending으로
    // 먼저 마운트되므로 open=false로 굳는다 — 앞 턴이 끝나 같은 run.id가
    // running으로 전이해도(재마운트가 없다) 접힌 채로 남으면 이 회귀다.
    const pending = groupConversations([
      makeRun({ id: 'a1', rootRunId: 'a1', status: 'pending', userPrompt: '예약된 말' })
    ])[0]!
    const { rerender } = render(<Transcript conversation={pending} onCancel={() => {}} />)
    expect(useRunEventsMock).not.toHaveBeenCalled()

    const running = groupConversations([
      makeRun({ id: 'a1', rootRunId: 'a1', status: 'running', userPrompt: '예약된 말' })
    ])[0]!
    rerender(<Transcript conversation={running} onCancel={() => {}} />)

    expect(useRunEventsMock).toHaveBeenCalledWith('a1')
    expect(screen.getByText('도구 로그')).toBeInTheDocument()
  })

  it('예약된 턴은 대기 중으로 보이고 취소할 수 있다', async () => {
    const onCancel = vi.fn()
    const conv = groupConversations([
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'pending', userPrompt: '예약된 말' }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'succeeded' })
    ])[0]!
    render(<Transcript conversation={conv} onCancel={onCancel} />)
    expect(screen.getByText('대기 중')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(onCancel).toHaveBeenCalledWith('a2')
  })

  it('답변 필요 배지를 단다', () => {
    const conv = groupConversations([
      makeRun({ id: 'a1', rootRunId: 'a1', needsAnswer: true, resultText: '무엇을 할까요?' })
    ])[0]!
    render(<Transcript conversation={conv} onCancel={() => {}} />)
    expect(screen.getByText('답변 필요')).toBeInTheDocument()
  })

  /** 실행 정보 한 줄 (`docs/sdlc/run-info/`) */
  describe('실행 정보 줄', () => {
    const full = {
      model: 'claude-opus-5[1m]', inputTokens: 12431, outputTokens: 1203,
      cacheReadTokens: 15428, cacheWriteTokens: 37917, reasoningTokens: 0,
      costUsd: 0.386994, contextTokens: 53347, contextWindow: 1000000
    }

    function renderTurn(usage: Run['usage']) {
      const conv = groupConversations([
        makeRun({ id: 'a1', rootRunId: 'a1', resultText: '했습니다', usage })
      ])[0]!
      const { container } = render(<Transcript conversation={conv} onCancel={() => {}} />)
      return container.querySelector('.turn-info')
    }

    it('모델·토큰·컨텍스트를 한 줄로 보여준다', () => {
      const row = renderTurn(full)!
      expect(row).toBeInTheDocument()
      expect(row.textContent).toContain('claude-opus-5[1m]')
      expect(row.textContent).toContain('12.4k↑ 1.2k↓')
      expect(row.textContent).toContain('컨텍스트 5%')
    })

    it('정확한 수치와 비용은 호버로 읽는다 — 화면에 돈을 띄우지 않는다', () => {
      const row = renderTurn(full)!
      expect(row.getAttribute('title')).toContain('캐시 읽기 15,428')
      expect(row.getAttribute('title')).toContain('$0.3870')
      expect(row.textContent).not.toContain('$')
    })

    it('모르는 조각은 빠진다 — OpenCode는 모델도 창도 모른다', () => {
      const row = renderTurn({
        ...full, model: null, contextWindow: null, contextTokens: 6000
      })!
      expect(row.textContent).not.toContain('claude')
      expect(row.textContent).toContain('컨텍스트 6.0k')
      expect(row.textContent).not.toContain('%')
    })

    it('사용량이 없으면 줄 자체가 없다 — 이 기능 이전의 run은 화면이 그대로다', () => {
      expect(renderTurn(null)).toBeNull()
    })

    it('보기 전용이다 — 줄 안에 버튼이 없다', () => {
      const row = renderTurn(full)!
      expect(within(row as HTMLElement).queryAllByRole('button')).toEqual([])
    })

    it('예약된 턴에는 줄이 없다 — 아직 아무것도 쓰지 않았다', () => {
      const conv = groupConversations([
        makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'pending', usage: full }),
        makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'succeeded', usage: null })
      ])[0]!
      const { container } = render(<Transcript conversation={conv} onCancel={() => {}} />)
      expect(container.querySelectorAll('.turn-info')).toHaveLength(0)
    })
  })

})
