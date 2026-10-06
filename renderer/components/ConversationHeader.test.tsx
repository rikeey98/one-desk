import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConversationHeader } from './ConversationHeader'
import { groupConversations, type Conversation } from '../conversation'
import type { Repo, Run } from '@shared/models'
import type { RunUsage } from '@shared/events'

const repos: Repo[] = [
  { id: 'r1', workspaceId: 'w1', name: 'api', path: '/tmp/api', description: null, sortOrder: 0, createdAt: 0 }
]

function makeRun(over: Partial<Run> & { id: string }): Run {
  return {
    workspaceId: 'w1', agentKind: 'claude-code', model: null, effort: null, cwd: '/tmp/api',
    permission: 'edit', userPrompt: '지시', assembledPrompt: '지시', status: 'succeeded',
    externalSessionId: 'sess-1', parentRunId: null, rootRunId: over.id, resultText: null,
    title: null, closedAt: null,
    needsAnswer: false, timeoutMs: null, exitCode: null, errorMessage: null,
    logPath: '/tmp/x.log', reviewedAt: null, reviewedKind: null, startedAt: null,
    endedAt: null, createdAt: 0, contextItems: [], issue: null, usage: null,
    ...over
  }
}

function usage(over: Partial<RunUsage> = {}): RunUsage {
  return {
    model: 'claude-fake-5[1m]', inputTokens: null, outputTokens: null, cacheReadTokens: null,
    cacheWriteTokens: null, reasoningTokens: null, costUsd: null, contextTokens: null,
    contextWindow: null, ...over
  }
}

function conv(...runs: Run[]): Conversation {
  return groupConversations(runs)[0]!
}

function renderHeader(
  conversation: Conversation | null,
  over: Partial<Parameters<typeof ConversationHeader>[0]> = {}
) {
  const props: Parameters<typeof ConversationHeader>[0] = {
    conversation,
    repos,
    renaming: false,
    onStartRename: vi.fn(),
    onRename: vi.fn(),
    onCancelRename: vi.fn(),
    onClose: vi.fn(),
    onCancel: vi.fn(),
    hasDraft: false,
    ...over
  }
  const view = render(<ConversationHeader {...props} />)
  return { ...view, props }
}

/** 헤더의 "이 대화에 담긴 것" 줄. 없으면 null이다. */
function appliedRow(container: HTMLElement): HTMLElement | null {
  return container.querySelector('.applied-context')
}

describe('ConversationHeader — 제목과 부제 (spec FR-33)', () => {
  it('새 대화는 제목 "새 대화"만 있고 메뉴·링·담긴 것 줄이 없다', () => {
    const { container } = renderHeader(null)
    expect(container.querySelector('.conv-title')).toHaveTextContent('새 대화')
    expect(screen.queryByRole('button', { name: '대화 메뉴' })).toBeNull()
    expect(screen.queryByRole('button', { name: /사용량/ })).toBeNull()
    expect(appliedRow(container)).toBeNull()
  })

  it('제목과 부제(agent · repo)를 보인다', () => {
    const { container } = renderHeader(conv(makeRun({ id: 'a1', title: '인증 정리' })))
    expect(container.querySelector('.conv-title')).toHaveTextContent('인증 정리')
    expect(container.querySelector('.conv-sub')).toHaveTextContent('Claude Code · api')
  })

  it('등록되지 않은 디렉토리면 경로의 마지막 칸을, 끝낸 대화면 그 사실을 부제에 붙인다', () => {
    const { container } = renderHeader(conv(makeRun({
      id: 'a1', agentKind: 'opencode', cwd: '/home/me/scratch', closedAt: 5
    })))
    expect(container.querySelector('.conv-sub')).toHaveTextContent('OpenCode · scratch · 끝낸 대화')
  })

  it('제목은 버튼이 아니다 — 누르면 이름 바꾸기가 시작된다', async () => {
    // 제목과 같은 이름의 버튼이 생기면 이슈 줄(`{ name: <이슈 이름>, exact: true }`)과
    // 부딪힌다 — 대화 제목은 담은 이슈의 이름이다(FR-34).
    const { container, props } = renderHeader(conv(makeRun({ id: 'a1', title: '인증 정리' })))
    expect(screen.queryByRole('button', { name: '인증 정리' })).toBeNull()
    const title = container.querySelector<HTMLElement>('.conv-title')!
    expect(title).toHaveAttribute('title', '눌러서 이름 바꾸기')
    await userEvent.click(title)
    expect(props.onStartRename).toHaveBeenCalled()
  })

  it('이름을 고치는 중이면 제목 자리가 입력칸이 된다 — 붙인 이름에서 시작한다', async () => {
    const { props } = renderHeader(
      conv(makeRun({ id: 'a1', title: '인증 정리' })), { renaming: true }
    )
    const box = screen.getByRole('textbox', { name: '인증 정리 새 이름' })
    expect(box).toHaveValue('인증 정리')
    await userEvent.clear(box)
    await userEvent.type(box, '토큰 정리{Enter}')
    expect(props.onRename).toHaveBeenCalledWith('토큰 정리')
  })

  it('파생 제목이면 빈 칸에서 시작한다 — 파생 제목을 이름으로 굳히지 않는다', () => {
    renderHeader(conv(makeRun({ id: 'a1', userPrompt: '로그인 고쳐줘' })), { renaming: true })
    expect(screen.getByRole('textbox', { name: '로그인 고쳐줘 새 이름' })).toHaveValue('')
  })
})

