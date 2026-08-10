import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from './client/ClientProvider'
import { RunEventProvider } from './store/RunEventContext'
import { createRunEventStore } from './store/runEvents'
import App from './App'
import type { OneDeskClient } from '@shared/client'
import type { Repo, Workspace } from '@shared/models'

const workspace: Workspace = {
  id: 'w1', name: 'ws1', description: null, defaultAgentKind: 'claude-code',
  defaultModelClaude: null, defaultModelOpencode: null, defaultPermission: 'edit',
  claudePath: null, opencodePath: null, createdAt: 0, updatedAt: 0
}

/**
 * repos.list()가 실제 백엔드처럼 "그 순간의 최신 목록"을 돌려주게 만든다.
 * 버그는 백엔드가 아니라 화면 쪽 상태 동기화에 있었으므로, mock은 항상 진실을
 * 돌려주되 각 컴포넌트가 그 진실을 다시 조회하는지를 테스트가 가려낸다.
 */
function makeClient(): OneDeskClient {
  let repos: Repo[] = []
  return {
    workspaces: { list: vi.fn().mockResolvedValue([workspace]), create: vi.fn(), remove: vi.fn() },
    repos: {
      list: vi.fn(async () => repos),
      create: vi.fn(async (input) => {
        const created: Repo = {
          id: 'r1', workspaceId: input.workspaceId, name: input.name, path: input.path,
          description: null, sortOrder: 0, createdAt: 0
        }
        repos = [...repos, created]
        return created
      }),
      remove: vi.fn()
    },
    issues: { list: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    memos: { list: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    runs: { list: vi.fn().mockResolvedValue([]), start: vi.fn(), cancel: vi.fn(), readLog: vi.fn() },
    events: { onRunEvent: vi.fn(() => () => {}), onRunUpdate: vi.fn(() => () => {}) }
  } as unknown as OneDeskClient
}

describe('App', () => {
  it('repo를 등록하면 실행 패널의 작업 디렉토리에도 바로 반영된다', async () => {
    // RepoStrip과 RunPanel이 각자 독립된 repo 목록 상태를 들고 있으면, RepoStrip에서
    // repo를 추가해도 RunPanel은 그 사실을 몰라 작업 디렉토리 select가 영원히 비고
    // ▶ 실행 버튼도 계속 비활성으로 남는다 — e2e에서 실제로 재현된 결함이다.
    render(
      <ClientProvider client={makeClient()}>
        <RunEventProvider store={createRunEventStore()}>
          <App />
        </RunEventProvider>
      </ClientProvider>
    )

    await userEvent.click(await screen.findByRole('button', { name: 'ws1' }))

    await userEvent.type(await screen.findByPlaceholderText('repo 이름'), 'api')
    await userEvent.type(screen.getByPlaceholderText('/절대/경로'), '/tmp/api')
    await userEvent.click(screen.getByRole('button', { name: '추가' }))
    await screen.findByRole('button', { name: 'api 맥락에 담기' })

    // RunPanel의 작업 디렉토리 select가 새 repo를 알아야 한다.
    await waitFor(() => expect(screen.getByLabelText('작업 디렉토리')).toHaveValue('/tmp/api'))

    await userEvent.type(screen.getByPlaceholderText(/무엇을 시킬지/), '고쳐줘')
    expect(screen.getByRole('button', { name: '▶ 실행' })).toBeEnabled()
  })
})
