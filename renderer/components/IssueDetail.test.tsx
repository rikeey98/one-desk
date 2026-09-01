import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { IssueDetail } from './IssueDetail'
import type { Issue } from '@shared/models'
import type { OneDeskClient } from '@shared/client'

function makeIssue(over: Partial<Issue> = {}): Issue {
  return {
    id: 'i1', workspaceId: 'w1', title: '토큰 만료', body: '원본', status: 'open',
    repoIds: [], createdAt: 0, updatedAt: 100, closedAt: null,
    source: null, kind: null, priority: null, triagedAt: null, seenAt: null, ...over
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
      markSeen: vi.fn(async () => {}),
      ...over
    }
  } as unknown as OneDeskClient
}

function renderDetail(client: OneDeskClient, issue = makeIssue(), over = {}) {
  const props = {
    issue, onChanged: vi.fn(), onDeleted: vi.fn(), onRequestClose: vi.fn(), ...over
  }
  render(
    <ClientProvider client={client}>
      <IssueDetail {...props} />
    </ClientProvider>
  )
  return props
}

/**
 * 충돌 배너와 오류 배너가 둘 다 role="alert"라 getByRole('alert')이 모호해질 수 있다 —
 * 자리로 갈라 각자를 정확히 집는다.
 *
 * **role 쿼리를 남겨 두는 것이 핵심이다.** 클래스로만 찾으면 role="alert"를 지우는
 * 변이를 잡지 못한다 — 자동 저장 실패는 사용자가 보고 있지 않을 때 일어나므로
 * 알림 역할이 붙어 있어야 한다 (설계 §8).
 */
