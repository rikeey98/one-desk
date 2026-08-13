import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
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
    // queryByText는 정규화된 전체 문자열 매치라 배너 문구('이 항목이 그 사이
    // 바뀌었습니다.')와 부분 일치해도 항상 null을 돌려준다 — 배너가 남아 있어도
    // 이 단언은 계속 통과해 무력하다. role로 실제 마운트 여부를 본다.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('다시 불러오기가 대기 중인 저장을 취소해 되돌린 내용을 몰래 덮어쓰지 않는다', async () => {
    // 배너가 뜬 채로 계속 타이핑하면 충돌 전(스테일) 텍스트를 든 디바운스 타이머가
    // 새로 걸린다. 다시 불러오기가 그 타이머를 취소하지 않으면, 화면은 agent의
    // 텍스트를 보여주면서도 그 타이머가 나중에 마침 새로 맞춰진 expectedUpdatedAt과
    // 함께 스테일한 값을 몰래 써버려 화면과 DB가 갈린다 (설계 §6).
    const client = makeClient({
      updateIfUnchanged: vi.fn(async () => ({
        ok: false as const, current: makeIssue({ body: 'agent가 쓴 것', updatedAt: 300 })
      }))
    })
    renderDetail(client)
    await userEvent.type(screen.getByLabelText('본문'), '!')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(screen.getByRole('alert')).toBeInTheDocument()

    // 배너가 뜬 채로 계속 쳐서 충돌 전 텍스트를 든 새 타이머를 건다 — 이 타이머가
    // 돌기 전에 다시 불러온다.
    await userEvent.type(screen.getByLabelText('본문'), '?')
    // userEvent.click은 본문(textarea)에 있던 포커스를 버튼으로 옮기며 실제
    // 브라우저처럼 자연스러운 blur를 먼저 흘려보낸다. useDebouncedSave의 flush는
    // save를 부르기 전에 무조건 타이머부터 지우므로(구현 참고), 그 blur 하나만으로도
    // onReload의 로직과 무관하게 타이머가 사라져 이 테스트가 무력해진다(실측 확인 —
    // onReload에서 cancel 호출을 지워도 초록이었다). fireEvent.click은 포커스 이동을
    // 흉내내지 않아 오직 onReload 자신의 취소 여부만 남긴다.
    fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))

    vi.mocked(client.issues.updateIfUnchanged).mockClear()
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })

    expect(client.issues.updateIfUnchanged).not.toHaveBeenCalled()
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

  it('삭제 확인이 대기 중인 저장을 취소해 지워진 행에 쓰지 않는다', async () => {
    // 지우기 전에 대기 중이던 저장을 취소하지 않으면, 그 타이머(또는 실제 화면에서는
    // 언마운트 flush)가 나중에 살아남아 이미 지워진 행에 쓰기를 시도한다.
    const client = makeClient()
    const props = renderDetail(client)
    await userEvent.type(screen.getByLabelText('본문'), '!')
    // fireEvent로 클릭해 blur가 flush를 대신 흘려보내며 취소 여부를 가리는 것을
    // 막는다 (다시 불러오기 테스트와 같은 이유 — 실측 확인). fireEvent.click은
    // userEvent.click과 달리 반환값이 없어 onConfirm 안의 비동기 IIFE(await remove →
    // onDeleted)가 끝나길 기다려주지 않으므로, 클릭들 사이와 뒤에 act로 마이크로태스크를
    // 직접 흘려보낸다.
    fireEvent.click(screen.getByRole('button', { name: '삭제' }))
    fireEvent.click(screen.getByRole('button', { name: '정말 삭제?' }))
    await act(async () => {})
    expect(client.issues.remove).toHaveBeenCalledWith('i1')
    expect(props.onDeleted).toHaveBeenCalled()

    vi.mocked(client.issues.updateIfUnchanged).mockClear()
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })

    expect(client.issues.updateIfUnchanged).not.toHaveBeenCalled()
  })
})
