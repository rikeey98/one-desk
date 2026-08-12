# 3b단계 설계 — 결과 인박스와 후속 행동

## 1. 목표

"결과가 나온 줄 몰라서 확인하러 돌아다니는" 문제를 없앤다. run의 상태를 어딘가에 표시하는 것만으로는 부족하다 — 필요한 것은 **지금 사용자의 손이 필요한 run만 모인 큐**다.

전체 설계(`2026-08-07-one-desk-design.md`) §13의 3단계를 둘로 쪼갠 뒤쪽이다. 3a(`2026-08-10-stage3a-run-queue-design.md`)가 만든 `pending`·`interrupted`·`canceled` 상태 위에 얹힌다.

전체 설계 §10은 이 단계를 "이 앱의 핵심 기능"이라 적었다.

## 2. 범위

**포함**

- 인박스 쿼리와 화면 (모든 workspace를 가로지른다)
- 사이드바 배지 — 전체 미처리 건수와 workspace별 건수
- 상태별 후속 행동
- 세션 이어서 실행 (`execution.resume`)

**제외**

- **"변경 보기"(diff)** → **5단계.** `run_file_change` 테이블이 아직 없다. §4의 행동표에서 그 칸은 비워둔다
- OpenCode 어댑터, asset 스캔 → 5단계
- MCP 서버 → 4단계
- 자율 실행 / 스케줄러 → 전체 설계 §14

## 3. 정해진 것

브레인스토밍에서 사용자가 정한 결정들이다. 구현 중에 임의로 뒤집지 않는다.

| 결정 | 내용 |
|---|---|
| 3b를 통째로 간다 | 인박스의 "답하고 이어서"가 resume을 직접 필요로 하므로 쪼개면 행동표에 빈칸이 생긴다 |
| 앱이 취소한 대기 run은 인박스에 보인다 | `reviewedAt`으로 가른다 — §5 |
| 인박스는 사이드바 항목 + main 교체 | 전역 목록이니 만큼 자리를 받는다 |
| 이어서 실행은 도크의 실행 패널을 재사용 | resume 모드로 연다 — §7 |
| 잠금 규칙은 core에 둔다 | `execution.resume`이 원본에서 채운다 — §6 |
| 카운트는 push한다 | `event:inboxUpdate`. 3a의 `event:queueUpdate` 전례를 따른다 — §8 |

## 4. 인박스

### 조건

```
reviewed_at IS NULL AND status IN ('succeeded', 'failed', 'interrupted', 'canceled')
```

`needs_answer`는 **포함 여부가 아니라 분류에만** 쓰인다. `pending`과 `running`은 아직 진행 중이라 들어오지 않는다.

**인박스는 모든 workspace를 가로지른다.** 여러 repo, 여러 workspace에서 돌린 결과가 한 리스트로 모인다.

### 규칙 — run은 "확인함"을 누를 때까지 사라지지 않는다

읽지 않은 메일과 같다. 자동으로 사라지면 인박스는 다시 그냥 로그 목록이 된다.

### 카테고리는 파생한다

카테고리를 컬럼으로 저장하지 않고 `status` + `needsAnswer`에서 파생한다. 저장하면 둘이 어긋난다 — `closedAt`을 `status`에서 파생시킨 것과 같은 이유다.

| 카테고리 | 조건 |
|---|---|
| 답변 필요 | `needsAnswer` |
| 완료 · 미확인 | `succeeded` && `!needsAnswer` |
| 실패 | `failed` |
| 중단됨 | `interrupted` |
| 대기 중 취소됨 | `canceled` |

파생 함수는 `renderer/inbox.ts`에 순수 함수로 둔다. `renderer/context.ts`가 이미 그 자리에 있는 패턴이다.

### 정렬

`endedAt DESC`, 같은 밀리초는 `rowid`로 가른다. 인박스 항목은 전부 종료 상태이므로 `endedAt`이 반드시 있다.

`createdAt`만으로 정렬하면 같은 밀리초에 만들어진 항목들의 순서가 흔들린다 — `runs.list`가 이미 같은 이유로 `rowid` tie-break를 쓴다.

