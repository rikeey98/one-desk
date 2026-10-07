import type { Workspace } from '@shared/models'
import { PRESETS, customRange, lastDayOf, toDateInput, type Period, type Preset } from '../report/period'
import type { Include } from '../report/markdown'
import { IconCalendar } from './icons'

const INCLUDE_LABELS: ReadonlyArray<{ key: keyof Include; label: string }> = [
  { key: 'issues', label: '이슈' },
  { key: 'conversations', label: '대화' },
  { key: 'memos', label: '메모' },
  { key: 'answers', label: '대화의 마지막 답 한 줄' }
]

/**
 * 리포트의 조건 — 기간 · workspace · 담을 것 (`docs/sdlc/period-report/` FR-15). 세 보기가 같은 값을 쓴다:
 * 문서 보기는 왼쪽 열(`column`), 요일·이슈 흐름은 헤더 아래 띠(`strip`)로 같은 컨트롤을 그린다. state는 갖지 않는다.
 */
export function ReportConditions({
  layout, workspaces, counts, selected, onToggleWorkspace, preset, period, onPreset, onCustom, include, onInclude
}: {
  layout: 'column' | 'strip'
  workspaces: Workspace[]
  /** workspace마다 그 기간의 항목 수. 아직 모르면 null */
  counts: Record<string, number> | null
  selected: ReadonlySet<string>
  onToggleWorkspace: (id: string) => void
  /** 직접 지정이면 null */
  preset: Preset | null
  period: Period
  onPreset: (preset: Preset) => void
  onCustom: (period: Period) => void
  /** 문서 보기만 넘긴다 — 요일·이슈 흐름은 이 값을 따르지 않는다 */
  include?: Include
  onInclude?: (include: Include) => void
}) {
  const from = toDateInput(period.since)
  const to = toDateInput(lastDayOf(period))

  // 시작을 끝 뒤로 옮기면 끝이 따라온다(반대도) — 거꾸로 된 기간을 만들 수 없게
  function changeFrom(value: string) {
    const next = customRange(value, value > to ? value : to)
    if (next) onCustom(next)
  }
  function changeTo(value: string) {
    const next = customRange(value < from ? value : from, value)
    if (next) onCustom(next)
  }

  return (
    <div className={`report-conds report-conds-${layout}`}>
      <div className="report-field" role="group" aria-label="기간">
        {layout === 'column' && <span className="report-field-label">기간</span>}
        <div className="report-presets">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={preset === p.id ? 'report-preset report-preset-on' : 'report-preset'}
              aria-pressed={preset === p.id}
              onClick={() => onPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="report-dates">
          <IconCalendar />
          <input
            id={`report-from-${layout}`}
            type="date"
            aria-label="기간 시작"
            value={from}
            onChange={(e) => changeFrom(e.target.value)}
          />
          <span aria-hidden="true">~</span>
          <input
            id={`report-to-${layout}`}
            type="date"
            aria-label="기간 끝"
            value={to}
            onChange={(e) => changeTo(e.target.value)}
          />
        </div>
      </div>

      <div className="report-field" role="group" aria-label="workspace">
        {layout === 'column' && <span className="report-field-label">workspace</span>}
        <div className="report-workspaces">
          {workspaces.map((w) => {
            const on = selected.has(w.id)
            const count = counts?.[w.id]
            return (
              <label key={w.id} className={on ? 'report-ws report-ws-on' : 'report-ws'}>
                <input
                  type="checkbox"
                  checked={on}
                  aria-label={`${w.name} 포함`}
                  onChange={() => onToggleWorkspace(w.id)}
                />
                <span className="report-ws-name">{w.name}</span>
                {count !== undefined && (
                  <span className="group-count" title={`이 기간에 손댄 이슈·메모·대화 ${count}개`}>{count}</span>
                )}
              </label>
            )
          })}
        </div>
      </div>

      {include && onInclude && (
        <div className="report-field" role="group" aria-label="담을 것">
          <span className="report-field-label">담을 것</span>
          <div className="report-include">
            {INCLUDE_LABELS.map(({ key, label }) => (
              <label key={key} className="report-check">
                <input
                  type="checkbox"
                  checked={include[key]}
                  onChange={() => onInclude({ ...include, [key]: !include[key] })}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
