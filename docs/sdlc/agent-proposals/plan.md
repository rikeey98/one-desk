# Plan: 대화의 이슈화 — 첫째 사이클

- 출처: `spec.md` (승인됨 2026-10-27)
- 작성자: 권용현 (초안: Claude)
- 상태: **구현됨** (2026-10-27, `feat/agent-proposals`). 뒤집을 수 있는 결정은 spec §8이다. 0단계의 확인 둘이 spec과 다르게
  나오면 구현을 멈추고 spec을 먼저 고친다.
- 작성일: 2026-10-27

## 순서

각 단계는 테스트를 먼저 쓰고 빨간 것을 본 뒤 구현한다. 회귀 테스트는 대상 줄을 망가뜨려 빨개지는지 본다(아래 "변이"). 한 단계가 끝날 때
`pnpm typecheck`와 그 단계의 테스트 파일이 초록이다. 데이터 → core → MCP → 프롬프트 → 받기 → IPC → 화면 → e2e 순이다 — 앞 단계가 뒤 단계 없이
검증되도록.

0. **기준선과 확인 넷** — 코드를 바꾸기 전에.
   - `pnpm typecheck` · `pnpm lint` · `pnpm test` 초록, `pnpm test:e2e` 통과 수와 시간을 적는다.
   - **중첩 트랜잭션**(spec FR-17): `core/db/repositories/proposal.test.ts`보다 먼저 임시 테스트 하나 — 바깥 `db.transaction` 안에서
     `issues.create`(제 트랜잭션을 연다) 뒤 던지면 이슈가 남지 않는다. better-sqlite3의 savepoint(`lib/methods/transaction.js` 54)를 실측으로
     확인한다. 남으면 spec FR-17을 "저장소에 runner를 받는 함수를 뗀다"(`moveAssetPathPrefix`의 모양, `core/db/repositories/asset.ts` 41)로
     고친다. 확인한 테스트는 6단계의 회귀 테스트로 옮긴다.
   - **OpenCode의 MCP 권한**(spec §6 우려 1): `ONE_DESK_REAL_CLI=1`로 진짜 opencode를 읽기 전용(`opencodePermissionConfig('read_only')`)으로
     띄워 `list_repos`를 부르게 한다(`core/mcp/realCli.test.ts`의 모양, 비동기 `spawn` — `execFileSync` 함정). 결과를 이 문서에 적는다.
     막혀 있으면 사용자에게 spec §8의 6을 묻고, 답이 오기 전까지는 `shouldProposeIssue`가 OpenCode에 거짓을 돌려주게 한다(5단계의 조건 하나).
   - **이름**(spec NFR-3): `e2e/`·`renderer/`에서 `이슈로 만들기`·`붙이기`·`만들지`·`제안`·`이슈 제목`을 grep하고, 인박스가 보이는 동안 도크가
     언마운트되는지(`App.tsx`의 화면 갈래)를 읽어 확인한다.
   - 가짜 클라이언트에 `events.onItemChanged`를 세운 테스트 파일을 센다(spec FR-25 — 8단계에서 `proposals`를 더할 목록).
1. **payload와 타입** (spec FR-2·3) — `shared/models.ts`에 `ProposalStatus`·`ConversationIssuePayload`·`ProposalBase`·`IssueProposal`·
   `Proposal`, `ItemChange['kind']`에 `'proposal'`. `core/proposals/payload.ts`에 zod 스키마 `conversationIssuePayload`(MCP 입력과 DB 읽기가 같이
   쓴다)와 `parseIssuePayload(json): ConversationIssuePayload | null`. `payload.test.ts`: 줄바꿈·빈 제목·201자 제목·4,001자 본문 거부, 빠진 선택 값은
   null, 모르는 키는 버린다, 깨진 JSON은 null.