## 5. 후속 행동

| 카테고리 | 행동 |
|---|---|
| 답변 필요 | 답하고 이어서 · 로그 보기 · 보관 |
| 완료 · 미확인 | *(변경 보기 — 5단계)* · 이어서 실행 · 관련 이슈 닫기 · 확인함 |
| 실패 | 로그 보기 · 다시 실행 · 이슈로 만들기 · 보관 |
| 중단됨 | 로그 보기 · 다시 실행 · 보관 |
| 대기 중 취소됨 | 다시 실행 · 보관 |

결과를 읽은 뒤 무엇을 할지 다시 판단하는 것 자체가 피로의 원인이므로, 카테고리마다 다음 수를 미리 제시한다.

### 대기 중 취소됨 — 3a가 만든 새 카테고리

전체 설계 §10의 인박스 조건에는 `canceled`가 없다. 사용자가 취소했으면 본인이 아니까 맞는 결정이었다.

그런데 3a가 새로운 종류의 `canceled`를 만들었다. 재시작하면 대기 중이던 run이 `canceled`로 내려간다 — **사용자가 취소한 것이 아니라 앱이 취소한 것이다.** 그대로 두면 상한 3에 5개를 걸어두고 앱을 닫았다 열었을 때 3개는 "중단됨"으로 뜨고 나머지 2개는 흔적 없이 사라진다. 사용자는 그 둘이 있었다는 것조차 모른다. §4의 "놓칠 수 없다"와 정면으로 부딪힌다.

**`reviewedAt`으로 가른다.** 사용자가 직접 취소하면 `execution.cancel`이 그 자리에서 `reviewedAt`을 찍는다(본인이 알아서 한 일이니 이미 "확인됨"이다). 앱이 재시작하며 취소한 것은 `reviewedAt`이 `null`로 남아 자연히 인박스에 뜬다. 스키마 변경이 필요 없고 이미 있는 두 컬럼만 쓴다.

**대기 중이든 실행 중이든 사용자 취소는 둘 다 찍는다.** `execution.cancel`은 3a에서 두 갈래다 — 대기 중이면 큐에서 빼고 즉시 `canceled`로 끝내고, 실행 중이면 프로세스에 SIGTERM을 보내고 종료 처리는 나중에 온다. 실행 중 경로에서는 그 시점에 run이 아직 `running`이지만, `reviewedAt`을 미리 찍어도 무해하다 — 인박스는 종료 상태만 보고, `markFinished`는 `reviewedAt`을 건드리지 않는다.

그래서 인박스에 남는 `canceled`는 **앱이 취소한 것뿐**이고, "대기 중 취소됨"이라는 이름이 정확해진다.

**알려진 엣지 케이스.** 실행 중인 run을 취소했는데 SIGTERM이 닿기 전에 프로세스가 정상 종료하면, 그 run은 `succeeded`이면서 이미 `reviewedAt`이 찍혀 인박스에 뜨지 않는다. 드물고, 사용자가 스스로 버린 실행이라 손실이 작다. 그대로 둔다.

**로그 보기를 넣지 않는다.** 시작도 못 한 run이라 로그 파일이 없다.

### 이어서 실행은 세션이 있을 때만 보인다

`externalSessionId`가 `null`이면 이어받을 것이 없다. 실패한 run은 세션이 만들어지기 전에 죽었을 수 있다. 버튼을 보여주면 눌러서야 실패를 알게 된다.

**"다시 실행"은 resume이 아니라 같은 프롬프트로 새 세션을 시작하는 것이다.** 두 행동은 구별된다.

### 확인함과 보관

둘 다 `reviewedAt`을 찍고 `reviewedKind`로만 갈린다.

| 행동 | `reviewedKind` |
|---|---|
| 확인함 | `'confirmed'` |
| 보관 | `'archived'` |
| 이슈로 만들기 (만든 뒤 자동) | `'archived'` |
| 사용자 취소 (`execution.cancel`) | `'archived'` |

