# Plan: 대화에 담긴 맥락 표시

- 출처: `intent.md`, `spec.md` (2026-09-17 승인)
- 작성자: 권용현
- 상태: draft
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
| `renderer/App.test.tsx` | 수정 | 499행 픽스처 `contextItems: [{ type: 'issue', id: 'i1' }, …]`에 `label` 추가 — 타입 변경으로 컴파일이 깨지는 유일한 자리 |
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
   `loadContext`(`label` 없음)와 `renderer/App.test.tsx:499`. 다른 곳이 깨지면 그 자리도 표에 올린다.
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
4. `renderer/App.test.tsx:499` 픽스처에 `label: '이슈 1'`·`label: '이슈 2'`를 붙인다 —
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
| `Run.contextItems` 타입 확장이 예상 밖의 픽스처를 깨뜨린다 | 컴파일 실패 | 1단계에서 `pnpm typecheck`로 전수 확인. grep으로 미리 찾은 곳은 `App.test.tsx:499` 하나 — 나머지 `makeRun` 헬퍼는 `contextItems: []`라 안전 |
| 지워진 asset이 이제 `contextItems`에서 빠진다 (관측 변화) | 옛 run의 항목 수가 줄 수 있음 | spec에서 승인됨. 현재 렌더러는 `contextItems`를 그리지 않아 화면 차이 없음. `run.test.ts` (d)가 새 동작을 고정 |
| 이슈 제목을 바꿔도 줄이 즉시 안 바뀐다 — label은 run 목록을 읽을 때 붙고, 제목 변경은 `onRunUpdate`를 밀지 않는다 | 다음 run 갱신(다음 턴 실행 등)까지 옛 이름이 보인다 | 받아들인다. FR-3 "지금의 이름"은 읽는 시점 기준이다. 이슈 편집이 run 갱신을 밀게 하는 것은 이 범위 밖이고, 필요해지면 별도 intent |
| `.applied-chip`이 `.chip` 규칙을 물려받아 클릭 가능해 보인다 | FR-4 위반처럼 보임 | 다른 클래스 이름, `cursor: default` 명시(`.axis-chip` 선례). 8단계 완료 확인에서 실제 앱 화면을 한 번 본다 |
| e2e에서 `.applied-chip` 대기가 도크 재마운트 타이밍에 걸린다 | 간헐 실패 | 기존 파일의 규칙을 따른다 — 대화록 쪽 요소가 뜬 뒤에 확인하고, 고정 sleep 대신 `waitFor`/`expect.poll` |
| Node 26으로 렌더러 테스트를 돌려 78개 실패를 회귀로 오해 | 헛디버깅 | 작업 순서 머리말에 명시. `nvm use 22` 후 `node -v` 확인 |
| `Dock.test.tsx` 탭 전환 테스트가 배선을 안 보고 통과 | 배선 변이 무방비(3a·3b 반복 결함) | 9단계에서 `conversation={null}` 변이로 반드시 빨간 것을 본 뒤 되돌린다 |
| 프리티어를 습관적으로 돌려 `index.css`를 갈아엎음 | 1000줄 노이즈 diff | 이 저장소는 `pnpm format`을 쓰지 않는다. 손으로 한 줄 형식 유지. 커밋 전 `git diff --stat`로 줄 수 확인 |

## 완료 증명

- [ ] `nvm use 22 && pnpm test` — 전부 통과, 테스트 수 ≥ 894 (881 + 신규 13)
- [ ] `pnpm typecheck` — 오류 0
- [ ] `pnpm lint` — 오류 0
- [ ] `pnpm test:e2e` — 전부 통과(`conversation.e2e.ts`에 새 단언 포함)
- [ ] 변이 3건을 각각 빨간 채로 본 기록: `contextOf` 중복 제거 제거, `contextOf` canceled 필터 제거, `Dock.tsx:193` `conversation={null}`
- [ ] `grep -rn "client\." renderer/components/ConversationPanel.tsx` — 출력 없음 (NFR-1)
- [ ] `grep -n "from 'electron'" core/` — 출력 없음, `grep -rn "window.oneDesk" renderer/ | grep -v main.tsx` — 출력 없음 (경계 유지)
- [ ] `git diff --stat renderer/index.css` — 추가 3줄 안팎
- [ ] 수동: 앱을 띄워 repo·이슈·asset을 담아 1턴, 메모를 담아 2턴 실행 → 3턴 입력 화면에 넷이 `repo · / 이슈 · / asset · / 메모 ·`로 보이고 커서를 올려도 손 모양이 아니다. 인박스 → 대화 열기 → 같은 줄. `+ 새 대화` → 줄 없음
- [ ] 수동: 위 상태에서 아무것도 안 담고 3턴 실행 → 로그의 assembled prompt(자세히)에 `<context>`가 없다(FR-8)

## 계획 이탈 기록

없음.
