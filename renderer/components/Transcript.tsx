import { useCallback, useMemo, useRef, useState } from 'react'
import { Markdown } from './Markdown'
import { CopyButton } from './CopyButton'
import { TimelineBlocks, ToolName } from './TimelineBlocks'
import { IconArrowDown } from './icons'
import { useRunEvents, useRunEventSnapshot } from '../hooks/useRunEvents'
import { useNow } from '../hooks/useNow'
import { useFollowBottom } from '../hooks/useFollowBottom'
import {
  formatDuration, metaPieces, projectTurn, switchNotice, type ToolItem, type TurnSummary
} from '../timeline'
import { RUN_STATUS_LABELS } from '../runStatus'
import { usageTitle } from '../usage'
import type { Conversation } from '../conversation'
import type { Run } from '@shared/models'
import type { RunEvent } from '@shared/events'

/**
 * 실행 중인 턴을 멈추는 버튼의 접근성 이름 (`docs/sdlc/conversation-fixes/` spec FR-11).
 * 이름이 곧 겨누는 턴이다 — 예약의 `예약 취소`·첫 지시의 `대기 취소`와 부분 일치로도 겹치지
 * 않게 "취소"를 넣지 않았다. 도크 헤더의 같은 버튼은 없어졌다(`docs/sdlc/conversation-timeline/`
 * spec FR-29 — 입력부의 `중지`가 그 자리를 맡는다).
 */
const STOP_RUNNING_TURN = '실행 중인 턴 멈추기'

/**
 * 이 턴이 **예약**인가 — 뿌리가 아닌 pending, 곧 앞 턴이 도는 동안 이어 보낸 지시다
 * (`docs/sdlc/conversation-timeline/` spec FR-30). 예약은 대화록에 그리지 않고 입력칸 위 칩이
 * 그린다(intent D3). **뿌리 pending은 예약이 아니다** — 새 대화의 첫 지시가 슬롯을 기다리는
 * 것까지 빼면 대화록이 비어 무엇이 걸려 있는지 보이지 않는다(§6 우려 1). 대화록과 입력부가 같은
 * 판정을 쓰도록 여기 한 곳에 둔다.
 */
function isReservation(run: Run, conversationId: string): boolean {
  return run.status === 'pending' && run.id !== conversationId
}

/** 이 대화의 예약. 대화당 예약은 하나다(설계 §3-2) — 없으면 null. */
export function reservationOf(conversation: Conversation): Run | null {
  return conversation.runs.find((r) => isReservation(r, conversation.id)) ?? null
}

/**
 * 접힌 턴의 활동 요약 한 줄 (`docs/sdlc/conversation-events/` spec FR-51) —
 * `도구 7회 · 실패 1 · 권한 거부 1 · 대화 압축됨`. 0인 조각은 빠진다 — 도구가 0이어도 압축·거부가
 * 있으면 그 조각만이다. 도구 수는 메인 스레드의 것이다(하위 에이전트 카드는 하나로 센다, FR-39).
 */
function summaryText(summary: TurnSummary): string {
  return [
    summary.tools > 0 ? `도구 ${summary.tools}회` : null,
    summary.failed > 0 ? `실패 ${summary.failed}` : null,
    summary.denied > 0 ? `권한 거부 ${summary.denied}` : null,
    summary.compacted ? '대화 압축됨' : null
  ].filter((piece): piece is string => piece !== null).join(' · ')
}

function pieceText(item: ToolItem): string {
  return item.subtitle ? `${item.label} ${item.subtitle}` : item.label
}

/** 도구 한 조각 — 라벨(굵게) · 부제. mcp 이름은 모노, 경로 부제도 모노다(spec §8의 5·7). */
function ToolPiece({ item }: { item: ToolItem }) {
  return (
    <>
      <strong><ToolName label={item.label} category={item.category} /></strong>
      {item.subtitle && (
        <>
          {' '}
          <span className={item.subtitlePath ? 'path-text' : undefined}>{item.subtitle}</span>
        </>
      )}
    </>
  )
}

