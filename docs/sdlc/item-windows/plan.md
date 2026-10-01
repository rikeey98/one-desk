# Plan: 이슈·메모·skill 패널을 repo마다 별도 창으로 연다

- spec: `docs/sdlc/item-windows/spec.md` (승인 2026-10-01)
- 마이그레이션 없음. 의존성 추가 없음(마크다운은 기존 `react-markdown`).
- 상태: 완료 (2026-10-01)

## 순서

각 단계는 TDD — 실패를 먼저 보고, 끝나면 대상 줄을 망가뜨려 그 테스트가 빨개지는지 본다.

### 1. 범위 해시 (shared)

- `shared/panelWindow.ts`: `PanelKind = 'issue' | 'memo' | 'asset'`, `PanelScope = { kind, workspaceId, repoId | null }`,
  `panelHash(scope)` → `#panel/<kind>/<ws>/<repo|all>`, `parsePanelHash(hash)` → scope | null, `panelScopeKey(scope)`
  (창 지도의 키).
- 테스트: 왕복, 틀린 kind, 빈 조각, `all`, `/`·`%`가 든 id(encodeURIComponent).

### 2. 바뀜 알림 (core)

- `shared/models.ts`: `ItemChange = { workspaceId, kind: 'issue' | 'memo' | 'asset' | 'repo' | 'workspace' }`.
- `core/index.ts`: `onItemChanged(cb)`. 이슈·메모·asset 저장소의 쓰기 메서드(create·update·updateIfUnchanged(ok일
  때)·remove·markSeen 제외)를 감싼 래퍼를 **한 번** 만들고, 그것을 core의 IPC 표면과 `createMcpHost`의 `deps`에
  같이 넘긴다. repo·workspace 쓰기, asset 스캔 완료도 낸다. 리스너 오류는 삼켜 `onError`.
- `core.app.panelScope(input: unknown)`: workspace 존재·repo 존재·소속을 확인하고 정규화한 scope를 돌려준다. 아니면
  던진다(FR-12).
- 테스트(`core/index.test.ts`·`core/mcp/tools.test.ts`): IPC 쪽 쓰기와 MCP `create_issue`·`update_memo` 각각이
  알림을 내는지, `updateIfUnchanged` 충돌은 내지 않는지, `panelScope`의 거부 셋(없는 ws·없는 repo·남의 repo).

### 3. IPC와 창 (electron)

- `shared/channels.ts`: `appOpenPanelWindow`, `issuesGet`은 필요 없음(창은 목록을 읽는다), 이벤트 `itemChanged`.
  `shared/client.ts`: `app.openPanelWindow(scope)`, `events.onItemChanged(cb)`. preload 배선.
- `electron/windows.ts`(새): `hardenWindow(win, appUrl)` — 지금 `createWindow` 안의 `setWindowOpenHandler`·
  `will-navigate`를 옮긴다. `createAppWindow({ hash?, width, height })` — webPreferences 한 벌. 패널 창 지도
  `Map<scopeKey, BrowserWindow>`: 있으면 restore + focus, 없으면 만든다. 앱 창 `closed`에서 패널 창 전부 `close()`.
- `registerIpc(core, getMainWindow, getAllWindows)`: run·큐·인박스·MCP·요금제는 앱 창, `itemChanged`만 전부.
  `appOpenPanelWindow`는 `core.app.panelScope` → `openPanelWindow` 호출뿐(얇다).
- 창 제목은 렌더러가 `document.title`로 정한다(Electron이 따른다) — 이름 변경 알림을 main이 따로 볼 필요가 없다.

### 4. 저장 대기 목록과 닫기 (renderer)

- `renderer/store/pendingSaves.ts`: 창마다 하나인 등록부. `useDebouncedSave`가 대기 중일 때 자기 flush를 올리고
  끝나면 내린다. `flushAll()`은 전부 흘려보내고 실패가 하나라도 있으면 false.
- 저장 콜백 계약 변경(FR-16b): `save`가 `Promise<boolean | void>` — 세 상세의 저장이 오류를 잡을 때 `false`를
  돌려준다. 디바운스 경로의 동작은 그대로다.
- `main.tsx`: `beforeunload`에서 등록부가 비어 있지 않으면 `preventDefault`(+`returnValue`) → `flushAll()` →
  성공이면 `window.close()`. 앱 창·패널 창 같은 코드(FR-16a). Provider로 등록부를 내린다(초안 스토어와 같은
  이유 — 모듈 전역 기본값 없음).
- 테스트: 등록부 단위, `useDebouncedSave`가 대기 동안만 올라가 있는지, 실패한 저장이 false를 내는지.

### 5. 패널 창 뿌리 (renderer)

- `main.tsx`가 `parsePanelHash(location.hash)`로 갈라 `App` 또는 `PanelWindow`를 그린다(`window.oneDesk`는 여전히
  이 파일에서만).
