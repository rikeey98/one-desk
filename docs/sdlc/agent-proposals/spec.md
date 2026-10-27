# Spec: agent가 알아채 제안하고, 사람은 한 번 누른다 — 첫째 사이클 (대화의 이슈화)

- 출처: `intent.md` (원하는 결과 (1) — (2) workspace 정리는 둘째 사이클이다)
- 작성자: 권용현 (초안: Claude)
- 상태: **승인됨** (2026-10-27, 사용자 "spect 만들어줘 개발") — 구현 전. 사용자가 뒤집을 수 있는 결정은 §8에 모았다.
- 작성일: 2026-10-27

## 0. intent의 미해결 질문에 대한 답 (이 사이클 몫)

| 질문 | 답 | 자리 |
|---|---|---|
| 제안을 앱에 어떻게 넘기나 | **제안 전용 MCP 도구 `propose_issue`** (intent에서 사용자가 B로 정했다). 모든 권한에 선다. 쓰는 곳은 제안 저장소뿐이다 | FR-6~12 |
| "읽기 전용"의 뜻 | **"앱 데이터(이슈·메모·대화)와 파일을 바꾸는 도구가 없다."** 제안은 사람이 받기 전에는 아무것도 바꾸지 않으므로 그 안에 든다 | FR-13 |
| 후보는 언제 내나 | 이슈가 할당되지 않았고, 이 대화에 거절한 제안도 기다리는 제안도 없는 동안 **매 턴** 안내를 붙인다. agent는 턴의 끝에 한 번만 부른다 | FR-14~16 |
| 제안은 저장하나 | **저장한다** — 새 테이블 `proposal`, 마이그레이션 `0012`. 앱을 다시 켜도 배너가 남고 `아니요`가 기억된다 | FR-1~5 |
| 대화당 제안은 몇 개 | 기다리는 것은 **하나**. 새로 부르면 앞의 것을 `superseded`로 내리고 새 행이 선다(DB의 부분 유니크 인덱스가 지킨다) | FR-4·FR-9 |
| 이미 이슈가 있거나 거절한 대화에서 부르면 | **도구 오류로 돌려준다** — 저장하지 않는다. 안내도 붙지 않으므로 드물다 | FR-10 |
| 비슷한 이슈가 있으면 | 안내가 `list_issues`를 먼저 보라고 시키고, 같은 일이면 `existingIssueId`를 준다. 배너는 `기존 이슈에 붙이기`를 먼저 세운다 | FR-7·FR-16·FR-22 |
| 받기 전에 고칠 수 있나 | **새 이슈의 제목만** 고친다(한 줄 입력칸). 본문·repo·분류 축은 보이기만 한다 — 받은 뒤 상세에서 고친다 | FR-21 |
| 받으면 무엇이 바뀌나 | core의 **한 트랜잭션**에서 이슈를 만들거나(기존이면 고르고) → 뿌리에 할당 → 제안을 `accepted`. 하나라도 실패하면 전부 되돌린다 | FR-17~19 |
| 배너의 자리 | **대화 칸 안, 대화록과 입력부 사이** — 마지막 답 바로 아래이고 입력부 바로 위다. 대화록과 함께 스크롤되지 않는다 | FR-20 |
| 화면은 어떻게 아나 | 바뀜 알림에 종류 `proposal`을 더한다(`event:itemChanged`). 도크가 그 workspace의 기다리는 제안을 다시 읽는다 | FR-12·FR-24 |
| agent 종류 | **두 agent 모두** 같은 도구다. 단 OpenCode의 읽기 전용·편집 허용이 MCP 도구를 막는지는 확인하지 않았다 — plan 0단계가 진짜 CLI로 본다 | §6 우려 1 |

## 1. 범위

**들어가는 것.**

- **(A) 제안 저장소** — 종류(`kind`)와 JSON `payload`와 상태를 갖는 일반 테이블. 둘째 사이클이 종류를 더해 그대로 쓴다. 이번에 만드는 종류는 `conversation-issue` 하나다.
- **(B) MCP `propose_issue`** — 모든 권한에 선다. 제안 저장소에만 쓴다.
- **(C) 프롬프트 안내** — 이슈 없는 대화에만, 문턱을 높게.
- **(D) 받기·거절** — core의 트랜잭션 하나, IPC 셋(목록·받기·거절), 얇은 핸들러.
- **(E) 배너** — 대화 칸의 `이 대화를 이슈로 만들까요?`.

**빠지는 것.**

- (2) workspace 정리 전부 — 정리 run, 제안 목록 화면, 합치기·메모로 옮기기·완료·끝내기 종류. 저장소의 모양만 그것을 받을 수 있게 둔다(FR-1).
- 도크 목록 줄·홈·인박스에 "제안이 있다" 표시. 배너는 그 대화를 열었을 때만 보인다(§6 우려 4).
- 거절을 되돌리는 화면. 되돌리고 싶으면 헤더 `⋯`의 `이슈 할당`으로 손으로 붙인다(conversation-issue FR-21).
- 인박스의 `이슈로 만들기`(실패한 run에서 이슈를 만들고 보관한다, `renderer/App.tsx` 451)를 이 길로 바꾸는 것 — 그대로 둔다.
- MCP 쓰기 도구(`create_issue`·`update_issue`…)의 권한 경계 — 그대로다. issue-flow 첫째 사이클의 `update_issue` 확장과도 독립이다.

## 2. 데이터 모양

### 2-1. 비교한 설계

