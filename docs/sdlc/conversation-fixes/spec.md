# Spec: 대화의 확인된 결함 묶음

- intent: `./intent.md`
- 상태: 승인 위임됨 (2026-09-27)

## 1. 범위

intent의 결함 1~5를 고친다. 스키마·이벤트 모델·대화록의 모양은 바꾸지 않는다(마이그레이션
없음). 새 화면 요소는 "실행 중 턴을 멈추는 버튼" 하나뿐이다.

## 2. 기능 요구사항

### (A) 대화의 대표 턴 — 한 규칙을 core와 renderer가 같이 쓴다

- **FR-1** `shared/inbox.ts`에 순수 함수 `representativeTurn(turnsLatestFirst)`를 둔다.
  "시작하지 못하고 취소된 턴"(`status === 'canceled' && startedAt === null`)을 건너뛴 첫 턴을
  돌려준다. 전부 그런 턴이면 첫 턴을 돌려준다. 입력은 `{status, startedAt}`만 요구한다
  (슬림 select가 그대로 들어가야 한다 — `inboxCategory`와 같은 이유).
- **FR-2** core의 `lastTurnsOf`(인박스 목록·배지 공용)가 대화별로 이 함수를 쓴다.
  `inboxCounts`의 select에 `startedAt`을 더한다.
- **FR-3** renderer의 `Conversation`에 `state`(대표 턴)와 `active`(running인 턴, 없으면
  pending인 턴, 없으면 null)를 더한다. 도크 목록의 상태 점·답변 필요 표시·자동 확인 판정은
  `last`가 아니라 `state`를 본다. `last`는 "가장 최근에 만든 턴"으로 남긴다(다른 용도).

### (B) 배지 범위 — 두 칸짜리 한 표

- **FR-4** `ACTIONABLE: Record<Category, boolean>`을
  `INBOX_RULES: Record<Category, { badge: boolean; clearsOnView: boolean }>`로 바꾼다.
  값: needs-answer `{badge: true, clearsOnView: false}`, failed·interrupted
  `{true, true}`, done·dropped `{false, true}`.
- **FR-5** 불변식을 테스트로 고정한다: `badge === false`인 카테고리는 반드시
  `clearsOnView === true`다(아니면 인박스 목록에 영원히 남는다). `clearsOnView === false`인
  카테고리는 needs-answer 하나뿐이다(다음 턴으로 풀린다).
- **FR-6** `inboxCounts`는 `badge`를, 도크의 자동 확인(`pick`)은 `clearsOnView`를 본다.
  자동 확인은 여전히 목록 줄의 명시적 클릭에만 건다.

### (C) 취소

- **FR-7** `launch`가 행을 만든 뒤 enqueue하기 전의 run을 "launching"으로 추적한다.
  `cancel(runId)`가 launching인 run을 받으면 취소 요청을 기록만 하고 반환한다. launch는
  await 뒤마다(그리고 enqueue 직전에) 요청을 확인해, 요청이 있으면 MCP 토큰을 폐기하고
  canceled(`startedAt` null)로 끝낸 뒤 enqueue하지 않는다. preflight·verify 실패로 끝나는
  경로에서도 요청을 치운다.
- **FR-8** 취소는 **그 대화에 취소 대상 말고 활성 턴(running/pending)이 없을 때만** 뿌리에
  archived를 찍는다. 다른 활성 턴이 있으면 찍지 않는다 — 그 턴의 결과가 인박스를 정한다.
  *(리뷰 반영, 2026-09-27)* 판정은 누른 순간 한 번으로 끝나지 않는다: 실행 중에 멈춘 턴은
  **그 프로세스가 canceled로 끝날 때 한 번 더** 판정한다 — 도는 턴을 멈추고 그 프로세스가
  내려가기 전에 예약까지 취소하면 두 판정이 서로를 활성으로 보고 아무도 찍지 않았다. 멈출
  프로세스가 없는 취소(이미 끝났거나, 끝나고 기록되기 직전)는 아무것도 하지 않는다.
- **FR-9** 실행 중 턴의 취소는 예약 턴을 건드리지 않는다(예약은 이어서 뜬다 — 지금 동작).
- **FR-10** 타임아웃은 `failed`로 끝내고 오류 문구는 그대로 둔다. `run.ts`의 "여기 남는
  canceled는 앱이 취소한 것뿐" 주석이 다시 참이 된다.
- **FR-11** 도크 헤더의 취소는 `conversation.active`를 겨눈다(running 우선). 대화록의
  running 턴에도 취소 버튼을 둔다(지금은 pending만 있다). 버튼의 접근성 이름으로 어느 턴인지
  갈린다: 실행 중은 "실행 중인 턴 멈추기", 예약은 지금대로. *(리뷰 반영)* 헤더 버튼도 같은
  규칙을 따른다 — 실행 중인 턴을 겨누면 "실행 중인 턴 멈추기"(보이는 글자 "멈추기"), 예약을
  겨누면 "취소". 이름이 같으면 같은 턴이다.

