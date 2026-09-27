# Plan: 대화의 수명 주기와 정체성

- 출처: `intent.md`, `spec.md` (2026-09-23 승인)
- 작성자: 권용현
- 상태: 승인됨 (2026-09-23)
- 작성일: 2026-09-23

## spec에서 다듬은 것

spec의 결정을 뒤집지 않고 모양만 맞춘다.

1. **마이그레이션 번호는 `0008`이다.** `drizzle/`의 최신이 `0007_quick_falcon.sql`(agent-setup)
   이라 확인했다.
2. **끝내기 아이콘은 `IconCheck`다 — `IconX`가 아니다.** ×는 삭제로 읽히는데 이 동작은
   기록을 지우지 않는다(intent 제약). 체크가 "다 봤다"에 맞고, `IconTrash`와도 헷갈리지
   않는다. `icons.tsx`에 하나 더한다.
3. **CSS 클래스 이름을 여기서 정한다.** spec은 화면만 그렸다. `.dock-tab`이 사라지고
   `.dock-side`(왼쪽 레일) · `.dock-main`(오른쪽) · `.dock-conv`(대화 줄) ·
   `.dock-conv-selected` · `.dock-conv-meta` · `.dock-conv-actions` · `.dock-new` ·
   `.dock-closed`가 된다. **`e2e/conversation.e2e.ts`가 `.dock-tab`을 세고 있으므로**
   (`:127`) 그 줄이 `.dock-conv`로 바뀌고 기대값도 2 → 1이 된다(`＋ 새 대화`는
   `.dock-new`라 세지 않는다).
4. **뿌리 행은 `id === 대화 id`로 찾는다 — `ordered[0]`에 기대지 않는다.** 지금
   `groupConversations`는 가장 오래된 행을 뿌리로 간주하는데, 그것은 `runs.list`가 전부
   준다는 사실에 얹힌 가정이다. `title`·`closedAt`처럼 **뿌리에만 있는 값**을 읽기
   시작하면 그 가정이 깨지는 날 조용히 null이 된다. `ordered.find((r) => r.id === id) ??
   ordered[0]!`로 명시한다.
5. **자동 확인은 `Dock`이 `useClient()`로 직접 부른다.** App의 `review()`를 쓰지 않는다 —
   그 오류는 인박스 배너로 가는데 FR-8은 도크의 `actionError`로 흘리라고 했다. 도크가
   `client.runs.cancel`을 이미 직접 부르고 있어 패턴도 같다.
6. **자동 확인은 e2e로 검증하지 않는다.** 가짜 CLI가 Windows에서 spawn조차 안 돼 run이
   항상 `failed`가 되는데(CLAUDE.md), `failed`는 `ACTIONABLE`이라 자동 확인이 **일어나지
   않는 것이 정답**이다. macOS에서는 `succeeded` → 일어난다. **플랫폼마다 반대 결과가
   나오는 e2e가 되므로** 단위 테스트로만 고정한다(리스크 절 참고).
7. **`renderer/inbox.ts`는 옮기고 지운다** — 재수출 껍데기를 남기지 않는다. 남기면 어느
   쪽을 import해도 되는 상태가 되어 "표 하나"라는 이 작업의 목적이 흐려진다. 소비자는
   `InboxPanel.tsx` 하나뿐이라 값싸다.

## 변경되는 파일