- `PanelWindow({ scope })`: workspace·repo를 읽어 제목(`이슈 · api`)과 FR-10 문구를 정하고, 고정된 범위로 패널을
  그린다. 열린 항목 id는 로컬 state. 해시가 틀리면 "열 수 없는 창입니다".
- 세 패널: 맥락 prop을 `context?: { keys, onToggle }` 하나로 묶어 선택으로 바꾼다(없으면 담기 토글이 없다) — App은
  계속 넘긴다(배선 테스트로 고정). `layout: 'columns' | 'window'` — window면 목록과 상세가 나란하다(CSS
  `.panel-window`). 헤더에 `<종류> 새 창으로 열기`는 columns일 때만.
- `useIssues`·`useMemos`·`useAssets`·`useRepos`·`useWorkspaces`가 `onItemChanged`를 구독(같은 workspace·같은 kind).
- 테스트: `PanelWindow`가 kind마다 맞는 패널·범위, 담기 토글 없음, 앱 창의 repo 선택과 무관, repo 삭제 문구. 각
  훅의 구독(다른 ws·kind 무시). App이 패널에 `context`를 넘기는지.

### 6. 본문 읽기 / 편집 (renderer)

- `renderer/components/BodyField.tsx`(새): `value`·`onChange`·`readOnly`·`label`. 모드 state(FR-21의 시작 규칙),
  전환 버튼 둘(FR-24), 읽기는 `<Markdown text={value} />`(FR-22·23), 두 번 누르면 편집.
- `IssueDetail`·`MemoDetail`·`AssetDetail`의 textarea를 이것으로 바꾼다(대칭).
- 테스트: 시작 모드, 전환, 친 글자가 읽기에 보이는지, discovered는 편집으로 못 가는지, 적대적 본문(HTML·
  `javascript:` 링크·이미지)이 `Markdown.test`의 규칙대로인지.

### 7. e2e

- 새 `e2e/panel-window.e2e.ts` — spec §3의 여덟 시나리오. 드라이버에 "새 창을 기다려 그 page를 받는" 헬퍼.
- `nav-guard.e2e.ts`에 패널 창 경우를 더한다.
- 기존 e2e 중 본문이 있는 항목의 편집칸을 채우는 곳(`body.e2e`·`asset.e2e` 등)은 `원문 편집`을 먼저 누르게
  고친다 — 전수는 구현 때 grep으로.
- 앱 창 닫기 flush(FR-16a)는 e2e로 본다: 본문을 치고 바로 `app.close()` → 다시 띄워 그 글자가 있는지.

### 8. 문서

- CLAUDE.md: 현재 상태 절에 한 문단, 함정 절에 (a) 창이 여럿이다 — push는 `getMainWindow`, 바뀜 알림만 전부,
  (b) 새 창은 `hardenWindow`를 반드시 탄다, (c) **macOS Cmd+Q 제약**(spec §5-3), (d) 저장 콜백이 실패를 돌려준다.
  문서 표에 `docs/sdlc/item-windows/`.

## 완료 증명

`pnpm typecheck`·`pnpm lint`·`pnpm test`·`pnpm test:e2e` 출력, 경계 grep 둘, 변이 표(spec §3의 다섯 + App의
`context` 배선 + `BodyField`의 Markdown을 평문으로 바꾸기), 실제 앱 캡처(패널 창 둘을 나란히 · 읽기 모드).

## 리스크

- `beforeunload`로 닫기를 미룬 뒤 `window.close()`가 Electron에서 다시 `beforeunload`를 부른다 — 등록부가 비어
  있으므로 통과하지만, 흘려보내는 사이 새 글자를 치면 다시 미룬다. 의도된 동작으로 둔다.
- 본문이 있으면 읽기로 시작하므로 기존 e2e 여럿이 깨진다 — 7단계에서 한꺼번에 고친다.
- 패널 창도 preload의 앱 API 전체를 받는다. 앱 창과 같은 신뢰 수준이라 새 노출은 아니지만, 가드가 하나라도
  빠지면 그 창이 구멍이 된다 — 그래서 `hardenWindow` 하나로 묶고 e2e로 본다.

## 계획과 달라진 것

- **바뀜 알림은 core 래퍼 모듈 하나다**(`core/changes.ts`). core가 저장소를 만드는 자리에서 감싸므로 IPC 표면과 MCP
  `deps`가 같은 변수를 받는다 — "MCP 쪽만 맨 저장소" 변이는 코드 모양상 만들 수 없어 따로 돌리지 않았다.
- **창 만들기는 `electron/windows.ts`로 옮겼다**(`createWindow` 하나 + 앱 창·패널 창 지도). `main.ts`는 부팅만 한다.
- **저장 등록부의 Provider는 없어도 던지지 않는다** — 초안 스토어와 달리 공유 상태가 없다(테스트끼리 새지 않는다).
  `main.tsx`의 Provider·`beforeunload` 줄은 e2e가 맡는다.
