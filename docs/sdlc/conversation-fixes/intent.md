# Intent: 대화의 확인된 결함 묶음

- 작성자: 권용현 (Claude가 초안)
- 상태: 승인 위임됨 (2026-09-27 — 사용자: "추천해준대로 쭉 수행해줘")
- 작성일: 2026-09-27

## 문제

2026-09-27, OpenCode Desktop 2.0.18을 기준으로 대화 리팩터링 범위를 조사하면서 코드를 읽어
결함을 찾았고, 반박 검증(검증 에이전트가 코드·바이너리·소스로 뒤집으려 시도)을 통과한 것만
여기 모았다. 리팩터링(`conversation-timeline`, `conversation-events`)이 이 위에 얹히므로
먼저 고친다. 화면을 크게 바꾸지 않는다 — 화면 재구성은 다음 기능이다.

### 1. 취소가 엉뚱한 곳에 걸린다

- **launch 중 취소가 삼켜진다.** `launch`는 pending 행을 만들어 먼저 알린 뒤
  `resolveExecutable`·`verifyRunnable`(opencode는 `opencode debug config` 프로세스)·
  `mcp.prepare`를 await하고 나서야 enqueue한다. 그 틈의 취소는 `queue.remove`가 false라
  "실행 중" 분기로 가고, `manager.cancel`은 프로세스가 없어 아무 일도 안 한다. 턴은 그대로
  돈다. 뿌리에는 archived만 남는다.
- **취소가 앞 턴의 결과를 가린다.** 취소는 어느 분기든 뿌리에 archived를 찍는다. 2턴이 도는
  중 예약한 3턴을 취소하면, 2턴이 답변 필요·실패로 끝나도 인박스·배지에 안 뜬다.
- **헤더의 "취소"가 예약 턴을 겨눈다.** 대화의 상태를 `createdAt` 기준 마지막 턴으로 본다.
  예약이 있으면 헤더 취소는 예약을 취소하고, **실행 중 턴을 멈출 버튼이 없다.** 예약을
  취소하면 마지막 턴이 canceled가 되어 헤더 버튼이 사라진다. 앱 재시작(`reapStale`) 뒤에는
  interrupted 2턴이 canceled 3턴에 가려 배지에서 빠진다.
- **타임아웃이 "대기 중 취소됨"이 된다.** 타임아웃이 canceled로 끝나 사용자 취소와
  섞인다(지금은 렌더러가 timeoutMs를 안 넘겨 잠재 결함).

### 2. OpenCode가 실패를 성공으로 적는다

- 어댑터가 text 줄마다 `result{status:'succeeded'}`를 합성하고 manager가 `reportedStatus`를
  종료 코드보다 먼저 본다. 중간 텍스트를 낸 뒤 exit 1로 끝난 run이 succeeded가 된다
  (설계 2026-09-06 §6의 "실제 판정은 종료 코드를 보는 runner가 한다"와 어긋난다).
- `{"type":"error"}` 줄은 파서가 버려 화면에도 로그에도 없다. json 모드의 opencode는 오류를
  stderr에 쓰지 않으므로 errorMessage가 null인 "이유 없는 실패"가 된다.
- CLAUDE.md는 "헤드리스 실행이 아무 말 없이 영원히 멈춘다"고 적었지만, 1.18.30 `run`은
  권한 `ask`를 **자동 거부하고 조용히 exit 0으로 끝난다**(소스 `run.ts` v1.18.30:801-822,
  1.18.27과 바이트 동일). verifyRunnable은 여전히 필요하지만 근거 문장이 틀렸다.

### 3. claude의 할 일 도구가 사라진다

Claude Code 2.1.280은 기본이 `TaskCreate`/`TaskUpdate`/`TaskGet`/`TaskList`이고 `TodoWrite`는
꺼져 있다(`CLAUDE_CODE_ENABLE_TASKS`가 false일 때만 TodoWrite). 읽기 전용·편집 허용의
`--tools` 화이트리스트(`core/runner/permission.ts`)에 Task*가 없어 **할 일 도구가 하나도
남지 않는다.**

### 4. 세션 id가 늦게 저장된다

session 이벤트의 id는 manager 지역 변수와 로그에만 있고 DB에는 `markFinished`에서야
들어간다. 첫 턴이 도는 중 앱을 끄면 행은 interrupted가 되지만 세션 id가 없어, 그 대화를
이으면 "이어받을 세션이 없습니다"로 실패한다.

### 5. 그 밖에 작은 것

- OpenCode 2.x CLI(데스크톱 번들 `opencode-cli.exe` 2.0.18)를 경로로 쓰면 어댑터가 깨진다 —
  `--variant`가 없고 바이너리에 `OPENCODE_PERMISSION` 문자열이 없다. **권한 정책이 조용히
  무시될 수 있다**(읽기 전용 run이 편집할 수 있다). 버전을 보지 않는다.
