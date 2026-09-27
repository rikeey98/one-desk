# Spec: 대화의 수명 주기와 정체성

- 출처: `intent.md` (승인됨 2026-09-23)
- 작성자: 권용현
- 상태: 승인됨 (2026-09-23)
- 작성일: 2026-09-23

## 1. 범위

네 조각이고 순서가 있다. (A)가 판정의 근거를 한 곳에 모으고, 나머지 셋이 그 위에 선다.

- **(A) 인박스 판정을 `shared/`로 올린다.** 카테고리와 "행동을 요구하는가"의 표 하나를
  core와 renderer가 함께 본다. 배지·목록·자동 확인이 같은 표를 보므로 어긋날 수 없다.
- **(B) 배지가 행동을 요구하는 것만 센다 + 본 대화는 자동으로 확인된다.**
- **(C) 대화에 제목과 종료가 생긴다.** `run` 테이블에 컬럼 둘(`title`·`closed_at`).
  마이그레이션 `0008`, **컬럼 추가만.**
- **(D) 도크가 세로 대화 목록이 된다.** 헤더의 가로 탭 스트립이 사라진다.

**빠지는 것**

- **`runs.list`의 개수 제한.** 지금도 제한이 없고 이번에도 두지 않는다 — 대화가 수백 개가
  되면 그때 별도 intent로 다룬다(§6 우려 1).
- **대화를 workspace 사이로 옮기는 것.** 대화는 run에 딸린 것이고 run은 workspace 소속이다.
- **명시적 "다시 열기" 버튼.** 끝낸 대화에 턴을 보내면 저절로 풀린다(FR-13).
- **마크다운 렌더링·검색/필터/정렬.** 목록이 세로가 되면 검색이 자연스럽지만 별도 과제다.
- **대화 삭제.** 화면에서 내릴 뿐 기록은 지우지 않는다(intent 제약, 전체 설계 §232).
- **제목을 agent가 채우는 것(3-C).** `title` 컬럼이 그 자리를 비워 두므로 나중에 MCP 도구
  하나로 붙일 수 있다 — 이번에는 붙이지 않는다.

## 2. 기능 요구사항

### (A) 판정을 한 곳에

- **FR-1.** `renderer/inbox.ts`의 `InboxCategory`·`inboxCategory()`·`CATEGORY_LABELS`가
  **`shared/inbox.ts`로 옮겨간다.** core와 renderer가 같은 모듈을 import한다
  (`core/db/repositories/run.ts`가 이미 `@shared/models`를 쓴다).
- **FR-2.** `inboxCategory()`는 `Run` 전체가 아니라 **`{ status, needsAnswer }`만** 받는다.
  `inboxCounts()`가 슬림한 select로 세기 때문이다 — 전체 행을 읽게 만들면 리뷰 I-2가
  없앤 비용이 그대로 되돌아온다.
- **FR-3.** 같은 모듈에 **행동 요구 표**가 있다.

  | 카테고리 | 배지에 센다 | 열면 자동 확인 |
  |---|---|---|
  | `needs-answer` (답변 필요) | ○ | ✕ |
  | `failed` (실패) | ○ | ✕ |
  | `interrupted` (중단됨) | ○ | ✕ |
  | `done` (완료·미확인) | ✕ | ○ |
  | `dropped` (대기 중 취소됨) | ✕ | ○ |

  **두 열은 서로의 부정이다.** 한 상수(`ACTIONABLE`)에서 나오고 그 불변을 테스트가
  고정한다 — 따로 두면 "배지엔 없는데 자동 확인도 안 되는" 칸이 조용히 생긴다.

### (B) 배지와 자동 확인

- **FR-4.** `inboxCounts()`가 `ACTIONABLE`인 카테고리만 센다. `total`과 `byWorkspace`
  둘 다. **`inbox()`(목록)는 바뀌지 않는다** — 완료·미확인도 인박스에서는 계속 보인다.
  배지는 "지금 손이 필요한가"이고 목록은 "아직 안 내린 것"이다.
- **FR-5.** 도크 목록에서 대화를 **명시적으로 눌렀을 때**, 그 대화의 마지막 턴이
  `ACTIONABLE`이 아니고 뿌리가 아직 미확인이면 `markReviewed(뿌리, 'confirmed')`를
  부른다. 뿌리 id에 찍는다 — 턴 id에 찍으면 아무 일도 일어나지 않는다.
- **FR-6.** 자동 확인은 **마운트·폴백·`focusConversationId`로는 발동하지 않는다.**
  `Dock`은 `pickedId`가 null이면 `conversations[0]`을 고르므로, 그 경로에 걸면 도크를
  열기만 해도 최근 대화가 조용히 내려간다.