| | A. `proposal` 테이블 (고른 것) | B. 뿌리 run 행의 컬럼 | C. 이슈를 바로 만들고 `proposed` 상태로 |
|---|---|---|---|
| 모양 | 새 테이블: 출처 대화 · 종류 · JSON payload · 상태 | `run.proposed_issue`(JSON) · `run.issue_proposal_status` | `issue.status`에 `proposed` 하나 더 |
| 화면에 닿는 길 | 바뀜 알림 `proposal` → 도크가 다시 읽는다 | `Run`에 실어 기존 `RUN_UPDATE` push로 | 이슈 목록 그대로 |
| 둘째 사이클 | **그대로 쓴다** — 정리 run 하나가 여러 대상에 여러 제안을 낸다. 종류를 더할 뿐이다 | 못 쓴다. 정리 제안은 대화 하나에 매달리지 않는다(이슈 둘을 합치는 제안) | 못 쓴다. 대화를 끝내는 제안·합치기는 이슈 상태로 나타낼 수 없다 |
| 지키는 약속 | 사람이 받기 전에는 이슈·대화 테이블에 한 줄도 쓰지 않는다 | 같다 | **깨진다.** 이슈 패널·홈·리포트·`list_issues`·배지가 전부 `proposed`를 걸러야 하고 하나라도 빠뜨리면 받지 않은 이슈가 보인다 |
| 대가 | 테이블·저장소·IPC 셋이 는다 | `Run` 스프레드 함정(CLAUDE.md)에 컬럼 둘이 더 걸리고, `hydrate`마다 JSON을 파싱하고, MCP `list_conversations`까지 무거워진다 | `IssueStatus`의 모든 소비자와 `ISSUE_STATUS_VALUES`의 exhaustive 검사를 건드린다 |

B는 이번 사이클만 보면 가장 싸지만 둘째 사이클이 다시 만들어야 한다. C는 intent의 제약 "사람이 받기 전에는 아무것도 바뀌지 않는다"를 저장 모양에서 깨뜨린다. **A를 고른다.**

화면에 닿는 길도 둘을 비교했다. `Run`에 접어 실으면 push가 공짜지만 그것이 곧 B의 대가다(모든 run 읽기가 제안 테이블을 한 번 더 본다). 바뀜 알림은 item-windows가 이미 깐 길이고(`core/changes.ts` 27, `renderer/hooks/useItemChanged.ts` 11), agent의 MCP 쓰기가 화면에 닿는 길과 같다. **바뀜 알림을 고른다.**

### 2-2. 테이블

- **FR-1.** 새 테이블 `proposal` (`core/db/schema.ts`):

  | 컬럼 | 타입 | 뜻 |
  |---|---|---|
  | `id` | text PK | `randomUUID()` |
  | `workspace_id` | text NOT NULL, FK `workspace.id` cascade | 소속. 모든 읽기의 범위다 |
  | `root_run_id` | text NOT NULL, FK `run.id` cascade | 제안을 낸 **대화**(뿌리). 둘째 사이클에서는 정리 run의 대화다 |
  | `run_id` | text NOT NULL | 제안을 낸 **턴**. 외래키 없음(기록일 뿐이다) |
  | `kind` | text NOT NULL | 이번에는 `'conversation-issue'`뿐. CHECK 없음 — 늘어도 마이그레이션이 없다(`asset.kind`와 같은 판단, `schema.ts`의 asset 주석) |
  | `payload` | text NOT NULL | 종류별 JSON(FR-2). 쓰고 읽을 때 같은 스키마로 검증한다 |
  | `status` | text NOT NULL default `'pending'` | `pending` · `accepted` · `declined` · `superseded` |
  | `created_at` | integer NOT NULL | epoch ms, `Date.now()`로 명시 삽입(데이터 규칙) |
  | `decided_at` | integer | 받거나 거절하거나 밀려난 때. `pending`이면 null |

  인덱스: `(workspace_id, status)` — 도크가 기다리는 것을 읽는다. `(root_run_id)` — 안내와 도구가 그 대화의 거절·기다림을 본다.
  **부분 유니크 인덱스 `(root_run_id) WHERE status = 'pending' AND kind = 'conversation-issue'`** — 대화당 기다리는 이슈화 제안은 하나다(FR-4). `kind`를 조건에 넣는 것은 둘째 사이클의 정리 run이 한 대화에서 여러 제안을 기다리게 하려는 것이다.
- **FR-2.** `conversation-issue`의 payload:

  ```ts
  interface ConversationIssuePayload {
    title: string            // 한 줄, 1~200자. 기존 이슈를 고른 제안에도 있다 — 기존 이슈가 지워졌을 때의 대안이다(FR-22)
    body: string             // 0~4,000자
    repoIds: string[]        // 같은 workspace의 repo. 빈 배열 = repo 없음
    source: IssueSource | null
    kind: IssueKind | null
    priority: IssuePriority | null
    existingIssueId: string | null  // 같은 일을 하는 열린 이슈. 있으면 배너가 그것을 먼저 권한다
  }
  ```

  선택 필드(`?`)를 쓰지 않고 null로 채운다 — DB에 들어갔다 나오는 JSON이라 "키가 없다"와 "null"이 갈리면 읽는 쪽이 둘을 다 다뤄야 한다. 검증은 zod 스키마 하나(`core/proposals/payload.ts`)이고 MCP 입력과 DB 읽기가 같이 쓴다. DB에서 읽은 payload가 스키마에 맞지 않으면 그 행을 목록에서 빼고 `onError`로 알린다(앱이 쓴 값만 들어가므로 일어나면 결함이다).