| 파일 | 신규/수정 | 변경 내용 |
| --- | --- | --- |
| `shared/inbox.ts` | 신규 | `renderer/inbox.ts`에서 옮김 + `ACTIONABLE` 표(FR-3) |
| `shared/inbox.test.ts` | 신규 | 옮김 + **두 열이 서로의 부정임** |
| `renderer/inbox.ts` | **삭제** | |
| `renderer/inbox.test.ts` | **삭제** | |
| `renderer/components/InboxPanel.tsx` | 수정 | import 경로 한 줄 |
| `drizzle/0008_*.sql` | 신규 | `ALTER TABLE run ADD COLUMN` 둘. `pnpm db:generate` |
| `core/db/schema.ts` | 수정 | `run.title`·`run.closed_at` |
| `core/db/repositories/run.ts` | 수정 | `hydrate`·`inboxCounts`·`close`·`rename`·`create`의 `closedAt` 해제 |
| `core/db/repositories/run.test.ts` | 수정 | FR-4·FR-12·FR-13·FR-14 |
| `core/index.ts` | 수정 | `runs.close`·`runs.rename` (둘 다 `RUN_UPDATE` + `emitInbox`) |
| `core/index.test.ts` | 수정 | 배선 |
| `shared/models.ts` | 수정 | `Run.title`·`Run.closedAt` (**의도적으로 싣는다**) |
| `shared/channels.ts` | 수정 | `runsClose`·`runsRename` |
| `shared/client.ts` | 수정 | `runs.close`·`runs.rename` |
| `electron/ipc/runs.ts` | 수정 | 핸들러 둘. core 호출만 |
| `electron/preload.ts` | 수정 | 브리지 둘 |
| `renderer/conversation.ts` | 수정 | 뿌리 명시 조회, 제목 사다리, `named`·`closedAt` |
| `renderer/conversation.test.ts` | 수정 | 사다리 네 단 |
| `renderer/components/Dock.tsx` | 수정 | 세로 목록, 끝낸 대화 토글, 줄 액션, 자동 확인 |
| `renderer/components/Dock.test.tsx` | 수정 | 목록·토글·자동 확인·FR-23 |
| `renderer/components/icons.tsx` | 수정 | `IconCheck` |
| `renderer/index.css` | 수정 | `.dock-side`/`.dock-main`/`.dock-conv`… (`.dock-tab` 제거) |
| `e2e/conversation.e2e.ts` | 수정 | `.dock-tab` → `.dock-conv`, 종료·되살아남 시나리오 |
| `CLAUDE.md` | 수정 | 현재 상태 + 함정(아래 9단계) |

**건드리지 않는 것**: `renderer/App.tsx`(새 prop이 없다) · `core/execution.ts` ·
`core/runner/*` · 어댑터 · 큐 · MCP · `Transcript.tsx` · `ConversationPanel.tsx` ·
`RunPanel.tsx` · `inbox()`(목록 쿼리).

## 작업 순서

각 단계는 **실패를 먼저 확인하고** 구현한다. 회귀 테스트는 대상 코드를 잠시 망가뜨려
실제로 빨개지는지 본다(CLAUDE.md 컨벤션).

1. **`shared/inbox.ts`로 옮기고 `ACTIONABLE`을 더한다.** `inboxCategory`의 인자를
   `{ status, needsAnswer }`로 좁힌다(FR-2). `renderer/inbox.ts`·`.test.ts`를 지우고
   `InboxPanel.tsx`의 import를 고친다.
   **완료 확인**: `shared/inbox.test.ts`가 다섯 카테고리 파생과 **`ACTIONABLE`의 두 열이
   서로의 부정임**을 고정한다. `grep -rn "renderer/inbox"`가 비어 있다. `pnpm typecheck`
   초록(인자를 좁혀도 `Run`을 그대로 넘기는 호출부가 통과한다).

2. **`inboxCounts()`가 `ACTIONABLE`만 센다.** 슬림 select에 `needs_answer` 한 칸을
   더한다. **`inbox()`는 한 글자도 바꾸지 않는다**(FR-4).
   **완료 확인**: `run.test.ts`에 "완료·미확인 대화는 배지에 안 잡히고 목록에는 잡힌다"와
   "답변 필요는 둘 다 잡힌다". `ACTIONABLE`을 전부 `true`로 바꾸면 빨개진다.
   `assembled_prompt`가 select에 없다(NFR-1).

3. **마이그레이션 `0008` + 스키마 + `Run` 타입.** `title text`·`closed_at integer`.
   `hydrate`가 둘을 `Run`에 싣는다(FR-10). `shared/models.ts`의 `Run`에 명시한다.
   **완료 확인**: `pnpm db:generate`가 만든 SQL이 `ALTER TABLE ... ADD` 둘뿐이고
   **`DROP TABLE`이 0건**이다. 실제 DB 복사본을 열어 마이그레이션이 돌고 기존 run 행과
   `run_context_item`이 그대로이며 과거 run의 두 값이 전부 NULL이다(백필 없음, FR-16).
   `run.test.ts`의 "아홉 컬럼이 낱개로 새지 않는다"가 **수정 없이** 통과한다.