- **FR-7.** 새 턴이 오면 배지에 다시 오른다 — `create(parentRunId)`가 뿌리의
  `reviewedAt`을 지우는 기존 배선이 그대로 한다. 새 코드가 필요 없다.
- **FR-8.** 자동 확인이 실패해도 **대화는 열린다.** 오류는 기존 `actionError` 배너로
  흘리고 화면 전환을 막지 않는다.

### (C) 제목과 종료

- **FR-9.** `run` 테이블에 컬럼 둘을 더한다. **뿌리 행에서만 의미가 있다** — 이어지는
  턴의 행에서는 항상 null이다.
  - `title text` — 사용자가 붙인 이름. null이면 파생한다.
  - `closed_at integer` — 종료 시각(epoch ms). null이면 진행 중이다.
- **FR-10.** 둘 다 `Run`에 **의도적으로 싣는다.** 렌더러가 `groupConversations`의 뿌리
  행(`runs[0]`)에서 바로 읽으므로 조회 통로를 따로 만들지 않는다. `shared/models.ts`의
  `Run`에 명시적으로 더한다 — 스프레드가 흘려보내는 것에 기대지 않는다(CLAUDE.md의
  "새 컬럼이 말없이 `Run`에 실려 나간다" 함정).
- **FR-11.** 제목은 **폴백 사다리**이고 순서가 고정이다.
  1. 뿌리의 `title`이 비어 있지 않으면 그것.
  2. 대화가 담은 맥락(`contextOf`)에 이슈·메모가 있으면 **첫 항목의 이름**, 둘 이상이면
     `이름 +N`(N = 이슈·메모 수 − 1). repo·asset은 세지 않는다 — 배경이지 주제가 아니다.
  3. 이슈·메모가 없고 repo가 있으면 **첫 repo 이름**.
  4. 아무것도 없으면 지금처럼 첫 지시의 첫 줄(24자), 그것도 비면 `(빈 지시)`.
- **FR-12.** `runs.close(rootRunId)`가 **한 트랜잭션에서** `closed_at`을 찍고, 아직
  미확인이면 `reviewed_at`/`reviewed_kind='archived'`도 함께 찍는다. 겸하지 않으면 끝낸
  대화가 배지에 남아 종료의 의미가 사라진다.
- **FR-13.** `create()`가 `parentRunId`를 받을 때 뿌리의 `reviewedAt`/`reviewedKind`를
  지우는 **바로 그 자리에서 `closedAt`도 지운다.** 찍는 자리(종료)와 지우는 자리(새 턴)가
  짝을 이룬다 — 끝낸 대화에 턴을 보내면 저절로 되살아난다.
- **FR-14.** `runs.rename(rootRunId, title)`이 제목을 바꾼다. **빈 문자열은 null로 저장해
  파생으로 되돌린다**(workspace 기본값의 "빈 모델은 null"과 같은 규칙). 뿌리가 아닌 id를
  받으면 던진다 — 조용히 엉뚱한 행에 찍히는 것보다 낫다.
- **FR-15.** 두 메서드 모두 `RUN_UPDATE`를 내보내고 `emitInbox()`를 부른다. 종료는 배지를
  바꾸고, 이름은 도크 목록을 바꾼다.
- **FR-16.** 마이그레이션 `0008`은 `ALTER TABLE run ADD COLUMN` 둘뿐이다. **백필이 없다** —
  기존 대화는 `title=null`(파생)·`closed_at=null`(진행 중)이라 그대로 보인다.
  **테이블을 다시 만들지 않는다**: `DROP TABLE run`이 `run_context_item`의 cascade를
  태운다(`root_run_id`를 NOT NULL로 못 만드는 것과 같은 이유).

### (D) 세로 대화 목록

- **FR-17.** 도크 본문이 좌우로 갈린다. 왼쪽은 대화 목록(고정 폭, 세로 스크롤),
  오른쪽은 지금의 `ConversationPanel` 그대로다. `.dock-tabs`(가로 스트립)가 사라진다.
- **FR-18.** 목록 맨 위는 **`＋ 새 대화`**다. 그 아래에 **끝나지 않은 대화**가 마지막 턴
  최신순으로 온다(지금 `groupConversations`의 정렬 그대로).
- **FR-19.** 각 줄은 두 단이다.
  - 윗단: 상태 칩 · (답변 필요 배지) · **제목**
  - 아랫단: repo 이름 · `N턴` · 마지막 턴 시각
  제목은 잘리되 `title` 속성으로 전체를 읽는다.
- **FR-20.** 목록 맨 아래에 **`끝낸 대화 N`** 토글이 접힌 채로 있다. 펼치면 끝낸 대화가
  같은 모양으로 보이고 열 수 있다. **N이 0이면 토글 자체를 그리지 않는다.**
