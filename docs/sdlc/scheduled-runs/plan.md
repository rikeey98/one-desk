# Plan: 정기 실행

- 출처: `spec.md` (승인됨 2026-11-02)
- 작성자: 권용현 (초안: Claude)
- 상태: **초안 — 승인 대기**. 뒤집을 수 있는 결정은 spec §8이다. 0단계의 확인이 spec과 다르게 나오면 구현을 멈추고 spec을 먼저 고친다.
- 작성일: 2026-11-02
- 작업 자리: worktree `.claude/worktrees/scheduled-runs` (브랜치 `claude/confident-sagan-j55gsg`)

## 0단계 사전 확인 (2026-11-02, plan을 쓰며 — croner 10.0.1을 받아 node로 실측)

| 확인 | 결과 | 반영 |
|---|---|---|
| 판의 나이 | 10.0.1은 2026-02-01, 11.0.0은 2026-10-26(2주 미만) | 10.0.1로 고정 (spec NFR-7 그대로) |
| 이전 회차 | `previousRuns(n, ref)`가 있고 **ref 미만**을 준다 — 평일 09:00에서 ref가 정확히 월 09:00이면 금·목을 준다 | spec FR-8 개정: 차례로 넘기는 대신 `previousRuns(1, until + 1)` |
| 다음 회차 | `nextRuns(n, ref)`도 ref **초과**다 | `nextSlots`가 그대로 쓴다 |
| 일·요일 | 기본 `domAndDow: false` = OR. `0 9 1 * 5`가 금요일들과 12/1을 준다(true면 2027-01-01부터 "1일이면서 금요일") | 명시해서 넘긴다 |
| 시간대·DST | `America/New_York` `30 2 * * *`의 DST 시작일(없는 02:30)은 03:30 EDT로 민다. 잘못된 시간대는 **계산할 때** 던진다(만들 때는 안 던진다) | 시간대는 `Intl.DateTimeFormat`으로 먼저 검증한다(FR-4) |
| 받는 형식 | 초 필드 6개·`@daily`·`L`·`MON`을 받는다. `0 25 * * *`는 던진다 | 5필드 검사가 6필드·`@daily`를 막는다. `L`·`MON`은 둔다 |
| e2e 결정성 | 드라이버에 `relaunch()`가 있다(`e2e/driver.ts` 194). main SQL은 `e2e/home.e2e.ts`의 `runSql` 모양 | spec FR-13 개정: 간격을 env로 늘려 부팅 tick만 돌게 |

## 순서

각 단계는 테스트를 먼저 쓰고 빨간 것을 본 뒤 구현한다. 회귀 테스트는 대상 줄을 망가뜨려 빨개지는지 본다(아래 "변이"). 한 단계가 끝날 때
`pnpm typecheck`와 그 단계의 테스트 파일이 초록이다. 순수 함수 → 저장소 → 실행 서비스 → 스케줄러 → core 배선 → IPC → 화면 → e2e 순이다.

0. **기준선** — worktree에 `pnpm install`(postinstall의 electron-rebuild 포함). `pnpm typecheck` · `pnpm lint` · `pnpm test` 초록, `pnpm test:e2e`
   통과 수와 시간을 적는다. `e2e/`·`renderer/`에서 `정기`·`지금 실행`·`켜기`·`편집`을 grep해 spec NFR-4의 표를 다시 확인한다.
1. **주기 모양** (spec FR-6) — `shared/scheduleTrigger.ts`: `ScheduleTrigger` 타입, `HOURLY_STEPS = [1,2,3,4,6,8,12]`, `toCron`, `describeTrigger`,
   모양 검사 `checkTriggerShape`(시각·요일·N·분 — croner 없이 하는 것만). `shared/scheduleTrigger.test.ts`: 다섯 프리셋의 cron과 설명, 5시간·빈 요일·
   중복 요일·`24:00` 거부.
2. **계산** (spec FR-7·8·10) — `pnpm add croner@10.0.1`(정확한 판, `dependencies`). `core/schedules/clock.ts`(croner를 import하는 유일한 파일):
   `validateTrigger(trigger, timeZone)`(모양 → 시간대 → 5필드 → 파싱 → 다음 20회차 간격 ≥ 10분), `nextSlots`, `latestSlot`. `core/schedules/due.ts`:
   `dueOf(schedule, now)`·`MISSED_GRACE_MS`. 테스트는 spec §7의 둘. 시계는 고정 epoch만 쓴다(장비 시간대에 기대지 않는다).
