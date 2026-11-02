import { useCallback, useEffect, useRef, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import { useHome } from '../hooks/useHome'
import { useCliReadiness } from '../hooks/useCliReadiness'
import { useNow } from '../hooks/useNow'
import { useItemChanged } from '../hooks/useItemChanged'
import { AgentStatusRow, wslAgentLabel } from './AgentStatusList'
import { AGENT_KINDS, AGENT_LABELS } from '../agents'
import { PERMISSION_LABELS } from '../permission'
import { planUsageView } from '../planUsage'
import { formatDuration } from '../timeline'
import { AGENT_ACTIVITY_TRIGGER_ID } from '../agentActivity'
import { groupConfigFiles, type ConfigFileRow } from '../configFiles'
import { IconClose } from './icons'
import type {
  AppInfo, ConfigFile, McpStatus, PlanUsage, QueueSnapshot, Repo, RevealTarget, Workspace
} from '@shared/models'

/**
 * 에이전트 현황 (`docs/sdlc/agent-status/` FR-3~FR-9) — 사이드바 하단 줄을 누르면 뜨는 패널. 한 화면에 넷이다:
 * 지금 도는 것 · 에이전트 설치(CLI 판정) · 실행 환경(기본값) · 설정 파일.
 *
 * **새 판정을 만들지 않는다.** 도는 것은 홈 요약(`useHome`), 설치는 설정 실행 탭·홈 준비 단계와 같은 `useCliReadiness`와
 * `AgentStatusRow`, 실행 환경은 App의 workspace 목록, 설정 파일만 새 통로(`app.configFiles`)다 — 따로 판정하면 패널과 설정
 * 화면이 같은 CLI를 다른 말로 부른다.
 *
 * 모달이 아니라 `popover`다 — 뒤의 화면을 막지 않는다. Esc와 바깥 누르기로 닫는다. 열린 동안만 마운트한다(닫히면 CLI를
 * 다시 묻지 않는다).
 */
export function AgentActivityPanel({
  workspaces, workspaceId, mcpStatus, queue, planUsage, onOpenConversation, onOpenSettings, onClose
}: {
  /** App의 useWorkspaces 인스턴스 — 실행 환경 절이 설정에서 저장한 기본값을 본다 */
  workspaces: Workspace[]
  /** 고른 workspace. 없으면 첫 workspace를 기준으로 판정한다(CLI 판정이 workspace의 경로 설정을 타기 때문이다) */
  workspaceId: string | null
  mcpStatus: McpStatus
  queue: QueueSnapshot | null
  planUsage: PlanUsage | null
  onOpenConversation: (workspaceId: string, conversationId: string) => void
  onOpenSettings: () => void
  onClose: () => void
}) {
  const client = useClient()
  const ref = useRef<HTMLDivElement>(null)
  const target = workspaces.find((w) => w.id === workspaceId) ?? workspaces[0] ?? null
  const targetId = target?.id ?? null

  const { summary, error: summaryError } = useHome(true)
  const cli = useCliReadiness(targetId, true)
  const now = useNow((summary?.running.length ?? 0) > 0)

  const [info, setInfo] = useState<AppInfo | null>(null)
  const [files, setFiles] = useState<ConfigFile[] | null>(null)
  const [repos, setRepos] = useState<Repo[]>([])
  const [filesError, setFilesError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const seq = useRef(0)

  const loadFiles = useCallback(async () => {
    const mine = ++seq.current
    try {
      const [nextFiles, nextRepos] = await Promise.all([
        client.app.configFiles(targetId),
        targetId === null ? Promise.resolve([]) : client.repos.list(targetId)
      ])
      if (mine !== seq.current) return
      setFiles(nextFiles)
      setRepos(nextRepos)
      setFilesError(null)
    } catch (err) {
      if (mine !== seq.current) return
      setFilesError(err instanceof Error ? err.message : String(err))
    }
  }, [client, targetId])

  useEffect(() => { void loadFiles() }, [loadFiles])
  // repo를 등록·삭제·옮기면 그 repo의 설정 파일 묶음이 따라간다
  useItemChanged(targetId, 'repo', loadFiles)

  useEffect(() => {
    let alive = true
    client.app.info().then((next) => { if (alive) setInfo(next) }).catch(() => {})
    return () => { alive = false }
  }, [client])

  useEffect(() => {
    const el = ref.current
    // jsdom에는 popover API가 없다 — 그때는 보통 요소로 보인다(단축키 목록과 같은 규칙).
    el?.showPopover?.()
    el?.focus()
    return () => { el?.hidePopover?.() }
  }, [])

  // 바깥 누르기로 닫는다. 하단 줄 버튼은 안쪽이다 — 바깥으로 치면 누르는 순간 닫혔다가 click이 다시 연다.
  const latestClose = useRef(onClose)
  latestClose.current = onClose
  useEffect(() => {
    function onPointerDown(e: Event) {
      const node = e.target as Node | null
      if (!node) return
      if (ref.current?.contains(node)) return
      if (node instanceof Element && node.closest(`#${AGENT_ACTIVITY_TRIGGER_ID}`)) return
      latestClose.current()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown) }
  }, [])

  function close() {
    onClose()
    document.getElementById(AGENT_ACTIVITY_TRIGGER_ID)?.focus()
  }

  async function openFile(file: ConfigFile) {
    setActionError(null)
    try {
      await client.app.openConfigFile({ key: file.key, repoId: file.repoId })
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  async function reveal(where: RevealTarget) {
    setActionError(null)
    try {
      await client.app.reveal(where)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  const running = summary?.running ?? []
  const usage = planUsage ? planUsageView(planUsage, Date.now()) : null
  const groups = files ? groupConfigFiles(files, repos) : []

  return (
    <div
      ref={ref}
      className="agent-activity-panel"
      role="dialog"
      aria-label="에이전트 현황"
      tabIndex={-1}
      popover="manual"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        // 안쪽부터 푼다 — 단축키 목록·대화 메뉴와 같다(conversation-timeline FR-39)
        e.preventDefault()
        e.stopPropagation()
        close()
      }}
    >
      <header className="agent-activity-head">
        <span>에이전트 현황</span>
        <button type="button" className="row-action" aria-label="에이전트 현황 닫기" title="닫기 (Esc)" onClick={close}>
          <IconClose />
        </button>
      </header>

      <div className="agent-activity-body">
        <section aria-labelledby="activity-live-head">
          <h3 id="activity-live-head">지금 동작</h3>
          <dl className="activity-facts">
            <div>
              <dt>MCP 서버</dt>
              <dd className={`activity-mcp activity-mcp-${mcpStatus.state}`}>
                {mcpStatus.state === 'listening' ? `포트 ${mcpStatus.port}에서 받는 중`
                  : mcpStatus.state === 'starting' ? '시작 중'
                  : `연결 실패 — ${mcpStatus.message}`}
              </dd>
            </div>
            <div>
              <dt>실행 슬롯</dt>
              <dd>
                {queue ? `${queue.running}/${queue.limit} 사용` : '확인 중…'}
                {queue && queue.waiting > 0 && ` · 기다리는 턴 ${queue.waiting}`}
              </dd>
            </div>
            {usage && (
              <div>
                <dt>요금제</dt>
                <dd className={usage.warn ? 'plan-usage-warn' : undefined} title={usage.title}>{usage.label.replace(/^요금제 /, '')}</dd>
              </div>
            )}
          </dl>
          {summaryError && <div role="alert" className="form-error">{summaryError}</div>}
          {running.length === 0
            ? <p className="activity-empty">{summary ? '돌고 있는 대화 없음' : '불러오는 중…'}</p>
            : (
              <ul className="activity-runs">
                {running.map((r) => (
                  <li key={r.runId} className="activity-run">
                    <span className="status-dot status-running" aria-hidden="true" />
                    <div className="activity-run-body">
                      <div className="activity-run-title">{r.title}</div>
                      <div className="activity-run-sub">
                        <span className="path-text">{r.repoName ? `${r.workspaceName} · ${r.repoName}` : r.workspaceName}</span>
                        {r.currentTool && <span className="home-row-tool">{r.currentTool}</span>}
                        {r.startedAt !== null && <span>{formatDuration(now - r.startedAt)}</span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="activity-run-open"
                      aria-label={`${r.title} 대화로 가기`}
                      onClick={() => { onClose(); onOpenConversation(r.workspaceId, r.conversationId) }}
                    >
                      열기
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </section>

        <section aria-labelledby="activity-install-head">
          <div className="activity-section-head">
            <h3 id="activity-install-head">에이전트 설치</h3>
            {cli.probing && <span role="status" className="settings-checking"><span className="turn-spinner" aria-hidden="true" />확인 중…</span>}
            {targetId !== null && (
              <button type="button" className="activity-link" aria-label="에이전트 설치 다시 확인" disabled={cli.probing} onClick={cli.refresh}>
                다시 확인
              </button>
            )}
          </div>
          {target === null
            ? <p className="activity-empty">workspace를 만들면 확인합니다</p>
            : (
              <ul className="settings-status activity-cli" aria-label="에이전트 설치 판정">
                {AGENT_KINDS.map((kind) => (
                  <AgentStatusRow
                    key={kind}
                    label={AGENT_LABELS[kind]}
                    status={cli.statuses?.[kind] ?? null}
                    probe={cli.probes?.[kind] ?? null}
                    busy={cli.probing}
                  />
                ))}
                {(cli.statuses?.wsl || cli.probes?.wsl) && (
                  <AgentStatusRow
                    label={wslAgentLabel(cli.statuses?.wsl?.distro ?? cli.probes?.wsl?.distro ?? '')}
                    status={cli.statuses?.wsl ?? null}
                    probe={cli.probes?.wsl ?? null}
                    busy={cli.probing}
                  />
                )}
              </ul>
            )}
        </section>

        <section aria-labelledby="activity-env-head">
          <div className="activity-section-head">
            <h3 id="activity-env-head">실행 환경</h3>
            <button type="button" className="activity-link" onClick={() => { onClose(); onOpenSettings() }}>설정 열기</button>
          </div>
          <dl className="activity-facts">
            {target && (
              <>
                <div><dt>workspace</dt><dd>{target.name}</dd></div>
                <div><dt>기본 agent</dt><dd>{AGENT_LABELS[target.defaultAgentKind]}</dd></div>
                <div><dt>기본 모델</dt><dd>{defaultModelOf(target)}</dd></div>
                <div><dt>{target.defaultAgentKind === 'opencode' ? 'variant' : 'effort'}</dt><dd>{defaultEffortOf(target)}</dd></div>
                <div><dt>기본 권한</dt><dd>{PERMISSION_LABELS[target.defaultPermission]}</dd></div>
              </>
            )}
            {queue && <div><dt>동시 실행</dt><dd>최대 {queue.limit}개</dd></div>}
            <div><dt>앱</dt><dd>{info ? `v${info.version}` : '…'} · {platformLabel(navigator.platform)}</dd></div>
          </dl>
        </section>

        <section aria-labelledby="activity-files-head">
          <h3 id="activity-files-head">설정 파일</h3>
          {filesError && <div role="alert" className="form-error">{filesError}</div>}
          {actionError && <div role="alert" className="form-error">{actionError}</div>}
          {files === null && !filesError && <p className="activity-empty">불러오는 중…</p>}
          {groups.map((group) => (
            <div key={group.id} className="activity-files-group">
              <div className="activity-files-title">{group.title}</div>
              {group.rows.length === 0
                ? <p className="activity-empty">repo 설정 파일 없음</p>
                : (
                  <ul className="activity-files">
                    {group.rows.map((row) => (
                      <FileRow key={`${row.file.key}:${row.file.repoId ?? ''}`} row={row} scope={group.id === 'app' ? null : group.title} onOpen={(f) => void openFile(f)} />
                    ))}
                  </ul>
                )}
            </div>
          ))}
          <div className="activity-files-group">
            <div className="activity-files-title">one-desk</div>
            <div className="activity-folder-actions">
              <button type="button" onClick={() => void reveal('data')}>앱 데이터 폴더</button>
              <button type="button" onClick={() => void reveal('logs')}>실행 로그 폴더</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

/** 설정 파일 한 줄 — 있으면 누르면 OS 기본 앱으로 열리고, 없으면 그 자리만 보인다 */
function FileRow({ row, scope, onOpen }: {
  row: ConfigFileRow
  /** repo 묶음이면 그 이름 — 버튼 이름이 repo마다 갈리게 한다 */
  scope: string | null
  onOpen: (file: ConfigFile) => void
}) {
  const name = scope ? `${scope} · ${row.label}` : row.label
  return (
    <li className={row.file.exists ? 'activity-file' : 'activity-file activity-file-missing'}>
      <div className="activity-file-body">
        <span className="activity-file-label">{row.label}</span>
        <span className="activity-file-path path-text" title={row.file.path}>{row.shown}</span>
      </div>
      {row.file.exists
        ? <button type="button" aria-label={`${name} 파일 열기`} onClick={() => onOpen(row.file)}>열기</button>
        : <span className="activity-file-none">없음</span>}
    </li>
  )
}

function defaultModelOf(w: Workspace): string {
  const model = w.defaultAgentKind === 'opencode' ? w.defaultModelOpencode : w.defaultModelClaude
  return model ?? 'CLI 기본값'
}

function defaultEffortOf(w: Workspace): string {
  const value = w.defaultAgentKind === 'opencode' ? w.defaultVariantOpencode : w.defaultEffortClaude
  return value ?? 'CLI 기본값'
}

/** `navigator.platform`의 사람이 읽는 이름 */
export function platformLabel(platform: string): string {
  if (/^win/i.test(platform)) return 'Windows'
  if (/^mac/i.test(platform)) return 'macOS'
  if (/linux/i.test(platform)) return 'Linux'
  return platform || '알 수 없는 OS'
}