4. **저장소 `close`·`rename` + `create`의 해제.**
   - `close(rootRunId)` — 한 트랜잭션에서 `closed_at` + (미확인이면) `reviewed_at`/
     `reviewed_kind='archived'`(FR-12).
   - `rename(rootRunId, title)` — 빈 문자열은 null(FR-14). 뿌리가 아닌 id는 던진다.
   - `create()`가 뿌리의 `reviewedAt`을 지우는 **그 set 객체에 `closedAt: null`을 더한다**
     (FR-13). 새 자리를 만들지 않는다 — 찍는 곳과 지우는 곳을 하나로 유지하는 것이 요점이다.
   **완료 확인**: 네 테스트가 각각 FR-12·FR-13·FR-14·뿌리 검증을 고정한다.
   `closedAt: null` 한 줄을 지우면 "끝낸 대화에 턴을 보내면 되살아난다"가 빨개진다.
   `close`의 `reviewedAt` 부분을 지우면 "끝낸 대화는 배지에서 빠진다"가 빨개진다.

5. **core + IPC + preload + client 배선.** `runs.close`·`runs.rename`이 `RUN_UPDATE`를
   내보내고 `emitInbox()`를 부른다(FR-15). 핸들러는 얇다.
   **완료 확인**: `core/index.test.ts`가 (a) 두 이벤트가 각각 나가는지 (b) `emitInbox`가
   불리는지 본다. `emitInbox()` 한 줄을 지우면 빨개진다.
   `grep -rn "from 'electron'" core/`가 비어 있다.

6. **`renderer/conversation.ts` — 뿌리 명시 조회 + 제목 사다리.** `Conversation`에
   `named`·`closedAt`을 더하고 `title`을 네 단으로 만든다(FR-11). `contextOf`가 이미
   대화의 맥락 합집합을 주므로 그것을 쓴다 — **`titleOf`보다 먼저 계산돼야 하므로**
   `groupConversations` 안의 순서를 맞춘다.
   **완료 확인**: `conversation.test.ts`가 네 단을 각각 고정한다 — 사용자 이름이 이기고,
   없으면 첫 이슈 이름 + `+N`(N = 이슈·메모 수 − 1, repo·asset은 안 센다), 이슈·메모가
   없으면 repo 이름, 아무것도 없으면 첫 지시. **취소된 턴의 맥락은 안 센다**(`contextOf`가
   이미 거른다)는 것도 한 줄로 고정한다.

7. **도크 세로 목록 (D).** 헤더에서 `.dock-tabs`를 들어내고 본문을 좌우로 가른다.
   `＋ 새 대화` · 끝나지 않은 대화 · `끝낸 대화 N` 토글(0이면 안 그림, FR-20).
   줄 끝 아이콘 둘은 폭 0 → hover·포커스에 펼침, 이름은 `<제목> 이름 바꾸기`·
   `<제목> 대화 끝내기`(FR-21). 끝낸 줄에는 끝내기가 없다(FR-22). 열린 대화를 끝내면
   `＋ 새 대화`로 돌아간다(FR-23). 취소 버튼은 `.dock-header` 오른쪽 끝에 **남긴다**(FR-24).
   **완료 확인**: `Dock.test.tsx`가 목록·토글·FR-22·FR-23을 고정하고, 기존 취소 테스트
   셋이 `within(header)`로 **수정 없이** 통과한다. 색은 `:root` 토큰만 쓴다(`index.css`에
   새 hex 0건). 가로 스크롤 속성이 남아 있지 않다.

8. **자동 확인 배선 (B 렌더러).** 목록 줄 클릭 핸들러에서만 부른다. 조건은 셋 —
   `!ACTIONABLE[카테고리]` · 뿌리의 `reviewedAt === null` · 명시적 클릭.
   **완료 확인**: `Dock.test.tsx`가 (a) 완료 대화를 누르면 `markReviewed(뿌리, 'confirmed')`
   가 불리고 (b) **마운트만으로는 안 불리고**(FR-6) (c) 답변 필요는 안 불리고 (d) 실패해도
   대화는 열린다(FR-8)를 각각 본다. **자동 확인을 `selected`에 옮기면 (b)가 빨개진다.**
   턴 id를 넘기도록 바꾸면 (a)가 빨개진다.

