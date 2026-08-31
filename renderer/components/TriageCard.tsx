import { useState } from 'react'
import {
  SOURCE_ORDER, KIND_ORDER, PRIORITY_ORDER,
  SOURCE_LABELS, KIND_LABELS, PRIORITY_LABELS
} from '../issueAxes'
import type { Issue, IssueSource, IssueKind, IssuePriority } from '@shared/models'

export interface TriagePick {
  source: IssueSource
  kind: IssueKind
  priority: IssuePriority
}

/**
 * 훑기 카드 한 장. 이슈 상세를 여는 바로 그 자리에 뜬다 (설계 §4).
 *
 * **seenAt을 찍지 않는다.** 분류와 열람은 다른 행위다 — 훑어서 `언젠가`로 분류한
 * 이슈는 분류는 됐지만 손대지는 않은 상태이고, 방치 시계는 계속 가야 한다.
 * 축을 찍었다는 이유로 시계가 리셋되면 훑기가 방치를 감추는 도구가 된다.
 */
export function TriageCard({ issue, position, total, onDone, onSkip }: {
  issue: Issue
  /** 1부터 센다 */
  position: number
  total: number
  onDone: (pick: TriagePick) => void
  onSkip: () => void
}) {
  const [source, setSource] = useState<IssueSource | null>(issue.source)
  const [kind, setKind] = useState<IssueKind | null>(issue.kind)
  const [priority, setPriority] = useState<IssuePriority | null>(issue.priority)

  // 셋이 다 찍혀야 넘어간다. 부분만 찍고 넘어가면 triagedAt이 안 찍혀
  // 그 이슈가 대기열에 그대로 남는다 (설계 §3의 파생 규칙과 짝을 이룬다).
  const complete = source !== null && kind !== null && priority !== null

  return (
    <div className="triage-card">
      <div className="triage-position">{total}건 중 {position}번째</div>
      <h3 className="triage-title">{issue.title}</h3>

      <AxisRow label="출처" values={SOURCE_ORDER} labels={SOURCE_LABELS}
        picked={source} onPick={setSource} />
      <AxisRow label="성격" values={KIND_ORDER} labels={KIND_LABELS}
        picked={kind} onPick={setKind} />
      <AxisRow label="급함" values={PRIORITY_ORDER} labels={PRIORITY_LABELS}
        picked={priority} onPick={setPriority} />

      <div className="triage-actions">
        <button type="button" onClick={onSkip}>건너뛰기</button>
        <button
          type="button"
          disabled={!complete}
          onClick={() => { if (complete) onDone({ source, kind, priority }) }}
        >
          다음
        </button>
      </div>
    </div>
  )
}

function AxisRow<T extends string>({ label, values, labels, picked, onPick }: {
  label: string
  values: readonly T[]
  labels: Record<T, string>
  picked: T | null
  onPick: (value: T) => void
}) {
  return (
    <div className="triage-row">
      <span className="triage-row-label">{label}</span>
      {values.map((value) => (
        <button
          key={value}
          type="button"
          className={picked === value ? 'triage-pick triage-picked' : 'triage-pick'}
          aria-pressed={picked === value}
          onClick={() => onPick(value)}
        >
          {labels[value]}
        </button>
      ))}
    </div>
  )
}
