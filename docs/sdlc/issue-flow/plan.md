# Plan: 이슈 한 바퀴의 이음매 — 첫째 사이클

- 출처: `spec.md` (승인됨 2026-10-22)
- 작성자: 권용현 (초안: Claude)
- 상태: **초안 — 승인 대기**. §0의 개정 넷은 승인되면 spec에 반영한다.
- 작성일: 2026-10-22

## 0. 코드를 읽고 spec에서 고쳐야 하는 것 (승인 필요)

spec을 쓸 때 가정한 자리 넷이 코드와 다르다. 설계 결정을 코드에서 조용히 바꾸지 않기 위해(CLAUDE.md) 먼저 적는다.

1. **FR-21 "저장이 대기 중이면 버튼이 잠긴다" → "누르면 먼저 흘려보내고, 실패하면 새로고침하지 않는다".**
   대기 판정(`useDebouncedSave`의 `busy`, `pendingSaves`)은 ref라 값이 바뀌어도 화면을 다시 그리지 않는다
   (`renderer/hooks/useDebouncedSave.ts` 33·51). 잠긴 모양을 보이려면 그 훅에 state를 더해야 하고, 그러면 한 글자마다 상세가 다시 그려진다.
   대신 버튼은 늘 눌리고, 누르면 그 상세의 두 저장(제목·본문)을 `flush()`로 끝까지 흘려보낸 뒤 새로고침한다. `flush()`가 `false`면(실패·충돌)
   새로고침하지 않는다 — 충돌이면 충돌 배너가 이미 서 있다. 고치던 글을 잃지 않는다는 약속은 같고, 더 단순하다.
2. **FR-21 "상세를 제자리에서 다시 세운다" → "상세를 다시 마운트한다".**
   `IssueDetail`은 제목·본문·상태·축·repo를 전부 마운트할 때 prop에서 복사한 state로 쥔다(`IssueDetail.tsx` 80·92). 제자리에서 다시 세우려면
   그 여섯을 effect로 하나하나 덮어야 하고, 하나를 빠뜨리면 그 칸만 낡는다. 대신 패널이 목록을 다시 읽은 뒤 상세의 `key`에 새로고침 번호를 더해
   (`${open.id}:${n}`) 다시 마운트한다 — 마운트가 이미 "지금 prop에서 시작한다"를 정확히 한다. 대가: **읽기/편집 보기 전환이 처음 상태로 돌아간다**
   (본문이 있으면 읽기). spec의 "보기 전환은 그대로다"를 뺀다. 펼침(패널 확장)은 App이 쥐므로 그대로다.
3. **FR-20 `Run.issue`의 타입이 지금 `AssignedIssue`다** (`shared/models.ts` 426). spec은 "둘은 다른 타입으로 둔다"고 했는데 지금 같은 타입이다.
   새 타입 `RunIssue = AssignedIssue & { status: IssueStatus }`를 두고 `Run.issue: RunIssue | null`로 바꾼다. `AssignedIssue`에 `repoIds`가 필수로 들어가므로
   (FR-3) `RunIssue`도 태그를 갖는다. 대가: `issue: { id, title }`로 run을 만드는 **테스트 픽스처가 전부 타입 오류**가 된다 — 2단계가 한꺼번에 고친다.
4. **FR-3 "`ContextChip`에 `repoIds`를 필수로" → 이슈 칩에만 필수.**
   칩을 만드는 자리는 다섯이다(`IssuePanel`·`MemoPanel`·`AssetPanel`·`RepoStrip`·App의 리포트 메모 칩). 모든 종류에 `repoIds: []`를 강제하면
   뜻 없는 네 줄이 생긴다. `ContextChip`을 `{ type: 'issue'; id; label; repoIds: string[] } | { type: Exclude<ContextItemType, 'issue'>; id; label }`로
   가른다 — 이슈 칩을 만드는 자리만 태그를 빠뜨리면 컴파일이 깨진다(필수 인자 원칙은 그대로다). `chipKey`는 `{ type, id }`만 보므로 그대로다.

## 순서

각 단계는 테스트를 먼저 쓰고 빨간 것을 본 뒤 구현한다. 회귀 테스트는 대상 줄을 망가뜨려 빨개지는지 본다(아래 "변이").