9. **e2e 확장 + CLAUDE.md.** `.dock-tab` → `.dock-conv`로 고치고(기대값 2 → 1), 시나리오를
   잇는다: 2턴 대화를 끝내고 → 목록에서 사라지고 → "끝낸 대화"를 펼치면 보이고 → 열어
   턴을 보내면 기본 목록으로 돌아온다(FR-13). 줄 끝 아이콘은 **줄을 먼저 hover**하고
   누른다(폭 0이라 바로 클릭하면 가로챈다).
   **완료 확인**: `pnpm test:e2e` 전부 초록. CLAUDE.md에 현재 상태와 함정을 적는다.

## 리스크

- **자동 확인의 결과가 플랫폼마다 반대다.** Windows에서 가짜 CLI는 spawn조차 안 돼 run이
  `failed`로 끝나고, `failed`는 `ACTIONABLE`이라 자동 확인이 **안 일어나는 것이 정답**이다.
  macOS에서는 `succeeded` → 일어난다. → **e2e로 검증하지 않는다.** 단위 테스트가
  `status`를 직접 세워 양쪽을 다 고정한다. 이 판단 자체를 CLAUDE.md에 남긴다.
- **e2e가 넓게 깨진다.** `.dock-tab`이 사라지고 짧은 라벨(`끝내기`·`이름`)이 는다.
  → 7단계 직후 `pnpm test:e2e`를 먼저 돌려 부분 일치 충돌을 찾는다. RTL은 전체 일치라
  단위 테스트가 초록인 채로 넘어간다(CLAUDE.md).
- **`title`이 뿌리에만 유효하다는 규칙을 타입이 안 지킨다.** → `rename`의 뿌리 검증이
  유일한 방어선이고(FR-14), 그것을 지우면 빨개지는 테스트를 4단계에 둔다.
- **`runs.list`가 여전히 전부 가져온다.** 끝낸 대화도 IPC로 나온다(spec 우려 1).
  → 이번에는 두고, 느려지면 **끝낸 대화를 따로 조회**(토글을 펼칠 때만)로 간다.
  `limit`을 붙이면 대화 묶기가 반쪽 목록 위에서 돌아 뿌리 행을 놓친다 — 4번 항목의
  명시 조회가 그때를 대비한 것이다.
- **`inboxCategory`의 인자를 좁히면 호출부가 조용히 통과한다.** `Run`은 그 두 필드를
  포함하므로 타입 오류가 안 난다. → 의도한 것이다(구조적 타이핑). 다만 좁혔다는 사실이
  드러나도록 1단계에서 core의 슬림 select가 그대로 들어가는 테스트를 둔다.
- **`emitInbox`를 빠뜨리면 배지가 안 줄어든다.** 화면은 멀쩡해 보인다(도크 목록은
  `RUN_UPDATE`로 갱신되므로). → 5단계의 전용 테스트가 잡는다.

## 완료 증명

- [x] `pnpm test` — **1226 통과 / 31 스킵.** 기준선(v0.15.0)의 1180에서 **+46**
- [x] `pnpm typecheck` — 오류 0
- [x] `pnpm lint` — 오류 0
- [x] `pnpm test:e2e` — 17 파일 통과 / 2 스킵. 신규 **넷** 포함
      (`대화를 끝내면 목록에서 내려가고, 턴을 이으면 되살아난다`,
      `완료된 대화를 도크에서 열면 인박스에서 저절로 내려간다`, 목록·대화 스크롤 분리,
      `도크를 높이 끌어 패널이 짧아져도 asset 본문이 패널 밖으로 나가지 않는다`)
- [x] `grep -rn "from 'electron'" core/` — 출력 없음
- [x] `grep -rn "window.oneDesk" renderer/ | grep -v main.tsx` — 출력 없음
- [x] `grep -rn "renderer/inbox"` — 출력 없음 (재수출 껍데기를 남기지 않았다)
- [x] `drizzle/0008_lovely_klaw.sql` — `ALTER TABLE run ADD` 둘뿐, `DROP TABLE` **0건**
- [x] **실제 DB 복사본으로 확인** — 0008 이전 백업(`2026-09-22T13-21-45`)에 드리즐
      마이그레이터를 돌렸다: 마이그레이션 7→9, `run` 2행 · `run_context_item` 1행 ·
      `asset` 9개 · `issue` 1 · `memo` 1 · `workspace` 2 **전부 그대로**. 과거 run의
      `title`·`closed_at`은 전부 NULL(백필 없음, FR-16)