3. **테이블과 저장소** (spec FR-1~5) — `core/db/schema.ts`에 `schedule`·`schedule_fire`. `pnpm db:generate` → `drizzle/0013_*.sql`을 **읽는다**:
   `CREATE TABLE` 둘과 `CREATE INDEX`만 있고 `DROP`·기존 테이블 재생성이 없어야 한다(`repo_id`의 `ON DELETE set null` 확인).
   `shared/models.ts`에 `Schedule`·`ScheduleInput`·`ScheduleFire`·`ScheduleView`·`ScheduleFireView`, `ItemChange['kind']`에 `'schedule'`.
   `core/schedules/input.ts`의 `validateScheduleInput(db, input)`(FR-4 — 주기는 2단계의 `validateTrigger`). `core/db/repositories/schedule.ts`:
   `list()` · `get(id)` · `create(input, now)` · `update(id, input, now)`(주기·시간대가 바뀌면 `anchor_at = now`, `continue`에서 agent·repo가 바뀌거나
   `new`로 바뀌면 `conversation_id = null`) · `setEnabled(id, enabled, now)`(켜면 `anchor_at = now`·실패 0·이유 null) · `remove(id)` ·
   `markHandled(id, slotAt)` · `setConversation(id, rootRunId)` · `recordFire(fire)`(50줄 상한, 같은 트랜잭션) · `lastStarted(id)` · `fireByRun(runId)` ·
   `setFailures(id, n)` · `disable(id, reason)` · `disableMissingRepo(workspaceId)` · `fires(id)`. 테스트는 spec §7의 저장소 항목 + **`update`가 스케줄러
   컬럼(`anchor_at`·`consecutive_failures`·`conversation_id`의 스케줄러 쓰기)을 덮지 않는다**. 기존 DB 위에서 `0013`이 도는 것은 `core/db/open.test.ts`의
   모양을 따른다. 테스트가 연 DB는 `$client.close()`.
4. **실행 서비스의 내부 인자** (spec FR-18·22) — `CreateRunInput.title?`(뿌리 행만 — `parentRunId`와 같이 오면 던진다), `LaunchSpec`에 `title`·`origin:
   'user' | 'schedule'`, `start(input, internal?: { title?: string; origin?: 'schedule' })`·`resume`도 같은 두 번째 인자. `ProposeIssueInput`에
   `fromSchedule: boolean`(필수 — `shouldProposeIssue`의 조건 하나). `electron/ipc/runs.ts`는 첫 인자만 넘긴다(바꾸지 않는다). 테스트: spec §7의
   `execution.test` 셋, `guide.test`에 조건 하나.
5. **스케줄러** (spec FR-11~23) — `core/schedules/scheduler.ts`의 `createScheduler({ schedules, runs, repos, execution, now, tickMs, onError,
   onChanged })`: `start`·`stop`·`tick`·`wake`·`runNow(id)`·`onRunFinished(run)`. 컨텍스트 거름은 그 workspace의 issue·memo·asset id 집합으로(지시 파일은
   저장할 때 이미 막았다). 제목은 `Intl.DateTimeFormat('ko-KR', { timeZone })`로 `M/D HH:mm`. `SCHEDULE_TIMEOUT_MS = 60 * 60_000`,
   `MAX_CONSECUTIVE_FAILURES = 3`. `scheduler.test.ts`: spec §7의 항목 전부 — 가짜 execution은 `start`·`resume` 호출을 기록하고 run을 돌려주거나 던지고,
   가짜 시계로 `tick`을 직접 부른다(타이머를 쓰지 않는다). 타이머 자체는 `vi.useFakeTimers`로 "start가 곧바로 한 번, 그 뒤 tickMs마다"와 "stop 뒤 없음"
   하나씩.
6. **core 배선** (spec FR-14·16·20·21·24·25) — `core/changes.ts`의 `notifyingSchedules`(쓰기마다 `{ workspaceId, kind: 'schedule' }`).
   `core/index.ts`: `CoreOptions.scheduleTickMs?` · `runs.reapStale()` **뒤**에 스케줄러를 만들고 `start()` · `onRunUpdate`의 끝난 run 갈래에서
   `scheduler.onRunFinished(run)` · `repos.remove`에 `disableMissingRepo` · `shutdown()` 맨 앞에 `scheduler.stop()` · 표면 `schedules: { list, create, update,
   setEnabled, remove, runNow, fires, preview, wake }`(`list`가 `nextAt`·`lastFire`를 붙인다). MCP `deps`에는 넣지 않는다.
   `core/index.test.ts`: spec §7의 다섯 + "부팅 tick이 놓친 회차를 한 번 돌린다"(DB에 `anchor_at`을 이틀 전으로 넣고 core를 다시 연다).
7. **IPC** (spec FR-24) — `shared/channels.ts`에 `schedules:*` 여덟, `shared/client.ts`의 `schedules`, `electron/preload.ts`, `electron/ipc/schedules.ts`(한 줄씩),
   `electron/ipc/index.ts` 등록. `electron/main.ts`: `scheduleTickMs`를 `ONE_DESK_SCHEDULE_TICK_MS`에서(숫자가 아니면 무시), app ready 뒤
   `powerMonitor.on('resume', () => core.schedules.wake())`. 경계 grep 둘(CLAUDE.md).