- **FR-3.** 화면으로 나가는 모양은 **종류로 가른 유니온**이다 (`shared/models.ts`):

  ```ts
  type ProposalStatus = 'pending' | 'accepted' | 'declined' | 'superseded'

  interface ProposalBase {
    id: string; workspaceId: string; rootRunId: string; runId: string
    status: ProposalStatus; createdAt: number; decidedAt: number | null
  }

  interface IssueProposal extends ProposalBase {
    kind: 'conversation-issue'
    payload: ConversationIssuePayload
    /** existingIssueId를 읽는 시점의 이슈. 지워졌거나 다른 workspace면 null (Run.issue와 같은 규칙) */
    existingIssue: { id: string; title: string; status: IssueStatus } | null
  }

  type Proposal = IssueProposal  // 둘째 사이클이 갈래를 더한다
  ```

  `existingIssue`는 `Run.issue`처럼 core가 읽는 시점에 붙인다(`core/db/repositories/run.ts` 200~208의 `hydrate`와 같은 모양, `inArray` 한 번).
- **FR-4.** **대화당 기다리는 이슈화 제안은 하나다.** 새 제안을 저장할 때 같은 대화의 `pending` 이슈화 제안을 `superseded`로 내리고 새 행을 넣는다 — 한 트랜잭션이다. 제자리 갱신이 아니라 새 행인 것은 배너의 제목 입력칸이 제안 id를 key로 잡기 때문이다(id가 같으면 사람이 고치던 제목이 새 제안의 제목을 덮는다).
- **FR-5.** 마이그레이션 `0012`는 `CREATE TABLE proposal`과 인덱스 셋뿐이다. 기존 테이블을 다시 만들지 않는다 — drizzle이 만든 SQL을 반드시 읽는다(conversation-issue FR-4와 같은 이유, `DROP TABLE run`이 `run_context_item`의 cascade를 태운다). 백필 없음.

## 3. 기능 요구사항

### (B) MCP `propose_issue`

- **FR-6.** 토큰이 대화를 안다 — `RunContext`(`core/mcp/host.ts` 17~25)에 **필수** `rootRunId: string`을 더한다. execution이 MCP를 준비하는 자리(`core/execution.ts` 474~480)가 `created.rootRunId ?? created.id`를 넘긴다. 도구가 `runs.get(runId)`로 뿌리를 다시 찾지 않는다 — 토큰이 run 하나에 묶인 것처럼 대화에도 묶인다. 선택 필드면 한 자리를 빠뜨려도 컴파일되고 그 run의 제안만 엉뚱한 대화에 붙는다.
- **FR-7.** 도구 `propose_issue`의 입력:
  - `title` — `z.string().trim().min(1).max(200).regex(/^[^\n]+$/)`
  - `body` — `z.string().max(4000).default('')`
  - `repoIds` — `z.array(z.string()).default([])`
  - `source`·`kind`·`priority` — `create_issue`와 같은 enum(`tools.ts` 144~162), 선택
  - `existingIssueId` — `z.string().optional()`
  - 설명: `이 대화가 처리해야 할 일이면 사람에게 이슈로 만들자고 제안한다. 아무것도 만들거나 바꾸지 않는다 — 사람이 받아야 이슈가 생기고 이 대화에 할당된다. 같은 일을 하는 열린 이슈가 있으면 existingIssueId로 그 이슈를 준다.`
- **FR-8.** 결과는 `{ proposalId, status: 'pending' }` 한 줄이다. 이슈를 돌려주지 않는다 — 아직 이슈가 아니다.
- **FR-9.** 저장 전에 검증하고, 걸리면 도구 오류(`isError`)로 돌려준다(`reply`, `tools.ts` 24 — run을 죽이지 않는다):
  - `existingIssueId`가 토큰의 workspace 이슈가 아니면 `이슈를 찾을 수 없습니다: <id>` — `loadIssue`(`tools.ts` 43)를 지나 존재를 알리지 않는다. 그 이슈가 `done`이면 `완료된 이슈에는 붙일 수 없습니다 — 새 이슈로 제안하세요`.
  - `repoIds` 중 토큰의 workspace repo가 아닌 것이 있으면 `이 workspace의 repo가 아닙니다: <id>`.
  - 통과하면 FR-4대로 저장한다.
- **FR-10.** **대화가 이미 이슈를 가졌거나 사람이 거절했으면 저장하지 않는다.**
  - 뿌리에 살아 있는 이슈가 할당돼 있으면(`Run.issue !== null` — 지운 이슈는 null이라 공통 대화로 친다) `이 대화에는 이미 이슈가 할당돼 있습니다`.
  - 그 대화에 `declined` 이슈화 제안이 있으면 `사용자가 이 대화를 이슈로 만들지 않기로 했습니다. 다시 제안하지 마세요`.
