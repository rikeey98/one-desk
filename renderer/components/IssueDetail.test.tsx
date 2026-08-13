import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { IssueDetail } from './IssueDetail'
import type { Issue } from '@shared/models'
import type { OneDeskClient } from '@shared/client'

function makeIssue(over: Partial<Issue> = {}): Issue {
  return {
    id: 'i1', workspaceId: 'w1', title: '토큰 만료', body: '원본', status: 'open',
    repoIds: [], createdAt: 0, updatedAt: 100, closedAt: null, ...over
  }
}

/** updateIfUnchanged와 update만 가진 최소 클라이언트. 나머지는 부르지 않는다. */
function makeClient(over: Partial<OneDeskClient['issues']> = {}): OneDeskClient {
  return {
    issues: {
      list: vi.fn(), create: vi.fn(),
      update: vi.fn(async (i) => makeIssue({ ...i, updatedAt: 200 })),
      updateIfUnchanged: vi.fn(async (i) => ({
        ok: true as const, issue: makeIssue({ ...i, updatedAt: 200 })
      })),
      remove: vi.fn(),
      ...over
    }
  } as unknown as OneDeskClient
}

function renderDetail(client: OneDeskClient, issue = makeIssue(), over = {}) {
  const props = { issue, onChanged: vi.fn(), onDeleted: vi.fn(), ...over }
  render(
    <ClientProvider client={client}>
      <IssueDetail {...props} />
    </ClientProvider>
  )
  return props
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
afterEach(() => { vi.useRealTimers() })

describe('IssueDetail', () => {
  it('제목과 본문을 보여준다', () => {
    renderDetail(makeClient())
    expect(screen.getByDisplayValue('토큰 만료')).toBeInTheDocument()
    expect(screen.getByDisplayValue('원본')).toBeInTheDocument()
  })

  it('본문을 고치면 기대 updatedAt과 함께 저장한다', async () => {
    const client = makeClient()
    renderDetail(client)
    await userEvent.type(screen.getByLabelText('본문'), '!')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(client.issues.updateIfUnchanged).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'i1', body: '원본!', expectedUpdatedAt: 100 })
    )
  })

  it('성공한 저장이 기대값을 갱신해 두 번째 저장이 충돌하지 않는다', async () => {
    // 갱신을 빠뜨리면 두 번째 자동 저장이 자기 자신과 충돌한다 (설계 §6).
    const client = makeClient()
    renderDetail(client)
    await userEvent.type(screen.getByLabelText('본문'), 'a')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    await userEvent.type(screen.getByLabelText('본문'), 'b')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })

    const calls = vi.mocked(client.issues.updateIfUnchanged).mock.calls
    expect(calls[0]![0].expectedUpdatedAt).toBe(100)
    expect(calls[1]![0].expectedUpdatedAt).toBe(200)
  })

  it('충돌하면 배너를 띄우고 자동 저장을 멈춘다', async () => {
    const client = makeClient({
      updateIfUnchanged: vi.fn(async () => ({
        ok: false as const, current: makeIssue({ body: 'agent가 쓴 것', updatedAt: 300 })
      }))
    })
    renderDetail(client)
    await userEvent.type(screen.getByLabelText('본문'), '!')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(screen.getByRole('alert')).toHaveTextContent('그 사이 바뀌었습니다')

    // 배너가 떠 있는 동안은 더 쳐도 저장하지 않는다 — 재시도하면 결국 덮어쓰기가 된다
    await userEvent.type(screen.getByLabelText('본문'), '?')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(client.issues.updateIfUnchanged).toHaveBeenCalledTimes(1)
  })

  it('다시 불러오기가 최신 본문을 띄운다', async () => {
    const client = makeClient({
      updateIfUnchanged: vi.fn(async () => ({
        ok: false as const, current: makeIssue({ body: 'agent가 쓴 것', updatedAt: 300 })
      }))
    })
    renderDetail(client)
    await userEvent.type(screen.getByLabelText('본문'), '!')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    await userEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
    expect(screen.getByLabelText('본문')).toHaveValue('agent가 쓴 것')
    expect(screen.queryByText('그 사이 바뀌었습니다')).toBeNull()
  })

  it('다시 불러오기 뒤의 저장은 새 기대값을 쓴다', async () => {
    // onReload가 expected.current를 conflict.updatedAt으로 갱신하지 않으면, 다시
    // 불러온 뒤의 다음 저장도 옛 기대값(마운트 때 값)을 들고 나가 또 충돌한다 —
    // "성공한 저장이 기대값을 갱신…" 테스트의 대칭 성질이다 (설계 §6).
    const updateIfUnchanged = vi.fn()
      .mockResolvedValueOnce({
        ok: false as const, current: makeIssue({ body: 'agent가 쓴 것', updatedAt: 300 })
      })
      .mockResolvedValue({
        ok: true as const, issue: makeIssue({ body: 'agent가 쓴 것 더', updatedAt: 400 })
      })
    const client = makeClient({ updateIfUnchanged })
    renderDetail(client)
    await userEvent.type(screen.getByLabelText('본문'), '!')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    await userEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))

    await userEvent.type(screen.getByLabelText('본문'), '?')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })

    expect(updateIfUnchanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedUpdatedAt: 300 })
    )
  })

  it('덮어쓰기가 잠금 없는 update를 부른다', async () => {
    const client = makeClient({
      updateIfUnchanged: vi.fn(async () => ({
        ok: false as const, current: makeIssue({ body: 'agent가 쓴 것', updatedAt: 300 })
      }))
    })
    renderDetail(client)
    await userEvent.type(screen.getByLabelText('본문'), '!')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    await userEvent.click(screen.getByRole('button', { name: '덮어쓰기' }))
    expect(client.issues.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'i1', body: '원본!' })
    )
  })

  it('저장이 실패하면 화면에 띄운다', async () => {
    const client = makeClient({
      updateIfUnchanged: vi.fn(async () => { throw new Error('DB가 잠겼습니다') })
    })
    renderDetail(client)
    await userEvent.type(screen.getByLabelText('본문'), '!')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(screen.getByText('DB가 잠겼습니다')).toBeInTheDocument()
  })

  it('삭제는 두 번 눌러야 하고, 지워지면 알린다', async () => {
    const client = makeClient()
    const props = renderDetail(client)
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    expect(client.issues.remove).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '정말 삭제?' }))
    expect(client.issues.remove).toHaveBeenCalledWith('i1')
    expect(props.onDeleted).toHaveBeenCalled()
  })
})
