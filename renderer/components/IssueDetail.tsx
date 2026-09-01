import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useClient } from '../client/ClientProvider'
import { useDebouncedSave } from '../hooks/useDebouncedSave'
import { ConflictBanner } from './ConflictBanner'
import { ConfirmButton } from './ConfirmButton'
import {
  PRIORITY_ORDER, SOURCE_ORDER, KIND_ORDER,
  PRIORITY_LABELS, SOURCE_LABELS, KIND_LABELS
} from '../issueAxes'
import type {
  Issue, IssueStatus, IssueSource, IssueKind, IssuePriority
} from '@shared/models'

/**
 * 훑기 축 하나를 고르는 select. 출처/성격/급함이 라벨·순서·값만 다르고 나머지는
 * 완전히 같아서 복붙해 두면 한쪽 핸들러가 실은 다른 축의 setter를 부르는 실수(예:
 * 출처 select가 kind를 쓰는 것)가 타입 체크도 못 잡고 조용히 통과한다 — 뽑아내
 * 그 자리를 아예 없앤다.
 *
 * `TriageCard.tsx`의 `AxisRow`와 같은 목적, 다른 컨트롤이다. `AxisRow`는 버튼
 * 여러 개로 값을 고르고(훑기 카드), 여기는 이미 분류된 값을 상세에서 바꾸는
 * 자리라 드롭다운 하나를 쓴다 — `AxisRow`를 재사용하지 않고 형제로 새로 둔 이유다.
 */
function AxisSelect<T extends string>({ label, value, order, labels, onPick }: {
  label: string
  value: T | null
  order: readonly T[]
  labels: Record<T, string>
  onPick: (value: T) => void
}) {
  return (
    <label className="detail-axis">
      {label}
      <select
        aria-label={label}
        value={value ?? ''}
        onChange={(e) => {
          const next = e.target.value as T | ''
          if (!next) return   // 축을 지우는 길은 만들지 않는다 (설계 §6)
          onPick(next)
        }}
      >
        <option value="">미지정</option>
        {order.map((v) => (
          <option key={v} value={v}>{labels[v]}</option>
        ))}
      </select>
    </label>
  )
}

