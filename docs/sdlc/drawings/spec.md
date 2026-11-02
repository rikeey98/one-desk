# Spec: repo마다 Excalidraw로 그림을 그린다 — 첫째 사이클

- intent: `intent.md` (승인 2026-11-02)
- 상태: **승인됨** (2026-11-02, 사용자 "추천대로 진행해줘 spec 만들어줘 그리고 개발은 work tree로 개발해" — 앞선 terminal-tabs ·
  agent-proposals와 같이 spec · plan · 구현을 한 번에 맡긴 말이다). 사용자가 뒤집을 수 있는 결정은 §9에 모았다.
- 작성일: 2026-11-02

## 0. 실측 (spec 전에 읽고 잰 것)

`@excalidraw/excalidraw` 0.18.1의 npm 패키지를 풀어 읽었다(`dist/prod`·`dist/dev`·`dist/types`).

| 무엇 | 본 것 | 이 spec에 미치는 것 |
|---|---|---|
| 합치기 | `reconcileElements(local, remote, appState)`가 공개돼 있다. 요소마다 `version`이 큰 쪽, 같으면 `versionNonce`가 작은 쪽이 이기고, 지금 편집 중인 요소(글 편집 · 크기 조절 · 새로 그리는 중)는 늘 local이다. remote에 없고 local에만 있는 요소는 남는다 | **지운 요소를 묘비(`isDeleted: true`)로 남겨 저장해야 한다** — 빼면 다른 창이 그 요소를 되살린다(FR-3) |
| 직렬화 | `serializeAsJSON`은 지운 요소를 걸러낸다(`_clearElements` = `getNonDeletedElements`) | 저장에 쓰지 않는다. 요소 배열을 그대로 싣는다(FR-3) |
| 바뀜 판정 | `getSceneVersion`(버전 합)·`hashElementsVersion`(versionNonce 해시) 공개 | 장면 열쇠 = 개수 · 버전 합 · 해시(FR-21) |
| 글꼴 | `dist/prod/fonts` 14MB(9종). 경로는 `"./fonts/…"` 글자이고 `window.EXCALIDRAW_ASSET_PATH`(없으면 `https://esm.sh/…`)를 앞에 붙인다. 그 값이 `./`·`/`로 시작하면 `new URL(…, location.origin)`으로 푼다 | file: 문서의 origin은 `"null"`이라 상대 경로가 깨진다 — **문서 주소 기준의 절대 URL**을 준다(FR-29). esm.sh는 CSP가 막는다 |
| 한국어 | 손글씨 글꼴 Xiaolai의 unicode-range에 `U+ac00-ac58` 등 한글 음절이 있다. 언어 파일 `ko-KR`이 있다 | Xiaolai를 덜어 내지 않는다(13MB — 쓰는 조각만 내려받는다) |
| 끼워 넣기 | `validateEmbeddable`(true = 전부 허용, 없으면 유튜브 · 피그마 등 기본 허용 목록), `renderEmbeddable` | 함수로 전부 거부하고 그리지 않는다(FR-26) |
| 도구 · 메뉴 | `UIOptions.canvasActions`(`loadScene`·`saveToActiveFile`·`export`·`saveAsImage`·`changeViewBackgroundColor`·`clearCanvas`·`toggleTheme`), `UIOptions.tools.image`, `aiEnabled` | 파일 · 다운로드 · 이미지 · AI를 끈다(FR-25) |
| 의존성 | 설치하면 패키지 370개가 더해진다(mermaid · radix 등, 렌더러 번들에만 든다). radix 1.0.x가 React 18까지를 peer로 적어 경고가 난다(Excalidraw 0.18은 React 19를 peer로 받는다). 2주가 안 된 판 둘(`es-toolkit` 1.53.1, `vscode-languageserver-textdocument` 1.0.16 — 둘 다 mermaid 밑)이 끌려온다 | `pnpm.overrides`로 앞 판(1.52.0 · 1.0.15)에 묶는다(NFR-5) |

브라우저에서만 알 수 있는 것(CSP 아래 글꼴 · worker, Esc · 단축키를 Excalidraw가 `preventDefault`하는지, 환영 화면 · 라이브러리 버튼의
클래스, 이미지 붙여넣기 · 끌어 놓기의 길)은 plan 0단계가 진짜 앱에서 잰다. 결과가 이 spec과 다르면 이 spec을 고친다.

