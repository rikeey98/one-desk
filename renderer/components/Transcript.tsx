import { useState } from 'react'
import { RunLog } from './RunLog'
import { useRunEvents } from '../hooks/useRunEvents'
import type { Conversation } from '../conversation'
import type { Run } from '@shared/models'
import { usagePieces, usageTitle } from '../usage'

/**
 * 실행 중인 턴을 멈추는 버튼의 접근성 이름 (`docs/sdlc/conversation-fixes/` spec FR-11).
 * 대화록의 버튼과 도크 헤더의 버튼이 **같은 턴을 겨눌 때 같은 이름**을 쓴다 — 이름이 곧
 * 겨누는 턴이다. 예약의 "취소"와 부분 일치로도 겹치지 않게 "취소"를 넣지 않았다.
 */
export const STOP_RUNNING_TURN = '실행 중인 턴 멈추기'

/**
 * 한 턴의 로그. **펼쳐졌을 때만 마운트한다** — 접힌 턴까지 훅을 걸면 대화를
 * 열 때마다 모든 턴의 로그 파일을 읽는다 (설계 §4-1).
 */
function TurnLog({ runId }: { runId: string }) {
  const { events, error } = useRunEvents(runId)
  return (
    <>
      {error && <div role="alert" className="form-error">{error}</div>}
      <RunLog events={events} />
    </>
  )
}

function Turn({ run, onCancel }: { run: Run; onCancel: (runId: string) => void }) {
  // **모든 턴이 접힌 채로 시작한다 — 진행 중이어도 마찬가지다.** 대화 설계는 진행
  // 중인 턴만 펼쳐 두었지만(§4-1), 사용자가 뒤집었다: 도구 호출이 흐르면 대화록이
  // 그것으로 가득 차 지시와 답변이 밀려난다. 펼치고 접는 것은 전부 사용자가 정하고,
  // 상태가 바뀐다고 그 선택을 되돌리지 않는다 — 그래서 여기에 effect가 없다.
  const [open, setOpen] = useState(false)

  if (run.status === 'pending') {
    return (
      <div className="turn turn-pending">
        <div className="turn-user">{run.userPrompt}</div>
        <div className="turn-meta">
          <span>대기 중</span>
          <button type="button" onClick={() => onCancel(run.id)}>취소</button>
        </div>
      </div>
    )
  }

  // 이 턴이 무엇으로 돌았고 얼마나 썼는지 (docs/sdlc/run-info/). 조각이 하나도
  // 없으면 줄을 그리지 않는다 — 이 기능 이전의 run은 화면이 이전과 같다(FR-2).
  const pieces = usagePieces(run.usage)

  return (
    <div className="turn">
      <div className="turn-user">{run.userPrompt}</div>
      {pieces.length > 0 && (
        // 보기 전용이다(FR-4). 정확한 수치와 비용은 title로 읽는다.
        <div className="turn-info" title={usageTitle(run.usage) ?? undefined}>
          {pieces.map((piece) => <span key={piece}>{piece}</span>)}
        </div>
      )}
      {run.errorMessage && <div role="alert" className="form-error">{run.errorMessage}</div>}
      {run.resultText && <div className="turn-answer">{run.resultText}</div>}
      <div className="turn-meta">
        <span className={`status status-${run.status}`}>{run.status}</span>
        {/* succeeded로 끝나도 agent가 질문하고 멈춘 것일 수 있다. */}
        {run.needsAnswer && <span className="needs-answer">답변 필요</span>}
        {/* 실행 중인 턴도 그 자리에서 멈춘다 (`docs/sdlc/conversation-fixes/` spec FR-11).
            예약이 걸린 대화에서 도크 헤더의 취소만으로는 어느 턴이 멈추는지 보이지 않는다.
            **접근성 이름으로 예약의 "취소"와 갈린다.** 이름에 "취소"를 넣지 않은 것은 e2e의
            부분 일치가 예약 버튼과 함께 잡지 않게 하려는 것이다. 반대로 "실행"은 들어 있으므로
            실행 버튼은 지금처럼 `{ name: '실행', exact: true }`로만 잡아야 한다(CLAUDE.md). */}
        {run.status === 'running' && (
          <button
            type="button"
            className="turn-stop"
            aria-label={STOP_RUNNING_TURN}
            onClick={() => onCancel(run.id)}
          >
            멈추기
          </button>
        )}
        <button type="button" onClick={() => setOpen(!open)}>
          {open ? '접기' : '자세히'}
        </button>
      </div>
      {open && <TurnLog runId={run.id} />}
    </div>
  )
}

export function Transcript({
  conversation, onCancel
}: {
  conversation: Conversation
  onCancel: (runId: string) => void
}) {
  return (
    <div className="transcript">
      {conversation.runs.map((run) => (
        <Turn key={run.id} run={run} onCancel={onCancel} />
      ))}
    </div>
  )
}
