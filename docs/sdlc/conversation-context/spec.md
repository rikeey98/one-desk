# Spec: 대화에 담긴 맥락 표시

- 출처: `intent.md` (2026-09-17 승인)
- 작성자: 권용현
- 상태: 승인됨 (2026-09-17)
- 작성일: 2026-09-17

## 요구사항

### 기능 요구사항

- **FR-1.** 대화(턴이 하나 이상인 `Conversation`)를 보고 있으면 **그 대화의 턴들이 담았던 항목의
  합집합**이 한 줄로 보인다. 항목은 repo·이슈·메모·asset이다.
- **FR-2.** 같은 항목(`type:id`가 같음)을 여러 턴에 담았으면 **한 번만** 보인다. 순서는 **처음
  담긴 턴 순**(오래된 턴 먼저), 같은 턴 안에서는 담긴 순서다.
- **FR-3.** 각 항목은 종류와 이름으로 보인다 — `이슈 · 토큰 만료 버그`, `메모 · 릴리스 절차`,
  `asset · review`, `repo · api-server`. 이름은 **지금의 이름**이다(1턴 이후 이슈 제목을 바꿨으면
  바뀐 제목).
- **FR-4.** 이 줄은 **보기 전용**이다. 항목은 버튼이 아니며 클릭·포커스·키보드 조작이 없다.
  클릭해도 입력부의 맥락 칩(`chips`)은 바뀌지 않는다.
- **FR-5.** 지워진 이슈·메모·repo·asset은 **보이지 않는다.** 항목이 하나도 남지 않으면 줄 자체가
  없다.
- **FR-6.** 취소된 턴(`status === 'canceled'`)이 담았던 항목은 세지 않는다. 그 밖의 턴(대기 중·
  진행 중·성공·실패·중단)은 센다.
- **FR-7.** 새 대화(`conversation === null`)에는 이 줄이 없다. 대화 탭을 바꾸면 그 대화의 줄로
  바뀐다. 인박스에서 대화를 열거나 앱을 다시 켜도 같은 줄이 보인다.
- **FR-8.** 입력부의 맥락 칩과 그 규칙은 그대로다 — 실행하면 칩이 비워지고, 2턴부터는 새로 담은
  것만 `<context>`로 나간다. 이 작업은 **전송되는 내용을 바꾸지 않는다.**

### 비기능 요구사항

- **NFR-1.** 새 IPC 호출이나 추가 왕복 없이 **지금 렌더러가 이미 받는 `Run[]`에서 파생**한다.
  대화를 열 때 조회가 늘어나면 안 된다.
- **NFR-2.** 이름을 붙이는 조회는 run 목록 조회 안에서 **종류당 한 번**(`inArray`)이다. run마다
  질의하지 않는다(N+1 금지).
- **NFR-3.** 스타일은 `renderer/index.css`의 한 줄 한 규칙 형식을 따르고, 클릭 가능한 `.chip`과
  이름을 나눠 `.chip` 규칙을 물려받지 않는다(`.axis-chip`이 같은 이유로 분리된 선례).
- **NFR-4.** 단일 턴 실행 화면(대화 없음)의 DOM은 이 작업 전과 같다.

## 범위 밖

- 표시된 항목에서 **다시 보내기·빼기** 같은 조작. intent에서 "보기만"으로 확정했다.
- 입력부 맥락 칩의 유지·재전송 규칙 변경(대화 설계 §4-1). 건드리지 않는다.
- asset의 skill/agent 구분 표시. 이번에는 둘 다 `asset ·`으로 보인다 — `ContextItemRef`에
  kind가 없고, 이 작업에서 모델을 그 이상 키우지 않는다.
- "어느 턴에서 담았는지" 표시. 한 번만 보이는 것으로 충분하다고 판단했다(아래 답 표).
- 인박스 목록 줄에 담긴 항목을 보여주는 것.
- 지워진 항목을 "(지워진 이슈)"로 남기는 것. 지금 core가 읽는 시점에 죽은 id를 걸러내는
  동작(`run.ts` `loadContext`)을 따른다.

## 설계

### 개요

**핵심은 "새로 저장하지 않고, 이미 있는 것에 이름만 붙여 렌더러가 합친다"이다.**

1. `run_context_item`이 run마다 `{itemType, itemId}`를 기록하고 있고, `runs.list()`가 그것을
   `Run.contextItems`로 실어 온다(`core/db/repositories/run.ts` `hydrate` → `loadContext`).
   렌더러의 `useRuns`는 이미 이 목록을 갖고 있다.
