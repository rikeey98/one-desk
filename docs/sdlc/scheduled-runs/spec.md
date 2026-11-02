# Spec: 정기 실행 — 지시를 등록해 두면 정해진 주기마다 agent가 저절로 돈다

- 출처: `intent.md` (2026-11-02 승인)
- 작성자: 권용현 (초안: Claude)
- 상태: **구현됨** (2026-11-02). 승인 2026-11-02(사용자 "승인, plan 작성해줘"). FR-8·FR-13은 plan 0단계 사전 확인으로, FR-3·FR-20·FR-31은 구현 중에 고쳤다(각 항목의 개정 표시). 사용자가 뒤집을 수 있는 결정은 §8에 모았다.
- 작성일: 2026-11-02

## 0. intent의 미해결 질문에 대한 답

| 질문 | 답 | 자리 |
|---|---|---|
| 이름 | 사이드바·화면 제목 **`정기 실행`**, 하나는 "정기 실행 하나". 버튼 이름은 NFR-4의 표 | NFR-4 |
| 시간대 | **등록마다 IANA 시간대를 저장한다** — 렌더러가 만들 때의 시간대. core는 그 값으로 계산하고 **장비의 시간대를 묻지 않는다** | FR-3·FR-8 |
| cron 해석 | **의존성 `croner` 10.0.1**(MIT, 의존성 없음, 시간대·DST 지원, `previousRuns`). 프리셋도 cron으로 바꿔 한 길로 계산한다. 5필드만 받는다 | FR-6~8 |
| 깨어나는 방식 | **30초마다 확인하는 타이머 하나** + 절전에서 깨면(main의 `powerMonitor` `resume`) 즉시 확인. 앱을 켠 순간, 절전 뒤, 평소가 **같은 판정 하나**다 | FR-10~12 |
| 맥락은 언제 읽나 | **실행하는 그 시각에** 다시 읽는다. 지워진 항목은 빼고 실행 기록에 개수를 남긴다 | FR-17 |
| 이어 감에서 앞 턴이 답변 필요 | **건너뛴다** — 실행 기록에 `답변 기다리는 중`. 세션이 없으면 평소처럼 실패로 남는다 | FR-15 |
| 연속 실패 | **3번 연속 실패하면 저절로 끈다.** 이유가 목록 줄에 남고, 다시 켜면 센 것이 0이 된다 | FR-20 |
| 인박스 | 평소와 같은 규칙. 정기 실행이 낸 대화도 인박스에 오른다(성공은 배지에 세지 않는다) | §6 우려 3 |
| workspace·repo를 지우면 | workspace → 정기 실행도 지운다(cascade). repo만 → **정기 실행을 끄고** `repo가 지워졌습니다`를 남긴다 | FR-2·FR-21 |
| 홈 | 1차에 아무것도 더하지 않는다. 도는 정기 실행은 이미 홈의 "지금 돌고 있는 것"에 보인다 | §1 |

## 1. 범위

**들어가는 것.**

- **(A) 저장소** — 테이블 둘(`schedule`·`schedule_fire`), 마이그레이션 `0013`.
- **(B) 주기 계산** — 프리셋 → cron, cron → 다음 시각들, "지금 돌 차례인가"의 판정. 전부 순수 함수.
- **(C) 스케줄러** — core 안의 타이머 하나. 시각이 된 정기 실행을 `execution.start`/`resume`으로 보낸다. 건너뛰기·연속 실패·기록.
- **(D) IPC** — 목록·만들기·고치기·켜고 끄기·지우기·지금 실행·실행 기록·다음 시각 미리보기. 얇은 핸들러.
- **(E) 화면** — 사이드바의 리포트 아래 `정기 실행`, 목록 + 편집 칸 + 실행 기록.

**빠지는 것.**

- 앱이 닫혀 있어도 도는 것(데몬·트레이·OS 스케줄러·로그인 시 자동 시작) — intent의 결정.
- 편집 칸의 `/` 커맨드 피커와 `@` 파일 피커. **글자로 쓴 `/커맨드`·`@경로`는 실행 때 평소처럼 해석된다**(`execution.start`가 지시문을 해석한다) — 고르는 도구만 없다.
- 홈·인박스·도크 목록의 "정기 실행에서 왔다" 표시. 대화 제목이 그것을 말한다(FR-18).
- agent가 MCP로 정기 실행을 읽거나 만드는 것 — MCP `deps`에 넘기지 않는다(NFR-2).
- 결과에 따른 분기, 여러 단계, OS 알림.
- 실행 시간 상한을 등록마다 고르는 것 — 1차는 고정 60분(FR-19, §8의 5).

## 2. 데이터 모양

### 2-1. 비교한 설계 — 어떤 대화가 어느 정기 실행에서 나왔나

| | A. 실행 기록 테이블 `schedule_fire` (고른 것) | B. `run.schedule_id` 컬럼 |
|---|---|---|
| 모양 | 시각이 될 때마다 한 줄: 돌았나 · 건너뛰었나 · 왜 · 어느 run | 뿌리 행에 정기 실행 id |
| 건너뛴 것 | **남는다** — "앞 실행이 아직 돌고 있어 건너뜀"이 화면에 보인다 | 남을 자리가 없다 |
| 놓쳐서 돈 것 | `cause = 'missed'`로 남는다(intent 성공 기준 2) | 남을 자리가 없다 |
| `Run`에 닿는가 | 닿지 않는다 | **닿는다** — `hydrate`의 스프레드가 새 컬럼을 IPC로 흘린다(CLAUDE.md 함정), 리포트·MCP `list_conversations`까지 따라간다 |
| 대가 | 테이블 하나, 지우는 규칙(FR-5) | 마이그레이션은 같고 위 함정 |

