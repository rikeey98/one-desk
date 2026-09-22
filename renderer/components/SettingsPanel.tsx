import { useCallback, useEffect, useRef, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import { ConfirmButton } from './ConfirmButton'
import { PERMISSION_LABELS } from '../permission'
import { RepoTab, type RepoDraft } from './settings/RepoTab'
import { AgentStatusList } from './AgentStatusList'
import { ModelField } from './ModelField'
import { EFFORT_OPTIONS, effortFieldOf } from '../effort'
import { InfoTab } from './settings/InfoTab'
import type {
  AgentKind, AgentProbes, AgentStatuses, AppInfo, GlobalRoots, McpStatus, Permission,
  QueueSnapshot, Repo, RevealTarget, Workspace
} from '@shared/models'

/**
 * 탭은 **값의 범위**로 가른다 (spec FR-2). 실행·repo는 지금 고른 workspace 하나에,
 * 앱은 장비 전체에 걸린다. 정보는 읽기 전용이다. intent가 꼽은 "어디서 바꾸는지
 * 모르겠다"에 대한 답이 탭 이름이 아니라 이 구분이다.
 */
type SettingsTab = 'run' | 'app' | 'repo' | 'info'
const TABS: ReadonlyArray<readonly [SettingsTab, string]> = [
  ['run', '실행'],
  ['app', '앱'],
  ['repo', 'repo'],
  ['info', '정보']
]

/** 줄바꿈 텍스트를 경로 목록으로. 빈 줄과 앞뒤 공백은 버린다 */
function toList(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean)
}

/**
 * 앱 설정 화면. 탭 넷 — 실행(고른 workspace의 기본값과 CLI 경로), 앱(글로벌 asset
 * 경로 등 장비 전체), repo, 정보.
 *
 * 모달이 아니라 **본문 영역을 대신 차지한다** — 전체 설계 §509가 모달을 피하는 근거는
 * "뒤의 목록을 계속 만질 수 있어야 한다"인데, 설정은 목록을 보며 고칠 화면이 아니다.
 *
 * **모든 입력의 초안 state가 이 컴포넌트에 있다.** 탭은 보이는 것만 바꾸고 state는
 * 건드리지 않는다 — 그래야 탭을 옮겼다 돌아와도 고치던 값이 남는다 (spec FR-11). 절을
 * 자식 컴포넌트로 떼어내며 state를 함께 내리면 탭 전환이 곧 언마운트가 되어 입력이
 * 사라진다. 테스트 "탭을 옮겼다 돌아와도 고치던 입력이 그대로다"가 이것을 고정한다.
 *
 * 전체 설계 §403이 "workspace 기본값은 설정 화면에서 바꾼다"고 정했고, 그 화면이
 * 여기다. workspace를 고르지 않았으면 실행 탭은 안내만 남긴다.
 */
function draftOf(r: Repo): RepoDraft {
  return { name: r.name, path: r.path, description: r.description ?? '' }
}