## 1. 범위

| | 이번 사이클 |
|---|---|
| 안 | 그림 저장소(DB 테이블 하나) · 코드 칸의 셋째 종류 `그림` · 그림 하나의 별도 창 · 자동 저장과 창 사이 합치기 · repo 삭제의 개수 경고 · 글꼴을 앱에 싣기 |
| 밖 | agent 연결 전부(맥락 담기 · MCP · Mermaid), `.excalidraw` 가져오기 · 내보내기 · 파일 저장, 이미지, 협업, 라이브러리, embeddable, 홈 · 리포트 · 인박스 · 검색, repo 없는 그림 |

## 2. 데이터

새 테이블 `drawing` (마이그레이션 `0013` — `pnpm db:generate`):

| 열 | 형 | |
|---|---|---|
| `id` | text pk | `randomUUID()` |
| `workspace_id` | text not null → `workspace.id` cascade | 바뀜 알림 · 소속 검증 |
| `repo_id` | text not null → `repo.id` cascade | **그림은 repo 하나에 속한다** (intent 결정 1) |
| `title` | text not null | |
| `scene` | text not null | 아래 JSON |
| `created_at` · `updated_at` | integer not null | epoch ms. `updated_at`은 낙관적 잠금의 버전이다 |

인덱스 `drawing_repo_idx (repo_id, created_at)`.

`scene`은 Excalidraw 파일과 같은 머리에 **요소 배열만** 싣는다:

```json
{ "type": "excalidraw", "version": 2, "source": "one-desk", "elements": [ … ] }
```

`appState`(스크롤 · 확대 · 선택 · 배경색)와 `files`(이미지)는 없다. 지운 요소는 `isDeleted: true`로 남는다(FR-3).

## 3. core

- **FR-1 저장소** `core/db/repositories/drawing.ts`의 `createDrawingRepository(db)`:
  - `list({ workspaceId, repoId? })` → `DrawingSummary[]`(scene 없음), `created_at` 오름차순 · id. repoId가 없으면 그 workspace 전부(repo 삭제의
    개수 경고가 쓴다 — §7).
  - `get(id)` → `Drawing`(scene 포함). 없으면 `NotFoundError`.
  - `create({ workspaceId, repoId, title? })` → `Drawing`. **repo가 그 workspace 소속인지 트랜잭션 안에서 본다**(이슈 · 메모의
    `assertReposInWorkspace`와 같은 이유 — 외래키는 존재만 본다). 제목이 없으면 FR-5, 장면은 빈 장면.
  - `rename(id, title)` → `DrawingSummary`. 앞뒤 공백을 걷고 비면 던진다.
  - `saveScene({ id, scene, expectedUpdatedAt })` → `{ ok: true, drawing: DrawingSummary } | { ok: false, current: Drawing }`. 메모의
    `updateIfUnchanged`와 같은 모양이다(충돌은 오류가 아니라 결과다).
  - `remove(id)`.
- **FR-2 `updated_at`은 단조 증가한다** — `Math.max(Date.now(), 이전 + 1)`. 같은 밀리초의 두 저장이 충돌을 놓치지 않게(메모와 같다).
  `rename`도 올린다 — 그 다음 장면 저장이 한 번 충돌하고 합쳐진다(무해하다, §9의 7).
- **FR-3 장면 검증** `core/drawings/scene.ts`의 `assertScene(text)` — `saveScene`이 쓰기 전에 부른다:
  JSON 객체이고 `elements`가 배열이며 각 원소가 문자열 `id`를 가진 객체여야 한다. 길이(`string.length`)는 `MAX_SCENE_CHARS` =
  8,388,608 이하. 어기면 한국어 오류로 던진다(`그림이 너무 큽니다 (8 MiB 초과)` 등). 요소의 종류는 보지 않는다 — 이미지 · 끼워 넣기를
  여기서 거부하면 그것이 하나 섞인 그림은 영영 저장되지 않는다(막는 자리는 화면이다, FR-25·26).
