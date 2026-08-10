# 3a단계 설계 — 동시 실행 큐와 재시작 복구

## 1. 목표

이슈 여러 개를 연달아 던져도 머신이 멎지 않게 하고, 앱이 죽었다 다시 떠도 run이 `running`인 채로 방치되지 않게 한다.

전체 설계(`2026-08-07-one-desk-design.md`) §13의 3단계를 둘로 쪼갠 앞쪽이다. 3b(인박스·배지·후속 행동·이어서 실행)는 이 문서가 만드는 `pending`·`interrupted` 상태 위에 얹힌다.

**3a가 끝나면 인박스가 없어도 그 자체로 쓸 만한 상태여야 한다.**

## 2. 범위

**포함**

- 전역 동시 실행 상한과 FIFO 대기 큐 (`core/runner/queue.ts`)
- 상한값을 `app_setting`에 저장하고 도크에서 조절
- 재시작 복구 — `running` → `interrupted`, `pending` → `canceled`
- 도크의 전역 슬롯 표시기
- 대기 중인 run 취소

**제외**

- 인박스, 사이드바 배지, 상태별 후속 행동, 세션 이어서 실행 → **3b**
- diff 뷰어와 `run_file_change` → **5단계** (전체 설계 §13)
- 자율 실행 / 스케줄러 → 전체 설계 §14

## 3. 정해진 것

브레인스토밍에서 사용자가 정한 결정들이다. 구현 중에 임의로 뒤집지 않는다.

| 결정 | 내용 |
|---|---|
| 3단계를 3a/3b로 분리 | 설계 §13이 둘을 묶은 것은 가치 전달 단위이지 스펙 크기 단위가 아니다 |
| 재시작 시 자동 시작하지 않는다 | `pending`은 `canceled`로 내린다 |
| 전역 슬롯 표시기를 도크에 둔다 | 상한이 전역인데 도크는 workspace별이라 생기는 공백을 메운다 |
| 상한은 슬롯 표시기에서 바로 바꾼다 | 설정 화면을 따로 만들지 않는다 |
| 큐는 `RunQueue`로 분리한다 | §10에 근거를 적었다 |

### 재시작 시 자동 시작하지 않는 이유

큐에 남은 run을 앱이 뜨자마자 시작하면 두 가지가 어긋난다.

사용자가 화면을 보기도 전에 agent 프로세스가 파일을 고치기 시작한다. 그것은 전체 설계 §14가 "이번 스펙 제외"로 미뤄둔 **자율 실행**을 슬쩍 들여오는 것이다. 앱을 여는 행위가 agent 실행을 부르지 않는다는 성질은 지켜야 한다.

그리고 `pending` run은 조립이 끝난 프롬프트를 이미 들고 있다. 그 사이 이슈나 메모가 바뀌었어도 옛 프롬프트로 돈다. 사용자가 인박스에서 보고 다시 돌리면 그 시점 맥락으로 새로 조립된다.

## 4. 아키텍처 — `core/runner/queue.ts`

```ts
createRunQueue({ limit, onStart })

enqueue(runId: string): void      // 슬롯이 있으면 onStart를 동기로 부른다. 없으면 FIFO 뒤에 붙인다
release(runId: string): void      // 슬롯 반납. 대기 중인 다음 것을 꺼낸다
remove(runId: string): boolean    // 대기 중인 것을 뺀다. 이미 실행 중이면 false
setLimit(n: number): void         // 상한 변경
snapshot(): QueueSnapshot         // { running, limit, waiting }
```

**DB도 프로세스도 모른다.** id 문자열과 숫자만 다룬다. 그래서 상한·FIFO·재진입을 프로세스 하나 띄우지 않고 결정적으로 테스트할 수 있다.