function alertWith(className: string): HTMLElement | null {
  return screen.queryAllByRole('alert').find((el) => el.classList.contains(className)) ?? null
}
const conflictAlert = (): HTMLElement | null => alertWith('conflict-banner')
const errorAlert = (): HTMLElement | null => alertWith('form-error')

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

  it('상태를 바꾸면 잠긴 쓰기로 저장하고 기대값을 갱신한다', async () => {
    // 상태 편집은 목록이 아니라 여기 있다 (설계 §9). 목록의 상태 버튼은 잠기지 않은
    // update로 써서 열려 있는 상세의 기대값만 낡게 만들었고, 그다음 자동 저장이
    // 사용자 자신의 클릭을 agent의 편집으로 착각해 유령 충돌 배너를 띄웠다.
    const client = makeClient()
    renderDetail(client)

    await userEvent.selectOptions(screen.getByLabelText('상태'), 'doing')

    expect(client.issues.updateIfUnchanged).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'i1', status: 'doing', expectedUpdatedAt: 100 })
    )
    // 잠기지 않은 update는 덮어쓰기 버튼만 쓴다.
    expect(client.issues.update).not.toHaveBeenCalled()
    // closedAt은 저장소가 status에서 파생한다 — 화면이 넘기면 둘이 어긋난다.
    expect(vi.mocked(client.issues.updateIfUnchanged).mock.calls[0]![0])
      .not.toHaveProperty('closedAt')

    // 상태 저장이 돌려준 updatedAt이 기대값으로 올라가야 이어지는 본문 저장이
    // 자기 자신과 충돌하지 않는다 (설계 §6).
    await userEvent.type(screen.getByLabelText('본문'), '!')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(client.issues.updateIfUnchanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ body: '원본!', expectedUpdatedAt: 200 })
    )
  })

  it('상태 저장이 실패하면 화면에 띄운다', async () => {
    const client = makeClient({
      updateIfUnchanged: vi.fn(async () => { throw new Error('DB가 잠겼습니다') })
    })
    renderDetail(client)

    await userEvent.selectOptions(screen.getByLabelText('상태'), 'done')

    expect(errorAlert()).toHaveTextContent('DB가 잠겼습니다')
  })

  it('Esc는 대기 중인 저장을 끝낸 뒤에 접기를 청한다', async () => {
    const client = makeClient()
    const props = renderDetail(client)
    await userEvent.type(screen.getByLabelText('본문'), '!')

    fireEvent.keyDown(screen.getByLabelText('본문'), { key: 'Escape' })

    await waitFor(() => expect(props.onRequestClose).toHaveBeenCalled())
    expect(client.issues.updateIfUnchanged).toHaveBeenCalledWith(
      expect.objectContaining({ body: '원본!' })
    )
  })

  it('Esc로 접다가 난 충돌은 배너로 남고 상세를 닫지 않는다', async () => {
    // 언마운트 flush에 맡기면 setConflict가 이미 사라진 컴포넌트에 떨어져 React가
    // 조용히 버린다 — 배너도 오류도 없이, flush가 이미 소비한 텍스트만 사라진다.
    // 상세가 살아 있는 동안 flush를 끝내고, 충돌이면 닫지 않는다 (설계 §7).
    const client = makeClient({
      updateIfUnchanged: vi.fn(async () => ({
        ok: false as const, current: makeIssue({ body: 'agent가 쓴 것', updatedAt: 300 })
      }))
    })
    const props = renderDetail(client)
    await userEvent.type(screen.getByLabelText('본문'), '!')

    fireEvent.keyDown(screen.getByLabelText('본문'), { key: 'Escape' })

    // 배너는 flush가 끝난 뒤에만 뜬다 — 여기까지 왔으면 닫을지 말지는 이미 정해졌다.
    await waitFor(() => expect(conflictAlert()).toHaveTextContent('그 사이 바뀌었습니다'))
    expect(props.onRequestClose).not.toHaveBeenCalled()
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
    expect(conflictAlert()).toHaveTextContent('그 사이 바뀌었습니다')

    // 배너가 떠 있는 동안은 더 쳐도 저장하지 않는다 — 재시도하면 결국 덮어쓰기가 된다
    await userEvent.type(screen.getByLabelText('본문'), '?')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(client.issues.updateIfUnchanged).toHaveBeenCalledTimes(1)
  })

  it('다시 불러오기가 최신 본문을 띄운다', async () => {
    const client = makeClient({
      updateIfUnchanged: vi.fn(async () => ({
        ok: false as const,
        // priority까지 함께 흘려보낸다 — agent가 고친 최신 이슈는 축도 다를 수
        // 있고, onReload가 title/body/status만 되돌리고 축을 빠뜨리면 이 값은
        // 절대 화면에 반영되지 않는다.
        current: makeIssue({ body: 'agent가 쓴 것', updatedAt: 300, priority: 'urgent' })
      }))
    })
    renderDetail(client)
    await userEvent.type(screen.getByLabelText('본문'), '!')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    await userEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
    expect(screen.getByLabelText('본문')).toHaveValue('agent가 쓴 것')
    // 축도 최신 값으로 되돌아가야 한다 — onReload가 source/kind/priority를
    // 빠뜨리면 마운트 때의 값(여기서는 미지정, '')이 그대로 남는다.
    expect(screen.getByLabelText('급함')).toHaveValue('urgent')
    // queryByText는 정규화된 전체 문자열 매치라 배너 문구('이 항목이 그 사이
    // 바뀌었습니다.')와 부분 일치해도 항상 null을 돌려준다 — 배너가 남아 있어도
    // 이 단언은 계속 통과해 무력하다. role로 실제 마운트 여부를 본다.
    expect(conflictAlert()).toBeNull()
  })

  it('다시 불러오기가 대기 중인 저장을 취소해 되돌린 내용을 몰래 덮어쓰지 않는다', async () => {
    // 배너가 뜬 채로 계속 타이핑하면 충돌 전(스테일) 텍스트를 든 디바운스 타이머가
    // 새로 걸린다. 다시 불러오기가 그 타이머를 취소하지 않으면, 화면은 agent의
    // 텍스트를 보여주면서도 그 타이머가 나중에 마침 새로 맞춰진 expectedUpdatedAt과
    // 함께 스테일한 값을 몰래 써버려 화면과 DB가 갈린다 (설계 §6).
    const client = makeClient({
      updateIfUnchanged: vi.fn(async () => ({
        ok: false as const,
        current: makeIssue({ body: 'agent가 쓴 것', updatedAt: 300, priority: 'urgent' })
      }))
    })
    renderDetail(client)
    await userEvent.type(screen.getByLabelText('본문'), '!')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(conflictAlert()).toBeInTheDocument()

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

    // 이 경로(타이핑 도중 다시 불러오기)에서도 축이 함께 되돌아간다.
    await waitFor(() => expect(screen.getByLabelText('급함')).toHaveValue('urgent'))

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
        ok: false as const,
        current: makeIssue({ body: 'agent가 쓴 것', updatedAt: 300, priority: 'urgent' })
      })
      .mockResolvedValue({
        ok: true as const, issue: makeIssue({ body: 'agent가 쓴 것 더', updatedAt: 400 })
      })
    const client = makeClient({ updateIfUnchanged })
    renderDetail(client)
    await userEvent.type(screen.getByLabelText('본문'), '!')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    await userEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
    // 다시 불러온 직후 축도 최신 값이어야 한다 — 그래야 아래 본문 저장이 그
    // 값을 조용히 덮어쓰는 게 아니라는 것도 함께 보증된다.
    expect(screen.getByLabelText('급함')).toHaveValue('urgent')

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

  it('덮어쓰기가 축 선택도 함께 쓴다', async () => {
    // 실패 시나리오: agent가 이슈를 고친 사이 사람이 급함을 고르면
    // updateIfUnchanged가 즉시 충돌로 튕겨나가 배너가 뜬다. 이때 덮어쓰기를
    // 누르면 방금 고른 축이 같이 실려야 한다 — title/body/status만 보내면
    // 축 선택이 조용히 사라진다.
    const client = makeClient({
      updateIfUnchanged: vi.fn(async () => ({
        ok: false as const, current: makeIssue({ updatedAt: 300 })
      }))
    })
    renderDetail(client)
    await userEvent.selectOptions(await screen.findByLabelText('급함'), 'urgent')
    await waitFor(() => expect(conflictAlert()).toHaveTextContent('그 사이 바뀌었습니다'))

    await userEvent.click(screen.getByRole('button', { name: '덮어쓰기' }))
    expect(client.issues.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'i1', priority: 'urgent' })
    )
  })

  it('저장이 실패하면 알림 역할이 붙은 자리에 띄운다', async () => {
    // 자동 저장은 사용자가 결과를 보지 않는다 — 실패를 숨기면 안 썼는데 썼다고 믿게
    // 된다 (설계 §8). 이 앱의 다른 오류 자리와 같이 role="alert"여야 한다.
    const client = makeClient({
      updateIfUnchanged: vi.fn(async () => { throw new Error('DB가 잠겼습니다') })
    })
    renderDetail(client)
    await userEvent.type(screen.getByLabelText('본문'), '!')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(errorAlert()).toHaveTextContent('DB가 잠겼습니다')
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

describe('IssueDetail 열람 기록', () => {
  it('마운트하면 markSeen을 부른다', async () => {
    const markSeen = vi.fn(async () => {})
    renderDetail(makeClient({ markSeen }), makeIssue({ id: 'i1' }))
    await waitFor(() => expect(markSeen).toHaveBeenCalledWith('i1'))
  })

  it('markSeen이 실패해도 화면은 멀쩡하다', async () => {
    // 열람 기록은 부수적이다. 이슈를 여는 행위가 이것 때문에 실패하면 안 된다.
    const markSeen = vi.fn(async () => { throw new Error('DB 실패') })
    renderDetail(makeClient({ markSeen }), makeIssue({ id: 'i1' }))
    await waitFor(() => expect(markSeen).toHaveBeenCalled())
    expect(await screen.findByLabelText('본문')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('markSeen은 목록을 다시 읽게 하지 않는다', async () => {
    // 정렬이 seenAt 오래된 순이라, 읽으면 방금 클릭한 항목이 눈앞에서 도망간다.
    const markSeen = vi.fn(async () => {})
    const props = renderDetail(makeClient({ markSeen }), makeIssue({ id: 'i1' }))
    await waitFor(() => expect(markSeen).toHaveBeenCalled())
    expect(props.onChanged).not.toHaveBeenCalled()
  })
})

describe('IssueDetail 축 편집', () => {
  // 세 축(출처/성격/급함)은 라벨·순서·값만 다른 같은 모양의 select다(AxisSelect로
  // 뽑혀 있다). 셋 다 따로 테스트해야 한다 — 그러지 않으면 예컨대 출처 select의
  // onPick이 실은 setKind/changeAxis({ kind })를 부르는 복붙 실수(성격 컬럼에
  // 조용히 쓰는 것)를, 급함 하나만 도는 테스트로는 절대 못 잡는다.
  it('출처를 고르면 잠긴 경로로 저장한다', async () => {
    const updateIfUnchanged = vi.fn(async (i: { id: string }) => ({
      ok: true as const, issue: makeIssue({ id: i.id, updatedAt: 600 })
    }))
    renderDetail(
      makeClient({ updateIfUnchanged }),
      makeIssue({ id: 'i1', updatedAt: 500 })
    )
    await userEvent.selectOptions(await screen.findByLabelText('출처'), 'customer')

    await waitFor(() => expect(updateIfUnchanged).toHaveBeenCalledWith({
      id: 'i1', source: 'customer', expectedUpdatedAt: 500
    }))
  })

  it('성격을 고르면 잠긴 경로로 저장한다', async () => {
    const updateIfUnchanged = vi.fn(async (i: { id: string }) => ({
      ok: true as const, issue: makeIssue({ id: i.id, updatedAt: 600 })
    }))
    renderDetail(
      makeClient({ updateIfUnchanged }),
      makeIssue({ id: 'i1', updatedAt: 500 })
    )
    await userEvent.selectOptions(await screen.findByLabelText('성격'), 'bug')

    await waitFor(() => expect(updateIfUnchanged).toHaveBeenCalledWith({
      id: 'i1', kind: 'bug', expectedUpdatedAt: 500
    }))
  })

  it('급함을 고르면 잠긴 경로로 저장한다', async () => {
    const updateIfUnchanged = vi.fn(async (i: { id: string }) => ({
      ok: true as const, issue: makeIssue({ id: i.id, updatedAt: 600 })
    }))
    renderDetail(
      makeClient({ updateIfUnchanged }),
      makeIssue({ id: 'i1', updatedAt: 500 })
    )
    await userEvent.selectOptions(await screen.findByLabelText('급함'), 'urgent')

    await waitFor(() => expect(updateIfUnchanged).toHaveBeenCalledWith({
      id: 'i1', priority: 'urgent', expectedUpdatedAt: 500
    }))
  })

  it('미지정을 고르면 아무 일도 하지 않는다', async () => {
    // <option value="">미지정</option>은 미분류 이슈가 뭔가 선택된 채로 보이게
    // 하려고 있을 뿐이다 — 고르는 행위 자체가 축을 지우는 길이 되면 안 된다
    // (설계 §6). setState가 없는 이 경로는 리렌더가 안 일어나 통제된 select가
    // DOM을 되돌리는 것에 기대는데, 이 동작은 눈에 잘 안 띄어 단언이 필요하다.
    const client = makeClient()
    renderDetail(client, makeIssue({ id: 'i1', priority: 'urgent' }))
    const select = await screen.findByLabelText('급함')
    expect(select).toHaveValue('urgent')

    await userEvent.selectOptions(select, '')

    expect(select).toHaveValue('urgent')
    expect(client.issues.updateIfUnchanged).not.toHaveBeenCalled()
  })
})