지금 화면에서 두 값이 다르게 쓰이지는 않는다. 그래도 나누는 이유는, 컬럼을 나중에 추가하면 마이그레이션이 한 번 더 필요하고 **그 이전 기록은 복구할 수 없기** 때문이다.

### 이슈로 연결되는 두 행동

**"관련 이슈 닫기"**는 `run_context_item`에 이슈가 붙어 있을 때만 보인다. 여럿이면 각각 보인다. `issues.update({ status: 'done' })`을 부른다 — `closedAt`은 저장소가 파생시킨다.

**"이슈로 만들기"**는 실패한 run의 지시 첫 줄을 제목으로, 오류 메시지를 본문으로 채운 이슈를 만들고 그 run을 보관한다. 실패는 대개 나중에 다뤄야 할 일인데, 인박스에서 사라지면 그대로 잊힌다.

## 6. 이어서 실행 — `execution.resume`

`ResumeRunInput`은 `shared/models.ts`에 둔다 — `StartRunInput`이 이미 그 자리에 있고, 렌더러와 core가 함께 쓴다.

```ts
export interface ResumeRunInput {
  /** 이어받을 원본 run */
  parentRunId: string
  model?: string | null
  permission: Permission
  userPrompt: string
  /** 기본은 빈 배열 — 이전 대화가 이미 세션에 있다 */
  context: ContextItemRef[]
}

resume(input: ResumeRunInput): Promise<Run>
```

`StartRunInput`에도 `parentRunId`가 있지만 그것은 "원본을 가리키는 기록"일 뿐 세션을 이어받지 않는다. `resume`은 세션까지 이어받는다는 점에서 다르고, 그래서 별도 입구를 둔다.

core가 원본 run을 읽어 **`workspaceId`·`agentKind`·`cwd`·`externalSessionId`를 채운다.** 호출자는 바꿀 수 있는 것만 넘긴다.

전체 설계 §6이 정한 대로 **`agentKind`와 `cwd`는 잠긴다** — 세션은 특정 CLI가 특정 디렉토리에서 만든 것이라 다른 조합으로 이어받을 수 없다. **`model`·`permission`·맥락·프롬프트는 바꿀 수 있다.** 특히 권한 변경은 전체 설계 §7이 명시적으로 요구하는 흐름이다(권한 부족으로 멈춘 run을 권한을 올려 이어서 실행).

**그 잠금 규칙이 core에 있어야 한다.** 렌더러가 조립하면 규칙이 렌더러에 살게 되고, 나중에 `core/`를 별도 데몬으로 뗄 때 따라가지 않는다(전체 설계 §4 규칙 1).

`timeoutMs`는 이 열거에 없었다 — 잠긴 값도 바꿀 수 있는 값도 아니라 설계가 비워둔 자리다. **원본을 따른다:** 새 run은 `parent.timeoutMs`를 그대로 물려받는다. 원본이 타임아웃을 걸고 돌던 run이면 그 제한이 이어받는 run에서도 조용히 사라지면 안 된다는 판단이다.

거부하는 경우 둘 다 한국어 메시지를 낸다.

- `externalSessionId`가 없다 — 이어받을 세션이 없다
- 원본 run이 없다 — workspace가 지워져 cascade로 사라졌다

새 run은 `parentRunId`로 원본을 가리킨다.

**맥락은 기본적으로 다시 첨부하지 않는다.** 이전 대화가 이미 세션에 있다. 필요하면 사용자가 추가로 고른다.

내부적으로는 지금 `start`가 `resumeSessionId: null`로 고정해 넘기는 자리를 연다. `start`와 `resume`이 같은 경로를 공유하고 채우는 값만 다르다 — 큐 등록, 슬롯 회계, preflight는 3a가 만든 그대로다.

## 7. UI

### 사이드바

workspace 목록 위에 `인박스` 항목을 두고 오른쪽에 전체 미처리 건수를 단다. 각 workspace 항목에도 그 workspace의 건수를 단다.

