import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from './db/open'
import { createWorkspaceRepository } from './db/repositories/workspace'
import { createRepoRepository } from './db/repositories/repo'
import { createAssetRepository } from './db/repositories/asset'
import { createAssetService } from './assets/service'
import { readAssetBody } from './assets/body'
import { createCommandService } from './commands/service'
import { createAgentProbeService } from './agent/service'
import { createModelCatalog } from './agent/models'
import { checkAuth } from './agent/auth'
import { runCli } from './agent/exec'
import { probeCommands } from './commands/probe'
import { describeCommands } from './commands/describe'
import type { GlobalRoots } from './db/repositories/setting'
import type {
  UpdateRepoInput, AppPaths, FileSearchInput, BuildReportInput, ReportData, FileTreeInput, FileRef, FileSaveInput
} from '@shared/models'
import { PANEL_KINDS, type PanelScope } from '@shared/panelWindow'
import { createFileService } from './files/service'
import { createTerminalService, type SpawnPty } from './terminal/service'
import { resolveShell, shellEnv, type ShellLookup } from './terminal/shell'
import { findExecutable } from './runner/executable'
import { taskkillTree, taskkillTreeSync } from './runner/terminate'
import { buildReport } from './reports/build'
import { createIssueRepository } from './db/repositories/issue'
import { createMemoRepository } from './db/repositories/memo'
import { createRunRepository } from './db/repositories/run'
import { createRunManager } from './runner/manager'
import { createExecutionService } from './execution'
import { claudeCodeAdapter } from './runner/adapters/claudeCode'
import { opencodeAdapter } from './runner/adapters/opencode'
import { resolveAgentPath } from './runner/agentPath'
import { findVscodeExecutable, newWindowArgs } from './editor/vscodeLaunch'
import { vscodeFolderUrl } from './editor/vscodeUrl'
import type { AgentProbes, AgentStatuses } from '@shared/models'
import { createSettingRepository } from './db/repositories/setting'
import { createRunQueue } from './runner/queue'
import { createMcpHost } from './mcp/host'
import {
  notifyingIssues, notifyingMemos, notifyingAssets, notifyingRepos, notifyingWorkspaces,
  announcingAssignedConversations, type Notify
} from './changes'
import { consoleErrorSink, type ErrorSink } from './errors'
import type { AgentAdapter } from './runner/types'
import type { RunEvent } from '@shared/events'
import type {
  AgentKind, AgentPaths, InboxCounts, ItemChange, McpStatus, PlanUsage, QueueSnapshot, Run, TerminalData, TerminalExit, TerminalOpenInput,
  TerminalShellSetting, Workspace
} from '@shared/models'

/**
 * agent 종류 → 어댑터. **밖으로 꺼낸 이유는 테스트가 이 한 줄을 볼 수 있게
 * 하기 위해서다** — 배선(맵 한 줄)은 그 자체로 되돌릴 수 있는 변이이고,
 * 과거 두 단계에서 새어나간 자리는 예외 없이 이런 한 줄이었다.
 */
export function createAdapters(): Record<AgentKind, AgentAdapter> {
  return {
    'claude-code': claudeCodeAdapter,
    opencode: opencodeAdapter
  }
}

export interface CoreOptions {
  /** DB와 로그를 둘 디렉토리. Electron의 userData 경로를 main이 넘긴다. */
  dataDir: string
  /** 마이그레이션 디렉토리 (패키징 시 위치가 달라진다) */
  migrationsDir: string
  /**
   * MCP stdio 브리지의 경로 (패키징 시 위치가 달라진다).
   *
   * 생략하면 `core/mcp/bridge.mjs`를 이 파일 기준으로 찾는다 — 테스트와
   * `pnpm dev`가 그 경로로 돈다. 패키징된 앱은 main이 resourcesPath를 넘긴다.
   */
  bridgePath?: string
  /** 브리지를 띄울 실행 파일. 기본은 현재 프로세스(패키징 앱에서는 Electron 바이너리). */
  execPath?: string
  /**
   * 사용자 홈 디렉토리. 글로벌 asset 경로의 기본값이 여기서 나온다.
   *
   * **`core/`가 스스로 알지 않는다.** `os.homedir()`를 여기서 부르면 테스트가 개발자의
   * 실제 홈을 훑게 되어 사람마다 결과가 달라진다. main이 `app.getPath('home')`을 넘기고,
   * 테스트는 임시 디렉토리를 넘긴다. 선택 인자로 두지 않는다 — 빠뜨리면 글로벌 경로가
   * 조용히 비고, 그것이 이번에 고치려던 증상 그 자체다.
   */
  homeDir: string
  /**
   * 코드 칸 터미널의 pty를 띄우는 함수 — main이 `node-pty`의 `spawn`을 넘긴다(docs/sdlc/code-editor/terminal-spec.md FR-21).
   * 네이티브 모듈이라 core가 직접 import하지 않고 받는다 — 단위 테스트는 가짜를 넘긴다. **선택 인자로 두지 않는다** — main의
   * 한 줄을 빠뜨려도 조용히 컴파일되면 터미널만 죽는다(`homeDir`와 같은 규칙).
   */
  spawnPty: SpawnPty
  /** core가 삼킨 오류를 흘려보낼 곳. 기본은 stderr */
  onError?: ErrorSink
}