0. **기준선과 이름 확인** — `pnpm typecheck` · `pnpm lint` · `pnpm test` 초록, `pnpm test:e2e` 통과 수와 시간을 적는다. 그리고 NFR-3의 새 이름을
   e2e 전체에서 grep한다: `완료`를 부분 일치로 잡는 셀렉터(`{ name: '완료' }`·`getByText('완료')`), `다시`·`시작`·`새로고침`·`바뀜`·`그만두기`·`이슈 열기`.
   부딪히는 것이 있으면 이름을 바꾸고 spec에 적는다.
1. **MCP `update_issue`** (FR-16~19) — `core/mcp/tools.ts`에 `title: z.string().trim().min(1).regex(/^[^\n]+$/)`·`repoIds: z.array(z.string())`, 설명 문구.
   `core/mcp/tools.test.ts`: 제목 바꾸기 · repoIds 통째로(빈 배열 포함) · 빈 제목 거부 · 줄바꿈 제목 거부 · 다른 workspace repo 거부 · 읽기 전용에는
   `update_issue`가 없다(기존) · 제목을 바꾸면 할당된 대화의 뿌리가 다시 알려진다(`core/index.test`의 FR-26 테스트를 MCP 경로로 하나 더). 가장 독립적이라 먼저다.
2. **`Run.issue` 넓히기** (FR-20, §0-3) — `shared/models.ts`에 `RunIssue`, `AssignedIssue.repoIds`. `core/db/repositories/run.ts`의 `hydrate`가 제목과 함께
   상태를 읽고(`livingNames`와 별도의 `inArray` 한 번 — 이름만 주는 함수를 넓히지 않는다), 태그를 `issue_repo`에서 같은 id 집합으로 한 번 읽는다.
   `run.test.ts`: 상태·태그가 실린다 · 지워진 이슈 null · 태그를 바꾸면 다음 읽기에 따라간다 · `issueId`가 `Run`에 새지 않는다(기존). 그리고 테스트 픽스처의
   `issue: { id, title }`를 전부 고친다(`makeRun`·`ConversationHeader.test` 등 — grep으로 센다).
3. **작업 디렉토리 규칙** (FR-1·FR-4) — `renderer/cwdRule.ts`: `pickCwd(input)`·`cwdMismatch(input)`와 "기준 이슈"를 고르는 내부 함수 하나. 입력은
   `{ repos, draftCwd, pickedCwd, assignedIssue, chips, selectedPath, current, avoid }`(`avoid` = FR-6의 원래 repo). 결과는 `{ cwd, missing }`.
   `cwdRule.test.ts`: 일곱 칸 각각 "앞 칸이 이긴다" · 태그가 둘 이상/이 workspace 밖이면 건너뛴다 · 이슈 칩이 둘이면 건너뛴다 · 할당 예정이 있으면 칩을 안 본다 ·
   `avoid`인 결과를 건너뛴다 · 어긋남의 후보 · 태그가 없으면 어긋남 없음. 순수 함수만 — 아직 아무도 부르지 않는다.
4. **칩과 할당 예정의 태그** (FR-3, §0-4) — `renderer/context.ts`의 `ContextChip` 갈래, `IssuePanel`의 담기 토글이 `repoIds: i.repoIds`, App의
   `issueConversations.start`가 `repoIds: issue.repoIds`. Dock의 `draftIssue`·ConversationPanel의 `pendingIssue`·RunPanel의 `carriedIssue`는 타입만 따라간다.
   `IssuePanel.test`·`App.test`가 넘어온 태그를 본다.
5. **RunPanel이 규칙을 쓴다** (FR-1·2·4) — cwd effect의 몸통을 `pickCwd` 호출로 바꾸고, `pickedCwd` state(알약 `onChange`에서만 찍는다 · 전송 성공 ·
   `draftKey` 변경 · 할당 예정 id 변경에 지운다), 어긋남 안내(`.composer-repo-mismatch`, 후보마다 `<repo>에서 시작`). RunPanel은 `chips`를 이미 받는다.
   `appliedSelection` ref는 없어진다(사이드바는 이제 5번 칸이다). `RunPanel.test`: 이슈에서 시작하면 사이드바와 달라도 이슈 repo · 사이드바를 바꿔도 이슈 repo가
   남는다 · 알약으로 고르면 이긴다 · 보내면 잊는다 · 이슈가 없으면 예전처럼 사이드바를 따른다(기존 테스트 그대로) · "다시 실행"의 경로가 이긴다(기존) · 안내의 버튼이
   알약 값을 바꾼다. 기존 cwd 테스트가 전부 초록인 것이 이 단계의 큰 조건이다.
