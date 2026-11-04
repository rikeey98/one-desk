import { useEffect, useMemo, useRef, useState } from 'react'
import type { Memo, ReportData, Workspace } from '@shared/models'
import { useClient } from '../client/ClientProvider'
import { useReport } from '../hooks/useReport'
import { isEmptyReport, projectReport, reportItemCount } from '../report/project'
import { PRESETS, presetRange, type Period, type Preset } from '../report/period'
import { reportTitle, toMarkdown, type Include } from '../report/markdown'
import { REPORT_TABS, readInclude, readTab, writeInclude, writeTab, type ReportTab } from '../report/prefs'
import { ReportConditions } from './ReportConditions'
import { ReportDocument } from './ReportDocument'
import { ReportDays } from './ReportDays'
import { ReportFlow } from './ReportFlow'
import { IconCheck, IconCopy, IconSparkle } from './icons'

/** 리포트의 조건 — App이 쥔다. 리포트에서 이슈를 열러 갔다 돌아와도 그대로다 (FR-19) */
export interface ReportQuery {
  /** 직접 지정이면 null */
  preset: Preset | null
  period: Period
  /** null이면 전부 — 새로 만든 workspace도 저절로 든다 */
  workspaceIds: string[] | null
}

export function initialReportQuery(now: number): ReportQuery {
  return { preset: 'last-week', period: presetRange('last-week', now), workspaceIds: null }
}

/** `agent에게 다듬기`가 홈 대화의 새 대화 칸에 채우는 지시 (FR-24, home-conversation FR-15a). 보내지는 않는다 */
export const POLISH_PROMPT = '아래 리포트를 바탕으로 팀에 공유할 보고를 써 줘. 완료한 일, 진행 중인 일, 막힌 것 순서로. 리포트에 없는 것은 필요하면 직접 찾아 읽어.'

/** 다듬기의 초안 — 지시 다음에 지금 보이는 리포트의 마크다운(`마크다운 복사`와 같은 글)이 온다 */
export function polishDraft(markdown: string): string {
  return `${POLISH_PROMPT}\n\n${markdown}`
}

const DONE_MS = 1500

type SaveState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'saved'; memo: Memo }
  | { kind: 'error'; message: string }

function itemCounts(data: ReportData | null): Record<string, number> | null {
  if (!data) return null
  return Object.fromEntries(data.workspaces.map((w) => [w.id, w.issues.length + w.memos.length + w.conversations.length]))
}

/**
 * 기간 리포트 화면 (`docs/sdlc/period-report/`). 세 보기(문서·요일·이슈 흐름)가 조건 하나를 같이 쓰고, 내보내기는 어느
 * 보기에서든 문서 보기의 순서다(FR-12).
 */