**0이면 배지를 그리지 않는다.** 0이 상시 붙어 있으면 눈이 그것을 걸러내는 법을 배우고, 그러면 숫자가 생겨도 안 보인다.

`App`은 `view: 'workspace' | 'inbox'` 상태를 갖는다. 인박스를 골라도 **workspace 선택은 유지한다** — 돌아올 곳이 필요하다.

### 인박스 화면

항목마다 보여줄 것: 카테고리 칩, 지시 첫 줄, **어느 workspace 것인지**, 끝난 시각, 오류 메시지(있으면). 그 아래 §5 표의 행동 버튼.

workspace 이름이 빠지면 전역 목록에서 맥락이 사라진다 — 같은 지시를 두 repo에서 돌렸을 때 구별할 수 없다.

비어 있으면 "처리할 결과가 없습니다".

### 실행 패널의 resume 모드

`resumeFrom: Run | null`을 받는다. 있으면:

- agent와 작업 디렉토리를 **읽기 전용**으로 표시하고 원본 run을 가리키는 줄을 얹는다
- **권한 기본값은 원본의 권한이다.** 올리는 것은 사용자의 판단이고, 기본값이 낮아지면 조용히 권한이 깎인다
- 프롬프트와 맥락 칩은 비어 있다
- 실행 버튼이 `resume`을 부른다

인박스에서 "이어서 실행"이나 "답하고 이어서"를 누르면 그 run의 workspace로 전환하고 도크를 resume 모드로 연다.

## 8. IPC와 이벤트

기존 명명 규칙을 따른다.

**`shared/channels.ts`**

```
runsInbox:        'runs:inbox'
runsInboxCounts:  'runs:inboxCounts'
runsMarkReviewed: 'runs:markReviewed'
runsResume:       'runs:resume'
```

**`EVENT_CHANNELS`**

```
inboxUpdate: 'event:inboxUpdate'
```

**`shared/models.ts`**

```ts
export interface InboxCounts {
  total: number
  /** workspace id → 그 workspace의 미처리 건수. 0인 workspace는 키가 없다. */
  byWorkspace: Record<string, number>
}
```

**`shared/client.ts`**

```ts
runs: {
  // 기존 …
  inbox(): Promise<Run[]>
  inboxCounts(): Promise<InboxCounts>
  markReviewed(runId: string, kind: 'confirmed' | 'archived'): Promise<Run>
  resume(input: ResumeRunInput): Promise<Run>
}
events: {
  // 기존 …
  onInboxUpdate(cb: (counts: InboxCounts) => void): Unsubscribe
}
```

인박스 목록은 `Run[]`을 그대로 돌려준다. 카테고리는 §4대로 렌더러가 파생하므로 별도 항목 타입을 만들지 않는다. 화면이 보여줄 workspace 이름은 렌더러가 이미 가진 `useWorkspaces`에서 온다 — core가 run에 이름을 얹어 보내면 두 출처가 생긴다.

### core의 배선

core는 `inbox` 그룹을 노출한다.

```ts
inbox: {
  list(): Run[]
  counts(): InboxCounts
  markReviewed(runId: string, kind: 'confirmed' | 'archived'): Run
}
```

`emitInbox()`를 두고 **인박스 소속이 바뀔 수 있는 모든 쓰기 뒤에** 부른다 — `markFinished`(execution의 `onRunUpdate` 경로), `markReviewed`, 그리고 `execution.cancel`이 `reviewedAt`을 찍는 자리다.

IPC 핸들러는 얇게 유지한다 — core 메서드 호출만 한다(전체 설계 §4 규칙 3).

### 알려진 한계 — 인덱스

`reviewed_at`에는 인덱스가 없어 인박스 쿼리와 카운트가 테이블을 스캔한다. run이 수천 개가 되기 전에는 문제가 아니므로 지금은 두고, **`run` 행이 수천 단위로 늘거나 배지 갱신이 눈에 띄게 느려지면** `(reviewed_at, status)` 부분 인덱스를 검토한다.

## 9. 오류 처리