**A를 고른다.** 대화 쪽에서 정기 실행을 알 필요는 제목(FR-18)으로 충분하다.

### 2-2. 테이블

- **FR-1.** 새 테이블 `schedule` (`core/db/schema.ts`):

  | 컬럼 | 타입 | 뜻 |
  |---|---|---|
  | `id` | text PK | `randomUUID()` |
  | `workspace_id` | text NOT NULL, FK `workspace.id` cascade | 소속 |
  | `repo_id` | text, FK `repo.id` **set null** | 작업 디렉토리. 실행할 때 그 repo의 경로·실행 환경(WSL)을 읽는다. null이면 repo가 지워진 것이다(FR-21) |
  | `name` | text NOT NULL | 1~60자, 한 줄 |
  | `enabled` | integer(boolean) NOT NULL default true | |
  | `disabled_reason` | text | `'failures'` · `'repo_missing'`. 사람이 끈 것이면 null. 켜면 지운다 |
  | `trigger` | text NOT NULL | 주기 JSON(FR-6). 쓰고 읽을 때 같은 검증을 탄다 |
  | `time_zone` | text NOT NULL | IANA 이름(`Asia/Seoul`) |
  | `conversation_mode` | text NOT NULL | `'new'` · `'continue'` |
  | `conversation_id` | text | 이어 가는 대화의 뿌리 id. `'continue'`의 첫 실행 전과 `'new'`에서는 null. 외래키 없음(run을 지우는 길이 없고, 걸면 drizzle 타입이 순환한다 — `run.parent_run_id`와 같은 판단) |
  | `agent_kind` · `model` · `effort` · `permission` | run의 같은 이름 컬럼과 같은 타입 | `StartRunInput`과 같은 뜻 |
  | `prompt` | text NOT NULL | 지시. 비울 수 없다 |
  | `context` | text NOT NULL default `'[]'` | `ContextItemRef[]` JSON — `issue`·`memo`·`asset`만(`file`·`repo`는 거부, FR-4) |
  | `anchor_at` | integer NOT NULL | **이 시각까지의 회차는 이미 처리했다.** 판정의 기준(FR-10) |
  | `consecutive_failures` | integer NOT NULL default 0 | |
  | `created_at` · `updated_at` | integer NOT NULL | epoch ms, `Date.now()`로 명시 삽입 |

  인덱스: `(workspace_id)`.
- **FR-2.** `repo_id`의 `set null`은 SQLite가 지킨다(`openDb`가 외래키를 켠다). repo를 지우는 core 경로가 그 workspace의 정기 실행 중 repo가 null이 된 것을 끄고 `disabled_reason = 'repo_missing'`을 찍는다 — 같은 트랜잭션이 아니어도 된다(다음 회차 판정이 같은 일을 한다, FR-21).
- **FR-3.** 새 테이블 `schedule_fire`:

  | 컬럼 | 타입 | 뜻 |
  |---|---|---|
  | `id` | text PK | |
  | `schedule_id` | text NOT NULL, FK `schedule.id` cascade | |
  | `cause` | text NOT NULL | `'on_time'` · `'missed'` · `'manual'` |
  | `slot_at` | integer | 그 회차의 정해진 시각. `'manual'`이면 null |
  | `fired_at` | integer NOT NULL | 실제로 판정한 시각 |
  | `outcome` | text NOT NULL | `'started'` · `'skipped'` · `'error'` |
  | `skip_reason` | text | `'busy'`(앞 실행이 돌고 있다) · `'needs_answer'`(이어 가는 대화가 답을 기다린다) |
  | `message` | text | `'error'`의 이유(`start`가 던진 글, 앞 2,000자) |
  | `run_id` | text | `'started'`일 때 그 턴. 외래키 없음 |
  | `dropped_context` | integer NOT NULL default 0 | 지워져서 뺀 맥락 수(FR-17) |
  | `judged_at` | integer | 그 run의 결과로 연속 실패를 판정한 때(FR-20). **한 run은 한 번만 센다** *(2026-11-02 구현 중 개정)* |

  인덱스: `(schedule_id, fired_at)`, `(run_id)`(run이 끝날 때 찾는다, FR-20).
- **FR-4.** 저장소 `core/db/repositories/schedule.ts`. 쓰기는 트랜잭션. 정의를 고치는 `update(id, definition)`과 스케줄러의 상태를 쓰는 `markHandled`·`recordFire`·`setFailures`·`disable`은 **서로의 컬럼을 쓰지 않는다** — 사람이 저장하는 순간 스케줄러가 회차를 처리해도 한쪽이 다른 쪽을 덮지 않는다. `update`는 **부분 갱신을 받지 않는다**(정의 전부를 받는다 — `updateDefaults`와 같은 이유). 검증은 저장소가 아니라 core의 `validateScheduleInput`(순수 함수) 한 자리이고 만들기·고치기가 같이 탄다: 이름 · 지시 · 주기(FR-7) · 시간대(`Intl.DateTimeFormat`이 받는가) · repo가 그 workspace 소속 · 맥락이 그 workspace에 있고 종류가 `issue`·`memo`·`asset`(지시 파일 제외) · OpenCode + WSL repo 거부(wsl-support의 규칙과 같은 문구).
- **FR-5.** 실행 기록은 **정기 실행마다 최근 50줄**만 남긴다 — `recordFire`가 같은 트랜잭션에서 오래된 것을 지운다. 매시간 도는 정기 실행이 1년이면 8,760줄이다.