- **FR-11.** 도구는 **제안 저장소에만** 쓴다. `deps`에는 제안 저장소를 넘기고(`McpHostDeps`, `tools.ts` 15), 이슈·run 저장소는 이 도구에서 읽기만 한다. `tools.test`가 "부른 뒤 이슈 수와 뿌리의 `issue`가 그대로다"를 고정한다.
- **FR-12.** 저장하면 바뀜 알림 `{ workspaceId, kind: 'proposal' }`을 낸다. 알림은 core가 저장소를 만드는 자리에서 감싼 래퍼가 낸다(`core/changes.ts`의 `notifyingProposals`, `notifyingIssues`와 같은 모양) — IPC 표면과 MCP `deps`가 같은 감싼 저장소를 받는다(item-windows FR-17, `core/index.ts` 150~168). `ItemChange['kind']`(`shared/models.ts` 47)에 `'proposal'`을 더한다.
- **FR-13.** **`propose_issue`는 읽기 전용에서도 선다.** `tools.ts` 225~227의 조기 반환 **앞에** 등록하고, 그 주석을 다시 쓴다:
  - 새 정의: **읽기 전용은 "앱 데이터(이슈·메모·대화)와 파일을 바꾸는 도구가 없다"이다.** 제안은 사람이 받기 전에는 어떤 이슈·메모·대화도 바꾸지 않는다. 받기는 사람이 누른 버튼이고 IPC로만 간다 — MCP에 받는 도구가 없다.
  - 근거: 설계 §8이 지키려던 것은 "읽기 전용인데 이슈 상태가 바뀐다"는 놀람이다. 제안은 그 놀람을 만들지 못한다 — 배너에 `이슈로 만들기`를 누르기 전까지 이슈 패널·홈·리포트·`list_issues` 어디에도 아무것도 생기지 않는다. 반대로 읽기 전용에서 막으면 intent의 "권한과 상관없이 된다"가 깨진다 — 가볍게 묻는 대화일수록 읽기 전용이고, 그 대화가 바로 이슈 없이 시작된 대화다.
  - 남는 쓰기: 제안 테이블의 행. agent가 같은 대화에서 계속 부르면 `superseded` 행이 쌓인다 — 한 턴에 한 번이라는 안내(FR-16)와 행의 크기 상한(FR-7)이 받는다. 지우는 규칙은 두지 않는다(§6 우려 5).
  - `tools.test`의 "읽기 전용에는 쓰기 도구가 없다"는 그대로 초록이어야 하고, 같은 파일에 "읽기 전용에도 `propose_issue`가 있다"를 더한다.

### (C) 프롬프트 안내

- **FR-14.** `assemblePrompt`(`core/context/assemble.ts` 60)의 입력에 **필수** `proposeIssue: boolean`을 더한다. 참이면 `NEEDS_ANSWER_GUIDE`(54~58) 바로 뒤에 `PROPOSE_ISSUE_GUIDE`를 붙인다 — 슬래시 갈래(131)와 보통 갈래(141) 둘 다. 필수인 이유는 `resolveAgentPath`의 앱 기본값과 같다 — 선택이면 호출 자리가 빠뜨려도 조용히 거짓으로 돈다.
- **FR-15.** 참인 조건은 execution의 `launch`가 한 자리에서 정한다(`core/execution.ts` 365):
  1. MCP가 배선돼 있다(`opts.mcp`) — 없으면 부를 도구가 없다.
  2. 대화에 할당이 없다 — 새 대화면 `start`가 정한 `issueId`(`soleIssueOf`를 거친 뒤, 571)가 null, 이어 가는 대화면 `resume`의 `assigned`(619)가 null.
  3. 그 대화에 `declined`·`pending` 이슈화 제안이 없다 — 새 대화는 뿌리가 아직 없으므로 늘 참이다.

  판정은 순수 함수 `shouldProposeIssue({ mcp, assignedIssueId, proposals })`(`core/proposals/guide.ts`)이고 `launch`는 결과를 넘길 뿐이다. 기다리는 제안이 있는 동안 안내를 빼는 것은 사람이 답하기 전에 같은 질문을 다시 묻지 않으려는 것이다 — 도구 자체는 그때도 부를 수 있고 FR-4가 갈아끼운다.
- **FR-16.** 안내 문구 (`PROPOSE_ISSUE_GUIDE`):

  ```
  이 대화에는 아직 이슈가 없다. 이 대화의 일이 나중에 다시 챙겨야 할 "처리할 일"(고칠 버그, 만들 기능, 이어서 할 작업)이면,
  작업을 마친 뒤 propose_issue 도구로 사람에게 이슈로 만들자고 한 번 제안할 것.
  - 질문에 답하기, 설명, 잡담, 한 번 확인하고 끝나는 일에는 제안하지 말 것. 애매하면 제안하지 말 것.
  - 제안하기 전에 list_issues로 이 workspace의 열린 이슈를 볼 것. 같은 일을 하는 이슈가 있으면 existingIssueId로 그 이슈를 줄 것.
  - 제목은 한 줄로, 무엇을 해야 하는지가 드러나게. 본문은 한두 줄.
  - 제안했다는 사실을 답에 쓰지 말 것. 사람이 화면에서 따로 본다.
  ```

  한 번 정한 문구는 바꿀 때 실측한다(plan 10단계 — 질문 대화에서는 제안하지 않고 일 대화에서는 하는가).

### (D) 받기·거절