2. **테이블과 저장소** (spec FR-1·4·5) — `core/db/schema.ts`에 `proposal`(인덱스 셋, 부분 유니크는 `uniqueIndex(...).on(t.rootRunId).where(sql\`…\`)`).
   `pnpm db:generate` → `drizzle/0012_*.sql`을 **읽는다**: `CREATE TABLE`·`CREATE INDEX` 셋만 있고 `DROP`·기존 테이블 재생성이 없어야 한다.
   `core/db/repositories/proposal.ts`: `createIssueProposal({ workspaceId, rootRunId, runId, payload })`(한 트랜잭션에서 같은 대화의 `pending`
   이슈화 제안을 `superseded`로 내리고 넣는다) · `get(id)` · `pendingIn(workspaceId)`(기존 이슈를 `inArray` 한 번으로 붙인다) ·
   `stateOf(rootRunId): { pending: boolean; declined: boolean }`(안내와 도구가 본다) · `decide(id, 'accepted' | 'declined')`(`pending`이 아니면 던진다).
   `proposal.test.ts`: 갈아끼우기 · 저장소를 거치지 않은 INSERT로 `pending` 둘이 막힌다 · 다른 `kind`의 `pending` 둘은 막히지 않는다 · 지운 이슈는
   `existingIssue: null` · 다른 workspace의 이슈 id도 null · 깨진 payload 행은 빠지고 `onError`(필수 인자) · 두 번 decide는 던진다 · workspace를 지우면
   cascade. `core/db/open.test.ts`류의 마이그레이션 테스트가 있으면 `0012`가 기존 DB 위에서 도는 것을 하나 더한다. 테스트가 연 DB는 `$client.close()`
   (Windows `EBUSY`).
3. **토큰이 대화를 안다** (spec FR-6) — `RunContext.rootRunId`(필수), `core/execution.ts`의 `opts.mcp.prepare({...})`가
   `created.rootRunId ?? created.id`. `execution.test.ts`: 새 대화의 첫 턴은 자기 id, 이어 가는 턴은 뿌리 id가 `prepare`에 간다. 가짜 `RunContext`를
   만드는 테스트(`tools.test`·`host.test`)를 타입 오류를 따라 고친다.
4. **MCP `propose_issue`** (spec FR-7~13) — `McpHostDeps`에 `proposals`. `core/mcp/tools.ts`에서 읽기 도구 뒤·`read_only` 조기 반환 **앞**에 등록하고
   주석을 spec FR-13의 정의로 다시 쓴다. 검증 순서: 할당된 대화(`deps.runs.get(ctx.rootRunId).issue`) → 거절(`stateOf`) → 기존 이슈(`loadIssue`, done
   거부) → repo(`deps.repos.list(ctx.workspaceId)`) → 저장. `core/changes.ts`에 `notifyingProposals`(저장마다 `{ kind: 'proposal' }`), `core/index.ts`가
   한 번 감싸 MCP `deps`와 IPC 표면에 같이 넘긴다. `tools.test.ts`: spec §7의 일곱 항목. `core/index.test.ts`: MCP로 제안하면 바뀜 알림 `proposal`이
   나간다(감싼 저장소가 `deps`에 간다 — 맨 저장소를 넘기면 빨개진다).
5. **프롬프트 안내** (spec FR-14~16) — `core/proposals/guide.ts`의 `PROPOSE_ISSUE_GUIDE`와 `shouldProposeIssue({ mcp, agentKind, assignedIssueId, state })`
   (`agentKind`는 0단계의 OpenCode 결과가 "막힘"일 때만 쓰는 칸 — "열림"이면 넣지 않는다). `assemblePrompt`의 필수 `proposeIssue`. `execution.ts`의
   `LaunchSpec`에 `proposeIssue: boolean`을 더하고 `start`(571의 `issueId`)·`resume`(619의 `assigned`와 `stateOf(rootId)`)이 채운다 — 판정은 `launch`
   밖 두 자리가 아니라 함수 하나를 부른다. `guide.test.ts`(조건 각각), `assemble.test.ts`(두 갈래에 붙는다 · 거짓이면 기존 스냅샷과 글자 하나 다르지
   않다), `execution.test.ts`(spec §7의 여섯 경우, 조립된 프롬프트를 `runs.get(id).assembledPrompt`로 본다).
6. **받기·거절** (spec FR-17~20) — `core/proposals/service.ts`의 `createProposalService({ db, runs, issues, proposals })`(전부 **감싸지 않은** 저장소)가
   `accept(id, choice)`·`decline(id)`·`pending(workspaceId)`. `core/index.ts`의 `proposals` 표면이 그것을 부르고 트랜잭션이 끝난 뒤 알린다(`issue`·
   `proposal` 바뀜, 뿌리 `RUN_UPDATE`, `emitInbox`). `shared/models.ts`에 `AcceptIssueProposal = { mode: 'new'; title: string } | { mode: 'existing' }`.
   `service.test.ts`: 새·기존 받기 · **할당이 던지면 이슈도 없다**(0단계의 확인을 옮긴 것 — `runs.assignIssue`를 던지게 바꾼 가짜로) · 두 번 받기 ·
   먼저 할당된 대화 · 지운 기존 이슈 · `new` 제목의 빈 값·줄바꿈 · 거절 뒤 `stateOf`가 declined. `core/index.test.ts`: 받으면 네 알림이 나가고 되돌린
   받기는 아무것도 알리지 않는다.
