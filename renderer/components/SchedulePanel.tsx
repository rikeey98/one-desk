import { useEffect, useMemo, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import { useSchedules } from '../hooks/useSchedules'
import { RUN_STATUS_LABELS } from '../runStatus'
import { conversationBreaks, draftOf, emptyDraft, inputOf, isDirty, raisesToFull, triggerOf, type ScheduleDraft } from '../schedules/form'
import { DISABLED_LABELS, dayTimeLabel } from '../schedules/labels'
import { describeTrigger } from '@shared/scheduleTrigger'
import { ScheduleForm, type ContextOption } from './ScheduleForm'
import { ScheduleFires } from './ScheduleFires'
import { IconPlus } from './icons'
import type { Repo, ScheduleView, SchedulePreview, Workspace } from '@shared/models'

/** 이 장비의 시간대 — 새 정기 실행에 저장한다. core는 장비의 시간대를 묻지 않는다 (spec FR-3·8) */
function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

const MINUTE = 60_000

type Selection = { kind: 'new' } | { kind: 'saved'; id: string } | null

/**
 * 정기 실행 화면 (`docs/sdlc/scheduled-runs/` spec FR-26~33). 왼쪽 목록(workspace로 묶음), 오른쪽 편집 칸 + 실행 기록. **초안은 여기서
 * 쥔다** — 편집 칸은 그리기만 한다.
 */
export function SchedulePanel({ workspaces, onOpenConversation }: {
  workspaces: Workspace[]
  /** 기록의 `대화 열기` — 리포트와 같은 길(App의 openReportConversation) */
  onOpenConversation: (workspaceId: string, conversationId: string) => void
}) {
  const client = useClient()
  const { schedules, error: listError, refresh } = useSchedules()
  const [now, setNow] = useState(() => Date.now())
  const [selection, setSelection] = useState<Selection>(null)
  const [draft, setDraft] = useState<ScheduleDraft | null>(null)
  /** 고친 것이 있는데 다른 것을 고르면 여기 걸고 묻는다 (FR-31) */
  const [pending, setPending] = useState<Selection>(null)
  const [repos, setRepos] = useState<Repo[]>([])
  const [contextOptions, setContextOptions] = useState<ContextOption[]>([])
  const [preview, setPreview] = useState<SchedulePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // 다음 실행의 상대 표현은 1분마다 다시 그린다 (FR-33)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE)
    return () => clearInterval(timer)
  }, [])

  const saved: ScheduleView | null = selection?.kind === 'saved' ? schedules?.find((s) => s.id === selection.id) ?? null : null
  const draftWorkspaceId = draft?.workspaceId ?? null

  // 고른 workspace의 repo와 담을 수 있는 맥락
  useEffect(() => {
    if (!draftWorkspaceId) return
    let alive = true
    void (async () => {
      try {
        const [r, issues, memos, assets] = await Promise.all([
          client.repos.list(draftWorkspaceId),
          client.issues.list({ workspaceId: draftWorkspaceId }),
          client.memos.list({ workspaceId: draftWorkspaceId }),
          client.assets.list({ workspaceId: draftWorkspaceId })
        ])
        if (!alive) return
        setRepos(r)
        setContextOptions([
          ...issues.map((i) => ({ type: 'issue' as const, id: i.id, label: i.title })),
          ...memos.map((m) => ({ type: 'memo' as const, id: m.id, label: m.title })),
          // 지시 파일은 CLI가 알아서 읽는다 — 담을 수 없다(repo-instructions FR-9)
          ...assets.filter((a) => a.kind !== 'instructions').map((a) => ({ type: 'asset' as const, id: a.id, label: a.name }))
        ])
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => { alive = false }
  }, [client, draftWorkspaceId])

  // 다음 세 시각 — 판정은 core가 한다(FR-9)
  const triggerKey = draft ? JSON.stringify(triggerOf(draft)) : null
  const zone = saved?.timeZone ?? localTimeZone()
  useEffect(() => {
    if (!triggerKey) return
    let alive = true
    setPreview(null)
    const timer = setTimeout(() => {
      client.schedules.preview(JSON.parse(triggerKey), zone).then(
        (p) => { if (alive) setPreview(p) },
        (err: unknown) => { if (alive) setPreview({ ok: false, error: err instanceof Error ? err.message : String(err) }) }
      )
    }, 250)
    return () => { alive = false; clearTimeout(timer) }
  }, [client, triggerKey, zone])

  const dirty = draft ? isDirty(draft, saved) : false

  async function open(target: Selection) {
    setPending(null)
    setError(null)
    setNotice(null)
    setSelection(target)
    if (target === null) { setDraft(null); return }
    if (target.kind === 'saved') {
      const s = schedules?.find((x) => x.id === target.id)
      setDraft(s ? draftOf(s) : null)
      return
    }
    const ws = workspaces[0]
    if (!ws) { setDraft(null); return }
    await startNew(ws)
  }

  async function startNew(ws: Workspace) {
    try {
      setDraft(emptyDraft(ws, await client.repos.list(ws.id)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function choose(target: Selection) {
    if (draft && dirty) { setPending(target); return }
    void open(target)
  }

  function patch(p: Partial<ScheduleDraft>) {
    setDraft((d) => (d ? { ...d, ...p } : d))
  }

  async function act(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try { await fn() } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) }
  }

  const save = () => act(async () => {
    if (!draft) return
    const view = saved
      ? await client.schedules.update(saved.id, inputOf(draft, saved.timeZone))
      : await client.schedules.create(inputOf(draft, localTimeZone()))
    await refresh()
    setSelection({ kind: 'saved', id: view.id })
    setDraft(draftOf(view))
    setNotice('저장했습니다')
  })

  const runNow = () => act(async () => {
    if (!saved) return
    await client.schedules.runNow(saved.id)
    await refresh()
    setNotice('보냈습니다 — 결과는 실행 기록과 인박스에 남습니다')
  })

  const remove = () => act(async () => {
    if (!saved) return
    await client.schedules.remove(saved.id)
    await refresh()
    setSelection(null)
    setDraft(null)
  })

  const toggle = (s: ScheduleView) => act(async () => {
    await client.schedules.setEnabled(s.id, !s.enabled)
    await refresh()
  })

  const groups = useMemo(() => workspaces
    .map((w) => ({ workspace: w, items: (schedules ?? []).filter((s) => s.workspaceId === w.id) }))
    .filter((g) => g.items.length > 0), [workspaces, schedules])

  return (
    <section className="panel schedule-panel" aria-label="정기 실행">
      <header className="panel-header">
        <span className="panel-title">정기 실행</span>
        <button type="button" className="report-btn" disabled={workspaces.length === 0} onClick={() => choose({ kind: 'new' })}>
          <IconPlus />새 정기 실행
        </button>
      </header>
      <div className="schedule-body">
        <nav className="schedule-list" aria-label="정기 실행 목록">
          {listError && (
            <div role="alert" className="form-error report-error">
              목록을 읽지 못했습니다: {listError}
              <button type="button" className="report-btn" onClick={() => void refresh()}>다시 시도</button>
            </div>
          )}
          {schedules && schedules.length === 0 && (
            <div className="report-empty">
              <p>정기 실행이 없습니다.</p>
              <p>지시를 등록해 두면 정해진 시각마다 agent가 저절로 돕니다. 앱이 켜져 있을 때만 돌고, 꺼져 있던 동안 놓친 것은 켤 때 한 번 돕니다.</p>
            </div>
          )}
          {groups.map(({ workspace, items }) => (
            <section key={workspace.id} className="schedule-group" aria-label={`${workspace.name} 묶음`}>
              <h3>{workspace.name}</h3>
              <ul>
                {items.map((s) => {
                  const selected = selection?.kind === 'saved' && selection.id === s.id
                  const status = s.lastFire?.runStatus ?? null
                  return (
                    <li key={s.id} className={selected ? 'schedule-row schedule-row-selected' : 'schedule-row'}>
                      <button type="button" className="schedule-row-main" aria-label={`${s.name} 정기 실행 편집`} aria-current={selected || undefined} onClick={() => choose({ kind: 'saved', id: s.id })}>
                        <span className="schedule-row-name">
                          {status && <span className={`status-dot status-${status}`} role="img" aria-label={RUN_STATUS_LABELS[status]} title={RUN_STATUS_LABELS[status]} />}
                          {s.name}
                        </span>
                        <span className="schedule-muted">{s.repoName ?? 'repo 없음'} · {describeTrigger(s.trigger)}</span>
                        <span className={s.disabledReason ? 'schedule-row-off form-error' : 'schedule-muted'}>
                          {s.disabledReason ? DISABLED_LABELS[s.disabledReason]
                            : s.enabled && s.nextAt !== null ? `다음 ${dayTimeLabel(s.nextAt, now)}` : '꺼져 있음'}
                        </span>
                      </button>
                      <label className="schedule-switch">
                        <input type="checkbox" role="switch" aria-label={`${s.name} 켜기`} checked={s.enabled} disabled={busy} onChange={() => void toggle(s)} />
                      </label>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </nav>

        <div className="schedule-detail">
          {pending && (
            <div role="alert" className="schedule-pending">
              고친 것이 저장되지 않았습니다.
              <button type="button" className="report-btn" onClick={() => void open(pending)}>버리고 이동</button>
              <button type="button" className="report-btn" onClick={() => setPending(null)}>계속 고치기</button>
            </div>
          )}
          {draft ? (
            <>
              <ScheduleForm
                draft={draft}
                onChange={patch}
                editing={saved !== null}
                workspaces={workspaces}
                onWorkspace={(id) => { const ws = workspaces.find((w) => w.id === id); if (ws) void startNew(ws) }}
                repos={repos}
                contextOptions={contextOptions}
                preview={preview}
                now={now}
                dirty={dirty}
                raising={raisesToFull(draft, saved)}
                breaks={conversationBreaks(draft, saved)}
                busy={busy}
                error={error}
                notice={notice}
                onSave={() => void save()}
                onRunNow={saved ? () => void runNow() : null}
                onDelete={saved ? () => void remove() : null}
              />
              {saved && (
                <ScheduleFires
                  scheduleId={saved.id}
                  version={`${saved.lastFire?.id ?? ''}:${saved.lastFire?.runStatus ?? ''}`}
                  now={now}
                  onOpenConversation={(conversationId) => onOpenConversation(saved.workspaceId, conversationId)}
                />
              )}
            </>
          ) : (
            <p className="schedule-muted schedule-hint">
              {workspaces.length === 0 ? 'workspace를 먼저 만드세요.' : '왼쪽에서 정기 실행을 고르거나 새로 만드세요.'}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