/**
 * 진행 중인 턴의 상태 줄 (FR-12의 2) — 스피너 · 작업 중 · 경과 시간 · 지금 도는 도구 · 멈추기.
 *
 * **live region이 아니다**(NFR-4) — 경과 시간이 1초마다 읽히면 안 된다. 지금 도는 도구는
 * OpenCode에서 늘 없다(도구를 끝난 뒤에 보고한다, spec FR-9) — 그때는 시간만 남는다.
 *
 * 도구 자리에는 (events FR-51) API를 **재시도하는 중이면** 그 문구가 선다 — 왜 멈춰 있는지가 도는
 * 도구보다 먼저다. 지금 도는 것이 **하위 에이전트면** 그 카드 안에서 도는 도구까지 `›`로 잇는다.
 */
function StatusLine({ run, now, current, currentChild, retrying, onCancel }: {
  run: Run
  now: number
  current: ToolItem | null
  currentChild: ToolItem | null
  retrying: string | null
  onCancel: (runId: string) => void
}) {
  // 잘려도 전체는 title로 읽는다. 하위 에이전트면 안에서 도는 도구까지다.
  const toolTitle = current === null ? undefined
    : currentChild === null ? current.subtitle || undefined
    : `${pieceText(current)} › ${pieceText(currentChild)}`
  return (
    <div className="turn-status">
      <span className="turn-spinner" aria-hidden="true" />
      <span className="turn-status-piece">작업 중</span>
      {run.startedAt !== null && (
        <span className="turn-status-piece">{formatDuration(now - run.startedAt)}</span>
      )}
      {retrying !== null ? (
        <span className="turn-status-piece turn-status-tool" title={retrying}>{retrying}</span>
      ) : current && (
        <span className="turn-status-piece turn-status-tool" title={toolTitle}>
          <ToolPiece item={current} />
          {currentChild && <>{' › '}<ToolPiece item={currentChild} /></>}
        </span>
      )}
      {/* 실행 중인 턴도 그 자리에서 멈춘다 (`docs/sdlc/conversation-fixes/` spec FR-11).
          **접근성 이름으로 예약의 "취소"와 갈린다.** 이름에 "취소"를 넣지 않은 것은 e2e의
          부분 일치가 예약 버튼과 함께 잡지 않게 하려는 것이다. 반대로 "실행"은 들어 있으므로
          실행 버튼은 지금처럼 `{ name: '실행', exact: true }`로만 잡아야 한다(CLAUDE.md). */}
      <button
        type="button"
        className="turn-stop"
        aria-label={STOP_RUNNING_TURN}
        onClick={() => onCancel(run.id)}
      >
        멈추기
      </button>
    </div>
  )
}

/**
 * 슬롯을 기다리는 첫 지시의 상태 줄 (FR-12의 2, FR-30) — 대기 중 · 실행 슬롯이 비면 시작합니다 ·
 * 대기 취소. 아직 아무것도 하지 않으므로 스피너가 없다(FR-49 — 움직임은 도는 것에만).
 * 이어 보낸 지시(예약)는 여기가 아니라 입력칸 위 칩이다.
 */
function WaitingLine({ run, onCancel }: { run: Run; onCancel: (runId: string) => void }) {
  return (
    <div className="turn-status">
      <span className="turn-status-piece">대기 중</span>
      <span className="turn-status-piece">실행 슬롯이 비면 시작합니다</span>
      <button type="button" className="turn-stop" onClick={() => onCancel(run.id)}>
        대기 취소
      </button>
    </div>
  )
}

/**
 * 같은 대화에 같은 조건으로 다시 보낼 수 있는 턴인가 (FR-43). 시작도 못 하고 취소된 턴은
 * 아니다 — 그것은 사용자가 거둔 지시다.
 */
function isRetryable(run: Run): boolean {
  return run.status === 'failed' || run.status === 'interrupted'
    || (run.status === 'canceled' && run.startedAt !== null)
}

interface TurnProps {
  run: Run
  /** 바로 앞 턴. 첫 턴이면 null — 공지(FR-10)를 여기서 가른다 */
  prev: Run | null
  /** 대화록의 마지막 턴인가 — 다시 보내기·답하기는 여기에만 붙는다 */
  last: boolean
  /** 대화의 어느 턴이든 세션이 있는가 — 없으면 resume이 또 실패하는 턴을 쌓는다 */
  hasSession: boolean
  /** 대화에 예약이 있는가 — 대화당 예약은 하나다(설계 §3-2) */
  reserved: boolean
  onCancel: (runId: string) => void
  onResend: (run: Run) => Promise<boolean>
  onAnswer?: () => void
}