7. **IPC** (spec FR-20) — `shared/channels.ts`에 셋, `shared/client.ts`에 `proposals: { pending, accept, decline }`, `electron/preload.ts`,
   `electron/ipc/proposals.ts`(핸들러는 core 호출 한 줄)와 `electron/ipc/index.ts` 등록. 경계 grep 둘(CLAUDE.md "절대 지켜야 할 경계").
   electron IPC에는 단위 테스트가 없으므로 9단계 e2e가 왕복을 맡는다.
8. **화면** (spec FR-21~25) — `renderer/proposal.ts`의 `bannerOf(proposals, conversation)`(새·기존 갈래, 할당되면 null, 지운 기존 이슈는 새 갈래).
   `renderer/hooks/useProposals.ts`(`pending` + `useItemChanged(workspaceId, 'proposal', …)`). `renderer/components/IssueProposalBanner.tsx`(제목 칸의
   state, key = 제안 id, 누르는 동안 잠금, 실패 오류). `ConversationPanel`의 필수 prop 셋과 대화록·입력부 사이 자리, `Dock`이 훅을 쥐고 넘긴다.
   `renderer/index.css`(토큰만). 가짜 클라이언트에 `proposals` 더하기(0단계의 목록). 테스트: `proposal.test.ts`, `IssueProposalBanner.test.tsx`(spec §7),
   `ConversationPanel.test`(배너 자리 · 새 대화 칸엔 없다), `Dock.test`(바뀜 알림에 다시 읽는다 · id가 그대로 간다).
9. **e2e** — `core/runner/fixtures/fake-claude-mcp.mjs`가 부를 도구를 `ONE_DESK_FAKE_MCP_CALL`(JSON `{ name, arguments }`)로 받게 한다. **기본값은
   지금의 `create_issue` 호출 그대로** — `mcp.e2e`가 기대는 시나리오다. `{{ISSUE_ID}}` 같은 자리표시자는 두지 않는다 — 기존 이슈 갈래는 e2e가 이슈를
   먼저 만들고 그 id를 main의 evaluate로 읽어(`e2e/home.e2e.ts`의 `runSql` 모양) 환경변수에 넣을 수 없으므로, 그 경우는 픽스처가 `list_issues`를 먼저
   불러 첫 이슈 id를 쓰는 모드(`ONE_DESK_FAKE_MCP_CALL={"name":"propose_issue","existing":"first"}`)로 한다. 프롬프트 캡처(`ONE_DESK_PROMPT_CAPTURE`)를
   이 픽스처에도 더한다. 새 `e2e/proposal.e2e.ts`: spec §7의 세 시나리오. 권한 알약으로 `읽기 전용`을 고르고 보낸다. "앱을 다시 켜도 배너가 없다"는 드라이버의
   `relaunch()`다(같은 데이터 폴더). 셀렉터는 `{ name: '이슈로 만들기', exact: true }`.
10. **진짜 CLI와 실제 앱** — `ONE_DESK_REAL_CLI=1`로 진짜 claude가 읽기 전용에서 `propose_issue`를 부르는지 하나(MCP 등록과 `--allowedTools`의
    `mcp__onedesk`). 그다음 측정(게이트 아님): 이슈 없는 대화로 일 지시 셋(`로그인 버튼이 모바일에서 안 눌려, 고쳐줘` 등)·질문 셋(`이 함수 뭐 하는
    거야?` 등)을 각각 두 번 돌려 제안한 횟수를 적는다. 질문에 제안이 하나라도 나오면 안내 문구를 다듬어 다시 잰다(spec §6 우려 2). 실제 데이터의
    복사본으로 `pnpm dev`를 띄워 두 갈래 배너와 받은 뒤의 헤더를 라이트·다크로 캡처한다(`page.emulateMedia` — nativeTheme은 Playwright에서 듣지 않는다).
11. **마무리** — 전체 검증, `CLAUDE.md` 갱신(제안 저장소와 `propose_issue`, 읽기 전용의 새 정의, 마이그레이션 `0012`, 배너의 이름, 가짜 MCP CLI의 새
    환경변수), `docs/sdlc/issue-flow/intent.md`의 (3)과 "진행 방식"의 둘째 사이클이 이 intent를 가리키게 고친다(intent "뒤집는 결정"), intent의 미해결
    질문 체크, 이 plan의 완료 증명.