## 3. 기능 요구사항

### (B) 주기

- **FR-6.** 주기의 모양 (`shared/scheduleTrigger.ts` — core가 검증·계산에, 렌더러가 편집·설명에 쓴다):

  ```ts
  type ScheduleTrigger =
    | { kind: 'daily'; time: string }                       // 'HH:MM'
    | { kind: 'weekdays'; time: string }                    // 월~금
    | { kind: 'weekly'; days: number[]; time: string }      // 0=일 … 6=토, 하나 이상
    | { kind: 'hourly'; everyHours: 1 | 2 | 3 | 4 | 6 | 8 | 12; minute: number }
    | { kind: 'cron'; expr: string }
  ```

  `toCron(trigger)`가 프리셋을 cron으로 바꾼다(`평일 09:00` → `0 9 * * 1-5`, `3시간마다 :15` → `15 */3 * * *`). **N시간마다는 24의 약수만이다** — `*/5`는 자정에 끊겨 마지막 간격이 4시간이 되므로 "5시간마다"라는 말이 거짓이 된다. `describeTrigger(trigger)`가 사람 말을 만든다(`평일 09:00`, `매주 월·수 09:00`, `3시간마다 :15`, cron은 식 그대로).
- **FR-7.** 검증 `validateTrigger(trigger, timeZone)`: 시각 `HH:MM`(00~23, 00~59) · 요일 0~6 중복 없음 · cron은 **공백으로 가른 필드가 정확히 5개**(croner는 초 필드 6개도 받지만 막는다 — 화면이 초를 말하지 않는다) · croner가 파싱하는가 · **최소 간격 10분** — 다음 20회차의 간격이 하나라도 10분보다 짧으면 거부한다(`*/5 * * * *`는 "5분마다 agent를 돌린다"이고 그것은 사용량 사고다, §8의 4). 오류는 한국어 한 문장이고 화면의 미리보기가 그대로 보인다.
- **FR-8.** 계산은 `core/schedules/clock.ts` 한 자리이고 croner를 아는 유일한 파일이다: `nextSlots(trigger, timeZone, after, count)` · `latestSlot(trigger, timeZone, after, until)`(after < s ≤ until인 가장 늦은 회차, 없으면 null). **cron의 일·요일은 표준(vixie) 뜻이다** — 둘 다 지정하면 OR(croner 10.0.1의 `domAndDow: false`, 기본값이지만 명시한다). `latestSlot`은 croner의 `previousRuns(1, until + 1ms)`(기준 시각 **미만**을 준다)가 준 회차가 `after`보다 클 때 그것이다 — 차례로 넘기지 않으므로 얼마나 오래 꺼 두었든 한 번의 계산이다. *(2026-11-02 개정 — 처음에는 다음 회차를 차례로 넘기고 10,000번에서 멈추게 썼다. plan 0단계 사전 확인이 `previousRuns`를 찾았다.)*
- **FR-9.** 렌더러는 계산하지 않는다. 편집 칸의 미리보기는 IPC `schedules.preview(trigger, timeZone)`가 `{ ok: true, next: number[3] } | { ok: false, error }`로 돌려준다 — 판정이 두 곳이면 화면이 받는 cron과 core가 받는 cron이 갈린다.

### (C) 스케줄러

- **FR-10.** 판정은 순수 함수 하나다 — `dueOf(schedule, now)`:
  - 꺼져 있으면 null.
  - `slot = latestSlot(trigger, timeZone, anchor_at, now)`. 없으면 null.
  - 있으면 `{ slotAt: slot, cause: now - slot > MISSED_GRACE_MS ? 'missed' : 'on_time' }`. `MISSED_GRACE_MS = 2분`(타이머 간격 30초 + 실행 지연의 여유).
- **FR-11.** **놓친 회차는 몇 개든 한 번이다.** `latestSlot`이 가장 늦은 것 하나만 주고, 처리하면 `anchor_at = slotAt`이 되므로 그 앞의 회차는 다시 오지 않는다. 앱을 켠 순간·절전에서 깬 뒤·평소의 타이머가 같은 함수다 — 따로 두지 않는다.
- **FR-12.** `anchor_at`이 바뀌는 자리:
  - 만들 때 · **켤 때** · **주기나 시간대를 고칠 때** → 그 순간의 `now`. 꺼 둔 동안이나 고치기 전의 주기로 지나간 회차가 켜자마자 돌면 안 된다.
  - 회차를 처리할 때(돌았든 건너뛰었든 실패했든) → `slotAt`. **`start`를 부르기 전에** 쓴다 — 실행 도중 앱이 죽어도 같은 회차를 다시 돌리지 않는다(많아야 한 번).
  - 이름·지시·맥락·조건만 고칠 때는 그대로다.