8. **화면의 순수 함수** — `renderer/schedules/`: `form.ts`(초안 ↔ `ScheduleInput`, 기본값은 `runDefaults.ts`의 함수, `isDirty`), `permissionRaise.ts`(전체
   허용으로 올리는가 — 처음 만들 때 full이면 올리는 것이다), `labels.ts`(사유·건너뜀·결과 문구, 다음 실행의 상대 표현 `오늘 18:00`·`내일 09:00`·`11/5(수)
   09:00`). 각 테스트.
9. **화면** (spec FR-26~33) — `IconClock`(`icons.tsx`). `renderer/hooks/useSchedules.ts`(바뀜 알림 `schedule`을 workspace 없이 — `useItemChanged(null,
   'schedule', …)`, `onRunUpdate`에 다시 읽기). `SchedulePanel.tsx`(목록·초안 state·선택 바꾸기 확인) · `ScheduleForm.tsx`(state 없이 그리기만 —
   SettingsPanel의 규칙: 초안을 자식에 내리지 않는다) · `ScheduleFires.tsx`. `Sidebar`의 필수 prop `onSelectSchedules`, `view` 타입에 `'schedules'`. `App`:
   `view === 'schedules'`, 제목 줄 `정기 실행`, `onOpenConversation={openReportConversation}`(리포트와 같은 길). CSS는 토큰만. 테스트: spec §7의
   SchedulePanel·App·Sidebar 항목. 가짜 클라이언트에 `schedules`를 세운다(`App.test`의 공용 가짜).
10. **e2e** (spec §7) — `e2e/schedule.e2e.ts`. `launchApp({ env: { ONE_DESK_SCHEDULE_TICK_MS: '3600000' } })` — 부팅 tick 하나만 돈다. 시나리오: 만들기 →
    미리보기 세 시각 → 저장 → `지금 실행` → 기록 한 줄 → `대화 열기` → 도크의 제목이 `<이름> · …` → 정기 실행 화면으로 돌아와 `runSql`로 `anchor_at`을
    이틀 전으로 → `relaunch()` → 기록이 정확히 한 줄 늘고 `놓쳐서 실행`. 둘째 테스트: 전체 허용으로 올리면 첫 누름은 저장하지 않고 둘째가 저장한다.
11. **캡처와 문서** — 실제 앱 캡처(라이트·다크 × 1440×900·1100×760: 목록 + 편집 + 기록, 꺼진 정기 실행, 빈 상태). CLAUDE.md의 현재 상태에 절 하나와
    함정 절(아래 "위험"에서 실제로 밟은 것), 문서 표에 이 폴더. `docs/backlog.md`에 spec §6 우려 3·4.
12. **완료 증명** — `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm test:e2e` 전부, 경계 grep 둘, `grep -rn "from 'croner'" core/ renderer/ shared/
    electron/`이 `core/schedules/clock.ts` 하나, 아래 변이 표의 결과, 기존 DB를 복사해 연 `0013` 한 번.

## 바뀌는 파일

| 자리 | 파일 |
|---|---|
| 새 파일 | `shared/scheduleTrigger.ts`(+test) · `core/schedules/{clock,due,input,scheduler}.ts`(+test) · `core/db/repositories/schedule.ts`(+test) · `drizzle/0013_*.sql` · `electron/ipc/schedules.ts` · `renderer/schedules/{form,permissionRaise,labels}.ts`(+test) · `renderer/hooks/useSchedules.ts` · `renderer/components/{SchedulePanel,ScheduleForm,ScheduleFires}.tsx`(+test) · `e2e/schedule.e2e.ts` |
| 고치는 파일 | `package.json`·`pnpm-lock.yaml`(croner) · `core/db/schema.ts` · `shared/models.ts` · `shared/channels.ts` · `shared/client.ts` · `core/changes.ts` · `core/index.ts`(+test) · `core/execution.ts`(+test) · `core/db/repositories/run.ts`(`CreateRunInput.title`) · `core/proposals/guide.ts`(+test) · `electron/preload.ts` · `electron/ipc/index.ts` · `electron/main.ts` · `renderer/components/{Sidebar,icons}.tsx` · `renderer/App.tsx`(+test) · `renderer/index.css` · 가짜 클라이언트가 있는 테스트들 · `CLAUDE.md` |
| 건드리지 않는 것 | `core/runner/**`(큐·manager·어댑터·권한) · `core/mcp/**` · `shared/inbox.ts` · 인박스·도크·홈 컴포넌트 |

## 변이 (되돌려 빨개지는지 볼 것)