describe('ConversationHeader — 이 대화에 담긴 것 (ConversationPanel에서 옮겨 옴)', () => {
  const applied = () => conv(
    makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, contextItems: [
      { type: 'memo', id: 'm1', label: '릴리스 절차' }
    ] }),
    makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, contextItems: [
      { type: 'issue', id: 'i1', label: '토큰 만료 버그' },
      { type: 'asset', id: 's1', label: 'review' }
    ] })
  )

  it('담긴 항목을 종류와 이름으로, 처음 담긴 턴 순으로 보여준다', () => {
    const { container } = renderHeader(applied())
    const row = appliedRow(container)!
    expect([...row.querySelectorAll('.applied-chip')].map((e) => e.textContent)).toEqual([
      '이슈 · 토큰 만료 버그', 'asset · review', '메모 · 릴리스 절차'
    ])
  })

  it('한 줄이라 넘치면 잘린다 — 전체는 줄의 title로 읽는다', () => {
    const { container } = renderHeader(applied())
    expect(appliedRow(container)).toHaveAttribute(
      'title', '이슈 · 토큰 만료 버그, asset · review, 메모 · 릴리스 절차'
    )
  })

  it('@로 담은 파일은 `파일 · 상대 경로`로 보인다 (docs/sdlc/input-triggers/ FR-17)', () => {
    const { container } = renderHeader(conv(makeRun({ id: 'f1', contextItems: [
      { type: 'file', id: 'r1:notes/a.txt', label: 'notes/a.txt' }
    ] })))
    expect([...appliedRow(container)!.querySelectorAll('.applied-chip')].map((e) => e.textContent))
      .toEqual(['파일 · notes/a.txt'])
  })

  it('보기 전용이다 — 줄 안에 누를 것이 없다', () => {
    const { container } = renderHeader(applied())
    expect(within(appliedRow(container)!).queryAllByRole('button')).toEqual([])
  })

  it('아무것도 담지 않은 대화에는 줄이 없다', () => {
    const { container } = renderHeader(conv(makeRun({ id: 'b1' })))
    expect(appliedRow(container)).toBeNull()
  })
})

