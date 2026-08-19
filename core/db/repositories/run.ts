import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import type { Database } from '../open'
import { issue, memo, repo, run, runContextItem } from '../schema'
import { NotFoundError } from '../../errors'
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
    if (!row) throw new NotFoundError(`run을 찾을 수 없습니다: ${id}`)
    return hydrate([row])[0]!
  }

  /**
   * 새 run의 뿌리를 정한다 (설계 §2).
   *
   * **호출자가 넘기게 하지 않는다** — 두 곳이 어긋나면 대화가 조용히 갈라진다.
   * parent_run_id에는 외래키가 없으므로 가리키는 run이 없을 수 있다. 그때는
   * 자기 자신이 뿌리다.
   */
  function rootFor(parentRunId: string | null, ownId: string): string {
    if (!parentRunId) return ownId
    const parent = db.select({ id: run.id, rootRunId: run.rootRunId })
      .from(run).where(eq(run.id, parentRunId)).get()
    if (!parent) return ownId
    return parent.rootRunId ?? parent.id
  }

  /** 미확인인 뿌리 run의 id들. 낡은 행은 root_run_id가 null이고 그때는 자기 자신이 뿌리다. */
  function unreviewedRootIds(): string[] {
    const roots = db.select({ id: run.id }).from(run)
      .where(and(
        isNull(run.reviewedAt),
        or(isNull(run.rootRunId), eq(run.rootRunId, run.id))
      )).all()
    return roots.map((r) => r.id)
  }

  /**
   * 미확인 대화마다 마지막 턴 하나씩을 골라낸다. `inbox()`와 `inboxCounts()`가
   * "대화별로 묶어 마지막 턴을 고른다"는 같은 규칙을 공유하는 자리다 — 따로
   * 짜면 배지와 목록이 어긋날 수 있다 (설계 §5).
   *
   * **컬럼은 호출자가 고른다.** `inbox()`는 화면에 그릴 전체 run이 필요하지만
   * `inboxCounts()`는 세기만 하면 되므로, `select`로 필요한 컬럼만 읽게 한다
   * — 배지 갱신마다 `assembled_prompt`까지 포함한 전체 행을 나르는 비용을
   * 없앤다 (리뷰 I-2).
   */
  function lastTurnsOf<T extends { id: string; rootRunId: string | null; status: RunStatus }>(
    rootIds: string[],
    select: (rootIds: string[]) => T[]
  ): T[] {
    if (rootIds.length === 0) return []
    const rows = select(rootIds)

    const rootOf = new Set(rootIds)
    const lastTurn = new Map<string, T>()
    for (const row of rows) {
      const key = row.rootRunId ?? row.id
      // 뿌리가 이미 확인된 대화의 턴이 섞여 들어올 수 있다 — 걸러낸다.
      if (!rootOf.has(key)) continue
      if (!lastTurn.has(key)) lastTurn.set(key, row)
    }
    return [...lastTurn.values()].filter((r) => INBOX_STATUSES.includes(r.status))
  }

  /** 두 쿼리가 함께 쓰는 정렬 — 최신순이므로 대화별 첫 행이 마지막 턴이다. */
  const byLatest = [desc(run.createdAt), desc(sql`rowid`)] as const

  /**
   * 지금 사용자의 손이 필요한 대화만 모은다 (설계 §5).
   *
   * **단위는 run이 아니라 대화다.** 미확인 판정은 root run의 reviewedAt으로
   * 하고, 보여줄 내용은 그 대화의 마지막 턴에서 가져온다. 턴마다 한 줄씩
   * 쌓이면 긴 대화 하나가 인박스를 덮어버린다.
   *
   * 모든 workspace를 가로지른다 — 어디에 쌓였는지는 사이드바 배지가 보여준다.
   */
  function inbox(): Run[] {
    const rootIds = unreviewedRootIds()
    const items = lastTurnsOf(rootIds, (ids) => db.select().from(run)
      .where(or(inArray(run.rootRunId, ids), inArray(run.id, ids)))
      .orderBy(...byLatest).all())
    // endedAt만으로는 같은 밀리초에 끝난 항목들의 순서가 흔들린다.
    const sorted = [...items].sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    return hydrate(sorted)
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

    /**
     * 그 대화에서 세션 id를 가진 가장 최근 run (설계 §3-1).
     *
     * 마지막 턴이 preflight 실패로 끝나 세션 id가 없어도 그 앞 턴에서 이어받게
     * 하는 것이 목적이다. 마지막 run을 그냥 쓰면 그런 턴 하나가 대화를 끊는다.
     */
    latestSessionRun(rootRunId: string): Run | null {
      const row = db.select().from(run)
        .where(and(
          // 낡은 행은 root_run_id가 null이고 그때는 자기 자신이 뿌리다.
          or(eq(run.rootRunId, rootRunId), and(isNull(run.rootRunId), eq(run.id, rootRunId))),
          isNotNull(run.externalSessionId)
        ))
        // createdAt만으로는 같은 밀리초의 순서가 흔들린다. rowid가 갈라준다.
        .orderBy(desc(run.createdAt), desc(sql`rowid`)).get()
      return row ? hydrate([row])[0]! : null
    },

    create(input: CreateRunInput): Run {
      const id = input.id ?? randomUUID()
      const rootRunId = rootFor(input.parentRunId ?? null, id)
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
          rootRunId,
          timeoutMs: input.timeoutMs ?? null,
          createdAt: Date.now()
        }).run()
        if (input.context.length > 0) {
          tx.insert(runContextItem).values(
            input.context.map((c) => ({ runId: id, itemType: c.type, itemId: c.id }))
          ).run()
        }
        // 기존 대화에 잇는 턴이면(parentRunId가 있으면) 뿌리의 확인 표시를 지운다
        // (설계 §5의 재개 규칙, C-1의 두 번째 절반). markReviewed는 한 번 찍히면
        // 스스로 지워지지 않으므로, 이걸 안 하면 한 번이라도 "확인함"/"보관"한
        // 대화는 그 뒤로 needs_answer가 다시 떠도 영원히 인박스에 안 뜬다.
        // rootRunId가 새로 만드는 이 run 자신을 가리키는 경우(부모 행이 이미
        // 사라진 경우)도 안전하다 — 방금 만든 행이라 reviewedAt이 어차피 null이다.
        if (input.parentRunId) {
          tx.update(run).set({ reviewedAt: null, reviewedKind: null })
            .where(eq(run.id, rootRunId)).run()
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

    inbox,

    /**
     * 목록과 같은 "대화별로 묶어 마지막 턴을 고른다" 규칙으로 센다 — 따로
     * 세면 배지와 목록이 어긋난다. 다만 **hydrate는 하지 않는다.**
     *
     * `emitInbox()`가 run 행이 바뀔 때마다(시작·종료·확인·취소) 이걸 부른다
     * (`core/index.ts`). 예전에는 이 함수가 `inbox()`를 그대로 돌려썼는데,
     * 그러면 배지 하나 갱신할 때마다 미확인 대화의 모든 턴을 `assembled_prompt`
     * 포함 전체 컬럼으로 읽고 `hydrate()`(맥락 항목 + 최대 3개 테이블 추가
     * 조회)까지 돌게 된다 — better-sqlite3는 동기라 그동안 Electron 메인
     * 프로세스가 그대로 멈춘다 (리뷰 I-2, 실측 3,000대화×4턴에서 167ms).
     * 여기서는 소속 판정에 필요한 컬럼만 읽고 개수만 센다.
     */
    inboxCounts(): InboxCounts {
      const rootIds = unreviewedRootIds()
      const items = lastTurnsOf(rootIds, (ids) => db.select({
        id: run.id, workspaceId: run.workspaceId, rootRunId: run.rootRunId, status: run.status
      }).from(run)
        .where(or(inArray(run.rootRunId, ids), inArray(run.id, ids)))
        .orderBy(...byLatest).all())

      const byWorkspace: Record<string, number> = {}
      let total = 0
      for (const item of items) {
        byWorkspace[item.workspaceId] = (byWorkspace[item.workspaceId] ?? 0) + 1
        total += 1
      }
      return { total, byWorkspace }
    },

    /**
     * 인박스에서 내린다. 확인함과 보관은 reviewedKind로만 갈린다.
     *
     * 이미 확인된 run의 시각은 덮어쓰지 않는다 — 처음 확인한 때가 기록으로서
     * 의미가 있고, 나중에 컬럼을 추가해도 그 이전 기록은 복구할 수 없다.
     *
     * **단, 이 불변은 "그 대화가 다시 이어지기 전까지"만 성립한다.** run이
     * 불변인 옛 모델에서 쓰인 주석이었다 — 대화가 이어지는 지금은 `create()`가
     * `parentRunId`를 받을 때마다 뿌리의 `reviewedAt`/`reviewedKind`를 지운다
     * (설계 §5 재개 규칙). 그 순간부터는 "처음 확인한 때"가 새로 이어진 대화의
     * 상태에 대해서는 더 이상 유효하지 않으므로, 여기서 다시 찍히는 시각이
     * 사실상 "이 재개 이후 처음 확인한 때"가 된다.
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
