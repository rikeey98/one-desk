import type { AgentProbes, AgentStatuses, HomeWorkspace } from '@shared/models'
import { AGENT_KINDS, AGENT_LABELS } from '../../agents'
import { AgentStatusRow, wslAgentLabel } from '../AgentStatusList'
import type { SetupState } from '../../home/setup'
import { SHORTCUTS, shortcutLabel } from '../../shortcut'
import { IconCheck } from '../icons'

/**
 * 처음 켰을 때 (`docs/sdlc/home/` FR-14~16) — 준비 단계 넷. 끝난 단계는 한 줄로 접힌다. 단계마다 가는 곳은 **이미 있는 자리**다:
 * ① 사이드바의 workspace 추가 폼 ② 사이드바의 repo 등록 폼(폼을 둘 두지 않는다 — WSL 버튼·폴더 선택이 거기 있다) ③ 설정 실행 탭
 * ④ 새 대화. CLI 칸은 설정 실행 탭·WSL 탭과 **같은 `AgentStatusRow`·같은 데이터**다 — 세 번째로 그리는 자리.
 *
 * 버튼 이름은 사이드바 폼의 `repo 등록`·`추가`·`폴더 선택`을 부분 문자열로 품지 않는다(NFR-3 — 같은 화면에 선다).
 */
export function HomeSetup({
  setup, workspaces, statuses, probes, probing, platform,
  onFocusWorkspaceAdd, onOpenRepoForm, onRefreshCli, onOpenSettings, onStartFirstConversation
}: {
  setup: SetupState
  workspaces: HomeWorkspace[]
  statuses: AgentStatuses | null
  probes: AgentProbes | null
  probing: boolean
  platform: string
  onFocusWorkspaceAdd: () => void
  onOpenRepoForm: () => void
  onRefreshCli: () => void
  onOpenSettings: () => void
  onStartFirstConversation: () => void
}) {
  const repoCount = workspaces.reduce((n, w) => n + w.repos.length, 0)
  const newConversation = SHORTCUTS.find((s) => s.action === 'new-conversation')
  return (
    <div className="home-setup">
      <section className="home-card home-setup-steps" aria-labelledby="home-setup-head">
        <header className="home-card-head">
          <h2 id="home-setup-head">시작하기</h2>
          <span className="home-card-meta">네 단계가 끝나면 다음부터 오늘 할 일이 보입니다</span>
        </header>
        <ol className="home-steps">
          <Step n={1} done={setup.workspace} title="워크스페이스 만들기" doneLabel={workspaces.map((w) => w.name).join(' · ')}>
            <p>일(회사 · 개인 프로젝트)을 가르는 가장 큰 단위입니다. 이름 하나면 됩니다.</p>
            <button type="button" className="home-primary" onClick={onFocusWorkspaceAdd}>워크스페이스 만들기</button>
          </Step>
          <Step n={2} done={setup.repo} title="폴더 연결하기" doneLabel={`repo ${repoCount}개`} disabled={!setup.workspace}>
            <p>agent가 작업할 git 폴더를 workspace에 등록합니다. WSL 안의 폴더도 됩니다.</p>
            <button type="button" className="home-primary" disabled={!setup.workspace} onClick={onOpenRepoForm}>폴더 연결하기</button>
          </Step>
          <Step n={3} done={setup.cli === 'ready'} title="CLI 확인" doneLabel="로그인된 CLI가 있습니다" disabled={!setup.workspace}>
            <p>Claude Code나 OpenCode 중 하나가 설치되고 로그인돼 있어야 합니다. 설정 화면의 CLI 상태와 같은 판정입니다.</p>
            {setup.workspace
              ? (
                <ul className="settings-status" aria-label="CLI 상태">
                  {AGENT_KINDS.map((kind) => (
                    <AgentStatusRow key={kind} label={AGENT_LABELS[kind]} status={statuses?.[kind] ?? null} probe={probes?.[kind] ?? null} busy={probing} />
                  ))}
                  {(statuses?.wsl || probes?.wsl) && (
                    <AgentStatusRow label={wslAgentLabel(statuses?.wsl?.distro ?? probes?.wsl?.distro ?? '')} status={statuses?.wsl ?? null} probe={probes?.wsl ?? null} busy={probing} />
                  )}
                </ul>
              )
              : <p className="home-row-faint">워크스페이스를 만들면 확인합니다.</p>}
            <div className="home-step-actions">
              <button type="button" disabled={!setup.workspace || probing} onClick={onRefreshCli}>다시 확인</button>
              <button type="button" onClick={onOpenSettings}>설정에서 경로 지정</button>
            </div>
          </Step>
          <Step n={4} done={setup.firstRun} title="첫 대화 보내기" doneLabel="대화를 보냈습니다" disabled={!setup.repo}>
            <p>이슈나 메모를 맥락에 담아 agent에게 지시를 보냅니다. 끝나면 결과가 인박스와 홈에 옵니다.</p>
            <button type="button" className="home-primary" disabled={!setup.repo} onClick={onStartFirstConversation}>
              첫 대화 보내기{newConversation ? ` (${shortcutLabel(newConversation, platform)})` : ''}
            </button>
          </Step>
        </ol>
      </section>
      <aside className="home-card home-setup-aside">
        <h2>이 앱이 하는 일</h2>
        <ul className="home-setup-about">
          <li>workspace · repo · 이슈 · 메모를 한 화면에서 관리합니다.</li>
          <li>필요한 맥락을 골라 CLI 코딩 agent(Claude Code · OpenCode)에게 넘겨 헤드리스로 돌립니다.</li>
          <li>결과는 앱에 기록되고, agent는 MCP로 이슈·메모를 직접 읽고 씁니다.</li>
        </ul>
        <h3>단축키</h3>
        <dl className="home-setup-keys">
          {SHORTCUTS.filter((s) => s.mod).slice(0, 4).map((s) => (
            <div key={s.action}><dt>{s.label}</dt><dd><kbd>{shortcutLabel(s, platform)}</kbd></dd></div>
          ))}
        </dl>
      </aside>
    </div>
  )
}

function Step({ n, done, title, doneLabel, disabled = false, children }: {
  n: number
  done: boolean
  title: string
  doneLabel: string
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <li className={done ? 'home-step home-step-done' : disabled ? 'home-step home-step-disabled' : 'home-step'} aria-current={!done && !disabled ? 'step' : undefined}>
      <span className="home-step-num" aria-hidden="true">{done ? <IconCheck /> : n}</span>
      <div className="home-step-body">
        <h3>{title}{done && <span className="home-step-done-label">{doneLabel}</span>}</h3>
        {!done && children}
      </div>
    </li>
  )
}