- **FR-13.** 타이머 (`core/schedules/scheduler.ts`): `createScheduler({ schedules, runs, execution, now, onError })`가 `tick()`·`start()`·`stop()`을 준다. `start()`는 30초 간격 타이머를 걸고(`unref`) **곧바로 한 번** `tick()`한다. `tick()`은 재진입하지 않는다(앞 tick이 `start`를 기다리는 중이면 이번 것은 건너뛴다). 정기 실행 하나의 처리가 던져도 나머지는 계속하고 오류는 `onError`로 간다. `now`와 간격(`tickMs`, 기본 30초)은 주입한다 — 단위 테스트는 시계를 돌리고, e2e는 main이 `ONE_DESK_SCHEDULE_TICK_MS`를 읽어 `CoreOptions.scheduleTickMs`로 넘겨 간격을 길게 해 **부팅 때의 한 번만** 돌게 한다(놓친 실행을 결정적으로 본다). *(2026-11-02 개정 — plan 0단계.)*
- **FR-14.** core 배선: `createCore`가 `runs.reapStale()` **뒤에** 스케줄러를 만들고 `start()`한다 — 앞이면 지난 실행의 running 행 때문에 "앞 실행이 돌고 있다"로 건너뛴다. `shutdown()`은 **맨 먼저** `stop()`한다 — 종료 중에 새 run을 띄우지 않는다. main은 `powerMonitor`의 `resume`에 `core.schedules.wake()`(= `tick()`)를 건다. IPC가 아니라 main의 이벤트이므로 핸들러 규칙과 무관하고, core는 electron을 모른다.
- **FR-15.** 회차 하나의 처리 (`fire(schedule, cause, slotAt)`), 순서가 곧 규칙이다:
  1. `slotAt`이 있으면 `anchor_at = slotAt` (FR-12).
  2. repo가 null이면 끄고(`repo_missing`) 기록 `error`("repo가 지워졌습니다"), 끝.
  3. **겹침**: 이 정기 실행의 마지막 `started` 기록의 run이 `pending`·`running`이면 → 기록 `skipped`/`busy`, 끝. `'continue'`면 그 대화에 도는 턴(`conversation.active`와 같은 판정)이 있어도 `busy`다 — 사람이 그 대화에 직접 보낸 턴도 센다.
  4. **답 기다림**(`'continue'`만): 그 대화의 대표 턴(`representativeTurn`)이 답변 필요면 → `skipped`/`needs_answer`, 끝.
  5. 맥락에서 지금 없는 항목을 뺀다(FR-17).
  6. 보낸다 — `'new'`이거나 `conversation_id`가 null이면 `execution.start`, 아니면 `execution.resume({ conversationId, … })`. `'continue'`의 첫 실행이면 돌아온 run의 뿌리 id를 `conversation_id`에 쓴다.
  7. 돌아오면 `started` + `run_id`, 던지면 `error` + 이유(연속 실패에 센다, FR-20).