| # | 망가뜨릴 줄 | 빨개져야 할 테스트 |
|---|---|---|
| 1 | `fire`에서 `markHandled`를 `start` **뒤**로 | scheduler "start가 던져도 같은 회차를 다시 돌리지 않는다" |
| 2 | `latestSlot` 대신 `anchor_at` 다음 첫 회차 | due "이틀 꺼 두어도 한 번", index "부팅 tick이 놓친 회차를 한 번" |
| 3 | `createCore`에서 스케줄러 `start()`를 `reapStale()` 앞으로 | index "지난 실행의 running 행이 겹침으로 잡히지 않는다" |
| 4 | `shutdown()`의 `scheduler.stop()` 삭제 | index "shutdown 뒤 tick이 run을 만들지 않는다" |
| 5 | `onRunFinished`가 `canceled`도 실패로 셈 | scheduler "canceled·interrupted는 세지 않는다" |
| 6 | `shouldProposeIssue`의 `fromSchedule` 조건 삭제 | guide·execution "정기 실행 턴에는 안내가 없다" |
| 7 | `update`가 주기를 바꿔도 `anchor_at`을 두는 것 | schedule 저장소 "주기를 고치면 anchor가 그 순간" |
| 8 | `update`가 agent를 바꿔도 `conversation_id`를 두는 것 | schedule 저장소, SchedulePanel 안내 |
| 9 | `update`가 스케줄러 컬럼까지 쓰는 것 | schedule 저장소 "update가 스케줄러 컬럼을 덮지 않는다" |
| 10 | `recordFire`의 50줄 정리 삭제 | schedule 저장소 "50줄 상한" |
| 11 | `validateTrigger`의 최소 간격 검사 삭제 | clock "10분보다 잦으면 거부" |
| 12 | `runNow`가 `markHandled`를 부름 | scheduler "지금 실행은 anchor를 건드리지 않는다" |
| 13 | `repos.remove`의 `disableMissingRepo` 삭제 | index "repo를 지우면 끈다" |
| 14 | MCP `deps`에 schedules 추가 | index의 소스 읽기 검사 |
| 15 | `permissionRaise`가 늘 참 / 늘 거짓 | SchedulePanel "이미 전체 허용이면 묻지 않는다" / "올릴 때 두 번" |
| 16 | App의 `onSelectSchedules` 한 줄 / `onOpenConversation` 한 줄 | App "사이드바가 정기 실행을 연다" / "기록의 대화 열기가 그 대화를 연다" |
| 17 | 겹침 판정에서 `continue`의 사람이 보낸 턴을 빼는 것 | scheduler "이어 가는 대화에 사람이 보낸 턴이 돌면 건너뛴다" |

## 위험

1. **croner의 ESM/CJS와 두 번들.** main은 `"type": "module"`이고 `externalizeDepsPlugin`이 `dependencies`를 밖에 둔다 — 패키징된 앱이 croner를
   node_modules에서 연다. 7단계 뒤 `pnpm run pack`(linux)으로 띄워 정기 실행 화면의 미리보기가 나오는지 본다(리눅스 패키지는 그대로 컨테이너에서 확인).
2. **core 테스트의 타이머.** `createCore`가 부팅마다 `setInterval`을 건다 — `unref`라 프로세스를 붙잡지 않지만, `shutdown`을 부르지 않는 기존 테스트가
   많다. 정기 실행이 없으면 tick은 빈 목록이라 비용이 없다. 거슬리면 core 테스트의 `open()`이 `scheduleTickMs`를 크게 넘긴다.
3. **부팅 tick과 창.** 부팅 tick이 띄운 run의 push는 창이 뜨기 전에 나갈 수 있다. 화면은 마운트할 때 목록을 읽으므로 잃는 것이 없다 — e2e가 부팅 뒤
   기록 한 줄로 본다.
4. **`anchor_at` 쓰기와 사람의 저장이 겹침.** 저장소가 컬럼을 나눠 쓰는 것으로 막는다(3단계의 테스트). 같은 행의 두 UPDATE는 better-sqlite3가 직렬로
   돌린다(동기 API).
5. **workspace를 넘는 목록의 비용.** `list()`가 정기 실행마다 `nextAt`(croner 한 번)과 마지막 기록·run 상태를 붙인다 — 수십 개면 무시할 만하다. 백 개를
   넘기는 사용은 보지 않는다.
6. **e2e의 시간대.** 미리보기 문구가 장비 시간대를 탄다 — e2e는 "세 시각이 보인다"(개수)와 "평일 09:00" 설명만 보고 날짜 글자를 박지 않는다.

## 구현하며 달라진 것

(구현 때 채운다)

## 완료 증명

(구현 때 채운다 — 기준선 대비 테스트 수, 변이 결과, 캡처, 번들 크기)