**`resume` 거부.** §6의 두 경우 모두 한국어 메시지로 거부한다.

**`markReviewed`는 멱등하되 시각을 덮어쓰지 않는다.** 이미 확인된 run에 다시 부르면 처음 확인한 시각이 남는다 — 그것이 기록으로서 의미가 있다.

**카운트 조회 실패를 감추지 않는다.** 배지를 조용히 숨기면 "처리할 것이 없다"와 "못 읽었다"가 구별되지 않는다. 3a에서 `useQueue`가 정확히 그 실수를 했고 최종 리뷰가 잡았다.

**인박스 목록의 항목이 그 사이 사라져도** 다음 `event:inboxUpdate`에 정리된다. 목록은 스냅샷이지 진실의 출처가 아니다.

## 10. 테스트 전략 — 변이 목록을 먼저 뽑는다

**3a에서 배운 것이고 이 스펙이 관행으로 못박는다.**

3a는 테스트 175개로 끝났지만, 최종 리뷰가 실제로 코드를 되돌려 보기 전까지는 이 브랜치의 핵심 약속 네 개(N개 동시 실행, 유령 run의 슬롯 반납, 상한 저장, 대기 중 취소 버튼)가 전혀 지켜지지 않고 있었다. 넷 다 로직 블록이 아니라 **배선 한 줄**이었다.

계획이 명시한 변이 세 건은 전부 제대로 물었다. 문제는 방법이 아니라 **목록**이었다.

그래서 3b는 테스트를 쓰기 전에 되돌릴 한 줄과 그때 실패해야 할 테스트를 짝지어 적는다. 아래는 출발점이고, 계획이 태스크별로 더 잘게 나눈다.

| 되돌릴 것 | 실패해야 하는 테스트 |
|---|---|
| 쿼리의 `reviewed_at IS NULL` | 확인함 누른 run이 목록에 남는다 |
| 조건에서 `canceled` | 앱이 취소한 대기 run이 인박스에 없다 |
| `execution.cancel`의 `reviewedAt` 찍기 | 사용자가 취소한 run이 인박스에 뜬다 |
| resume의 `agentKind`/`cwd` 잠금 | 호출자가 넘긴 값이 먹힌다 |
| resume의 세션 없음 거부 | 세션 없이도 시작된다 |
| `externalSessionId` 없을 때 버튼 숨김 | 세션 없는 run에도 "이어서 실행"이 뜬다 |
| 배지의 workspace별 카운트 | 전체만 맞고 workspace별이 0이다 |
| `emitInbox()` 호출 | run이 끝나도 배지가 안 변한다 |
| 정렬의 `rowid` tie-break | 같은 밀리초 항목들의 순서가 흔들린다 |
| `markReviewed`의 덮어쓰기 방지 | 두 번 부르면 시각이 갱신된다 |

**배선에도 테스트를 붙인다.** 3a에서 놓친 넷이 전부 배선이었다. `core/index.ts`에는 3a가 만든 `core/index.test.ts`가 이미 있으므로 인박스 배선도 거기에 얹는다.

e2e는 run 하나를 끝내 인박스에 뜨는 것, "확인함"으로 사라지는 것, 그 사이 배지 숫자가 따라 움직이는 것을 본다.

## 11. 다음으로 넘기는 것

- **4단계** — MCP 서버. agent가 issue/memo를 직접 수정한다
- **5단계** — diff 뷰어와 `run_file_change`. §5 행동표의 "변경 보기"가 그때 채워진다. OpenCode 어댑터, asset 스캔
- 3a에서 넘어온 것: `notify`가 던질 때 run이 프로세스 없이 `running`으로 남는 경로, `core/`의 `console.error`를 주입식 `onError`로 바꾸는 것
- 큐의 `waiting`이 지금은 개수만 노출한다. 인박스가 대기 중인 run을 순서대로 보여주려 하면 목록이 필요해진다 — 3b 범위에는 넣지 않았다(대기 중인 run은 인박스 조건이 아니다)
- `(reviewed_at, status)` 부분 인덱스 — §8의 조건이 오면
