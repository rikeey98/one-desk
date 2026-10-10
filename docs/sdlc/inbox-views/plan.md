# Plan: 인박스를 시간순 · workspace별 · 상태별로 본다

- 출처: `spec.md` (승인 2026-10-10)
- 상태: 승인 (2026-10-10, 사용자 — "좋아 커밋하고 0단계부터 구현 시작해")

## 순서

각 단계는 테스트를 먼저 쓰고 빨간 것을 본 뒤 구현한다. 회귀 테스트는 대상 줄을 망가뜨려 빨개지는지 본다(아래 "변이").

0. **기준선** — `pnpm typecheck`·`pnpm lint`·`pnpm test`가 초록인지, 인박스 e2e(`e2e/inbox.e2e.ts`)가 통과하는지 본다.
1. **경로로 repo 찾기 한 자리** (NFR-2) — `renderer/conversation.ts`에 `repoOfCwd(cwd, repos)`를 떼고 `repoOfConversation`과
   `renderer/code/target.ts`가 그것을 쓰게 한다. 동작은 바뀌지 않는다 — `conversation.test.ts`에 `repoOfCwd` 테스트(끝 구분자 ·
   Windows 대소문자 · 없으면 null)를 더하고, 기존 구획·코드 칸 테스트가 초록인 채로 남는지 본다.
2. **순수 함수** `renderer/inboxView.ts` (NFR-1) + `inboxView.test.ts`
   - 타입 `InboxMode`(`'time' | 'workspace' | 'status'`)·`InboxOrder`(`'desc' | 'asc'`).
   - `sortInbox(items, order)` (FR-2) — 끝난 시각 최신순(안정 정렬 — 같은 시각은 core가 준 순서), `asc`는 그 결과를 뒤집는다.
   - `repoOfItem(run, reposByWorkspace)` (FR-6) — **그 run의 workspace의** repo에서만 `repoOfCwd`로 찾는다.
   - `sourceLabel(run, workspaces, reposByWorkspace)` (FR-5) — `workspace · repo`, repo를 모르면 workspace만, workspace가 없으면
     `(사라진 workspace)`.
   - `groupByWorkspace(items, order, workspaces, reposByWorkspace)` (FR-6·7) — workspace 묶음 → repo 묶음. 묶음 순서는 정렬한
     목록에서 첫 항목이 나온 순, `기타`는 workspace 안 맨 아래, 사라진 workspace는 맨 아래. 키 `ws:<id>`·`repo:<id>`·`other:<wsId>`.
   - `groupByStatus(items, order)` (FR-10) — `STATUS_ORDER`(답변 필요 → 실패 → 중단됨 → 완료·미확인 → 대기 중 취소됨) 고정, 빈
     카테고리 없음. 키 `status:<카테고리>`.
   - 묶음마다 `needsAnswer`(FR-13) — 그 안에 답변 필요가 있는가.
3. **기억** — 같은 파일에 `readInboxView`/`writeInboxView`(FR-3, 키 `one-desk.inbox.view`, 모르는 값 → `time`·`desc`)와
   `readInboxCollapsed`/`writeInboxCollapsed`(FR-14, 키 `one-desk.inbox.collapsed`). 저장소가 막혀도 던지지 않는다
   (`dockSections.ts`·`code/layout.ts`와 같은 모양).
4. **repo 읽기 훅** `renderer/hooks/useInboxRepos.ts` (FR-16·17) + 테스트 — `(workspaces, open)` → `{ reposByWorkspace, error }`.
   열려 있을 때만 workspace마다 `repos.list`를 함께 부르고, workspace 목록이 바뀌면 다시 읽는다. 늦게 온 옛 응답은 버린다. 실패한
   workspace는 빠지고(그 항목은 `기타`) 실패 문장을 `error`로 낸다.
5. **`InboxPanel`** + `InboxPanel.test.tsx`
   - 필수 prop `reposByWorkspace`.
   - 도구 줄(FR-1·4): `인박스 보기` 그룹의 세 칸 + 정렬 버튼. 보기·정렬·접힘 state는 마운트할 때 저장소에서 읽고 바뀔 때 쓴다.
   - 항목 카드를 `InboxItem`으로 뗀다 — 머리에 무엇을 보일지(카테고리 칩 · 소속)를 보기에 따라 받는다(FR-9·11). 몸통과 행동은 그대로
     (FR-18 — 기존 "카테고리마다 보이는 행동 버튼 집합" 표 테스트가 그대로 초록이어야 한다).
   - 묶음 머리 `InboxGroupHeader`(FR-12·13): 꺾쇠 · 이름 · 개수 알약 · 접혔을 때 답변 필요. 이름 `<이름> 묶음`.
   - 시간순은 지금 구조 그대로 `ul.inbox-list > li.inbox-item`이다(NFR-3 — 기존 e2e 셀렉터).