/** 턴의 몸통이 받는 것 — 펼침 state는 전부 `Turn`이 쥐고 내려 준다. */
interface BodyProps extends Omit<TurnProps, 'prev' | 'onResend'> {
  open: boolean
  onToggleOpen: () => void
  /** 열어 둔 열림 키 (FR-15) — 도구 id에 매단다(`TimelineBlocks`의 주석) */
  openKeys: ReadonlySet<string>
  onToggleKey: (keys: readonly string[]) => void
  resending: boolean
  onResend: () => void
}

/**
 * 턴의 버블 아래 전부 — 상태 줄 · (요약 | 블록) · 답 칸 · 오류 카드 · 끝줄.
 *
 * 이벤트는 밖에서 받는다: 접힌 턴은 스토어 스냅샷, 펼친 턴은 로그 파일까지 되살리는
 * `useRunEvents`(FR-14). 규칙은 전부 투영(timeline.ts)에 있다 — 여기서는 그리기만 한다
 * (FR-1). 이벤트 배열 참조와 run의 네 칸이 같으면 다시 계산하지 않는다(NFR-3).
 */
function TurnBody({ run, events, logError, open, onToggleOpen, openKeys, onToggleKey,
  last, hasSession, reserved, resending, onCancel, onResend, onAnswer }: BodyProps & {
  events: readonly RunEvent[]
  logError: string | null
}) {
  const running = run.status === 'running'
  const now = useNow(running)
  const { status, resultText, errorMessage, cwd, startedAt } = run
  // startedAt은 생각 블록의 시간을 재는 기준이다 (`docs/sdlc/conversation-events/` spec FR-35).
  const { blocks, answer, summary, current, currentChild, retrying, omitted } = useMemo(
    () => projectTurn({ status, resultText, errorMessage, cwd, startedAt }, events),
    [status, resultText, errorMessage, cwd, startedAt, events]
  )
  // 펼친 턴의 진행 중 텍스트는 블록 안에 제자리로 있다 (FR-13) — 답 칸은 끝났을 때만.
  const shownAnswer = answer && (!open || answer.final) ? answer : null
  const title = usageTitle(run.usage)

  return (
    <>
      {running && (
        <StatusLine
          run={run}
          now={now}
          current={current}
          currentChild={currentChild}
          retrying={retrying}
          onCancel={onCancel}
        />
      )}
      {/* 여기까지 오는 pending은 뿌리뿐이다 — 예약은 Transcript가 걸러 입력부로 보낸다(FR-30). */}
      {run.status === 'pending' && <WaitingLine run={run} onCancel={onCancel} />}
      {/* 펼치면 묶음 라벨이 대신한다 (FR-13) — 접힌 턴에만 한 줄 요약이다. */}
      {!open && summary && <div className="turn-summary">{summaryText(summary)}</div>}
      {open && logError && <div role="alert" className="form-error">{logError}</div>}
      {/* 창(`RUN_EVENT_WINDOW`) 때문에 앞이 잘렸다 — 빠진 것이 "없던 일"로 보이면 안 된다
          (`docs/sdlc/conversation-events/` spec FR-52). 첫 이벤트의 seq가 곧 빠진 수다. */}
      {open && omitted > 0 && (
        <div className="tl-omitted">앞의 기록 {omitted.toLocaleString('en-US')}개는 생략했습니다</div>
      )}
      {/* agent 종류는 하위 에이전트 카드가 본다 — OpenCode는 자식의 활동을 보내지 않는다(events FR-49). */}
      {open && (
        <TimelineBlocks blocks={blocks} openKeys={openKeys} onToggle={onToggleKey} agentKind={run.agentKind} />
      )}
      {shownAnswer && (
        <div className="turn-answer">
          <Markdown text={shownAnswer.text} />
        </div>
      )}
      {run.errorMessage && <div role="alert" className="form-error">{run.errorMessage}</div>}
      <div className="turn-foot">
        <span className={`status status-${run.status}`}>{RUN_STATUS_LABELS[run.status]}</span>
        {/* succeeded로 끝나도 agent가 질문하고 멈춘 것일 수 있다. */}
        {run.needsAnswer && <span className="needs-answer">답변 필요</span>}
        {/* 이 턴이 무엇으로 돌았는지 (FR-11). 보기 전용이다 — 정확한 토큰과 비용은 title로
            읽는다: 화면에 돈을 상시 띄우지 않는다(run-info FR-4). 도는 동안은 시간 조각이 없다 —
            경과 시간은 상태 줄이 말한다(spec §8의 3). */}
        <span className="turn-meta" title={title ?? undefined}>
          {metaPieces(run).map((piece, i) => <span key={i}>{piece}</span>)}
        </span>
        <span className="turn-foot-actions">
          {answer?.final && <CopyButton text={answer.text} label="응답 복사" />}
          {last && hasSession && isRetryable(run) && (
            <button type="button" disabled={reserved || resending} onClick={onResend}>
              다시 보내기
            </button>
          )}
          {last && run.needsAnswer && onAnswer && (
            <button type="button" disabled={reserved} onClick={onAnswer}>답하기</button>
          )}
          <button type="button" onClick={onToggleOpen}>
            {open ? '접기' : '자세히'}
          </button>
        </span>
      </div>
    </>
  )
}