## 바뀌는 파일

| 파일 | 단계 | 무엇 |
|---|---|---|
| `shared/models.ts` | 1·6 | 제안 타입, `ItemChange` 종류, `AcceptIssueProposal` |
| `core/proposals/payload.ts` · `.test.ts` (새) | 1 | zod 스키마 |
| `core/db/schema.ts` · `drizzle/0012_*.sql` · `drizzle/meta/*` | 2 | `proposal` 테이블 |
| `core/db/repositories/proposal.ts` · `.test.ts` (새) | 2 | 저장소 |
| `core/mcp/host.ts` · `core/execution.ts` · `.test.ts` | 3·5 | `rootRunId`, `proposeIssue` |
| `core/mcp/tools.ts` · `.test.ts` | 4 | `propose_issue`, 읽기 전용 주석 |
| `core/changes.ts` · `core/index.ts` · `core/index.test.ts` | 4·6 | 감싼 저장소, `proposals` 표면 |
| `core/proposals/guide.ts` · `.test.ts` (새) | 5 | 안내 문구와 조건 |
| `core/context/assemble.ts` · `.test.ts` | 5 | 필수 `proposeIssue` |
| `core/proposals/service.ts` · `.test.ts` (새) | 6 | 받기·거절 |
| `shared/channels.ts` · `shared/client.ts` · `electron/preload.ts` · `electron/ipc/proposals.ts` (새) · `electron/ipc/index.ts` | 7 | IPC 셋 |
| `renderer/proposal.ts` · `.test.ts` (새) · `renderer/hooks/useProposals.ts` (새) | 8 | 갈래, 훅 |
| `renderer/components/IssueProposalBanner.tsx` · `.test.tsx` (새) | 8 | 배너 |
| `renderer/components/ConversationPanel.tsx` · `Dock.tsx` · `.test` | 8 | 자리와 배선 |
| 가짜 클라이언트를 세우는 테스트 여럿 | 8 | `proposals` |
| `renderer/index.css` | 8 | 배너 (토큰만) |
| `core/runner/fixtures/fake-claude-mcp.mjs` · `e2e/proposal.e2e.ts` (새) | 9 | |
| `CLAUDE.md` · `docs/sdlc/issue-flow/intent.md` · `docs/sdlc/agent-proposals/*` | 11 | |

## 변이 (되돌려 빨개지는지 볼 것)

| 망가뜨릴 줄 | 빨개져야 할 테스트 |
|---|---|
| tools.ts: `propose_issue` 등록을 `read_only` 조기 반환 뒤로 옮기기 | `tools.test` "읽기 전용에도 propose_issue가 있다" |
| tools.ts: `create_issue`를 조기 반환 앞으로 옮기기 | `tools.test` "읽기 전용에는 쓰기 도구가 없다"(기존) |
| tools.ts: 할당된 대화 검사 지움 | "이슈가 할당된 대화의 제안은 저장하지 않는다" |
| tools.ts: 거절 검사 지움 | "거절한 대화의 제안은 저장하지 않는다" |
| tools.ts: `ctx.rootRunId` 대신 `ctx.runId` | "제안은 턴이 아니라 대화에 붙는다" |
| tools.ts: `loadIssue` 대신 `deps.issues.get` | "다른 workspace의 기존 이슈는 없는 id와 같은 오류다" |
| execution.ts: `prepare`에 `rootRunId: created.id` | `execution.test` "이어 가는 턴의 토큰은 뿌리를 안다" |
| proposal.ts: 저장 전 `superseded` 내리기 지움 | `proposal.test` "새 제안이 앞의 것을 갈아끼운다"(부분 유니크가 던진다) |
| schema: 부분 유니크 인덱스 지움 | "저장소를 거치지 않은 pending 둘이 막힌다" |
| guide.ts: 거절 조건 지움 | `guide.test` · `execution.test` "거절한 대화에는 안내가 없다" |
| guide.ts: 할당 조건 지움 | `execution.test` "이슈를 하나만 담아 시작한 대화에는 안내가 없다"(자동 할당 뒤의 `issueId`를 봐야 한다) |
| assemble.ts: 슬래시 갈래에 안내를 안 붙임 | `assemble.test` "슬래시 지시에도 안내가 붙는다" |
| service.ts: 바깥 `db.transaction` 지움 | `service.test` "할당이 실패하면 만든 이슈도 없다" |
| service.ts: `pending` 검사 지움 | "두 번 받으면 이슈는 하나다" |
| index.ts: MCP `deps`에 감싸지 않은 제안 저장소 | `index.test` "MCP로 제안하면 바뀜 알림이 나간다" |
| index.ts: 받기 뒤 `RUN_UPDATE` 지움 | `index.test` "받으면 그 대화의 뿌리를 다시 알린다" |
| proposal.ts(renderer): 할당된 대화도 배너 | `proposal.test` "할당된 대화에는 배너가 없다" |
| 배너: 받기에 고친 제목 대신 payload 제목 | `IssueProposalBanner.test` "고친 제목으로 만든다" |
| 배너: 누르는 동안 잠금 지움 | "누르는 동안 세 버튼이 잠긴다" |
| Dock: `useItemChanged`의 `'proposal'` 구독 지움 | `Dock.test` "제안 바뀜에 다시 읽는다" |