export function ReportPanel({
  workspaces, query, onQueryChange, targetWorkspaceId,
  onOpenIssue, onOpenConversation, onOpenMemo, onPolish, canPolish
}: {
  workspaces: Workspace[]
  query: ReportQuery
  onQueryChange: (query: ReportQuery) => void
  /** 메모를 저장할 workspace — App이 고른 것. 없으면 리포트에 담긴 첫 workspace다 (FR-23) */
  targetWorkspaceId: string | null
  onOpenIssue: (workspaceId: string, issueId: string) => void
  onOpenConversation: (workspaceId: string, conversationId: string) => void
  onOpenMemo: (workspaceId: string, memoId: string) => void
  /**
   * 초안을 홈 대화의 새 대화 칸에 채운다 (`docs/sdlc/home-conversation/` FR-15a). 메모를 만들지 않는다 — 리포트는 workspace를 넘는
   * 것이라 한 workspace를 고를 이유가 없다.
   */
  onPolish: (draft: string) => void
  /** 홈 대화의 자리를 읽었는가 — 못 읽었으면 초안을 채울 곳이 없어 다듬기가 잠긴다. **필수다**(App 한 줄을 지우면 늘 열린다) */
  canPolish: boolean
}) {
  const client = useClient()
  const [tab, setTab] = useState<ReportTab>(readTab)
  const [include, setInclude] = useState<Include>(readInclude)
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const now = Date.now()

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  const allIds = useMemo(() => workspaces.map((w) => w.id), [workspaces])
  const { data, error, loading, retry } = useReport(allIds, query.period)

  const selected = useMemo(
    () => new Set(query.workspaceIds === null ? allIds : query.workspaceIds.filter((id) => allIds.includes(id))),
    [query.workspaceIds, allIds]
  )
  // 응답이 기간보다 늦게 따라온다 — 조건이 바뀐 직후의 낡은 데이터에 새 기간을 씌우지 않게 data의 기간을 쓴다
  const shown: ReportData | null = useMemo(() => data && {
    ...data,
    workspaces: data.workspaces.filter((w) => selected.has(w.id))
  }, [data, selected])
  const view = useMemo(() => (shown ? projectReport(shown) : null), [shown])

  // 빈 리포트의 제안 — 지금 preset 말고 **데이터가 있는 가장 가까운 preset**을 찾는다 (docs/sdlc/ux-polish/ FR-2). 고정된 `지난 30일`
  // 대신이다: 오늘 만든 것이 있는데 기본 preset(지난주)이 비어 "없다"고 보이던 모순을 푼다. 네 번 세는 비용은 리포트 조회 하나와
  // 같다. 이미 빈 결과를 본 뒤에만 돈다.
  const empty = shown !== null && selected.size > 0 && isEmptyReport(shown)
  const selectedKey = [...selected].join(',')
  const [nearest, setNearest] = useState<{ preset: Preset; count: number } | null>(null)
  useEffect(() => {
    if (!empty) { setNearest(null); return }
    let alive = true
    const ids = selectedKey === '' ? [] : selectedKey.split(',')
    const order: Preset[] = ['this-week', 'last-7', 'last-week', 'last-30']
    ;(async () => {
      for (const preset of order) {
        if (preset === query.preset) continue
        const range = presetRange(preset, Date.now())
        const found = await client.reports.build({ workspaceIds: ids, since: range.since, until: range.until })
        if (!alive) return
        const count = reportItemCount(found)
        if (count > 0) { setNearest({ preset, count }); return }
      }
      if (alive) setNearest(null)
    })().catch(() => { if (alive) setNearest(null) })
    return () => { alive = false }
  }, [client, empty, selectedKey, query.preset])

  const target = workspaces.find((w) => w.id === targetWorkspaceId && selected.has(w.id))
    ?? workspaces.find((w) => w.id === targetWorkspaceId)
    ?? workspaces.find((w) => selected.has(w.id))
    ?? null

  // 조건이 바뀌면 "저장함"은 다른 리포트의 것이 된다
  const conditionKey = `${query.period.since}|${query.period.until}|${[...selected].join(',')}|${JSON.stringify(include)}`
  const lastKey = useRef(conditionKey)
  useEffect(() => {
    if (lastKey.current === conditionKey) return
    lastKey.current = conditionKey
    setSave({ kind: 'idle' })
  }, [conditionKey])

  function chooseTab(next: ReportTab) {
    setTab(next)
    writeTab(next)
  }

  function changeInclude(next: Include) {
    setInclude(next)
    writeInclude(next)
  }

  function toggleWorkspace(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    // 전부 고르면 null로 되돌린다 — 그래야 새로 만든 workspace도 저절로 든다
    onQueryChange({ ...query, workspaceIds: next.size === allIds.length ? null : allIds.filter((w) => next.has(w)) })
  }

  async function copy() {
    if (!shown) return
    if (copyTimer.current) clearTimeout(copyTimer.current)
    try {
      await navigator.clipboard.writeText(toMarkdown(shown, include))
      setCopied('done')
      copyTimer.current = setTimeout(() => setCopied('idle'), DONE_MS)
    } catch {
      setCopied('failed')
    }
  }

  async function saveMemo(): Promise<Memo | null> {
    if (!shown || !target) return null
    setSave({ kind: 'busy' })
    try {
      const memo = await client.memos.create({ workspaceId: target.id, title: reportTitle(shown), body: toMarkdown(shown, include) })
      setSave({ kind: 'saved', memo })
      return memo
    } catch (err) {
      setSave({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      return null
    }
  }

  function polish() {
    if (shown) onPolish(polishDraft(toMarkdown(shown, include)))
  }

  const ready = shown !== null && !isEmptyReport(shown)
  const busy = save.kind === 'busy'

  return (
    <section className="panel report-panel" aria-label="리포트">
      <header className="panel-header report-header">
        <span className="panel-title">리포트</span>
        <div className="report-tabs" role="tablist" aria-label="보기">
          {REPORT_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`report-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="report-tabpanel"
              className={tab === t.id ? 'report-tab report-tab-on' : 'report-tab'}
              onClick={() => chooseTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="report-actions">
          {copied === 'failed' && <span role="status" className="copy-failed">복사하지 못했습니다</span>}
          {save.kind === 'saved' && (
            <span role="status" className="report-saved">
              저장함 ·{' '}
              <button type="button" className="report-link" onClick={() => onOpenMemo(save.memo.workspaceId, save.memo.id)}>메모 열기</button>
            </span>
          )}
          {save.kind === 'error' && <span role="alert" className="report-save-error">{save.message}</span>}
          <button type="button" className="report-btn" disabled={!ready} onClick={() => void copy()}>
            {copied === 'done' ? <IconCheck /> : <IconCopy />}
            {copied === 'done' ? '복사함' : '마크다운 복사'}
          </button>
          <button type="button" className="report-btn" disabled={!ready || !canPolish} onClick={polish}>
            <IconSparkle />agent에게 다듬기
          </button>
          <button type="button" className="report-btn report-btn-primary" disabled={!ready || !target || busy} onClick={() => void saveMemo()}>
            {target ? `${target.name}에 메모로 저장` : '메모로 저장'}
          </button>
        </div>
      </header>

      <div
        id="report-tabpanel"
        role="tabpanel"
        aria-labelledby={`report-tab-${tab}`}
        className={`report-body report-body-${tab}`}
      >
        <ReportConditions
          layout={tab === 'document' ? 'column' : 'strip'}
          workspaces={workspaces}
          counts={itemCounts(data)}
          selected={selected}
          onToggleWorkspace={toggleWorkspace}
          preset={query.preset}
          period={query.period}
          onPreset={(preset) => onQueryChange({ ...query, preset, period: presetRange(preset, Date.now()) })}
          onCustom={(period) => onQueryChange({ ...query, preset: null, period })}
          {...(tab === 'document' ? { include, onInclude: changeInclude } : {})}
        />
        <div className="report-content" aria-busy={loading}>
          {workspaces.length === 0 ? (
            <div className="report-empty">workspace를 먼저 만드세요.</div>
          ) : error && !data ? (
            <div role="alert" className="form-error report-error">
              리포트를 만들지 못했습니다: {error}
              <button type="button" className="report-btn" onClick={() => void retry()}>다시 시도</button>
            </div>
          ) : !view || !shown ? (
            <div className="report-skeleton" aria-label="불러오는 중">
              {[0, 1, 2, 3, 4].map((i) => <i key={i} />)}
            </div>
          ) : selected.size === 0 ? (
            <div className="report-empty">workspace를 하나 이상 고르세요.</div>
          ) : isEmptyReport(shown) ? (
            <div className="report-empty">
              <p>이 기간에 손댄 이슈와 대화가 없습니다.</p>
              {nearest ? (
                <p className="report-empty-nearest">
                  <span>가까운 기간에는 있습니다</span>
                  <button
                    type="button"
                    className="report-btn"
                    onClick={() => onQueryChange({ ...query, preset: nearest.preset, period: presetRange(nearest.preset, Date.now()) })}
                  >
                    {PRESETS.find((p) => p.id === nearest.preset)?.label} 보기 <span className="group-count">{nearest.count}</span>
                  </button>
                </p>
              ) : <p>기간을 넓혀 보세요.</p>}
            </div>
          ) : tab === 'document' ? (
            <ReportDocument
              view={view}
              workspaces={shown.workspaces}
              include={include}
              now={now}
              onOpenIssue={onOpenIssue}
              onOpenConversation={onOpenConversation}
            />
          ) : tab === 'days' ? (
            <ReportDays
              view={view}
              workspaces={shown.workspaces}
              now={now}
              onOpenIssue={onOpenIssue}
              onOpenConversation={onOpenConversation}
            />
          ) : (
            <ReportFlow
              view={view}
              workspaces={shown.workspaces}
              now={now}
              onOpenIssue={onOpenIssue}
              onOpenConversation={onOpenConversation}
            />
          )}
          {error && data && <div role="alert" className="form-error">리포트를 새로 만들지 못했습니다: {error}</div>}
        </div>
      </div>
    </section>
  )
}