- **FR-21.** 줄 끝에 **이름 바꾸기**와 **대화 끝내기** 아이콘이 붙는다. 평소 폭 0이고
  hover·포커스에 펼쳐진다(`.ws-actions`·`.repo-actions`와 같은 패턴). 접근성 이름은
  `<제목> 이름 바꾸기`·`<제목> 대화 끝내기`다 — 제목을 앞에 붙여야 여러 줄이 구별된다.
  이름 바꾸기는 기존 `RenameField`를 그대로 쓴다.
- **FR-22.** 끝낸 대화 줄에는 **끝내기 아이콘이 없다**(이름 바꾸기는 있다).
- **FR-23.** 지금 열려 있는 대화를 끝내면 **`＋ 새 대화`로 돌아간다.** 사라진 대화를
  가리킨 채로 남으면 입력부가 어디로 보낼지 모르는 상태가 된다.
- **FR-24.** 취소 버튼은 `.dock-header`의 오른쪽 끝에 남는다. `Transcript`의 턴별 취소는
  `pending`에만 있어 `running`을 덮지 못한다 — 헤더 것을 없애면 실행 중인 턴을 취소할
  길이 사라진다.
- **FR-25.** 도크가 접혀 있으면 목록도 접힌다(지금과 같다). 헤더에는 토글·슬롯 표시기·취소만
  남는다 — 대화가 아무리 많아도 슬롯 표시기가 화면 밖으로 밀려나지 않는다(3b 스펙 §7이
  탭 스트립 밖에 표시기를 둔 이유가 구조적으로 해결된다).

## 3. 인터페이스

```ts
// shared/inbox.ts (새 파일 — renderer/inbox.ts에서 옮겨온다)
export type InboxCategory = 'needs-answer' | 'done' | 'failed' | 'interrupted' | 'dropped'
export const CATEGORY_LABELS: Record<InboxCategory, string>
/** 행동을 요구하는가. 배지가 세는 것과 자동 확인하는 것이 정확히 반대다 (FR-3) */
export const ACTIONABLE: Record<InboxCategory, boolean>
export function inboxCategory(run: { status: RunStatus; needsAnswer: boolean }): InboxCategory

// shared/models.ts — Run에 추가
interface Run {
  /** 사용자가 붙인 대화 이름. 뿌리 행에서만 의미가 있고 null이면 파생한다 (FR-11) */
  title: string | null
  /** 대화를 끝낸 시각. 뿌리 행에서만 의미가 있다 */
  closedAt: number | null
}

// shared/client.ts — runs에 추가
close(rootRunId: string): Promise<Run>
rename(rootRunId: string, title: string): Promise<Run>

// renderer/conversation.ts — Conversation에 추가
interface Conversation {
  /** 폴백 사다리로 정한 이름 (FR-11) */
  title: string
  /** 사용자가 직접 붙인 이름인가. 이름 바꾸기 폼의 초기값을 정한다 */
  named: boolean
  closedAt: number | null
}
```

IPC 채널은 `shared/channels.ts`에 둘을 더하고 핸들러는 얇다 — core 메서드 호출만 한다.

## 4. 화면

```
┌ 도크 ───────────────────────────────────────────────────┐
│ ▾ 실행   [실행 슬롯 1/3]                          [취소] │
├────────────────────┬────────────────────────────────────┤
│ ＋ 새 대화          │  대화록                            │
│ ● 로그인 깨짐 +2 ✎×│                                    │
│   api · 3턴 · 방금  │                                    │
│ ● 답변필요 인증 정리│  [이 대화에 담긴 것]               │
│   api · 1턴 · 5분 전│  [입력부]                          │
│ ▸ 끝낸 대화 4       │                                    │
└────────────────────┴────────────────────────────────────┘
```

- 목록 폭은 고정이고 `overflow-y: auto`다. 도크 높이는 지금처럼 드래그로 늘린다.
- 색은 `:root` 토큰에서만. 아이콘은 `icons.tsx`에서만(`IconPencil`은 있고, 끝내기 아이콘을
  하나 더한다). 아이콘은 `aria-hidden`이므로 이름은 `aria-label`이 준다.
- "끝낸 대화" 옆 개수는 괄호가 아니라 `.group-count` 알약이다(기존 규칙).

## 5. 비기능 요구사항

- **NFR-1.** `inboxCounts()`는 지금처럼 슬림한 select를 유지한다. `needs_answer` 한 컬럼만
  더 읽는다 — `assembled_prompt`를 나르지 않는다(리뷰 I-2).