6. **다른 repo에서 다시 시작** (FR-6~8) — `ConversationHeader`에 menuitem과 어긋남 안내(필수 prop `onRestartElsewhere`, `repoCount`), `Dock`이 그것을 App으로
   올린다(필수 prop `onRestartElsewhere`). App의 `restartElsewhere(conv)`: `setDraftPrompt(root.userPrompt)`·칩을 뿌리의 맥락(`file` 제외)으로 · `setDraftIssue`(할당
   이슈) · `setDraftCwd(null)` · `setReplacing({ id, cwd: root.cwd, title })` · 새 대화 칸 열기. 조건(agent·모델·effort·권한)은 RunPanel이 받을 길이 없다 —
   `draftPicks` prop 하나를 더한다(필수, 새 대화 칸에만 의미). `avoid`는 `replacing.cwd`. `onRunStarted`에서 `replacing`이 있으면 `runs.close(id)` 후 지운다.
   workspace 변경 · 안내의 `그만두기` · 다른 대화 열기(`focusConversationId`) · "다시 실행"에 지운다. 새 대화 칸 위 안내는 Dock이 `replacing`을 받아 그린다(필수 prop).
   `ConversationHeader.test`·`Dock.test`·`App.test`: 메뉴가 repo 하나면 없다 · 채운 값 · **보내기 전에는 끝내지 않는다** · 보내면 끝낸다 · 그만두면 그대로 ·
   어긋남 안내가 끝낸 대화에는 없다 · 이 끝내기는 배너를 띄우지 않는다.
7. **끝낼 때 묻기** (FR-9~12) — `Dock`의 `closeConversation` 성공 뒤 `askClose` state(`{ issueId, title } | null`). 조건 판정은 `renderer/conversation.ts`의 순수
   함수 `shouldAskClose(conv, conversations)`(이슈가 있고 done이 아니고 같은 이슈의 다른 대화가 전부 끝냈고 도는 턴이 없다). 배너 `.dock-issue-close`,
   `이 이슈도 완료`는 `client.issues.update({ id, status: 'done' })`. workspace 변경에 지운다(렌더 중 조정 — FR-22의 다른 state들과 같은 자리). `Dock.test`:
   조건 넷 · 줄 끝 체크와 헤더 메뉴 둘 다 · 완료 실패면 배너에 오류 · **끝내기만으로는 `issues.update`를 부르지 않는다**(FR-12).
8. **홈의 다섯째 할 일** (FR-13·14) — `shared/issueRules.ts`에 `isUnclosed(issue, convs)`(대화는 `{ issueId, closedAt, active }` 모양). `core/home/summary.ts`가
   대화를 이슈별로 모아 `unclosed` 줄을 만들고 `stale`에서 뺀다. `shared/models.ts`의 `HomeTodo`에 갈래 하나. `HomeTodos.tsx`가 그 줄(`완료 처리`·`이슈 열기`),
   `HomePanel`·App에 필수 prop `onCloseIssue(issueId)`·`onOpenIssue(workspaceId, issueId)`(App은 `closeIssue`와 `openFromReport('issue')`를 그대로 쓴다).
   `issueRules.test`·`summary.test`(줄 순서 · stale에서 빼기 · 배지 수)·`HomePanel.test`·`App.test`.
9. **이슈 목록의 표식** (FR-15) — `IssuePanel`이 받는 `conversations.of`로 `isUnclosed`를 판정해 `.item-meta`에 알약 `대화 끝남`. 패널 창에는 `conversations`가
   없으므로 서지 않는다. `IssuePanel.test`.
10. **상세의 새로고침** (FR-21~24, §0-1·2) — `IssueDetail`·`MemoDetail`에 아이콘 버튼(`IconRefresh`를 `icons.tsx`에 더한다)과 `다른 곳에서 바뀜`(렌더 중
    `issue.updatedAt > expected.current`). 누르면 두 `flush()` → 둘 다 true면 필수 prop `onRefresh()`. 패널의 `onRefresh`: `await refresh()` 후 새로고침 번호를
    올려 상세의 `key`를 바꾼다. 충돌 배너가 서 있으면 그 `다시 불러오기`와 같은 길. **두 상세·두 패널을 같은 모양으로**(대칭). `IssueDetail.test`·`MemoDetail.test`
    대칭: 밖에서 바뀌면 표시 · 누르면 새 값이고 그 뒤 저장이 충돌하지 않는다 · flush가 false면 새로고침하지 않는다 · 자기 저장 뒤엔 표시가 없다.