- Windows 취소가 트리를 죽이지 않는다 — `child.kill`은 직계만 즉시 강제 종료해 Bash 도구가
  띄운 손자 프로세스(dev 서버 등)가 남을 수 있다.
- 로그 되살리기(`useRunEvents`)가 목록을 통째로 교체해 요청 중 push된 이벤트를 지울 수 있고,
  `readLog`는 `readFileSync`로 메인 프로세스(같은 프로세스의 MCP 서버 포함)를 막는다.
- MCP 브리지가 SSE 본문의 첫 `data:` 줄만 돌려준다 — 서버가 응답 전에 알림을 보내면 진짜
  응답이 버려진다(잠재).
- 대화 이름을 비워 파생 제목으로 되돌릴 수 없다(spec FR-14와 불일치).
- workspace를 바꿔도 도크의 선택(`pickedId`/`view`)이 남아 선택 표시가 어긋난다.

## 원하는 결과

- 취소는 누른 그 턴을, 누른 순간에 멈춘다. 실행 중 턴도 멈출 수 있다.
- 취소한 예약이 다른 턴의 결과를 가리지 않는다. 대화의 상태는 "예약되었다 취소된 턴"을
  건너뛴 대표 턴으로 정한다 — core와 renderer가 같은 규칙을 쓴다.
- OpenCode run의 성패는 종료 코드가 정하고, 실패 이유가 보인다.
- 읽기 전용·편집 허용에서도 할 일 도구가 살아 있다.
- 첫 턴이 끊겨도 대화를 이어갈 수 있다.
- 지원하지 않는 OpenCode 버전은 실행 전에 막고 이유를 말한다.

## 결정 (2026-09-27, 사용자 위임으로 Claude가 추천안을 택함)

- **배지 범위(lifecycle plan "남은 일" 2번)** — 실패·중단은 **배지에 세되, 대화를 열면
  확인된다.** 답변 필요만 열어 봐도 남는다. OpenCode의 미확인 점(오류 알림은 보면 사라짐)과
  같다. 2026-09-23 결정("실패는 열어 봐도 남는다")을 사용자 보고("실패한 세션은 클릭해도 1이
  안 없어진다")에 맞춰 고친 것이다. 되돌리려면 `shared/inbox.ts` 표의 값 둘만 바꾼다.
  이를 위해 `ACTIONABLE` 한 칸짜리 표를 **두 칸(배지에 센다 / 열면 확인된다)짜리 한 표**로
  넓힌다 — 표는 여전히 하나다.
- **"대화 끝내기" 발견성(남은 일 3번)** — 다음 기능(`conversation-timeline`)의 대화 헤더 메뉴로
  옮긴다. 이 기능에서는 다루지 않는다.
- **취소가 뿌리에 확인 표시를 찍는 조건** — 그 대화에 **다른 활성 턴(running/pending)이 없을
  때만** 찍는다. C-1(뿌리에 찍는다)은 유지하되, 다른 턴의 결과가 남아 있을 때는 찍지 않는다.
- **타임아웃은 failed다.** 사용자가 누른 취소가 아니다.

## 영향 범위

- core: `execution.ts`(launch·cancel), `runner/manager.ts`(판정·세션 콜백), `runner/terminate.ts`,
  `runner/permission.ts`, `runner/adapters/opencode.ts`, `db/repositories/run.ts`(대표 턴,
  세션 저장), `mcp/bridge.mjs`, `index.ts`(readLog 비동기).
- shared: `inbox.ts`(두 칸 표, 대표 턴 규칙).
- renderer: `conversation.ts`(대표 턴·활성 턴), `Dock.tsx`(헤더 취소 대상·workspace 전환),
  `Transcript.tsx`(실행 중 턴 취소), `RenameField.tsx`, `store/runEvents.ts`·`hooks/useRunEvents.ts`.
- 문서: CLAUDE.md(OpenCode ask 서술, 배지 규칙), 설계 2026-09-06 §3-3 각주.
- **건드리지 않는 것**: 스키마(마이그레이션 없음), 이벤트 모델, 대화록의 모양.

## 제약

- CLAUDE.md의 경계 셋, "찍는 자리와 지우는 자리는 짝", 뿌리 id 규칙, TDD(회귀 테스트는 대상을
  망가뜨려 실패 확인), Windows 단위 테스트의 가짜 CLI 함정.
- `core/execution.test.ts:712-780`은 지금 "취소하면 대화가 인박스에서 통째로 빠진다"를
  고정한다. 다른 활성 턴이 없는 경우로 좁혀 유지한다.

## 성공 기준

- 위 결함마다 먼저 실패하는 테스트가 있고, 고친 뒤 통과한다.
- `pnpm test`·`pnpm typecheck`·`pnpm lint`·`pnpm test:e2e` 전부 통과.
