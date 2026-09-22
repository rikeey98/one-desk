import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { MemoPanel } from './MemoPanel'
import type { Memo } from '@shared/models'
import type { OneDeskClient } from '@shared/client'

const NOW = Date.now()

function makeMemo(over: Partial<Memo> = {}): Memo {
  return {
    id: 'm1', workspaceId: 'ws', title: '제목', body: '',
    repoIds: [], createdAt: NOW, updatedAt: NOW,
    ...over
  }
}

interface PanelMocks {
  list: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
}

function renderPanel(memos: Memo[], over: {
  openId?: string | null
  expanded?: boolean
  onOpen?: (id: string) => void
} = {}): PanelMocks {
  const mocks: PanelMocks = {
    list: vi.fn(async () => memos),
    create: vi.fn(),
    remove: vi.fn(async () => {})
  }
  const client = {
    memos: {
      ...mocks,
      update: vi.fn(),
      updateIfUnchanged: vi.fn()
    },
    // useMemos가 run 완료를 구독한다. 해제 함수를 돌려주지 않으면 언마운트가 터진다.
    events: { onRunUpdate: () => () => {} }
  } as unknown as OneDeskClient

  render(
    <ClientProvider client={client}>
      <MemoPanel
        workspaceId="ws"
        repoId={null}
        repos={[]}
        chipKeys={new Set()}
        onToggleContext={() => {}}
        expanded={over.expanded ?? false}
        openId={over.openId ?? null}
        onOpen={over.onOpen ?? (() => {})}
      />
    </ClientProvider>
  )
  return mocks
}

describe('MemoPanel 목록 삭제', () => {
  it('한 번 눌러서는 지우지 않는다', async () => {
    const mocks = renderPanel([makeMemo({ id: 'a', title: 'A' })])
    await userEvent.click(await screen.findByRole('button', { name: 'A 삭제' }))
    // 되돌릴 수 없는 동작이라 두 번 눌러야 한다 (IssuePanel과 대칭).
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('두 번 누르면 그 메모를 지우고 목록을 다시 읽는다', async () => {
    const mocks = renderPanel([makeMemo({ id: 'a', title: 'A' })])
    await userEvent.click(await screen.findByRole('button', { name: 'A 삭제' }))
    await userEvent.click(screen.getByRole('button', { name: '정말 삭제?' }))
    expect(mocks.remove).toHaveBeenCalledWith('a')
    // 지운 뒤 다시 읽지 않으면 방금 지운 줄이 화면에 그대로 남는다.
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))
  })

  it('삭제가 실패하면 오류를 보여준다', async () => {
    const mocks = renderPanel([makeMemo({ id: 'a', title: 'A' })])
    mocks.remove.mockRejectedValueOnce(new Error('DB가 잠겼습니다'))
    await userEvent.click(await screen.findByRole('button', { name: 'A 삭제' }))
    await userEvent.click(screen.getByRole('button', { name: '정말 삭제?' }))
    // 조용히 삼키면 줄이 그대로 남아 "안 눌렸나" 하고 다시 누르게 된다.
    expect(await screen.findByRole('alert')).toHaveTextContent('DB가 잠겼습니다')
  })

  it('열려 있는 메모를 목록에서 지우면 상세가 닫힌다', async () => {
    const memos = [makeMemo({ id: 'a', title: 'A' })]
    const opened: string[] = []
    const mocks = renderPanel(memos, { openId: 'a', expanded: true, onOpen: (id) => opened.push(id) })
    mocks.remove.mockImplementationOnce(async (id: string) => {
      memos.splice(memos.findIndex((m) => m.id === id), 1)
    })
    await userEvent.click(await screen.findByRole('button', { name: 'A 삭제' }))
    await userEvent.click(screen.getByRole('button', { name: '정말 삭제?' }))
    await waitFor(() => expect(opened).toContain('a'))
  })
})