/** 접힌 턴 — 스토어만 본다. 로그 파일을 읽지 않는다 (FR-14, 설계 §4-1). */
function CollapsedBody(props: BodyProps) {
  const events = useRunEventSnapshot(props.run.id)
  return <TurnBody {...props} events={events} logError={null} />
}

/**
 * 펼친 턴 — **펼쳐졌을 때만 마운트한다.** 스토어가 비었으면(앱을 다시 켰다) 로그 파일에서
 * 되살린다. 접힌 턴까지 이 훅을 걸면 대화를 열 때마다 모든 턴의 로그 파일을 읽는다(FR-14).
 * 되살린 이벤트는 같은 스토어에 들어가므로 접어도 활동 요약이 남는다.
 */
function ExpandedBody(props: BodyProps) {
  const { events, error } = useRunEvents(props.run.id)
  return <TurnBody {...props} events={events} logError={error} />
}

function Turn({ run, prev, onResend, ...rest }: TurnProps) {
  // **모든 턴이 접힌 채로 시작한다 — 진행 중이어도 마찬가지다.** 대화 설계는 진행
  // 중인 턴만 펼쳐 두었지만(§4-1), 사용자가 뒤집었다: 도구 호출이 흐르면 대화록이
  // 그것으로 가득 차 지시와 답변이 밀려난다. 펼치고 접는 것은 전부 사용자가 정하고,
  // 상태가 바뀐다고 그 선택을 되돌리지 않는다 — 그래서 여기에 effect가 없다.
  const [open, setOpen] = useState(false)
  // 묶음·도구 한 줄·편집 파일·원문 줄의 펼침 (FR-15). **몸통이 아니라 여기서 쥔다** — 몸통은
  // 턴을 접고 펼 때마다 갈아끼워지므로(접힌 몸통 ↔ 펼친 몸통) 거기 두면 열어 둔 묶음이 전부
  // 닫힌다. 키는 도구 id라 이벤트가 붙어도, 결과가 뒤늦게 실패로 와 묶음이 갈라져도 풀리지
  // 않는다(FR-15 다듬음 — `TimelineBlocks`의 주석).
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(() => new Set())
  // 다시 보내기가 나간 뒤에는 풀지 않는다 — 새 턴이 목록에 닿기 전에 한 번 더 누르면 같은
  // 지시가 예약으로 하나 더 걸린다. 새 턴이 오면 이 턴은 마지막이 아니게 되어 버튼이 사라진다.
  const [resending, setResending] = useState(false)

  // 한 줄의 키 전부를 같이 뒤집는다 — 하나라도 열려 있으면 그 줄은 열린 것이라 전부 닫는다.
  const toggleKey = useCallback((keys: readonly string[]) => {
    setOpenKeys((current) => {
      const next = new Set(current)
      if (keys.some((key) => next.has(key))) for (const key of keys) next.delete(key)
      else for (const key of keys) next.add(key)
      return next
    })
  }, [])

  // 슬롯을 기다리는 첫 지시도 같은 턴이다 — 따로 그리면 시작하는 순간 다른 컴포넌트로 갈아끼워져
  // 사용자가 펼쳐 둔 것이 풀린다. 상태 줄만 대기 모양이다(TurnBody의 WaitingLine).
  const notice = switchNotice(prev, run)

  async function resend() {
    setResending(true)
    if (!(await onResend(run))) setResending(false)
  }

  const body: BodyProps = {
    ...rest,
    run,
    open,
    onToggleOpen: () => setOpen(!open),
    openKeys,
    onToggleKey: toggleKey,
    resending,
    onResend: () => void resend()
  }

  return (
    <div className="turn">
      {/* 턴 사이 공지 (FR-19) — 이 턴에서 요청한 조건이 바뀌었다. 보기 전용이다. */}
      {notice && <div className="turn-notice">{notice}</div>}
      {/* 사람이 친 글은 평문이다 (FR-26) — `*`나 `#`이 뜻을 바꾸면 안 된다. */}
      <div className="turn-user">{run.userPrompt}</div>
      {open ? <ExpandedBody {...body} /> : <CollapsedBody {...body} />}
    </div>
  )
}

