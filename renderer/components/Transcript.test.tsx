import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Transcript } from './Transcript'
import { groupConversations } from '../conversation'
import { useRunEvents, useRunEventSnapshot } from '../hooks/useRunEvents'
import type { Run } from '@shared/models'
import type { RunEvent } from '@shared/events'

// vi.fn()으로 감싸 호출 여부·횟수·인자를 단언할 수 있게 한다.
// DOM에 텍스트가 있는지만 보면 "훅이 안 불렸다"와 "훅은 불렸지만 JSX만 감췄다"를
// 구분하지 못한다 — 후자도 회귀지만 텍스트 단언만으로는 초록으로 남는다.
//
// **훅이 둘이다** (`docs/sdlc/conversation-timeline/` spec FR-14). 접힌 턴은 스토어만 보는
// `useRunEventSnapshot`, 펼친 턴만 로그 파일까지 되살리는 `useRunEvents`를 쓴다.
vi.mock('../hooks/useRunEvents', () => ({
  useRunEvents: vi.fn(),
  useRunEventSnapshot: vi.fn(() => [])
}))

const useRunEventsMock = vi.mocked(useRunEvents)
const snapshotMock = vi.mocked(useRunEventSnapshot)

/** 펼친 턴이 로그에서 되살린 것 — 모의가 기본으로 돌려주는 한 줄이다. */
const LOG_LINE: RunEvent = { type: 'text', seq: 1, runId: 'a1', at: 0, text: '도구 로그' }