### (D) 실행 결과 판정

- **FR-12** manager의 판정: 취소 → canceled, 타임아웃 → failed, **종료 코드가 0이 아니거나
  null(신호로 죽음)이면 failed**, 그 밖에는 `reportedStatus ?? 'succeeded'`. 어댑터가
  보고한 succeeded가 비정상 종료를 이기지 못한다.
- **FR-13** opencode 어댑터가 `{"type":"error"}` 줄을 `RunEvent` `error`로 낸다(메시지는
  `error.data.message` → `error.message` → `error.name` → JSON 순으로 뽑는다). manager는
  실패일 때 errorMessage를 **마지막 error 이벤트의 메시지 → stderr 앞 2000자** 순으로 채운다.
  *(리뷰 반영)* 스트림의 error 이벤트는 **어댑터가 실패 이유라고 한 것만** 쓴다
  (`AgentAdapter.errorEventsAreFailureReasons` — opencode만 켠다). claude의 error는 MCP 연결
  경고뿐이라 켜면 다른 이유로 실패한 run의 stderr를 가린다. spawn 오류는 늘 실패 이유다.
  1.18.30의 `run`은 error 줄을 낸 run을 항상 exit 1로 끝낸다(`--attach` 아닐 때, 바이너리 확인).
- **FR-14** CLAUDE.md와 설계 2026-09-06 §3-3의 "영원히 멈춘다"를 실측 사실로 고친다:
  1.18.x의 `run`은 `ask`를 자동 거부하고 조용히 exit 0으로 끝난다(도구 실패만 남는다).
  verifyRunnable은 그것을 명시적 실패로 바꾸므로 여전히 필수다.

### (E) 도구·세션·버전

- **FR-15** `READ_ONLY_TOOLS`에 `TaskCreate`, `TaskGet`, `TaskUpdate`, `TaskList`를 더한다
  (`TodoWrite`는 구버전·환경변수 경로를 위해 남긴다). 인자에 들어가는지 테스트로 고정한다.
- **FR-16** manager가 session 이벤트를 받는 즉시 `onSession(runId, sessionId)` 콜백을 부르고,
  execution이 `runs.saveExternalSessionId(runId, id)`로 저장한다(이미 값이 있으면 덮지
  않는다). `reapStale`은 그 값을 건드리지 않는다. 첫 턴이 앱 종료로 끊긴 대화를 이을 수 있다.
  *(리뷰 반영)* 빈 세션 id는 저장하지 않고, 종료 기록(`markFinished`)의 null은 도는 중에 남긴
  값을 지우지 않는다(manager.start가 세션을 배운 뒤 거부되는 경로).
- **FR-17** opencode 어댑터의 preflight가 실행 파일의 버전을 확인한다. `--version` 출력에서
  major가 2 이상이면 "OpenCode 2.x CLI는 아직 지원하지 않습니다 — 1.x를 쓰거나 설정의 CLI
  경로를 바꾸세요" 류의 사유로 거부한다. 결과는 (경로, 크기, mtime)로 캐시해 설정 화면의
  `checkAgents`가 매번 프로세스를 띄우지 않게 한다. 버전을 못 읽으면 막지 않는다(지금 동작).
  `checkAgents`와 실행이 같은 판정을 쓰는 규칙(CLAUDE.md)은 preflight에 두는 것으로 지켜진다.
  *(리뷰 반영)* 못 읽은 판정(실패·시간 초과)은 끝난 뒤 캐시에서 뺀다 — 통과(fail-open)가
  굳으면 한 번의 일시적 실패가 앱이 사는 동안 2.x 차단을 꺼 둔다.
  *(conversation-events 리뷰 반영 2026-09-27)* 같은 게이트에 **아래 한계 1.1.50**이 붙었다 — 그 기능이
  늘 붙이는 `--thinking`이 1.1.50에서 생겼고, 그 아래는 모르는 옵션이라 모든 run이 시작하자마자
  죽는다(`docs/sdlc/conversation-events/spec.md` FR-21 다듬음).

### (F) 그 밖에

- **FR-18** Windows에서 `terminate`는 `taskkill /PID <pid> /T /F`로 트리를 죽인다(실패하면
  `child.kill()`). 다른 OS는 지금대로. 플랫폼은 인자로 주입할 수 있게 해 개발 장비에서 검증한다.
  *(리뷰 반영)* 앱 종료 경로(`cancelAll`)는 taskkill을 **기다린다**(동기) — 비동기면 메인
  프로세스가 끝나며 taskkill도 libuv의 job과 함께 죽어 손자가 남는다(실측).