- [x] `index.css`의 도크 블록에 직접 hex **0건** (토큰만)
- [x] **변이 검증 — 22개를 하나씩 망가뜨려 각각 빨개지는지 확인했다**
  - [x] `ACTIONABLE`을 전부 true로 → 4개 실패 (2단계)
  - [x] `core/index.ts`의 `onRunUpdate` 안 `emitInbox()` 제거 → 1개 실패
  - [x] `create`의 `closedAt: null` 제거 → 1개 실패 (4단계)
  - [x] `close`의 `reviewedAt` 동시 기록 제거 → 1개 실패
  - [x] `assertRoot` 무력화 → 2개 실패
  - [x] `rename`의 빈 값 null 처리 제거 → 1개 실패
  - [x] `conversations.close`의 `emitInbox()` 제거 → 1개 실패 (5단계)
  - [x] `conversations.rename`의 `RUN_UPDATE` 제거 → 1개 실패
  - [x] 제목 사다리 1단(사용자 이름) 제거 → 2개 실패 (6단계)
  - [x] 제목 사다리 2단(맥락) 제거 → 5개 실패
  - [x] 제목 사다리 3단(repo) 제거 → 1개 실패
  - [x] `+N` 개수에 repo·asset 포함 → 1개 실패
  - [x] 뿌리 조회를 `ordered[0]`로 → **처음엔 살아남았다**(아래 이탈 기록)
  - [x] 끝낸 대화 필터 제거 → 3개 실패 (7단계)
  - [x] FR-23(끝내면 새 대화로) 제거 → 1개 실패
  - [x] FR-22(끝낸 줄에 끝내기 없음) 제거 → 1개 실패
  - [x] FR-20(0이면 토글 안 그림) 제거 → 1개 실패
  - [x] `close`에 턴 id 넘김 → 1개 실패
  - [x] `close` 오류 삼키기 → 1개 실패
  - [x] 자동 확인을 `selected` effect로 옮김 → **"마운트만으로는 찍지 않는다"·
        "focusConversationId로 열려도 찍지 않는다" 둘이 정확히 빨개졌다** (8단계 핵심)
  - [x] 자동 확인의 `ACTIONABLE` 가드 제거 → 2개 실패
  - [x] 자동 확인이 턴 id에 찍음 / 이미 확인됨 가드 제거 / `endedAt` 가드 제거 → 각 1개 실패
- [x] **CLAUDE.md 갱신** — 현재 상태 한 절 + 함정 여섯: (1) e2e의 가짜 CLI는 node
      런처를 물어 **성공한다**(단위 테스트와 다르다), (2) 배지와 자동 확인은 한 표의
      양면, (3) 자동 확인을 `selected`에 걸지 말 것, (4) `title`·`closed_at`은 뿌리
      전용이고 타입이 안 지켜준다, (5) 도크 줄 제목은 맥락에서 오고 제목으로 세면 안
      된다, (6) `shared/`의 테스트는 vitest include에 넣어야 돈다
- [x] **실제 앱으로 확인** — 빌드된 앱을 띄워 화면을 찍었다. 세로 목록·파생 제목·
      "끝낸 대화" 토글·줄 액션이 실제로 보이고, 완료 대화는 배지를 올리지 않는다.
      **여기서 위의 수정 넷이 나왔다** — 단위·e2e가 전부 초록인 채로 넘어간 것들이다.

## 계획 이탈 기록

- **`vitest.config.ts`의 core 프로젝트가 `shared/**/*.test.ts`도 잡게 했다.** 계획에 없던
  파일이다. 프로젝트가 `core/**`와 `renderer/**` 둘뿐이라 `shared/inbox.test.ts`는 **어느
  쪽에도 안 걸려 실행되지 않은 채로 통과한 것처럼 보였다** — 같은 파일의 renderer include
  주석이 경고하던 바로 그 함정이다. 환경 의존이 없는 순수 모듈이라 node 프로젝트에 넣었다.