- **FR-4 바뀜 알림** `core/changes.ts`의 `notifyingDrawings` — `create`·`rename`·`saveScene`(ok만)·`remove`가
  `{ workspaceId, kind: 'drawing' }`을 낸다. `ItemChange['kind']`에 `'drawing'`을 더한다. 읽기는 내지 않는다.
- **FR-5 새 그림의 이름** `core/drawings/title.ts`의 `nextDrawingTitle(titles)` — `그림 N`에서 그 repo에 비어 있는 가장 작은 N(1부터).
  `그림 2`만 있으면 `그림 1`이다(터미널 탭 이름과 같은 규칙).
- **FR-6 MCP에 넘기지 않는다** — agent는 그림을 못 본다(intent 결정 2·4). `core/index.test`가 MCP `deps`에 그림 저장소가 없음을
  지킨다(reports · home과 같은 방식).
- **FR-7 cascade** — repo를 지우면 그 repo의 그림이, workspace를 지우면 그 workspace의 그림이 지워진다(외래키 — `openDb`의
  `foreign_keys = ON`에 기댄다). repo 경로를 바꿔도 그림은 그대로다(id로 묶인다).

## 4. IPC · 클라이언트

채널 `drawings:list`·`get`·`create`·`rename`·`saveScene`·`remove`와 `app:openDrawingWindow`. 핸들러는 core 호출 하나다(경계 3).
클라이언트는 `drawings: { list, get, create, rename, saveScene, remove }`와 `app.openDrawingWindow(id)`.

## 5. 별도 창 — 그림 하나 = 창 하나

- **FR-8 해시** `#drawing/<id>` — `shared/drawingWindow.ts`의 `drawingHash`·`parseDrawingHash`·`isDrawingHash` 한 쌍(main이 만들고 렌더러가
  읽는다, `panelWindow.ts`와 같은 이유). 패널 창(`PanelKind`)에 끼우지 않는다 — 패널 창의 범위는 (종류, workspace, repo)이고 그림 창의
  범위는 행 하나라 `panelScope`의 검증과 `PanelWindow`의 그리기가 둘 다 맞지 않는다.
- **FR-9 열기** — `app:openDrawingWindow(id)`는 core의 `drawings.get(id)`로 있는 그림인지 본 뒤(문자열이 아니거나 없으면 던진다) main의
  `openDrawingWindow(id)`를 부른다. 같은 그림의 창이 있으면 앞으로 가져온다(최소화됐으면 되살린다). 창은 `createWindow` 한 길로 만들고
  (가드 · preload가 같이 붙는다) 크기는 1280×860, OS 제목 표시줄이다. **앱 창이 닫히면 같이 닫힌다**(패널 창과 같다 — `close()`라 대기
  중인 저장을 흘려보낸다).
- **FR-10 창 안** — `renderer/main.tsx`가 그림 해시면 `DrawingWindow`를 그린다(`ClientProvider` · `PendingSavesProvider` · `guardUnload` — 패널
  창과 같다). 머리 한 줄(제목 · repo 이름 · 저장 상태)과 캔버스(FR-24~)뿐이다. **이름 바꾸기 · 지우기는 코드 칸에만 있다.** 창 제목
  (`document.title`)은 `그림 · <제목>`이고 이름이 바뀌면 따라간다. 그림이 지워졌으면 `이 그림은 삭제됐습니다`(role=alert)를 세우고
  캔버스를 내린다 — 저장을 멈춘다.

## 6. 코드 칸의 그림 칸

- **FR-11 종류** — `PaneKind`에 `'drawing'`. 제목 줄 버튼 `그림`(새 아이콘 `IconDraw`)이 `터미널` 왼쪽에 선다. 켜지는 조건 · 비활성 이유 ·
  "같은 종류를 다시 누르면 닫힌다"는 파일 · 터미널과 같다(대상 repo — `paneTarget`).
- **FR-12 머리** — 첫 줄: repo 이름 · `그림 고르기`(지금 그림의 제목 + ▾, 없으면 `그림 없음`) · `새 그림` · `그림 새 창으로 열기` ·
  `코드 칸 닫기`. 둘째 줄(그림이 열려 있을 때): `그림 이름 바꾸기`(제목 편집 칸 — 빈 이름은 취소) · 저장 상태(`저장 중…`·`저장됨`·실패
  문구) · `그림 삭제`(두 번 누르기 `정말 삭제?`).
