import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InboxPanel } from './InboxPanel'
import type { Repo, Run, Workspace } from '@shared/models'
import type { ReposByWorkspace } from '../inboxView'

// 보기·정렬·접힘은 이 장비에 남는다 — 다음 테스트로 새면 기본 보기가 아니다
afterEach(() => { localStorage.clear() })

const workspaces: Workspace[] = [
  {
    id: 'w1', name: '앱', description: null, defaultAgentKind: 'claude-code',
    defaultModelClaude: null, defaultModelOpencode: null, defaultEffortClaude: null, defaultVariantOpencode: null, defaultPermission: 'edit',
    claudePath: null, opencodePath: null, createdAt: 0, updatedAt: 0
  }
]

function run(over: Partial<Run>): Run {
  return {
    id: 'r1', workspaceId: 'w1', agentKind: 'claude-code', model: null, effort: null,
    cwd: '/tmp', permission: 'edit', userPrompt: '토큰 만료 고쳐줘', assembledPrompt: 'x',
    status: 'succeeded', externalSessionId: 'sess-1', parentRunId: null,
    // over.id가 있으면 그것을 뿌리로 본다 — 하드코딩하면 id가 다른 두 run을
    // 넘겨도 조용히 한 대화로 접힌다(Dock.test.tsx에서 실제로 터진 결함, T2).
    rootRunId: over.id ?? 'r1',
    // 대화의 이름과 끝. 뿌리 행에서만 의미가 있고 기본은 둘 다 null이다.
    title: null, closedAt: null,
    resultText: null, needsAnswer: false, timeoutMs: null, exitCode: 0,
    errorMessage: null, logPath: '/tmp/x', reviewedAt: null, reviewedKind: null,
    startedAt: 1, endedAt: 2, createdAt: 0, contextItems: [], issue: null, usage: null,
    ...over
  }
}

function renderPanel(items: Run[], over: Partial<Parameters<typeof InboxPanel>[0]> = {}) {
  const props = {
    items,
    workspaces,
    reposByWorkspace: {} as ReposByWorkspace,
    error: null,
    onReview: vi.fn(),
    onOpenConversation: vi.fn(),
    onRestart: vi.fn(),
    onCloseIssue: vi.fn(),
    onMakeIssue: vi.fn(),
    ...over
  }
  render(<InboxPanel {...props} />)
  return props
}