describe('ConversationHeader — ⋯ 메뉴 (spec FR-35)', () => {
  it('메뉴는 이름 바꾸기·이슈 할당·대화 끝내기다 (conversation-issue FR-21)', async () => {
    renderHeader(conv(makeRun({ id: 'a1' })))
    const trigger = screen.getByRole('button', { name: '대화 메뉴' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).toBeNull()

    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((e) => e.textContent)).toEqual([
      '이름 바꾸기', '이슈 할당', '대화 끝내기'
    ])
  })

  it('할당된 대화의 메뉴에는 이슈 바꾸기·이슈 할당 해제가 있다 (conversation-issue FR-21)', async () => {
    renderHeader(conv(makeRun({ id: 'a1', issue: { id: 'i1', title: '로그인 버그' } })))
    await userEvent.click(screen.getByRole('button', { name: '대화 메뉴' }))
    expect(screen.getAllByRole('menuitem').map((e) => e.textContent)).toEqual([
      '이름 바꾸기', '이슈 바꾸기', '이슈 할당 해제', '대화 끝내기'
    ])
  })

  it('이름 바꾸기를 고르면 메뉴가 닫히고 이름 바꾸기가 시작된다', async () => {
    const { props } = renderHeader(conv(makeRun({ id: 'a1' })))
    await userEvent.click(screen.getByRole('button', { name: '대화 메뉴' }))
    await userEvent.click(screen.getByRole('menuitem', { name: '이름 바꾸기' }))
    expect(props.onStartRename).toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('대화 끝내기를 고르면 끝낸다', async () => {
    const { props } = renderHeader(conv(makeRun({ id: 'a1' })))
    await userEvent.click(screen.getByRole('button', { name: '대화 메뉴' }))
    await userEvent.click(screen.getByRole('menuitem', { name: '대화 끝내기' }))
    expect(props.onClose).toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('끝낸 대화의 메뉴에는 끝내기가 없다 (lifecycle FR-22)', async () => {
    renderHeader(conv(makeRun({ id: 'a1', closedAt: 5 })))
    await userEvent.click(screen.getByRole('button', { name: '대화 메뉴' }))
    expect(screen.getAllByRole('menuitem').map((e) => e.textContent)).toEqual(['이름 바꾸기', '이슈 할당'])
  })

  it('열면 첫 항목에 포커스가 가고 ↑↓로 오간다', async () => {
    renderHeader(conv(makeRun({ id: 'a1' })))
    await userEvent.click(screen.getByRole('button', { name: '대화 메뉴' }))
    const [rename, assign, close] = screen.getAllByRole('menuitem')
    expect(rename).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(assign).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(close).toHaveFocus()
    // 끝에서 한 번 더 내리면 처음으로 돈다.
    await userEvent.keyboard('{ArrowDown}')
    expect(rename).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(close).toHaveFocus()
  })

  /**
   * **메뉴를 닫는 Esc는 밖으로 새지 않는다** (FR-35·FR-39). 안쪽부터 푼다 — 같은 Esc에 도크
   * 최대화(Dock의 onKeyDown)나 열린 항목 닫기(App의 document 리스너)까지 풀리면 안 된다.
   */
  it('Esc는 메뉴만 닫고 전파되지 않는다', async () => {
    const outer = vi.fn()
    const onDocument = vi.fn()
    document.addEventListener('keydown', onDocument)
    try {
      render(
        <div onKeyDown={outer}>
          <ConversationHeader
            conversation={conv(makeRun({ id: 'a1' }))}
            repos={repos}
            renaming={false}
            onStartRename={vi.fn()}
            onRename={vi.fn()}
            onCancelRename={vi.fn()}
            onClose={vi.fn()}
            onCancel={vi.fn()}
            hasDraft={false}
          />
        </div>
      )
      const trigger = screen.getByRole('button', { name: '대화 메뉴' })
      await userEvent.click(trigger)
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByRole('menu')).toBeNull()
      expect(outer).not.toHaveBeenCalled()
      expect(onDocument).not.toHaveBeenCalled()
      // 닫으면 포커스가 메뉴 단추로 돌아온다 — 포커스가 사라진 메뉴와 함께 없어지지 않게.
      expect(trigger).toHaveFocus()
    } finally {
      document.removeEventListener('keydown', onDocument)
    }
  })

  it('바깥을 누르면 닫힌다', async () => {
    renderHeader(conv(makeRun({ id: 'a1' })))
    await userEvent.click(screen.getByRole('button', { name: '대화 메뉴' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('메뉴 단추를 다시 누르면 닫힌다', async () => {
    renderHeader(conv(makeRun({ id: 'a1' })))
    const trigger = screen.getByRole('button', { name: '대화 메뉴' })
    await userEvent.click(trigger)
    await userEvent.click(trigger)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('ConversationHeader — 컨텍스트 링과 사용량 (spec FR-36)', () => {
  it('링의 이름은 무엇을 여는지와 지금 점유를 함께 말한다', () => {
    renderHeader(conv(makeRun({
      id: 'a1', usage: usage({ contextTokens: 53_347, contextWindow: 1_000_000 })
    })))
    expect(screen.getByRole('button', { name: '사용량, 컨텍스트 5%' })).toBeInTheDocument()
  })

  it('점유는 사용량이 있는 가장 최근 턴의 것이다 — 더하지 않는다', () => {
    // 합계로 비율을 그리면 턴이 쌓일수록 창을 넘는다(CLAUDE.md). 마지막 턴은 아직 사용량이 없다.
    renderHeader(conv(
      makeRun({ id: 'a3', rootRunId: 'a1', createdAt: 30, status: 'running' }),
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20,
        usage: usage({ contextTokens: 300_000, contextWindow: 1_000_000 }) }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10,
        usage: usage({ contextTokens: 200_000, contextWindow: 1_000_000 }) })
    ))
    expect(screen.getByRole('button', { name: '사용량, 컨텍스트 30%' })).toBeInTheDocument()
  })

  /**
   * 사용량만 있고 점유를 모르는 마지막 턴 (spec §8의 8, 결정 2026-09-27 — 지금 동작을 지킨다). 링은
   * 점유를 아는 마지막 턴의 (점유, 창) 짝이다 — 모르는 턴이 앞에서 안 점유를 지워 링이 `사용량`
   * 글자로 바뀌지 않는다(FR-36 문장을 이 동작대로 고쳤다).
   */
  it('마지막 턴이 점유를 모르면 점유를 아는 앞 턴의 짝을 보인다', () => {
    renderHeader(conv(
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, usage: usage({ outputTokens: 12 }) }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10,
        usage: usage({ contextTokens: 300_000, contextWindow: 1_000_000 }) })
    ))
    expect(screen.getByRole('button', { name: '사용량, 컨텍스트 30%' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '사용량' })).toBeNull()
  })

  /**
   * 링 곁의 퍼센트 글자와 짧은 호 (spec §8의 2, 결정 2026-09-27). 5%면 채움이 2px 점 하나라 스피너와
   * 구별되지 않았다. 이름은 그대로다 — 글자는 이름과 같은 수를 보일 뿐이다.
   */
  it('링 곁에 퍼센트 글자가 있고, 이름은 그대로다', () => {
    const { container } = renderHeader(conv(makeRun({
      id: 'a1', usage: usage({ contextTokens: 53_347, contextWindow: 1_000_000 })
    })))
    const button = screen.getByRole('button', { name: '사용량, 컨텍스트 5%' })
    expect(container.querySelector('.conv-ring')).not.toBeNull()
    expect(within(button).getByText('5%')).toHaveClass('conv-usage-text')
  })

  it('낮은 점유도 점이 아니라 짧은 호다 — 끝이 둥글고 최소 길이가 있다', () => {
    const { container } = renderHeader(conv(makeRun({
      id: 'a1', usage: usage({ contextTokens: 4_000, contextWindow: 1_000_000 })
    })))
    const fill = container.querySelector<SVGCircleElement>('.conv-ring-fill')!
    expect(fill).toHaveAttribute('stroke-linecap', 'round')
    // 0.4%를 그대로 그리면 호 길이가 0.18px이다 — 둥근 끝이 2px 점 하나로 만든다.
    const [dash] = fill.getAttribute('stroke-dasharray')!.split(/[ ,]+/).map(Number)
    expect(dash).toBeGreaterThanOrEqual(3)
    expect(screen.getByRole('button', { name: '사용량, 컨텍스트 <1%' })).toHaveTextContent('<1%')
  })

  it('호 길이는 점유에 비례한다 — 최소 길이는 낮은 점유에만 걸린다', () => {
    const { container } = renderHeader(conv(makeRun({
      id: 'a1', usage: usage({ contextTokens: 500_000, contextWindow: 1_000_000 })
    })))
    const fill = container.querySelector<SVGCircleElement>('.conv-ring-fill')!
    const [dash, gap] = fill.getAttribute('stroke-dasharray')!.split(/[ ,]+/).map(Number)
    const circumference = 2 * Math.PI * Number(fill.getAttribute('r'))
    expect(dash).toBeCloseTo(circumference / 2, 5)
    expect(gap).toBeGreaterThanOrEqual(circumference / 2)
  })

  it('80%를 넘으면 경고 색이다', () => {
    const { container } = renderHeader(conv(makeRun({
      id: 'a1', usage: usage({ contextTokens: 850_000, contextWindow: 1_000_000 })
    })))
    expect(container.querySelector('.conv-ring')).toHaveClass('conv-ring-warn')
  })

  it('80% 이하는 경고 색이 아니다', () => {
    const { container } = renderHeader(conv(makeRun({
      id: 'a1', usage: usage({ contextTokens: 800_000, contextWindow: 1_000_000 })
    })))
    expect(container.querySelector('.conv-ring')).not.toHaveClass('conv-ring-warn')
  })

  it('창 크기를 모르면(OpenCode) 링 대신 토큰 수 글자다', () => {
    const { container } = renderHeader(conv(makeRun({
      id: 'a1', agentKind: 'opencode', usage: usage({ model: null, contextTokens: 53_347 })
    })))
    const button = screen.getByRole('button', { name: '사용량, 컨텍스트 53.3k' })
    expect(button).toHaveTextContent('컨텍스트 53.3k')
    expect(container.querySelector('.conv-ring')).toBeNull()
  })

  it('사용량이 하나도 없으면 아무것도 없다', () => {
    renderHeader(conv(makeRun({ id: 'a1' })))
    expect(screen.queryByRole('button', { name: /사용량/ })).toBeNull()
  })

  it('비용은 누를 때만 보인다 — 누르면 누적 토큰·추정 비용·마지막 컨텍스트가 뜬다', async () => {
    renderHeader(conv(
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, usage: usage({
        inputTokens: 3, outputTokens: 40, cacheReadTokens: 15_428, cacheWriteTokens: 37_917,
        costUsd: 0.2, contextTokens: 53_347, contextWindow: 1_000_000
      }) }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, usage: usage({
        inputTokens: 2, outputTokens: 60, cacheReadTokens: 1_000, cacheWriteTokens: 0,
        costUsd: 0.187, contextTokens: 40_000, contextWindow: 1_000_000
      }) })
    ))
    // run-info FR-4 — 화면에 돈을 상시 띄우지 않는다.
    expect(screen.queryByText(/\$0\.3870/)).toBeNull()

    const button = screen.getByRole('button', { name: '사용량, 컨텍스트 5%' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const popover = screen.getByRole('dialog', { name: '이 대화의 누적 사용량' })
    expect(popover).toHaveTextContent('입력5')
    expect(popover).toHaveTextContent('출력100')
    expect(popover).toHaveTextContent('캐시 읽기16,428')
    expect(popover).toHaveTextContent('캐시 쓰기37,917')
    expect(popover).toHaveTextContent('$0.3870')
    expect(popover).toHaveTextContent('정가 기준 추정')
    expect(popover).toHaveTextContent('53,347 / 1,000,000')
  })

  it('모르는 값은 팝오버에서도 뺀다 — 0으로 채우지 않는다', async () => {
    renderHeader(conv(makeRun({
      id: 'a1', agentKind: 'opencode', usage: usage({ model: null, outputTokens: 7, contextTokens: 53_347 })
    })))
    await userEvent.click(screen.getByRole('button', { name: /사용량/ }))
    const popover = screen.getByRole('dialog', { name: '이 대화의 누적 사용량' })
    expect(popover).toHaveTextContent('출력7')
    expect(popover).not.toHaveTextContent('입력')
    expect(popover).not.toHaveTextContent('$')
    // 창을 모르면 분모 없이 토큰 수만이다.
    expect(popover).toHaveTextContent('53,347')
    expect(popover).not.toHaveTextContent('/')
  })

  it('팝오버를 닫는 Esc도 밖으로 새지 않는다', async () => {
    const outer = vi.fn()
    render(
      <div onKeyDown={outer}>
        <ConversationHeader
          conversation={conv(makeRun({ id: 'a1', usage: usage({ contextTokens: 10, contextWindow: 100 }) }))}
          repos={repos}
          renaming={false}
          onStartRename={vi.fn()}
          onRename={vi.fn()}
          onCancelRename={vi.fn()}
          onClose={vi.fn()}
          onCancel={vi.fn()}
          hasDraft={false}
        />
      </div>
    )
    await userEvent.click(screen.getByRole('button', { name: /사용량/ }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(outer).not.toHaveBeenCalled()
  })

  it('바깥을 누르면 팝오버가 닫힌다', async () => {
    renderHeader(conv(makeRun({ id: 'a1', usage: usage({ contextTokens: 10, contextWindow: 100 }) })))
    await userEvent.click(screen.getByRole('button', { name: /사용량/ }))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

/**
 * 헤더의 멈추기 (`docs/sdlc/conversation-timeline/` spec FR-29). 입력칸에 초안이 있으면 전송 버튼이
 * 실행(예약)이 되고, 대화록을 위로 올려 두면 상태 줄이 화면 밖이다 — 그 둘이 겹쳐도 한 번에 멈출
 * 수 있어야 한다.
 *
 * **초안이 있을 때만 선다** (spec §8의 3, 결정 2026-09-27). 입력칸이 비면 같은 자리의 전송 버튼이
 * 이미 중지라, 헤더까지 서면 도는 턴 하나에 멈추기가 셋이었다. 헤더의 것이 있어야 하는 이유(위)가
 * 초안이 있을 때뿐이다.
 */
describe('ConversationHeader — 멈추기 (spec FR-29)', () => {
  it('도는 턴이 있고 초안이 있으면 멈추기가 있고, 도는 턴을 겨눈다 — 예약이 아니다', async () => {
    const { props } = renderHeader(conv(
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'pending' }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'running', startedAt: 5 })
    ), { hasDraft: true })
    await userEvent.click(screen.getByRole('button', { name: '이 대화의 실행 멈추기' }))
    expect(props.onCancel).toHaveBeenCalledWith('a1')
    expect(props.onCancel).not.toHaveBeenCalledWith('a2')
  })

  it('초안이 없으면 도는 턴이 있어도 없다 — 입력부의 중지가 그 자리다', () => {
    renderHeader(conv(makeRun({ id: 'a1', status: 'running', startedAt: 5 })), { hasDraft: false })
    expect(screen.queryByRole('button', { name: '이 대화의 실행 멈추기' })).toBeNull()
  })

  it('도는 턴이 없으면 초안이 있어도 없다 — 끝난 대화에도, 슬롯을 기다리는 대화에도', () => {
    const { unmount } = renderHeader(conv(makeRun({ id: 'a1', status: 'succeeded' })), { hasDraft: true })
    expect(screen.queryByRole('button', { name: '이 대화의 실행 멈추기' })).toBeNull()
    unmount()
    renderHeader(conv(makeRun({ id: 'a1', status: 'pending' })), { hasDraft: true })
    expect(screen.queryByRole('button', { name: '이 대화의 실행 멈추기' })).toBeNull()
  })

  it('새 대화에는 없다', () => {
    renderHeader(null, { hasDraft: true })
    expect(screen.queryByRole('button', { name: '이 대화의 실행 멈추기' })).toBeNull()
  })
})
