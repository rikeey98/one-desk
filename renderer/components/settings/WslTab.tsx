import { AgentStatusRow, wslAgentLabel } from '../AgentStatusList'
import { wslRepoRowsOf } from '../../agentEnv'
import { parseWslPath } from '@shared/wslPath'
import type { AgentProbes, AgentStatuses, Repo, Workspace, WslDistros } from '@shared/models'

/** 한 절의 칸 하나 — 초안·오류·저장 중은 SettingsPanel이 쥔다(settings-screen FR-11) */
export interface WslField {
  draft: string
  error: string | null
  busy: boolean
  onChange: (value: string) => void
  onSave: () => void
}

/**
 * 설정 화면의 WSL 탭 (`docs/sdlc/wsl-repo-setup/` FR-7·8). 흩어져 있던 WSL 설정을 모은다 — 배포판 · 그 안의 claude · 그것을 쓰는
 * repo · skill 경로, 의존 순서다.
 *
 * **state를 갖지 않는다**(RepoTab과 같다) — 탭을 옮기면 언마운트되고, 그때 고치던 경로가 사라지지 않으려면 값이 부모에 있어야
 * 한다. 탭은 값의 범위로 가른다는 규칙의 예외라(FR-7) workspace에 걸린 절은 제목이 그 workspace를 말한다.
 */