`RunManager`는 순수한 프로세스 관리자로 남는다. 다만 `manager.ts`의 `if (active.size > 0) throw`는 2단계의 "한 번에 하나" 제약이므로 의미가 바뀐다 — `active.has(spec.runId)`로 좁혀 **같은 run을 두 번 띄우려는 것**만 막는 방어선으로 남긴다.

### 계약 1 — `onStart`를 부르는 순간 슬롯은 점유된 것으로 센다

실제 spawn을 기다렸다가 세면 그 사이 들어온 `enqueue`가 상한을 넘긴다.

따라서 **성공하든 실패하든 반드시 `release`가 불려야 한다.** 한 번 빠뜨리면 슬롯이 영구히 줄고, 증상은 "언젠가부터 2개까지만 돈다"로 나타나 원인을 찾기 어렵다. 이 설계의 급소다.

### 계약 2 — 슬롯이 남아 있으면 `enqueue`는 `onStart`를 동기로 부른다

`markStarted`가 동기 DB 쓰기이므로, 이렇게 해야 `execution.start()`가 지금처럼 `running` run을 돌려주고 도크 탭이 즉시 뜬다.

비동기로 미루면 **이미 고정해 둔 두 가지가 깨진다** — `core/execution.test.ts`의 비차단 계약 테스트와 `e2e/core-loop.e2e.ts`의 7번 단언(실행을 누르면 running 탭이 곧바로 뜬다)이다.

### 소유와 초기화

`RunQueue` 인스턴스는 `createCore`가 만들어 `ExecutionService`에 넘긴다. `RunManager`와 같은 층위다.

초기 상한은 `createCore`가 `app_setting`에서 읽고, 값이 없거나 §9의 검증을 통과하지 못하면 3으로 시작한다.

`QueueSnapshot` 타입은 `shared/models.ts`에 둔다. 렌더러와 core가 함께 쓴다.

## 5. 상태 전이

```
create(pending) → notify
  preflight 실패 → markFinished(failed) → notify        [큐에 들어가지 않는다]
  preflight 성공 → queue.enqueue(runId)
      슬롯 있음 → onStart → markStarted → notify → manager.start(...)
      슬롯 없음 → pending으로 대기 (도크에 pending 칩)
manager 종료 → markFinished → notify → queue.release(runId)
취소(대기 중) → queue.remove → markFinished(canceled) → notify
취소(실행 중) → manager.cancel (기존 경로)
```

**preflight는 큐에 넣기 전에 둔다.** 실행 파일이 없는 run이 슬롯을 잡았다 놓는 낭비가 없고, 지금의 "preflight 실패는 `startedAt`이 null"이라는 성질도 그대로다.

`pending` run은 도크에 **코드 변경 없이** 대기 칩으로 나타난다. 도크는 이미 run마다 `status-${run.status}` 칩을 그리고 있다. CSS에 `.status-pending` 규칙이 있는지만 확인하면 된다.

### `start()`가 돌려주는 것

슬롯이 있으면 지금처럼 `running` run을, 큐에 들어가면 `pending` run을 돌려준다. 어느 쪽이든 **완료를 기다리지 않는다**는 계약은 그대로다.

`shared/client.ts`의 주석 `/** 완료를 기다리지 않는다. running 상태의 run이 곧바로 돌아온다. */`는 이제 정확하지 않다. 함께 고친다 — 이 저장소는 코드보다 더 많이 주장하는 주석에 이미 두 번 시간을 썼다.

### 취소

`execution`의 `cancel`은 현재 `opts.manager.cancel`을 그대로 노출한다. 대기 중인 run은 프로세스가 없어 `cancels` 맵에 항목이 없으므로 **지금 구조로는 아무 일도 일어나지 않는다.**

`cancel(runId)`이 먼저 `queue.remove(runId)`를 시도하고, 성공하면 `markFinished(canceled)`로 끝낸다. 실패하면(이미 실행 중) 기존 `manager.cancel` 경로로 간다.

## 6. 재시작 복구