11. **e2e** — 새 `e2e/issue-flow.e2e.ts`(spec §5의 시나리오, repo 둘, 가짜 CLI의 cwd 캡처) · `e2e/mcp.e2e.ts`에 제목·태그 고치기 하나. conversation-issue가 미뤄 둔
    e2e(이슈에서 대화 시작·열기, 헤더에서 이슈 열기)를 같은 파일에.
12. **마무리** — 전체 검증, `CLAUDE.md` 갱신(작업 디렉토리 순서·상세의 새로고침·홈 할 일 다섯·`Run.issue` 모양·뒤집은 두 결정), spec 상태와 이 plan의 완료 증명.

## 바뀌는 파일

| 파일 | 단계 | 무엇 |
|---|---|---|
| `core/mcp/tools.ts` · `.test.ts` | 1 | `update_issue` 입력 둘 |
| `shared/models.ts` | 2·8 | `RunIssue`, `AssignedIssue.repoIds`, `HomeTodo` 갈래 |
| `core/db/repositories/run.ts` · `.test.ts` | 2 | `hydrate`가 상태·태그를 싣는다 |
| 테스트 픽스처 여럿 | 2 | `issue: { id, title }` → 새 모양 |
| `renderer/cwdRule.ts` · `.test.ts` (새) | 3 | 규칙 두 함수 |
| `renderer/context.ts` | 4 | `ContextChip` 갈래 |
| `renderer/components/IssuePanel.tsx` · `.test` | 4·9·10 | 칩 태그, `대화 끝남`, 새로고침 번호 |
| `renderer/App.tsx` · `.test` | 4·6·8 | 할당 예정 태그, 다른 repo에서 다시 시작, 홈 prop |
| `renderer/components/RunPanel.tsx` · `.test` | 5·6 | `pickCwd`, `pickedCwd`, 어긋남, `draftPicks` |
| `renderer/components/ConversationHeader.tsx` · `.test` | 6 | menuitem, 어긋남 안내 |
| `renderer/components/Dock.tsx` · `.test` · `ConversationPanel.tsx` | 6·7 | prop 배선, 다시 시작 안내, 끝낼 때 배너 |
| `renderer/conversation.ts` · `.test` | 7 | `shouldAskClose` |
| `shared/issueRules.ts` · `.test` | 8 | `isUnclosed` |
| `core/home/summary.ts` · `.test` | 8 | `unclosed` 줄, stale에서 빼기 |
| `renderer/components/home/HomeTodos.tsx` · `HomePanel.tsx` · `.test` | 8 | 다섯째 줄 |
| `renderer/components/IssueDetail.tsx` · `MemoDetail.tsx` · `MemoPanel.tsx` · `.test` | 10 | 새로고침, 바뀜 표시 |
| `renderer/components/icons.tsx` | 10 | `IconRefresh` |
| `renderer/index.css` | 5·6·7·9·10 | 안내·배너·알약·표시 (토큰만) |
| `e2e/issue-flow.e2e.ts` (새) · `e2e/mcp.e2e.ts` | 11 | |
| `CLAUDE.md` · `docs/sdlc/issue-flow/*` | 12 | |

마이그레이션·IPC 채널·preload·`electron/` 변경 없음.

## 변이 (되돌려 빨개지는지 볼 것)