export function WslTab({ wsl, workspace, repos, statuses, probes, checking, onRefresh, claudePath, roots, onOpenRepo }: {
  wsl: WslDistros
  /** 지금 고른 workspace. null이면 workspace에 걸린 두 칸(claude 상태·WSL repo)이 안내만 남긴다 */
  workspace: Workspace | null
  repos: Repo[]
  /** 실행 탭의 CLI 상태와 같은 조회의 결과 — `wsl` 칸만 쓴다 */
  statuses: AgentStatuses | null
  probes: AgentProbes | null
  /** 배포판 목록이나 CLI 상태를 다시 묻는 중 */
  checking: boolean
  onRefresh: () => void
  claudePath: WslField
  roots: WslField
  /** repo 탭으로 옮겨 그 repo의 실행 환경에 포커스를 준다 (FR-9) */
  onOpenRepo: (repoId: string) => void
}) {
  const rows = wslRepoRowsOf(repos)
  // 상태 줄은 실행 탭과 같은 조회다 — workspace의 첫 WSL repo의 배포판으로 묻는다(wsl-support FR-13). 그 repo가 없으면 묻지 않는다:
  // 미리 보려면 WSL VM을 깨워야 해서다(spec §5의 1).
  const firstWsl = repos.find((r) => r.agentEnv === 'wsl')
  const statusDistro = statuses?.wsl?.distro ?? probes?.wsl?.distro ?? (firstWsl ? parseWslPath(firstWsl.path)?.distro : undefined) ?? ''

  return (
    <>
      <div className="settings-scope settings-scope-row">
        <p>이 장비 전체에 적용됩니다 — <strong>WSL repo</strong> 목록만 지금 고른 workspace의 것입니다.</p>
        <button type="button" className="settings-secondary" disabled={checking} onClick={onRefresh}>
          {checking ? '확인 중…' : '다시 확인'}
        </button>
      </div>

      <h3>배포판</h3>
      {wsl.distros.length > 0 ? (
        <>
          <ul className="wsl-distros" aria-label="WSL 배포판">
            {wsl.distros.map((d) => (
              <li key={d} className={d === wsl.defaultDistro ? 'wsl-distro wsl-distro-default' : 'wsl-distro'}>
                <span className="path-text">{d}</span>
                {d === wsl.defaultDistro && <span className="wsl-distro-tag">기본</span>}
              </li>
            ))}
          </ul>
          <p className="settings-hint">
            WSL repo는 그 경로의 배포판 안에서 claude·git·터미널을 띄웁니다. 사이드바의 repo 등록에서 <strong>WSL</strong> 버튼을
            누르면 {wsl.defaultDistro ? '기본 배포판' : '첫 배포판'}의 홈 폴더에서 고릅니다.
          </p>
        </>
      ) : (
        <div className="settings-empty" role="status">
          {wsl.reason ? (
            <>
              <p className="settings-empty-title">배포판 목록을 얻지 못했습니다</p>
              <p className="settings-empty-hint">{wsl.reason} — WSL이 켜져 있는지 본 뒤 위의 다시 확인을 누르세요.</p>
            </>
          ) : (
            <>
              <p className="settings-empty-title">이 PC에 WSL 배포판이 없습니다</p>
              <p className="settings-empty-hint">
                WSL 안의 repo를 WSL의 claude로 돌리려면 먼저 배포판을 설치합니다. PowerShell에서{' '}
                <code className="settings-code">wsl --install</code> 을 실행한 뒤 위의 다시 확인을 누르세요.
              </p>
            </>
          )}
        </div>
      )}

      <h3>WSL 안의 claude</h3>
      <p className="settings-hint">
        WSL repo의 대화는 Windows가 아니라 <strong>배포판 안의 claude</strong>로 돕니다 — 로그인·환경변수도 그쪽의 것이고, Bedrock
        변수는 WSL의 ~/.profile에 둡니다.
      </p>
      {!workspace ? (
        <p className="settings-hint">왼쪽에서 workspace를 고르면 그 workspace의 WSL repo로 claude를 확인합니다.</p>
      ) : !firstWsl ? (
        <p className="settings-note">
          {workspace.name}에 WSL repo가 없어 아직 확인하지 않았습니다. WSL repo를 등록하면 그 배포판의 claude를 여기서 확인합니다.
        </p>
      ) : (
        // 실행 탭 CLI 상태의 WSL 줄과 같은 컴포넌트·같은 데이터다 — 따로 묻지 않는다(FR-8의 2)
        <ul className="settings-status wsl-status" aria-label="WSL claude 상태">
          <AgentStatusRow
            label={wslAgentLabel(statusDistro)}
            status={statuses?.wsl ?? null}
            probe={probes?.wsl ?? null}
            busy={checking}
          />
        </ul>
      )}

      {claudePath.error && <div role="alert" className="form-error">{claudePath.error}</div>}
      <label className="settings-field settings-field-wide">
        WSL claude 경로
        <input
          aria-label="WSL claude 경로"
          className="path-input wsl-path-input"
          value={claudePath.draft}
          placeholder="비우면 배포판의 로그인 셸 PATH에서 찾습니다"
          onChange={(e) => claudePath.onChange(e.target.value)}
        />
      </label>
      <p className="settings-hint settings-hint-under">
        WSL <strong>안</strong>의 Linux 경로(예: /home/me/.local/bin/claude). 모든 WSL repo가 이것을 씁니다.
      </p>
      <button type="button" disabled={claudePath.busy} onClick={claudePath.onSave}>
        WSL claude 경로 저장
      </button>

      <h3>
        WSL repo
        {workspace && <span className="settings-h3-scope"> — {workspace.name}</span>}
      </h3>
      {!workspace ? (
        <p className="settings-hint">왼쪽에서 workspace를 고르면 그 workspace의 WSL repo가 보입니다.</p>
      ) : rows.length === 0 ? (
        <div className="settings-empty">
          <p className="settings-empty-title">이 workspace에는 WSL repo가 없습니다</p>
          <p className="settings-empty-hint">
            사이드바의 <strong>repo 등록</strong>에서 <strong>WSL</strong> 버튼으로 WSL 안의 폴더를 고르면, 실행 환경까지 WSL로
            맞춰 등록됩니다.
          </p>
        </div>
      ) : (
        <ul className="wsl-repos" aria-label="WSL repo">
          {rows.map((row) => (
            <li key={row.repo.id} className="wsl-repo">
              <div className="wsl-repo-line">
                <span className="wsl-repo-name">{row.repo.name}</span>
                <span className={row.agentEnv === 'wsl' ? 'wsl-repo-env' : 'wsl-repo-env wsl-repo-env-host'}>
                  {row.agentEnv === 'wsl' ? 'WSL claude' : 'Windows claude'}
                </span>
                {/* 이름에 "<이름> repo"를 품지 않는다 — 사이드바 카드의 이름(`api repo`)과 부분 일치로 부딪힌다(spec NFR-1) */}
                <button
                  type="button"
                  className="settings-secondary wsl-repo-open"
                  aria-label={`${row.repo.name}: repo 탭에서 열기`}
                  onClick={() => onOpenRepo(row.repo.id)}
                >
                  repo 탭에서 열기
                </button>
              </div>
              <span className="wsl-repo-path path-text" title={row.repo.path}>
                {row.distro ? `${row.distro} · ${row.linuxPath}` : row.repo.path}
              </span>
              {row.agentEnv === 'host' && (
                <span className="wsl-repo-note">WSL 폴더지만 Windows의 claude가 돕니다 — repo 탭에서 실행 환경을 WSL로 바꿀 수 있습니다.</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3>WSL 글로벌 skill 경로</h3>
      {roots.error && <div role="alert" className="form-error">{roots.error}</div>}
      <p className="settings-hint">
        한 줄에 Linux 경로 하나. ~는 그 배포판의 홈입니다. WSL repo가 있는 workspace에서 그 배포판마다 훑습니다.
        비워두면 기본값으로 돌아갑니다.
      </p>
      <label className="settings-field settings-field-wide">
        WSL 글로벌 skill 경로
        <textarea
          aria-label="WSL 글로벌 skill 경로"
          className="path-input"
          value={roots.draft}
          rows={3}
          onChange={(e) => roots.onChange(e.target.value)}
        />
      </label>
      <button type="button" disabled={roots.busy} onClick={roots.onSave}>
        WSL 글로벌 skill 경로 저장
      </button>
    </>
  )
}