- **e2e 드라이버**: 모든 창의 `dialog`를 받아 닫는다(Playwright가 beforeunload를 대화상자로 보고 "No dialog is
  showing" 거부를 남긴다), `relaunch()`로 같은 데이터 디렉토리를 다시 띄운다(FR-16a).
- **frontmatter 분리(spec FR-25)**를 더했다. 그룹 이름은 `본문 보기 방식`이 아니라 `보기 방식`이다 — Playwright의
  `getByLabel('본문')`이 부분 일치로 그것까지 잡는다.
- asset 상세는 자기 Esc 처리가 없어 패널 창의 document Esc가 닫는다(앱 창과 같은 길).

## 완료 증명 (2026-10-01)

- `pnpm typecheck` 오류 0, `pnpm lint` 출력 없음, `pnpm test` — Test Files 123 passed | 2 skipped, Tests 2339 passed |
  32 skipped.
- `pnpm test:e2e`(dev가 떠 있어 작업 트리 복사본에서) — 51개 중 47 통과·2 건너뜀·2 실패. 실패 둘 중
  `panel-collapse`는 읽기 시작 규칙(FR-21) 때문이라 고쳤고 다시 돌려 통과, `composer`의 "최대화…최신으로 이동"은
  **HEAD(7912aae)에서도 같은 단언으로 실패**한다(이 작업 전부터 — 복사본에서 확인).
- 경계 grep 둘 출력 없음.
- 변이 — 전부 빨개졌다:

| 변이 | 잡은 테스트 |
|---|---|
| `updateIfUnchanged` 성공 알림 빼기 | `core/changes.test` |
| `scanWorkspace` 뒤 알림 빼기 | `core/index.test` |
| `panelScope`의 소속 검사 무력화 | `core/index.test` |
| `useIssues`의 `useItemChanged` 빼기 | `useItemChanged.test` |
| `useRepos`의 `useItemChanged` 빼기 | `PanelWindow.test`(제목 따라가기) |
| `useDebouncedSave`의 등록 빼기 | `useDebouncedSave.test` |
| save의 `false`를 무시 | `useDebouncedSave.test` |
| 실패해도 닫기(`if (ok)` 빼기) | `pendingSaves.test` (처음엔 살았다 — 기다림이 짧아 고침) |
| App의 패널 `context` 배선 셋 각각 | `App.test` |
| BodyField의 Markdown을 평문으로 | `BodyField.test` |
| MemoDetail 본문을 readOnly로 | `MemoDetail.test` |
| 패널 창 범위의 repo를 null로 | `PanelWindow.test` |
| 여는 버튼의 repo를 null로 | `OpenWindowButton.test` |
| 패널 창에서 목록·상세 나란히 빼기 | `PanelWindow.test` |
| 해시의 빈 조각 검사 빼기 | `panelWindow.test` |
| 패널 창에서 `hardenWindow` 빼기 | `nav-guard.e2e` "패널 창" |
| 범위 지도 무시(늘 새 창) | `panel-window.e2e` "repo마다" |
| `main.tsx`의 `beforeunload` 빼기 | `panel-window.e2e` FR-15·FR-16a 둘 |

- 실제 앱 캡처: 패널 헤더의 새 창 아이콘, api·web 이슈 창 나란히, 이슈 본문 마크다운 읽기, skill 창(frontmatter 분리).

## 추가: 목록 숨기기와 폭 (spec FR-26~28, 2026-10-01)

- `renderer/listWidth.ts`(클램프·저장, 순수), `renderer/components/WindowSplit.tsx`(Provider·`ListToggleButton`·
  `WindowSplit`). 세 패널은 `layout="window"`일 때 `WindowSplit`을 그리고 헤더에 숨기기 버튼을 둔다. 상세 안내문은
  "왼쪽에서"가 아니라 "목록에서 …를 고르세요"다(목록을 숨겨도 맞는 말).
- 검증: `pnpm typecheck` 오류 0, renderer 단위 테스트 전부 통과, e2e(복사본) `panel-window`·`nav-guard`·`body`·
  `panel-collapse`·`asset` 17개 통과 — 새 e2e가 실제 마우스로 경계를 150px 끌어 폭이 120px 넘게 느는 것과 숨기면 상세가
  넓어지는 것을 본다.
- 변이(전부 빨개졌다): `hidden` 속성 빼기, 숨김 저장 빼기, 그리는 폭 클램프 빼기, 키보드 저장 빼기, 메모·asset
  패널의 숨기기 버튼 빼기, 이슈 패널의 `WindowSplit`을 옛 split으로 되돌리기, 하한 빼기.