export function IssueDetail({ issue, onChanged, onDeleted, onRequestClose }: {
  issue: Issue
  /** 목록을 다시 읽게 한다 */
  onChanged: () => void
  onDeleted: () => void
  /** Esc로 접기를 청한다. 대기 중인 저장을 흘려보낸 뒤에만 부른다 (설계 §7). */
  onRequestClose: () => void
}) {
  const client = useClient()
  const [title, setTitle] = useState(issue.title)
  const [body, setBody] = useState(issue.body)
  const [status, setStatus] = useState(issue.status)
  const [source, setSource] = useState(issue.source)
  const [kind, setKind] = useState(issue.kind)
  const [priority, setPriority] = useState(issue.priority)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<Issue | null>(null)
  // 배너 상태를 ref로도 들고 있는다. Esc 경로는 flush를 await한 뒤에 충돌 여부를 봐야
  // 하는데, 그 시점에 핸들러의 클로저가 쥔 conflict는 await 이전 렌더의 값이라 방금
  // 세워진 배너를 보지 못한다. 화면은 state가, 판단은 ref가 맡는다.
  const conflictRef = useRef<Issue | null>(null)
  // 낙관적 잠금의 기대값. **성공한 모든 쓰기가 이것을 갱신한다** (설계 §6).
  //
  // 초기값은 마운트 때 한 번만 읽는다. 항목이 바뀌면 IssuePanel의 key가 이 컴포넌트를
  // 통째로 다시 마운트하므로 여기서 issue를 다시 볼 일이 없다 — 오히려 목록이 갱신될
  // 때마다 버퍼를 초기화하면 타이핑 중에 글자가 되돌아간다.
  const expected = useRef(issue.updatedAt)

  /**
   * 사람이 이 이슈를 열었다는 기록. **마운트 때 한 번만이다.**
   *
   * - 실패해도 삼킨다. 열람 기록은 부수적이고, 이슈를 여는 행위가 이것 때문에
   *   실패하면 안 된다.
   * - **onChanged를 부르지 않는다.** 목록 정렬이 seenAt 오래된 순이라, 여기서
   *   목록을 다시 읽으면 방금 클릭한 항목이 눈앞에서 맨 아래로 도망간다.
   *   반영은 다음 마운트로 미룬다.
   * - issue.id가 바뀌면 IssuePanel의 key가 이 컴포넌트를 통째로 다시 마운트하므로
   *   의존성 배열은 마운트 한 번을 뜻한다.
   */
  useEffect(() => {
    void client.issues.markSeen(issue.id).catch(() => {})
  }, [client, issue.id])

  function showConflict(next: Issue | null) {
    conflictRef.current = next
    setConflict(next)
  }

  async function persist(patch: {
    title?: string; body?: string; status?: IssueStatus
    source?: IssueSource; kind?: IssueKind; priority?: IssuePriority
  }) {
    setError(null)
    const result = await client.issues.updateIfUnchanged({
      id: issue.id, ...patch, expectedUpdatedAt: expected.current
    })
    if (!result.ok) { showConflict(result.current); return }
    expected.current = result.issue.updatedAt
    onChanged()
  }

  /**
   * 상태 변경도 persist를 지난다 (설계 §9가 상태를 상세에 둔 이유).
   *
   * 잠기지 않은 update로 쓰면 그 쓰기가 updatedAt을 올려 이 화면의 기대값만 낡게
   * 만들고, 다음 자동 저장이 사용자 자신의 클릭을 agent의 편집으로 착각해 유령 충돌
   * 배너를 띄운다 — 목록에 있던 상태 버튼이 실제로 그랬다.
   *
   * closedAt은 저장소가 status에서 파생한다. 여기서 넘기지 않는다.
   */
  function changeStatus(next: IssueStatus) {
    setStatus(next)
    void (async () => {
      try { await persist({ status: next }) }
      catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    })()
  }

  /**
   * 훑기 축 편집도 status와 같은 이유로 persist(잠긴 경로)를 탄다 —
   * 잠기지 않은 update로 쓰면 이 화면의 기대값만 낡아 유령 충돌 배너가 뜬다.
   */
  function changeAxis(patch: { source?: IssueSource; kind?: IssueKind; priority?: IssuePriority }) {
    void (async () => {
      try { await persist(patch) }
      catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    })()
  }

  const bodySave = useDebouncedSave(async (value) => {
    // 배너가 떠 있으면 멈춘다. 계속 재시도하면 결국 덮어쓰기가 되어 잠금이 무의미해진다.
    if (conflict) return
    try { await persist({ body: value }) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  })

  // 제목도 같은 규칙을 쓴다. 훅을 따로 걸어 본문 타이머와 섞이지 않게 한다.
  const titleSave = useDebouncedSave(async (value) => {
    if (conflict) return
    try { await persist({ title: value }) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  })

  /**
   * Esc는 상세가 살아 있는 동안 여기서 처리한다 (설계 §7).
   *
   * App.tsx의 document 리스너까지 올라가면 상세가 그 자리에서 언마운트되고, 언마운트
   * flush가 낸 충돌은 이미 사라진 컴포넌트의 setState라 React가 조용히 버린다 — 배너도
   * 오류도 없이, flush가 이미 소비한 텍스트만 사라진다. 그래서 먼저 flush를 끝내고,
   * 충돌이 났으면 닫지 않고 배너를 남겨 사용자가 판단할 자리를 지킨다.
   *
   * stopPropagation 한 줄로 App까지 못 가게 막는다 — ConfirmButton과 같은 이유·같은
   * 방법이다(그쪽 주석 참고). 삭제 확인이 켜져 있으면 ConfirmButton이 Esc를 먼저
   * 삼키므로 여기까지 오지 않는다.
   */
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    void (async () => {
      try {
        await titleSave.flush()
        await bodySave.flush()
      } catch (err) {
        // 저장 콜백이 스스로 잡지 못한 오류. 띄우고 닫지 않는다 (설계 §8).
        setError(err instanceof Error ? err.message : String(err))
        return
      }
      if (conflictRef.current) return
      onRequestClose()
    })()
  }

  return (
    <div className="detail" onKeyDown={handleKeyDown}>
      {conflict && (
        <ConflictBanner
          onReload={() => {
            // 배너가 뜬 채로 계속 타이핑하면 충돌 전(스테일) 텍스트를 든 디바운스
            // 타이머가 걸려 있을 수 있다. 취소하지 않으면 그 타이머가 다시 불러온
            // 뒤에도 살아남아, 마침 새로 맞춰진 expectedUpdatedAt과 함께 스테일한
            // 값을 몰래 써버려 화면과 DB가 갈린다 — 버퍼를 통째로 버리는 시점이니
            // 여기서도 같은 이유로 버린다 (아래 삭제와 대칭).
            bodySave.cancel()
            titleSave.cancel()
            setTitle(conflict.title)
            setBody(conflict.body)
            setStatus(conflict.status)
            // 축 셋도 같이 되돌린다. 안 그러면 사람이 방금 고른 축(예: 급함=긴급)이
            // updateIfUnchanged 실패로 DB에는 반영되지 않았는데도 화면엔 계속 남아,
            // "다시 불러오기"를 눌러도 DB의 실제 값(예: 미지정)과 어긋난 채로 보인다.
            setSource(conflict.source)
            setKind(conflict.kind)
            setPriority(conflict.priority)
            expected.current = conflict.updatedAt
            showConflict(null)
            onChanged()
          }}
          onOverwrite={() => {
            void (async () => {
              try {
                const saved = await client.issues.update({
                  // 축 셋도 같이 보낸다 — 빠뜨리면 방금 고른 축이 덮어쓰기에서
                  // 조용히 사라진다. 로컬 state는 null일 수 있어(미분류) update의
                  // 옵셔널 필드(undefined만 허용) 타입에 맞춰 변환한다.
                  id: issue.id, title, body, status,
                  source: source ?? undefined, kind: kind ?? undefined, priority: priority ?? undefined
                })
                expected.current = saved.updatedAt
                showConflict(null)
                onChanged()
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err))
              }
            })()
          }}
        />
      )}
      {/* 자동 저장은 사용자가 결과를 보지 않는다 — 실패를 숨기면 안 썼는데 썼다고
          믿게 된다 (설계 §8). 이 앱의 다른 오류 자리와 같이 role="alert"로 알린다. */}
      {error && <div role="alert" className="form-error">{error}</div>}

      <input
        aria-label="제목"
        className="detail-title"
        value={title}
        onChange={(e) => { setTitle(e.target.value); titleSave.schedule(e.target.value) }}
        onBlur={() => { void titleSave.flush() }}
      />
      <select
        aria-label="상태"
        className={`detail-status status status-${status}`}
        value={status}
        onChange={(e) => changeStatus(e.target.value as IssueStatus)}
      >
        <option value="open">open</option>
        <option value="doing">doing</option>
        <option value="done">done</option>
      </select>
      <AxisSelect
        label="출처" value={source} order={SOURCE_ORDER} labels={SOURCE_LABELS}
        onPick={(next) => { setSource(next); changeAxis({ source: next }) }}
      />
      <AxisSelect
        label="성격" value={kind} order={KIND_ORDER} labels={KIND_LABELS}
        onPick={(next) => { setKind(next); changeAxis({ kind: next }) }}
      />
      <AxisSelect
        label="급함" value={priority} order={PRIORITY_ORDER} labels={PRIORITY_LABELS}
        onPick={(next) => { setPriority(next); changeAxis({ priority: next }) }}
      />
      <textarea
        aria-label="본문"
        className="detail-body"
        value={body}
        onChange={(e) => { setBody(e.target.value); bodySave.schedule(e.target.value) }}
        onBlur={() => { void bodySave.flush() }}
      />

      <div className="detail-actions">
        <ConfirmButton
          label="삭제"
          confirmLabel="정말 삭제?"
          onConfirm={() => {
            // 지우기 전에 대기 중인 저장을 버린다 — 버리지 않으면 그 타이머(실제
            // 화면에서는 언마운트 flush)가 나중에 살아남아 이미 지워진 행에 쓰기를
            // 시도한다 (onReload와 같은 이유로, 여기서도 버퍼를 통째로 버린다).
            bodySave.cancel()
            titleSave.cancel()
            void (async () => {
              try { await client.issues.remove(issue.id); onDeleted() }
              catch (err) { setError(err instanceof Error ? err.message : String(err)) }
            })()
          }}
        />
      </div>
    </div>
  )
}