`createCore`가 DB를 열고 마이그레이션한 직후, **다른 무엇도 run을 시작하기 전에** 한 트랜잭션으로 처리한다.

- `running` → `interrupted`
- `pending` → `canceled`
- 둘 다 `endedAt`을 채우고 `errorMessage`에 이유를 남긴다

`electron/main.ts`가 아니라 `core`가 하는 이유는, 나중에 `core`를 별도 데몬으로 뗄 때 복구가 따라가야 하기 때문이다(전체 설계 §4 규칙 1).

**여기서 아무것도 자동으로 시작하지 않는다.** §3에 근거를 적었다.

## 7. UI — 도크의 슬롯 표시기

도크 탭 줄 한쪽에 `실행 중 2/3` 형태로 붙인다. 대기가 있으면 `실행 중 3/3 · 대기 2`, 없으면 뒷부분을 생략한다.

**workspace와 무관한 전역 값이다.** 다른 workspace가 슬롯을 쥐고 있어 내 run이 시작되지 않는 상황이 이 한 줄로 설명된다. 이 표시기가 없으면 사용자에게는 "왜 시작을 안 하지"만 남는다.

클릭하면 상한을 조절한다. `setConcurrencyLimit`은 `app_setting`에 값을 저장하고 `queue.setLimit`을 부른 뒤 새 스냅샷을 돌려주며, `event:queueUpdate`도 함께 나간다. `app_setting`은 지금까지 아무도 쓰지 않았다 — 이 테이블의 첫 사용처다.

상한을 실행 중인 개수보다 낮추면 **돌고 있는 것을 죽이지 않고** 자연 종료를 기다린다. 그동안 표시기는 `4/3`처럼 넘긴 상태를 그대로 보여준다. 감추면 왜 새 run이 안 뜨는지 알 수 없다.

### 렌더러 배선

`App.tsx`가 `useQueue()`를 들고 `Dock`에 props로 내린다. `useRuns`가 이미 그 자리에 있다.

지금은 쓰는 곳이 도크 하나뿐이라 `Dock`이 직접 불러도 동작은 같다. 그래도 App에 두는 이유는 **`useRepos`가 정확히 그 실수로 깨졌기 때문이다** — `RepoStrip`과 `RunPanel`이 각자 인스턴스를 갖는 바람에 repo를 등록해도 한쪽만 갱신됐고, 실행 버튼이 영영 비활성으로 남았다(커밋 `fbcd0e6`). 훅을 공통 부모에 두면 그 사고가 구조적으로 막힌다.

## 8. IPC와 이벤트

기존 명명 규칙을 따른다.

**`shared/channels.ts`**

```
runsQueueSnapshot: 'runs:queueSnapshot'
runsSetConcurrencyLimit: 'runs:setConcurrencyLimit'
```

**`EVENT_CHANNELS`**

```
queueUpdate: 'event:queueUpdate'
```

`event:runUpdate`는 run 하나 단위라 큐 전체를 표현하지 못한다. 같은 방식으로 하나 더 둔다.

**`shared/client.ts`**

```ts
runs: {
  // 기존 …
  queueSnapshot(): Promise<QueueSnapshot>
  setConcurrencyLimit(n: number): Promise<QueueSnapshot>
}
events: {
  // 기존 …
  onQueueUpdate(cb: (snapshot: QueueSnapshot) => void): Unsubscribe
}
```

IPC 핸들러는 얇게 유지한다 — core 메서드 호출만 한다(전체 설계 §4 규칙 3).

## 9. 오류 처리

**슬롯 누수.** `execution`이 `onStart` 전체를 감싸 실패 시 `release` + `markFinished(failed)`를 보장한다. §4 계약 1이 이유다.

**유령 run.** 대기 중인 run의 workspace가 지워지면 `run` 행이 cascade로 사라진다. `onStart`에서 run을 못 찾으면 던지지 말고 조용히 `release`하고 다음으로 넘어간다. 던지면 큐가 그대로 멈춘다.

