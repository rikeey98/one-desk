import type { AgentEnv, Repo, WslDistros } from '@shared/models'
import { isWslUnc } from '@shared/wslPath'
import { describeWslPath } from '../../agentEnv'

/** repo 한 줄의 편집 중인 값. 초안 state는 SettingsPanel이 쥔다 (spec FR-11) */
export interface RepoDraft {
  name: string
  path: string
  description: string
  /** claude 실행 환경 (docs/sdlc/wsl-support/ FR-5) */
  agentEnv: AgentEnv
}

/**
 * 설정 화면의 repo 탭. 등록된 repo의 이름·경로·설명을 고친다 (spec FR-8).
 *
 * **state를 갖지 않는다.** 초안·오류·저장 중 여부는 전부 prop이다 — 탭을 옮기면 이
 * 컴포넌트는 언마운트되고, 그때 입력이 사라지지 않으려면 값이 부모에 있어야 한다.
 */
export function RepoTab({ repos, drafts, errors, busyId, wsl, onChange, onSave }: {
  repos: Repo[]
  drafts: Record<string, RepoDraft>
  errors: Record<string, string>
  busyId: string | null
  /** 설치된 WSL 배포판 (wsl-support FR-4). 아직 못 받았으면 null, `supported`가 false면 라디오를 그리지 않는다 */
  wsl: WslDistros | null
  onChange: (id: string, patch: Partial<RepoDraft>) => void
  onSave: (id: string) => void
}) {
  if (repos.length === 0) {
    return <p className="settings-hint">등록된 repo가 없습니다. 본문의 repo 줄에서 등록합니다.</p>
  }
  return (
    <>
      <p className="settings-hint">
        경로는 실행의 작업 디렉토리이자 skill·agent를 훑는 자리입니다. 바꾸면 그 아래 asset이 새
        경로로 따라갑니다.
      </p>
      {repos.map((r) => {
        const draft = drafts[r.id]
        if (!draft) return null
        const error = errors[r.id]
        // 경로가 바뀌는 중인지 — 저장 전에 알려야 한다. 세션은 특정 디렉토리에서 만든
        // 것이라(전체 설계 §362) 옛 대화를 이어가면 다른 곳을 가리키게 된다.
        const pathChanging = draft.path.trim() !== r.path
        return (
          <div key={r.id} className="settings-repo">
            <h3>{r.name}</h3>
            {error && <div role="alert" className="form-error">{error}</div>}
            <label className="settings-field">
              이름
              <input
                aria-label={`${r.name} 이름`}
                value={draft.name}
                onChange={(e) => onChange(r.id, { name: e.target.value })}
              />
            </label>
            <label className="settings-field">
              경로
              <input
                aria-label={`${r.name} 경로`}
                value={draft.path}
                onChange={(e) => onChange(r.id, { path: e.target.value })}
              />
            </label>
            <label className="settings-field">
              설명
              <input
                aria-label={`${r.name} 설명`}
                value={draft.description}
                onChange={(e) => onChange(r.id, { description: e.target.value })}
              />
            </label>
            {pathChanging && (
              <p className="settings-warning">
                경로를 바꾸면 이 repo에서 <strong>이어가던 대화</strong>는 다른 디렉토리를 가리키게
                됩니다. 옛 경로에서 만든 세션은 새 경로에서 이어지지 않을 수 있습니다.
              </p>
            )}
            {/* claude 실행 환경 (docs/sdlc/wsl-support/ FR-6). Windows에서만 — 다른 OS에서는 저장도 거부된다(FR-4). */}
            {wsl?.supported && (
              <AgentEnvField repo={r} draft={draft} distros={wsl.distros} onChange={(agentEnv) => onChange(r.id, { agentEnv })} />
            )}
            <button
              type="button"
              disabled={busyId === r.id}
              aria-label={`${r.name} 저장`}
              onClick={() => onSave(r.id)}
            >
              저장
            </button>
          </div>
        )
      })}
    </>
  )
}

/**
 * `claude 실행 환경` 라디오와 그 아래 안내 (FR-6). WSL이면 경로의 파싱 결과(배포판 · Linux 경로)나 거부 문구, 목록에 없는
 * 배포판이면 경고(저장은 막지 않는다 — 잠시 꺼져 있을 수 있다). host인데 WSL 폴더면 Windows의 claude가 돈다고 안내한다.
 */
function AgentEnvField({ repo, draft, distros, onChange }: {
  repo: Repo
  draft: RepoDraft
  distros: string[]
  onChange: (agentEnv: AgentEnv) => void
}) {
  const parsed = draft.agentEnv === 'wsl' ? describeWslPath(draft.path) : null
  const unknownDistro = parsed?.ok === true
    && !distros.some((d) => d.toLowerCase() === parsed.distro.toLowerCase())
  return (
    <>
      <fieldset className="settings-radios" role="radiogroup" aria-label={`${repo.name} claude 실행 환경`}>
        <legend>claude 실행 환경</legend>
        {(['host', 'wsl'] as const).map((value) => (
          <label key={value} className="settings-radio">
            <input
              type="radio"
              name={`agent-env-${repo.id}`}
              value={value}
              checked={draft.agentEnv === value}
              onChange={() => onChange(value)}
            />
            {value === 'host' ? 'Windows' : 'WSL'}
          </label>
        ))}
      </fieldset>
      {parsed && (parsed.ok
        ? <p className="settings-hint path-text">배포판 {parsed.distro} · {parsed.linuxPath}</p>
        : <p className="settings-warning">{parsed.reason}</p>)}
      {unknownDistro && (
        <p className="settings-warning">이 배포판이 wsl --list에 없습니다 — 꺼져 있거나 이름이 다를 수 있습니다.</p>
      )}
      {draft.agentEnv === 'host' && isWslUnc(draft.path) && (
        <p className="settings-hint">
          WSL 폴더입니다 — Windows의 claude가 이 경로에서 돕니다. WSL 안의 claude를 쓰려면 실행 환경을 바꾸세요.
        </p>
      )}
    </>
  )
}