## 위험

1. **OpenCode는 0단계에서 막힐 수 있다** (spec §6 우려 1). 그 경우 이 사이클은 claude에서만 끝나고 OpenCode는 사용자의 답을 기다린다 — 권한 설계를
   조용히 바꾸지 않는다.
2. **부분 유니크 인덱스는 drizzle-kit이 SQL로 옮긴 모양을 봐야 한다.** `WHERE` 절이 빠진 채 나오면 `root_run_id` 하나에 행이 하나뿐이 되어,
   `superseded` 행 하나가 같은 대화의 다음 제안을 막는다. 2단계가 SQL을 읽고 "갈아끼운 뒤에도 같은 대화에 또 제안할 수 있다"를 테스트한다.
3. **안내는 매 턴 프롬프트를 늘린다**(약 400자). 이슈가 할당되거나 제안이 기다리거나 거절되면 빠지므로 대화당 몇 턴뿐이다.
4. **가짜 MCP CLI의 기본 동작을 바꾸지 않는다.** `mcp.e2e`가 `create_issue` 기본값에 기댄다 — 환경변수가 없을 때 바이트 단위로 같은 호출이어야 한다.
5. **e2e에서 앱을 다시 켜는 시나리오는 드라이버의 `relaunch()`를 쓴다**(`e2e/driver.ts` — 같은 데이터 폴더로 다시 띄운다). 새 드라이버 옵션은 없다.

## 0단계 결과 (2026-10-27)

- **기준선**: `pnpm typecheck`·`pnpm lint` 초록, `pnpm test` — `Test Files 180 passed | 2 skipped (182)`, `Tests 3114 passed | 49 skipped (3163)`.
- **중첩 트랜잭션** — 확인됨. 바깥 `db.transaction` 안에서 `issues.create`(제 `db.transaction`) 뒤 던지면 이슈가 남지 않는다(better-sqlite3가
  안쪽을 savepoint로 바꾼다). 임시 테스트는 지우고 6단계 `service.test`의 "할당이 실패하면 만든 이슈도 없다"로 옮겼다. spec FR-17 그대로.