- **FR-19** `readLog`를 비동기로 바꾼다(`fs/promises`). 렌더러 스토어의 `hydrate`는 교체가
  아니라 seq 기준 병합이다(요청 중 push된 이벤트를 지우지 않는다).
- **FR-20** MCP 브리지는 SSE 본문의 `data:` 줄 중 **요청 id와 같은 id를 가진 JSON-RPC 응답**을
  돌려준다(알림 줄은 건너뛴다). 알림(id 없는 요청)의 응답은 지금대로.
- **FR-21** 대화 이름 칸을 비우고 저장하면 `rename(root, null)`을 불러 파생 제목으로
  되돌린다(spec lifecycle FR-14).
- **FR-22** workspace가 바뀌면 도크의 `view`·`pickedId`·`renamingId`를 처음 상태로 돌린다.
  *(리뷰 반영)* 옛 대화에서 난 오류 배너(`actionError`)도 함께 치운다.
  App의 `focusConversationId`는 소비한 뒤 치운다.
- **FR-23** `e2e/delete.e2e.ts`의 줄 끝 버튼 클릭을 안정화한다(줄 hover 뒤 버튼이 폭을 얻을
  때까지 기다린다). 같은 패턴을 쓰는 다른 e2e도 같은 헬퍼를 쓴다.

## 3. 인터페이스

- `shared/inbox.ts`: `INBOX_RULES`, `representativeTurn()` (+ `ACTIONABLE` 제거).
- `RunRepository.saveExternalSessionId(runId, sessionId): void`.
- `RunManager` 옵션 `onSession?(runId, sessionId)`.
- `renderer/conversation.ts` `Conversation.state`, `Conversation.active`.
- IPC 변경 없음.

## 4. 비기능 요구사항

- 마이그레이션 없음. 경계 셋 유지. 새 라벨이 기존 e2e 셀렉터와 부분 일치로 부딪히지 않는다.

## 5. 우려 사항

- FR-12는 claude에도 적용된다. claude가 is_error 없이 성공 result를 낸 뒤 비정상 종료하는
  경우가 실제로 있다면 지금까지 succeeded였던 것이 failed가 된다. 그 편이 맞다고 본다.
- FR-8에서 "다른 활성 턴"은 같은 뿌리의 running/pending 행이다. 대화당 활성 턴은 최대 둘
  (running 하나 + 예약 하나)이라 조회가 작다.
- FR-17의 첫 호출은 프로세스를 하나 띄운다(수백 ms). 캐시 뒤에는 stat만 한다.

## 6. 검증

- FR마다 먼저 실패하는 테스트. 회귀 테스트는 대상 코드를 잠시 되돌려 실패를 확인한다.
- `pnpm test`·`pnpm typecheck`·`pnpm lint`·`pnpm test:e2e`.

## 7. 리뷰가 남긴 설계 과제 (2026-09-27, 코드로 고치지 않음)

재현은 했지만 이 spec의 결정을 뒤집어야 해서 다음 설계로 넘긴다.

1. **답을 보낸 뒤 시작 전에 취소하면 앞 턴의 답변 필요가 사라진다.** 1턴이 답변 필요로
   끝나고, 보낸 답(2턴)이 전역 상한에 막혀 기다리다 취소되면 FR-8대로 뿌리에 archived가
   찍혀 인박스·배지에서 빠진다(답은 한 번도 전달되지 않았다). `create()`가 푼 `closedAt`도
   되돌아오지 않는다. "시작하지 못한 취소는 대표 턴이 자기 자신일 때만 찍는다"로 바꾸면
   intent 제약(`execution.test`의 C-1 — 다른 활성 턴이 없으면 대화째 빠진다)과 충돌하고,
   `closedAt`을 되돌리려면 풀기 전 값을 어딘가 기억해야 한다(스키마).
2. **`representativeTurn`이 앱 재시작이 내린 예약(`reapStale`)까지 건너뛴다.** 사용자가
   취소한 예약과 앱이 내린 예약을 가를 행 단위 표식이 없다. 그래서 여러 턴 대화에서
   "대기 중 취소됨"과 "다시 실행"이 사라지고, 버려진 지시를 되살릴 길이 대화록의 칩 하나만
   남는다. 같은 이유로, 사용자가 도는 턴을 멈춘 뒤 남은 예약이 `reapStale`로 내려가면 대표
   턴은 사용자가 멈춘 턴이 되어 "대기 중 취소됨"으로 뜬다.
3. **도크 줄의 점이 예약(pending)을 보인다 — 도는 턴이 있어도.** FR-3이 점을 `state`(대표
   턴)로 정했다. 헤더는 `active`(running 우선)를 보므로 두 곳이 대화 상태를 다르게 말한다.
   점을 `active ?? state`로 그릴지는 FR-3을 다시 정할 일이다(자동 확인 판정은 `state`가 맞다).