- **FR-13 고르기 메뉴** — `그림 고르기`가 그 repo의 그림을 `role="menu"`로 편다(만든 순서, 지금 그림은 `aria-current`). 고르면 그 그림을 연다.
  ↑↓ · Enter · Esc는 터미널의 `셸 고르기` 메뉴와 같다(Esc는 메뉴만 닫는다).
- **FR-14 무엇을 여나** — repo마다 마지막으로 본 그림 id를 이 장비의 localStorage(`one-desk.drawing.open.<repoId>`)에 둔다. 없거나
  지워졌으면 가장 최근에 고친 그림이다. 그림이 없으면 본문이 `이 repo에 그림이 없습니다`와 `새 그림`이다.
- **FR-15 새 그림** — core가 이름을 붙여(FR-5) 만들고 곧바로 연다.
- **FR-16 지우기** — 지운 그림이 지금 그림이면 남은 것 중 가장 최근에 고친 것을 연다. 그 그림이 창에 열려 있으면 창이 FR-10의 안내로 바뀐다.
- **FR-17 목록은 바뀜 알림으로 다시 읽는다** — `useItemChanged(workspaceId, 'drawing')`. 다른 창의 저장 · 이름 바꾸기가 머리의 제목에
  보인다.
- **FR-18 칸을 닫거나 repo가 바뀌면 대기 중인 저장을 흘려보낸다** — 캔버스가 언마운트될 때(`useDebouncedSave`의 규칙 그대로).

## 7. repo 삭제의 경고

- **FR-19** 사이드바 repo 줄의 삭제(`ConfirmButton`)는 그 repo에 그림이 있으면 확인 글이 `그림 N개도 지워집니다 · 정말 삭제?`다(없으면
  `정말 삭제?` 그대로 — 기존 e2e가 그 이름에 기댄다). 개수는 `drawings.list({ workspaceId })`를 repo로 센다. `useItemChanged`의
  `'drawing'`·`'repo'`에 다시 읽는다. 이슈 · 메모는 태그만 떼고 남는다는 기존 주석을 "그림은 지운다"로 고친다.

## 8. 캔버스 — `renderer/components/drawing/`

`DrawingCanvas`가 Excalidraw를 감싼다. 코드 칸과 창이 같은 컴포넌트를 쓴다.

- **FR-20 지연 로드** — `@excalidraw/excalidraw`를 import하는 것은 `DrawingCanvas.tsx`(와 그 CSS) **하나뿐**이고, 그것을 `lazy`로 부른다
  (CodeMirror · xterm과 같다). 합치기 함수까지 그 안에서 넘긴다 — 순수 모듈(FR-21)이 Excalidraw를 import하면 앱 시작 번들에 2.7MB가 든다.
  앱 시작 청크의 크기가 바뀌지 않았음을 plan의 완료 증명이 잰다.
- **FR-21 동기화 규칙은 순수 함수다** — `renderer/drawing/sync.ts`. Excalidraw를 모른다: 합치기(`reconcile`)와 장면 열쇠(`sceneKey`)를
  인자로 받는다. 규칙:
  1. 열 때 `get`의 장면으로 시작하고 `expected = updatedAt`, `synced = sceneKey(요소)`.
  2. 캔버스가 바뀌면(onChange) 열쇠가 `synced`와 다를 때만 저장을 건다(600ms 디바운스 — 선택 · 스크롤 · 확대는 요소 버전을 바꾸지 않아
     저장하지 않는다).
  3. 저장은 지운 것을 포함한 요소 전부를 싣는다(§0). 성공하면 `expected`·`synced`를 새것으로.
  4. **충돌**이면 받은 `current`의 요소와 지금 요소를 합쳐 캔버스에 넣고(`expected = current.updatedAt`) 곧바로 다시 저장한다 — 세 번까지.
     그래도 충돌이면 실패다.
  5. **바뀜 알림**이 오면 그 그림을 다시 읽는다. `updatedAt ≤ expected`면 버린다. **열쇠가 내가 마지막에 저장한 것과 같으면 내 저장의
     메아리다** — `expected`만 올린다(저장 응답보다 알림이 먼저 올 수 있다: core가 알림을 보낸 뒤 응답을 돌려준다). 아니면 합쳐서 넣고
     `expected`·`synced`를 받은 것으로 — 내게 저장 안 한 고친 것이 있었다면 합친 장면의 열쇠가 달라 2번이 다시 저장한다.
  6. 그림이 지워졌으면(`NotFoundError`) 멈추고 FR-10의 안내를 세운다.
  다른 창에서 온 것은 되돌리기 기록에 넣지 않는다(`CaptureUpdateAction.NEVER`) — 되돌리기가 남의 창이 그린 것을 지우면 안 된다.