2. 빠진 것은 **이름**뿐이다. `ContextItemRef`는 `{type, id}`라 화면에 쓸 수 없고, 렌더러의 이슈·
   메모·asset 목록은 각 패널 안에 repo 필터가 걸린 채로 살아서 대화창이 가져다 쓸 수 없다.
   그래서 **core가 `hydrate` 시점에 이름을 붙인다.** `loadContext`는 지금도 살아 있는 id를
   가리기 위해 종류당 한 번 `inArray` 질의를 하므로, 그 질의의 `select`에 이름 컬럼을 더하면
   추가 왕복 없이 끝난다(NFR-2).
3. 렌더러는 `renderer/conversation.ts`에 순수 함수 `contextOf(conversation)`를 두고, 대화의
   run들을 오래된 순으로 훑어 `type:id`로 중복을 걷어낸다. `groupConversations`·`titleOf`와 같은
   자리, 같은 패턴(저장하지 않는 파생값)이다.
4. `ConversationPanel`이 `Transcript`와 `RunPanel` **사이**에 그 줄을 그린다.

**자리를 고른 이유.** 후보 셋을 비교했다.

| 자리 | 판단 |
|---|---|
| 대화록 맨 위(1턴 버블 앞) | 대화가 길어지면 스크롤 위로 사라진다 — 정보가 가장 필요한 긴 대화에서 안 보인다 |
| 도크 탭 헤더 | 탭이 좁아 항목 셋만 돼도 잘린다 |
| **입력부 바로 위** (선택) | 늘 보이고, 바로 아래 "이번 턴에 담을 것" 칩 줄과 위아래로 붙어 **"이 대화가 이미 받은 것 / 이번에 보낼 것"** 두 줄이 한 쌍으로 읽힌다 |

**대안: 렌더러가 이름을 찾는 방식**(`useIssues` 등을 대화창에서 다시 부르기)은 버렸다.
`App.tsx`의 주석이 기록하듯 같은 훅을 두 곳에서 부르다 두 번 사고가 났고(`useRepos`·
`useWorkspaces`), 패널의 목록은 repo 필터가 걸려 있어 다른 repo의 이슈 이름을 못 찾는다.

### 데이터 모델

**스키마 변경 없음. 마이그레이션 없음.**

`shared/models.ts`:

```ts
/** 화면에 보이는 맥락 항목. 요청(ContextItemRef)에는 label이 없다. */
export interface ContextItemView extends ContextItemRef {
  /** 지금의 이름 — repo.name · issue.title · memo.title · asset.name */
  label: string
}

export interface Run {
  …
  contextItems: ContextItemView[]   // 이전: ContextItemRef[]
}
```

`ContextItemRef`는 그대로 요청 모양(`StartRunInput.context`·`ResumeRunInput.context`)이다.
`Run.contextItems`만 넓어진다. 기존 렌더러 코드는 `type`·`id`만 쓰므로 깨지지 않는다.

`core/db/repositories/run.ts` `loadContext`:

- `livingIds(type, ids)` → `livingNames(type, ids): Map<id, name>`. `select({ id, name: table.title })`
  (repo·asset은 `name`, issue·memo는 `title`).
- **asset도 같은 방식으로 조회한다.** 지금은 "asset은 아직 테이블이 없어(5단계) 걸러내지 않는다"는
  주석과 함께 그대로 통과시키는데, asset 테이블은 이미 있다(`schema.ts` `asset`, 스캔 작업에서
  추가됨). 이름을 붙이려면 어차피 조인해야 하므로, **이름을 못 찾은 asset은 다른 종류와 똑같이
  빠진다.** 이것은 관측 가능한 동작 변화라 아래 "확인 필요 항목"에 올린다.

### 인터페이스

**IPC — 변경 없음.** `runs.list`·`runs.get`·`onRunUpdate` push가 나르는 `Run`의 `contextItems`에
`label`이 하나 더 실릴 뿐이다. 핸들러는 그대로 얇다.

**렌더러 파생 함수** — `renderer/conversation.ts`:

```ts
/** 대화가 지금까지 담은 항목의 합집합. 처음 담긴 턴 순, 취소된 턴은 빼고, type:id로 한 번만. */
export function contextOf(conversation: Conversation): ContextItemView[]
```

**화면 흐름** — `ConversationPanel`:

```
[Transcript]                      ← 대화록 (있을 때만)
[이 대화에 담긴 것: 이슈 · A  메모 · B  asset · C]   ← 신규. contextOf()가 비어 있으면 없음
[RunPanel]
  [run-chips: 이번 턴에 담을 것 …]  ← 기존 칩 줄 (그대로)
  [지시 입력 …]
```

