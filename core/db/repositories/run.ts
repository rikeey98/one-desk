import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from '../open'
import { issue, memo, repo, run, runContextItem } from '../schema'
import type {
  Run, ContextItemRef, RunStatus, AgentKind, Permission, InboxCounts
} from '@shared/models'
import type { RunEvent } from '@shared/events'

/** db.transaction()의 콜백이 받는 runner. db와 같은 쿼리 빌더 API를 갖는다. */
type Runner = Parameters<Parameters<Database['transaction']>[0]>[0]

export interface CreateRunInput {
  /**
   * 미리 정한 id. 로그 경로가 run id를 포함하므로 호출자가 먼저 id를 알아야
   * DB의 log_path와 실제 파일 위치가 일치한다. 없으면 여기서 만든다.
   */
  id?: string
  workspaceId: string
  agentKind: AgentKind
  model: string | null
  cwd: string
  permission: Permission
  userPrompt: string
  assembledPrompt: string
  logPath: string
  context: ContextItemRef[]
  parentRunId?: string
  timeoutMs?: number | null
}

export interface FinishRunInput {
  status: RunStatus
  resultText: string | null
  externalSessionId: string | null
  needsAnswer: boolean
  exitCode: number | null
  errorMessage: string | null
}

export function createRunRepository(db: Database) {
  /**
   * 인박스에 들어올 수 있는 상태 (설계 §4).
   * canceled가 들어 있는 이유: 3a부터 앱이 재시작하며 대기 중이던 run을 취소한다.
   * 사용자가 스스로 취소한 것은 execution.cancel이 reviewedAt을 찍어 제외되므로,
   * 여기 남는 canceled는 앱이 취소한 것뿐이다.
   */
  const INBOX_STATUSES: RunStatus[] = ['succeeded', 'failed', 'interrupted', 'canceled']

  /**
   * 아직 살아 있는 id만 남긴다.
   *
   * 설계 §5는 `ON DELETE SET NULL`을 요구하지만 `item_id`는 repo·issue·memo·asset을
   * 함께 가리키는 다형 참조라 외래키 자체를 걸 수 없다. 그래서 이슈를 지워도
   * 행에는 죽은 id가 그대로 남는다. 읽는 시점에 걸러내 SET NULL과 같은 관측 동작을
   * 만든다 — run 기록은 남고 맥락 항목만 빠진다.
   * asset은 아직 테이블이 없어(5단계) 걸러내지 않고 그대로 둔다.
   */
  function livingIds(type: 'repo' | 'issue' | 'memo', ids: string[]): Set<string> {
    if (ids.length === 0) return new Set()
    const table = type === 'repo' ? repo : type === 'issue' ? issue : memo
    const rows = db.select({ id: table.id }).from(table).where(inArray(table.id, ids)).all()
    return new Set(rows.map((r) => r.id))
  }

  function loadContext(runIds: string[]): Map<string, ContextItemRef[]> {
    const map = new Map<string, ContextItemRef[]>()
    if (runIds.length === 0) return map
    const rows = db.select().from(runContextItem)
      .where(inArray(runContextItem.runId, runIds)).all()

    const idsOf = (type: 'repo' | 'issue' | 'memo') =>
      rows.filter((r) => r.itemType === type && r.itemId).map((r) => r.itemId!)
    const alive = {
      repo: livingIds('repo', idsOf('repo')),
      issue: livingIds('issue', idsOf('issue')),
      memo: livingIds('memo', idsOf('memo'))
    }

    for (const row of rows) {
      if (!row.itemId) continue
      if (row.itemType !== 'asset' && !alive[row.itemType].has(row.itemId)) continue
      const list = map.get(row.runId) ?? []
      list.push({ type: row.itemType, id: row.itemId })
      map.set(row.runId, list)
    }
    return map
  }

  function hydrate(rows: (typeof run.$inferSelect)[]): Run[] {
    const ctx = loadContext(rows.map((r) => r.id))
    return rows.map((r) => ({ ...r, contextItems: ctx.get(r.id) ?? [] }))
  }

  function get(id: string): Run {
    const row = db.select().from(run).where(eq(run.id, id)).get()
    if (!row) throw new Error(`run을 찾을 수 없습니다: ${id}`)
    return hydrate([row])[0]!
  }

  return {
    get,

    list(workspaceId: string): Run[] {
      const rows = db.select().from(run)
        .where(eq(run.workspaceId, workspaceId))
        // createdAt만으로는 같은 밀리초에 만들어진 run들의 순서가 흔들린다.
        // rowid가 삽입 순서를 결정적으로 갈라준다.
        .orderBy(desc(run.createdAt), desc(sql`rowid`)).all()
      return hydrate(rows)
    },

    create(input: CreateRunInput): Run {
      const id = input.id ?? randomUUID()
      db.transaction((tx: Runner) => {
        tx.insert(run).values({
          id,
          workspaceId: input.workspaceId,
          agentKind: input.agentKind,
          model: input.model,
          cwd: input.cwd,
          permission: input.permission,
          userPrompt: input.userPrompt,
          assembledPrompt: input.assembledPrompt,
          logPath: input.logPath,
          parentRunId: input.parentRunId ?? null,
          timeoutMs: input.timeoutMs ?? null,
          createdAt: Date.now()
        }).run()
        if (input.context.length > 0) {
          tx.insert(runContextItem).values(
            input.context.map((c) => ({ runId: id, itemType: c.type, itemId: c.id }))
          ).run()
        }
      })
      return get(id)
    },

    markStarted(id: string): Run {
      db.update(run).set({ status: 'running', startedAt: Date.now() })
        .where(eq(run.id, id)).run()
      return get(id)
    },

    markFinished(id: string, input: FinishRunInput): Run {
      db.update(run).set({ ...input, endedAt: Date.now() }).where(eq(run.id, id)).run()
      return get(id)
    },

    /**
     * 종료된 run의 로그를 파일에서 되살린다.
     * 메모리 스토어는 상한이 있고 앱 재시작이면 비어 있으므로, 지난 run의 탭을
     * 다시 열 때는 여기가 유일한 출처다. 깨진 줄은 건너뛴다.
     */
    readLog(id: string): RunEvent[] {
      const { logPath } = get(id)
      if (!existsSync(logPath)) return []
      const events: RunEvent[] = []
      for (const line of readFileSync(logPath, 'utf8').split('\n')) {
        if (!line.trim()) continue
        try {
          events.push(JSON.parse(line) as RunEvent)
        } catch {
          // 쓰다 만 마지막 줄일 수 있다. 나머지를 살린다.
        }
      }
      return events
    },

    /**
     * 앱 시작 시 유령 run을 정리한다 (설계 §11).
     *
     * running은 실행 중 끊긴 것이므로 interrupted다.
     * pending은 시작도 못 한 것이므로 canceled다 — 대기 큐는 메모리에만 있어
     * 재시작하면 어차피 사라지고, 여기서 자동으로 다시 시작하지도 않는다.
     * 앱을 여는 행위가 agent 실행을 부르면 안 되고(전체 설계 §14의 자율 실행),
     * 조립된 프롬프트도 그 사이 낡았을 수 있다.
     */
    reapStale(): number {
      const stale = db.select({ id: run.id, status: run.status }).from(run)
        .where(inArray(run.status, ['running', 'pending'])).all()
      if (stale.length === 0) return 0

      const wasRunning = stale.filter((s) => s.status === 'running').map((s) => s.id)
      const wasPending = stale.filter((s) => s.status === 'pending').map((s) => s.id)
      const endedAt = Date.now()

      db.transaction((tx: Runner) => {
        if (wasRunning.length > 0) {
          tx.update(run).set({
            status: 'interrupted',
            endedAt,
            errorMessage: '앱이 종료되어 중단되었습니다.'
          }).where(inArray(run.id, wasRunning)).run()
        }
        if (wasPending.length > 0) {
          tx.update(run).set({
            status: 'canceled',
            endedAt,
            errorMessage: '앱이 종료되어 대기 중이던 실행이 취소되었습니다.'
          }).where(inArray(run.id, wasPending)).run()
        }
      })
      return stale.length
    },

    /**
     * 지금 사용자의 손이 필요한 run만 모은다 (설계 §4).
     * 모든 workspace를 가로지른다 — 어디에 쌓였는지는 사이드바 배지가 보여준다.
     */
    inbox(): Run[] {
      const rows = db.select().from(run)
        .where(and(isNull(run.reviewedAt), inArray(run.status, INBOX_STATUSES)))
        // endedAt만으로는 같은 밀리초에 끝난 항목들의 순서가 흔들린다.
        // rowid가 삽입 순서를 결정적으로 갈라준다.
        .orderBy(desc(run.endedAt), desc(sql`rowid`)).all()
      return hydrate(rows)
    },

    inboxCounts(): InboxCounts {
      const rows = db.select({ workspaceId: run.workspaceId, n: count() }).from(run)
        .where(and(isNull(run.reviewedAt), inArray(run.status, INBOX_STATUSES)))
        .groupBy(run.workspaceId).all()

      const byWorkspace: Record<string, number> = {}
      let total = 0
      for (const row of rows) {
        byWorkspace[row.workspaceId] = row.n
        total += row.n
      }
      return { total, byWorkspace }
    },

    /**
     * 인박스에서 내린다. 확인함과 보관은 reviewedKind로만 갈린다.
     *
     * 이미 확인된 run의 시각은 덮어쓰지 않는다 — 처음 확인한 때가 기록으로서
     * 의미가 있고, 나중에 컬럼을 추가해도 그 이전 기록은 복구할 수 없다.
     */
    markReviewed(id: string, kind: 'confirmed' | 'archived'): Run {
      db.update(run)
        .set({ reviewedAt: Date.now(), reviewedKind: kind })
        .where(and(eq(run.id, id), isNull(run.reviewedAt))).run()
      return get(id)
    }
  }
}

export type RunRepository = ReturnType<typeof createRunRepository>
