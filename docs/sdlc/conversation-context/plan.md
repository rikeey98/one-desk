# Plan: 대화에 담긴 맥락 표시

- 출처: `intent.md`, `spec.md` (2026-09-17 승인)
- 작성자: 권용현
- 상태: 구현 완료 (2026-09-21)
- 작성일: 2026-09-17

## 변경되는 파일

전부 읽고 확인한 파일이다. 스키마·마이그레이션·IPC 핸들러·preload는 건드리지 않는다.

| 파일 | 신규/수정 | 변경 내용 |
| --- | --- | --- |
| `shared/models.ts` | 수정 | `ContextItemView extends ContextItemRef { label: string }` 추가. `Run.contextItems`의 타입을 `ContextItemRef[]` → `ContextItemView[]`. `ContextItemRef`·`StartRunInput`·`ResumeRunInput`은 그대로 |
| `core/db/repositories/run.ts` | 수정 | `import { asset }` 추가. `livingIds(type, ids): Set` → `livingNames(type, ids): Map<id, name>` — repo·asset은 `name`, issue·memo는 `title`을 `select`. `loadContext`가 네 종류 모두 이름을 붙이고, 이름 없는 것은 종류 불문 버린다. "asset은 아직 테이블이 없어 걸러내지 않는다" 주석을 spec 승인 사실로 교체 |
| `core/db/repositories/run.test.ts` | 수정 | label 부착·이름 갱신·asset 이름·지워진 asset 제외 테스트 4개. 기존 `toEqual([{ type: 'issue', id }])` 단언(42행)은 `label: '버그'`를 포함하도록 고침 |
| `renderer/conversation.ts` | 수정 | `contextOf(conversation): ContextItemView[]` — 오래된 턴부터, `canceled` 제외, `type:id`로 중복 제거 |
| `renderer/conversation.test.ts` | 수정 | `contextOf` 테스트 4개(순서·중복·취소 제외·빈 대화) |
| `renderer/components/ConversationPanel.tsx` | 수정 | `Transcript`와 `RunPanel` 사이에 `.applied-context` 줄. `contextOf(conversation)`가 비어 있으면 그리지 않는다. 종류 표 `TYPE_LABELS = { repo: 'repo', issue: '이슈', memo: '메모', asset: 'asset' }` |
| `renderer/components/ConversationPanel.test.tsx` | 수정 | 줄이 보임·버튼 없음·클릭해도 `onRemoveChip` 안 불림·null/빈 대화면 줄 없음 테스트 4개 |
| `renderer/components/Dock.test.tsx` | 수정 | 탭을 옮기면 줄 내용이 그 대화 것으로 바뀌는 테스트 1개 (`conversation` prop 배선 변이 검증) |
| `renderer/App.test.tsx` | 수정 | 549행 픽스처 `contextItems: [{ type: 'issue', id: 'i1' }, …]`에 `label` 추가 (계획에 적힌 499행은 그 뒤 커밋으로 밀렸다) |
| `renderer/components/InboxPanel.test.tsx` | 수정 | 95·105·145행 픽스처 `contextItems`에 `label` 추가. 1단계에서 발견 — 아래 「계획 이탈 기록」 |
| `renderer/index.css` | 수정 | `.applied-context`·`.applied-label`·`.applied-chip` 세 규칙, `.conversation-panel` 규칙(191행) 근처에 한 줄 형식으로. `.chip`은 재선언하지 않는다 |
| `e2e/conversation.e2e.ts` | 수정 | 1턴 전에 `샘플 맥락에 담기` 클릭. 1턴 뒤 `.applied-chip`이 `repo · 샘플` 하나, 2턴 보내기 직전 `run-chips`에 안내 문구(빈 칩), 3턴 뒤에도 `.applied-chip` 하나 |
| `docs/superpowers/specs/2026-08-18-conversation-design.md` | 수정 | §4-1 "맥락 칩은 §6의 규칙 그대로다" 문장 뒤에 한 줄 — 담긴 항목의 합집합은 표시 전용 줄로 보인다, 근거는 `docs/sdlc/conversation-context/` |
| `CLAUDE.md` | 수정 | 문서 표에 `docs/sdlc/conversation-context/` 행 추가 (`asset-scope` 행과 같은 형식) |

**건드리지 않는 것과 그 이유**

- `electron/ipc/runs.ts`·`electron/preload.ts` — `Run`을 그대로 나른다. `onRunUpdate` push는 `core/execution.ts:45`가 `opts.runs.get()`(→ `hydrate`) 결과를 넘기므로 label이 자동으로 실린다.
- `core/execution.ts` `collectContext` — 실행 시 조립용이다. 표시와 무관.
- `renderer/components/RunPanel.tsx`·`App.tsx` — 칩 줄과 `onRunStarted` 초기화는 그대로(FR-8).
- `renderer/components/InboxPanel.tsx` — `contextItems`의 `type`·`id`만 쓴다("관련 이슈 닫기"). 타입이 넓어져도 그대로 컴파일된다.