6. **App 배선** (FR-16) — `useInboxRepos(workspaces, view === 'inbox')`를 부르고 `reposByWorkspace`를 내린다. 오류는 인박스 오류
   자리에 합친다(행동 오류 → 목록 오류 → repo 오류 순). `App.test`: 다른 workspace의 run이 인박스에 `ws · repo`로 보인다(가짜
   `repos.list`가 workspace로 거르게 고친다).
7. **CSS** (NFR-4) — 도구 줄, 보기 세 칸은 `.body-mode` 규칙에 선택자를 더해 같은 모양으로, 정렬 버튼(오래된 먼저면 화살표를
   뒤집는다), 묶음 머리는 `.dock-section` 규칙에 선택자를 더하고 repo 묶음은 들여 쓴다. 토큰만, 라이트·다크.
8. **e2e** — `e2e/inbox.e2e.ts`에 테스트 하나: repo가 있는 workspace에서 대화를 돌리고 인박스에서 `workspace별` → `<ws> · 샘플 묶음`
   안에 그 항목, 머리를 누르면 항목이 숨음, `상태별` → `완료 · 미확인 묶음`, 정렬 버튼 이름이 `정렬: 오래된 먼저`로 바뀜. 그다음 전체 e2e.
9. **캡처** — 임시 `e2e/zz-*.e2e.ts`로 세 보기 × 라이트·다크(+ 접힌 머리)를 찍어 보내고, 고친 뒤 임시 파일을 지운다.
10. **문서** — CLAUDE.md(현재 상태 한 단락 · 함정이 생기면 그 절 · 문서 표), DESIGN.md(인박스 도구 줄과 묶음 머리), 이 plan의 완료 증명.

## 바뀌는 파일

`renderer/conversation.ts`(+test) · `renderer/code/target.ts` · `renderer/inboxView.ts`(+test, 새 파일) ·
`renderer/hooks/useInboxRepos.ts`(+test, 새 파일) · `renderer/components/InboxPanel.tsx`(+test) · `renderer/App.tsx`(+test) ·
`renderer/index.css` · `e2e/inbox.e2e.ts` · `CLAUDE.md` · `DESIGN.md` · 이 plan.

core·electron·shared는 바뀌지 않는다.

## 변이 (되돌려 빨개지는지 볼 것)

| 망가뜨릴 줄 | 빨개져야 할 테스트 |
|---|---|
| `asc`를 뒤집기가 아니라 오름차순 비교로 정렬 | 같은 시각끼리의 순서까지 뒤집힌다(FR-2) |
| `repoOfItem`이 모든 workspace의 repo에서 찾음 | 다른 workspace의 같은 경로 repo는 잡지 않는다(FR-6) |
| `기타`를 맨 아래로 보내는 줄을 지움 | workspace 안 묶음 순서(FR-7) |
| 묶음 순서를 첫 항목이 아니라 이름순으로 | 묶음 순서가 정렬을 따른다(FR-7) |
| `STATUS_ORDER`의 두 칸을 바꿈 | 상태 묶음의 고정 순서(FR-10) |
| 접힘을 저장소에 쓰는 줄을 지움 | 다시 마운트해도 접힌 채다(FR-14) |
| 보기·정렬을 저장소에 쓰는 줄을 지움 | 다시 마운트해도 보기·정렬이 남는다(FR-3) |
| 훅의 의존성에서 workspace 목록을 뺌 | workspace가 늘면 그 repo도 읽는다(FR-16) |
| App이 `reposByWorkspace`에 빈 객체를 넘김 | App 배선 테스트(FR-16) |

## 위험

1. **`InboxPanel.test`의 표 테스트는 화면의 모든 버튼을 센다.** 도구 줄의 버튼 넷이 그 집합에 들어가 표가 깨진다 — 항목 카드
   (`li.inbox-item`) 안으로 좁혀 세게 고친다. 표의 내용은 바꾸지 않는다.
2. **App.test의 가짜 `repos.list`는 workspace를 가리지 않는다.** 그대로 두면 배선 테스트가 "모든 workspace에 같은 repo"로 통과해
   FR-6의 "그 workspace의 repo만"을 못 본다 — 가짜가 `workspaceId`로 거르게 고친다(다른 테스트는 repo의 workspace가 하나라 영향 없음).
3. **묶음 머리의 이름에 workspace 이름이 들어간다.** 사이드바 workspace 버튼을 정규식 없이 `{ name: 'e2e-…' }`로 잡는 e2e가 인박스
   묶음 보기에서 그것을 누르면 둘이 걸린다 — 기본 보기가 시간순이고 e2e마다 데이터 디렉토리가 새로 생겨(기억이 넘어가지 않는다) 지금
   e2e에는 해당하지 않는다. 전체 e2e로 확인한다.
4. **InboxPanel이 커진다** — 판정은 전부 `inboxView.ts`에 두고, 컴포넌트에는 state(보기·정렬·접힘)와 그리기만 둔다.

## 완료 증명

(구현 뒤에 채운다)
