import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { RunEventProvider } from '../store/RunEventContext'
import { createRunEventStore } from '../store/runEvents'
import { ConversationPanel } from './ConversationPanel'
import { groupConversations } from '../conversation'
import type { OneDeskClient } from '@shared/client'
import type { Conversation } from '../conversation'
import type { Repo, Run, Workspace } from '@shared/models'

const repos: Repo[] = [
  { id: 'r1', workspaceId: 'w1', name: 'api', path: '/tmp/api', description: null, sortOrder: 0, createdAt: 0 }
]

const workspace: Workspace = {
  id: 'w1', name: 'ws', description: null, defaultAgentKind: 'claude-code',
  defaultModelClaude: null, defaultModelOpencode: null, defaultPermission: 'edit',
  claudePath: null, opencodePath: null, createdAt: 0, updatedAt: 0
}

function makeRun(over: Partial<Run> & { id: string }): Run {
  return {
    workspaceId: 'w1', agentKind: 'claude-code', model: null, cwd: '/tmp/api',
    permission: 'edit', userPrompt: '지시', assembledPrompt: '지시', status: 'succeeded',
    externalSessionId: 'sess-1', parentRunId: null, rootRunId: over.id, resultText: null,
    needsAnswer: false, timeoutMs: null, exitCode: null, errorMessage: null,
    logPath: '/tmp/x.log', reviewedAt: null, reviewedKind: null, startedAt: null,
    endedAt: null, createdAt: 0, contextItems: [],
    ...over
  }
}

function makeClient(opts: { resume?: ReturnType<typeof vi.fn> } = {}): OneDeskClient {
  return {
    workspaces: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
    repos: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
    runs: {
      list: vi.fn().mockResolvedValue([]),
      start: vi.fn().mockResolvedValue({ id: 'run-1' } as Run),
      resume: opts.resume ?? vi.fn().mockResolvedValue({ id: 'run-2' } as Run),
      cancel: vi.fn(), readLog: vi.fn().mockResolvedValue([])
    },
    events: {
      onRunEvent: vi.fn(() => () => {}),
      onRunUpdate: vi.fn(() => () => {}),
      onQueueUpdate: vi.fn(() => () => {}),
      onInboxUpdate: vi.fn(() => () => {})
    }
  } as unknown as OneDeskClient
}

/** RunPanel.test.tsx의 방식을 그대로 따른다 — ClientProvider로 감싸 client.runs.resume을
 *  가짜로 준다. */
function renderPanel(
  conversation: Conversation | null,
  opts: { resume?: ReturnType<typeof vi.fn>; onCancel?: (runId: string) => void } = {}
) {
  const client = makeClient(opts)
  render(
    <ClientProvider client={client}>
      {/* 진행 중인 턴은 처음부터 펼쳐져 useRunEvents를 건다(Task 7) — 그 훅이
          RunEventProvider 컨텍스트를 요구하므로 여기서도 감싸 준다. */}
      <RunEventProvider store={createRunEventStore()}>
        <ConversationPanel
          conversation={conversation}
          workspaceId="w1"
          workspaces={[workspace]}
          repos={repos}
          reposError={null}
          chips={[]}
          onRemoveChip={vi.fn()}
          onStarted={vi.fn()}
          onCancel={opts.onCancel ?? vi.fn()}
          draftPrompt=""
          draftCwd={null}
        />
      </RunEventProvider>
    </ClientProvider>
  )
  return client
}

describe('ConversationPanel', () => {
  it('conversation이 null이면 새 대화 안내와 입력부만 보여준다', () => {
    renderPanel(null)
    expect(screen.getByText('지시를 입력하면 대화가 시작됩니다')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '실행' })).toBeInTheDocument()
  })

  it('conversation이 있으면 대화록을 보여준다', () => {
    const conv = groupConversations([
      makeRun({ id: 'a1', createdAt: 10, userPrompt: '질문', resultText: '답변' })
    ])[0]!
    renderPanel(conv)
    expect(screen.getByText('질문')).toBeInTheDocument()
    expect(screen.getByText('답변')).toBeInTheDocument()
    expect(screen.queryByText('지시를 입력하면 대화가 시작됩니다')).not.toBeInTheDocument()
  })

  it('예약이 이미 있으면 전송이 잠긴다', async () => {
    // 대화당 예약은 하나다 (설계 §3-2).
    const conv = groupConversations([
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'pending' }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'running' })
    ])[0]!
    renderPanel(conv)
    await userEvent.type(screen.getByRole('textbox', { name: /지시/ }), '또 하나')
    expect(screen.getByRole('button', { name: '실행' })).toBeDisabled()
  })

  it('실행 중이어도 입력은 받는다', async () => {
    const conv = groupConversations([
      makeRun({ id: 'a1', rootRunId: 'a1', status: 'running' })
    ])[0]!
    renderPanel(conv)
    const box = screen.getByRole('textbox', { name: /지시/ })
    await userEvent.type(box, '다음 말')
    expect(box).toHaveValue('다음 말')
    expect(screen.getByRole('button', { name: '실행' })).toBeEnabled()
  })
})