export function Transcript({
  conversation, onCancel, onResend, onAnswer
}: {
  conversation: Conversation
  onCancel: (runId: string) => void
  /**
   * 다시 보내기 (FR-43) — 그 턴의 지시·맥락·조건으로 같은 대화에 새 턴을 잇는다.
   * 나갔으면 true다. 실패하면 false를 돌려주고 버튼이 다시 풀린다.
   */
  onResend: (run: Run) => Promise<boolean>
  /**
   * 답하기 (FR-44) — 입력칸에 포커스를 준다(ConversationPanel이 입력부의 ref로 잇는다). 없으면
   * 버튼을 그리지 않는다 — 누를 수 있는데 아무 일도 없는 버튼을 두지 않는다.
   */
  onAnswer?: () => void
}) {
  const { runs } = conversation
  // 예약(뿌리가 아닌 pending)은 대화록에 그리지 않는다 — 입력칸 위 칩의 몫이다(spec FR-30).
  // 시작되면 그때 여기 나타난다. "마지막 턴"도 예약을 빼고 센다: 앞 턴이 실패했는데 이어 보낸
  // 지시가 슬롯을 기다리면 다시 보내기는 그 앞 턴에 붙되 잠긴다.
  const shown = runs.filter((r) => !isReservation(r, conversation.id))
  const lastId = shown[shown.length - 1]?.id ?? null
  const hasSession = runs.some((r) => r.externalSessionId !== null)
  const reserved = runs.some((r) => r.status === 'pending')

  // 바닥 따라가기의 **내용 버전** (spec FR-42) — 턴 수 · 각 턴의 상태 · 답 길이 · 활성 턴의
  // 이벤트. 펼침 여부는 넣지 않는다: 사용자가 펼치거나 접은 것으로는 움직이지 않는다. 이벤트는
  // 수와 마지막 seq를 같이 본다 — 스토어가 run당 2,000개에서 앞을 자르므로 수만으로는 상한에
  // 닿은 뒤 더 오는 줄을 못 본다.
  const activeEvents = useRunEventSnapshot(conversation.active?.id ?? null)
  const version = [
    ...shown.map((r) => `${r.id}:${r.status}:${r.resultText?.length ?? 0}:${r.errorMessage?.length ?? 0}`),
    `${activeEvents.length}:${activeEvents[activeEvents.length - 1]?.seq ?? -1}`
  ].join('|')
  const scroller = useRef<HTMLDivElement>(null)
  const { atBottom, jump } = useFollowBottom(scroller, version)

  return (
    // 스크롤은 대화록만 한다 (FR-41). `최신으로 이동`은 스크롤러의 **형제**다 — 안에 두면 함께
    // 스크롤되고 스크롤러의 overflow에 잘린다.
    <div className="transcript-wrap">
      <div className="transcript" ref={scroller}>
        {shown.map((run, i) => (
          <Turn
            key={run.id}
            run={run}
            prev={shown[i - 1] ?? null}
            last={run.id === lastId}
            hasSession={hasSession}
            reserved={reserved}
            onCancel={onCancel}
            onResend={onResend}
            onAnswer={onAnswer}
          />
        ))}
      </div>
      {!atBottom && (
        <button type="button" className="jump-latest" onClick={jump}>
          <IconArrowDown width="12" height="12" />
          최신으로 이동
        </button>
      )}
    </div>
  )
}