- **"자동 확인은 e2e로 검증하지 않는다"(plan §2-6)를 철회했다.** 전제가 틀렸다.
  `e2e/driver.ts`가 `ONE_DESK_AGENT_LAUNCHER: process.execPath`를 세워 `.mjs` 픽스처를
  node로 띄우므로 **e2e의 run은 두 플랫폼에서 똑같이 성공한다.** CLAUDE.md의 "Windows에서
  가짜 CLI는 spawn조차 되지 않는다"는 `ONE_DESK_AGENT_PATH`만 세우는 **단위 테스트**의
  이야기였는데, 그것을 e2e에까지 적용해 읽은 것이 잘못이었다. 그래서
  `e2e/inbox.e2e.ts`에 자동 확인 시나리오를 더했다 — 인박스 화면에 **가지 않고** 도크에서
  대화를 여는 것만으로 목록이 비는지를 본다. CLAUDE.md에 두 경로의 차이를 못박았다.
  반대로 **단위 테스트** 쪽에서는 같은 이유로 `core/index.test.ts`의
  "run이 끝나면 인박스 카운트를 push한다"가 `toBe(1)`을 박고 있어 **macOS에서만 빨개질
  상태**였다(이 변경 전에는 무해했다). 숫자를 박지 않고 실제 행의 카테고리로 다시 계산해
  쓰도록 고쳤다.

- **`core.conversations` 네임스페이스를 새로 뒀다.** 계획은 "core + IPC 배선"이라고만 적었다.
  `core.runs`는 저장소를 **그대로** 내보내는 자리라 거기에 `close`/`rename`을 더하면 이벤트를
  내보내지 않는 경로가 생긴다(`inbox.markReviewed`가 `inbox` 밑에 있는 것과 같은 이유).
  클라이언트 표면은 spec대로 `runs.close`/`runs.rename`이다.

- **뿌리 명시 조회의 첫 테스트가 변이를 못 잡았다.** `ordered[0]`으로 되돌려도 초록이었다 —
  테스트가 넘긴 목록이 최신순이라 `ordered[0]`도 우연히 뿌리였기 때문이다. 순서를 일부러 깬
  입력("목록 순서가 흔들려도 뿌리를 찾는다")을 더해서야 잡혔다. **가정을 쓰지 않는다는 것을
  검증하려면 그 가정이 성립하지 않는 입력을 넣어야 한다.**

- **`ConversationList.tsx`를 새 파일로 뺐다.** 계획의 파일 표에는 `Dock.tsx` 수정만 있었다.
  줄 하나가 (제목·상태·부제·액션 둘·이름 편집)으로 커져 `Dock`에 두면 읽기 어려웠다.
  **state는 내리지 않았다** — 펼침(`showClosed`)·편집(`renamingId`)을 `Dock`이 쥔다
  (`SettingsPanel`이 초안 state를 쥐는 것과 같은 이유).

- **기존 e2e 넷이 깨져 고쳤다.** 계획이 "넓게 깨진다"고 예고한 그대로다.
  `core-loop`·`conversation`은 **제목이 맥락에서 오게 된 것**(줄을 프롬프트로 찾고 있었다),
  `queue`는 라벨 글자(`+` → `＋`), `inbox`는 **배지가 완료·미확인을 더 이상 세지 않는 것**.
  마지막 것은 회귀가 아니라 이 작업이 바꾼 계약이라, 그 테스트를 "배지에 숫자가 붙지
  않는다"로 뒤집어 새 계약을 고정했다.