beforeEach(() => {
  // mockClear는 구현을 남긴다 — 앞 테스트가 세운 이벤트가 새지 않게 매번 되돌린다.
  useRunEventsMock.mockReset()
  useRunEventsMock.mockImplementation(() => ({ events: [LOG_LINE], error: null }))
  snapshotMock.mockReset()
  snapshotMock.mockReturnValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

function makeRun(over: Partial<Run> & { id: string }): Run {
  return {
    workspaceId: 'ws', agentKind: 'claude-code', model: null, effort: null, cwd: '/repo',
    permission: 'edit', userPrompt: '지시', assembledPrompt: '지시', status: 'succeeded',
    externalSessionId: null, parentRunId: null, rootRunId: over.id, resultText: null,
    // 대화의 이름과 끝. 뿌리 행에서만 의미가 있고 기본은 둘 다 null이다.
    title: null, closedAt: null,
    needsAnswer: false, timeoutMs: null, exitCode: null, errorMessage: null,
    logPath: '/tmp/x.log', reviewedAt: null, reviewedKind: null, startedAt: null,
    endedAt: null, createdAt: 0, contextItems: [], usage: null, ...over
  }
}

function text(seq: number, body: string, runId = 'a1'): RunEvent {
  return { type: 'text', runId, seq, at: 0, text: body }
}

function use(seq: number, id: string, name: string, input: unknown, runId = 'a1'): RunEvent {
  return { type: 'tool_use', runId, seq, at: 0, toolUseId: id, name, effect: 'other', targetPaths: [], input }
}

function result(seq: number, id: string, ok = true, runId = 'a1'): RunEvent {
  return { type: 'tool_result', runId, seq, at: 0, toolUseId: id, ok, summary: ok ? 'ok' : '오류' }
}

function resultWith(seq: number, id: string, summary: string, ok = true): RunEvent {
  return { type: 'tool_result', runId: 'a1', seq, at: 0, toolUseId: id, ok, summary }
}

function errorEvent(seq: number, message: string): RunEvent {
  return { type: 'error', runId: 'a1', seq, at: 0, message }
}

function raw(seq: number, line: string): RunEvent {
  return { type: 'raw', runId: 'a1', seq, at: 0, line }
}

/** 스토어 스냅샷을 run id별로 세운다 — 모의 훅이 그 run의 것만 돌려준다. */
function snapshots(byRun: Record<string, RunEvent[]>) {
  snapshotMock.mockImplementation((runId) => (runId ? byRun[runId] ?? [] : []))
}

/**
 * 스토어 하나를 세운다 — 접힌 턴(스냅샷)과 펼친 턴(`useRunEvents`)이 같은 이벤트를 본다.
 * 실제로 둘은 같은 스토어의 같은 배열이다(`useRunEvents`가 스냅샷을 그대로 돌려준다).
 */
function store(byRun: Record<string, RunEvent[]>) {
  snapshots(byRun)
  useRunEventsMock.mockImplementation((runId) => ({
    events: runId ? byRun[runId] ?? [] : [], error: null
  }))
}

type Handlers = Partial<Parameters<typeof Transcript>[0]>

function renderRuns(runs: Run[], handlers: Handlers = {}) {
  const conv = groupConversations(runs)[0]!
  const props = {
    onCancel: vi.fn(),
    onResend: vi.fn().mockResolvedValue(true),
    onAnswer: vi.fn(),
    ...handlers
  }
  const view = render(<Transcript conversation={conv} {...props} />)
  return { ...view, ...props }
}

/** 한 턴 안의 칸들을 DOM 순서대로 — FR-12의 "이 순서다"를 고정한다. */
function sections(turn: Element): string[] {
  return [...turn.children].map((child) => child.className.split(' ')[0]!)
}

describe('Transcript', () => {
  it('턴마다 지시와 답변을 그린다', () => {
    renderRuns([makeRun({ id: 'a1', createdAt: 10, userPrompt: '첫 지시', resultText: '첫 답변' })])
    expect(screen.getByText('첫 지시')).toBeInTheDocument()
    expect(screen.getByText('첫 답변')).toBeInTheDocument()
  })

  /** 접힌 턴이 보여주는 것 (`docs/sdlc/conversation-timeline/` spec FR-12) */
  describe('접힌 턴', () => {
    it('진행 중이면 버블 · 상태 줄 · 활동 요약 · 흐르는 답 · 끝줄을 이 순서로 그린다', () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(100_000)
      snapshots({
        a1: [
          text(1, '먼저 봅니다'),
          use(2, 't1', 'Read', { file_path: '/repo/src/auth.ts' }),
          result(3, 't1'),
          use(4, 't2', 'Bash', { command: 'pnpm lint' }),
          result(5, 't2', false),
          text(6, '이제 **테스트**를 돌립니다'),
          use(7, 't3', 'Bash', { command: 'pnpm test\n--run' })
        ]
      })
      const { container } = renderRuns([
        makeRun({ id: 'a1', status: 'running', startedAt: 88_000, userPrompt: '고쳐줘' })
      ])

      const turn = container.querySelector('.turn')!
      expect(sections(turn)).toEqual(['turn-user', 'turn-status', 'turn-summary', 'turn-answer', 'turn-foot'])

      // 상태 줄 — 작업 중 · 경과 시간 · 지금 도는 도구(라벨 + 부제의 첫 줄) · 멈추기.
      const status = turn.querySelector<HTMLElement>('.turn-status')!
      expect(status).toHaveTextContent('작업 중')
      expect(status).toHaveTextContent('12초')
      expect(status).toHaveTextContent('셸')
      expect(status).toHaveTextContent('pnpm test')
      expect(status).not.toHaveTextContent('--run')
      expect(within(status).getByRole('button', { name: '실행 중인 턴 멈추기' })).toBeInTheDocument()
      // live region이 아니다 — 경과 시간이 1초마다 읽히면 안 된다 (NFR-4).
      expect(status.closest('[role="status"], [aria-live]')).toBeNull()

      // 활동 요약 — 도구 수와 실패 수.
      expect(turn.querySelector('.turn-summary')).toHaveTextContent('도구 3회 · 실패 1')

      // 답 칸 — 지금까지의 마지막 텍스트를 마크다운으로.
      const answer = turn.querySelector<HTMLElement>('.turn-answer')!
      expect(answer).toHaveTextContent('이제 테스트를 돌립니다')
      expect(within(answer).getByText('테스트').tagName).toBe('STRONG')
      expect(answer).not.toHaveTextContent('먼저 봅니다')

      // 도구 한 줄·중간 텍스트는 접힌 턴에 없다.
      expect(screen.queryByText('먼저 봅니다')).toBeNull()
      expect(screen.queryByText('pnpm lint')).toBeNull()
    })

    it('끝났으면 상태 줄이 없고 최종 답과 응답 복사가 있다', () => {
      snapshots({ a1: [text(1, '끝남'), use(2, 't1', 'Read', { file_path: '/repo/a.ts' }), result(3, 't1')] })
      const { container } = renderRuns([
        makeRun({ id: 'a1', status: 'succeeded', startedAt: 1_000, endedAt: 23_000, resultText: '## 원인\n\n`<=`여야 합니다' })
      ])
      const turn = container.querySelector('.turn')!
      expect(sections(turn)).toEqual(['turn-user', 'turn-summary', 'turn-answer', 'turn-foot'])
      expect(within(turn as HTMLElement).getByRole('heading', { name: '원인' })).toBeInTheDocument()
      expect(turn.querySelector('.turn-summary')).toHaveTextContent('도구 1회')
      expect(turn.querySelector('.turn-summary')).not.toHaveTextContent('실패')
      expect(screen.getByRole('button', { name: '응답 복사' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '실행 중인 턴 멈추기' })).toBeNull()
    })

    it('도구를 안 썼으면 활동 요약이 없다', () => {
      const { container } = renderRuns([makeRun({ id: 'a1', resultText: '답' })])
      expect(container.querySelector('.turn-summary')).toBeNull()
    })

    it('진행 중에 흐르는 답은 복사할 수 없다 — 아직 답이 아니다', () => {
      snapshots({ a1: [text(1, '쓰는 중')] })
      renderRuns([makeRun({ id: 'a1', status: 'running', startedAt: 0 })])
      expect(screen.getByText('쓰는 중')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '응답 복사' })).toBeNull()
    })

    it('실패하면 오류 카드가 끝줄 위에 선다', () => {
      const { container } = renderRuns([
        makeRun({ id: 'a1', status: 'failed', errorMessage: 'claude를 찾을 수 없습니다' })
      ])
      const turn = container.querySelector('.turn')!
      expect(sections(turn)).toEqual(['turn-user', 'form-error', 'turn-foot'])
      expect(screen.getByRole('alert')).toHaveTextContent('claude를 찾을 수 없습니다')
    })

    it('사용자 버블은 평문이다 — 사람이 친 *나 #이 뜻을 바꾸지 않는다', () => {
      const { container } = renderRuns([makeRun({ id: 'a1', userPrompt: '# 제목 아님\n*강조 아님*' })])
      const bubble = container.querySelector('.turn-user')!
      expect(bubble.textContent).toBe('# 제목 아님\n*강조 아님*')
      expect(bubble.querySelector('h1, em')).toBeNull()
    })
  })

  /** 상태 이름은 한국어 한 표다 (FR-45) — 영어 enum이 화면에 나가지 않는다. */
  describe('상태 알약', () => {
    it.each([
      ['running', '실행 중'],
      ['succeeded', '완료'],
      ['failed', '실패'],
      ['canceled', '취소됨'],
      ['interrupted', '중단됨']
    ] as const)('%s는 %s로 보이고 클래스는 enum 그대로다', (status, label) => {
      const { container } = renderRuns([makeRun({ id: 'a1', status, startedAt: 0 })])
      const pill = container.querySelector('.turn-foot .status')!
      expect(pill).toHaveTextContent(label)
      expect(pill).toHaveClass(`status-${status}`)
      expect(pill.textContent).not.toContain(status)
    })
  })

  /** 펼치고 접는 것은 전부 사용자가 한다 (FR-14·FR-15, CLAUDE.md) */
  describe('펼침', () => {
    it('접힌 턴은 스토어만 보고 로그 파일을 읽는 훅을 걸지 않는다 — 펼친 턴만 건다', async () => {
      renderRuns([makeRun({ id: 'a1', status: 'succeeded', resultText: '답변' })])
      expect(screen.queryByText('도구 로그')).not.toBeInTheDocument()
      // DOM 단언만으로는 "펼친 몸통이 마운트 안 됨"과 "마운트됐지만 JSX만 숨김"을 구분 못 한다.
      // 훅 자체가 안 불렸다는 것을 직접 확인한다.
      expect(useRunEventsMock).not.toHaveBeenCalled()
      expect(snapshotMock).toHaveBeenCalledWith('a1')

      await userEvent.click(screen.getByRole('button', { name: '자세히' }))
      expect(screen.getByText('도구 로그')).toBeInTheDocument()
      expect(useRunEventsMock).toHaveBeenCalledWith('a1')
      expect(screen.getByRole('button', { name: '접기' })).toBeInTheDocument()
    })

    it('진행 중인 턴도 접혀 있고 눌러야 펼쳐진다', async () => {
      // 지난 턴과 같은 규칙이다 — 진행 중이라고 먼저 펼치지 않는다(사용자가 뒤집은
      // 결정: 대화록은 지시와 답변만 흐르고, 도구 호출은 눌러서 본다).
      renderRuns([makeRun({ id: 'a1', status: 'running', startedAt: 0 })])
      expect(screen.queryByText('도구 로그')).not.toBeInTheDocument()
      expect(useRunEventsMock).not.toHaveBeenCalled()
      await userEvent.click(screen.getByRole('button', { name: '자세히' }))
      expect(screen.getByText('도구 로그')).toBeInTheDocument()
    })

    it('펼친 턴은 활동 요약 대신 블록을 보이고, 진행 중의 흐르는 답은 블록 안에만 있다', async () => {
      // 펼친 턴의 진행 중 마지막 텍스트는 블록 안에 제자리로 있다(FR-13) — 답 칸에 한 번 더
      // 그리면 같은 글이 두 번 보인다.
      store({ a1: [text(1, '흐르는 말'), use(2, 't1', 'Read', { file_path: '/repo/a.ts' })] })
      const { container } = renderRuns([makeRun({ id: 'a1', status: 'running', startedAt: 0 })])
      expect(container.querySelector('.turn-answer')).toHaveTextContent('흐르는 말')

      await userEvent.click(screen.getByRole('button', { name: '자세히' }))
      expect(container.querySelector('.turn-summary')).toBeNull()
      expect(container.querySelector('.turn-answer')).toBeNull()
      expect(container.querySelector('.turn-status')).toBeInTheDocument()
      expect(screen.getAllByText('흐르는 말')).toHaveLength(1)
      expect(screen.getByText('흐르는 말').closest('.tl-text')).not.toBeNull()
    })

    it('펼친 턴도 끝났으면 최종 답을 블록 아래에 보인다', async () => {
      const { container } = renderRuns([makeRun({ id: 'a1', status: 'succeeded', resultText: '최종 답' })])
      await userEvent.click(screen.getByRole('button', { name: '자세히' }))
      const turn = container.querySelector('.turn')!
      expect(sections(turn)).toEqual(['turn-user', 'tl-text', 'turn-answer', 'turn-foot'])
    })

    it('예약된 턴이 자동으로 시작돼도 접힌 채로 남는다', () => {
      // 예전에는 여기서 강제로 펼쳤다(I-1). 그 effect가 되살아나면 이 테스트가 빨개진다.
      const pending = groupConversations([
        makeRun({ id: 'a1', status: 'pending', userPrompt: '예약된 말' })
      ])[0]!
      const props = { onCancel: vi.fn(), onResend: vi.fn(), onAnswer: vi.fn() }
      const { rerender } = render(<Transcript conversation={pending} {...props} />)
      expect(useRunEventsMock).not.toHaveBeenCalled()

      const running = groupConversations([
        makeRun({ id: 'a1', status: 'running', startedAt: 0, userPrompt: '예약된 말' })
      ])[0]!
      rerender(<Transcript conversation={running} {...props} />)

      expect(useRunEventsMock).not.toHaveBeenCalled()
      expect(screen.queryByText('도구 로그')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: '자세히' })).toBeInTheDocument()
    })

    it('진행 중에 펼쳐 둔 턴은 끝나도 접히지 않는다', () => {
      // 펼치고 접는 것은 사용자가 정한다 — 상태 전이가 사용자의 선택을 되돌리면
      // 로그를 읽고 있던 자리가 눈앞에서 사라진다.
      const running = groupConversations([
        makeRun({ id: 'a1', status: 'running', startedAt: 0 })
      ])[0]!
      const props = { onCancel: vi.fn(), onResend: vi.fn(), onAnswer: vi.fn() }
      const { rerender } = render(<Transcript conversation={running} {...props} />)
      fireEvent.click(screen.getByRole('button', { name: '자세히' }))
      expect(screen.getByText('도구 로그')).toBeInTheDocument()

      const done = groupConversations([
        makeRun({ id: 'a1', status: 'succeeded', resultText: '답변' })
      ])[0]!
      rerender(<Transcript conversation={done} {...props} />)
      expect(screen.getByText('도구 로그')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '접기' })).toBeInTheDocument()
    })
  })

  /** 펼친 턴 — 타임라인 블록 (`docs/sdlc/conversation-timeline/` spec FR-13·FR-15~18) */
  describe('펼친 턴의 블록', () => {
    const EDIT = { file_path: '/repo/src/a.ts', old_string: 'a < b', new_string: 'a <= b' }
    const handlers = () => ({ onCancel: vi.fn(), onResend: vi.fn(), onAnswer: vi.fn() })

    async function expand() {
      await userEvent.click(screen.getByRole('button', { name: '자세히' }))
    }

    it('블록을 이벤트 순서대로 그리고, 끝났으면 최종 답을 그 아래에 둔다 (FR-13)', async () => {
      store({
        a1: [
          text(1, '먼저 봅니다'),
          use(2, 't1', 'Read', { file_path: '/repo/src/a.ts' }), result(3, 't1'),
          use(4, 't2', 'Bash', { command: 'pnpm lint' }), result(5, 't2', false),
          use(6, 't3', 'Edit', EDIT), result(7, 't3'),
          use(8, 't4', 'mcp__onedesk__list_issues', {}), result(9, 't4'),
          text(10, '고쳤습니다')
        ]
      })
      const { container } = renderRuns([makeRun({ id: 'a1', resultText: '고쳤습니다' })])
      await expand()
      expect(sections(container.querySelector('.turn')!)).toEqual([
        'turn-user', 'tl-text', 'tl-activity', 'tl-tool-error', 'tl-edit', 'tl-activity',
        'turn-answer', 'turn-foot'
      ])
      // 마지막 text는 답과 같아 블록에서 빠진다 — 같은 답이 두 번 나오지 않는다 (FR-8).
      expect(screen.getAllByText('고쳤습니다')).toHaveLength(1)
    })

    it('진행 중에는 답 칸이 없고 마지막 text가 블록에 있다 — 끝나면 답 칸으로 옮겨 간다', async () => {
      store({
        a1: [
          text(1, '먼저 봅니다'),
          use(2, 't1', 'Read', { file_path: '/repo/a.ts' }), result(3, 't1'),
          text(4, '고쳤습니다')
        ]
      })
      const props = handlers()
      const running = groupConversations([makeRun({ id: 'a1', status: 'running', startedAt: 0 })])[0]!
      const { container, rerender } = render(<Transcript conversation={running} {...props} />)
      await expand()
      const turn = () => container.querySelector('.turn')!
      expect(sections(turn())).toEqual(['turn-user', 'turn-status', 'tl-text', 'tl-activity', 'tl-text', 'turn-foot'])

      const done = groupConversations([
        makeRun({ id: 'a1', status: 'succeeded', resultText: '고쳤습니다', startedAt: 0, endedAt: 1 })
      ])[0]!
      rerender(<Transcript conversation={done} {...props} />)
      expect(sections(turn())).toEqual(['turn-user', 'tl-text', 'tl-activity', 'turn-answer', 'turn-foot'])
      expect(screen.getAllByText('고쳤습니다')).toHaveLength(1)
    })

    it('중간 text는 마크다운이다 (FR-26)', async () => {
      store({ a1: [text(1, '먼저 **인증**을 봅니다')] })
      renderRuns([makeRun({ id: 'a1', resultText: '답' })])
      await expand()
      expect(screen.getByText('인증').tagName).toBe('STRONG')
    })

    it('블록이 없으면 기록된 활동이 없다고 말한다', async () => {
      store({ a1: [] })
      renderRuns([makeRun({ id: 'a1', resultText: '답' })])
      await expand()
      expect(screen.getByText('기록된 활동이 없습니다')).toBeInTheDocument()
    })

    it('로그를 되살리지 못하면 그 이유를 보인다', async () => {
      useRunEventsMock.mockImplementation(() => ({ events: [], error: '로그 파일이 없습니다' }))
      renderRuns([makeRun({ id: 'a1', resultText: '답' })])
      await expand()
      expect(screen.getByRole('alert')).toHaveTextContent('로그 파일이 없습니다')
    })

    it('error 이벤트는 오류 블록이고, raw는 몇 줄인지 알리는 공지다 — 펼치면 원문이다', async () => {
      store({ a1: [errorEvent(1, 'MCP 서버에 연결하지 못했습니다'), raw(2, '{깨진'), raw(3, '줄')] })
      const { container } = renderRuns([makeRun({ id: 'a1', resultText: '답' })])
      await expand()
      expect(container.querySelector('.tl-error')).toHaveTextContent('MCP 서버에 연결하지 못했습니다')
      const notice = screen.getByRole('button', { name: /해석하지 못한 출력 2줄/ })
      expect(notice).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByText(/깨진/)).toBeNull()
      await userEvent.click(notice)
      expect(container.querySelector('.tl-notice')).toHaveTextContent('{깨진 줄')
    })

    /** 펼치고 접는 것은 전부 사용자가 한다 (FR-15) */
    describe('펼침', () => {
      it('묶음·도구 한 줄·편집 파일은 접힌 채 시작한다', async () => {
        store({
          a1: [
            use(1, 't1', 'Bash', { command: 'pnpm test' }), result(2, 't1'),
            use(3, 't2', 'Edit', EDIT), result(4, 't2')
          ]
        })
        const { container } = renderRuns([makeRun({ id: 'a1', resultText: '답' })])
        await expand()
        expect(screen.getByRole('button', { name: /1 셸 사용됨/ })).toHaveAttribute('aria-expanded', 'false')
        expect(screen.queryByText('pnpm test')).toBeNull()
        expect(screen.getByRole('button', { name: /src\/a\.ts/ })).toHaveAttribute('aria-expanded', 'false')
        expect(container.querySelector('.tl-diff')).toBeNull()
      })

      it('새 이벤트가 와도 열린 묶음이 닫히지 않는다', async () => {
        // 스토어에 이벤트가 붙으면 새 배열이 오고 묶음이 길어진다. 열림은 블록 key(첫 이벤트의
        // seq)에 매달려 있어 블록이 길어져도 풀리지 않아야 한다.
        let events = [use(1, 't1', 'Read', { file_path: '/repo/a.ts' }), result(2, 't1')]
        snapshotMock.mockImplementation(() => events)
        useRunEventsMock.mockImplementation(() => ({ events, error: null }))
        const props = handlers()
        const conv = groupConversations([makeRun({ id: 'a1', status: 'running', startedAt: 0 })])[0]!
        const { container, rerender } = render(<Transcript conversation={conv} {...props} />)
        await expand()
        await userEvent.click(screen.getByRole('button', { name: /1 읽기 사용됨/ }))
        // 도는 턴이라 상태 줄에도 지금 도는 도구가 보인다 — 묶음 안으로 좁힌다.
        const bundle = () => container.querySelector<HTMLElement>('.tl-activity')!
        expect(within(bundle()).getByText('a.ts')).toBeInTheDocument()

        events = [...events, use(3, 't2', 'Grep', { pattern: 'expiresAt' })]
        rerender(<Transcript conversation={conv} {...props} />)
        expect(screen.getByRole('button', { name: /2 읽기, Grep 사용됨/ })).toHaveAttribute('aria-expanded', 'true')
        expect(within(bundle()).getByText('expiresAt')).toBeInTheDocument()
      })

      /**
       * **결과가 뒤늦게 묶음을 가르는 경우** (리뷰가 찾은 것). claude는 도구 여럿을 한꺼번에 내고 결과를
       * 나중에 몰아 보낸다 — 그중 하나가 실패로 판명되면 그 도구는 묶음 밖으로 빠진다(FR-2). 묶음의 key가
       * "첫 이벤트의 seq"라 첫 도구가 빠지면 key가 바뀌어, 열어 둔 묶음이 새 이벤트 하나에 닫혔다(FR-15).
       */
      it('병렬 도구의 첫 항목이 실패로 빠져도 열어 둔 묶음은 닫히지 않는다', async () => {
        let events = [use(1, 't1', 'Read', { file_path: '/repo/a.ts' }), use(2, 't2', 'Grep', { pattern: 'expiresAt' })]
        snapshotMock.mockImplementation(() => events)
        useRunEventsMock.mockImplementation(() => ({ events, error: null }))
        const props = handlers()
        const conv = groupConversations([makeRun({ id: 'a1', status: 'running', startedAt: 0 })])[0]!
        const { container, rerender } = render(<Transcript conversation={conv} {...props} />)
        await expand()
        await userEvent.click(screen.getByRole('button', { name: /2 읽기, Grep 사용됨/ }))

        events = [...events, resultWith(3, 't1', '파일이 없습니다', false)]
        rerender(<Transcript conversation={conv} {...props} />)
        expect(container.querySelector('.tl-tool-error')).toHaveTextContent('읽기 a.ts 실패')
        expect(screen.getByRole('button', { name: /1 Grep 사용됨/ })).toHaveAttribute('aria-expanded', 'true')
      })

      it('가운데 도구가 실패해 묶음이 둘로 갈라져도 열어 둔 것은 둘 다 열려 있다', async () => {
        let events = [
          use(1, 't1', 'Read', { file_path: '/repo/a.ts' }),
          use(2, 't2', 'Bash', { command: 'pnpm lint' }),
          use(3, 't3', 'Grep', { pattern: 'expiresAt' })
        ]
        snapshotMock.mockImplementation(() => events)
        useRunEventsMock.mockImplementation(() => ({ events, error: null }))
        const props = handlers()
        const conv = groupConversations([makeRun({ id: 'a1', status: 'running', startedAt: 0 })])[0]!
        const { rerender } = render(<Transcript conversation={conv} {...props} />)
        await expand()
        await userEvent.click(screen.getByRole('button', { name: /3 읽기, 셸, Grep 사용됨/ }))

        events = [...events, resultWith(4, 't2', 'lint 오류', false)]
        rerender(<Transcript conversation={conv} {...props} />)
        expect(screen.getByRole('button', { name: /1 읽기 사용됨/ })).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByRole('button', { name: /1 Grep 사용됨/ })).toHaveAttribute('aria-expanded', 'true')
      })

      it('열어 둔 도구 한 줄이 실패로 판명돼 묶음 밖으로 빠져도 열린 채다', async () => {
        let events = [use(1, 't1', 'Bash', { command: 'pnpm test' })]
        snapshotMock.mockImplementation(() => events)
        useRunEventsMock.mockImplementation(() => ({ events, error: null }))
        const props = handlers()
        const conv = groupConversations([makeRun({ id: 'a1', status: 'running', startedAt: 0 })])[0]!
        const { container, rerender } = render(<Transcript conversation={conv} {...props} />)
        await expand()
        await userEvent.click(screen.getByRole('button', { name: /1 셸 사용됨/ }))
        await userEvent.click(screen.getByRole('button', { name: /셸 pnpm test/ }))

        events = [...events, resultWith(2, 't1', '테스트 3건 실패', false)]
        rerender(<Transcript conversation={conv} {...props} />)
        const failed = container.querySelector<HTMLElement>('.tl-tool-error')!
        expect(within(failed).getByRole('button')).toHaveAttribute('aria-expanded', 'true')
        expect(within(failed).getByText('테스트 3건 실패')).toBeInTheDocument()
      })

      it('편집의 첫 파일이 실패로 빠져도 열어 둔 다른 파일 줄은 열린 채고, 닫아 둔 줄이 열리지도 않는다', async () => {
        const editOf = (path: string) => ({ file_path: path, old_string: 'a', new_string: 'b' })
        let events = [
          use(1, 't1', 'Edit', editOf('/repo/a.ts')),
          use(2, 't2', 'Edit', editOf('/repo/b.ts')),
          use(3, 't3', 'Edit', editOf('/repo/c.ts'))
        ]
        snapshotMock.mockImplementation(() => events)
        useRunEventsMock.mockImplementation(() => ({ events, error: null }))
        const props = handlers()
        const conv = groupConversations([makeRun({ id: 'a1', status: 'running', startedAt: 0 })])[0]!
        const { rerender } = render(<Transcript conversation={conv} {...props} />)
        await expand()
        // 첫째와 셋째를 연다 — 둘째는 닫아 둔다. 자리 순번을 키로 쓰면 첫째가 빠질 때 둘째가 그
        // 자리를 이어받아 열리고, 셋째는 닫힌다.
        await userEvent.click(screen.getByRole('button', { name: /a\.ts/ }))
        await userEvent.click(screen.getByRole('button', { name: /c\.ts/ }))

        events = [...events, resultWith(4, 't1', 'old_string을 찾지 못했습니다', false)]
        rerender(<Transcript conversation={conv} {...props} />)
        expect(screen.getByRole('button', { name: /b\.ts/ })).toHaveAttribute('aria-expanded', 'false')
        expect(screen.getByRole('button', { name: /c\.ts/ })).toHaveAttribute('aria-expanded', 'true')
      })

      it('턴을 접었다 다시 펼쳐도 열어 둔 묶음은 그대로다 — 블록의 펼침은 턴이 쥔다', async () => {
        store({ a1: [use(1, 't1', 'Read', { file_path: '/repo/a.ts' }), result(2, 't1')] })
        renderRuns([makeRun({ id: 'a1', resultText: '답' })])
        await expand()
        await userEvent.click(screen.getByRole('button', { name: /1 읽기 사용됨/ }))
        await userEvent.click(screen.getByRole('button', { name: '접기' }))
        await expand()
        expect(screen.getByRole('button', { name: /1 읽기 사용됨/ })).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByText('a.ts')).toBeInTheDocument()
      })

      it('턴이 끝나도 열어 둔 도구 한 줄은 닫히지 않는다', async () => {
        store({ a1: [use(1, 't1', 'Bash', { command: 'pnpm test' })] })
        const props = handlers()
        const running = groupConversations([makeRun({ id: 'a1', status: 'running', startedAt: 0 })])[0]!
        const { rerender } = render(<Transcript conversation={running} {...props} />)
        await expand()
        await userEvent.click(screen.getByRole('button', { name: /1 셸 사용됨/ }))
        await userEvent.click(screen.getByRole('button', { name: /셸 pnpm test/ }))

        const done = groupConversations([makeRun({ id: 'a1', status: 'succeeded', resultText: '답' })])[0]!
        rerender(<Transcript conversation={done} {...props} />)
        expect(screen.getByRole('button', { name: /셸 pnpm test/ })).toHaveAttribute('aria-expanded', 'true')
      })
    })

    /** 도구 한 줄 (FR-16) */
    describe('도구 한 줄', () => {
      async function openBundle(name: RegExp) {
        await expand()
        await userEvent.click(screen.getByRole('button', { name }))
      }

      let writeText: ReturnType<typeof vi.fn>

      beforeEach(() => {
        // jsdom에는 navigator.clipboard가 없다 — 테스트가 세운다(Markdown.test와 같다).
        writeText = vi.fn(() => Promise.resolve())
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
      })

      afterEach(() => {
        Reflect.deleteProperty(navigator, 'clipboard')
      })

      it('셸은 펼치면 명령 전문과 결과 요약이다 — 잘린 출력에는 그렇다고 붙인다', async () => {
        store({
          a1: [use(1, 't1', 'Bash', { command: 'pnpm test\n  --run' }), resultWith(2, 't1', `${'통과 '.repeat(60)}…`)]
        })
        const { container } = renderRuns([makeRun({ id: 'a1', resultText: '답' })])
        await openBundle(/1 셸 사용됨/)
        const row = screen.getByRole('button', { name: /셸 pnpm test/ })
        // 접힌 줄의 부제는 첫 줄뿐이다.
        expect(row).not.toHaveTextContent('--run')
        await userEvent.click(row)
        expect(row).toHaveAttribute('aria-expanded', 'true')

        const detail = container.querySelector<HTMLElement>('.tl-detail')!
        expect(detail.querySelector('.tl-command')!.textContent).toContain('pnpm test\n  --run')
        expect(detail.querySelector('.tl-output')).toHaveTextContent('통과')
        expect(within(detail).getByText('출력 앞부분만 기록됩니다')).toBeInTheDocument()

        await userEvent.click(within(detail).getByRole('button', { name: '명령 복사' }))
        expect(writeText).toHaveBeenCalledWith('pnpm test\n  --run')
      })

      it('잘리지 않은 출력에는 안내가 없다', async () => {
        store({ a1: [use(1, 't1', 'Bash', { command: 'ls' }), resultWith(2, 't1', 'a.ts')] })
        renderRuns([makeRun({ id: 'a1', resultText: '답' })])
        await openBundle(/1 셸 사용됨/)
        await userEvent.click(screen.getByRole('button', { name: /셸 ls/ }))
        expect(screen.getByText('a.ts')).toBeInTheDocument()
        expect(screen.queryByText('출력 앞부분만 기록됩니다')).toBeNull()
      })

      it('검색은 일치 개수를 보이고, 읽기·검색은 펼칠 것이 없다', async () => {
        store({
          a1: [
            use(1, 't1', 'Read', { file_path: '/repo/src/a.ts' }), result(2, 't1'),
            use(3, 't2', 'Grep', { pattern: 'expiresAt' }), resultWith(4, 't2', 'Found 3 files\nsrc/a.ts')
          ]
        })
        renderRuns([makeRun({ id: 'a1', resultText: '답' })])
        await openBundle(/2 읽기, Grep 사용됨/)
        const grep = screen.getByText('expiresAt').closest<HTMLElement>('.tl-tool')!
        expect(grep).toHaveTextContent('Grep expiresAt (3개 일치)')
        expect(grep.tagName).not.toBe('BUTTON')
        const read = screen.getByText('src/a.ts').closest<HTMLElement>('.tl-tool')!
        expect(read.tagName).not.toBe('BUTTON')
        expect(within(read).queryByRole('button')).toBeNull()
      })

      it('부제의 전체는 title로 읽는다 — 한 줄에서 잘려도', async () => {
        const long = `grep -rn ${'x'.repeat(300)}`
        store({ a1: [use(1, 't1', 'Bash', { command: long }), result(2, 't1')] })
        renderRuns([makeRun({ id: 'a1', resultText: '답' })])
        await openBundle(/1 셸 사용됨/)
        expect(screen.getByText(long)).toHaveAttribute('title', long)
      })

      it('하위 에이전트는 종류를 오른쪽에 두고, 펼치면 지시를 평문으로 보인다', async () => {
        store({
          a1: [
            use(1, 't1', 'Task', { description: '인증 조사', prompt: '**굵게** 조사해', subagent_type: 'Explore' }),
            result(2, 't1')
          ]
        })
        renderRuns([makeRun({ id: 'a1', resultText: '답' })])
        await openBundle(/1 하위 에이전트 사용됨/)
        const row = screen.getByRole('button', { name: /하위 에이전트 인증 조사/ })
        expect(row).toHaveTextContent('Explore')
        await userEvent.click(row)
        const prompt = screen.getByText('**굵게** 조사해')
        expect(prompt.querySelector('strong')).toBeNull()
      })

      it('mcp는 펼치면 입력을 들여쓴 JSON으로 보인다', async () => {
        store({ a1: [use(1, 't1', 'mcp__onedesk__list_issues', { state: 'open' }), result(2, 't1')] })
        const { container } = renderRuns([makeRun({ id: 'a1', resultText: '답' })])
        await openBundle(/^1 list_issues 사용됨$/)
        // 묶음 라벨도 "list_issues"를 담는다 — 한 줄은 이름 전체로 잡는다.
        await userEvent.click(screen.getByRole('button', { name: 'list_issues' }))
        expect(container.querySelector('.tl-detail .tl-output')!.textContent).toBe('{\n  "state": "open"\n}')
      })

      /**
       * mcp 도구 이름은 모노 글자다 (spec §8의 5, 결정 2026-09-27). 라벨에 백틱을 담던 때는
       * "1 `list_issues` 호출 사용됨"이 렌더되지 않은 마크다운처럼 읽혔다. 이름은 코드라 모양으로 가른다.
       */
      it('mcp 도구 이름은 묶음 라벨·도구 한 줄·상태 줄에서 모노 글자이고, 다른 라벨은 아니다', async () => {
        store({
          a1: [
            use(1, 't1', 'Read', { file_path: '/repo/a.ts' }), result(2, 't1'),
            use(3, 't2', 'mcp__onedesk__list_issues', {}), result(4, 't2'),
            use(5, 't3', 'mcp__onedesk__create_issue', { title: 'x' })
          ]
        })
        const { container } = renderRuns([makeRun({ id: 'a1', status: 'running', startedAt: 0 })])
        // 상태 줄의 지금 도는 도구 — 접힌 턴에서도 보인다.
        const status = container.querySelector<HTMLElement>('.turn-status')!
        expect(within(status).getByText('create_issue')).toHaveClass('tool-name')

        await openBundle(/^3 읽기, list_issues, create_issue 사용됨$/)
        const head = screen.getByRole('button', { name: /^3 읽기, list_issues, create_issue 사용됨$/ })
        // 보이는 글자도 이름과 같은 한 줄이다 — 조각으로 그려도 모양은 `block.label`이다.
        expect(head.textContent).toBe('3 읽기, list_issues, create_issue 사용됨')
        expect([...head.querySelectorAll('.tool-name')].map((e) => e.textContent)).toEqual([
          'list_issues', 'create_issue'
        ])
        expect(within(head).getByText(/읽기/)).not.toHaveClass('tool-name')
        const row = screen.getByRole('button', { name: 'list_issues' })
        expect(within(row).getByText('list_issues')).toHaveClass('tool-name')
        expect(container.querySelector('.tl-activity .tl-tool .tool-name')).not.toBeNull()
        expect(within(screen.getByText('a.ts').closest<HTMLElement>('.tl-tool')!).getByText('읽기'))
          .not.toHaveClass('tool-name')
      })

      /**
       * 경로는 모노로 그린다 (spec §8의 7, 결정 2026-09-27) — 한국어 Windows의 UI 글꼴(Malgun Gothic)은
       * `\`를 `₩`로 그려 `src₩auth.ts`로 보였다. 경로가 아닌 부제(명령·검색어)는 UI 글꼴 그대로다.
       */
      it('부제가 파일 경로면 모노 글자이고, 명령·검색어는 아니다', async () => {
        store({
          a1: [
            use(1, 't1', 'Read', { file_path: 'C:\\repo\\src\\auth.ts' }), result(2, 't1'),
            use(3, 't2', 'Grep', { pattern: 'expiresAt' }), result(4, 't2'),
            use(5, 't3', 'Bash', { command: 'pnpm test' }), result(6, 't3')
          ]
        })
        renderRuns([makeRun({ id: 'a1', cwd: 'C:\\repo', resultText: '답' })])
        await openBundle(/3 읽기, Grep, 셸 사용됨/)
        expect(screen.getByText('src\\auth.ts')).toHaveClass('tl-sub', 'path-text')
        expect(screen.getByText('expiresAt')).not.toHaveClass('path-text')
        expect(screen.getByText('pnpm test')).not.toHaveClass('path-text')
      })

      /**
       * 꺾쇠는 글자 바로 뒤다 (spec §8의 5, 결정 2026-09-27) — 묶음·도구·실패 줄이 한 자리를 쓴다. 파일
       * 줄만 오른쪽 끝(`+N −M` 곁)이다. 오른쪽으로 민 곁 글자(하위 에이전트의 종류)는 꺾쇠 뒤에 선다.
       */
      it('하위 에이전트 줄의 꺾쇠는 글자 바로 뒤이고, 종류는 그 뒤 오른쪽 끝이다', async () => {
        store({
          a1: [
            use(1, 't1', 'Task', { description: '인증 조사', prompt: '조사해', subagent_type: 'Explore' }),
            result(2, 't1')
          ]
        })
        renderRuns([makeRun({ id: 'a1', resultText: '답' })])
        await openBundle(/1 하위 에이전트 사용됨/)
        const row = screen.getByRole('button', { name: /하위 에이전트 인증 조사/ })
        const order = [...row.children].map((child) => child.getAttribute('class')!.split(' ')[0])
        expect(order).toEqual(['tl-label', 'tl-sub', 'tl-chevron', 'tl-aside'])
      })

      it('결과 없이 끝난 도구는 결과 없음이고, 도는 도구에는 스피너가 있다', async () => {
        store({ a1: [use(1, 't1', 'Read', { file_path: '/repo/a.ts' })] })
        const { container, unmount } = renderRuns([makeRun({ id: 'a1', status: 'interrupted', startedAt: 0 })])
        await openBundle(/1 읽기 사용됨/)
        expect(screen.getByText('a.ts').closest('.tl-tool')).toHaveTextContent('결과 없음')
        expect(container.querySelector('.tl-tool .turn-spinner')).toBeNull()
        unmount()

        const view = renderRuns([makeRun({ id: 'a1', status: 'running', startedAt: 0 })])
        await openBundle(/1 읽기 사용됨/)
        // 도는 턴이라 상태 줄에도 같은 도구가 보인다 — 묶음 안으로 좁힌다.
        const row = view.container.querySelector<HTMLElement>('.tl-activity .tl-tool')!
        expect(row.querySelector('.turn-spinner')).not.toBeNull()
        expect(row).not.toHaveTextContent('결과 없음')
      })
    })

    it('스피너는 상태 줄과 도는 도구 한 줄뿐이다 — 묶음·편집 머리에는 없다 (FR-49)', async () => {
      // 움직임은 상태를 전하는 것만이다(D11). 머리까지 돌면 펼친 진행 중 턴에 스피너 셋이 한꺼번에
      // 돈다(리뷰가 찾은 것) — 무엇이 도는지는 상태 줄이 이미 말한다.
      store({
        a1: [
          use(1, 't1', 'Bash', { command: 'pnpm test' }),
          text(2, '고칩니다'),
          use(3, 't2', 'Edit', { file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' })
        ]
      })
      const { container } = renderRuns([makeRun({ id: 'a1', status: 'running', startedAt: 0 })])
      await userEvent.click(screen.getByRole('button', { name: '자세히' }))
      await userEvent.click(screen.getByRole('button', { name: /1 셸 사용됨/ }))
      expect(container.querySelectorAll('.tl-head .turn-spinner')).toHaveLength(0)
      expect(container.querySelectorAll('.turn-status .turn-spinner')).toHaveLength(1)
      expect(container.querySelectorAll('.tl-tool .turn-spinner')).toHaveLength(1)
      expect(container.querySelectorAll('.turn-spinner')).toHaveLength(2)
    })

    /** 실패한 도구 (FR-17) */
    describe('실패한 도구', () => {
      it('묶음을 끊고 제자리에 따로 서며, 펼치면 오류 문구다', async () => {
        store({
          a1: [
            use(1, 't1', 'Read', { file_path: '/repo/a.ts' }), result(2, 't1'),
            use(3, 't2', 'Bash', { command: 'pnpm lint' }), resultWith(4, 't2', 'lint 오류 3건', false),
            use(5, 't3', 'Read', { file_path: '/repo/b.ts' }), result(6, 't3')
          ]
        })
        const { container } = renderRuns([makeRun({ id: 'a1', resultText: '답' })])
        await expand()
        expect(sections(container.querySelector('.turn')!)).toEqual([
          'turn-user', 'tl-activity', 'tl-tool-error', 'tl-activity', 'turn-answer', 'turn-foot'
        ])
        const failed = container.querySelector<HTMLElement>('.tl-tool-error')!
        expect(failed).toHaveTextContent('셸 pnpm lint 실패')
        // 꺾쇠는 "실패" 바로 뒤다 — 묶음·도구 줄과 같은 자리(spec §8의 5). 배치는 CSS(`.tl-failed`가
        // 오른쪽으로 밀리지 않는다)가 하고, 여기서는 순서를 본다.
        const line = within(failed).getByRole('button')
        expect([...line.children].map((child) => child.getAttribute('class')!.split(' ')[0]))
          .toEqual(['tl-label', 'tl-sub', 'tl-failed', 'tl-chevron'])
        expect(screen.queryByText('lint 오류 3건')).toBeNull()
        await userEvent.click(within(failed).getByRole('button'))
        expect(within(failed).getByText('lint 오류 3건')).toBeInTheDocument()
      })

      it('실패한 편집은 편집 블록이 아니다 — 일어나지 않은 변경이다', async () => {
        store({ a1: [use(1, 't1', 'Edit', EDIT), resultWith(2, 't1', 'old_string을 찾지 못했습니다', false)] })
        const { container } = renderRuns([makeRun({ id: 'a1', resultText: '답' })])
        await expand()
        expect(container.querySelector('.tl-edit')).toBeNull()
        expect(container.querySelector('.tl-tool-error')).toHaveTextContent('편집 src/a.ts 실패')
      })
    })

    /** 편집 (FR-18) */
    describe('편집', () => {
      it('파일 줄은 상대 경로와 +N −M이고, 펼치면 부호 칸이 붙은 diff다', async () => {
        store({ a1: [use(1, 't1', 'Edit', EDIT), result(2, 't1')] })
        const { container } = renderRuns([makeRun({ id: 'a1', resultText: '답' })])
        await expand()
        const block = container.querySelector<HTMLElement>('.tl-edit')!
        expect(block).toHaveTextContent('편집 · 파일 1개')
        const file = within(block).getByRole('button', { name: /src\/a\.ts/ })
        expect(file).toHaveTextContent('+1 −1')
        expect(file).not.toHaveTextContent('새로 씀')
        // 경로는 모노다(spec §8의 7). 꺾쇠는 파일 줄에서만 오른쪽 끝 — `+N −M` 곁이다(§8의 5).
        expect(within(file).getByText('src/a.ts')).toHaveClass('tl-path', 'path-text')
        expect(file.lastElementChild).toHaveClass('tl-chevron')
        expect(file.lastElementChild!.previousElementSibling).toHaveClass('tl-stat')
        await userEvent.click(file)
        const lines = [...block.querySelectorAll('.tl-line')].map((line) => [line.classList[1], line.textContent])
        expect(lines).toEqual([['tl-del', '−a < b'], ['tl-add', '+a <= b']])
      })

      it('같은 파일의 편집 둘은 한 줄에 hunk 둘로 합치고 사이에 구분선을 둔다', async () => {
        store({
          a1: [
            use(1, 't1', 'Edit', EDIT), result(2, 't1'),
            use(3, 't2', 'Edit', { ...EDIT, old_string: 'x', new_string: 'y' }), result(4, 't2')
          ]
        })
        const { container } = renderRuns([makeRun({ id: 'a1', resultText: '답' })])
        await expand()
        const block = container.querySelector<HTMLElement>('.tl-edit')!
        expect(block).toHaveTextContent('편집 · 파일 1개')
        await userEvent.click(within(block).getByRole('button', { name: /src\/a\.ts/ }))
        expect(block.querySelectorAll('.tl-hunk')).toHaveLength(2)
      })

      it('Write는 새로 씀이다', async () => {
        store({ a1: [use(1, 't1', 'Write', { file_path: '/repo/new.ts', content: 'x\ny\n' }), result(2, 't1')] })
        renderRuns([makeRun({ id: 'a1', resultText: '답' })])
        await expand()
        const file = screen.getByRole('button', { name: /new\.ts/ })
        expect(file).toHaveTextContent('새로 씀')
        expect(file).toHaveTextContent('+2 −0')
      })

      it('모양을 모르는 편집은 경로만이다 — 펼칠 것이 없다', async () => {
        store({ a1: [use(1, 't1', 'NotebookEdit', { notebook_path: '/repo/a.ipynb', new_source: 'x' }), result(2, 't1')] })
        const { container } = renderRuns([makeRun({ id: 'a1', resultText: '답' })])
        await expand()
        const file = screen.getByText('a.ipynb').closest<HTMLElement>('.tl-file')!
        expect(file.tagName).not.toBe('BUTTON')
        expect(file).not.toHaveTextContent('+')
        expect(container.querySelector('.tl-edit button')).toBeNull()
      })

      it('경로를 모르는 편집의 파일 줄은 모노가 아니다 — 경로 대신 부제나 라벨이다', async () => {
        // `patch {patchText}`는 경로가 없어 파일 줄에 라벨("패치")이 선다(FR-7 다듬음). 그것은 경로가 아니다.
        store({ a1: [use(1, 't1', 'patch', { patchText: '*** Begin Patch' }), result(2, 't1')] })
        renderRuns([makeRun({ id: 'a1', resultText: '답' })])
        await expand()
        expect(screen.getByText('패치', { selector: '.tl-path' })).not.toHaveClass('path-text')
      })

      it('400줄을 넘으면 자르고 몇 줄 더인지 알린다 — +N은 자르기 전 수다', async () => {
        const content = Array.from({ length: 450 }, (_, i) => `줄 ${i}`).join('\n')
        store({ a1: [use(1, 't1', 'Write', { file_path: '/repo/big.ts', content }), result(2, 't1')] })
        const { container } = renderRuns([makeRun({ id: 'a1', resultText: '답' })])
        await expand()
        const file = screen.getByRole('button', { name: /big\.ts/ })
        expect(file).toHaveTextContent('+450 −0')
        await userEvent.click(file)
        expect(container.querySelectorAll('.tl-line')).toHaveLength(400)
        expect(screen.getByText('… 50줄 더')).toBeInTheDocument()
      })
    })
  })

  /**
   * 예약 (`docs/sdlc/conversation-timeline/` spec FR-30). 규칙은 **뿌리가 아닌 pending**이다 —
   * 이어 보낸 지시는 대화록이 아니라 입력칸 위 칩이 그리고, 시작된 뒤에야 대화록에 나타난다.
   * 새 대화의 첫 지시가 슬롯을 기다리는 것은 대화록에 남는다(§6 우려 1): 그것까지 빼면 대화록이
   * 비어 무엇이 걸려 있는지 보이지 않는다.
   */
  describe('예약', () => {
    it('이어 보낸 지시(뿌리가 아닌 pending)는 대화록에 없다 — 입력칸 위 칩이 맡는다', () => {
      const { container } = renderRuns([
        makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'pending', userPrompt: '예약된 말' }),
        makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'running', startedAt: 1 })
      ])
      expect(container.querySelectorAll('.turn')).toHaveLength(1)
      expect(screen.queryByText('예약된 말')).toBeNull()
      expect(screen.queryByText('대기 중')).toBeNull()
    })

    it('시작되면 대화록에 나타난다 — 접힌 채로', () => {
      const runs = (status: 'pending' | 'running') => groupConversations([
        makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status, startedAt: status === 'running' ? 5 : null, userPrompt: '예약된 말' }),
        makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'succeeded', resultText: '첫 답' })
      ])[0]!
      const props = { onCancel: vi.fn(), onResend: vi.fn(), onAnswer: vi.fn() }
      const { rerender } = render(<Transcript conversation={runs('pending')} {...props} />)
      expect(screen.queryByText('예약된 말')).toBeNull()

      rerender(<Transcript conversation={runs('running')} {...props} />)
      expect(screen.getByText('예약된 말', { selector: '.turn-user' })).toBeInTheDocument()
      expect(useRunEventsMock).not.toHaveBeenCalled()
    })

    it('첫 지시가 슬롯을 기다리면 대화록에 남고, 대기 상태 줄에서 거둘 수 있다', async () => {
      const { container, onCancel } = renderRuns([
        makeRun({ id: 'a1', status: 'pending', userPrompt: '첫 지시' })
      ])
      const turn = container.querySelector('.turn')!
      expect(sections(turn)).toEqual(['turn-user', 'turn-status', 'turn-foot'])
      const status = turn.querySelector<HTMLElement>('.turn-status')!
      expect(status).toHaveTextContent('대기 중')
      expect(status).toHaveTextContent('실행 슬롯이 비면 시작합니다')
      // 아직 아무것도 하지 않는다 — 도는 스피너와 멈추기는 없다.
      expect(status.querySelector('.turn-spinner')).toBeNull()
      expect(screen.queryByRole('button', { name: '실행 중인 턴 멈추기' })).toBeNull()
      expect(within(turn.querySelector<HTMLElement>('.turn-foot')!).getByText('대기 중')).toHaveClass('status-pending')

      await userEvent.click(within(status).getByRole('button', { name: '대기 취소' }))
      expect(onCancel).toHaveBeenCalledWith('a1')
    })
  })

  it('실행 중인 턴을 상태 줄에서 멈출 수 있다', async () => {
    // 예전에는 대기 중인 턴에만 버튼이 있어, 예약이 걸린 대화에서는 실행 중인 턴을
    // 멈출 곳이 없었다 (`docs/sdlc/conversation-fixes/` spec FR-11). 예약은 이제 대화록에
    // 없다 — 거두는 것은 입력칸 위 칩의 `예약 취소`다(spec FR-30).
    const { onCancel } = renderRuns([
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'pending', userPrompt: '예약된 말' }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'running', startedAt: 1 })
    ])

    await userEvent.click(screen.getByRole('button', { name: '실행 중인 턴 멈추기' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledWith('a1')
  })

  it('끝난 턴에는 멈추기 버튼이 없다', () => {
    renderRuns([makeRun({ id: 'a1', status: 'succeeded', resultText: '답변' })])
    expect(screen.queryByRole('button', { name: '실행 중인 턴 멈추기' })).toBeNull()
  })

  it('답변 필요 배지를 단다', () => {
    renderRuns([makeRun({ id: 'a1', needsAnswer: true, resultText: '무엇을 할까요?' })])
    expect(screen.getByText('답변 필요')).toBeInTheDocument()
  })

  /** 턴 사이 공지 (FR-10·FR-19) */
  describe('턴 사이 공지', () => {
    it('모델이 바뀐 턴의 버블 위에 가운데 한 줄로 선다', () => {
      const { container } = renderRuns([
        makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, model: 'opus', userPrompt: '둘째' }),
        makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, model: 'sonnet', userPrompt: '첫째' })
      ])
      const turns = container.querySelectorAll('.turn')
      expect(turns[0]!.querySelector('.turn-notice')).toBeNull()
      expect(sections(turns[1]!).slice(0, 2)).toEqual(['turn-notice', 'turn-user'])
      expect(turns[1]!.querySelector('.turn-notice')).toHaveTextContent('모델 → opus')
    })

    it('조건이 같으면 공지가 없다', () => {
      const { container } = renderRuns([
        makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, model: 'sonnet' }),
        makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, model: 'sonnet' })
      ])
      expect(container.querySelector('.turn-notice')).toBeNull()
    })
  })

  /** 다시 보내기 (FR-43) */
  describe('다시 보내기', () => {
    const session = { externalSessionId: 'sess-1' }

    it.each([
      ['failed', { status: 'failed' as const, startedAt: 1 }],
      ['interrupted', { status: 'interrupted' as const, startedAt: 1 }],
      ['시작된 뒤 취소된 턴', { status: 'canceled' as const, startedAt: 1 }]
    ])('마지막 턴이 %s이면 끝줄에 붙고 누르면 그 턴을 넘긴다', async (_name, over) => {
      const last = makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, userPrompt: '다시 할 말', ...over })
      const { onResend } = renderRuns([
        last,
        makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, ...session })
      ])
      await userEvent.click(screen.getByRole('button', { name: '다시 보내기' }))
      expect(onResend).toHaveBeenCalledTimes(1)
      expect(onResend).toHaveBeenCalledWith(last)
    })

    it('완료된 턴에는 없다', () => {
      renderRuns([makeRun({ id: 'a1', status: 'succeeded', ...session })])
      expect(screen.queryByRole('button', { name: '다시 보내기' })).toBeNull()
    })

    it('시작도 못 하고 취소된 턴에는 없다', () => {
      renderRuns([
        makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'canceled', startedAt: null }),
        makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, ...session })
      ])
      expect(screen.queryByRole('button', { name: '다시 보내기' })).toBeNull()
    })

    it('마지막 턴에만 붙는다 — 지난 실패는 이미 다음 턴으로 넘어갔다', () => {
      renderRuns([
        makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'succeeded', ...session }),
        makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'failed', startedAt: 1 })
      ])
      expect(screen.queryByRole('button', { name: '다시 보내기' })).toBeNull()
    })

    it('대화에 세션이 하나도 없으면 없다 — resume이 또 실패하는 턴을 쌓는다', () => {
      renderRuns([makeRun({ id: 'a1', status: 'failed', startedAt: 1, externalSessionId: null })])
      expect(screen.queryByRole('button', { name: '다시 보내기' })).toBeNull()
    })

    it('예약이 있으면 비활성이다 — 대화당 예약은 하나다', () => {
      // 1턴이 실패로 끝났는데 이어 보낸 지시가 슬롯을 기다리는 중이다. 예약은 대화록의
      // 마지막 턴이 아니다(입력부의 몫이다) — 그래서 버튼은 1턴에 붙되 잠긴다.
      renderRuns([
        makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'pending' }),
        makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'failed', startedAt: 1, ...session })
      ])
      expect(screen.getByRole('button', { name: '다시 보내기' })).toBeDisabled()
    })

    it('보내는 동안과 보낸 뒤에는 다시 눌리지 않는다 — 실패하면 풀린다', async () => {
      let settle: (ok: boolean) => void = () => {}
      const onResend = vi.fn(() => new Promise<boolean>((resolve) => { settle = resolve }))
      renderRuns([makeRun({ id: 'a1', status: 'failed', startedAt: 1, ...session })], { onResend })

      const button = screen.getByRole('button', { name: '다시 보내기' })
      await userEvent.click(button)
      expect(button).toBeDisabled()
      await userEvent.click(button)
      expect(onResend).toHaveBeenCalledTimes(1)

      settle(false)
      await vi.waitFor(() => expect(button).toBeEnabled())
    })

    it('나간 뒤에도 풀지 않는다 — 새 턴이 목록에 닿기 전에 같은 지시가 또 나가면 안 된다', async () => {
      const onResend = vi.fn().mockResolvedValue(true)
      renderRuns([makeRun({ id: 'a1', status: 'failed', startedAt: 1, ...session })], { onResend })

      const button = screen.getByRole('button', { name: '다시 보내기' })
      await userEvent.click(button)
      await vi.waitFor(() => expect(onResend).toHaveBeenCalledTimes(1))
      // 약속이 풀린 뒤까지 기다린다 — 풀리는 코드가 있다면 이 사이에 돈다.
      await act(async () => { await Promise.resolve() })
      expect(button).toBeDisabled()
    })
  })

  /** 답하기 (FR-44) */
  describe('답하기', () => {
    it('마지막 턴이 답변 필요면 끝줄에 붙고 누르면 입력칸으로 보낸다', async () => {
      const { onAnswer } = renderRuns([makeRun({ id: 'a1', needsAnswer: true, resultText: '무엇을 할까요?' })])
      await userEvent.click(screen.getByRole('button', { name: '답하기' }))
      expect(onAnswer).toHaveBeenCalledTimes(1)
    })

    it('지난 턴의 답변 필요에는 없다 — 이미 답했다', () => {
      renderRuns([
        makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'succeeded' }),
        makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, needsAnswer: true })
      ])
      expect(screen.queryByRole('button', { name: '답하기' })).toBeNull()
    })

    it('입력칸이 아직 배선되지 않았으면 그리지 않는다', () => {
      renderRuns([makeRun({ id: 'a1', needsAnswer: true })], { onAnswer: undefined })
      expect(screen.queryByRole('button', { name: '답하기' })).toBeNull()
    })

    it('예약이 있으면 잠긴다 — 보낸 답이 이미 예약으로 걸려 있다 (FR-43 다듬음)', async () => {
      // 답을 보낸 뒤 그것이 슬롯을 기다리는 동안이다. 예약은 대화록의 마지막 턴이 아니므로 버튼은
      // 답변 필요 턴에 남되, 잠긴 입력칸으로 포커스만 보내는 버튼이 되면 안 된다.
      const { onAnswer } = renderRuns([
        makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'pending' }),
        makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, needsAnswer: true, resultText: '무엇을 할까요?' })
      ])
      const answer = screen.getByRole('button', { name: '답하기' })
      expect(answer).toBeDisabled()
      await userEvent.click(answer)
      expect(onAnswer).not.toHaveBeenCalled()
    })
  })

  /** 메타 조각 (FR-11) — 실행 정보(`docs/sdlc/run-info/`)의 정확한 수치는 title로 읽는다 */
  describe('메타 조각', () => {
    const full = {
      model: 'claude-opus-5[1m]', inputTokens: 12431, outputTokens: 1203,
      cacheReadTokens: 15428, cacheWriteTokens: 37917, reasoningTokens: 0,
      costUsd: 0.386994, contextTokens: 53347, contextWindow: 1000000
    }

    function renderMeta(over: Partial<Run>) {
      const { container } = renderRuns([
        makeRun({ id: 'a1', resultText: '했습니다', startedAt: 1_000, endedAt: 23_000, ...over })
      ])
      return container.querySelector<HTMLElement>('.turn-meta')
    }

    it('agent · 모델 · 소요 시간 · effort · 권한을 조각으로 보여준다', () => {
      const row = renderMeta({ model: 'sonnet', effort: 'high', usage: full })!
      expect([...row.children].map((piece) => piece.textContent)).toEqual([
        'Claude Code', 'claude-opus-5[1m]', '22초', 'effort high', '편집 허용'
      ])
    })

    it('정확한 수치와 비용은 호버로 읽는다 — 화면에 돈을 띄우지 않는다', () => {
      const row = renderMeta({ usage: full })!
      expect(row.getAttribute('title')).toContain('캐시 읽기 15,428')
      expect(row.getAttribute('title')).toContain('$0.3870')
      expect(row.textContent).not.toContain('$')
    })

    it('모르는 조각은 빠진다 — OpenCode는 모델을 모른다', () => {
      const row = renderMeta({ agentKind: 'opencode', usage: { ...full, model: null } })!
      expect(row.textContent).toContain('OpenCode')
      expect(row.textContent).not.toContain('claude')
    })

    it('사용량이 없으면 title이 없다 — 이 기능 이전의 run도 조각은 그린다', () => {
      const row = renderMeta({ usage: null })!
      expect(row).toHaveTextContent('Claude Code')
      expect(row.hasAttribute('title')).toBe(false)
    })

    it('보기 전용이다 — 조각 안에 버튼이 없다', () => {
      const row = renderMeta({ usage: full })!
      expect(within(row).queryAllByRole('button')).toEqual([])
    })

    it('진행 중이면 시간은 상태 줄에서만 흐른다 — 끝줄은 시간을 말하지 않는다 (spec §8의 3)', () => {
      // 상태 줄 "작업 중 · 5초"와 끝줄 "… · 5초 · …"가 한 턴에 시간을 두 번 보였다(결정 2026-09-27).
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
      vi.setSystemTime(50_000)
      const { container } = renderRuns([
        makeRun({ id: 'a1', status: 'running', startedAt: 45_000, endedAt: null })
      ])
      const row = container.querySelector<HTMLElement>('.turn-meta')!
      const status = container.querySelector<HTMLElement>('.turn-status')!
      expect(row).toHaveTextContent('Claude Code')
      expect(row).not.toHaveTextContent(/초/)
      expect(status).toHaveTextContent('5초')

      // 1초마다 다시 그린다 (useNow).
      act(() => { vi.advanceTimersByTime(3_000) })
      expect(status).toHaveTextContent('8초')
      expect(row).not.toHaveTextContent(/초/)
    })

    it('끝난 턴의 시간은 멈춰 있다 — 끝난 시각까지다', () => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
      vi.setSystemTime(90_000)
      const row = renderMeta({ status: 'succeeded', startedAt: 45_000, endedAt: 50_000 })!
      expect(row).toHaveTextContent('5초')
      act(() => { vi.advanceTimersByTime(3_000) })
      expect(row).toHaveTextContent('5초')
    })

    it('예약에는 조각이 없다 — 예약은 대화록에 그리지 않는다(FR-30)', () => {
      const { container } = renderRuns([
        makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'pending', usage: full }),
        makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'succeeded', usage: null })
      ])
      expect(container.querySelectorAll('.turn-meta')).toHaveLength(1)
    })
  })
})