- **OpenCode의 MCP 권한** — **막혀 있다.** `core/mcp/realOpencode.test.ts`(선택 실행, 새 파일)로 opencode 1.18.30 · `opencode/big-pickle`을 띄워
  `list_repos`를 부르게 했다. `full`은 `one-desk_list_repos`를 불러 통과, `read_only` 세 번·`edit` 한 번은 도구를 호출하지 못했다("MCP 도구에 접근할
  수 없습니다"). `"*": "deny"`가 MCP 도구를 모델에게서 지운다 — 이 기능 이전부터 OpenCode의 읽기 전용·편집 허용 대화는 `list_issues`조차 못
  쓴다는 뜻이다. spec §8의 6은 **사용자에게 묻는다**(이 구현은 권한 설정을 바꾸지 않았다). 그동안 `shouldProposeIssue`는 OpenCode의
  `full`이 아닌 run에 거짓이다 — plan의 "OpenCode에 거짓"을 `full`만 열어 둔 것은 그 권한에서는 도구가 실제로 부를 수 있기 때문이다(실측).
- **이름** — `이슈로 만들기`는 인박스 실패 항목 버튼(`InboxPanel.tsx` 84)뿐이고, 도크는 `view === 'workspace'`에서만 그려져(`App.tsx` 607~647)
  인박스와 한 화면에 서지 않는다. `붙이기`는 터미널의 `선택 영역을 대화에 붙이기`뿐, `만들지`·`제안`·`이슈 제목`은 테스트 제목·placeholder
  (`이슈 제목으로 찾기`)뿐이다. 부딪힘 없음.
- **가짜 클라이언트** — `events.onItemChanged`를 세운 테스트는 열 파일이고, 도크를 그리는 것은 `App.test`·`Dock.test`(`Dock.test`는 지금
  `onItemChanged`가 없다 — 도크가 처음 듣는다).

## 구현하며 달라진 것

1. **OpenCode는 전체 허용에서만 안내를 붙인다** — plan은 "OpenCode에 거짓"이었다. 0단계 실측에서 `full`은 MCP 도구를 부르므로
   (`one-desk_list_repos`), 막힌 두 권한만 거짓이다(`shouldProposeIssue`의 `agentKind`·`permission`). spec §8의 6은 사용자에게 묻는다.
2. **분류 축 enum을 `core/issueAxes.ts`로 옮겼다** — `tools.ts`에만 있던 것을 payload 스키마가 같이 쓰려고. 동작은 같다.
3. **`ConversationPanel`의 `proposal` prop 타입은 `IssueProposal`이 아니라 `IssueBanner`다**(`renderer/proposal.ts` — `{ mode, proposal,
   existing? }`). 갈래를 도크가 `bannerOf`로 한 번 정해 내리려고. 필수인 것은 그대로다.
4. **받기는 제안 뒤에 지워진 repo를 걸러 이슈를 만든다**(서비스가 맨 repo 저장소를 받는다) — 거르지 않으면 이슈 만들기의 소속 검증에
   걸려 받기가 통째로 실패한다. spec이 말하지 않은 경우다.
5. **서비스의 `pending` 검사를 지웠다** — `decide`가 트랜잭션 안에서 같은 검사를 하고, 둘째 받기는 거기서 던져 만든 이슈를 되돌린다.
   대신 둘째 받기는 할당 검사가 먼저 걸려 `이 대화에는 이미 이슈가 할당돼 있습니다`로 실패하는 일이 많다(어느 쪽이든 이슈는 하나다).
6. **원본을 가리키는 `start(parentRunId)`도 그 대화의 뿌리로 판정한다** — spec FR-15는 start·resume 둘만 말했지만 `start`는
   `parentRunId`를 받으면 같은 대화의 턴을 만든다. 렌더러는 그 길을 쓰지 않는다.
7. **실제 앱 캡처는 `pnpm dev`가 아니라 `e2e/proposal.e2e.ts` 안에서 찍었다**(`e2e/artifacts/proposal-{new,existing,accepted}-{light,dark}.png`) —
   실제 데이터를 복사하지 않아도 두 갈래와 받은 뒤가 모두 선다. 다크는 `emulateMedia` 뒤 버튼 transition을 기다린다.
8. **`docs/sdlc/issue-flow/intent.md`는 고치지 않았다** — 그 파일은 `main` 체크아웃에 커밋되지 않은 채 있고 이 브랜치에는 없다. 병합 뒤
   그쪽에서 (3)과 "진행 방식"의 둘째 사이클이 이 intent를 가리키게 고쳐야 한다.
9. **제안 뒤에 완료된 기존 이슈는 지워진 것과 같다**(리뷰 L-2, spec §8의 7) — 도구는 제안할 때만 `done`을 막아, 그 뒤 완료된 이슈가
   `기존 이슈에 붙이기`로 붙었다. 배너(`bannerOf`)는 새 이슈 갈래로 떨어지고, 받기는 `완료된 이슈에는 붙일 수 없습니다 — 새 이슈로 받으세요`로
   막는다(쓰는 자리의 방어). 읽기 모델(`existingIssue`)은 그대로 상태를 싣는다 — 판정은 그것을 쓰는 두 자리다. 각 줄을 되돌리면
   proposal.test·service.test의 "완료됐으면" 둘이 빨개진다.
10. **기다리는 제안이 있으면 새 제안을 거부한다 — 첫 제안 유지**(리뷰 L-1, 2026-10-27 사용자 결정, spec FR-4·§8의 4) — 갈아끼우기는
    앞 턴 뒤에 예약된 턴(안내를 받은 채 조립된다)이 사람이 고치던 배너를 바꿨다. 저장소가 트랜잭션 안에서 기다리는 행을 보고 던지고
    `propose_issue`는 그 이유를 도구 오류로 돌려준다. 쓰는 곳이 없어진 `superseded` 상태는 타입·스키마 타입에서 뺐다(text 열이라
    마이그레이션은 없다). 10단계 측정의 "두 번 부른 둘"은 이제 둘째가 도구 오류다. 던지는 줄을 지우면 proposal.test·tools.test의
    "기다리는 제안이 있으면" 둘이 빨개진다(부분 유니크가 다른 문구로 던진다).
11. **OpenCode의 읽기 전용·편집 허용에 one-desk MCP 도구를 연다**(2026-10-27 사용자 결정 "one-desk MCP만 허용", spec §8의 6) —
    달라진 것 1의 "OpenCode는 전체 허용에서만 안내"를 지웠다. `opencodePermissionConfig`가 `${MCP_SERVER_NAME}_*`를 `allow`로 더하고
    `shouldProposeIssue`는 agent·권한을 받지 않는다(유일한 독자였던 두 필드를 뺐다). 키 모양은 진짜 1.18.30으로 정했다 —
    `ONE_DESK_REAL_CLI=1 ONE_DESK_REAL_OPENCODE_MODEL=opencode/big-pickle pnpm test realOpencode`가 read_only·edit 모두 2/2(`one-desk_list_repos`를
    부르고, `hostname`을 시켜도 bash가 끝까지 돌지 않는다). 키를 지우면 read_only의 첫 테스트가 실패하고(모델이 `grep`으로 돌아간다), bash를
    열면 둘째가 실패한다(둘 다 실측). 둘째의 지시는 셸 없이는 알 수 없는 것이어야 한다 — 처음의 `echo one-desk-probe`는 bash를 열어도 모델이
    도구 없이 답해 아무것도 못 봤다. 단위로는 permission.test의 "one-desk MCP 도구는 연다"·"여는 MCP 키는 one-desk 서버 것뿐이다"와
    execution.test의 "OpenCode %s에도 붙는다"가 지킨다.

## 완료 증명

- `pnpm typecheck`·`pnpm lint` 초록. `pnpm test` — `Test Files 186 passed | 4 skipped (190)`, `Tests 3195 passed | 51 skipped (3246)`
  (기준선 180/3114에서 새 파일 여섯과 새 테스트 81).
- `pnpm test:e2e` — `Test Files 32 passed | 3 skipped (35)`, `Tests 66 passed | 4 skipped (70)`, 4분 5초(기준선 31/63, 3분 49초).
  `e2e/proposal.e2e.ts` 셋(제목을 고쳐 받기 · 거절 뒤 다시 켜도 남고 다음 턴에 안내가 없다 · 기존 이슈에 붙이기)이 첫 실행에 통과.
- 경계 grep 둘 — 출력 없음.
- `drizzle/0012_overjoyed_nitro.sql` — `CREATE TABLE proposal`·`CREATE INDEX` 둘·`CREATE UNIQUE INDEX … WHERE status = 'pending' AND
  kind = 'conversation-issue'`뿐. `open.test`의 "0012는 기존 run과 맥락 기록을 건드리지 않고…"가 0011까지의 DB 위에서 본다.

### 변이

| 단계 | 망가뜨린 줄 | 빨개진 테스트 |
|---|---|---|
| 2 | proposal.ts: superseded 내리기 지움 | "새 제안이 … 갈아끼운다"(UNIQUE로 던진다) |
| 2 | 0012: 부분 유니크 → 보통 인덱스 | "저장소를 거치지 않은 pending 둘이 막힌다" |
| 2 | 0012: `WHERE` 지움 | "갈아끼운다"(셋째 제안) · "다른 종류의 pending 둘" |
| 3 | execution.ts: `rootRunId: created.id` | "이어 가는 턴의 토큰은 뿌리를 안다" |
| 4 | tools.ts: `propose_issue`를 조기 반환 뒤로 | "읽기 전용에도 propose_issue가 있다" 외 8 |
| 4 | tools.ts: 읽기 전용에 `create_issue` | "읽기 전용 토큰에는 쓰기 도구가 없다"(기존) |
| 4 | tools.ts: 할당 검사 지움 | "이슈가 할당된 대화의 제안은 저장하지 않는다" |
| 4 | tools.ts: 거절 검사 지움 | "거절한 대화의 제안은 저장하지 않는다" |
| 4 | tools.ts: `ctx.runId`에 붙임 | "제안은 턴이 아니라 대화에 붙는다" · "거절한 대화…" |
| 4 | tools.ts: `loadIssue` 대신 `deps.issues.get` | "다른 workspace의 기존 이슈는 없는 id와 같은 오류다" |
| 4 | index.ts: MCP deps에 맨 제안 저장소 | index.test "MCP로 제안하면 바뀜 알림 proposal이 나간다" |
| 5 | guide.ts: 거절 조건 지움 | guide.test · execution.test "거절한 대화에는 안내가 없다" |
| 5 | guide.ts: 할당 조건 지움 | execution.test 셋(자동 할당 · 이슈에서 시작 · 할당된 대화의 다음 턴) |
| 5 | execution.ts: 자동 할당 전의 `input.issueId`로 판정 | "이슈를 하나만 담아 시작한 대화에는 붙지 않는다" |
| 5 | assemble.ts: 슬래시 갈래에 안내 없음 | "슬래시 지시에도 안내가 붙는다" |
| 6 | service.ts: 바깥 `db.transaction` 지움 | "할당이 실패하면 만든 이슈도 없다" |
| 6 | service.ts: `pending` 검사 지움 | **초록** — `decide`가 같은 검사를 한다(달라진 것 5). `decide`의 검사를 지우면 "두 번 받으면 … 이슈는 하나다"·"두 번 거절은 던진다" |
| 6 | index.ts: 받기 뒤 `RUN_UPDATE` 지움 | index.test "받으면 … 뿌리·배지를 알린다" |
| 6 | index.ts: 받기에 감싼 이슈 저장소 | 같은 테스트(알림이 하나 더 나간다) |
| 8 | renderer/proposal.ts: 할당된 대화도 배너 | "할당된 대화에는 배너가 없다" |
| 8 | 배너: payload 제목으로 받기 | "고친 제목으로 만든다" · "Enter로도 만든다" |
| 8 | 배너: 누르는 동안 잠금 지움 | "누르는 동안 세 버튼이 잠긴다" |
| 8 | useProposals: `proposal` 구독 지움 | Dock.test "제안 바뀜에 다시 읽는다" |
| 8 | Dock: `proposal={null}` | Dock.test 셋 |

### 10단계 측정 (2026-10-27, claude 2.1.311, 기본 모델, 읽기 전용, 이슈 없는 새 대화의 첫 턴)

`ONE_DESK_REAL_CLI=1 pnpm test core/proposals/realCli`. 읽기 전용 init의 도구에 `mcp__one-desk__propose_issue`가 있고 `create_issue`는 없다.

| 지시 | 1회 | 2회 |
|---|---|---|
| 로그인 버튼이 모바일에서 안 눌려, 고쳐줘 | 제안 | 제안 |
| 설정 화면에 다크 모드 토글을 추가해줘 | 제안 | 제안 |
| README의 설치 절차가 낡았어, 최신으로 고쳐줘 | 안 함 | 안 함 |
| 이 함수 뭐 하는 거야? … | 안 함 | 안 함 |
| TypeScript에서 interface와 type의 차이가 뭐야? | 안 함 | 안 함 |
| 안녕, 오늘 기분 어때? | 안 함 | 안 함 |

- **일 지시 4/6, 질문 지시 0/6.** 질문 여섯은 MCP 도구를 하나도 부르지 않았다. 제안한 넷은 전부 `list_issues`를 먼저 불렀다(안내대로).
- README 둘은 `list_issues`까지 보고 `[NEEDS_ANSWER]`로 "지금 쓰는 도구가 무엇인가"를 되물었다 — 사람의 답을 기다리는 턴이라 제안하지
  않은 것으로 읽힌다(문턱 "애매하면 제안하지 말 것"에 맞는다).
- 넷 중 둘은 `propose_issue`를 **두 번** 불렀다(한 번은 `list_repos`로 repo id를 얻은 뒤 다시) — 안내의 "한 번"을 어겼지만 FR-4가 앞의 것을
  `superseded`로 갈아끼워 배너는 하나다.
- **첫 측정은 빈 작업 디렉토리에서 일 지시도 0/6이었다** — 고칠 코드를 못 찾아 전부 `[NEEDS_ANSWER]`로 끝났다. 위 표는 작은 repo
  (`src/login.html`·`src/Settings.tsx`·`README.md`)를 둔 뒤의 숫자다. 질문에 제안이 나오지 않았으므로 안내 문구는 다듬지 않았다.
