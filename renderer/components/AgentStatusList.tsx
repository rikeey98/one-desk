import type { AgentKind, AgentProbe, AgentProbes, AgentStatus, AgentStatuses } from '@shared/models'

/** CLI 상태 줄의 순서와 이름. 실행 패널의 agent 드롭다운과 같은 순서다. */
const AGENT_LABELS: ReadonlyArray<readonly [AgentKind, string]> = [
  ['claude-code', 'Claude Code'],
  ['opencode', 'OpenCode']
]

/**
 * "이 CLI로 지금 대화가 되는가" (docs/sdlc/agent-setup/ FR-1·FR-3·FR-7).
 *
 * **빠른 칸과 느린 칸을 따로 받는다.** `statuses`(실행 파일)는 파일 검사라 즉시
 * 오고, `probes`(인증·모델)는 1~1.6초가 걸린다. 느린 쪽이 아직 null이어도 빠른
 * 쪽은 이미 그려져 있어야 한다 — 합쳐 기다리면 workspace를 고를 때마다 이 블록이
 * 통째로 비어 있게 된다(FR-7).
 *
 * **세 상태를 서로 다른 말로 적는다**(FR-3). 특히 "자격 증명이 0개다"와 "조회를
 * 못 했다"는 같은 칸에 들어가면 안 된다 — 앞은 사용자가 고칠 일이고 뒤는 우리가
 * 모른다는 뜻이다.
 */
export function AgentStatusList({
  statuses, probes, busy, onRefresh
}: {
  /** 빠른 칸. 아직 못 받았으면 null */
  statuses: AgentStatuses | null
  /** 느린 칸. 아직 못 받았으면 null */
  probes: AgentProbes | null
  busy: boolean
  onRefresh: () => void
}) {
  return (
    <>
      <div className="settings-status-head">
        <h3>CLI 상태</h3>
        <button type="button" disabled={busy} onClick={onRefresh}>
          {busy ? '확인 중…' : '다시 확인'}
        </button>
      </div>
      <p className="settings-hint">
        지금 이 workspace로 실행하면 어느 CLI가 어떻게 잡히는지 보여줍니다.
        모델 이름이 실제로 쓸 수 있는 것인지까지는 확인하지 않습니다 — 그것은
        첫 실행에서 드러납니다.
      </p>
      <ul className="settings-status" aria-label="CLI 상태">
        {AGENT_LABELS.map(([kind, label]) => (
          <AgentRow
            key={kind}
            label={label}
            status={statuses?.[kind] ?? null}
            probe={probes?.[kind] ?? null}
            busy={busy}
          />
        ))}
      </ul>
    </>
  )
}

function AgentRow({
  label, status, probe, busy
}: {
  label: string
  status: AgentStatus | null
  probe: AgentProbe | null
  busy: boolean
}) {
  // 실행 파일이 없으면 그것만 말한다. 뒤의 칸은 core도 돌리지 않았다.
  const blocked = status !== null && !status.ok
  const ready = status?.ok === true && probe?.auth.state === 'ok'

  return (
    <li className={ready ? 'settings-status-ok' : blocked ? 'settings-status-bad' : 'settings-status-wait'}>
      <span className="settings-status-name">{label}</span>
      <span className="settings-status-head-line">{headline(status, probe, busy)}</span>
      {status?.ok && (
        <span className="settings-status-detail">
          {status.executable}
          {probe?.version && ` · v${probe.version}`}
        </span>
      )}
      {blocked && <span className="settings-status-detail">{status.reason ?? '확인할 수 없습니다'}</span>}
      {status?.ok && probe && <AuthLine probe={probe} />}
      {status?.ok && probe && <ModelLine probe={probe} />}
    </li>
  )
}

/** 줄 머리 — 한눈에 읽히는 한 마디 */
function headline(status: AgentStatus | null, probe: AgentProbe | null, busy: boolean): string {
  if (!status) return busy ? '확인 중…' : '아직 확인하지 않았습니다'
  if (!status.ok) return '실행할 수 없습니다'
  if (!probe) return '확인 중…'
  if (probe.auth.state === 'none') return '로그인 필요'
  if (probe.auth.state === 'unknown') return '인증 확인 불가'
  // 여기까지 오면 쓸 수 있다. 모델 이름이 있으면 그것이 가장 쓸모 있는 한 마디다.
  return probe.model.state === 'resolved' ? probe.model.model : '준비됨'
}

function AuthLine({ probe }: { probe: AgentProbe }) {
  const { auth } = probe
  if (auth.state === 'ok') {
    const detail = [auth.method, auth.plan].filter(Boolean).join(' · ')
    return <span className="settings-status-detail">로그인됨{detail && ` (${detail})`}</span>
  }
  if (auth.state === 'none') {
    return <span className="settings-status-detail">{auth.hint}</span>
  }
  // **`none`과 다른 문구여야 한다**(FR-3). 조회 실패를 "로그인 안 됨"으로 적으면
  // 멀쩡히 돌아가는 설치본에 거짓말을 하게 된다.
  return <span className="settings-status-detail">인증 상태를 확인하지 못했습니다: {auth.reason}</span>
}

function ModelLine({ probe }: { probe: AgentProbe }) {
  const { model } = probe
  if (model.state === 'resolved') {
    // "이 모델로 돕니다"가 아니다 — init은 모델을 검증하지 않는다(2026-09-22 실측).
    return <span className="settings-status-detail">모델: {model.model} 이름으로 넘어갑니다</span>
  }
  const prefix = model.state === 'skipped' ? '모델은 확인하지 않았습니다' : '모델을 확인하지 못했습니다'
  return <span className="settings-status-detail">{prefix}: {model.reason}</span>
}
