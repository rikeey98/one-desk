import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import type { Database } from '../open'
import { asset, issue, memo, repo, run, runContextItem } from '../schema'
import { NotFoundError } from '../../errors'
import type {
  Run, ContextItemRef, ContextItemType, ContextItemView, RunStatus, AgentKind,
  Permission, InboxCounts
} from '@shared/models'
import { RUN_EVENT_WINDOW, type RunEvent, type RunUsage } from '@shared/events'
import { INBOX_RULES, inboxCategory, representativeTurn } from '@shared/inbox'
import { readEventTail } from './logTail'

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
  /** claude면 --effort, opencode면 --variant. 관측본이 없어 이 값이 기록의 전부다 */
  effort: string | null
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
  /** 모델·토큰·컨텍스트. 스트림이 알려주지 않았으면 null이다 (docs/sdlc/run-info/) */
  usage: RunUsage | null
}

/** 사용량이 사는 컬럼들. 이 배열이 펼치기·접기·빼기 세 곳의 단일 출처다. */
const USAGE_COLUMNS = [
  'actualModel', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens',
  'reasoningTokens', 'costUsd', 'contextTokens', 'contextWindow'
] as const

/**
 * 행에서 사용량 컬럼을 떼어낸다.
 *
 * **`{ ...row }`를 그대로 `Run`으로 흘려보내면 안 된다.** 스프레드는 초과 속성
 * 검사를 받지 않으므로 컬럼 아홉이 `usage`와 **함께** 실려 IPC로 나가는데,
 * 타입은 끝까지 아무 말도 하지 않는다. 같은 값이 두 벌 나가고, 나중에 누가
 * 낱개 필드를 쓰기 시작하면 출처가 갈린다.
 */
function withoutUsageColumns(
  row: typeof run.$inferSelect
): Omit<typeof run.$inferSelect, (typeof USAGE_COLUMNS)[number]> {
  const rest: Partial<typeof run.$inferSelect> = { ...row }
  for (const key of USAGE_COLUMNS) delete rest[key]
  return rest as Omit<typeof run.$inferSelect, (typeof USAGE_COLUMNS)[number]>
}

/** `RunUsage` → 컬럼 아홉. 모르는 값은 null로 들어간다(0이 아니다) */
function usageColumns(usage: RunUsage | null) {
  return {
    actualModel: usage?.model ?? null,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    cacheReadTokens: usage?.cacheReadTokens ?? null,
    cacheWriteTokens: usage?.cacheWriteTokens ?? null,
    reasoningTokens: usage?.reasoningTokens ?? null,
    costUsd: usage?.costUsd ?? null,
    contextTokens: usage?.contextTokens ?? null,
    contextWindow: usage?.contextWindow ?? null
  }
}

/**
 * 컬럼 아홉 → `RunUsage`. 전부 NULL이면 `null`이다 — 빈 껍데기를 만들면 화면이
 * "0토큰"으로 읽는다(FR-2의 "줄을 그리지 않는다"가 여기서 갈린다).
 */
function foldUsage(row: typeof run.$inferSelect): RunUsage | null {
  const usage: RunUsage = {
    model: row.actualModel,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    reasoningTokens: row.reasoningTokens,
    costUsd: row.costUsd,
    contextTokens: row.contextTokens,
    contextWindow: row.contextWindow
  }
  return Object.values(usage).every((v) => v === null) ? null : usage
}