const RUN_EVENT = 'run-event'
const RUN_UPDATE = 'run-update'
const QUEUE_UPDATE = 'queue-update'
const INBOX_UPDATE = 'inbox-update'
const MCP_STATUS = 'mcp-status'
const PLAN_USAGE = 'plan-usage'
const ITEM_CHANGED = 'item-changed'
const TERMINAL_DATA = 'terminal-data'
const TERMINAL_EXIT = 'terminal-exit'

export function createCore(opts: CoreOptions) {
  const onError = opts.onError ?? consoleErrorSink

  // 정보 탭이 보여주는 경로는 여기서 실제로 여는 것과 같은 값이어야 한다 — 따로
  // 조립하면 어긋난 자리를 아무도 못 본다.
  const dbFile = join(opts.dataDir, 'one-desk.db')
  const logDir = join(opts.dataDir, 'logs')

  const db = openDb({
    file: dbFile,
    migrationsDir: opts.migrationsDir
  })

  const emitter = new EventEmitter()

  /**
   * 바뀜 알림 (docs/sdlc/item-windows/ spec FR-17). 저장소를 **여기서 한 번** 감싸고, 감싼 것을 IPC 표면과
   * MCP `deps`에 같이 넘긴다 — MCP 쪽만 맨 저장소를 받으면 agent가 고친 것이 패널 창에 안 보인다.
   * 리스너가 던지면 삼킨다: 쓰기는 이미 끝났고, 알림 하나 때문에 그 쓰기가 실패로 보이면 안 된다.
   */
  const notify: Notify = (change) => {
    try { emitter.emit(ITEM_CHANGED, change) } catch (err) { onError('바뀜 알림 실패', err) }
  }
  const workspaces = notifyingWorkspaces(createWorkspaceRepository(db), notify)
  const runs = createRunRepository(db)
  // 할당된 대화의 이슈 이름·삭제를 대화 화면이 곧바로 따라간다 (docs/sdlc/conversation-issue/ FR-26).
  // 알림이 던져도 쓰기는 이미 끝났다 — notify와 같이 삼킨다.
  const issues = announcingAssignedConversations(
    notifyingIssues(createIssueRepository(db), notify),
    runs,
    (run) => {
      try { emitter.emit(RUN_UPDATE, run) } catch (err) { onError('대화 갱신 알림 실패', err) }
    }
  )
  const memos = notifyingMemos(createMemoRepository(db), notify)
  const repos = notifyingRepos(createRepoRepository(db), notify)
  const assetRows = notifyingAssets(createAssetRepository(db), notify)
  const settings = createSettingRepository(db, opts.homeDir)
  /**
   * 실행 파일 경로의 유일한 해석 자리 — 실행·설정 화면·슬래시 커맨드·인증 확인이 전부 여기를 탄다.
   * 앱 기본값은 매번 읽는다(설정에서 바뀐다). `docs/sdlc/agent-path-default/` FR-1.
   */
  const agentPathOf = (kind: AgentKind, workspace: Workspace | null) =>
    resolveAgentPath(kind, workspace, settings.agentPaths())

  const commands = createCommandService({
    probe: async ({ workspaceId, cwd }) => {
      const workspace = workspaces.list().find((w) => w.id === workspaceId) ?? null
      const resolved = await claudeCodeAdapter.preflight(agentPathOf('claude-code', workspace))
      const result = resolved.ok && resolved.executable
        ? await probeCommands({ executable: resolved.executable, cwd })
        : {
            slashCommands: [], terminalSlashCommands: [], plugins: [],
            model: null, version: null,
            error: resolved.reason ?? 'claude 실행 파일을 찾을 수 없습니다'
          }
      if (result.error) onError('커맨드 목록 조회 실패', new Error(result.error))
      return result
    },
    describe: (input) => describeCommands({ ...input, homeDir: opts.homeDir }),
    // 실패를 캐시할 때 적어 두고, 로그인한 뒤 그 실패를 버리는 데 쓴다
    // (docs/sdlc/command-cache-auth/ FR-2·FR-3). 실행 파일 해석은 probe와 같은 길이다.
    checkAuth: async ({ workspaceId }) => {
      const workspace = workspaces.list().find((w) => w.id === workspaceId) ?? null
      const resolved = await claudeCodeAdapter.preflight(agentPathOf('claude-code', workspace))
      if (!resolved.ok || !resolved.executable) return 'unknown'
      return (await checkAuth('claude-code', resolved.executable, runCli)).state
    }
  })

  const rawAssetService = createAssetService({
    assets: assetRows,
    repos,
    // 설정에서 바뀌므로 매번 읽는다.
    globalRoots: () => {
      const roots = settings.globalRoots()
      return [...roots.claude, ...roots.opencode]
    },
    // repo가 없는 workspace에도 글로벌은 보여야 하므로 workspace 저장소에서 받는다.
    workspaceIds: () => workspaces.list().map((w) => w.id)
  })

  /**
   * 스캔이 끝나면 그 workspace의 asset 목록이 바뀌었을 수 있다 — 한 번 알린다(FR-17). 스캔이 쓰는 저장소
   * 메서드(upsert·prune·move)는 래퍼가 감싸지 않으므로 행마다 알리지 않는다.
   */
  const assetService = {
    ...rawAssetService,
    async scanAll() {
      await rawAssetService.scanAll()
      for (const w of workspaces.list()) notify({ workspaceId: w.id, kind: 'asset' })
    },
    async scanWorkspace(workspaceId: string) {
      await rawAssetService.scanWorkspace(workspaceId)
      notify({ workspaceId, kind: 'asset' })
    },
    async scanRepo(workspaceId: string, repoId: string) {
      await rawAssetService.scanRepo(workspaceId, repoId)
      notify({ workspaceId, kind: 'asset' })
    }
  }

  // 부팅 스캔 (설계 §3-2). await하지 않는다 — 앱이 뜨는 것을 막지 않는다.
  // 실패해도 앱은 정상이고 목록만 낡으므로 onError로 흘려보낸다.
  void assetService.scanAll().catch((err: unknown) => onError('asset 부팅 스캔 실패', err))

  // 앱 시작 시 유령 run 정리 (설계 §11). 프로세스가 없는데 running/pending으로
  // 남아 있는 run은 이전 실행이 비정상 종료된 흔적이다.
  runs.reapStale()

  const mcp = createMcpHost({
    deps: { repos, issues, memos, runs },
    configDir: join(opts.dataDir, 'mcp'),
    execPath: opts.execPath ?? process.execPath,
    // 번들되지 않는 원본 .mjs다 — import.meta.url 기준으로 찾는다.
    bridgePath: opts.bridgePath ?? fileURLToPath(new URL('./mcp/bridge.mjs', import.meta.url)),
    onError
  })

  const adapters = createAdapters()
  /**
   * 모델 목록 조회. 실행 파일마다 캐시하므로 설정 화면과 실행 패널이 나눠 쓴다.
   */
  const modelCatalog = createModelCatalog(runCli)

  /**
   * 준비 상태의 느린 칸들 (docs/sdlc/agent-setup/).
   *
   * **`checkAgents`와 나란히 두되 합치지 않는다.** 그쪽은 파일 검사뿐이라 즉시
   * 답하고, 이쪽은 1~1.6초가 걸린다. 합치면 workspace를 고를 때마다 화면이
   * 그만큼 비어 있게 된다(spec NFR-4).
   *
   * 실행 파일 해석은 `checkAgents`와 **같은 길**을 탄다 — 갈라지면 한 화면 안에서
   * 두 줄이 다른 말을 한다.
   */
  const agentProbes = createAgentProbeService({
    preflight: (kind, workspaceId) => {
      const workspace = workspaces.list().find((w) => w.id === workspaceId) ?? null
      return adapters[kind].preflight(agentPathOf(kind, workspace))
    },
    checkAuth: (kind, executable) => checkAuth(kind, executable, runCli),
    // 슬래시 커맨드 probe와 **같은 캐시**다 — 실행 패널이 이미 돌렸으면 CLI가
    // 새로 뜨지 않는다(spec NFR-3).
    agentInfo: (target) => commands.agentInfo(target),
    listModels: (kind, executable) => modelCatalog.list(kind, executable),
    // 실행 패널이 cwd를 고르는 규칙과 같다 (StartRunInput.cwd의 주석).
    firstRepoPath: (workspaceId) => repos.list(workspaceId)[0]?.path ?? null
  })


  const queue = createRunQueue({
    limit: settings.concurrencyLimit(),
    onChange: (snapshot) => emitter.emit(QUEUE_UPDATE, snapshot)
  })

  let planUsage: PlanUsage | null = null
  const manager = createRunManager({
    adapters,
    logDir,
    onEvent: (event) => emitter.emit(RUN_EVENT, event),
    onError,
    // 계정의 것이라 run이 아니라 앱에 매단다. **메모리의 마지막 값 하나뿐이다** — 저장하지 않는다
    // (docs/sdlc/plan-usage/ FR-1). 여러 run이 동시에 돌면 마지막으로 온 것이 이긴다(FR-6).
    onPlanUsage: (usage) => {
      planUsage = usage
      emitter.emit(PLAN_USAGE, usage)
    }
  })

  /**
   * `@` 파일 참조 (docs/sdlc/input-triggers/). 피커의 검색과 보낼 때의 해석이 **같은 서비스**다 —
   * 같은 git 목록을 봐야 피커에 없는 `.env`가 손으로 치면 실리는 일이 없다.
   */
  const files = createFileService({ getRepo: (id) => repos.get(id) })

  /**
   * 코드 칸의 터미널 (docs/sdlc/code-editor/terminal-spec.md) — repo마다 셸 하나. 셸 경로는 설정(비면 기본값)에서, repo 경로는
   * 그 workspace의 repo에서 여기서 정한다 — 렌더러는 repo id만 넘긴다(FR-18).
   */
  const shellLookup = (): ShellLookup => ({
    platform: process.platform, env: process.env, find: (name) => findExecutable(name)
  })
  const terminal = createTerminalService({
    spawnPty: opts.spawnPty,
    resolveShell: () => resolveShell(settings.terminalShell(), shellLookup()),
    repoOf: (workspaceId, repoId) => {
      const repo = repos.get(repoId)
      if (repo.workspaceId !== workspaceId) throw new Error(`이 workspace의 repo가 아닙니다: ${repoId}`)
      return repo
    },
    env: () => shellEnv(process.env),
    killTree: taskkillTree,
    killTreeSync: taskkillTreeSync,
    platform: process.platform,
    onData: (data) => {
      try { emitter.emit(TERMINAL_DATA, data) } catch (err) { onError('터미널 출력 알림 실패', err) }
    },
    onExit: (exit) => {
      try { emitter.emit(TERMINAL_EXIT, exit) } catch (err) { onError('터미널 끝남 알림 실패', err) }
    },
    onError
  })

  const execution = createExecutionService({
    db,
    runs,
    manager,
    queue,
    mcp,
    onError,
    // 이 한 줄이 빠지면 멘션이 전부 중화될 뿐 아무것도 실리지 않는다 — 실패가 조용하다.
    files,
    resolveExecutable: async (agentKind, workspaceId) => {
      const ws = workspaces.list().find((w) => w.id === workspaceId) ?? null
      return adapters[agentKind].preflight(agentPathOf(agentKind, ws))
    },
    verifyRunnable: async (agentKind, input) => {
      const adapter = adapters[agentKind]
      return adapter.verifyRunnable ? adapter.verifyRunnable(input) : { ok: true }
    },
    onRunUpdate: (run) => {
      emitter.emit(RUN_UPDATE, run)
      // 종료·취소·확인 표시가 전부 이 경로를 지난다.
      emitInbox()
      // 끝난 run이면 그 workspace를 다시 훑는다. agent가 실행 중에 만든 skill 파일이
      // 새로고침 없이 목록에 뜬다. 확인함/보관 같은 후속 갱신으로는 돌지 않는다.
      if (run.endedAt !== null) {
        void assetService.scanWorkspace(run.workspaceId)
          .catch((err: unknown) => onError('run 후 asset 재스캔 실패', err))
      }
    }
  })

  /**
   * 인박스 소속이 바뀔 수 있는 쓰기 뒤마다 부른다.
   * 배지는 항상 보이므로 push가 필요하다 — run 하나 단위인 onRunUpdate로는
   * 전역 카운트를 표현할 수 없고, 렌더러는 현재 workspace의 run만 안다.
   */
  function emitInbox(): void {
    emitter.emit(INBOX_UPDATE, runs.inboxCounts())
  }

  // MCP 서버를 부팅과 함께 띄운다. **await하지 않는다** — 포트 하나 때문에
  // 창이 늦게 뜰 이유가 없다. start()는 던지지 않고 실패를 상태로 남기므로,
  // 여기서 할 일은 결과를 화면 쪽으로 흘려보내는 것뿐이다.
  void mcp.start().then((status) => { emitter.emit(MCP_STATUS, status) })

  return {
    /**
     * repo와 같은 이유로 저장소에 한 가지를 얹는다 — IPC 핸들러를 얇게 두려면
     * 조합이 여기 있어야 한다.
     */
    workspaces: {
      ...workspaces,

      /** 지우기 전에 그 아래 repo의 셸을 끝낸다 — 지우고 나면 repo 목록이 cascade로 사라진다 (terminal-spec FR-10) */
      remove(id: string) {
        const owned = repos.list(id)
        const result = workspaces.remove(id)
        for (const repo of owned) terminal.killRepo(repo.id)
        return result
      },

      /**
       * 지금 이 workspace로 실행하면 두 CLI가 각각 어디서 잡히는가 (설계 §595).
       *
       * **실행 서비스의 `resolveExecutable`과 같은 판정을 쓴다.** 따로 구현하면
       * 설정 화면은 초록인데 실행 버튼은 막히는(또는 그 반대의) 상태가 생긴다.
       * 그래서 `resolveAgentPath` → 어댑터 `preflight`를 그대로 탄다 —
       * `ONE_DESK_AGENT_PATH`가 잡혀 있으면 그것이 이기는 것까지 같다.
       *
       * 대부분 파일 접근 검사와 PATH 탐색뿐이라 값싸다. **예외는 opencode의 버전 확인**
       * (`docs/sdlc/conversation-fixes/` spec FR-17)이다 — 처음 한 번은 `--version`을
       * 띄우지만 (경로, 크기, mtime)으로 캐시하므로 그 뒤에는 stat만 한다. 그 캐시는
       * 실행과 나눠 쓴다(같은 preflight다).
       */
      async checkAgents(workspaceId: string): Promise<AgentStatuses> {
        const ws = workspaces.list().find((w) => w.id === workspaceId) ?? null
        const [claude, opencode] = await Promise.all([
          adapters['claude-code'].preflight(agentPathOf('claude-code', ws)),
          adapters['opencode'].preflight(agentPathOf('opencode', ws))
        ])
        return { 'claude-code': claude, opencode }
      },

      /**
       * 느린 칸들 — 인증과 모델 (docs/sdlc/agent-setup/ FR-1).
       *
       * **`checkAgents`를 대신하지 않는다.** 화면은 둘을 같이 불러 빠른 것으로
       * 먼저 그리고, 이 결과가 오면 채운다(FR-7).
       *
       * `refresh`는 캐시를 버린다 — `다시 확인` 버튼이 쓴다. 버리지 않으면
       * 로그인을 마치고 눌러도 옛 답이 그대로 온다.
       */
      async probeAgents(workspaceId: string, refresh = false): Promise<AgentProbes> {
        if (refresh) {
          modelCatalog.refresh()
          // 첫 repo만이 아니다 — 실행 패널에서 다른 repo를 골랐으면 그 cwd의 옛 실패가
          // 남는다(docs/sdlc/command-cache-auth/ FR-1). 비우기만 하고 띄우지는 않는다.
          for (const repo of repos.list(workspaceId)) commands.invalidate(repo.path)
        }
        return agentProbes.probeAgents(workspaceId)
      }
    },
    commands,
    files: {
      search: (input: FileSearchInput) => files.search(input),
      // 코드 칸 (docs/sdlc/code-editor/) — repo id + 상대 경로로만 받는다. 판정은 전부 서비스에 있다.
      tree: (input: FileTreeInput) => files.tree(input),
      open: (ref: FileRef) => files.open(ref),
      save: (input: FileSaveInput) => files.save(input),
      probe: (ref: FileRef) => files.probe(ref)
    },

    /**
     * repo 저장소에 "등록하면 곧바로 훑는다"만 얹는다 (설계 §3-2).
     * IPC 핸들러를 얇게 두기 위해 여기서 붙인다 — 핸들러는 core 호출만 한다.
     */
    repos: {
      ...repos,

      /** 지운 repo의 셸을 끝낸다 (terminal-spec FR-10) */
      remove(id: string) {
        const result = repos.remove(id)
        terminal.killRepo(id)
        return result
      },

      /**
       * repo를 VS Code **새 창**으로 연다.
       *
       * URL 스킴은 마지막으로 쓰던 창을 재사용해 그 폴더를 덮어쓴다 — 보고 있던
       * 작업이 사라진다. 새 창을 열려면 CLI의 `--new-window`뿐이다
       * (microsoft/vscode#141548은 아직 열려 있다).
       *
       * **CLI를 못 찾으면 URL로 되돌아간다.** macOS에서 "Install 'code' command in
       * PATH"를 누른 적 없는 사람에게는 CLI가 없는데, 그때 아무 일도 안 일어나면
       * 버튼이 고장난 것처럼 보인다. 기존 창에 열리더라도 열리는 편이 낫다.
       * 그 URL을 여는 것은 electron의 `shell`이라 여기서 하지 않고 돌려준다.
       */
      async openInEditor(id: string): Promise<{ fallbackUrl: string | null }> {
        const { path } = repos.get(id)
        const exe = await findVscodeExecutable()
        if (!exe) return { fallbackUrl: vscodeFolderUrl(path) }

        // detached + unref: VS Code가 앱보다 오래 살아야 하고, 앱이 그 프로세스를
        // 기다리지 않아야 한다. stdio를 열어두면 파이프가 차면서 VS Code가 멈춘다.
        const child = spawn(exe, newWindowArgs(path), { detached: true, stdio: 'ignore' })
        child.on('error', (err) => onError('VS Code를 띄우지 못했습니다', err))
        child.unref()
        return { fallbackUrl: null }
      },
      async create(input: Parameters<typeof repos.create>[0]) {
        const made = repos.create(input)
        // **스캔을 기다린 뒤에 돌려준다.** 기다리지 않으면 화면이 목록을 다시 읽는
        // 시점에 스캔이 아직 안 끝나 있어, 방금 등록한 repo의 asset이 새로고침을
        // 누르기 전까지 안 보인다. 디렉토리 셋을 읽는 일이라 비용이 작다.
        //
        // 스캔 실패가 등록을 무르지는 않는다 — repo는 등록됐고, 목록만 비어 보인다.
        try {
          await assetService.scanRepo(made.workspaceId, made.id)
        } catch (err) {
          onError('repo 등록 후 asset 스캔 실패', err)
        }
        return made
      },

      /**
       * 이름·설명·경로를 고친다 (settings-screen spec FR-8). 경로가 바뀌면 저장소가
       * asset의 file_path를 같은 트랜잭션에서 옮기고(FR-9), 여기서 그 repo를 다시
       * 훑어 lastSeenAt을 새 자리에서 찍는다.
       *
       * 경로의 존재는 여기서 본다 — 저장소는 파일시스템을 모른다. 실행의 cwd가 되는
       * 값이라 없는 경로를 받아 두면 다음 실행이 조용히 실패한다.
       */
      async update(input: UpdateRepoInput) {
        if (input.path !== undefined) {
          const trimmed = input.path.trim()
          let isDir = false
          try { isDir = statSync(trimmed).isDirectory() } catch { isDir = false }
          if (!isDir) throw new Error(`존재하지 않는 경로입니다: ${trimmed}`)
        }
        const before = repos.get(input.id)
        const { id, ...patch } = input
        const updated = repos.update(id, patch)
        if (updated.path !== before.path) {
          // 옛 경로에서 계속 돌면 칸의 repo와 셸의 디렉토리가 갈린다 (terminal-spec FR-10)
          terminal.killRepo(updated.id)
          // 등록 때와 같은 이유로 기다린다. 실패가 갱신을 무르지는 않는다.
          try {
            await assetService.scanRepo(updated.workspaceId, updated.id)
          } catch (err) {
            onError('repo 경로 변경 후 asset 스캔 실패', err)
          }
        }
        return updated
      }
    },

    assets: {
      list: assetRows.list,
      createAuthored: assetRows.createAuthored,
      updateIfUnchanged: assetRows.updateIfUnchanged,
      remove: assetRows.remove,

      /** 다시 훑고 갱신된 목록을 준다. 새로고침 버튼이 부른다 */
      async rescan(workspaceId: string) {
        await assetService.scanWorkspace(workspaceId)
        return assetRows.list({ workspaceId })
      },

      /**
       * 본문. **id로만 받는다** — 경로는 DB에서 찾는다. 렌더러가 임의 파일을 읽는
       * 통로가 되면 안 된다 (docs/sdlc/repo-instructions/ FR-3·NFR-2).
       */
      readBody(id: string) {
        return readAssetBody(assetRows.get(id))
      }
    },

    settings: {
      globalRoots: () => settings.globalRoots(),

      /** 터미널 셸 (terminal-spec FR-11). `resolved`는 지금 잡히는 셸 — 비었으면 기본값이고 설정 칸의 placeholder가 말한다 */
      async terminalShell(): Promise<TerminalShellSetting> {
        const path = settings.terminalShell()
        return { path, resolved: (await resolveShell(path, shellLookup())).file }
      },

      /** 없는 파일은 거부한다 — 저장해 두면 다음 셸이 조용히 못 뜬다. 빈 값은 기본값으로 돌아간다 */
      async setTerminalShell(path: string | null): Promise<TerminalShellSetting> {
        const trimmed = (path ?? '').trim()
        if (trimmed !== '') {
          let isFile = false
          try { isFile = statSync(trimmed).isFile() } catch { isFile = false }
          if (!isFile) throw new Error(`셸 파일이 없습니다: ${trimmed}`)
        }
        settings.setTerminalShell(trimmed === '' ? null : trimmed)
        return this.terminalShell()
      },

      /** CLI 기본 경로 — workspace가 비워 둔 agent에 쓴다 (`docs/sdlc/agent-path-default/`). */
      agentPaths: (): AgentPaths => settings.agentPaths(),
      setAgentPaths: (paths: AgentPaths): AgentPaths => settings.setAgentPaths(paths),

      /**
       * 경로를 저장하고 **곧바로 전부 다시 훑는다.**
       *
       * 설정 화면은 본문을 차지하므로 저장 직후 사용자는 asset 목록을 보고 있지 않다.
       * 저장만 하고 끝내면 workspace로 돌아가 새로고침을 눌러야 반영되는데, 그 한
       * 단계를 사람이 기억할 이유가 없다.
       */
      async setGlobalRoots(roots: GlobalRoots) {
        const saved = settings.setGlobalRoots(roots)
        await assetService.scanAll()
        return saved
      }
    },

    issues,
    memos,
    runs,
    execution,

    /**
     * 기간 리포트 (`docs/sdlc/period-report/` FR-1). workspace를 넘어 읽는 유일한 길이고, MCP `deps`에는
     * 넘기지 않는다 — agent는 여전히 자기 workspace만 본다(전체 설계 §8).
     */
    reports: {
      build: (input: BuildReportInput): ReportData => buildReport({
        workspaces: () => workspaces.list(),
        issues: (workspaceId) => issues.list({ workspaceId }),
        memos: (workspaceId) => memos.list({ workspaceId }),
        runs: (workspaceId) => runs.list(workspaceId)
      }, input)
    },

    /** 테스트용. MCP 서버가 아직 안 떴으면 null. */
    mcpPort: (): number | null => mcp.port(),

    /**
     * 정보 탭이 보여주는 실제 위치. 앱 버전은 electron의 것이라 여기 없다 — main이
     * 이 값에 버전을 더해 돌려준다(경계 규칙 1).
     */
    paths: (): AppPaths => ({ dataDir: opts.dataDir, dbFile, logDir }),

    /**
     * 패널 창을 열어도 되는 범위인가 (docs/sdlc/item-windows/ FR-12). 렌더러가 보낸 값을 그대로 믿지 않는다 —
     * workspace가 있고, repo가 있으면 그 workspace 소속이어야 한다. 정규화한 범위를 돌려주고, 아니면 던진다.
     * 창을 만드는 것은 electron의 일이라 판정만 여기 둔다(`reveal.ts`와 같은 구조).
     */
    panelScope(input: unknown): PanelScope {
      if (typeof input !== 'object' || input === null) throw new Error('열 수 없는 창입니다')
      const { kind, workspaceId, repoId } = input as Record<string, unknown>
      if (typeof kind !== 'string' || !(PANEL_KINDS as readonly string[]).includes(kind)) {
        throw new Error(`열 수 없는 창입니다: ${String(kind)}`)
      }
      if (typeof workspaceId !== 'string' || !workspaces.list().some((w) => w.id === workspaceId)) {
        throw new Error(`workspace를 찾을 수 없습니다: ${String(workspaceId)}`)
      }
      if (repoId !== null) {
        if (typeof repoId !== 'string') throw new Error('열 수 없는 창입니다')
        if (repos.get(repoId).workspaceId !== workspaceId) {
          throw new Error(`이 workspace의 repo가 아닙니다: ${repoId}`)
        }
      }
      return { kind: kind as PanelScope['kind'], workspaceId, repoId: repoId as string | null }
    },

    /** 전역 실행 슬롯. workspace와 무관하다 (설계 §6 — 제약의 근거가 머신 자원이다). */
    queue: {
      snapshot: (): QueueSnapshot => queue.snapshot(),

      /** 상한을 바꾸고 저장한다. 검증은 setting 저장소가 하므로 잘못된 값은 여기서 던진다. */
      setLimit(n: number): QueueSnapshot {
        settings.setConcurrencyLimit(n)
        queue.setLimit(n)
        return queue.snapshot()
      }
    },

    /**
     * 대화의 수명 주기 (`docs/sdlc/conversation-lifecycle/`).
     *
     * 저장소(`runs`)를 그대로 내보내지 않고 여기에 감싸는 이유는 **이벤트** 때문이다 —
     * 두 동작 모두 run 행과 배지를 함께 바꾸므로 `RUN_UPDATE`와 `emitInbox()`가
     * 짝으로 나가야 한다. `inbox.markReviewed`가 같은 이유로 여기 있다.
     */
    conversations: {
      /** 대화를 끝낸다. 확인도 겸하므로 배지에서 내려간다 (spec FR-12). */
      close(rootRunId: string): Run {
        const closed = runs.close(rootRunId)
        emitter.emit(RUN_UPDATE, closed)
        emitInbox()
        return closed
      },

      /** 대화에 이름을 붙인다. 빈 값은 파생으로 되돌린다 (spec FR-14). */
      rename(rootRunId: string, title: string): Run {
        const renamed = runs.rename(rootRunId, title)
        emitter.emit(RUN_UPDATE, renamed)
        emitInbox()
        return renamed
      },

      /** 대화의 할당 이슈를 바꾼다. null이면 뗀다 (`docs/sdlc/conversation-issue/` FR-6·FR-7). */
      assignIssue(rootRunId: string, issueId: string | null): Run {
        const assigned = runs.assignIssue(rootRunId, issueId)
        emitter.emit(RUN_UPDATE, assigned)
        emitInbox()
        return assigned
      }
    },

    /** 지금 사용자의 손이 필요한 대화. 모든 workspace를 가로지른다 (설계 §4·§5). */
    inbox: {
      list: (): Run[] => runs.inbox(),
      counts: (): InboxCounts => runs.inboxCounts(),

      markReviewed(runId: string, kind: 'confirmed' | 'archived'): Run {
        const reviewed = runs.markReviewed(runId, kind)
        emitter.emit(RUN_UPDATE, reviewed)
        emitInbox()
        return reviewed
      }
    },

    /** 스트림 이벤트 구독. 반환된 함수를 부르면 해제된다. */
    onRunEvent(cb: (event: RunEvent) => void): () => void {
      emitter.on(RUN_EVENT, cb)
      return () => { emitter.off(RUN_EVENT, cb) }
    },

    /** run 행의 변화 구독. 시작 이후의 상태 변화는 이 경로로만 알 수 있다. */
    onRunUpdate(cb: (run: Run) => void): () => void {
      emitter.on(RUN_UPDATE, cb)
      return () => { emitter.off(RUN_UPDATE, cb) }
    },

    /** 큐가 바뀔 때마다 새 스냅샷을 준다. run 하나 단위인 onRunUpdate로는 표현되지 않는다. */
    onQueueUpdate(cb: (snapshot: QueueSnapshot) => void): () => void {
      emitter.on(QUEUE_UPDATE, cb)
      return () => { emitter.off(QUEUE_UPDATE, cb) }
    },

    /** 인박스 건수가 바뀔 때마다 준다. 사이드바 배지가 이걸로 산다. */
    onInboxUpdate(cb: (counts: InboxCounts) => void): () => void {
      emitter.on(INBOX_UPDATE, cb)
      return () => { emitter.off(INBOX_UPDATE, cb) }
    },

    /** MCP 서버의 기동 상태. 사이드바 하단이 이걸 보여준다. */
    mcpStatus(): McpStatus {
      return mcp.status()
    },

    /**
     * 기동 상태가 바뀔 때 준다.
     *
     * **읽기(mcpStatus)와 구독이 둘 다 필요하다.** 부팅 기동은 비동기라 창이
     * 먼저 뜰 수 있는데, 구독만 있으면 이미 지나간 전이를 놓쳐 화면이 영원히
     * '시작 중'으로 굳는다. 읽기만 있으면 창이 먼저 떴을 때 같은 자리에서 멈춘다.
     */
    onMcpStatus(cb: (status: McpStatus) => void): () => void {
      emitter.on(MCP_STATUS, cb)
      return () => { emitter.off(MCP_STATUS, cb) }
    },

    /**
     * 이슈·메모·asset·repo·workspace가 바뀔 때 준다 (docs/sdlc/item-windows/ FR-17). IPC로 온 쓰기와 MCP로
     * 온 쓰기, asset 스캔이 전부 이 길이다. 모든 창이 듣는다.
     */
    /** 코드 칸의 터미널 (docs/sdlc/code-editor/terminal-spec.md) — 핸들러는 이것을 한 줄씩 부른다 */
    terminal: {
      open: (input: TerminalOpenInput) => terminal.open(input),
      write: (repoId: string, data: string) => { terminal.write(repoId, data) },
      resize: (repoId: string, cols: number, rows: number) => { terminal.resize(repoId, cols, rows) },
      restart: (input: TerminalOpenInput) => terminal.restart(input)
    },

    /** 셸 출력 — 16ms마다 모은 덩어리 (terminal-spec FR-20) */
    onTerminalData(cb: (data: TerminalData) => void): () => void {
      emitter.on(TERMINAL_DATA, cb)
      return () => { emitter.off(TERMINAL_DATA, cb) }
    },

    onTerminalExit(cb: (exit: TerminalExit) => void): () => void {
      emitter.on(TERMINAL_EXIT, cb)
      return () => { emitter.off(TERMINAL_EXIT, cb) }
    },

    onItemChanged(cb: (change: ItemChange) => void): () => void {
      emitter.on(ITEM_CHANGED, cb)
      return () => { emitter.off(ITEM_CHANGED, cb) }
    },

    /** 마지막으로 받은 요금제 사용률. 앱을 켠 뒤 claude 실행이 없었으면 null (docs/sdlc/plan-usage/) */
    planUsage(): PlanUsage | null {
      return planUsage
    },

    /** 요금제 사용률이 올 때마다 준다. 읽기와 둘 다 있는 이유는 onMcpStatus와 같다 */
    onPlanUsage(cb: (usage: PlanUsage) => void): () => void {
      emitter.on(PLAN_USAGE, cb)
      return () => { emitter.off(PLAN_USAGE, cb) }
    },

    /**
     * 실행 중인 agent 프로세스를 정리하고 DB 연결을 닫는다.
     *
     * better-sqlite3는 마지막 연결이 정상적으로 닫힐 때 WAL을 체크포인트하므로,
     * 이걸 부르면 종료 시점의 데이터가 메인 DB 파일에 반영된다.
     * 백업(openDb의 backupIfNeeded)이 온전한 상태를 복사하게 된다.
     */
    shutdown(): void {
      manager.cancelAll()
      // 셸과 셸이 띄운 프로세스(dev 서버)도 트리째, 기다려서 끝낸다 (terminal-spec FR-9)
      terminal.killAll()
      // 토큰과 설정 파일을 함께 치운다. 프로세스가 죽어도 파일은 남는다.
      mcp.close()
      db.$client.close()
    }
  }
}

export type Core = ReturnType<typeof createCore>