- **FR-17.** `core.proposals.accept(id, choice)` — `choice`는 `{ mode: 'new'; title: string } | { mode: 'existing' }`. **한 트랜잭션**(`db.transaction`)에서:
  1. 제안을 읽는다. `pending`이 아니면 `이미 처리된 제안입니다`. 종류가 `conversation-issue`가 아니면 던진다.
  2. 뿌리에 살아 있는 이슈가 있으면 `이 대화에는 이미 이슈가 할당돼 있습니다` — 사람이 `⋯`로 먼저 붙였을 수 있다.
  3. `existing`이면 `existingIssueId`의 이슈가 같은 workspace에 있어야 한다(없으면 `제안한 이슈가 지워졌습니다`). `new`면 `issues.create({ workspaceId, title, body, repoIds, source, kind, priority })` — 제목은 `choice.title`(trim, 빈 값·줄바꿈 거부).
  4. `runs.assignIssue(rootRunId, issueId)`(`run.ts` 642 — `assertRoot`와 소속 검증을 그대로 탄다).
  5. 제안을 `accepted`, `decided_at = Date.now()`.

  저장소 메서드는 각자 `db.transaction`을 쓰지만 better-sqlite3는 열린 트랜잭션 안의 트랜잭션을 savepoint로 바꾼다(`better-sqlite3/lib/methods/transaction.js` 54) — 바깥 트랜잭션 하나가 다섯 단계를 함께 되돌린다. plan 0단계가 "4에서 던지면 3의 이슈도 없다"를 테스트로 먼저 고정한다.
- **FR-18.** 트랜잭션이 끝난 **뒤에** 알린다 — `{ kind: 'issue' }`(새 이슈일 때)·`{ kind: 'proposal' }` 바뀜 알림, 뿌리의 `RUN_UPDATE`, `emitInbox()`. `conversations.assignIssue`(`core/index.ts` 867)가 내는 짝과 같다. 트랜잭션 안에서 감싼 저장소의 알림이 나가면 되돌린 쓰기를 화면이 다시 읽게 되므로, 트랜잭션은 감싸지 않은 저장소로 쓰고 알림은 마지막에 한 번 낸다. 결과는 `{ issue: Issue; conversation: Run }`.
- **FR-19.** `core.proposals.decline(id)` — `pending`이 아니면 던지고, `declined`·`decided_at`을 찍고, `{ kind: 'proposal' }`을 알린다. **되돌리는 길이 없다** — 거절은 그 대화에 영구히 남고 FR-10·FR-15가 그것을 본다.
- **FR-20.** `core.proposals.pending(workspaceId): Proposal[]` — 그 workspace의 `pending` 제안, `created_at` 오래된 순. `existingIssue`를 붙인다(FR-3). 받기·거절·목록은 IPC 채널 셋(`proposalsPending`·`proposalsAccept`·`proposalsDecline`, `shared/channels.ts`)이고 핸들러는 core 호출 한 줄이다(`electron/ipc/proposals.ts`, `electron/ipc/runs.ts` 26~29와 같은 모양). MCP에는 받기·거절 도구가 없다.

### (E) 배너

- **FR-21.** 대화 칸(`ConversationPanel`, `renderer/components/ConversationPanel.tsx` 96)의 **대화록과 입력부 사이**에 배너가 선다(`.conversation-proposal`, `role="status"`, `aria-label="이 대화를 이슈로 만들까요?"`). 조건: 이 대화(뿌리 id)의 기다리는 이슈화 제안이 있고 대화의 `issue`가 null이다. 새 대화 칸에는 서지 않는다.
  - 자리의 이유: 제안은 턴의 끝에 오고 사람은 그때 마지막 답과 입력칸을 보고 있다. 헤더는 대화록을 위로 올리면 멀고, 대화록 안에 두면 다음 턴에 밀려 올라가 사라진다.
  - 할당이 생기면(사람이 `⋯`로 먼저 붙였다) 배너는 숨는다. 제안 행은 그대로 `pending`이고, 할당을 떼면 다시 선다(§6 우려 3).
- **FR-22.** 배너의 모양은 두 갈래다.
  - **새 이슈** (`existingIssue`가 null): `이 대화를 이슈로 만들까요?` · 제목 입력칸(이름 `제안된 이슈 제목`, 제안의 제목으로 채운다) · 본문 첫 두 줄(`--text-muted`, 넘치면 `…` 뒤 전체는 `title`) · repo 이름과 분류 축 알약(있는 것만, `renderer/issueStatus.ts` 같은 표의 한국어) · 버튼 `이슈로 만들기` · `이슈로 만들지 않기`.
  - **기존 이슈** (`existingIssue`가 있다): `기존 이슈 「<제목>」에 붙일까요?` · 버튼 `기존 이슈에 붙이기` · `이슈로 만들기`(새로 만든다 — 그때만 제목 입력칸이 펼쳐진다) · `이슈로 만들지 않기`.
  - `existingIssueId`가 있었는데 그 이슈가 지워졌으면(`existingIssue: null`) 새 이슈 갈래로 그린다 — payload의 제목이 그것을 위해 있다(FR-2).
- **FR-23.** 버튼:
  - `이슈로 만들기` → `proposals.accept(id, { mode: 'new', title })`. 제목이 비면 잠긴다. Enter로도 보낸다(입력칸에서).
  - `기존 이슈에 붙이기` → `accept(id, { mode: 'existing' })`.
  - `이슈로 만들지 않기` → `decline(id)`. 확인 단계가 없다 — 지우는 것이 없다.
  - 누르는 동안 세 버튼이 잠긴다(두 번 눌러 둘째가 `이미 처리된 제안입니다`로 실패하지 않게). 실패하면 배너 안에 `role="alert"` 오류를 남기고 배너는 남는다.
  - 받으면 배너가 사라지고, 뿌리의 `RUN_UPDATE`로 헤더에 이슈 링크가 서고(conversation-issue FR-21) 대화 제목이 이슈 이름이 된다(FR-22의 사다리). 다음 턴에 그 이슈가 맥락에 실린다(conversation-issue FR-9 — 실린 적 없는 할당 이슈). 이슈 패널은 `event:itemChanged`로 새 이슈를 보인다.
