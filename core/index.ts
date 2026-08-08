import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { openDb } from './db/open'
import { createWorkspaceRepository } from './db/repositories/workspace'
import { createRepoRepository } from './db/repositories/repo'
import { createIssueRepository } from './db/repositories/issue'
import { createMemoRepository } from './db/repositories/memo'
import { createRunRepository } from './db/repositories/run'
import { createRunManager } from './runner/manager'
import { claudeCodeAdapter } from './runner/adapters/claudeCode'
import type { RunEvent } from '@shared/events'

export interface CoreOptions {
  /** DB와 로그를 둘 디렉토리. Electron의 userData 경로를 main이 넘긴다. */
  dataDir: string
  /** 마이그레이션 디렉토리 (패키징 시 위치가 달라진다) */
  migrationsDir: string
}

const RUN_EVENT = 'run-event'

export function createCore(opts: CoreOptions) {
  const db = openDb({
    file: join(opts.dataDir, 'one-desk.db'),
    migrationsDir: opts.migrationsDir
  })

  const runs = createRunRepository(db)
  // 앱 시작 시 유령 run 정리 (설계 §11). 프로세스가 없는데 running/pending으로
  // 남아 있는 run은 이전 실행이 비정상 종료된 흔적이다.
  runs.reapStale()

  const emitter = new EventEmitter()
  const manager = createRunManager({
    // opencode에 claudeCodeAdapter를 매핑하는 것은 임시다 (5단계에 OpenCode 어댑터).
    // 그때까지 UI에서 OpenCode를 고를 수 없게 막는다.
    adapters: { 'claude-code': claudeCodeAdapter, opencode: claudeCodeAdapter },
    logDir: join(opts.dataDir, 'logs'),
    onEvent: (event) => emitter.emit(RUN_EVENT, event)
  })

  return {
    workspaces: createWorkspaceRepository(db),
    repos: createRepoRepository(db),
    issues: createIssueRepository(db),
    memos: createMemoRepository(db),
    runs,

    /** 스트림 이벤트 구독. 반환된 함수를 부르면 해제된다. */
    onRunEvent(cb: (event: RunEvent) => void): () => void {
      emitter.on(RUN_EVENT, cb)
      return () => { emitter.off(RUN_EVENT, cb) }
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