- **FR-16.** 보내는 입력은 정의 그대로다: workspace · agent · 모델 · effort · 권한 · 지시 · 맥락, cwd는 **그 순간의** repo 경로, `timeoutMs = SCHEDULE_TIMEOUT_MS`(FR-19). `issueId`는 넘기지 않는다 — 맥락에 이슈가 하나면 평소처럼 자동 할당된다(conversation-issue FR-27). **`home.lastTarget`을 찍지 않는다** — 그것은 App이 사람의 전송에서만 찍는다(home spec FR-7). 이 기능은 App을 거치지 않으므로 따로 할 일이 없지만, 테스트로 고정한다.
- **FR-17.** 맥락은 **실행하는 그 시각의 것**이다. `execution.start`는 없는 항목을 받으면 던지므로(`collectContext`의 `assertFound`) 스케줄러가 미리 그 workspace에 남아 있는 것만 넘기고, 뺀 수를 `dropped_context`에 남긴다. 정의의 `context`는 고치지 않는다(사람이 열어 보고 정리한다 — 편집 칸이 지워진 항목을 `(지워짐)`으로 보인다).
- **FR-18.** 대화의 제목: `'new'`면 `<이름> · M/D HH:mm`(그 정기 실행의 시간대로, `'manual'`이면 실행한 시각), `'continue'`의 첫 실행이면 `<이름>`. 뿌리 행의 `title`(사용자가 붙인 이름 칸)에 쓴다 — 실행 서비스의 **내부** 인자 `start(input, { title })`이고 IPC의 `runs.start`는 그 인자를 받지 않는다. 사람이 이름을 바꾸면 그 이름이 이긴다.
- **FR-19.** 정기 실행의 턴은 **60분이 지나면 끝난다**(`SCHEDULE_TIMEOUT_MS`, 기존 `timeoutMs` 통로 — 타임아웃은 `failed`다). 사람 없이 매달린 run이 실행 슬롯을 영영 쥐면 사람의 실행까지 막힌다. `'continue'`의 다음 턴은 `resume`이 뿌리의 값을 이어받는다(execution.ts의 기존 규칙).
- **FR-20.** 연속 실패: core의 `onRunUpdate`가 끝난 run마다 `scheduler.onRunFinished(run)`을 부르고, 그 run을 `run_id`로 가진 기록이 있으면 판정한다 — `failed` → +1, `succeeded`(답변 필요 포함) → 0, `canceled`·`interrupted` → 그대로(사람이 멈췄거나 앱이 꺼졌다). 기록 `error`도 +1. **3이 되면 끈다**(`disabled_reason = 'failures'`). 다시 켜면 0과 null로 돌아간다. *(2026-11-02 구현 중 개정 — 처음 쓴 대로면 두 방향으로 틀렸다:)* **한 run은 한 번만 센다** — core는 확인함·보관 같은 후속 갱신에도 끝난 run으로 부르므로, 인박스에서 실패한 정기 실행 대화를 열기만 해도 같은 실패가 또 셌다. 판정할 때 `schedule_fire.judged_at`을 조건부 UPDATE로 찍고 처음일 때만 센다. 그리고 **시작 전에 실패한 run(실행 파일 없음 등)은 `start`가 돌아오기 전에 끝나** 그때의 `onRunFinished`는 기록을 못 찾는다 — 스케줄러가 기록을 쓴 직후 그 run이 이미 끝났으면 다시 판정한다(`judgeIfEnded`).
- **FR-21.** repo가 지워지면 core의 repo 지우기 경로가 그 workspace에서 repo가 null인 켜진 정기 실행을 끈다(`repo_missing`). 다음 회차의 FR-15-2도 같은 일을 한다 — 두 자리지만 판정은 "repo가 null"로 같다.
- **FR-22.** 정기 실행이 낸 턴에는 **이슈화 안내(`PROPOSE_ISSUE_GUIDE`)를 붙이지 않는다.** 판정 한 자리인 `shouldProposeIssue`에 조건 하나("정기 실행이 낸 턴")를 더하고, 실행 서비스의 내부 인자로 넘긴다. 매시간 새 대화를 만드는 정기 실행마다 배너가 서면 사람은 그 배너를 전부 눌러 치워야 한다(§8의 3). 사람이 그 대화에 직접 이어 보낸 턴은 평소대로다.
- **FR-23.** `지금 실행`은 `fire(schedule, 'manual', null)`이다 — `anchor_at`을 건드리지 않고(다음 정해진 회차는 그대로 돈다), 꺼져 있어도 돈다(시험용). 겹침·답 기다림이면 건너뛰는 대신 **오류로 돌려준다**(`앞 실행이 아직 돌고 있습니다`) — 사람이 누른 버튼이 말없이 아무것도 안 하면 안 된다. 기록에는 남기지 않는다.

### (D) IPC

- **FR-24.** `OneDeskClient.schedules` (`shared/client.ts`, 채널 `schedules:*`):

  | 메서드 | 돌려주는 것 |
  |---|---|
  | `list()` | `ScheduleView[]` — 모든 workspace. 정의 + `nextAt`(다음 회차, 꺼져 있으면 null) + `lastFire`(마지막 기록과 그 run의 상태) |
  | `create(input)` · `update(id, input)` | `ScheduleView` |
  | `setEnabled(id, enabled)` | `ScheduleView` |
  | `remove(id)` | `void` |
  | `runNow(id)` | `Run` |
  | `fires(id)` | `ScheduleFireView[]` 최신 순 — 기록 + run의 상태·뿌리 id |
  | `preview(trigger, timeZone)` | FR-9 |

  핸들러는 core 메서드 호출뿐이다. 쓰기는 바뀜 알림 `event:itemChanged`에 종류 `'schedule'`을 더해 알린다(`core/changes.ts`의 감싼 저장소 — 스케줄러가 쓰는 기록·끄기도 같은 래퍼를 탄다).
- **FR-25.** workspace를 넘는 읽기(`list`)는 `reports.build`·`home.summary`와 같이 **화면에만** 있다 — MCP `deps`에 정기 실행 저장소를 넘기지 않는다. `core/index.test.ts`의 소스 읽기 검사에 `schedules`를 더한다.

### (E) 화면