describe('InboxPanel', () => {
  it('비어 있으면 그렇게 말한다', () => {
    renderPanel([])
    expect(screen.getByText('처리할 결과가 없습니다')).toBeInTheDocument()
  })

  it('어느 workspace 것인지 보여준다', () => {
    // 전역 목록이라 workspace 이름이 없으면 같은 지시를 두 곳에서 돌렸을 때 구별할 수 없다.
    renderPanel([run({})])
    expect(screen.getByText('앱')).toBeInTheDocument()
  })

  it('카테고리 라벨을 보여준다', () => {
    renderPanel([run({ needsAnswer: true })])
    expect(screen.getByText('답변 필요')).toBeInTheDocument()
  })

  it('세션이 없어도 대화 열기는 보인다 — 이어받을 세션은 core가 대화 전체에서 찾는다', () => {
    // "로그 보기"와 "이어서 실행"이 하나로 합쳐지기 전에는 마지막 턴에 세션이
    // 없으면 이어서 실행 버튼 자체를 숨겼다. resume 대상 선택이 core로 넘어가
    // 마지막 턴에 세션이 없어도 앞선 턴에서 이어받을 수 있으므로(설계 §5·§6),
    // 화면에서 미리 막을 이유가 없다.
    renderPanel([run({ externalSessionId: null })])
    expect(screen.getByRole('button', { name: '대화 열기' })).toBeInTheDocument()
  })

  it('대기 중 취소됨에도 대화 열기를 보여준다', () => {
    // 항목은 run이 아니라 대화다 — 마지막 턴이 시작 전에 취소됐어도 앞의
    // 턴들에는 대화록이 있을 수 있다(리뷰 I-3). 1턴짜리 대화가 dropped됐다면
    // Transcript의 pending 이른 반환(status === 'pending'에만 걸림)은 타지
    // 않는다 — 취소된 턴은 'canceled'라 사용자 프롬프트와 상태 칩이 그려진다.
    // 그래도 아예 못 여는 것보다 낫다.
    renderPanel([run({ status: 'canceled', externalSessionId: null })])
    expect(screen.getByRole('button', { name: '대화 열기' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다시 실행' })).toBeInTheDocument()
  })

  it('실패한 run은 이슈로 만들 수 있다', () => {
    renderPanel([run({ status: 'failed', errorMessage: '권한 거부' })])
    expect(screen.getByRole('button', { name: '이슈로 만들기' })).toBeInTheDocument()
    expect(screen.getByText('권한 거부')).toBeInTheDocument()
  })

  it('첨부된 이슈가 없으면 관련 이슈 닫기를 보여주지 않는다', () => {
    renderPanel([run({ contextItems: [] })])
    expect(screen.queryByRole('button', { name: '관련 이슈 닫기' })).toBeNull()
  })

  it('첨부된 이슈마다 관련 이슈 닫기를 보여주고 그 id로 알린다', () => {
    const item = run({ contextItems: [
      { type: 'issue', id: 'i1', label: '버그' }, { type: 'issue', id: 'i2', label: '오타' }
    ] })
    const { onCloseIssue } = renderPanel([item])
    const buttons = screen.getAllByRole('button', { name: '관련 이슈 닫기' })
    expect(buttons).toHaveLength(2)
    buttons[0]!.click()
    expect(onCloseIssue).toHaveBeenCalledWith(item, 'i1')
  })

  it('repo 맥락은 관련 이슈 닫기를 만들지 않는다', () => {
    // contextItems에는 repo·memo도 섞여 온다. 이슈만 골라야 한다.
    renderPanel([run({ contextItems: [{ type: 'repo', id: 'p1', label: 'api' }] })])
    expect(screen.queryByRole('button', { name: '관련 이슈 닫기' })).toBeNull()
  })

  it('확인함을 누르면 그 run과 함께 confirmed로 알린다', async () => {
    const item = run({})
    const { onReview } = renderPanel([item])
    await userEvent.click(screen.getByRole('button', { name: '확인함' }))
    // App.tsx가 뿌리를 계산할 수 있도록 run 전체를 넘긴다 — id만 넘기면 계산할
    // 방법이 없다(Task 9).
    expect(onReview).toHaveBeenCalledWith(item, 'confirmed')
  })

  it('보관을 누르면 그 run과 함께 archived로 알린다', async () => {
    const item = run({ status: 'failed' })
    const { onReview } = renderPanel([item])
    await userEvent.click(screen.getByRole('button', { name: '보관' }))
    expect(onReview).toHaveBeenCalledWith(item, 'archived')
  })

  // 개별 긍정 케이스만으로는 shows()의 분기 하나가 틀어져도 잡히지 않는다
  // (참고: 나머지 테스트 훑기에서 6개의 변이가 살아남았다). 카테고리마다
  // "보여야 할 행동 집합 전체"를 표(설계 §5)와 통째로 비교해 구멍을 없앤다.
  // "변경 보기"는 5단계라 표에서 뺀다. 대부분의 행은 첨부 이슈가 없는 픽스처를
  // 쓰므로 "관련 이슈 닫기"가 나오지 않는다. 그것과 별개로, 이슈가 붙으면
  // 카테고리와 무관하게 나온다는 것(완료·미확인이 아닌 "실패"에서도)을 아래
  // "실패 (이슈 첨부)" 행으로 같은 방식으로 확인한다.
  it('카테고리마다 보이는 행동 버튼 집합이 현재 후속 행동 규칙과 정확히 같다', () => {
    // "로그 보기"·"이어서 실행"(·"답하고 이어서")이 "대화 열기" 하나로 합쳐졌다
    // (설계 §5, Task 9) — dropped를 포함해 모든 카테고리에서 나온다(리뷰 I-3).
    // 3b 설계(§5)의 후속 행동표는 항목 단위가 run이던 시절 것이라 "대기 중
    // 취소됨"에 "대화 열기"가 없다 — 대화 단위로 바뀌며 뒤집혔다(3b 문서의
    // (†) 참고). 그래서 이 테스트는 그 표가 아니라 아래에 직접 적은, 지금
    // 실제로 맞아야 하는 집합과 비교한다.
    const table: Array<{ category: string; over: Partial<Run>; expected: string[] }> = [
      { category: '답변 필요', over: { needsAnswer: true, externalSessionId: 'sess-1' }, expected: ['대화 열기', '보관'] },
      { category: '완료 · 미확인', over: { externalSessionId: 'sess-1' }, expected: ['대화 열기', '확인함'] },
      { category: '실패', over: { status: 'failed', errorMessage: '오류' }, expected: ['대화 열기', '다시 실행', '이슈로 만들기', '보관'] },
      {
        category: '실패 (이슈 첨부)',
        over: { status: 'failed', errorMessage: '오류', contextItems: [{ type: 'issue', id: 'i1', label: '버그' }] },
        expected: ['대화 열기', '다시 실행', '이슈로 만들기', '보관', '관련 이슈 닫기']
      },
      { category: '중단됨', over: { status: 'interrupted' }, expected: ['대화 열기', '다시 실행', '보관'] },
      { category: '대기 중 취소됨', over: { status: 'canceled', externalSessionId: null }, expected: ['대화 열기', '다시 실행', '보관'] }
    ]

    // 첫 실패에서 멈추면 나머지 카테고리의 상태를 못 본다 — 전부 모아서 한 번에 단언한다.
    const mismatches: Array<{ category: string; expected: string[]; actual: string[] }> = []
    for (const { category, over, expected } of table) {
      const { unmount } = render(
        <InboxPanel
          items={[run(over)]}
          workspaces={workspaces}
          reposByWorkspace={{}}
          error={null}
          onReview={vi.fn()}
          onOpenConversation={vi.fn()}
          onRestart={vi.fn()}
          onCloseIssue={vi.fn()}
          onMakeIssue={vi.fn()}
        />
      )
      // 항목 카드 안의 버튼만 센다 — 도구 줄(보기·정렬)은 행동이 아니다 (inbox-views plan 위험 1)
      const card = document.querySelector<HTMLElement>('li.inbox-item')!
      const actual = within(card).getAllByRole('button').map((b) => b.textContent ?? '').sort()
      const sortedExpected = [...expected].sort()
      if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
        mismatches.push({ category, expected: sortedExpected, actual })
      }
      unmount()
    }

    expect(mismatches).toEqual([])
  })
})

describe('보기와 정렬 (docs/sdlc/inbox-views/)', () => {
  const api: Repo = { id: 'p-api', workspaceId: 'w1', name: 'api', path: '/work/api', description: null, sortOrder: 0, createdAt: 0 }
  const repos: ReposByWorkspace = { w1: [api] }
  // core가 주는 순서(끝난 시각 최신순)
  const items = [
    run({ id: 'new', endedAt: 30, cwd: '/work/api', userPrompt: '최근 지시' }),
    run({ id: 'mid', endedAt: 20, cwd: '/elsewhere', status: 'failed', userPrompt: '중간 지시' }),
    run({ id: 'old', endedAt: 10, cwd: '/work/api', needsAnswer: true, userPrompt: '오래된 지시' })
  ]
  const prompts = () => [...document.querySelectorAll('.inbox-prompt')].map((e) => e.textContent)
  const groupNames = () => screen.queryAllByRole('button', { name: / 묶음$/ }).map((b) => b.getAttribute('aria-label'))

  it('기본은 시간순 · 최신 먼저이고, 항목 머리의 소속은 workspace · repo다 (FR-1·3·5)', () => {
    renderPanel(items, { reposByWorkspace: repos })
    const modes = screen.getByRole('group', { name: '인박스 보기' })
    expect(within(modes).getByRole('button', { name: '시간순' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(modes).getByRole('button', { name: 'workspace별' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: '정렬: 최신 먼저' })).toBeInTheDocument()
    expect(prompts()).toEqual(['최근 지시', '중간 지시', '오래된 지시'])
    expect(screen.getAllByText('앱 · api')).toHaveLength(2)
    expect(screen.getByText('앱')).toBeInTheDocument()
    expect(groupNames()).toEqual([])
  })

  it('항목이 없으면 도구 줄이 없다 (FR-4)', () => {
    renderPanel([], { reposByWorkspace: repos })
    expect(screen.queryByRole('group', { name: '인박스 보기' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^정렬/ })).toBeNull()
  })

  it('정렬 버튼은 순서를 뒤집고 지금 순서를 이름으로 말한다 (FR-1·2)', async () => {
    renderPanel(items, { reposByWorkspace: repos })
    await userEvent.click(screen.getByRole('button', { name: '정렬: 최신 먼저' }))
    expect(prompts()).toEqual(['오래된 지시', '중간 지시', '최근 지시'])
    expect(screen.getByRole('button', { name: '정렬: 오래된 먼저' })).toBeInTheDocument()
  })

  it('workspace별은 workspace → repo로 묶고, 묶음 안 항목 머리에서 소속을 뺀다 (FR-6·8·9·12)', async () => {
    renderPanel(items, { reposByWorkspace: repos })
    await userEvent.click(screen.getByRole('button', { name: 'workspace별' }))
    expect(screen.getByRole('button', { name: 'workspace별' })).toHaveAttribute('aria-pressed', 'true')
    // repo 묶음이 하나여도 머리가 선다(FR-8) — 여기서는 api와 기타 둘, 기타는 맨 아래
    expect(groupNames()).toEqual(['앱 묶음', '앱 · api 묶음', '앱 · 기타 묶음'])
    expect(screen.getByRole('button', { name: '앱 묶음' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '앱 묶음' })).toHaveTextContent('3')
    expect(screen.getByRole('button', { name: '앱 · api 묶음' })).toHaveTextContent('2')
    expect(prompts()).toEqual(['최근 지시', '오래된 지시', '중간 지시'])
    expect(document.querySelectorAll('.inbox-ws')).toHaveLength(0)
    // 카테고리 칩은 남는다
    expect(document.querySelectorAll('.inbox-head .status')).toHaveLength(3)
  })

  it('머리를 누르면 접히고, 접힌 머리는 그 안의 답변 필요를 보인다 — workspace를 접으면 repo 묶음째 숨는다 (FR-12~14)', async () => {
    renderPanel(items, { reposByWorkspace: repos })
    await userEvent.click(screen.getByRole('button', { name: 'workspace별' }))
    const apiHead = screen.getByRole('button', { name: '앱 · api 묶음' })
    expect(apiHead.querySelector('.needs-answer')).toBeNull()
    await userEvent.click(apiHead)
    expect(apiHead).toHaveAttribute('aria-expanded', 'false')
    expect(prompts()).toEqual(['중간 지시'])
    expect(within(apiHead).getByText('답변 필요')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '앱 묶음' }))
    expect(prompts()).toEqual([])
    expect(groupNames()).toEqual(['앱 묶음'])
    expect(within(screen.getByRole('button', { name: '앱 묶음' })).getByText('답변 필요')).toBeInTheDocument()
  })

  it('상태별은 카테고리의 고정 순서로 묶고, 항목 머리에서 칩을 빼고 소속은 남긴다 (FR-10·11·13)', async () => {
    renderPanel(items, { reposByWorkspace: repos })
    await userEvent.click(screen.getByRole('button', { name: '상태별' }))
    expect(groupNames()).toEqual(['답변 필요 묶음', '실패 묶음', '완료 · 미확인 묶음'])
    expect(prompts()).toEqual(['오래된 지시', '중간 지시', '최근 지시'])
    expect(document.querySelectorAll('.inbox-head .status')).toHaveLength(0)
    expect(document.querySelectorAll('.inbox-ws')).toHaveLength(3)
    // 답변 필요 묶음은 이름이 곧 그것이라 접혀도 표식이 따로 없다
    const ask = screen.getByRole('button', { name: '답변 필요 묶음' })
    await userEvent.click(ask)
    expect(ask.querySelector('.needs-answer')).toBeNull()
  })

  it('다시 마운트해도 보기·정렬·접힘이 남는다 (FR-3·14)', async () => {
    const { unmount } = render(
      <InboxPanel
        items={items} workspaces={workspaces} reposByWorkspace={repos} error={null}
        onReview={vi.fn()} onOpenConversation={vi.fn()} onRestart={vi.fn()} onCloseIssue={vi.fn()} onMakeIssue={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'workspace별' }))
    await userEvent.click(screen.getByRole('button', { name: '정렬: 최신 먼저' }))
    await userEvent.click(screen.getByRole('button', { name: '앱 · api 묶음' }))
    unmount()

    renderPanel(items, { reposByWorkspace: repos })
    expect(screen.getByRole('button', { name: 'workspace별' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '정렬: 오래된 먼저' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '앱 · api 묶음' })).toHaveAttribute('aria-expanded', 'false')
    expect(prompts()).toEqual(['중간 지시'])
  })
})