| 망가뜨릴 줄 | 빨개져야 할 테스트 |
|---|---|
| `pickCwd`: 이슈 칸(3·4)과 사이드바 칸(5)의 순서를 뒤집기 | `cwdRule.test` "할당 예정 이슈가 사이드바를 이긴다" · `RunPanel.test` "사이드바를 바꿔도 이슈 repo가 남는다" |
| `pickCwd`: `pickedCwd` 칸 지움 | "알약으로 고르면 이슈를 이긴다" |
| `pickCwd`: "정확히 하나" 대신 첫 태그 | "태그가 둘이면 건너뛴다" |
| RunPanel: 전송 성공 뒤 `pickedCwd` 지우기 지움 | "보내면 고른 값을 잊는다" |
| App: `issueConversations.start`의 `repoIds: issue.repoIds` 지움(빈 배열) | `App.test` "이슈에서 대화 시작하면 작업 디렉토리가 이슈 repo다" |
| IssuePanel: 칩의 `repoIds`를 `[]`로 | `IssuePanel.test` "담기 칩이 이슈의 태그를 싣는다" |
| App: `onRunStarted`의 `runs.close(replacing)` 지움 | `App.test` "다른 repo에서 보내면 원래 대화를 끝낸다" |
| App: `restartElsewhere`에서 바로 `runs.close` | "보내기 전에는 원래 대화를 끝내지 않는다" |
| App: `focusConversationId`·workspace 변경에 `replacing` 지우기 지움 | "다른 대화를 열면 다시 시작을 그만둔다" |
| Dock: `closeConversation` 뒤에 `issues.update` 직접 호출 | `Dock.test` "끝내기만으로는 이슈를 쓰지 않는다" |
| `shouldAskClose`: "다른 대화가 전부 끝냈다" 조건 지움 | "같은 이슈의 다른 대화가 남아 있으면 묻지 않는다" |
| `isUnclosed`: 도는 턴 조건 지움 | `issueRules.test` "도는 턴이 있으면 끝난 게 아니다" |
| summary: stale에서 빼기 지움 | `summary.test` "끝났는데 열린 이슈는 오래 안 본 이슈에 다시 서지 않는다" |
| App: `onCloseIssue`를 빈 함수로 | `App.test` "홈의 완료 처리가 이슈를 완료한다" |
| run.ts: `status` 대신 상수 `'open'` | `run.test` "할당 이슈의 상태가 실린다" |
| tools.ts: `title`의 `.min(1)` 지움 | `tools.test` "빈 제목은 거부한다" |
| IssueDetail: `flush()` 결과를 보지 않고 새로고침 | `IssueDetail.test` "저장이 실패하면 새로고침하지 않는다" |
| IssuePanel: 새로고침 번호를 `key`에서 뺌 | "새로고침하면 밖에서 바뀐 상태가 보인다" |
| MemoDetail: 위 둘과 같은 변이 | `MemoDetail.test`의 대칭 테스트 |

## 위험

1. **RunPanel의 cwd effect는 이미 여러 번 깨졌던 자리다** — 주석이 그 역사(두 effect의 순서가 뒤집히면 원본과 다른 저장소에서 돌았다, workspace가 바뀌어도
   이전 경로가 남았다)를 적고 있다. 순수 함수로 옮기며 그 두 경우를 `cwdRule.test`에 그대로 옮겨 적는다. 5단계 전후로 기존 `RunPanel.test`의 cwd 테스트가
   하나도 바뀌지 않아야 한다 — 바꿔야 한다면 그것은 회귀다.
2. **`appliedSelection`을 없애면 "사이드바를 고르면 따라간다"가 바뀐다** — 이슈가 없을 때는 예전처럼 따라가야 한다. 사이드바는 5번 칸이므로 4번까지가 비면
   선택이 결과가 된다. 다만 예전에는 "사이드바가 **바뀔 때만**" 덮어 알약으로 고른 값이 살았다 — 이제 그 역할을 `pickedCwd`가 한다. 알약으로 고른 뒤 사이드바를
   바꾸면 알약이 이긴다(예전에는 사이드바가 이겼다). spec FR-1의 순서가 그것이다. e2e(`dock-repo`·`code-pane`)가 사이드바 변경으로 cwd를 바꾸는지 0단계에서 본다.
3. **`Run.issue`를 넓히면 픽스처가 많이 깨진다** (§0-3). 타입 오류라 조용히 넘어가지는 않는다.
4. **`draftPicks`는 새 prop이고 "다시 실행"도 언젠가 쓰고 싶어 할 것이다.** 이번에는 다른 repo에서 다시 시작에만 넘기고 "다시 실행"(인박스)은 그대로 둔다 —
   spec 범위다. 대신 이름을 일반적으로 둔다.
5. **새로고침의 다시 마운트**(§0-2)는 `useDebouncedSave`의 언마운트 흘려보내기를 탄다 — 이미 `flush()`로 비운 뒤라 보낼 것이 없다. 그래도 "다시 마운트하는 순간 저장이
   한 번 더 날아가지 않는다"를 테스트한다.
6. **e2e의 cwd 확인**은 가짜 CLI가 받은 cwd를 캡처 파일에 적는 기존 길(`ONE_DESK_*_CAPTURE`)을 쓴다 — 홈의 CLI probe가 캡처를 덮던 함정(CLAUDE.md 홈 절)이 있으니
   홈을 거치지 않는 순서로 짠다.

## 완료 증명

(구현 뒤에 채운다 — 명령과 실제 출력, 변이 결과, e2e 수와 시간.)