- **FR-26.** 사이드바: `리포트` 바로 아래 `정기 실행`(시계 아이콘, 배지 없음). `Sidebar`의 필수 prop `onSelectSchedules`·`schedulesActive`. 접힌 사이드바에도 타일로 선다. 제목 줄 가운데와 `document.title`이 `정기 실행`이다(ux-polish FR-6).
- **FR-27.** 화면 (`renderer/components/SchedulePanel.tsx`): 왼쪽 목록, 오른쪽 편집 칸 + 실행 기록. 목록은 workspace로 묶고(머리 `<workspace> 묶음`), 줄마다 이름 · `repo · 주기 설명` · 다음 실행(`내일 09:00` — 상대 날짜는 렌더러가 로컬로 쓴다) 또는 꺼진 이유 · 마지막 결과(상태 점) · 켜고 끄는 스위치. 비었으면 빈 상태 하나와 `새 정기 실행`.
- **FR-28.** 편집 칸은 위에서 아래로: 이름 · workspace · 작업 디렉토리 · agent · 모델(`ModelField`) · effort/variant · 권한 · 지시(여러 줄) · 맥락(그 workspace의 이슈·메모·asset을 고르는 목록, 지시 파일 제외) · 주기(프리셋 라디오 다섯 + 그에 맞는 칸 + 미리보기 `다음: 11/3 09:00 · 11/4 09:00 · 11/5 09:00`) · 대화 방식(`매번 새 대화` / `한 대화를 이어 감`). 새 정기 실행의 기본값은 실행 패널과 같은 함수(`renderer/runDefaults.ts`)가 그 workspace의 기본값에서 만든다. 권한 이름은 `renderer/permission.ts`, agent 이름은 `renderer/agents.ts`의 표다.
- **FR-29.** **전체 허용으로 "올릴 때"만** 경고 문장과 `ConfirmButton`(두 번 누르기)을 거쳐 저장한다 — workspace 실행 기본값 절과 같은 규칙과 같은 문구 결. 이미 전체 허용인 정기 실행에서 다른 것만 고칠 때는 묻지 않는다. 경고는 "사람이 보지 않는 시각에 셸 명령을 제한 없이 실행합니다"를 말한다.
- **FR-30.** `'continue'`에서 agent나 작업 디렉토리를 바꿔 저장하면 이어 가던 대화가 끊긴다 — 세션은 그 CLI·그 디렉토리의 것이라 이을 수 없다(execution.ts의 잠긴 값). 저장 전에 `다음 실행부터 새 대화로 시작합니다`를 보이고, core의 `update`가 `conversation_id`를 null로 만든다. 대화 방식을 `new`로 바꿔도 null이다.
- **FR-31.** 저장 버튼은 바뀐 것이 있을 때만 활성이다(ux-polish의 규칙). 초안은 `SchedulePanel`이 쥔다 — 목록에서 다른 것을 고르면 버린다(고친 것이 있으면 편집 칸 위에 `고친 것이 저장되지 않았습니다` 줄이 서고 `버리고 이동` · `계속 고치기` — 다른 줄을 누른 것이 첫 누름이라 `ConfirmButton`을 겹치지 않았다, 2026-11-02 구현). 편집 칸 아래에 `지금 실행`과 `삭제`(두 번 누르기).
- **FR-32.** 실행 기록: 최신 순으로 시각 · 사유(`정시` · `놓쳐서 실행` · `지금 실행`) · 결과 — `started`면 run 상태 알약과 `대화 열기`(App의 `openConversation`과 같은 길 — workspace 화면으로 가서 그 대화를 연다), `skipped`면 `앞 실행이 돌고 있어 건너뜀` / `답변을 기다리고 있어 건너뜀`, `error`면 이유. 뺀 맥락이 있으면 `지워진 맥락 N개는 빠졌습니다`.
- **FR-33.** 화면은 바뀜 알림 `schedule`(모든 workspace)과 run push(`onRunUpdate` — 마지막 결과의 점이 바뀐다)에 다시 읽는다. 다음 실행 시각의 상대 표현은 1분마다 다시 그린다(`useNow`).

## 4. 비기능 요구사항

- **NFR-1.** 세 경계: `core/`는 electron을 모른다(`powerMonitor`는 main), renderer는 core를 모른다, IPC 핸들러는 얇다. croner는 `core/schedules/clock.ts`만 import한다(grep으로 확인).
- **NFR-2.** MCP 경계 그대로(FR-25). 정기 실행의 run은 사람의 run과 같은 MCP 토큰·권한을 받는다 — 우회로가 없다.
- **NFR-3.** 생성하는 권한 설정에 `ask`가 없다는 기존 규칙을 건드리지 않는다. 정기 실행 전용 권한 정책을 만들지 않는다.
- **NFR-4.** 새 이름과 부분 일치 (e2e는 Playwright 부분 일치다):

  | 이름 | 확인한 충돌 |
  |---|---|
  | 사이드바 `정기 실행` | 버튼 `{ name: '실행' }`은 전부 exact, exact 아닌 넷은 설정의 `tab`(2026-11-02 grep) — 부딪히지 않는다. 이 화면에는 도크가 없다 |
  | `새 정기 실행` | 도크의 `{ name: '새 대화', exact: true }`와 무관 |
  | `지금 실행` | 같은 화면에 `실행` 버튼이 없다 |
  | 스위치 `<이름> 켜기` | `role="switch"` — 버튼 셀렉터에 걸리지 않는다 |
  | `<이름> 정기 실행 편집`(목록 줄) | **이름만으로 두지 않는다** — workspace 이름과 같은 정기 실행이면 사이드바 workspace 버튼과 부딪힌다(home NFR-3) |
  | `삭제` · `저장` | 편집 칸 안으로 좁혀 잡는다. 줄 끝 아이콘으로 두지 않는다 |
  | `대화 열기` | 인박스의 같은 이름 버튼과 한 화면에 서지 않는다 |
- **NFR-5.** 색은 `:root` 토큰, 아이콘은 `icons.tsx`(시계 하나 추가), 글꼴 크기는 rem(`DESIGN.md`).
- **NFR-6.** 타이머 하나의 비용: 30초마다 켜진 정기 실행 수만큼 `latestSlot` 한 번 — 평소에는 다음 회차 한 번 계산이다. 메인 프로세스를 막는 동기 I/O를 넣지 않는다(MCP 서버가 같은 프로세스다).
- **NFR-7.** 의존성 `croner` 10.0.1을 `dependencies`에 정확한 판으로 둔다(2026-02-01 공개 — 11.0.0은 2주가 안 됐다). 메인 번들에 들어가므로 렌더러 번들 크기와 무관하다.

