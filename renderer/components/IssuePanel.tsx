import { useEffect, useMemo, useState } from 'react'
import { Panel } from './Panel'
import { AddForm } from './AddForm'
import { IssueDetail } from './IssueDetail'
import { TriageCard, type TriagePick } from './TriageCard'
import { useIssues } from '../hooks/useIssues'
import { useClient } from '../client/ClientProvider'
import { chipKey, type ContextChip } from '../context'
import { groupIssues, isStale, untriagedCount } from '../issueGroups'
import { AXIS_LABELS, SOURCE_LABELS, KIND_LABELS, type GroupAxis } from '../issueAxes'
import type { Issue, Repo } from '@shared/models'

const AXES: GroupAxis[] = ['priority', 'source', 'kind', 'repo']

/** 이슈 한 줄에 붙는 축 칩. 표시 전용이다 — 목록에서는 못 고친다 (설계 §5). */
function AxisChips({ issue }: { issue: Issue }) {
  return (
    <>
      {issue.kind && <span className="axis-chip">{KIND_LABELS[issue.kind]}</span>}
      {issue.source && <span className="axis-chip">{SOURCE_LABELS[issue.source]}</span>}
    </>
  )
}

export function IssuePanel({
  workspaceId, repoId, repos, chipKeys, onToggleContext, expanded, openId, onOpen
}: {
  workspaceId: string
  repoId: string | null
  repos: Repo[]
  chipKeys: Set<string>
  onToggleContext: (chip: ContextChip) => void
  expanded: boolean
  openId: string | null
  onOpen: (id: string) => void
}) {
  const client = useClient()
  const { issues, error: listError, refresh } = useIssues(workspaceId, repoId)
  const [axis, setAxis] = useState<GroupAxis>('priority')
  // 접힌 그룹의 키. **완료만 기본으로 접는다** — 나머지를 접으면 앱이 스스로 묻는 셈이
  // 되어 이 기능의 목적과 반대로 간다. 접는 것은 사용자가 한다.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(['done']))

  const open = openId ? issues.find((i) => i.id === openId) ?? null : null

  // 열린 항목이 목록에서 사라졌으면(지워졌거나 필터가 바뀌었으면) 접는다.
  // 존재하지 않는 항목의 상세를 그리지 않는다 (설계 §8).
  useEffect(() => {
    if (openId && !open) onOpen(openId)
  }, [openId, open, onOpen])

  // 훑기 상태는 IssuePanel이 갖는다 — App.tsx에 올리지 않는다.
  // 다른 컴포넌트가 이 상태를 쓰지 않으므로 App의 openItem 계약이 그대로 남고,
  // 부수적으로 "App이 내려보내는 prop 한 줄"이라는 변이 취약점이 늘지 않는다.
  const [triaging, setTriaging] = useState(false)
  const [triageError, setTriageError] = useState<string | null>(null)

  /** 훑기 대기열. 저장소가 준 순서를 그대로 쓴다. */
  const queue = useMemo(
    () => issues.filter((i) => i.triagedAt === null && i.status !== 'done'),
    [issues]
  )

  function startTriage() {
    const first = queue[0]
    if (!first) return
    setTriaging(true)
    if (openId !== first.id) onOpen(first.id)
  }

  /** 다음 대기 항목으로. 없으면 훑기를 끝낸다. */
  function advance(fromId: string) {
    const rest = queue.filter((i) => i.id !== fromId)
    const next = rest[0]
    if (!next) {
      setTriaging(false)
      if (openId) onOpen(openId)   // 같은 id로 부르면 App의 토글이 접는다
      return
    }
    onOpen(next.id)
  }

  async function saveTriage(id: string, pick: TriagePick) {
    // 잠기지 않은 update를 쓴다. 훑기는 본문을 건드리지 않으므로 사람과 agent가
    // 같은 글자를 다툴 일이 없고, 여기서 잠그면 agent가 방금 본문을 채운 이슈를
    // 분류조차 못 한다.
    await client.issues.update({ id, ...pick })
    await refresh()
  }

  const now = Date.now()
  const groups = useMemo(() => groupIssues(issues, axis, repos), [issues, axis, repos])
  const untriaged = untriagedCount(issues)

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function addIssue(title: string) {
    // **던질 땐 제목만이다.** 축을 요구하는 순간 회의 중에 못 던진다.
    await client.issues.create({
      workspaceId,
      title,
      repoIds: repoId ? [repoId] : []
    })
    await refresh()
  }

  const list = (
    <>
      <AddForm placeholder="새 이슈 제목…" onSubmit={addIssue} />

      {untriaged > 0 && (
        // 0건일 때는 그리지 않는다 — 상주하는 잔소리가 된다 (설계 §4).
        <div className="triage-banner">
          <span>⚠ 정리 안 됨 ({untriaged})</span>
          <button type="button" onClick={startTriage}>훑어보기</button>
        </div>
      )}

      <label className="group-axis">
        묶기
        <select
          aria-label="묶기"
          value={axis}
          onChange={(e) => setAxis(e.target.value as GroupAxis)}
        >
          {AXES.map((a) => <option key={a} value={a}>{AXIS_LABELS[a]}</option>)}
        </select>
      </label>

      {!listError && issues.length === 0 && <div className="panel-empty">이슈가 없습니다</div>}

      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.key)
        return (
          <div key={group.key} className="issue-group">
            <button
              type="button"
              className="group-header"
              aria-expanded={!isCollapsed}
              onClick={() => toggleGroup(group.key)}
            >
              {/* 개수는 접혀도 남는다. 안 보여도 있다는 것은 알아야 한다. */}
              {isCollapsed ? '▸' : '▾'} {group.label} ({group.issues.length})
            </button>
            {!isCollapsed && (
              <ul className="item-list">
                {group.issues.map((i) => {
                  const picked = chipKeys.has(chipKey({ type: 'issue', id: i.id }))
                  return (
                    <li key={i.id} className="item">
                      <button
                        type="button"
                        className={picked ? 'item-pick item-picked' : 'item-pick'}
                        aria-label={`${i.title} 맥락에 담기`}
                        aria-pressed={picked}
                        onClick={() => onToggleContext({ type: 'issue', id: i.id, label: i.title })}
                      >
                        {picked ? '✓' : ''}
                      </button>
                      <button
                        type="button"
                        className={openId === i.id ? 'item-title item-open' : 'item-title'}
                        onClick={() => { setTriaging(false); onOpen(i.id) }}
                      >
                        {i.title}
                      </button>
                      <AxisChips issue={i} />
                      {isStale(i, now) && (
                        <span className="axis-chip axis-chip-stale" aria-label="오래 방치됨">⚠</span>
                      )}
                      {/* 목록의 상태와 축은 읽기 전용이다. 편집은 상세가 맡는다.
                          여기서 잠기지 않은 update로 쓰면 그 쓰기가 updatedAt을 올려
                          열려 있는 상세의 기대값만 낡게 만들고, 다음 자동 저장이
                          사용자 자신의 클릭을 agent의 편집으로 착각한다. */}
                      <span className={`status status-${i.status}`}>{i.status}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </>
  )

  return (
    <Panel title="Issues" expanded={expanded}>
      {listError && <div role="alert" className="form-error">{listError}</div>}
      {triageError && <div role="alert" className="form-error">{triageError}</div>}
      {/* 감싸는 div의 엘리먼트 타입을 확장 여부와 무관하게 항상 유지한다.
          expanded에 따라 div ↔ Fragment로 타입이 바뀌면 React가 이 자리를
          통째로 언마운트-재마운트해 item-title 버튼의 DOM 정체성이 사라진다 —
          "같은 항목을 다시 클릭하면 접힌다" 테스트에서 실측한 결함이다:
          첫 클릭으로 확장되며 버튼이 새 DOM 노드로 교체되고, 테스트가 들고 있던
          예전 참조로 두 번째 클릭을 해도 이벤트가 루트까지 버블링하지 못해
          무시됐다. */}
      <div className={expanded ? 'panel-split' : undefined}>
        <div className={expanded ? 'panel-split-list' : undefined}>{list}</div>
        {expanded && (
          <div className="panel-split-detail">
            {open && triaging && (
              <TriageCard
                key={open.id}
                issue={open}
                position={queue.findIndex((i) => i.id === open.id) + 1}
                total={queue.length}
                onDone={(pick) => {
                  void (async () => {
                    try {
                      await saveTriage(open.id, pick)
                      advance(open.id)
                    } catch (err) {
                      // 충돌하면 그 한 건에서 멈춘다. 자동으로 넘어가면 사용자가
                      // 방금 찍은 축이 어디로 갔는지 모른 채 대기열만 줄어든다.
                      setTriageError(err instanceof Error ? err.message : String(err))
                    }
                  })()
                }}
                onSkip={() => advance(open.id)}
              />
            )}
            {open && !triaging && (
              <IssueDetail
                // key가 핵심이다. 다른 이슈로 옮기면 상세를 통째로 다시 마운트해,
                // 옛 컴포넌트가 자기 클로저를 들고 언마운트되며 대기 중인 저장을
                // 올바른 이슈에 흘려보낸다 (IssueDetail 내부 설명 참고).
                key={open.id}
                issue={open}
                onChanged={() => { void refresh() }}
                onDeleted={() => { onOpen(open.id); void refresh() }}
                // 같은 id로 onOpen을 부르면 App의 토글이 접는다. 상세가 대기 중인
                // 저장을 먼저 끝낸 뒤에만 부르므로, 접히면서 쓰기를 잃지 않는다.
                onRequestClose={() => { onOpen(open.id) }}
              />
            )}
          </div>
        )}
      </div>
    </Panel>
  )
}