## 작업 순서

TDD로 간다. 빨간 것을 먼저 보고 초록으로 만든다. 렌더러 테스트는 **Node 22**에서 돌린다
(`nvm use 22` — Node 26은 renderer 테스트 78개를 깨뜨리는 것이 확인돼 있고 회귀가 아니다).

1. `shared/models.ts`에 `ContextItemView`를 추가하고 `Run.contextItems` 타입을 바꾼다 —
   **완료 확인**: `pnpm typecheck`가 정확히 두 곳에서 실패한다: `core/db/repositories/run.ts`의
   `loadContext`(`label` 없음)와 `renderer/App.test.tsx:549`. 다른 곳이 깨지면 그 자리도 표에 올린다.
   **실제**: 세 번째 자리 `renderer/components/InboxPanel.test.tsx`가 더 깨졌다(4곳). 표에 올렸다.
2. `run.test.ts`에 실패하는 테스트를 넣는다 — (a) `create()` 결과의 `contextItems[0].label`이 `'버그'`
   (기존 42행 단언 확장), (b) 이슈 제목을 `update`로 바꾼 뒤 `list()`의 label이 새 제목,
   (c) `createAssetRepository(db).createAuthored({ workspaceId, kind: 'skill', name: 'review' })`로
   만든 asset을 담으면 label이 `'review'`, (d) 그 asset을 `remove`한 뒤 `get()`의 `contextItems`에
   asset이 없다 — **완료 확인**: `pnpm vitest run core/db/repositories/run.test.ts`에서 새 테스트
   4개가 빨갛고, (d)는 "asset을 걸러내지 않는" 현재 동작 때문에 빨간 것을 눈으로 확인한다.
3. `run.ts`를 고친다 — `livingNames`가 종류당 한 번 `inArray`로 `{ id, name }`을 읽고,
   `loadContext`가 `{ type, id, label }`을 만들며 이름 없는 행은 네 종류 모두 건너뛴다 —
   **완료 확인**: 2의 테스트 4개 초록, `run.test.ts` 전체 초록, `loadContext` 안의 `inArray` 조회가
   종류당 하나뿐인 것을 코드에서 확인(NFR-2는 이 읽기로 증명한다 — 내부 함수라 spy가 닿지 않는다).
4. `renderer/App.test.tsx:549`와 `renderer/components/InboxPanel.test.tsx`(95·105·145행) 픽스처에 `label`을 붙인다 —
   **완료 확인**: `pnpm typecheck` 통과.
5. `renderer/conversation.test.ts`에 `contextOf` 테스트를 넣는다 — 3턴 대화: 1턴
   `[issue A, asset C]`, 2턴 `[memo B, issue A]`, 3턴(`status: 'canceled'`) `[memo D]` →
   `[A, C, B]` 이 순서. 빈 대화 → `[]`. `makeRun`의 `contextItems`에 label을 넣어 쓴다 —
   **완료 확인**: `matchers`가 `contextOf is not a function`으로 빨갛다.
6. `renderer/conversation.ts`에 `contextOf`를 쓴다 — **완료 확인**: 5의 테스트 초록. **변이**:
   중복 제거(`seen` 집합)를 지우면 `A`가 두 번 나와 빨갛고, `canceled` 필터를 지우면 `D`가 나와
   빨갛다. 둘 다 확인하고 되돌린다.
7. `ConversationPanel.test.tsx`에 테스트를 넣는다 — (a) 1턴에 이슈·asset, 2턴에 메모를 담은
   대화를 그리면 `.applied-context` 안에 `이슈 · 버그`, `asset · review`, `메모 · 절차`가 이
   순서로 있다, (b) 그 줄 안에 `button` role이 없다(`within(row).queryAllByRole('button')`이
   빈 배열), (c) 항목을 `userEvent.click`해도 `onRemoveChip`이 안 불린다, (d) `conversation=null`
   이면 `.applied-context`가 없고, `contextItems`가 전부 빈 대화도 없다 —
   **완료 확인**: 4개 빨강.
8. `ConversationPanel.tsx`와 `index.css`를 고친다 — 마크업은 spec "인터페이스" 절 그대로
   (`div.applied-context > span.applied-label + span.applied-chip*`, 항목에 `title`). CSS는 `.axis-chip`
   과 같은 모양(반투명 테두리, `cursor: default`), `.applied-context`는 `.run-chips`와 같은
   flex-wrap 줄, `.applied-label`은 `.sidebar-label`처럼 작은 대문자 라벨 —
   **완료 확인**: 7의 테스트 초록. `pnpm vitest run renderer/components/ConversationPanel.test.tsx`
   전체 초록(기존 4개 포함).
