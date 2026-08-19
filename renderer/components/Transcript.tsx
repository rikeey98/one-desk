import { useEffect, useState } from 'react'
import { RunLog } from './RunLog'
import { useRunEvents } from '../hooks/useRunEvents'
import type { Conversation } from '../conversation'
import type { Run } from '@shared/models'

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
  const live = run.status === 'running'
  // 진행 중인 턴은 처음부터 펼쳐져 있다. 지난 턴은 접혀 있다.
  const [open, setOpen] = useState(live)

  // useState의 초기값은 마운트 때 한 번만 평가된다. 예약된 턴은 pending으로
  // 먼저 마운트되므로 open=false로 굳고, 앞 턴이 끝나 running으로 전이해도
  // (같은 key={run.id}라 재마운트가 없다) 접힌 채로 남는다 — 헤드라인
  // 시나리오(예약 → 자동 전송)에서 "다음 턴이 나갔는데 화면이 안 움직인다"로
  // 보인다. status가 실제로 running이 될 때만 강제로 펼치고, 사용자가 실행
  // 중에 손으로 접은 것은 다시 펼치지 않는다(deps가 run.status라 open 자체가
  // 바뀌어도 이 effect는 다시 돌지 않는다).
  useEffect(() => {
    if (run.status === 'running') setOpen(true)
  }, [run.status])

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

  return (
    <div className="turn">
      <div className="turn-user">{run.userPrompt}</div>
      {run.errorMessage && <div role="alert" className="form-error">{run.errorMessage}</div>}
      {run.resultText && <div className="turn-answer">{run.resultText}</div>}
      <div className="turn-meta">
        <span className={`status status-${run.status}`}>{run.status}</span>
        {/* succeeded로 끝나도 agent가 질문하고 멈춘 것일 수 있다. */}
        {run.needsAnswer && <span className="needs-answer">답변 필요</span>}
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