마크업은 `<div class="applied-context">` 안에 라벨 `<span class="applied-label">이 대화에 담긴 것</span>`
과 항목 `<span class="applied-chip">이슈 · 토큰 만료 버그</span>`들이다. **버튼이 아니다**(FR-4).
항목 `title` 속성에 같은 텍스트를 둬 잘린 이름을 호버로 읽을 수 있게 한다.

**종류 이름**은 렌더러의 작은 표 하나로 정한다: `repo → repo`, `issue → 이슈`, `memo → 메모`,
`asset → asset`.

### 예외 처리

- **지워진 항목**: core가 읽을 때 걸러내므로(`loadContext`) 렌더러에 도달하지 않는다. 그 결과
  목록이 비면 줄이 안 그려진다(FR-5).
- **preflight에서 죽은 턴**(`failed`인데 `externalSessionId`가 null): 프로세스가 뜬 적이 없어
  `<context>`가 agent에 실제로 닿지 않았지만, 이 줄에는 센다(FR-6은 취소만 뺀다). "담으려 했다"는
  사실은 맞고, 실패 배지가 같은 턴에 붙어 있어 사용자가 구분할 수 있다. 여기까지 정밀하게 가르는
  것은 이번 범위가 아니다.
- **run 목록 조회 실패**: 기존 `useRuns`의 `error` 경로 그대로. 이 줄은 목록이 없으면 그냥
  없다 — 새 오류 표시를 만들지 않는다.
- **낡은 행**(`rootRunId`가 null): `conversationIdOf`가 자기 자신을 뿌리로 보므로 단일 턴 대화로
  묶이고, 그 턴의 항목만 보인다. 이미 그렇게 동작한다.

## 정책 검토

| 영역 | 적용 정책 | 판단 | 근거 |
| --- | --- | --- | --- |
| 보안 | 워크스페이스 밖 데이터 노출 없음 (`CLAUDE.md` 데이터 규칙) | 준수 | 이름은 같은 DB의 같은 workspace 항목에서 온다. 새 IPC 없음 |
| 개인정보·컴플라이언스 | 해당 없음 | 준수 | 로컬 앱, 외부 전송 없음 |
| 브랜드·UX | 표시 전용 요소는 클릭 가능해 보이면 안 된다 (`.axis-chip` 선례, `index.css`) | 준수 | `<span>`, `cursor: default`, 별도 클래스 |
| 아키텍처 경계 | `core/`는 electron 없음 · `renderer/`는 core 없음 · IPC 얇게 (`CLAUDE.md` 경계 세 가지) | 준수 | 변경은 `core/db/repositories/run.ts`(순수 SQL)와 `renderer/`, 공유 모델뿐. IPC 핸들러 무변경 |
| 의도된 중복 | `issue.ts`↔`memo.ts` 대칭 (`CLAUDE.md`) | 준수 | 이슈·메모를 같은 코드 경로로 다룬다. 저장소 파일은 건드리지 않는다 |
| 설계 결정 보존 | 대화 설계 §4-1 "2턴부터 칩은 비어 있다" | 준수 | 규칙과 전송 내용 모두 무변경 (FR-8) |
| 설계 결정 보존 | `run.ts` "asset은 걸러내지 않는다" | 준수 (개정 승인) | 결정의 전제(테이블 없음)가 사라졌고, 이름을 붙이려면 조인이 필요하다. 아래 항목에서 2026-09-17 승인 |
| 데이터 규칙 | 마이그레이션 최소화 | 준수 | 스키마 무변경 |
| 테스트 | TDD, 회귀 테스트는 대상을 망가뜨려 확인, **배선(prop) 변이 검증** (`CLAUDE.md` 컨벤션) | 준수 | 수용 기준에 배선 변이 항목 포함 |

## 확인 필요 항목

> 여기 남은 항목은 Claude 가 임의로 결정하지 않는다. 정책 책임자의 판단을 받아야 Build 단계로 넘어간다.

- [x] **지워진 asset을 이제 걸러낸다.** — 2026-09-17 권용현 승인(권장안 채택). `run.ts` `loadContext`의 "asset은 아직 테이블이 없어
      걸러내지 않는다"는 4단계 시점의 결정이고 지금은 `asset` 테이블이 있다. 이름을 붙이려면
      조인하므로, 이름이 없는 asset은 repo·이슈·메모와 같이 `contextItems`에서 빠진다.
      **관측 변화**: 이전에는 지워진 asset의 `{type:'asset', id}`가 `Run.contextItems`에 남았다.
      지금 렌더러는 `contextItems`를 화면에 그리지 않으므로 사용자에게 보이는 차이는 없지만,
      `run.test.ts`의 asset 관련 단언이 있으면 바뀐다. — 필요한 판단: 권용현, 이 동작 변화를
      승인할지. (권장: 승인. 죽은 id를 렌더러에 넘겨 봐야 이름이 없어 그릴 수 없다.)