9. `Dock.test.tsx`에 탭 전환 테스트를 넣는다 — 293행 "탭을 옮기면 입력 중이던 프롬프트가…"와
   같은 골격: `renderDock([makeRun({ id: 'c1', rootRunId: 'c1', userPrompt: '대화 하나',
   contextItems: [{ type: 'issue', id: 'i1', label: '버그' }] }), makeRun({ id: 'c2', …, userPrompt:
   '대화 둘', contextItems: [{ type: 'memo', id: 'm1', label: '절차' }] })])` 후
   `userEvent.click(screen.getByText('대화 하나'))` → `.applied-chip`이 `이슈 · 버그` 하나,
   `screen.getByText('대화 둘')` 클릭 → `메모 · 절차` 하나 —
   **완료 확인**: 처음부터 초록일 것이다(배선이 이미 있다). 그래서 **변이**: `Dock.tsx:193`의
   `conversation={view === 'new' ? null : selected}`를 `conversation={null}`로 잠시 바꿔 이 테스트가
   빨개지는 것을 확인하고 되돌린다. 안 빨개지면 테스트가 배선을 안 보는 것이므로 고친다.
10. `e2e/conversation.e2e.ts`를 늘린다 — repo 등록 직후 `샘플 맥락에 담기` 클릭 → 1턴 전송 →
    `page.locator('.applied-chip')`이 `repo · 샘플` 하나가 될 때까지 `waitFor` → 2턴 채우기 전에
    `page.getByText('왼쪽 항목의 ＋를 눌러 맥락을 담으세요')`가 보이는지(칩이 비었는지) 확인 →
    기존 흐름 그대로 3턴까지 → 3턴 뒤 `.applied-chip` 개수가 여전히 1 —
    **완료 확인**: `pnpm exec electron-vite build && pnpm exec vitest run --config vitest.e2e.config.ts
    e2e/conversation.e2e.ts` 통과.
11. 문서 두 곳 — 대화 설계 §4-1에 한 문장, `CLAUDE.md` 문서 표에 한 행 —
    **완료 확인**: `git diff`에 그 두 줄만.
12. 전체 검증 — `pnpm test`(Node 22) · `pnpm typecheck` · `pnpm lint` · `pnpm test:e2e` —
    **완료 확인**: 넷 다 초록. 단위 테스트 수가 이전(881)보다 13개 이상 늘었다.
13. 커밋 하나 — `feat(conversation): show items already attached to a conversation`. 본문에
    `docs/sdlc/conversation-context/`를 가리키고, "asset 필터링 개정"을 한 줄 적는다.

## 리스크

| 리스크 | 영향 | 완화 방법 |
| --- | --- | --- |
| `Run.contextItems` 타입 확장이 예상 밖의 픽스처를 깨뜨린다 | 컴파일 실패 | 1단계에서 `pnpm typecheck`로 전수 확인. grep으로 미리 찾은 곳은 `App.test.tsx` 하나였으나 실제로는 `InboxPanel.test.tsx`도 깨졌다 — 1단계에서 전수로 잡아 표에 올렸다 |
| 지워진 asset이 이제 `contextItems`에서 빠진다 (관측 변화) | 옛 run의 항목 수가 줄 수 있음 | spec에서 승인됨. 현재 렌더러는 `contextItems`를 그리지 않아 화면 차이 없음. `run.test.ts` (d)가 새 동작을 고정 |
| 이슈 제목을 바꿔도 줄이 즉시 안 바뀐다 — label은 run 목록을 읽을 때 붙고, 제목 변경은 `onRunUpdate`를 밀지 않는다 | 다음 run 갱신(다음 턴 실행 등)까지 옛 이름이 보인다 | 받아들인다. FR-3 "지금의 이름"은 읽는 시점 기준이다. 이슈 편집이 run 갱신을 밀게 하는 것은 이 범위 밖이고, 필요해지면 별도 intent |
| `.applied-chip`이 `.chip` 규칙을 물려받아 클릭 가능해 보인다 | FR-4 위반처럼 보임 | 다른 클래스 이름, `cursor: default` 명시(`.axis-chip` 선례). 8단계 완료 확인에서 실제 앱 화면을 한 번 본다 |
| e2e에서 `.applied-chip` 대기가 도크 재마운트 타이밍에 걸린다 | 간헐 실패 | 기존 파일의 규칙을 따른다 — 대화록 쪽 요소가 뜬 뒤에 확인하고, 고정 sleep 대신 `waitFor`/`expect.poll` |
| Node 26으로 렌더러 테스트를 돌려 78개 실패를 회귀로 오해 | 헛디버깅 | 작업 순서 머리말에 명시. `nvm use 22` 후 `node -v` 확인 |
| `Dock.test.tsx` 탭 전환 테스트가 배선을 안 보고 통과 | 배선 변이 무방비(3a·3b 반복 결함) | 9단계에서 `conversation={null}` 변이로 반드시 빨간 것을 본 뒤 되돌린다 |
| 프리티어를 습관적으로 돌려 `index.css`를 갈아엎음 | 1000줄 노이즈 diff | 이 저장소는 `pnpm format`을 쓰지 않는다. 손으로 한 줄 형식 유지. 커밋 전 `git diff --stat`로 줄 수 확인 |

