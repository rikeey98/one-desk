import { ConfirmButton } from './ConfirmButton'
import { ModelField } from './ModelField'
import { PERMISSION_LABELS } from '../permission'
import { AGENT_KINDS, AGENT_LABELS } from '../agents'
import { EFFORT_OPTIONS, effortFieldOf } from '../effort'
import { agentBlockedReason } from '../agentEnv'
import { dayTimeLabel } from '../schedules/labels'
import type { ScheduleDraft } from '../schedules/form'
import { HOURLY_STEPS, WEEKDAY_ORDER, weekdayName, type HourlyStep, type TriggerKind } from '@shared/scheduleTrigger'
import type { ContextItemRef, Permission, Repo, ScheduleConversationMode, SchedulePreview, Workspace } from '@shared/models'

export interface ContextOption extends ContextItemRef {
  label: string
}

const TRIGGER_KINDS: ReadonlyArray<{ kind: TriggerKind; label: string }> = [
  { kind: 'weekdays', label: '평일' },
  { kind: 'daily', label: '매일' },
  { kind: 'weekly', label: '매주' },
  { kind: 'hourly', label: 'N시간마다' },
  { kind: 'cron', label: 'cron' }
]

const CONTEXT_KIND_LABELS = { issue: '이슈', memo: '메모', asset: '스킬/에이전트' } as const

/**
 * 정기 실행의 편집 칸 (`docs/sdlc/scheduled-runs/` spec FR-28~31). **state 없이 그리기만 한다** — 초안은 `SchedulePanel`이 쥔다
 * (SettingsPanel의 규칙: 초안을 자식에 내리지 않는다).
 */