- **FR-24.** 기다리는 제안은 **`Dock`이 쥔다** — `useProposals(workspaceId)`(새 훅)가 `proposals.pending`을 읽고 `useItemChanged(workspaceId, 'proposal', …)`로 다시 읽는다. `ConversationPanel`은 필수 prop `proposal: IssueProposal | null`과 `onAcceptProposal`·`onDeclineProposal`을 받는다. App을 거치지 않는다 — 도크가 이미 `client.runs.assignIssue`를 직접 부르는 것과 같다(`Dock.tsx` 463). 제목 입력칸의 초안은 배너 컴포넌트의 state이고 key는 제안 id다(다른 대화로 갔다 오면 제안의 제목으로 돌아간다 — §6 우려 6).
- **FR-25.** 테스트의 가짜 클라이언트에 `proposals`가 없으면 도크를 그리는 테스트가 전부 던진다 — `events.onItemChanged`와 같다. 공통 픽스처가 없고 파일마다 가짜를 세우므로(`Dock.test`·`App.test`·`ConversationPanel.test` 등) plan이 grep으로 세어 빈 `pending`을 더한다. 기본값으로 삼키지 않는다 — `useDraftStore`가 Provider 없이 던지는 것과 같은 이유다.

## 4. 비기능 요구사항

- **NFR-1.** 경계 셋 그대로 — `core/`는 electron을, `renderer/`는 core를 모르고, IPC 핸들러는 core 호출만 한다. `window.oneDesk`는 `main.tsx` 한 곳.
- **NFR-2.** 판정은 순수 함수다 — `shouldProposeIssue`(`core/proposals/guide.ts`), 배너의 갈래(`renderer/proposal.ts`의 `bannerOf(proposal, conversation)`), payload 스키마(`core/proposals/payload.ts`). 컴포넌트는 그리기만 한다.
- **NFR-3.** **새 이름이 기존 이름과 부분 일치로 부딪히지 않는다.** 새 이름: 배너 `이 대화를 이슈로 만들까요?` · 입력칸 `제안된 이슈 제목` · 버튼 `이슈로 만들기` · `기존 이슈에 붙이기` · `이슈로 만들지 않기`. 확인한 것(2026-10-27 grep, `e2e/`·`renderer/`):
  - `이슈로 만들기`는 **인박스 실패 항목의 버튼과 이름이 같다**(`renderer/components/InboxPanel.tsx` 84). 인박스와 도크는 한 화면에 서지 않는다(도크는 인박스에서 언마운트된다) — 그래서 같은 이름을 쓴다. intent가 사용자와 정한 글자다. plan 0단계가 "인박스가 보이는 동안 도크가 없다"를 다시 본다. 부딪히면 `이 대화로 이슈 만들기`로 바꾼다.
  - `이슈로 만들기`는 `이슈로 만들지 않기`의 부분 문자열이 **아니다**(`만들기` ≠ `만들지`).
  - `기존 이슈에 붙이기`는 터미널 칸의 `선택 영역을 대화에 붙이기`와 한 화면에 선다 — 서로의 부분 문자열이 아니다.
  - issue-flow FR-10이 쓰기로 한 `그대로 두기`를 쓰지 않는다 — 두 배너가 한 도크에 함께 설 수 있다.
  - `제안된 이슈 제목`은 `{ name: '제목', exact: true }`(`e2e/panel-window.e2e.ts` 105)와 부딪히지 않는다(exact).
  - `region { name: '이슈', exact: true }`(`e2e/report.e2e.ts` 22)과 부딪히지 않는다 — 배너는 region이 아니라 status이고 이름도 다르다.
  - 기존 짧은 이름 `추가`·`실행`·`저장`·`다음`·`설정`·`이슈`를 품는 새 이름이 없다(`실행`·`저장`·`추가` 글자가 없다).
- **NFR-4.** `Run` 스프레드 함정 — 이 사이클은 run 테이블에 컬럼을 더하지 않는다. `Run`에 제안이 실리지 않는다.
- **NFR-5.** 새 prop은 필수다 — `ConversationPanel`의 `proposal`·`onAcceptProposal`·`onDeclineProposal`, `assemblePrompt`의 `proposeIssue`, `RunContext.rootRunId`. App은 새 prop을 내리지 않는다(FR-24).
- **NFR-6.** 색은 `:root` 토큰에서만, 아이콘은 `icons.tsx`에서만, 안내문은 `--text-muted`(opacity 아님). UI는 실제 앱 캡처(라이트·다크)로 확인한다.
- **NFR-7.** 받기 한 번은 트랜잭션 하나다. `pending` 목록은 `inArray` 한 번으로 기존 이슈를 붙인다(N+1 없음).

## 5. 화면

```
대화 칸 — 새 이슈 갈래
 ┌ 대화록 ────────────────────────────────────────────────────────┐
 │ … 마지막 답: "모바일 Safari에서 버튼 위에 투명 오버레이가 …"     │
 └────────────────────────────────────────────────────────────────┘
 이 대화를 이슈로 만들까요?
 [모바일에서 로그인 버튼이 눌리지 않음                         ]
 Safari에서 오버레이가 탭을 가로챈다. z-index 정리 필요.
 web · 버그 · 이번 주                 [이슈로 만들기] [이슈로 만들지 않기]
 ┌ 입력부 ────────────────────────────────────────────────────────┐
 │ 무엇을 할까요?                                                  │
 └────────────────────────────────────────────────────────────────┘

대화 칸 — 기존 이슈 갈래
 기존 이슈 「로그인 버튼 반응 없음」에 붙일까요?
                        [기존 이슈에 붙이기] [이슈로 만들기] [이슈로 만들지 않기]
```