export function createRunRepository(db: Database) {
  /**
   * 인박스에 들어올 수 있는 상태 (설계 §4).
   * canceled가 들어 있는 이유: 3a부터 앱이 재시작하며 대기 중이던 run을 취소한다.
   * 사용자가 스스로 취소한 턴은 대화를 대표하지 않는다 — 그 대화에 다른 활성 턴이
   * 없으면 execution.cancel이 뿌리에 reviewedAt을 찍어 대화째 빠지고, 있으면 그 턴의
   * 결과가 대화를 대표한다(`docs/sdlc/conversation-fixes/` spec FR-8, 시작하지 못한
   * 취소는 `representativeTurn`이 건너뛴다). 타임아웃은 canceled가 아니라 failed다
   * (FR-10). 그래서 여기 남는 canceled는 앱이 취소한 것뿐이다.
   */
  const INBOX_STATUSES: RunStatus[] = ['succeeded', 'failed', 'interrupted', 'canceled']

  /**
   * 아직 살아 있는 id와 **지금의 이름**.
   *
   * 설계 §5는 `ON DELETE SET NULL`을 요구하지만 `item_id`는 repo·issue·memo·asset을
   * 함께 가리키는 다형 참조라 외래키 자체를 걸 수 없다. 그래서 이슈를 지워도
   * 행에는 죽은 id가 그대로 남는다. 읽는 시점에 걸러내 SET NULL과 같은 관측 동작을
   * 만든다 — run 기록은 남고 맥락 항목만 빠진다.
   *
   * asset도 네 종류 중 하나로 똑같이 다룬다. "asset은 테이블이 없어 걸러내지
   * 않는다"는 4단계의 결정이었고, 그 전제가 사라졌다 — 이름을 붙이려면 어차피
   * 조회하므로 이름을 못 찾은 asset은 다른 종류와 같이 빠진다
   * (`docs/sdlc/conversation-context/spec.md` 확인 필요 항목, 2026-09-17 승인).
   *
   * 종류당 한 번만 부른다(`inArray`) — run마다 부르면 N+1이 된다.
   */
  function livingNames(type: ContextItemType, ids: string[]): Map<string, string> {
    if (ids.length === 0) return new Map()
    // 이름 컬럼은 종류마다 다르다 — repo·asset은 name, issue·memo는 title.
    const rows = type === 'repo'
      ? db.select({ id: repo.id, name: repo.name }).from(repo)
        .where(inArray(repo.id, ids)).all()
      : type === 'issue'
        ? db.select({ id: issue.id, name: issue.title }).from(issue)
          .where(inArray(issue.id, ids)).all()
        : type === 'memo'
          ? db.select({ id: memo.id, name: memo.title }).from(memo)
            .where(inArray(memo.id, ids)).all()
          : db.select({ id: asset.id, name: asset.name }).from(asset)
            .where(inArray(asset.id, ids)).all()
    return new Map(rows.map((r) => [r.id, r.name]))
  }

  function loadContext(runIds: string[]): Map<string, ContextItemView[]> {
    const map = new Map<string, ContextItemView[]>()
    if (runIds.length === 0) return map
    const rows = db.select().from(runContextItem)
      .where(inArray(runContextItem.runId, runIds)).all()

    const idsOf = (type: ContextItemType) =>
      rows.filter((r) => r.itemType === type && r.itemId).map((r) => r.itemId!)
    const names = {
      repo: livingNames('repo', idsOf('repo')),
      issue: livingNames('issue', idsOf('issue')),
      memo: livingNames('memo', idsOf('memo')),
      asset: livingNames('asset', idsOf('asset'))
    }

    for (const row of rows) {
      if (!row.itemId) continue
      const label = names[row.itemType].get(row.itemId)
      // 이름이 없다 = 지워졌다. 종류를 가리지 않고 뺀다.
      if (label === undefined) continue
      const list = map.get(row.runId) ?? []
      list.push({ type: row.itemType, id: row.itemId, label })
      map.set(row.runId, list)
    }
    return map
  }

  function hydrate(rows: (typeof run.$inferSelect)[]): Run[] {
    const ctx = loadContext(rows.map((r) => r.id))
    return rows.map((r) => ({
      ...withoutUsageColumns(r),
      contextItems: ctx.get(r.id) ?? [],
      usage: foldUsage(r)
    }))
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

  /**
   * `title`·`closed_at`은 **뿌리 행에서만 의미가 있다**(스키마 주석). 이어지는 턴의
   * 행에도 컬럼이 있고 null일 뿐이라 **타입은 이 규칙을 지켜주지 않는다** — 여기가
   * 유일한 방어선이다. 조용히 엉뚱한 행에 찍히면 화면에서 영영 드러나지 않는다.
   */
  function assertRoot(id: string, what: string): void {
    const row = get(id)
    if ((row.rootRunId ?? row.id) !== row.id) {
      throw new Error(`대화의 뿌리만 ${what} 수 있습니다`)
    }
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
   * 미확인 대화마다 **대표 턴** 하나씩을 골라낸다. `inbox()`와 `inboxCounts()`가
   * "대화별로 묶어 대표 턴을 고른다"는 같은 규칙을 공유하는 자리다 — 따로
   * 짜면 배지와 목록이 어긋날 수 있다 (설계 §5).
   *
   * 대표 턴은 "마지막으로 만든 턴"이 아니다. 시작하지 못하고 취소된 예약은 건너뛴다
   * — 그러지 않으면 2턴의 실패가 3턴 예약의 canceled에 가려 배지에서 빠진다
   * (`docs/sdlc/conversation-fixes/` spec FR-1·FR-2). 규칙은 `shared/inbox.ts`의
   * `representativeTurn` 하나이고 renderer의 도크 목록도 그것을 쓴다.
   *
   * **컬럼은 호출자가 고른다.** `inbox()`는 화면에 그릴 전체 run이 필요하지만
   * `inboxCounts()`는 세기만 하면 되므로, `select`로 필요한 컬럼만 읽게 한다
   * — 배지 갱신마다 `assembled_prompt`까지 포함한 전체 행을 나르는 비용을
   * 없앤다 (리뷰 I-2). 대표 턴 판정에 `startedAt`이 필요하다.
   */
  function lastTurnsOf<T extends {
    id: string; rootRunId: string | null; status: RunStatus; startedAt: number | null
  }>(
    rootIds: string[],
    select: (rootIds: string[]) => T[]
  ): T[] {
    if (rootIds.length === 0) return []
    const rows = select(rootIds)

    const rootOf = new Set(rootIds)
    // 최신순으로 들어오므로 대화별 목록도 최신순이다 — representativeTurn의 입력 순서다.
    const turnsOf = new Map<string, T[]>()
    for (const row of rows) {
      const key = row.rootRunId ?? row.id
      // 뿌리가 이미 확인된 대화의 턴이 섞여 들어올 수 있다 — 걸러낸다.
      if (!rootOf.has(key)) continue
      const list = turnsOf.get(key)
      if (list) list.push(row)
      else turnsOf.set(key, [row])
    }
    const picked: T[] = []
    for (const turns of turnsOf.values()) {
      const turn = representativeTurn(turns)
      if (turn && INBOX_STATUSES.includes(turn.status)) picked.push(turn)
    }
    return picked
  }

  /** 두 쿼리가 함께 쓰는 정렬 — 최신순이므로 대화별 목록이 대표 턴 판정의 입력 순서가 된다. */
  const byLatest = [desc(run.createdAt), desc(sql`rowid`)] as const

  /**
   * 지금 사용자의 손이 필요한 대화만 모은다 (설계 §5).
   *
   * **단위는 run이 아니라 대화다.** 미확인 판정은 root run의 reviewedAt으로
   * 하고, 보여줄 내용은 그 대화의 대표 턴(`representativeTurn` — 시작하지 못하고 취소된
   * 턴을 건너뛴 가장 최근 턴)에서 가져온다. 턴마다 한 줄씩
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

    /**
     * 그 대화에서 아직 끝나지 않은 턴(running·pending)의 id.
     *
     * 취소가 뿌리에 확인 표시를 찍을지 정한다 (`docs/sdlc/conversation-fixes/` spec
     * FR-8) — 다른 활성 턴이 남아 있으면 그 턴의 결과가 인박스를 정해야 하므로 찍지
     * 않는다. launch 중인 턴(행은 있고 큐에는 아직 없다)도 DB에서는 pending이라 함께
     * 걸린다. 대화당 running 하나 + 예약 하나라 결과는 많아야 둘이다.
     */
    activeTurnIds(rootRunId: string): string[] {
      return db.select({ id: run.id }).from(run)
        .where(and(
          // 낡은 행은 root_run_id가 null이고 그때는 자기 자신이 뿌리다.
          or(eq(run.rootRunId, rootRunId), and(isNull(run.rootRunId), eq(run.id, rootRunId))),
          inArray(run.status, ['running', 'pending'])
        ))
        .all()
        .map((r) => r.id)
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
          effort: input.effort,
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
        // 같은 자리에서 **종료도 푼다** (conversation-lifecycle spec FR-13).
        // 끝낸 대화에 턴을 보내면 되살아난다 — 찍는 자리(close)와 지우는 자리가
        // 짝이어야 한다. 새 자리를 만들지 말 것: 갈라놓으면 한쪽만 고쳐져
        // "화면에서는 사라진 채로 실행만 되는" 대화가 생긴다.
        if (input.parentRunId) {
          tx.update(run).set({ reviewedAt: null, reviewedKind: null, closedAt: null })
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

    /**
     * 도는 중에 알게 된 세션 id를 곧바로 남긴다 (`docs/sdlc/conversation-fixes/` spec FR-16).
     *
     * 종료 기록(`markFinished`)만 기다리면 첫 턴이 도는 중 앱이 꺼졌을 때 행은
     * interrupted가 되는데 세션 id가 없어 — `latestSessionRun`이 그 턴을 못 집어 —
     * 대화를 이으면 "이어받을 세션이 없습니다"로 실패한다. `reapStale`은 이 컬럼을
     * 건드리지 않으므로 여기 남긴 값이 재시작 뒤에도 산다.
     *
     * **이미 값이 있으면 덮지 않는다.** 처음 알린 세션이 이 턴의 세션이고, 같은 id를
     * 거듭 받는 것(claude는 init과 result 둘 다에 싣는다)은 쓰기 없이 지나간다.
     * 행을 돌려주지 않는다 — 화면이 볼 값이 아니라 이어가기의 재료다.
     *
     * **빈 문자열은 세션이 아니다.** claude 어댑터는 init에 `session_id`가 없으면 ''를
     * 싣는다(manager의 `learnSession`도 거른다). 먼저 쓴 값이 이기므로 ''가 들어가면 진짜
     * id가 막히고, `latestSessionRun`(isNotNull)이 그 턴을 골라 앞 턴의 세션까지 가린다.
     */
    saveExternalSessionId(id: string, sessionId: string): void {
      if (sessionId === '') return
      db.update(run).set({ externalSessionId: sessionId })
        .where(and(eq(run.id, id), isNull(run.externalSessionId))).run()
    },

    /**
     * 종료를 기록한다.
     *
     * **세션 id가 null이면 있던 값을 지우지 않는다** (`saveExternalSessionId`와 짝). 도는
     * 중에 남긴 세션을 종료 기록이 모를 수 있다 — manager.start가 세션을 배운 뒤 거부되면
     * 실행 서비스는 `externalSessionId: null`로 끝낸다. 덮으면 이을 수 있던 대화가 끊긴다.
     * 값이 있으면 그것이 이긴다(스트림이 마지막에 알려 준 세션이다).
     */
    markFinished(id: string, input: FinishRunInput): Run {
      const { usage, externalSessionId, ...rest } = input
      db.update(run)
        .set({
          ...rest,
          ...(externalSessionId !== null ? { externalSessionId } : {}),
          ...usageColumns(usage),
          endedAt: Date.now()
        })
        .where(eq(run.id, id)).run()
      return get(id)
    },

    /**
     * 종료된 run의 로그를 파일에서 되살린다.
     * 메모리 스토어는 상한이 있고 앱 재시작이면 비어 있으므로, 지난 run의 탭을
     * 다시 열 때는 여기가 유일한 출처다. 깨진 줄은 건너뛴다.
     *
     * **비동기로 읽는다** (`docs/sdlc/conversation-fixes/` spec FR-19). 이 저장소는 메인
     * 프로세스에서 돌고 같은 프로세스에 MCP 서버가 있다 — 긴 로그를 동기로 읽는 동안
     * IPC와 agent의 MCP 호출이 전부 멈춘다. 파일이 없는 것(취소됐거나 spawn 전에 끝난
     * run)만 빈 배열이고, 그 밖의 읽기 실패는 그대로 던진다 — 삼키면 로그가 원래 없던
     * run처럼 보인다.
     *
     * **창 안의 꼬리만 돌려준다** (`docs/sdlc/conversation-events/` spec FR-33). 끝에서부터
     * 개수·글자 두 한계를 모두 지키는 만큼, 순서는 파일 그대로(seq 오름차순)다. 렌더러
     * 스토어와 같은 창(`RUN_EVENT_WINDOW`)이라 긴 run의 로그 전체를 IPC로 보냈다가 스토어가
     * 버리는 일이 없다. 무게는 **파싱하지 않은 줄의 길이**다 — `createLogWriter`가 쓴 줄이
     * 정확히 `JSON.stringify(event)`라 `eventWeight`와 같은 수이고, 창이 찬 뒤의 앞줄들은
     * 파싱하지 않는다. 깨진 줄은 건너뛰고 창에도 세지 않는다. 혼자서 창보다 무거운 줄은
     * 남지 않는다 — 스토어도 같은 규칙이다(한쪽만 "하나는 남긴다"면 둘이 갈린다).
     *
     * 모르는 `type`의 줄도 그대로 넘긴다(FR-34) — 렌더러가 모르는 종류를 무시한다.
     * 같은 디렉토리의 `raw.jsonl`은 읽지 않는다(FR-6). `window`는 테스트가 작게 준다 —
     * IPC 핸들러는 run id만 넘긴다.
     */
    async readLog(
      id: string,
      window: { maxEvents: number; maxChars: number } = RUN_EVENT_WINDOW
    ): Promise<RunEvent[]> {
      // **파일 전체를 읽지 않는다**(리뷰 반영 2026-09-27) — 끝에서부터 덩어리로 거꾸로 읽어 창이 차면
      // 멈춘다. 전체를 문자열로 읽으면 창과 무관하게 메인 프로세스가 로그 크기만큼 메모리를 잡고,
      // V8 문자열 한계를 넘는 로그에서는 던졌다.
      return readEventTail(get(id).logPath, window)
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
     * 목록과 같은 "대화별로 묶어 대표 턴을 고른다" 규칙으로 센다 — 따로
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
        id: run.id, workspaceId: run.workspaceId, rootRunId: run.rootRunId,
        // 카테고리 판정에 needs_answer가, 대표 턴 판정에 started_at이 필요하다.
        // 컬럼이 늘 뿐 assembled_prompt는 여전히 읽지 않는다 (spec NFR-1).
        status: run.status, needsAnswer: run.needsAnswer, startedAt: run.startedAt
      }).from(run)
        .where(or(inArray(run.rootRunId, ids), inArray(run.id, ids)))
        .orderBy(...byLatest).all())

      const byWorkspace: Record<string, number> = {}
      let total = 0
      for (const item of items) {
        // **목록과 달리 배지는 "지금 손이 필요한 것"만 센다** (spec FR-4).
        // 완료·미확인까지 세면 숫자가 대화 수만큼 단조 증가해 빨간 원이 무의미해진다.
        // 이 판정은 renderer의 자동 확인과 **같은 표**(shared/inbox.ts)에서 온다 —
        // 따로 적으면 어느 쪽에도 안 걸리는 카테고리가 생긴다.
        if (!INBOX_RULES[inboxCategory(item)].badge) continue
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
    },

    /**
     * 대화를 끝낸다 (`docs/sdlc/conversation-lifecycle/` FR-12).
     *
     * **확인도 겸한다.** 같은 트랜잭션에서 아직 미확인이면 `reviewedAt`도 찍는다 —
     * 겸하지 않으면 끝낸 대화가 도크 목록에서는 사라졌는데 배지에는 남아, 그때는
     * 내릴 방법조차 없다. 이미 확인된 것은 처음 시각을 덮어쓰지 않는다
     * (`markReviewed`와 같은 규칙).
     *
     * **기록을 지우지 않는다** — 화면에서 내릴 뿐이다(전체 설계 §232).
     */
    close(rootRunId: string): Run {
      assertRoot(rootRunId, '끝낼')
      db.transaction((tx) => {
        const now = Date.now()
        tx.update(run).set({ closedAt: now }).where(eq(run.id, rootRunId)).run()
        tx.update(run)
          .set({ reviewedAt: now, reviewedKind: 'archived' })
          .where(and(eq(run.id, rootRunId), isNull(run.reviewedAt))).run()
      })
      return get(rootRunId)
    },

    /**
     * 대화에 이름을 붙인다 (FR-14).
     *
     * **빈 값은 null로 저장해 파생으로 되돌린다** — workspace 기본값의 "빈 모델은
     * null"과 같은 규칙이다. 빈 문자열로 두면 화면이 제목 없는 줄을 그린다.
     */
    rename(rootRunId: string, title: string): Run {
      assertRoot(rootRunId, '이름을 붙일')
      const trimmed = title.trim()
      db.update(run).set({ title: trimmed === '' ? null : trimmed })
        .where(eq(run.id, rootRunId)).run()
      return get(rootRunId)
    }
  }
}

export type RunRepository = ReturnType<typeof createRunRepository>