- **FR-22 저장 실패** — 저장 콜백은 실패를 `false`로 돌려준다(창 닫기가 멈춘다, item-windows FR-16b). 머리의 저장 상태가 `그림을
  저장하지 못했습니다: <이유>`다.
- **FR-23 열 때의 보기** — 스크롤 · 확대는 저장하지 않는다. 열 때마다 내용에 맞춘다(`scrollToContent`).
- **FR-24 테마 · 언어** — `langCode="ko-KR"`, `theme`는 `prefers-color-scheme`를 따라간다(바뀌면 그 자리에서).
- **FR-25 끄는 것** — `UIOptions.canvasActions`: `loadScene`·`saveToActiveFile`·`export`·`saveAsImage`·`changeViewBackgroundColor` false,
  `toggleTheme` 숨김. `UIOptions.tools.image` false. `aiEnabled` false. 주 메뉴는 앱이 고른 항목만(찾기 · 도움말 · 캔버스 지우기 — 소셜
  링크 · Excalidraw+ · 불러오기가 없다). 환영 화면(외부 링크 · 불러오기)과 라이브러리 버튼(저장할 자리가 없고 가져오기가 외부 사이트로
  간다)은 세우지 않는다 — 막는 길은 plan 0단계가 정한다.
- **FR-26 끼워 넣기** — `validateEmbeddable`은 늘 false를 돌려주는 함수, `renderEmbeddable`은 늘 null이다. 요소의 링크는 Excalidraw의
  기본 동작대로 열리고, 새 창 요청은 main의 가드(http(s)만 OS 브라우저, 나머지 거부)를 탄다.
- **FR-27 이미지 · 파일이 들어오는 길을 막는다** — 붙여넣기(`onPaste`)는 클립보드에 파일이 있거나 붙일 데이터에 `files`가 있으면 거부하고,
  캔버스에 끌어 놓은 파일(이미지 · `.excalidraw` 장면 — 놓으면 지금 그림을 통째로 바꾼다)은 감싸는 요소가 capture 단계에서 막는다.
- **FR-28 키** — 그림 칸 안의 Esc는 Excalidraw의 것이다: 감싸는 요소가 전파를 막는다(도크 최대화 · App의 "열린 항목 닫기"로 새지 않게 —
  칸은 도크가 포털로 그려 React 이벤트가 도크로 올라간다, 터미널과 같은 규칙). `isEditableTarget`이 `.excalidraw` 안을 글 받는 자리로 본다
  (수정키 없는 `?`가 앱 도움말과 Excalidraw 도움말을 같이 열지 않게). 수정키 단축키(Ctrl+N 등)는 Excalidraw가 처리한(`defaultPrevented`)
  키만 감싸는 요소가 막는다 — 나머지는 앱의 것 그대로다.

## 9. 빌드 — 글꼴

- **FR-29** 렌더러 빌드가 `node_modules/@excalidraw/excalidraw/dist/prod/fonts`를 `out/renderer/excalidraw-assets/fonts`로 복사하고, 개발 서버는
  같은 경로를 node_modules에서 바로 준다 — `electron.vite.config.ts`의 작은 플러그인 하나. 복사는 `readdirSync` + `copyFileSync`다
  (`cpSync`는 Windows Node 22에서 한글 경로에 프로세스째 죽는다 — CLAUDE.md). `DrawingCanvas`가 Excalidraw를 그리기 전에
  `window.EXCALIDRAW_ASSET_PATH = new URL('excalidraw-assets/', document.baseURI).href`를 세운다(§0의 origin 문제 — 해시는 버려진다).
  CSP는 plan 0단계가 막히는 것을 볼 때만, 그 하나만 넓힌다.

