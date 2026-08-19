import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from './db/open'
import { createWorkspaceRepository } from './db/repositories/workspace'
import { createRepoRepository } from './db/repositories/repo'
import { createIssueRepository } from './db/repositories/issue'
import { createMemoRepository } from './db/repositories/memo'
import { createRunRepository } from './db/repositories/run'
import { createRunManager } from './runner/manager'
import { createExecutionService } from './execution'
import { claudeCodeAdapter } from './runner/adapters/claudeCode'
import { resolveAgentPath } from './runner/agentPath'
import { createSettingRepository } from './db/repositories/setting'
import { createRunQueue } from './runner/queue'
import { createMcpHost } from './mcp/host'
import { consoleErrorSink, type ErrorSink } from './errors'
import type { AgentAdapter } from './runner/types'
import type { RunEvent } from '@shared/events'
import type { AgentKind, InboxCounts, McpStatus, QueueSnapshot, Run } from '@shared/models'

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
  /** core가 삼킨 오류를 흘려보낼 곳. 기본은 stderr */
  onError?: ErrorSink
}

const RUN_EVENT = 'run-event'
const RUN_UPDATE = 'run-update'
const QUEUE_UPDATE = 'queue-update'
const INBOX_UPDATE = 'inbox-update'
const MCP_STATUS = 'mcp-status'

export function createCore(opts: CoreOptions) {
  const onError = opts.onError ?? consoleErrorSink

  const db = openDb({
    file: join(opts.dataDir, 'one-desk.db'),
    migrationsDir: opts.migrationsDir
  })

  const workspaces = createWorkspaceRepository(db)
  const issues = createIssueRepository(db)
  const memos = createMemoRepository(db)
  const repos = createRepoRepository(db)
  const runs = createRunRepository(db)
  // 앱 시작 시 유령 run 정리 (설계 §11). 프로세스가 없는데 running/pending으로
  // 남아 있는 run은 이전 실행이 비정상 종료된 흔적이다.
  runs.reapStale()

  const mcp = createMcpHost({
    deps: { repos, issues, memos },
    configDir: join(opts.dataDir, 'mcp'),
    execPath: opts.execPath ?? process.execPath,
    // 번들되지 않는 원본 .mjs다 — import.meta.url 기준으로 찾는다.
    bridgePath: opts.bridgePath ?? fileURLToPath(new URL('./mcp/bridge.mjs', import.meta.url)),
    onError
  })

  // opencode에 claudeCodeAdapter를 매핑하는 것은 임시다 (5단계에 OpenCode 어댑터).
  // 그때까지 UI에서 OpenCode를 고를 수 없게 막는다.
  const adapters: Record<AgentKind, AgentAdapter> = {
    'claude-code': claudeCodeAdapter,
    opencode: claudeCodeAdapter
  }

  const emitter = new EventEmitter()

  const settings = createSettingRepository(db)
  const queue = createRunQueue({
    limit: settings.concurrencyLimit(),
    onChange: (snapshot) => emitter.emit(QUEUE_UPDATE, snapshot)
  })

  const manager = createRunManager({
    adapters,
    logDir: join(opts.dataDir, 'logs'),
    onEvent: (event) => emitter.emit(RUN_EVENT, event),
    onError
  })

  const execution = createExecutionService({
    db,
    runs,
    manager,
    queue,
    mcp,
    onError,
    resolveExecutable: async (agentKind, workspaceId) => {
      const ws = workspaces.list().find((w) => w.id === workspaceId) ?? null
      return adapters[agentKind].preflight(resolveAgentPath(agentKind, ws))
    },
    onRunUpdate: (run) => {
      emitter.emit(RUN_UPDATE, run)
      // 종료·취소·확인 표시가 전부 이 경로를 지난다.
      emitInbox()
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
    workspaces,
    repos,
    issues,
    memos,
    runs,
    execution,

    /** 테스트용. MCP 서버가 아직 안 떴으면 null. */
    mcpPort: (): number | null => mcp.port(),

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
     * 실행 중인 agent 프로세스를 정리하고 DB 연결을 닫는다.
     *
     * better-sqlite3는 마지막 연결이 정상적으로 닫힐 때 WAL을 체크포인트하므로,
     * 이걸 부르면 종료 시점의 데이터가 메인 DB 파일에 반영된다.
     * 백업(openDb의 backupIfNeeded)이 온전한 상태를 복사하게 된다.
     */
    shutdown(): void {
      manager.cancelAll()
      // 토큰과 설정 파일을 함께 치운다. 프로세스가 죽어도 파일은 남는다.
      mcp.close()
      db.$client.close()
    }
  }
}

export type Core = ReturnType<typeof createCore>