## 5. 화면

```
사이드바                     정기 실행
 홈                          ┌ 회사 묶음 ─────────────────┐ ┌ 편집 ──────────────────────────┐
 인박스                      │ 아침 CI 훑기       ● ⏻     │ │ 이름  [아침 CI 훑기          ] │
 리포트                      │ api · 평일 09:00 · 내일 09:00│ │ workspace [회사] repo [api ▾] │
 정기 실행  ◀                │ 이슈 요약          ● ⏻     │ │ Claude Code · 모델 기본값 ·   │
                             │ web · 매일 18:00 · 오늘 18:00│ │ effort 기본값 · 읽기 전용     │
                             │ 의존성 확인        ○ ⏻     │ │ 지시 [어젯밤 실패한 CI를…    ] │
                             │ 연속 3번 실패해 꺼졌습니다   │ │ 맥락 □ 이슈 … □ 메모 …        │
                             └─────────────────────────────┘ │ 주기 ◉평일 ○매일 ○매주 ○N시간 ○cron│
                                                             │      [09:00]                    │
                                                             │ 다음: 11/3 09:00 · 11/4 · 11/5  │
                                                             │ 대화 ◉매번 새 대화 ○이어 감     │
                                                             │ [저장] [지금 실행]     [삭제]   │
                                                             │ ─ 실행 기록 ─                   │
                                                             │ 11/2 09:00 정시  완료 [대화 열기]│
                                                             │ 11/1 10:12 놓쳐서 실행 실패 …   │
                                                             └─────────────────────────────────┘
```

배치·간격은 plan의 실제 앱 캡처(라이트·다크, 1440×900과 1100×760)로 고른다.

## 6. 우려 (Areas of concern)

1. **앱이 떠 있어야 돈다.** 노트북을 덮어 두면 아침 09:00 정기 실행은 뚜껑을 연 순간 "놓쳐서 실행"으로 돈다. intent가 받아들인 대가다. 화면이 다음 실행 시각을 늘 보이고, 기록이 놓친 것을 말한다.
2. **사람 없는 전체 허용.** 확인 절차는 저장할 때 한 번이다. 지시가 MCP로 읽은 이슈 본문(남이 쓴 글일 수 있다)에 휘둘리면 사람이 없는 시각에 셸이 돈다. 기존 전체 허용과 같은 위험이지만 보는 사람이 없다는 점이 다르다 — 경고 문장이 그것을 말한다(FR-29).
3. **인박스가 찬다.** 매시간 새 대화면 하루 24줄이 인박스 목록에 오른다(배지에는 세지 않는다). 1차는 평소 규칙 그대로다 — 써 보고 넘치면 "정기 실행의 성공은 인박스에 올리지 않는다"를 따로 정한다. 그것은 `INBOX_RULES`가 아니라 소속 판정을 바꾸는 일이라 이 spec에서 하지 않는다.
4. **도크 목록도 찬다.** `'new'`의 대화는 끝내지 않으면 도크 목록에 쌓인다. 1차는 손으로 끝낸다. 자동으로 끝내는 규칙(성공하면 끝냄)은 §8의 2.
5. **시계가 거꾸로 가면.** 사용자가 시스템 시계를 뒤로 돌리면 `anchor_at`이 미래라 그 사이 회차가 돌지 않는다. 앞으로 돌리면 놓친 것처럼 한 번 돈다. 둘 다 "많아야 한 번"을 깨지 않으므로 받아들인다.
6. **세션을 이을 수 없으면 매 회차가 실패한다.** `'continue'`의 대화가 세션 없이 끝났으면(첫 턴이 시작 전에 실패) `resume`이 실패하고, 세 번이면 꺼진다. 꺼진 이유를 보고 사람이 대화 방식을 바꾸거나 다시 켠다 — 저절로 새 대화로 갈아타지 않는다(무엇이 이어지는지 사람이 모르게 된다).
7. **앱을 켠 순간 몰려 돈다.** 정기 실행이 여럿이면 켜자마자 전부 돈다. 동시 실행 상한과 대기열이 그대로 받는다 — 사람이 바로 보내는 지시는 그 뒤에 선다. 늦춰 시작하는 규칙은 1차에 없다.

## 7. 검증