배치(버튼 줄의 정렬·본문 줄 수)는 plan의 실제 앱 캡처로 고른다.

## 6. 우려 (Areas of concern)

1. **OpenCode가 MCP 도구를 쓸 수 있는지 확인하지 않았다.** OpenCode의 읽기 전용·편집 허용은 `"*": "deny"` 위에 알려진 키만 연다(`core/runner/permission.ts` 104~119). MCP 도구(`<서버>_<도구>`)가 `"*"`에 걸리면 OpenCode의 읽기 전용 대화는 `list_issues`조차 못 쓴다 — 이 기능이 만든 구멍은 아니지만 이 기능이 처음 정면으로 기댄다. claude는 모든 권한에서 `mcp__onedesk`를 `--allowedTools`에 얹는다(같은 파일 39~70). **plan 0단계가 진짜 opencode로 본다.** 막혀 있으면 OpenCode 권한에 MCP 서버 키를 `allow`로 더하는 것이 claude와 같은 규칙이다 — 그것은 권한 설계의 변경이라 이 spec에서 정하지 않고 사용자에게 묻는다(§8의 6). 그때까지는 OpenCode에서 안내만 붙고 배너가 서지 않을 수 있다.
2. **문턱은 문구로만 지킨다.** "애매하면 제안하지 말 것"은 모델이 따르는 지시이지 구조가 아니다. 잡담에 배너가 서면 사람은 `이슈로 만들지 않기`를 누르고, 그 대화에는 다시 서지 않는다 — 비용은 클릭 한 번이다. 반대로 일인데 안 서면 지금과 같다. plan 10단계가 진짜 claude로 일 대화·질문 대화를 몇 번씩 돌려 본다(측정, 게이트 아님).
3. **사람이 손으로 할당하면 제안은 숨기만 한다.** `⋯`의 `이슈 할당`이 제안을 `superseded`로 내리게 하면 `conversations.assignIssue`가 제안 저장소를 알아야 한다. 숨기는 쪽을 골랐다 — 할당을 다시 떼면 그 배너가 돌아오는데, 이슈 없는 대화에 "이슈로 만들까요"가 다시 서는 것은 틀린 말이 아니다.
4. **배너는 그 대화를 열어야 보인다.** 도크 목록·홈·인박스에 표시가 없다. 턴이 끝나면 보통 그 대화를 보고 있으므로 충분하다고 봤다. 놓친 제안은 그 대화를 다시 열면 선다. 써 보고 놓치는 일이 많으면 목록 줄에 점 하나를 더한다.
5. **제안 행을 지우는 규칙이 없다.** 받은 것·거절한 것·밀려난 것이 남는다. 행은 작다(본문 4,000자 상한). 거절은 남아야 하고(FR-19), 나머지는 둘째 사이클이 "무엇을 받았나"를 보일 때 재료가 될 수 있어 지우지 않았다. workspace를 지우면 cascade로 사라진다.
6. **고치던 제목은 대화를 옮기면 사라진다.** 배너의 state라 `ConversationPanel`이 다시 마운트되면 제안의 제목으로 돌아간다. 초안 스토어(`renderer/store/drafts.ts`)에 올리면 남지만 한 줄 제목에 그 무게를 둘 이유가 아직 없다.
7. **새로 만든 이슈가 다음 턴에 맥락으로 실린다.** 할당은 맥락을 겸하므로(conversation-issue FR-9) agent가 쓴 제목·본문이 다음 턴에 `<issues>`로 돌아온다. 기존 이슈에 붙인 경우에는 바라던 것이고, 새 이슈면 agent가 이미 아는 내용이 한 번 더 실린다. 규칙을 갈래로 나누지 않았다.
8. **받는 순간 이슈의 분류가 끝날 수 있다.** agent가 축 셋을 다 주면 `triagedAt`이 파생돼 훑기를 건너뛴다(`create_issue`와 같은 규칙, `tools.ts` 242). 사람이 누른 받기라 받아들였다.

## 7. 검증