export function SettingsPanel({
  workspaces, workspaceId, onWorkspaceSaved, queue, onChangeLimit, repos, refreshRepos, mcpStatus
}: {
  /** App이 useWorkspaces()로 한 번만 조회해 내려준다 — 여기서 따로 조회하면
   *  사이드바에서 만든 workspace를 이 화면이 모르는 상태가 생긴다(App.tsx의 주석). */
  workspaces: Workspace[]
  /** 지금 고른 workspace. null이면 실행 탭을 열 수 없다. */
  workspaceId: string | null
  /** 저장이 끝나면 부른다. App이 목록을 다시 읽어야 RunPanel이 새 기본값을 쓴다. */
  onWorkspaceSaved: () => void
  /**
   * 전역 실행 슬롯 스냅샷. App이 useQueue()로 한 번만 받아 도크와 여기에 같이
   * 내려준다 — 상한은 도크의 슬롯 표시기에도 있고(spec FR-7), 둘이 같은 스냅샷을
   * 봐야 한쪽에서 바꾼 값이 다른 쪽에 곧바로 보인다. 아직 못 받았으면 null.
   */
  queue: QueueSnapshot | null
  /** 상한을 바꾼다. 실패는 던진다 — 이 화면은 그 이유를 칸 옆에 보여준다(FR-12). */
  onChangeLimit: (n: number) => Promise<void>
  /** 지금 고른 workspace의 repo. App이 useRepos()로 한 번만 받아 RepoStrip과 여기에 내려준다. */
  repos: Repo[]
  /** 저장 뒤 부른다 — RepoStrip과 실행 패널의 cwd 목록이 새 경로를 봐야 한다. */
  refreshRepos: () => Promise<void>
  /** MCP 서버 상태. 사이드바 하단 줄과 같은 인스턴스(App의 useMcpStatus)를 본다. */
  mcpStatus: McpStatus
}) {
  const client = useClient()
  const [tab, setTab] = useState<SettingsTab>('run')

  const [claude, setClaude] = useState('')
  const [opencode, setOpencode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const workspace = workspaces.find((w) => w.id === workspaceId) ?? null
  const [agentKind, setAgentKind] = useState<AgentKind>('claude-code')
  const [modelClaude, setModelClaude] = useState('')
  const [modelOpencode, setModelOpencode] = useState('')
  const [effortClaude, setEffortClaude] = useState('')
  const [variantOpencode, setVariantOpencode] = useState('')
  const [permission, setPermission] = useState<Permission>('edit')
  const [defaultsError, setDefaultsError] = useState<string | null>(null)
  const [defaultsBusy, setDefaultsBusy] = useState(false)

  const [claudePath, setClaudePath] = useState('')
  const [opencodePath, setOpencodePath] = useState('')
  const [pathsError, setPathsError] = useState<string | null>(null)
  const [pathsBusy, setPathsBusy] = useState(false)
  const [agents, setAgents] = useState<AgentStatuses | null>(null)
  // 느린 칸은 따로 담는다 — 빠른 칸이 그것을 기다리면 workspace를 고를 때마다
  // 실행 파일 줄까지 1초씩 비어 있게 된다 (docs/sdlc/agent-setup/ FR-7).
  const [probes, setProbes] = useState<AgentProbes | null>(null)
  const [probing, setProbing] = useState(false)

  // repo 탭의 초안. 탭 컴포넌트가 아니라 여기 있어야 탭을 옮겨도 남는다(FR-11).
  const [repoDrafts, setRepoDrafts] = useState<Record<string, RepoDraft>>({})
  const [repoErrors, setRepoErrors] = useState<Record<string, string>>({})
  const [repoBusyId, setRepoBusyId] = useState<string | null>(null)
  // 마지막으로 초안을 만들 때 본 행. 행이 바뀐 repo만 초안을 다시 세운다 — 목록을
  // 다시 읽을 때마다 전부 세우면 다른 줄에서 고치던 값이 지워진다.
  const seededRef = useRef<Record<string, Repo>>({})
  useEffect(() => {
    setRepoDrafts((prev) => {
      const next: Record<string, RepoDraft> = {}
      for (const r of repos) {
        const seen = seededRef.current[r.id]
        const changed = !seen || seen.name !== r.name || seen.path !== r.path || seen.description !== r.description
        next[r.id] = changed || !prev[r.id] ? draftOf(r) : prev[r.id]!
        seededRef.current[r.id] = r
      }
      for (const id of Object.keys(seededRef.current)) {
        if (!repos.some((r) => r.id === id)) delete seededRef.current[id]
      }
      return next
    })
  }, [repos])

  function changeRepoDraft(id: string, patch: Partial<RepoDraft>) {
    setRepoDrafts((prev) => ({ ...prev, [id]: { ...prev[id]!, ...patch } }))
  }

  async function saveRepo(id: string): Promise<void> {
    const draft = repoDrafts[id]
    if (!draft) return
    setRepoBusyId(id)
    setRepoErrors((prev) => { const next = { ...prev }; delete next[id]; return next })
    try {
      // 셋을 전부 보낸다 — 바뀐 것만 고르면 "무엇이 덮이는지"가 흐려진다(updateDefaults와 같은 규칙).
      await client.repos.update({
        id, name: draft.name, path: draft.path, description: draft.description.trim() || null
      })
      await refreshRepos()
    } catch (err) {
      // 입력은 지우지 않는다(FR-12). 없는 경로를 넣었다면 그 문장이 그대로 보인다.
      setRepoErrors((prev) => ({ ...prev, [id]: err instanceof Error ? err.message : String(err) }))
    } finally {
      setRepoBusyId(null)
    }
  }

  // 정보 탭. 마운트 때 한 번 읽는다 — 글로벌 경로와 같은 이유다.
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [revealError, setRevealError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    client.app.info()
      .then((next) => { if (alive) setInfo(next) })
      .catch((err: unknown) => {
        if (alive) setInfoError(err instanceof Error ? err.message : String(err))
      })
    return () => { alive = false }
  }, [client])

  async function reveal(target: RevealTarget): Promise<void> {
    setRevealError(null)
    try {
      await client.app.reveal(target)
    } catch (err) {
      // 조용히 아무 일도 안 일어나면 탐색기가 없는 것인지 버튼이 죽은 것인지 모른다.
      setRevealError(err instanceof Error ? err.message : String(err))
    }
  }

  const [limitDraft, setLimitDraft] = useState('')
  const [limitError, setLimitError] = useState<string | null>(null)
  const [limitBusy, setLimitBusy] = useState(false)
  // 성공한 저장은 event:queueUpdate로 돌아와 queue prop을 바꾼다 — 도크에서 바꾼
  // 값도 같은 길로 온다. 그래서 칸은 자기 결과가 아니라 스냅샷을 따른다.
  const limit = queue?.limit
  useEffect(() => {
    if (limit !== undefined) setLimitDraft(String(limit))
  }, [limit])

  const applyWorkspace = useCallback((w: Workspace) => {
    setAgentKind(w.defaultAgentKind)
    // null이 "CLI 기본값에 맡긴다"이고, 화면에서는 빈 칸이 그 뜻이다.
    setModelClaude(w.defaultModelClaude ?? '')
    setModelOpencode(w.defaultModelOpencode ?? '')
    // effort도 같은 규칙이다 — null이 "CLI 자신의 기본값"이고 빈 칸이 그 뜻이다.
    setEffortClaude(w.defaultEffortClaude ?? '')
    setVariantOpencode(w.defaultVariantOpencode ?? '')
    setPermission(w.defaultPermission)
    // 경로도 같다 — null이면 어댑터가 PATH를 뒤진다.
    setClaudePath(w.claudePath ?? '')
    setOpencodePath(w.opencodePath ?? '')
  }, [])

  /**
   * 마지막으로 보낸 조회만 화면에 반영한다. workspace를 빠르게 옮기면 앞선
   * 조회가 늦게 도착해 다른 workspace의 결과를 덮어쓴다 — 없는 경로를 고쳤는데
   * 계속 빨간 줄이 남아 있는 것처럼 보인다.
   */
  const checkSeq = useRef(0)
  const check = useCallback(async (id: string) => {
    const seq = ++checkSeq.current
    try {
      const next = await client.workspaces.checkAgents(id)
      if (seq === checkSeq.current) setAgents(next)
    } catch (err) {
      // 조회 실패는 저장 오류와 같은 자리에 둔다 — 둘 다 "CLI 경로" 절의 일이다.
      if (seq === checkSeq.current) {
        setAgents(null)
        setPathsError(err instanceof Error ? err.message : String(err))
      }
    }
  }, [client])

  /**
   * 느린 칸 — 인증과 모델. `check`와 **따로** 돈다.
   *
   * 늦게 온 결과가 최신을 덮지 않도록 순번을 따로 쥔다(`check`와 같은 가드).
   * workspace를 빠르게 옮기면 앞선 조회가 1초 뒤에 도착해 다른 workspace의
   * 상태를 덮어쓴다.
   *
   * **실패해도 화면을 비우지 않는다** — 빠른 칸은 이미 그려져 있고, 이 칸만
   * "확인할 수 없음"으로 남는다(FR-6).
   */
  const probeSeq = useRef(0)
  const probe = useCallback(async (id: string, refresh = false) => {
    const seq = ++probeSeq.current
    setProbing(true)
    try {
      const next = await client.workspaces.probeAgents(id, refresh)
      if (seq === probeSeq.current) setProbes(next)
    } catch {
      // core가 이미 어떤 실패도 unknown으로 돌려주므로 여기 오는 것은 IPC 자체가
      // 끊긴 경우다. 그때는 아무 말도 지어내지 않고 비워 둔다 — 화면은 "확인 중"
      // 대신 "아직 확인하지 않았습니다"로 돌아간다.
      if (seq === probeSeq.current) setProbes(null)
    } finally {
      if (seq === probeSeq.current) setProbing(false)
    }
  }, [client])

  /** `다시 확인` — 캐시를 버리고 빠른 칸까지 전부 다시 본다 */
  const refreshProbes = useCallback(async (id: string) => {
    await Promise.all([check(id), probe(id, true)])
  }, [check, probe])

  // 고른 workspace가 바뀌면 칸을 그 workspace의 값으로 다시 채운다. 이것이 없으면
  // 앞 workspace의 값이 남아 있다가 저장 버튼 한 번에 엉뚱한 workspace로 넘어간다.
  useEffect(() => {
    if (!workspace) return
    applyWorkspace(workspace)
    // 저장하기 전에도 지금 무엇이 잡히는지 보여야 한다 — 이 절에 오는 사람은
    // 대개 실행이 "찾을 수 없습니다"로 막혀서 온 사람이다 (설계 §595).
    void check(workspace.id)
    // 느린 칸도 자동으로 돈다. 사용자가 버튼을 눌러야만 보인다면 "대화 전에
    // 무엇이 붙는지 안다"는 약속이 성립하지 않는다 — 누르는 것을 잊는다.
    void probe(workspace.id)
  }, [workspace, applyWorkspace, check, probe])

  const apply = useCallback((roots: GlobalRoots) => {
    setClaude(roots.claude.join('\n'))
    setOpencode(roots.opencode.join('\n'))
  }, [])

  // 어느 탭이 열려 있든 마운트 때 한 번 읽는다 — 앱 탭을 열었을 때 이미 채워져 있고,
  // 탭을 오가도 다시 읽지 않는다(읽으면 고치던 값이 덮인다).
  useEffect(() => {
    let alive = true
    client.settings.globalRoots()
      .then((roots) => { if (alive) apply(roots) })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
    return () => { alive = false }
  }, [client, apply])

  async function save(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      // 돌려받은 값으로 다시 채운다 — core가 빈 목록을 기본값으로 되돌리므로
      // 저장 결과가 입력과 다를 수 있다.
      apply(await client.settings.setGlobalRoots({
        claude: toList(claude), opencode: toList(opencode)
      }))
    } catch (err) {
      // 입력은 지우지 않는다. 실패했는데 지우면 다시 타이핑해야 한다.
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function saveDefaults(): Promise<void> {
    if (!workspace) return
    setDefaultsBusy(true)
    setDefaultsError(null)
    try {
      // 돌려받은 값으로 다시 채운다 — core가 공백을 다듬고 빈 칸을 null로 돌리므로
      // 저장 결과가 입력과 다를 수 있다. 글로벌 경로 쪽과 같은 이유다.
      applyWorkspace(await client.workspaces.updateDefaults({
        id: workspace.id,
        defaultAgentKind: agentKind,
        defaultModelClaude: modelClaude,
        defaultModelOpencode: modelOpencode,
        defaultEffortClaude: effortClaude,
        defaultVariantOpencode: variantOpencode,
        defaultPermission: permission
      }))
      // App이 목록을 다시 읽어야 RunPanel이 새 기본값을 집는다. 이 호출이 빠지면
      // 저장은 됐는데 실행 패널은 앱을 다시 켤 때까지 옛 값을 쓴다.
      onWorkspaceSaved()
    } catch (err) {
      // 입력은 지우지 않는다. 실패했는데 지우면 다시 타이핑해야 한다.
      setDefaultsError(err instanceof Error ? err.message : String(err))
    } finally {
      setDefaultsBusy(false)
    }
  }

  /**
   * 전체 허용으로 **올리는** 중인가. 이미 전체 허용인 workspace를 다시 저장하는
   * 것은 바꾸는 것이 아니다 (전체 설계 §403).
   */
  const raisingToFull = permission === 'full' && workspace?.defaultPermission !== 'full'

  async function savePaths(): Promise<void> {
    if (!workspace) return
    setPathsBusy(true)
    setPathsError(null)
    try {
      applyWorkspace(await client.workspaces.updatePaths({
        id: workspace.id,
        claudePath,
        opencodePath
      }))
      onWorkspaceSaved()
      // 저장 자체는 경로가 쓸 만한지 보지 않는다(저장소 주석) — 판정은 실행을
      // 막는 것과 같은 preflight의 몫이고, 그 결과를 바로 여기에 보여준다.
      await check(workspace.id)
    } catch (err) {
      setPathsError(err instanceof Error ? err.message : String(err))
    } finally {
      setPathsBusy(false)
    }
  }

  async function saveLimit(): Promise<void> {
    const n = Number(limitDraft)
    setLimitError(null)
    // 저장소도 같은 검사를 하지만(setting.ts의 isValidLimit) IPC를 타기 전에 막는다 —
    // 숫자 칸에 0을 넣고 저장을 눌렀는데 아무 일도 없는 것처럼 보이면 안 된다.
    if (!Number.isInteger(n) || n < 1) {
      setLimitError('상한은 1 이상의 정수여야 합니다')
      return
    }
    setLimitBusy(true)
    try {
      await onChangeLimit(n)
    } catch (err) {
      // 입력은 지우지 않는다 — 글로벌 경로·기본값 저장과 같은 규칙이다.
      setLimitError(err instanceof Error ? err.message : String(err))
    } finally {
      setLimitBusy(false)
    }
  }

  return (
    <div className="settings">
      <h2>설정</h2>

      <div className="settings-tabs" role="tablist" aria-label="설정 탭">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`settings-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`settings-panel-${id}`}
            className={tab === id ? 'settings-tab settings-tab-selected' : 'settings-tab'}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 열린 탭의 내용만 그린다. state는 위에 있으므로 그리지 않는 탭의 입력도 살아
          있다 — 감추는 대신 언마운트하는 이유는 화면에 없는 입력이 getByLabelText
          같은 조회에 잡혀 같은 라벨끼리 부딪히지 않게 하려는 것이다. */}
      <div
        role="tabpanel"
        id={`settings-panel-${tab}`}
        aria-labelledby={`settings-tab-${tab}`}
        className="settings-tabpanel"
      >
        {tab === 'run' && (
          <>
            {defaultsError && <div role="alert" className="form-error">{defaultsError}</div>}
            {!workspace ? (
              <p className="settings-hint">왼쪽에서 workspace를 고르면 그 workspace의 실행 기본값을 정할 수 있습니다.</p>
            ) : (
              <>
                <p className="settings-scope">
                  <strong>{workspace.name}</strong> — 이 workspace에만 적용됩니다.
                </p>

                <h3>실행 기본값</h3>
                <p className="settings-hint">
                  새 실행이 이 값으로 시작합니다. 실행 패널에서 바꾼 것은 그 실행에만 적용됩니다.
                  모델을 비우면 CLI 자신의 기본값을 씁니다.
                </p>

                <label className="settings-field">
                  기본 agent
                  <select
                    aria-label="기본 agent"
                    value={agentKind}
                    onChange={(e) => setAgentKind(e.target.value as AgentKind)}
                  >
                    <option value="claude-code">Claude Code</option>
                    <option value="opencode">OpenCode</option>
                  </select>
                </label>

                {/* 모델 칸이 둘인 것은 두 CLI의 지정 형식이 다르기 때문이다 — 하나로 합치면
                    agent를 바꾼 순간 상대가 모르는 이름이 넘어간다 (전체 설계 §199).
                    effort/variant가 둘인 것도 **같은 이유다.** */}
                <div className="settings-grid">
                <ModelField
                  agentKind="claude-code"
                  label="Claude Code 기본 모델"
                  value={modelClaude}
                  onChange={setModelClaude}
                  probed={probes?.['claude-code'].models}
                  resolved={probes?.['claude-code'].model ?? null}
                />

                <ModelField
                  agentKind="opencode"
                  label="OpenCode 기본 모델"
                  value={modelOpencode}
                  onChange={setModelOpencode}
                  probed={probes?.opencode.models}
                  resolved={probes?.opencode.model ?? null}
                />
                </div>

                <div className="settings-grid">
                {/* claude는 다섯 단계가 정해져 있다(`--help`가 열거한다). */}
                <label className="settings-field">
                  Claude Code 기본 effort
                  <select
                    aria-label="Claude Code 기본 effort"
                    value={effortClaude}
                    onChange={(e) => setEffortClaude(e.target.value)}
                  >
                    {/* 목록에 없는 값(DB를 손으로 고친 경우)을 잃지 않는다 — select에
                        없는 값을 주면 브라우저가 ''로 정규화해 문제가 화면에서 사라진다.
                        작업 디렉토리 칸이 없는 경로를 보여주는 것과 같은 규칙이다. */}
                    {effortClaude && !EFFORT_OPTIONS.some((o) => o.value === effortClaude) && (
                      <option value={effortClaude}>{effortClaude} (표에 없는 값)</option>
                    )}
                    {EFFORT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </label>

                {/* opencode의 variant는 provider마다 값이 달라 표로 묶을 수 없다 —
                    묶으면 그 표가 거짓말이 된다(FR-13). */}
                <label className="settings-field">
                  OpenCode 기본 variant
                  <input
                    aria-label="OpenCode 기본 variant"
                    value={variantOpencode}
                    placeholder={effortFieldOf('opencode').hint}
                    onChange={(e) => setVariantOpencode(e.target.value)}
                  />
                </label>
                </div>

                <label className="settings-field">
                  기본 권한
                  <select
                    aria-label="기본 권한"
                    value={permission}
                    onChange={(e) => setPermission(e.target.value as Permission)}
                  >
                    {(Object.keys(PERMISSION_LABELS) as Permission[]).map((value) => (
                      <option key={value} value={value}>{PERMISSION_LABELS[value]}</option>
                    ))}
                  </select>
                </label>

                {/* 전체 설계 §403: workspace 기본값을 전체 허용으로 바꾸는 것은 **별도
                    확인 절차**를 거친다. run 하나를 전체 허용으로 돌리는 것(실행 패널의
                    드롭다운)과 달리, 이 값은 앞으로의 모든 새 실행에 걸리기 때문이다.

                    이미 전체 허용인 workspace에서 모델만 고칠 때는 묻지 않는다 — §403이
                    말하는 것은 "바꾸는" 순간이고, 무관한 저장마다 확인을 요구하면
                    사람이 확인 자체를 읽지 않게 된다. */}
                {raisingToFull ? (
                  <>
                    <p className="settings-warning">
                      전체 허용은 셸 명령까지 묻지 않고 승인합니다.
                      이 workspace의 <strong>앞으로의 모든 새 실행</strong>이 그렇게 시작합니다.
                    </p>
                    <ConfirmButton
                      label="기본값 저장"
                      confirmLabel="전체 허용으로 저장합니다 — 한 번 더"
                      onConfirm={() => void saveDefaults()}
                    />
                  </>
                ) : (
                  <button type="button" disabled={defaultsBusy} onClick={() => void saveDefaults()}>
                    기본값 저장
                  </button>
                )}

                <h3>CLI 경로</h3>
                {pathsError && <div role="alert" className="form-error">{pathsError}</div>}
                <p className="settings-hint">
                  비워두면 PATH에서 찾습니다. 실행이 &quot;찾을 수 없습니다&quot;로 막힐 때 여기에 절대 경로를 넣으세요.
                </p>

                <div className="settings-grid">
                <label className="settings-field">
                  Claude Code 실행 파일
                  <input
                    aria-label="Claude Code 실행 파일"
                    value={claudePath}
                    placeholder="PATH에서 찾기"
                    onChange={(e) => setClaudePath(e.target.value)}
                  />
                </label>

                <label className="settings-field">
                  OpenCode 실행 파일
                  <input
                    aria-label="OpenCode 실행 파일"
                    value={opencodePath}
                    placeholder="PATH에서 찾기"
                    onChange={(e) => setOpencodePath(e.target.value)}
                  />
                </label>
                </div>

                <button type="button" disabled={pathsBusy} onClick={() => void savePaths()}>
                  CLI 경로 저장
                </button>

                {/* 실행 파일 칸은 실행을 막는 것과 **같은 판정**이다 — 따로 구현하면
                    여기는 초록인데 실행 버튼은 막히는 상태가 생긴다. 인증·모델은
                    그 뒤에 붙는 느린 칸이고 따로 조회한다(FR-1·FR-7). */}
                <AgentStatusList
                  statuses={agents}
                  probes={probes}
                  busy={probing}
                  onRefresh={() => { if (workspace) void refreshProbes(workspace.id) }}
                />
              </>
            )}
          </>
        )}

        {tab === 'app' && (
          <>
            {error && <div role="alert" className="form-error">{error}</div>}
            <p className="settings-scope">이 장비 전체에 적용됩니다 — workspace와 무관합니다.</p>

            <h3>글로벌 asset 경로</h3>
            <p className="settings-hint">
              한 줄에 경로 하나. 여기에 있는 skill과 agent가 목록에 함께 보입니다.
              비워두면 기본값으로 돌아갑니다.
            </p>

            <div className="settings-grid">
            <label className="settings-field">
              Claude Code 글로벌 경로
              <textarea
                aria-label="Claude Code 글로벌 경로"
                value={claude}
                rows={4}
                onChange={(e) => setClaude(e.target.value)}
              />
            </label>

            <label className="settings-field">
              OpenCode 글로벌 경로
              <textarea
                aria-label="OpenCode 글로벌 경로"
                value={opencode}
                rows={3}
                onChange={(e) => setOpencode(e.target.value)}
              />
            </label>
            </div>

            <button type="button" disabled={busy} onClick={() => void save()}>저장</button>

            {/* 스냅샷이 아직 없으면 칸을 열지 않는다 — 빈 칸에 저장을 누르게 두면
                무엇을 덮는지 모른 채 쓰게 된다. 도크의 슬롯 표시기도 같은 조건으로 숨는다. */}
            {queue && (
              <>
                <h3>동시 실행 상한</h3>
                {limitError && <div role="alert" className="form-error">{limitError}</div>}
                <p className="settings-hint">
                  한 번에 도는 실행의 수. 초과분은 슬롯이 나면 순서대로 시작합니다.
                  도크의 슬롯 표시기에서도 같은 값을 바꿀 수 있습니다.
                </p>
                <label className="settings-field">
                  동시 실행 상한
                  <input
                    aria-label="동시 실행 상한"
                    type="number"
                    min={1}
                    value={limitDraft}
                    onChange={(e) => setLimitDraft(e.target.value)}
                  />
                </label>
                <button type="button" disabled={limitBusy} onClick={() => void saveLimit()}>
                  상한 저장
                </button>
              </>
            )}
          </>
        )}

        {tab === 'repo' && (
          !workspace ? (
            <p className="settings-hint">왼쪽에서 workspace를 고르면 그 workspace의 repo를 관리할 수 있습니다.</p>
          ) : (
            <>
              <p className="settings-scope">
                <strong>{workspace.name}</strong> — 이 workspace에만 적용됩니다.
              </p>
              <RepoTab
                repos={repos}
                drafts={repoDrafts}
                errors={repoErrors}
                busyId={repoBusyId}
                onChange={changeRepoDraft}
                onSave={(id) => void saveRepo(id)}
              />
            </>
          )
        )}

        {tab === 'info' && (
          <>
            <p className="settings-scope">읽기 전용입니다.</p>
            <InfoTab
              info={info}
              infoError={infoError}
              revealError={revealError}
              mcpStatus={mcpStatus}
              onReveal={(target) => void reveal(target)}
            />
          </>
        )}
      </div>
    </div>
  )
}