- **NFR-2.** `close`·`rename`은 각각 한 트랜잭션이다.
- **NFR-3.** 대화 50개에서 도크 목록이 세로 스크롤로 버틴다. 가로 스크롤은 생기지 않는다.
- **NFR-4.** 경계 셋 그대로 — `core/`는 electron 모름, `renderer/`는 core 모름, IPC 얇음.
- **NFR-5.** 대비 4.5:1. 안내문을 `opacity`로 흐리지 않고 `--text-muted`를 쓴다.

## 6. 우려 사항 (Areas of concern)

1. **`runs.list`가 여전히 전부 가져온다.** 끝낸 대화도 렌더러가 필터해야 하므로 IPC로
   계속 나온다. 대화 수백 개에서 도크 마운트가 느려질 수 있다. **이번 범위 밖으로 두되**,
   느려지면 `list`에 `limit`을 붙이는 것이 아니라 **끝낸 대화를 따로 조회**하는 쪽이
   맞다(토글을 펼칠 때만 읽는다). 지금 붙이지 않는 이유는 측정된 문제가 아니기 때문이다.
2. **자동 확인이 "읽었다"를 과장한다.** 탭을 스치듯 눌러도 확인된다. 그래도 지금보다
   낫다 — 지금은 인박스에 가야만 내려간다. 놓치면 안 되는 것(답변 필요·실패·중단됨)은
   표에서 제외돼 있으므로 손실의 상한이 "완료된 대화를 한 번 못 봤다"다.
3. **`interrupted`가 영영 쌓일 수 있다.** 앱이 꺼져 끊긴 턴은 스스로 해소되지 않는다.
   종료로 내릴 수 있게 한 것이 답이지만, 사용자가 안 내리면 배지가 다시 무색해진다.
   한 달 뒤 다시 본다.
4. **e2e가 넓게 깨진다.** `conversation.e2e.ts`가 도크 탭을 텍스트로 잡는다. CLAUDE.md가
   경고한 "탭 텍스트로 떴다고 판단하지 말 것"이 그대로 적용된다 — `.turn-user`로 기다리는
   기존 방식은 유지한다.
5. **짧은 라벨 충돌.** "취소"·"저장"처럼 `끝내기`·`이름`도 부분 일치로 기존 e2e를 잡을 수
   있다. 새 라벨을 붙인 직후 `pnpm test:e2e`를 먼저 돌린다.
6. **`title`이 뿌리 행에만 있다는 규칙은 타입이 지켜주지 않는다.** 이어지는 턴의 행에도
   컬럼이 있고 null일 뿐이다. `rename`이 뿌리가 아니면 던지는 것(FR-14)이 유일한 방어선이다.

## 7. 검증

- **단위**
  - `shared/inbox.test.ts` — 카테고리 파생, **`ACTIONABLE`의 두 열이 서로의 부정임**(FR-3).
  - `core/db/repositories/run.test.ts` — 완료·미확인이 `inboxCounts`에 안 잡히고 `inbox()`
    에는 잡힌다(FR-4). `close`가 `reviewedAt`도 찍는다(FR-12). `create(parentRunId)`가
    `closedAt`을 지운다(FR-13). `rename('')`이 null로 저장한다(FR-14). 뿌리가 아닌 id에
    `rename`이 던진다.
  - `renderer/conversation.test.ts` — 제목 사다리 네 단(사용자 이름 > 이슈·메모 `+N` >
    repo > 첫 지시).
  - `renderer/components/Dock.test.tsx` — 목록 클릭이 자동 확인을 부른다(FR-5),
    **마운트만으로는 부르지 않는다**(FR-6), 답변 필요는 안 부른다, 끝낸 대화가 기본
    목록에 없고 토글을 펼치면 보인다(FR-20), 열린 대화를 끝내면 새 대화로 간다(FR-23).
- **회귀 확인**: `ACTIONABLE`을 전부 true로 바꾸면 FR-4 테스트가 빨개져야 하고, 자동 확인을
  `selected`에 걸면 FR-6 테스트가 빨개져야 한다. **구현 전에 망가뜨려 확인한다**(컨벤션).
- **e2e** (`e2e/conversation.e2e.ts` 확장): 2턴 대화를 끝내고 → 목록에서 사라지고 →
  "끝낸 대화"를 펼치면 다시 보이고 → 열어 턴을 보내면 기본 목록으로 돌아온다(FR-13).
  IPC 왕복(`client.runs.close` → preload → `ipcMain.handle` → 저장소)을 실제로 태운다.
- `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm test:e2e` 전부 초록.
- 기존 DB를 열어 `0008`이 한 번 돌고 그전 대화들이 제목과 함께 그대로 보인다.