export function ScheduleForm(props: {
  draft: ScheduleDraft
  onChange: (patch: Partial<ScheduleDraft>) => void
  /** 고치는 중이면 workspace를 바꿀 수 없다 */
  editing: boolean
  workspaces: Workspace[]
  onWorkspace: (workspaceId: string) => void
  repos: Repo[]
  contextOptions: ContextOption[]
  preview: SchedulePreview | null
  now: number
  dirty: boolean
  raising: boolean
  breaks: boolean
  busy: boolean
  error: string | null
  notice: string | null
  onSave: () => void
  onRunNow: (() => void) | null
  onDelete: (() => void) | null
}) {
  const { draft: d, onChange } = props
  const repo = props.repos.find((r) => r.id === d.repoId)
  const effortField = effortFieldOf(d.agentKind)
  const missing = d.context.filter((c) => !props.contextOptions.some((o) => o.type === c.type && o.id === c.id))
  const canSave = props.dirty && !props.busy && d.name.trim() !== '' && d.prompt.trim() !== '' && d.repoId !== ''
    && props.preview?.ok === true

  function toggleContext(ref: ContextItemRef) {
    const has = d.context.some((c) => c.type === ref.type && c.id === ref.id)
    onChange({ context: has ? d.context.filter((c) => !(c.type === ref.type && c.id === ref.id)) : [...d.context, { type: ref.type, id: ref.id }] })
  }

  return (
    <form className="schedule-form" aria-label="정기 실행 편집" onSubmit={(e) => e.preventDefault()}>
      {props.error && <div role="alert" className="form-error">{props.error}</div>}
      {props.notice && <div role="status" className="schedule-notice">{props.notice}</div>}

      <label className="settings-field">
        이름
        <input aria-label="정기 실행 이름" value={d.name} maxLength={60} onChange={(e) => onChange({ name: e.target.value })} />
      </label>

      <div className="settings-grid">
        <label className="settings-field">
          workspace
          <select
            aria-label="정기 실행 workspace" value={d.workspaceId} disabled={props.editing}
            onChange={(e) => props.onWorkspace(e.target.value)}
          >
            {props.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label className="settings-field">
          작업 디렉토리
          <select aria-label="정기 실행 작업 디렉토리" value={d.repoId} onChange={(e) => onChange({ repoId: e.target.value })}>
            {d.repoId === '' && <option value="">repo를 고르세요</option>}
            {props.repos.map((r) => <option key={r.id} value={r.id} title={r.path}>{r.name}</option>)}
          </select>
        </label>
      </div>

      <div className="settings-grid">
        <label className="settings-field">
          agent
          <select aria-label="정기 실행 agent" value={d.agentKind} onChange={(e) => onChange({ agentKind: e.target.value as ScheduleDraft['agentKind'], effort: '' })}>
            {AGENT_KINDS.map((k) => (
              <option key={k} value={k} disabled={repo ? agentBlockedReason(repo.agentEnv, k) !== null : false}>{AGENT_LABELS[k]}</option>
            ))}
          </select>
        </label>
        <ModelField agentKind={d.agentKind} label="정기 실행 모델" value={d.model} onChange={(model) => onChange({ model })} />
      </div>

      <div className="settings-grid">
        {effortField.fixedOptions ? (
          <label className="settings-field">
            {effortField.label}
            <select aria-label={`정기 실행 ${effortField.label}`} value={d.effort} onChange={(e) => onChange({ effort: e.target.value })}>
              {EFFORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        ) : (
          <label className="settings-field">
            {effortField.label}
            <input aria-label={`정기 실행 ${effortField.label}`} value={d.effort} placeholder={effortField.hint} onChange={(e) => onChange({ effort: e.target.value })} />
          </label>
        )}
        <label className="settings-field">
          권한
          <select aria-label="정기 실행 권한" value={d.permission} onChange={(e) => onChange({ permission: e.target.value as Permission })}>
            {(Object.keys(PERMISSION_LABELS) as Permission[]).map((p) => <option key={p} value={p}>{PERMISSION_LABELS[p]}</option>)}
          </select>
        </label>
      </div>

      <label className="settings-field">
        지시
        <textarea aria-label="정기 실행 지시" rows={4} value={d.prompt} onChange={(e) => onChange({ prompt: e.target.value })} />
      </label>

      <fieldset className="schedule-context">
        <legend>맥락</legend>
        {props.contextOptions.length === 0 && missing.length === 0 && <p className="schedule-muted">이 workspace에 담을 이슈·메모가 없습니다.</p>}
        {props.contextOptions.map((o) => (
          <label key={`${o.type}:${o.id}`} className="schedule-check">
            <input
              type="checkbox"
              checked={d.context.some((c) => c.type === o.type && c.id === o.id)}
              onChange={() => toggleContext(o)}
            />
            <span className="schedule-muted">{CONTEXT_KIND_LABELS[o.type as keyof typeof CONTEXT_KIND_LABELS]}</span> {o.label}
          </label>
        ))}
        {missing.map((c) => (
          <label key={`${c.type}:${c.id}`} className="schedule-check">
            <input type="checkbox" checked onChange={() => toggleContext(c)} />
            <span className="schedule-muted">(지워짐)</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="schedule-trigger">
        <legend>주기</legend>
        <div className="schedule-radios" role="radiogroup" aria-label="주기">
          {TRIGGER_KINDS.map((t) => (
            <label key={t.kind}>
              <input type="radio" name="schedule-trigger" checked={d.triggerKind === t.kind} onChange={() => onChange({ triggerKind: t.kind })} />
              {t.label}
            </label>
          ))}
        </div>
        {d.triggerKind === 'weekly' && (
          <div className="schedule-days" role="group" aria-label="요일">
            {WEEKDAY_ORDER.map((day) => (
              <label key={day} className="schedule-check">
                <input
                  type="checkbox"
                  checked={d.days.includes(day)}
                  onChange={() => onChange({ days: d.days.includes(day) ? d.days.filter((x) => x !== day) : [...d.days, day] })}
                />
                {weekdayName(day)}
              </label>
            ))}
          </div>
        )}
        {(d.triggerKind === 'daily' || d.triggerKind === 'weekdays' || d.triggerKind === 'weekly') && (
          <label className="settings-field">
            시각
            <input aria-label="정기 실행 시각" type="time" value={d.time} onChange={(e) => onChange({ time: e.target.value })} />
          </label>
        )}
        {d.triggerKind === 'hourly' && (
          <div className="settings-grid">
            <label className="settings-field">
              몇 시간마다
              <select aria-label="몇 시간마다" value={d.everyHours} onChange={(e) => onChange({ everyHours: Number(e.target.value) as HourlyStep })}>
                {HOURLY_STEPS.map((n) => <option key={n} value={n}>{n}시간</option>)}
              </select>
            </label>
            <label className="settings-field">
              분
              <input aria-label="정기 실행 분" type="number" min={0} max={59} value={d.minute} onChange={(e) => onChange({ minute: Number(e.target.value) })} />
            </label>
          </div>
        )}
        {d.triggerKind === 'cron' && (
          <label className="settings-field">
            cron 식 (분 시 일 월 요일)
            <input aria-label="cron 식" className="path-text" value={d.cron} onChange={(e) => onChange({ cron: e.target.value })} />
          </label>
        )}
        <p role="status" className={props.preview?.ok === false ? 'schedule-preview form-error' : 'schedule-preview'}>
          {props.preview === null ? '다음 실행을 계산하는 중…'
            : props.preview.ok ? `다음: ${props.preview.next.map((t) => dayTimeLabel(t, props.now)).join(' · ')}`
              : props.preview.error}
        </p>
      </fieldset>

      <fieldset className="schedule-mode">
        <legend>대화</legend>
        <div className="schedule-radios" role="radiogroup" aria-label="대화 방식">
          {([['new', '매번 새 대화'], ['continue', '한 대화를 이어 감']] as Array<[ScheduleConversationMode, string]>).map(([mode, label]) => (
            <label key={mode}>
              <input type="radio" name="schedule-mode" checked={d.conversationMode === mode} onChange={() => onChange({ conversationMode: mode })} />
              {label}
            </label>
          ))}
        </div>
        {props.breaks && <p className="settings-warning">다음 실행부터 새 대화로 시작합니다 — 이어 가던 대화는 그 agent·작업 디렉토리의 것입니다.</p>}
      </fieldset>

      <div className="schedule-actions">
        {props.raising ? (
          <>
            <p className="settings-warning">
              전체 허용은 <strong>사람이 보지 않는 시각에</strong> 셸 명령을 제한 없이 실행합니다.
            </p>
            {canSave
              ? <ConfirmButton label="저장" confirmLabel="전체 허용으로 저장합니다 — 한 번 더" onConfirm={props.onSave} />
              : <button type="button" disabled>저장</button>}
          </>
        ) : (
          <button type="button" className="report-btn report-btn-primary" disabled={!canSave} onClick={props.onSave}>저장</button>
        )}
        {props.onRunNow && <button type="button" className="report-btn" disabled={props.busy} onClick={props.onRunNow}>지금 실행</button>}
        {props.onDelete && (
          <ConfirmButton label="삭제" confirmLabel="정말 삭제" ariaLabel="정기 실행 삭제" className="report-btn schedule-delete" onConfirm={props.onDelete} />
        )}
      </div>
    </form>
  )
}