## 10. NFR

- **NFR-1** 세 경계를 지킨다 — core는 electron · Excalidraw를 모른다(장면은 core에게 검증한 문자열이다), 렌더러는 core를 import하지 않는다,
  IPC 핸들러는 한 줄이다.
- **NFR-2** 앱 시작 청크(`index-*.js`)에 Excalidraw가 들지 않는다(FR-20).
- **NFR-3** 새 이름이 기존 e2e와 부분 일치로 부딪히지 않는다 — `그림`·`그림 고르기`·`새 그림`·`그림 새 창으로 열기`·`그림 이름 바꾸기`·`그림 삭제`.
  `그림 새 창으로 열기`는 `<종류> 새 창으로 열기` 모양이고 기존 e2e는 그것을 `exact`로 잡는다.
- **NFR-4** 칸의 색은 `index.css`의 토큰이다(hex를 쓰지 않는다). Excalidraw 안의 색은 Excalidraw의 테마가 정한다.
- **NFR-5** CodeMirror처럼 의존성을 한 벌로 묶는다 — `@excalidraw/excalidraw`는 정확한 판(`-E`)이고, 2주가 안 된 하위 판은 `pnpm.overrides`로
  앞 판에 묶는다(§0).
- **NFR-6** 패키지의 크기가 글꼴 약 14MB · JS 수 MB만큼 는다 — plan의 완료 증명에 렌더러 산출물의 크기를 남긴다.

## 11. 테스트

- core: 저장소(만들기 · 목록 순서 · 소속 검증 · 이름 · 충돌이 `current`를 돌려준다 · 단조 `updated_at` · 장면 검증 셋 · cascade 둘), 바뀜 알림
  (ok만), `nextDrawingTitle`, MCP `deps`에 없음.
- shared: 그림 해시의 왕복 · 모양이 틀린 해시.
- renderer: `sync.ts`(저장 거르기 · 충돌 합치기 · 세 번 · 메아리 · 남의 바뀜 · 지워짐), `PaneKind`, `isEditableTarget`, 그림 칸(가짜 캔버스 —
  jsdom은 Excalidraw를 못 그린다: 비었을 때 · 새 그림 · 고르기 메뉴 · 이름 · 지우기 · 새 창 버튼), repo 삭제의 확인 글, `Dock`의 `그림` 버튼.
- e2e `e2e/drawing.e2e.ts` — 진짜 Excalidraw: 그림 칸을 열고 새 그림에 사각형을 그리면 DB에 요소 하나가 남는다 · 앱을 다시 켜도 남는다 ·
  새 창에서 그린 것이 칸에 합쳐진다(둘 다 남는다) · 한글 글자가 손글씨 글꼴로 그려진다(`document.fonts`) · 콘솔에 CSP 위반이 없다 · repo
  삭제의 확인 글. 요소 수는 main에서 DB를 읽어 센다(`home.e2e`의 `runSql`과 같은 방식).

## 12. 뒤집을 수 있는 결정

1. **repo를 지우면 그 그림도 지워진다** — 이슈 · 메모는 남는다. 대신 확인 글이 개수를 말한다(FR-19).
2. **창은 그림 하나이고, 창에는 이름 바꾸기 · 지우기가 없다**(FR-10) — 창은 "크게 보기"다.
3. **지운 요소가 묘비로 쌓인다**(§2) — 합치기에 필요하다. 오래된 묘비를 걷는 규칙은 없다(그림이 커지는 것을 보며 정한다).
4. **이미지를 막는다**(FR-25·27) — 그림 한 행이 수 MB가 되는 것을 피한다.
5. **내보내기가 없다** — 다운로드는 main이 막는다. PNG 클립보드 복사는 Excalidraw의 오른쪽 클릭 메뉴에 남는다(plan 0단계가 확인).
6. **스크롤 · 확대를 저장하지 않는다**(FR-23).
7. **이름 바꾸기도 `updated_at`을 올린다**(FR-2) — 다른 창의 다음 저장이 한 번 합쳐진다. 열을 하나 더 두는 것보다 단순하다.
8. **라이브러리 · 환영 화면을 세우지 않는다**(FR-25).
