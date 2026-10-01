import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { OpenWindowButton } from './OpenWindowButton'
import { IssuePanel } from './IssuePanel'
import type { OneDeskClient } from '@shared/client'

function client(openPanelWindow = vi.fn().mockResolvedValue(undefined)) {
  return {
    app: { openPanelWindow },
    issues: { list: vi.fn().mockResolvedValue([]) },
    events: { onRunUpdate: () => () => {}, onItemChanged: () => () => {} }
  } as unknown as OneDeskClient
}

describe('OpenWindowButton (docs/sdlc/item-windows/ FR-5)', () => {
  it('누른 순간의 범위로 연다', async () => {
    const c = client()
    render(<ClientProvider client={c}><OpenWindowButton kind="memo" workspaceId="w1" repoId="r1" /></ClientProvider>)
    await userEvent.click(screen.getByRole('button', { name: '메모 새 창으로 열기' }))
    expect(c.app.openPanelWindow).toHaveBeenCalledWith({ kind: 'memo', workspaceId: 'w1', repoId: 'r1' })
  })

  it('workspace가 없으면 그리지 않는다', () => {
    render(<ClientProvider client={client()}><OpenWindowButton kind="asset" workspaceId={null} repoId={null} /></ClientProvider>)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('실패하면 옆에 말한다', async () => {
    const c = client(vi.fn().mockRejectedValue(new Error('workspace를 찾을 수 없습니다: w1')))
    render(<ClientProvider client={c}><OpenWindowButton kind="issue" workspaceId="w1" repoId={null} /></ClientProvider>)
    await userEvent.click(screen.getByRole('button', { name: '이슈 새 창으로 열기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('workspace를 찾을 수 없습니다')
  })

  it('앱 창의 패널 헤더에 있고, 고른 repo로 연다', async () => {
    const c = client()
    render(
      <ClientProvider client={c}>
        <IssuePanel workspaceId="w1" repoId="r9" repos={[]} expanded={false} openId={null} onOpen={() => {}} />
      </ClientProvider>
    )
    await userEvent.click(screen.getByRole('button', { name: '이슈 새 창으로 열기' }))
    expect(c.app.openPanelWindow).toHaveBeenCalledWith({ kind: 'issue', workspaceId: 'w1', repoId: 'r9' })
  })
})
