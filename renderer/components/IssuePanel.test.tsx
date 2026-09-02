import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { IssuePanel } from './IssuePanel'
import type { Issue, Repo, Run } from '@shared/models'
import type { OneDeskClient } from '@shared/client'

const NOW = Date.now()

function makeIssue(over: Partial<Issue> = {}): Issue {
  return {
    id: 'i1', workspaceId: 'ws', title: '제목', body: '', status: 'open',
    repoIds: [], createdAt: NOW, updatedAt: NOW, closedAt: null,
    source: null, kind: null, priority: null, triagedAt: NOW, seenAt: NOW,
    ...over
  }
}

interface PanelMocks {
  list: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  markSeen: ReturnType<typeof vi.fn>
}

function renderPanel(issues: Issue[], over: {
  openId?: string | null
  expanded?: boolean
  onOpen?: (id: string) => void
  repos?: Repo[]
} = {}): PanelMocks {
  const mocks: PanelMocks = {
    list: vi.fn(async () => issues),
    create: vi.fn(),
    update: vi.fn(async (i: { id: string }) => makeIssue({ id: i.id })),
    markSeen: vi.fn(async () => {})
  }
  const client = {
    issues: {
      ...mocks,
      updateIfUnchanged: vi.fn(),
      remove: vi.fn()
    },
    // useIssues가 run 완료를 구독한다. 해제 함수를 돌려주지 않으면 언마운트가 터진다.
    events: { onRunUpdate: () => () => {} }
  } as unknown as OneDeskClient

  render(
    <ClientProvider client={client}>
      <IssuePanel
        workspaceId="ws"
        repoId={null}
        repos={over.repos ?? []}
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

/**
 * `openId`를 실제 App.tsx처럼 상태로 들고 `onOpen`에 반응해 갱신하는 렌더러.
 * `renderPanel`의 `onOpen`은 호출을 기록만 할 뿐 재렌더를 일으키지 않아, 건너뛰기를
 * 연달아 누르는 걸음이 매번 같은 `fromId`에서 시작해 버린다 — 그래서는 두 번째
 * 건너뛰기가 첫 번째로 되돌아가는 회귀(rest[0])를 이 헬퍼 없이는 잡을 수 없다.
 */
function renderControlledPanel(issues: Issue[], initialOpenId: string | null): PanelMocks & { opened: string[] } {
  const mocks: PanelMocks = {
    list: vi.fn(async () => issues),
    create: vi.fn(),
    update: vi.fn(async (i: { id: string }) => makeIssue({ id: i.id })),
    markSeen: vi.fn(async () => {})
  }
  const client = {
    issues: {
      ...mocks,
      updateIfUnchanged: vi.fn(),
      remove: vi.fn()
    },
    events: { onRunUpdate: () => () => {} }
  } as unknown as OneDeskClient

  const opened: string[] = []

  function Wrapper() {
    const [openId, setOpenId] = useState<string | null>(initialOpenId)
    return (
      <IssuePanel
        workspaceId="ws"
        repoId={null}
        repos={[]}
        chipKeys={new Set()}
        onToggleContext={() => {}}
        expanded={true}
        openId={openId}
        onOpen={(id) => { opened.push(id); setOpenId((prev) => (prev === id ? null : id)) }}
      />
    )
  }

  render(
    <ClientProvider client={client}>
      <Wrapper />
    </ClientProvider>
  )
  return { ...mocks, opened }
}

describe('IssuePanel 그룹', () => {
  it('그룹 헤더에 개수를 보여준다', async () => {
    renderPanel([
      makeIssue({ id: 'a', title: 'A', priority: 'urgent' }),
      makeIssue({ id: 'b', title: 'B', priority: 'urgent' })
    ])
    expect(await screen.findByRole('button', { name: /긴급 \(2\)/ })).toBeInTheDocument()
  })

  it('접어도 개수는 계속 보인다', async () => {
    renderPanel([makeIssue({ id: 'a', title: 'A', priority: 'someday' })])
    const header = await screen.findByRole('button', { name: /언젠가 \(1\)/ })
    await userEvent.click(header)
    expect(screen.queryByRole('button', { name: 'A' })).not.toBeInTheDocument()
    // 접힌 뒤에도 개수는 남아야 한다. 이것이 A안을 고른 이유 자체다.
    expect(screen.getByRole('button', { name: /언젠가 \(1\)/ })).toBeInTheDocument()
  })

  it('완료 그룹은 처음부터 접혀 있다', async () => {
    renderPanel([makeIssue({ id: 'z', title: 'Z', status: 'done' })])
    expect(await screen.findByRole('button', { name: /완료 \(1\)/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Z' })).not.toBeInTheDocument()
  })

  it('축을 바꾸면 다시 묶는다', async () => {
    renderPanel([makeIssue({ id: 'a', title: 'A', priority: 'urgent', source: 'customer' })])
    await screen.findByRole('button', { name: /긴급 \(1\)/ })
    await userEvent.selectOptions(screen.getByLabelText('묶기'), 'source')
    expect(await screen.findByRole('button', { name: /고객 \(1\)/ })).toBeInTheDocument()
  })

  it('정리 안 된 이슈가 있으면 배너가 뜬다', async () => {
    renderPanel([makeIssue({ id: 'a', title: 'A', triagedAt: null })])
    expect(await screen.findByText(/정리 안 됨 \(1\)/)).toBeInTheDocument()
  })

  it('정리 안 된 이슈가 없으면 배너가 없다', async () => {
    renderPanel([makeIssue({ id: 'a', title: 'A', triagedAt: NOW })])
    await screen.findByRole('button', { name: 'A' })
    expect(screen.queryByText(/정리 안 됨/)).not.toBeInTheDocument()
  })

  it('오래 안 본 이슈에 방치 배지가 붙는다', async () => {
    const old = NOW - 20 * 24 * 60 * 60 * 1000
    renderPanel([makeIssue({ id: 'a', title: 'A', priority: 'urgent', seenAt: old })])
    expect(await screen.findByLabelText('오래 방치됨')).toBeInTheDocument()
  })

  it('행에 성격·출처 축 칩을 보여준다', async () => {
    renderPanel([makeIssue({ id: 'a', title: 'A', kind: 'bug', source: 'customer' })])
    await screen.findByRole('button', { name: 'A' })
    // 칩 클래스까지 확인한다 — 전역 .chip과 충돌해 클릭 가능한 파란 배경을
    // 물려받는 사고를 이 테스트가 함께 막는다.
    expect(screen.getByText('버그')).toHaveClass('axis-chip')
    expect(screen.getByText('고객')).toHaveClass('axis-chip')
  })
})

describe('IssuePanel 훑기', () => {
  it('훑어보기를 누르면 첫 대기 항목이 열린다', async () => {
    const onOpen = vi.fn()
    renderPanel([makeIssue({ id: 'a', title: 'A', triagedAt: null })], { onOpen })
    await userEvent.click(await screen.findByRole('button', { name: '훑어보기' }))
    expect(onOpen).toHaveBeenCalledWith('a')
  })

  it('축 셋을 찍고 다음을 누르면 저장한다', async () => {
    const mocks = renderPanel(
      [makeIssue({ id: 'a', title: 'A', triagedAt: null })],
      { openId: 'a', expanded: true }
    )
    await userEvent.click(await screen.findByRole('button', { name: '훑어보기' }))
    await userEvent.click(screen.getByRole('button', { name: '회의' }))
    await userEvent.click(screen.getByRole('button', { name: '버그' }))
    await userEvent.click(screen.getByRole('button', { name: '긴급' }))
    await userEvent.click(screen.getByRole('button', { name: '다음' }))

    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({
      id: 'a', source: 'meeting', kind: 'bug', priority: 'urgent'
    }))
  })

  it('훑기는 seenAt을 찍지 않는다', async () => {
    // 분류와 열람은 다른 행위다. 축을 찍었다는 이유로 방치 시계가 리셋되면
    // 훑기가 방치를 감추는 도구가 된다 (설계 §3 ③).
    //
    // **아무것도 열리지 않은 상태에서 시작해, 훑어보기 자신이 열게 한다.**
    // renderPanel처럼 openId를 미리 프리셋하면 triaging이 아직 false인 첫 렌더에서
    // IssueDetail이 먼저 마운트되고 그 markSeen 이펙트(Task 8)가 먼저 찍혀버려,
    // 이 단언이 훑기와 무관한 이유로 빨개진다 — 실제로 그렇게 한 번 빨개졌었다.
    // 이 시나리오 자체는 실제 앱에서도 일어날 수 있고(상세를 이미 열어 본 이슈를
    // 그 자리에서 훑는 경우) 그때 seenAt이 찍히는 것은 올바른 동작이다. 이 테스트가
    // 좁혀서 지키려는 것은 "훑기 흐름 자체는" seenAt을 찍지 않는다는 것뿐이다.
    //
    // renderControlledPanel로 진짜 openId state를 써서, 훑어보기 클릭이 onOpen을
    // 직접 몰아 triaging과 openId가 같은 배치로 함께 세워지게 한다 — 그러면
    // IssueDetail은 이 테스트 동안 한 번도 마운트되지 않고, TriageCard만 뜬다.
    const mocks = renderControlledPanel(
      [makeIssue({ id: 'a', title: 'A', triagedAt: null })],
      null
    )
    await userEvent.click(await screen.findByRole('button', { name: '훑어보기' }))
    await userEvent.click(await screen.findByRole('button', { name: '회의' }))
    await userEvent.click(screen.getByRole('button', { name: '버그' }))
    await userEvent.click(screen.getByRole('button', { name: '긴급' }))

    // 카드가 여전히 화면에 있다 — IssueDetail로 넘어가지 않았다는 방증이다.
    expect(screen.getByRole('button', { name: '다음' })).toBeInTheDocument()

    // 다음까지 눌러 saveTriage → advance를 실제로 타야 한다. 여기서 멈추면
    // 저장이 실려 있는 절반(saveTriage/advance)은 전혀 실행되지 않아, 그 안에
    // markSeen이 있어도 이 테스트가 못 잡는다 — 큐가 issue 하나뿐이라 advance는
    // endTriage() + onOpen(openId)로 이어지고, 이미 열려 있던 openId('a')를 같은
    // id로 다시 여는 것이라 App과 같은 토글 규칙으로 openId가 null로 접혀
    // IssueDetail은 여기서도 마운트되지 않는다.
    await userEvent.click(screen.getByRole('button', { name: '다음' }))
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({
      id: 'a', source: 'meeting', kind: 'bug', priority: 'urgent'
    }))

    expect(mocks.markSeen).not.toHaveBeenCalled()
  })

  it('건너뛴 이슈는 대기열에 남는다', async () => {
    const mocks = renderPanel(
      [
        makeIssue({ id: 'a', title: 'A', triagedAt: null }),
        makeIssue({ id: 'b', title: 'B', triagedAt: null })
      ],
      { openId: 'a', expanded: true }
    )
    await userEvent.click(await screen.findByRole('button', { name: '훑어보기' }))
    await userEvent.click(screen.getByRole('button', { name: '건너뛰기' }))

    expect(mocks.update).not.toHaveBeenCalled()
    expect(screen.getByText(/정리 안 됨 \(2\)/)).toBeInTheDocument()
  })

  it('저장이 충돌하면 그 이슈에서 멈추고 경고를 보여준다', async () => {
    const onOpen = vi.fn()
    const mocks = renderPanel(
      [
        makeIssue({ id: 'a', title: 'A', triagedAt: null }),
        makeIssue({ id: 'b', title: 'B', triagedAt: null })
      ],
      { openId: 'a', expanded: true, onOpen }
    )
    mocks.update.mockRejectedValueOnce(new Error('충돌'))

    await userEvent.click(await screen.findByRole('button', { name: '훑어보기' }))
    await userEvent.click(screen.getByRole('button', { name: '회의' }))
    await userEvent.click(screen.getByRole('button', { name: '버그' }))
    await userEvent.click(screen.getByRole('button', { name: '긴급' }))
    await userEvent.click(screen.getByRole('button', { name: '다음' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('충돌')
    // advance()가 다음 이슈로 넘어가지 않았다 — 방금 찍은 축이 어디로 갔는지
    // 모른 채 대기열만 줄어드는 걸 막는다. (openId가 처음부터 'a'라 로딩 중
    // useEffect가 onOpen('a')를 부르는 건 이 테스트의 관심사가 아니다 —
    // 큐의 다음 항목인 'b'로 넘어가지 않았는지만 본다.)
    expect(onOpen).not.toHaveBeenCalledWith('b')
  })

  it('충돌 후 재시도가 성공하면 경고가 사라진다', async () => {
    // 큐에 둘을 넣는다 — 하나뿐이면 재시도 성공이 곧 훑기 종료(endTriage)라
    // 그쪽 경로의 정리와 이 테스트가 겨냥한 "시도 시작 시 지우기" 경로가
    // 뒤섞여 버린다. 계속 걸어야 할 항목을 남겨 둬야 후자만 따로 검증된다.
    const mocks = renderPanel(
      [
        makeIssue({ id: 'a', title: 'A', triagedAt: null }),
        makeIssue({ id: 'b', title: 'B', triagedAt: null })
      ],
      { openId: 'a', expanded: true }
    )
    mocks.update.mockRejectedValueOnce(new Error('충돌'))

    await userEvent.click(await screen.findByRole('button', { name: '훑어보기' }))
    await userEvent.click(screen.getByRole('button', { name: '회의' }))
    await userEvent.click(screen.getByRole('button', { name: '버그' }))
    await userEvent.click(screen.getByRole('button', { name: '긴급' }))
    await userEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('충돌')

    // 두 번째 시도는 성공한다 (mockRejectedValueOnce는 한 번만 실패시킨다).
    // 훑기는 끝나지 않고 다음 항목으로 이어진다 — endTriage가 아니라
    // 시도 시작 시점의 초기화가 경고를 지웠어야 한다.
    await userEvent.click(screen.getByRole('button', { name: '다음' }))
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('저장 실패 후 건너뛰면 경고가 사라진다', async () => {
    // onSkip이 advance만 부르고 triageError를 안 지우면, 방금 연 다음 이슈 위에
    // 앞 이슈의 실패 메시지가 그대로 남는다 — 그 이슈가 막힌 것처럼 보인다.
    const mocks = renderPanel(
      [
        makeIssue({ id: 'a', title: 'A', triagedAt: null }),
        makeIssue({ id: 'b', title: 'B', triagedAt: null })
      ],
      { openId: 'a', expanded: true }
    )
    mocks.update.mockRejectedValueOnce(new Error('충돌'))

    await userEvent.click(await screen.findByRole('button', { name: '훑어보기' }))
    await userEvent.click(screen.getByRole('button', { name: '회의' }))
    await userEvent.click(screen.getByRole('button', { name: '버그' }))
    await userEvent.click(screen.getByRole('button', { name: '긴급' }))
    await userEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('충돌')

    await userEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('열린 이슈가 큐에서 빠져도 위치가 0번째로 내려가지 않는다', async () => {
    // 카드가 열려 있는 동안 agent가 MCP로 같은 이슈를 분류하면, run 완료 구독이
    // 목록을 다시 읽어 그 이슈가 큐에서 빠진다 — findIndex가 -1을 주는 자리다.
    let runUpdateCb: ((run: Run) => void) | undefined
    const listMock = vi.fn(async () => [
      makeIssue({ id: 'a', title: 'A', triagedAt: null }),
      makeIssue({ id: 'b', title: 'B', triagedAt: null })
    ])
    const client = {
      issues: {
        list: listMock,
        create: vi.fn(),
        update: vi.fn(async (i: { id: string }) => makeIssue({ id: i.id })),
        updateIfUnchanged: vi.fn(),
        markSeen: vi.fn(async () => {}),
        remove: vi.fn()
      },
      events: {
        onRunUpdate: (cb: (run: Run) => void) => { runUpdateCb = cb; return () => {} }
      }
    } as unknown as OneDeskClient

    render(
      <ClientProvider client={client}>
        <IssuePanel
          workspaceId="ws"
          repoId={null}
          repos={[]}
          chipKeys={new Set()}
          onToggleContext={() => {}}
          expanded={true}
          openId="a"
          onOpen={() => {}}
        />
      </ClientProvider>
    )

    await userEvent.click(await screen.findByRole('button', { name: '훑어보기' }))
    expect(await screen.findByText('2건 중 1번째')).toBeInTheDocument()

    // 이제 목록이 'a'를 이미 분류된 것으로 돌려주게 하고, run 완료를 흉내낸다.
    listMock.mockResolvedValue([
      makeIssue({ id: 'a', title: 'A', triagedAt: NOW, source: 'meeting', kind: 'bug', priority: 'urgent' }),
      makeIssue({ id: 'b', title: 'B', triagedAt: null })
    ])
    await act(async () => {
      runUpdateCb?.({ workspaceId: 'ws', id: 'run-1', endedAt: NOW } as unknown as Run)
    })

    expect(await screen.findByText('1건 중 1번째')).toBeInTheDocument()
    expect(screen.queryByText(/0번째/)).not.toBeInTheDocument()
  })

  it('건너뛰기를 거듭하면 대기열을 앞으로 걷는다', async () => {
    // 회귀: "fromId를 뺀 첫 항목"으로 고르던 옛 advance()는 a를 건너뛰면 b를 열고,
    // b를 건너뛰면 다시 a로 돌아갔다 — c는 건너뛰기로 영영 닿지 못했다.
    const { opened } = renderControlledPanel([
      makeIssue({ id: 'a', title: 'A', triagedAt: null }),
      makeIssue({ id: 'b', title: 'B', triagedAt: null }),
      makeIssue({ id: 'c', title: 'C', triagedAt: null })
    ], null)

    await userEvent.click(await screen.findByRole('button', { name: '훑어보기' }))
    expect(opened.at(-1)).toBe('a')

    await userEvent.click(await screen.findByRole('button', { name: '건너뛰기' }))
    expect(opened.at(-1)).toBe('b')

    await userEvent.click(await screen.findByRole('button', { name: '건너뛰기' }))
    expect(opened.at(-1)).toBe('c')

    // a로 되돌아간 적이 없어야 한다 — 첫 훑어보기 클릭 한 번만 a를 열었다.
    expect(opened.filter((id) => id === 'a')).toHaveLength(1)
  })
})