- **단위**
  - `core/proposals/payload.test.ts` — 제목 줄바꿈·빈 값·201자 거부, null 채움, 모르는 키를 버린다.
  - `core/db/repositories/proposal.test.ts` — 저장이 같은 대화의 `pending`을 `superseded`로 내린다 · **부분 유니크 인덱스가 `pending` 둘을 막는다**(저장소를 거치지 않는 INSERT로) · 다른 종류는 막지 않는다 · `pending` 목록은 workspace와 상태로 거른다 · 지운 기존 이슈는 `existingIssue: null` · 깨진 payload 행은 목록에서 빠지고 `onError`.
  - `core/mcp/tools.test.ts` — **읽기 전용에도 `propose_issue`가 있다** · 읽기 전용에 쓰기 도구는 여전히 없다(기존) · 부른 뒤 이슈 수와 뿌리 할당이 그대로다 · 할당된 대화·거절한 대화는 오류이고 저장하지 않는다 · 다른 workspace의 이슈·repo는 오류 · 완료된 기존 이슈는 오류 · 토큰의 `rootRunId`에 붙는다(턴 id가 아니다).
  - `core/proposals/guide.test.ts` — `shouldProposeIssue`의 세 조건 각각.
  - `core/context/assemble.test.ts` — 참이면 안내가 `NEEDS_ANSWER_GUIDE` 뒤에 붙고(슬래시 갈래 포함), 거짓이면 글자 하나 바뀌지 않는다.
  - `core/execution.test.ts` — 이슈를 담아 시작한 첫 턴(자동 할당)·이슈에서 시작한 대화·할당된 대화의 다음 턴·거절한 대화·기다리는 제안이 있는 대화에는 안내가 없다, 이슈 없는 새 대화와 그 다음 턴에는 있다, MCP가 없으면 없다. MCP 준비에 `rootRunId`가 넘어간다.
  - `core/index.test.ts`(또는 `core/proposals/service.test.ts`) — 받기(새·기존)가 이슈·할당·상태를 한 번에 바꾸고 알림 넷을 낸다 · **할당이 실패하면 만든 이슈도 없다**(트랜잭션) · 두 번 받으면 둘째가 실패하고 이슈는 하나 · 받기 전에 사람이 할당했으면 실패 · 지운 기존 이슈면 실패 · 거절이 남고 그 뒤 도구가 거부한다.
  - `renderer/proposal.test.ts` — `bannerOf`: 할당된 대화엔 없다 · 다른 대화의 제안은 안 본다 · 기존 이슈가 지워졌으면 새 갈래.
  - `renderer/components/ConversationPanel.test.tsx`(또는 배너 컴포넌트 테스트) — 두 갈래의 버튼 · 제목을 고쳐 받으면 고친 제목이 간다 · 빈 제목이면 잠긴다 · 누르는 동안 잠긴다 · 실패하면 오류가 남는다.
  - `renderer/components/Dock.test.tsx` — 바뀜 알림 `proposal`에 다시 읽는다 · 새 대화 칸에는 배너가 없다 · 받기·거절이 그 제안 id로 간다.
- **회귀 테스트는 대상 줄을 잠시 망가뜨려 실패를 본다**(CLAUDE.md 컨벤션) — plan이 변이 표를 둔다. 특히 FR-13의 등록 자리, FR-10, FR-17의 트랜잭션, FR-15의 조건, FR-6의 `rootRunId`.
- **e2e** (`e2e/proposal.e2e.ts`, 새 파일, 가짜 CLI `fake-claude-mcp.mjs`가 `propose_issue`를 부른다): 읽기 전용으로 보낸 새 대화 → 턴이 끝나면 배너 → 제목을 고쳐 `이슈로 만들기` → 이슈 패널에 고친 제목 · 헤더에 이슈 링크 · 도크 줄 제목이 이슈 이름 → 이슈 상세의 `이 이슈의 대화 열기`가 그 대화를 연다. 둘째 대화 → `이슈로 만들지 않기` → 앱을 다시 켜도 배너가 없고 → 그 대화의 다음 턴 프롬프트(가짜 CLI 캡처)에 안내가 없다. 셋째: 기존 이슈를 고른 제안 → `기존 이슈에 붙이기` → 새 이슈가 생기지 않고 그 이슈가 할당된다. IPC 왕복(`client.proposals.accept` → preload → `ipcMain.handle` → core)을 실제로 태운다.
- **실제 CLI**(선택 실행, `ONE_DESK_REAL_CLI=1`): 진짜 claude가 읽기 전용에서 `propose_issue`를 부를 수 있다(MCP 등록·`--allowedTools`) — plan 10단계.
- 실제 앱 캡처(라이트·다크): 두 갈래 배너, 받은 뒤의 헤더.
- `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm test:e2e` 전부 통과. 기존 DB를 열어 `0012`가 한 번 돌고 기존 대화가 그대로 보인다.

## 8. 사용자가 뒤집을 수 있는 결정

spec이 정했지만 사용자의 취향이나 제품 판단에 걸린 것들이다. 하나라도 뒤집으면 해당 FR만 고친다.

1. **배너의 자리는 대화록과 입력부 사이다**(FR-21). 대안: 대화 헤더 아래, 또는 도크 맨 위(issue-flow FR-10 배너 자리).
2. **받기 전에 고치는 것은 새 이슈의 제목뿐이다**(FR-22). 대안: 본문·repo·축까지 편집 — 배너가 작은 상세가 된다.
3. **`이슈로 만들지 않기`는 영구다**(FR-19). 되돌리는 화면이 없다. 대안: 헤더 `⋯`에 `이슈로 만들자고 다시 묻기`.
4. **기다리는 제안이 있으면 다음 턴에 안내를 빼고, 새로 부르면 갈아끼운다**(FR-4·FR-15). 대안: 기다리는 동안에도 안내를 붙여 agent가 더 나은 제목으로 갈아끼우게 한다(토큰과 잦은 갈아끼움이 대가).
5. **배너는 그 대화를 열었을 때만 보인다**(§6 우려 4). 대안: 도크 목록 줄의 표시·홈 할 일의 한 줄.
6. **OpenCode가 MCP 도구에 막혀 있으면 권한 설정에 MCP 서버 키를 `allow`로 더할지**(§6 우려 1). plan 0단계가 막혀 있음을 확인하면 그때 묻는다. 묻는 동안 OpenCode에는 안내를 붙이지 않는다.
7. **완료된 이슈에는 붙이지 않는다**(FR-9). 대안: 완료된 이슈에 붙이면서 다시 연다 — 대화 쪽에서 이슈 상태를 쓰는 일이라 지금은 막았다.
8. **버튼 이름 `이슈로 만들기`를 인박스와 같게 둔다**(NFR-3). 대안: `이 대화로 이슈 만들기`.