- **사용자 확인에서 나온 수정 넷.** 화면을 실제로 보고서야 드러난 것들이라 계획에 없었다.
  1. **목록과 대화가 한 덩어리로 스크롤했다.** `.dock-body`가 스크롤러라 대화록을 내리면
     목록도 함께 올라갔다. body의 스크롤을 막고 `.dock-side`·`.dock-main`이 각자 스크롤하게
     했다. 그 과정에서 `.conversation-panel`의 `height: 100%`도 `min-height: 100%`로 바꿨다 —
     실행 패널만 284px이라 도크 기본 높이(242px)에서는 `height`로 못 박으면 `.transcript`가
     **16px짜리 창**이 된다(실측). `e2e/conversation.e2e.ts`에 회귀 가드를 두고 변이로 확인했다.
  2. **`.detail`도 같은 결함이었다** — `height: 100%`가 칸 높이를 주장하는데 `.detail-body`의
     `min-height: 160px` 때문에 자식이 줄어들지 못해, 넘치는 만큼이 **패널 밖으로 그려졌다**
     (부모는 넘친 줄 모르니 스크롤도 안 생긴다). 도크를 높이 끌어 패널이 짧아진 상태에서
     사용자가 보고했고, 칸 143px에 내용 283px로 재현했다. 이 기능이 만든 결함이 아니라
     **원래 있던 것**이고 이슈·메모 상세도 같은 조건에서 샜다. `e2e/asset.e2e.ts`에 가드를 뒀다.
  3. **목록 줄의 상태를 글자에서 점으로 바꿨다**(2026-09-23 사용자 결정). 196px 레일에서
     `succeeded` 같은 영어 단어가 제목을 절반 넘게 밀어냈다 — 이 작업의 목적("제목으로
     대화를 알아본다")과 정면으로 부딪힌다. `index.css`의 "상태는 색만으로 가르지 않는다"를
     어기지 않으려고 `role="img"`+`aria-label`+`title`로 이름을 남겼고, **글자로 된 상태 칩은
     대화록의 턴마다 그대로 있다.** spec FR-19의 "윗단: 상태 칩 · 제목"을 뒤집은 것이다.
  4. **실행 패널의 "대화 이어가기" 배지를 걷어냈다**(2026-09-23 사용자 지적). 작업 디렉토리
     드롭다운 자리에 배지 + `agentKind` + 경로를 칸 없이 늘어놓고 있었는데, 어느 대화를
     이어가는지는 **세로 목록의 선택과 바로 위 대화록이 이미 말하고**(가로 탭이던 시절에는
     덜 분명해서 배지가 값을 했다) agent는 옆 칸이 비활성으로 보여준다. 그 줄에서 거기서만
     알 수 있는 것은 경로 하나뿐이라, 그것만 `작업 디렉토리` 머리말을 단 잠긴 칸으로
     남겼다. `disabled`가 아니라 `readOnly`다 — 경로를 눌러 복사할 수 있다.
  5. **`page.evaluate` 본문을 문자열로 넘긴다.** e2e는 `tsconfig.node.json`으로 검사되는데
     DOM lib이 없다. lib에 "DOM"을 더하면 같은 프로젝트의 `core/`가 브라우저 타입을 알게
     되어 경계 1이 흐려지므로 그쪽을 건드리지 않았다.

## 남은 일

- [x] **사용자 쪽 최종 확인** (2026-09-27). `pnpm dev`가 떠 있는 채로 `pnpm test:e2e`를 돌려
      `out/`이 e2e 빌드로 갈아끼워졌고(CLAUDE.md의 알려진 함정), 그 결과 **떠 있던 dev 앱이
      실제 DB에 마이그레이션 `0008`을 적용했다**(백업은 자동으로 남았다). **그러므로 `0008`을
      다시 생성하지 말 것** — journal의 `when`이 바뀌면 같은 ALTER가 한 번 더 돈다.
      2026-09-27에 `pnpm dev`를 끄고, 작업 트리에서 CRLF로 다시 쓰여 있던 파일들을 LF로
      되돌린 뒤(diff가 +10144/−9044에서 +1317/−217로) typecheck·lint·단위(1230 통과/31
      스킵)·e2e를 돌렸다. e2e는 32/33이고, 실패한 `delete.e2e.ts`의 "이슈를 목록 줄에서
      지우면 사라진다"는 단독으로 3회 모두 통과했다 — hover로 펼치는 줄 끝 버튼의 타이밍
      문제로 보고 보강은 `docs/sdlc/conversation-fixes/`가 맡는다.

- [x] **배지 범위** → `docs/sdlc/conversation-fixes/intent.md`의 결정으로 넘겼다. 실패·중단은
      배지에 세되 **열면 확인된다**(답변 필요만 열어 봐도 남는다). `ACTIONABLE` 한 칸 표가
      "배지에 센다 / 열면 확인된다" 두 칸짜리 한 표가 된다.

- [x] **"대화 끝내기" 발견성** → 다음 기능 `docs/sdlc/conversation-timeline/`의 대화 헤더
      메뉴로 넘겼다.