## 완료 증명

- [x] `pnpm test` (Node 22.23.2) — 71 파일 통과, 977개 통과 / 28 skip. 계획이 적은 기준선(881)은 그 뒤 슬래시 커맨드 작업으로 밀렸다
- [x] `pnpm typecheck` — 오류 0
- [x] `pnpm lint` — 소스(`core renderer shared electron e2e`) 오류 0. 저장소 전체로 돌리면 691개가 나오는데 전부 `.claude/worktrees/`에 남은 남의 워크트리의 `out/` 빌드 산출물이다(eslint의 `ignores`가 `out/**`만 막아 중첩 경로를 놓친다). 이 작업과 무관한 선행 상태라 손대지 않았다
- [x] `pnpm test:e2e` — 15 파일 통과(`conversation.e2e.ts`의 새 단언 셋 포함)
- [x] 변이 3건을 각각 빨간 채로 봤다 — `contextOf` 중복 제거 제거(2 failed), `canceled` 필터 제거(2 failed), `Dock.tsx:194` `conversation={null}`(「탭을 옮기면 담긴 것 줄도 그 대화의 것으로 바뀐다」가 빨강). 셋 다 되돌렸다
- [x] `grep -rn "client\." renderer/components/ConversationPanel.tsx` — 출력 없음 (NFR-1)
- [x] 경계 grep 둘 다 출력 없음
- [x] `git diff --stat renderer/index.css` — 3줄 추가(주석 2줄 포함 5줄)
- [x] 실제 앱 화면 확인 — e2e가 띄운 진짜 Electron 창을 1턴 뒤에 찍었다. 칩 줄 바로 위에 `이 대화에 담긴 것  (repo · 샘플)`이 흐린 회색 테두리 알약으로 보이고, 아래 칩 줄은 비어 안내 문구만 있다. `.chip`(파란 테두리)과 눈에 띄게 다르고 `cursor: default`다 — `.chip`은 클래스 정확 선택자라 물려받는 규칙이 없다(grep으로 확인). 종류 넷을 한 번에 담은 화면은 e2e 자동화로 세우지 못해 `ConversationPanel.test.tsx`가 잡는 순서·라벨 단언으로 대신했다
- [x] FR-8은 `core/context/assemble.test.ts`의 「맥락이 없으면 지시만 담는다」가 이미 고정하고 있다(`<context>` 없음). 이 작업은 `core/execution.ts`의 `collectContext`를 건드리지 않았고, e2e가 2·3턴에서 칩 줄이 빈 것을 확인한다

## 계획 이탈 기록

- **1단계 (2026-09-21).** 타입 확장으로 깨지는 자리가 계획이 예측한 둘이 아니라 **셋**이었다.
  `renderer/components/InboxPanel.test.tsx`의 픽스처 4곳(95·105·145행)이 `contextItems`에
  `label` 없이 리터럴을 쓰고 있었다. 계획의 "다른 곳이 깨지면 그 자리도 표에 올린다"에 따라
  변경 파일 표에 행을 더하고 4단계 범위를 넓혔다. 설계·범위 변화는 없다 — 픽스처에 이름만
  붙인다. `App.test.tsx`의 행 번호도 499 → 549로 밀려 있어 바로잡았다.
- **12단계 (2026-09-21).** `pnpm lint`가 691개 오류로 빨갰는데 전부 이 작업 밖이었다 —
  `.claude/worktrees/dazzling-bun-9cc04f/out/`에 남은 워크트리 빌드 산출물이다. 그 워크트리는
  깨끗하고 HEAD(`facf254`)가 이미 `main`에 들어가 있다. eslint의 `ignores: ['out/**', ...]`가
  루트만 막아 중첩 경로를 놓치는 것인데, 고치는 것도 워크트리를 지우는 것도 이 작업의
  범위가 아니라 남겨 두고 소스 디렉토리로 한정해 검증했다.
- **수동 확인 둘을 자동화 안에서 했다.** GUI를 손으로 띄우려면 진짜 CLI가 필요한데,
  e2e가 띄우는 것도 같은 빌드·같은 CSS의 진짜 Electron 창이다. 1턴 뒤에 `.conversation-panel`을
  찍어 눈으로 확인했다(위 완료 증명). FR-8은 화면이 아니라 조립기의 문제라 기존 단위
  테스트가 이미 고정하고 있어 로그를 열 필요가 없었다.