- **단위**
  - `shared/scheduleTrigger.test.ts` — 프리셋 다섯의 `toCron`·`describeTrigger`, N시간이 24의 약수가 아니면 거부, 요일 빈 목록·중복 거부. (core 프로젝트가 `shared/**/*.test.ts`를 잡는다 — `vitest.config.ts` 19)
  - `core/schedules/clock.test.ts` — 5필드만(`@daily`·초 필드 거부) · 최소 간격 10분 · `Asia/Seoul`과 DST가 있는 `America/New_York`에서 `nextSlots` · 일·요일 OR · `latestSlot`이 여러 회차 중 가장 늦은 것 하나 · 정확히 회차 시각인 `until`을 포함한다 · 100일 꺼 둔 뒤에도 한 번의 계산.
  - `core/schedules/due.test.ts` — 꺼짐 · 회차 없음 · 정시 · 2분 넘으면 놓침 · 이틀 꺼 두어도 한 번.
  - `core/db/repositories/schedule.test.ts` — 만들기·고치기 검증 · `update`가 스케줄러 컬럼을 안 덮는다 · repo를 지우면 `repo_id`가 null(외래키) · workspace를 지우면 둘 다 사라진다 · 기록 50줄 상한 · 주기를 고치면 `anchor_at`이 그 순간 · agent·repo를 바꾸면(`continue`) `conversation_id`가 null.
  - `core/schedules/scheduler.test.ts` (가짜 시계, 가짜 execution) — FR-15의 순서 각각 · **`anchor_at`을 `start` 전에 쓴다**(start가 던져도 같은 회차를 다시 안 돈다) · 겹침 건너뛰기(`new`·`continue` 둘 다, 사람이 보낸 턴 포함) · 답 기다림 건너뛰기 · 지워진 맥락을 빼고 수를 남긴다 · `continue` 첫 실행이 `conversation_id`를 쓰고 둘째가 `resume` · 연속 실패 3번에 끈다 · `canceled`·`interrupted`는 세지 않는다 · 다시 켜면 0 · tick 재진입 없음 · 하나가 던져도 나머지는 돈다 · `지금 실행`이 anchor를 안 건드리고 겹침이면 던진다.
  - `core/execution.test.ts` — 내부 인자 `title`이 뿌리에 쓰인다 · 정기 실행 턴에는 이슈화 안내가 없다 · IPC 입력 모양(`StartRunInput`)은 그대로다.
  - `core/index.test.ts` — `reapStale` 뒤에 스케줄러가 돈다(지난 실행의 running 행이 겹침으로 잡히지 않는다) · `shutdown`이 타이머를 멈춘다 · repo를 지우면 끈다 · MCP `deps`에 schedules가 없다(소스 읽기) · `home.lastTarget`이 그대로다.
  - `renderer/components/SchedulePanel.test.tsx` — 빈 상태 · 묶음 · 전체 허용으로 올릴 때만 두 번 누르기 · 바뀐 것이 없으면 저장 잠김 · `continue`에서 agent를 바꾸면 안내 · 미리보기 오류가 보인다 · 기록의 세 결과.
  - `renderer/App.test.tsx` · `Sidebar.test.tsx` — 사이드바 `정기 실행`이 화면을 연다 · 제목 줄이 `정기 실행` · 기록의 `대화 열기`가 그 workspace의 그 대화를 연다(App이 내리는 prop 한 줄마다 — CLAUDE.md 컨벤션).
- **회귀 테스트는 대상 줄을 잠시 망가뜨려 실패를 본다** — plan이 변이 표를 둔다. 특히 FR-12의 순서(start 전 anchor), FR-11(한 번), FR-14(reapStale 뒤·shutdown 맨 앞), FR-20의 `canceled` 제외, FR-22, FR-29, App 배선.
- **e2e** (`e2e/schedule.e2e.ts`, 가짜 CLI): 사이드바 → 새 정기 실행 → 평일 09:00 · 읽기 전용 · 이슈 하나 담기 → 미리보기 세 시각 → 저장 → `지금 실행` → 기록에 `지금 실행` 줄 → `대화 열기`가 도크의 그 대화(제목 `<이름> · …`) → 앱을 닫고 main의 SQL로 `anchor_at`을 이틀 전으로 돌린 뒤 같은 데이터 폴더로 다시 켠다 → **기록이 `놓쳐서 실행` 한 줄 늘어난다**(두 줄이 아니다). 전체 허용으로 올리면 두 번 눌러야 저장된다. IPC 왕복을 실제로 탄다. 같은 데이터 폴더로 다시 켜는 드라이버 기능이 없으면 plan이 더한다.
- 실제 앱 캡처(라이트·다크): 목록 + 편집 칸 + 기록, 꺼진 정기 실행, 빈 상태.
- `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm test:e2e` 전부 통과. 기존 DB를 열어 `0013`이 한 번 돌고 기존 화면이 그대로다.

## 8. 사용자가 뒤집을 수 있는 결정

1. **놓친 실행이 판정되는 2분**(FR-10). 정시와 놓침을 가르는 말일 뿐 동작은 같다.
2. **`'new'`의 대화를 저절로 끝내지 않는다**(§6 우려 4). 대안: 성공(답변 필요 아님)으로 끝나면 그 대화를 끝낸다 — 도크는 깨끗하고 인박스·리포트에는 남는다.
3. **정기 실행 턴에는 이슈화 안내를 붙이지 않는다**(FR-22). 대안: 평소대로 붙인다.
4. **최소 간격 10분**(FR-7). 대안: 5분, 30분, 제한 없음.
5. **실행 시간 상한 60분 고정**(FR-19). 대안: 등록마다 고르기.
6. **연속 실패 3번에 끈다**(FR-20). 대안: 5번, 끄지 않기.
7. **`지금 실행`은 꺼진 정기 실행에서도 돈다**(FR-23). 대안: 켜진 것만.
8. **사이드바에 배지가 없다**(FR-26). 대안: 저절로 꺼진 정기 실행이 있으면 `!`.
9. **편집 칸에 `/`·`@` 피커가 없다**(§1). 글자로 쓰면 실행 때 해석된다. 대안: 실행 패널의 입력칸을 재사용.
