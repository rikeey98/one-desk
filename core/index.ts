import { EventEmitter } from 'node:events'
import { join } from 'node:path'
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
import type { AgentAdapter } from './runner/types'
import type { RunEvent } from '@shared/events'
import type { AgentKind, QueueSnapshot, Run } from '@shared/models'

export interface CoreOptions {
  /** DB와 로그를 둘 디렉토리. Electron의 userData 경로를 main이 넘긴다. */
  dataDir: string
  /** 마이그레이션 디렉토리 (패키징 시 위치가 달라진다) */
  migrationsDir: string
}

const RUN_EVENT = 'run-event'
const RUN_UPDATE = 'run-update'
const QUEUE_UPDATE = 'queue-update'

export function createCore(opts: CoreOptions) {
  const db = openDb({
    file: join(opts.dataDir, 'one-desk.db'),
    migrationsDir: opts.migrationsDir
  })

  const workspaces = createWorkspaceRepository(db)
  const runs = createRunRepository(db)
  // 앱 시작 시 유령 run 정리 (설계 §11). 프로세스가 없는데 running/pending으로
  // 남아 있는 run은 이전 실행이 비정상 종료된 흔적이다.
  runs.reapStale()

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
    onEvent: (event) => emitter.emit(RUN_EVENT, event)
  })

  const execution = createExecutionService({
    db,
    runs,
    manager,
    queue,
    resolveExecutable: async (agentKind, workspaceId) => {
      const ws = workspaces.list().find((w) => w.id === workspaceId) ?? null
      return adapters[agentKind].preflight(resolveAgentPath(agentKind, ws))
    },
    onRunUpdate: (run) => emitter.emit(RUN_UPDATE, run)
  })

  return {
    workspaces,
    repos: createRepoRepository(db),
    issues: createIssueRepository(db),
    memos: createMemoRepository(db),
    runs,
    execution,

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

    /**
     * 실행 중인 agent 프로세스를 정리하고 DB 연결을 닫는다.
     *
     * better-sqlite3는 마지막 연결이 정상적으로 닫힐 때 WAL을 체크포인트하므로,
     * 이걸 부르면 종료 시점의 데이터가 메인 DB 파일에 반영된다.
     * 백업(openDb의 backupIfNeeded)이 온전한 상태를 복사하게 된다.
     */
    shutdown(): void {
      manager.cancelAll()
      db.$client.close()
    }
  }
}

export type Core = ReturnType<typeof createCore>