## intent 미해결 질문에 대한 답

| 질문 | 결정 | 근거 |
| --- | --- | --- |
| 목록이 사는 자리 | 입력부 바로 위, `Transcript`와 `RunPanel` 사이 (`ConversationPanel`) | 늘 보이고 칩 줄과 짝을 이룬다. 대화록 위는 스크롤에 사라지고 탭은 좁다 (설계 개요의 표) |
| 같은 항목을 두 턴에 담으면 | 한 번만, 처음 담긴 턴 순. 턴 번호는 안 붙인다 | 질문은 "이 대화가 뭘 받았나"이지 "언제"가 아니다. 턴 번호는 범위 밖 |
| 지워진 항목 | 안 보인다 | core가 읽는 시점에 이미 걸러낸다(SET NULL과 같은 관측 동작으로 설계됨). 그 규칙을 따른다 |
| `Run`에 `contextItems`가 실려 오는가 | 실려 온다 — `hydrate()`가 `list`·`get` 모두에 붙인다. 이름만 없다 | `core/db/repositories/run.ts:93` |
| 예약(`pending`)된 턴의 항목 | 보인다 | `create()`가 run 행과 함께 `run_context_item`을 넣으므로 이미 목록에 있다. 취소되면(FR-6) 빠진다 |

## 수용 기준

| 요구 | 확인 방법 |
| --- | --- |
| FR-1·FR-2·FR-6 | `renderer/conversation.test.ts`: 3턴 대화에서 1턴 `[issue A, asset C]`, 2턴 `[memo B, issue A]`, 3턴(취소) `[memo D]` → `contextOf`가 `[A, C, B]`를 이 순서로 준다. 중복 제거를 지우면 `A`가 두 번 나와 실패하는지 확인 |
| FR-3 | `core/db/repositories/run.test.ts`: 이슈 제목을 바꾼 뒤 `list()`의 `contextItems[].label`이 새 제목이다. repo·메모·asset도 각각 한 건 |
| FR-3 (NFR-2) | 같은 테스트에서 run 셋이 이슈 셋을 담았을 때 이슈 조회가 한 번인지 — `db` 래퍼의 질의 수를 세거나, 최소한 `inArray`로 묶인 조회 함수가 종류당 한 번 호출되는지 spy로 확인 |
| FR-4 | `ConversationPanel.test.tsx`: 줄 안에 `button` role이 없다. 항목을 클릭해도 `onRemoveChip`·칩 상태 변화가 없다 |
| FR-5 | `run.test.ts`: 이슈를 지운 뒤 `list()`의 `contextItems`에 그 이슈가 없다(기존 동작). asset을 지운 뒤에도 없다(**신규 — 확인 필요 항목 승인 후**) |
| FR-5 (빈 줄 없음)·FR-7·NFR-4 | `ConversationPanel.test.tsx`: `conversation=null`이면 `.applied-context`가 없다. 항목 없는 대화도 없다. 단일 턴 화면 스냅샷/DOM이 이전과 같다 |
| FR-7 (탭 전환) | `Dock.test.tsx` 또는 `App.test.tsx`: 대화 A→B로 바꾸면 줄 내용이 B의 것으로 바뀐다 |
| FR-8 | 기존 `e2e/conversation.e2e.ts`가 그대로 통과한다. 여기에 1턴에서 `샘플 맥락에 담기`를 누르고 3턴까지 간 뒤 `.applied-chip`이 `repo · 샘플` 하나인지, 그리고 2턴 실행 직전 `run-chips`가 비어 있는지("왼쪽 항목의 ＋를 눌러…" 문구) 확인하는 단언을 더한다 |
| 배선 변이 | `App.test.tsx`: `ConversationPanel`에 넘기는 `conversation` prop을 다른 대화로 바꾸거나 지웠을 때 줄이 바뀌거나 사라져 잡히는지. **한 줄 prop이 새는 자리가 3a·3b에서 반복된 결함이었다** |
| NFR-1 | 코드 리뷰: 새 `client.*` 호출이 렌더러에 추가되지 않았다 (`grep -rn "client\." renderer/components/ConversationPanel.tsx`가 비어 있다) |
| NFR-3 | `index.css`에 `.applied-context`·`.applied-label`·`.applied-chip` 세 규칙이 한 줄 형식으로 있고 `.chip`을 재선언하지 않는다 |
