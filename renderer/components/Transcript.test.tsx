import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Transcript } from './Transcript'
import { groupConversations } from '../conversation'
import type { Run } from '@shared/models'

vi.mock('../hooks/useRunEvents', () => ({
  useRunEvents: () => ({ events: [{ type: 'text', seq: 1, runId: 'a1', at: 0, text: '도구 로그' }], error: null })
}))

function makeRun(over: Partial<Run> & { id: string }): Run {
  return {
    workspaceId: 'ws', agentKind: 'claude-code', model: null, cwd: '/tmp',
    permission: 'edit', userPrompt: '지시', assembledPrompt: '지시', status: 'succeeded',
    externalSessionId: null, parentRunId: null, rootRunId: over.id, resultText: null,
    needsAnswer: false, timeoutMs: null, exitCode: null, errorMessage: null,
    logPath: '/tmp/x.log', reviewedAt: null, reviewedKind: null, startedAt: null,
    endedAt: null, createdAt: 0, contextItems: [], ...over
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
    await userEvent.click(screen.getByRole('button', { name: '자세히' }))
    expect(screen.getByText('도구 로그')).toBeInTheDocument()
  })

  it('진행 중인 턴은 로그가 처음부터 펼쳐져 있다', () => {
    const conv = groupConversations([
      makeRun({ id: 'a1', rootRunId: 'a1', status: 'running' })
    ])[0]!
    render(<Transcript conversation={conv} onCancel={() => {}} />)
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
})
