import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InboxPanel } from './InboxPanel'
import type { Run, Workspace } from '@shared/models'

const workspaces: Workspace[] = [
  {
    id: 'w1', name: '앱', description: null, defaultAgentKind: 'claude-code',
    defaultModelClaude: null, defaultModelOpencode: null, defaultPermission: 'edit',
    claudePath: null, opencodePath: null, createdAt: 0, updatedAt: 0
  }
]

function run(over: Partial<Run>): Run {
  return {
    id: 'r1', workspaceId: 'w1', agentKind: 'claude-code', model: null,
    cwd: '/tmp', permission: 'edit', userPrompt: '토큰 만료 고쳐줘', assembledPrompt: 'x',
    status: 'succeeded', externalSessionId: 'sess-1', parentRunId: null,
    // over.id가 있으면 그것을 뿌리로 본다 — 하드코딩하면 id가 다른 두 run을
    // 넘겨도 조용히 한 대화로 접힌다(Dock.test.tsx에서 실제로 터진 결함, T2).
    rootRunId: over.id ?? 'r1',
    resultText: null, needsAnswer: false, timeoutMs: null, exitCode: 0,
    errorMessage: null, logPath: '/tmp/x', reviewedAt: null, reviewedKind: null,
    startedAt: 1, endedAt: 2, createdAt: 0, contextItems: [],
    ...over
  }
}

function renderPanel(items: Run[], over: Partial<Parameters<typeof InboxPanel>[0]> = {}) {
  const props = {
    items,
    workspaces,
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
    const item = run({ contextItems: [{ type: 'issue', id: 'i1' }, { type: 'issue', id: 'i2' }] })
    const { onCloseIssue } = renderPanel([item])
    const buttons = screen.getAllByRole('button', { name: '관련 이슈 닫기' })
    expect(buttons).toHaveLength(2)
    buttons[0]!.click()
    expect(onCloseIssue).toHaveBeenCalledWith(item, 'i1')
  })

  it('repo 맥락은 관련 이슈 닫기를 만들지 않는다', () => {
    // contextItems에는 repo·memo도 섞여 온다. 이슈만 골라야 한다.
    renderPanel([run({ contextItems: [{ type: 'repo', id: 'p1' }] })])
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
        over: { status: 'failed', errorMessage: '오류', contextItems: [{ type: 'issue', id: 'i1' }] },
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
          error={null}
          onReview={vi.fn()}
          onOpenConversation={vi.fn()}
          onRestart={vi.fn()}
          onCloseIssue={vi.fn()}
          onMakeIssue={vi.fn()}
        />
      )
      const actual = screen.getAllByRole('button').map((b) => b.textContent ?? '').sort()
      const sortedExpected = [...expected].sort()
      if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
        mismatches.push({ category, expected: sortedExpected, actual })
      }
      unmount()
    }

    expect(mismatches).toEqual([])
  })
})
