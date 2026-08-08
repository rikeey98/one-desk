import { randomUUID } from 'node:crypto'
import { desc, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '../open'
import { issue, memo, repo, run, runContextItem } from '../schema'
import type { Run, ContextItemRef, RunStatus, AgentKind, Permission } from '@shared/models'

/** db.transaction()의 콜백이 받는 runner. db와 같은 쿼리 빌더 API를 갖는다. */
type Runner = Parameters<Parameters<Database['transaction']>[0]>[0]

export interface CreateRunInput {
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
      const id = randomUUID()
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
     * 앱 시작 시 유령 run을 정리한다 (설계 §11).
     * pending도 함께 정리한다 — 대기 큐는 메모리에만 있으므로
     * 재시작하면 영원히 시작되지 않는다.
     */
    reapStale(): number {
      const stale = db.select({ id: run.id }).from(run)
        .where(inArray(run.status, ['running', 'pending'])).all()
      if (stale.length === 0) return 0
      db.update(run)
        .set({ status: 'interrupted', endedAt: Date.now(), errorMessage: '앱이 종료되어 중단되었습니다.' })
        .where(inArray(run.id, stale.map((s) => s.id))).run()
      return stale.length
    }
  }
}

export type RunRepository = ReturnType<typeof createRunRepository>