**상한 값 검증.** 1 미만이거나 정수가 아니면 거부한다. `app_setting`에 이상한 값이 들어 있으면 기본 3으로 폴백한다. `Number()`가 `NaN`을 조용히 흘리는 함정은 `fake-claude.mjs`에서 이미 한 번 겪었다(커밋 `df9c178`).

**앱 종료.** 기존 `cancelAll`이 실행 중 프로세스를 정리한다. 대기 중인 것은 프로세스가 없으므로 다음 실행 때 복구가 `canceled`로 내린다.

## 10. 설계 문서와 어긋나는 점

전체 설계 §6은 큐를 `RunManager`에 둔다고 적었다. 이 스펙은 `RunQueue`로 분리한다.

근거는 이렇다. 실제 `RunManager`는 **DB를 모른다** — `adapters`, `logDir`, `onEvent`만 받는다. DB 상태 전이는 전부 `ExecutionService`에 있다. 큐의 핵심 순간은 "슬롯이 나서 꺼낼 때"인데 바로 그 순간에 `pending → running`을 DB에 써야 한다. 큐를 `RunManager`에 두면 그 시점을 밖으로 콜백해야 하고, `RunManager`가 프로세스와 무관한 상태를 떠안으며, 취소 경로가 둘로 갈라진다.

분리하면 상한·FIFO·재진입을 **프로세스 없이 결정적으로 테스트할 수 있다.** 이 저장소에서는 실제로 무는 테스트를 쓸 수 있는 구조인지가 크게 갈린다.

§6의 나머지 결정(기본 상한 3, 앱 전역 적용, FIFO, SIGTERM 후 SIGKILL, 종료 시 전체 정리)은 그대로 따른다.

## 11. 테스트 전략

**`core/runner/queue.test.ts`가 중심이다.** 프로세스 없이 도는 순수 로직이라 전부 결정적이다.

- 상한까지 즉시 시작하고 초과분은 대기한다
- `release` 시 FIFO 순으로 다음이 시작한다
- 대기 중 `remove`는 성공하고, 실행 중 `remove`는 false다
- 상한을 줄이면 새로 시작하지 않는다 (돌던 것은 그대로)
- 상한을 늘리면 대기분이 즉시 시작한다
- `onStart`가 던져도 큐가 멈추지 않는다

**`core/execution.test.ts`**

- 상한을 넘으면 `pending`으로 남는다
- 앞 run이 끝나면 다음이 시작한다
- preflight 실패는 슬롯을 소모하지 않는다
- 대기 중 취소가 `canceled`로 끝난다

**복구**

- `running` → `interrupted`, `pending` → `canceled`
- **복구가 아무것도 시작하지 않는다**

**e2e**

상한을 1로 낮추고 두 개를 실행해, 두 번째가 대기 칩으로 앉았다가 첫 번째가 끝나면 시작하는 것을 본다. 가짜 CLI의 `ONE_DESK_FAKE_DELAY_MS`(드라이버 기본 1500ms)가 그 관찰 창을 만든다.

**상한은 `app_setting`을 직접 건드리지 말고 슬롯 표시기를 클릭해 낮춘다.** 그래야 조절 UI와 저장 경로까지 같은 테스트가 덮는다. 표시기 숫자도 함께 확인한다.

**회귀 테스트는 대상 코드를 잠시 망가뜨려 실제로 실패하는지 확인하고 넘어간다.** 이 저장소는 무력화된 회귀 테스트에 한 번 당했다.

## 12. 다음으로 넘기는 것

- **3b** — 인박스(`reviewed_at IS NULL` 쿼리), 사이드바 배지, 상태별 후속 행동, 세션 이어서 실행
- **5단계** — diff 뷰어와 `run_file_change`. 3b 인박스의 "변경 보기"는 그때 채워진다
- 큐 우선순위. 지금은 FIFO만이며, 필요해지기 전에는 만들지 않는다
