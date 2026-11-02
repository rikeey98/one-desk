# Plan: repo마다 Excalidraw로 그림을 그린다 — 첫째 사이클

- 출처: `spec.md`
- 상태: **승인됨** (2026-11-02, 사용자 "추천대로 진행해줘 spec 만들어줘 그리고 개발은 work tree로 개발해") — 구현은 worktree
  `.claude/worktrees/drawings`(브랜치 `feat/drawings`)에서 한다. spec §12의 결정 여덟은 사용자가 뒤집을 수 있다.

## 순서

각 단계는 테스트를 먼저 쓰고 빨간 것을 본 뒤 구현한다. 회귀 테스트는 대상 줄을 망가뜨려 빨개지는지 본다(아래 "변이"). 단계마다 끝의
확인이 초록이어야 다음으로 간다.

0. **기준선과 실측**
   - 기준선(2026-11-02, Linux 컨테이너 · xvfb): `pnpm typecheck` 초록. `pnpm test` 3,318 통과 · 1 실패 — `core/files/write.test`의 읽기 전용
     파일 테스트가 root로 돌아 쓰기에 성공한다(이 환경의 문제, 이 작업과 무관). `code-pane.e2e` 통과. 앱 시작 청크 `index-*.js` 1,490,643 B.
     `pnpm install`의 postinstall(electron-rebuild)은 `www.electronjs.org`가 프록시에 막혀 실패한다 — better-sqlite3는 N-API 사전 빌드를
     먼저 집으므로 결과에 영향이 없다(CLAUDE.md).
   - 실측(spec §0의 "브라우저에서만 알 수 있는 것"): 앱과 같은 CSP · file: 문서로 Excalidraw를 띄운 버리는 하네스(커밋하지 않는다)로 —
     글꼴과 worker가 CSP 아래에서 뜨는가, 한글이 Xiaolai로 그려지는가, Esc · 수정키를 Excalidraw가 `preventDefault`하는가, 환영 화면과
     라이브러리 버튼을 세우지 않는 길, 이미지 붙여넣기 · 파일 끌어 놓기의 길, 오른쪽 클릭의 PNG 복사.
   - 확인: 결과를 아래 "0단계 결과"에 적고, spec과 다르면 spec을 고친다.

1. **공유 모양** — `shared/models.ts`에 `Drawing`·`DrawingSummary`·`CreateDrawingInput`·`DrawingListQuery`·`SaveSceneInput`·`SaveSceneResult`,
   `ItemChange['kind']`에 `'drawing'`. `shared/drawingWindow.ts`(해시 셋) + `shared/drawingWindow.test.ts`(core 프로젝트가 `shared/**`를 잡는다).
   - 확인: 그 테스트 초록.

2. **저장소** — `core/db/schema.ts`의 `drawing`, `pnpm db:generate`로 `drizzle/0014_*.sql`(처음엔 `0013` — 병합하며 옮겼다)(생성된 SQL을 읽는다 — 외래키 둘 · cascade · 인덱스),
   `core/drawings/scene.ts`(`assertScene`·`EMPTY_SCENE`·`MAX_SCENE_CHARS`), `core/drawings/title.ts`(`nextDrawingTitle`),
   `core/db/repositories/drawing.ts`. 테스트는 spec §11의 core 목록(cascade는 repo · workspace를 실제로 지워 본다).
   - 확인: `pnpm test core/drawings core/db` 초록, `core/db/migrations.test` 초록.

3. **core 배선** — `core/changes.ts`의 `notifyingDrawings`, `core/index.ts`의 `drawings` 표면(감싼 저장소)과 `drawingWindowTarget(id: unknown)`
   (문자열 · 있는 그림인지 — 창을 열기 전에 IPC가 부른다). MCP `deps`에는 넣지 않는다. `core/index.test`: 쓰기가 알린다 · 충돌은 알리지 않는다 ·
   MCP deps에 없다(소스를 읽는 기존 방식) · repo 삭제가 그림을 지운다.
   - 확인: `pnpm test core` 초록(기준선의 그 하나 빼고).

4. **통로** — `shared/channels.ts`·`shared/client.ts`·`electron/preload.ts`·`electron/ipc/drawings.ts`(+ `index.ts` 등록)·`electron/ipc/app.ts`의
   `appOpenDrawingWindow`, `electron/windows.ts`의 `openDrawingWindow(id)`(그림 id마다 하나, 앱 창이 닫히면 같이 닫는다), `electron/main.ts` 배선.
   - 확인: `pnpm typecheck` 초록. 경계 grep 둘이 비어 있다.

5. **글꼴** — `electron.vite.config.ts`의 렌더러 플러그인: 개발 서버는 `/excalidraw-assets/fonts/*`를 node_modules에서 주고, 빌드는
   `out/renderer/excalidraw-assets/fonts`로 복사한다(`readdirSync` + `copyFileSync`).
   - 확인: `pnpm build` 뒤 `out/renderer/excalidraw-assets/fonts`에 아홉 폴더가 있다.

6. **동기화 규칙** — `renderer/drawing/sync.ts` + 테스트(spec FR-21의 여섯 — 가짜 `reconcile`·`sceneKey`). 장면 직렬화(`sceneText`)도 여기다
   (지운 요소를 남긴다).
   - 확인: `pnpm test renderer/drawing` 초록.

7. **그림 칸** — `renderer/code/layout.ts`의 `'drawing'`, `icons.tsx`의 `IconDraw`, `renderer/drawing/openDrawing.ts`(FR-14의 localStorage),
   `renderer/components/drawing/DrawingCanvas.tsx`(lazy — Excalidraw를 import하는 유일한 파일)·`DrawingPane.tsx`·`useDrawings.ts`,
   `Dock.tsx`의 버튼과 칸, `shortcut.ts`의 `isEditableTarget`, `index.css`. 단위: 그림 칸(캔버스는 `vi.mock`), Dock의 버튼, `isEditableTarget`.
   - 확인: `pnpm test renderer` 초록.

8. **그림 창** — `renderer/components/drawing/DrawingWindow.tsx`, `renderer/main.tsx`의 분기. 단위: 지워진 그림의 안내 · 제목.
   - 확인: `pnpm test renderer` 초록.

9. **repo 삭제의 경고** — `RepoStrip.tsx`(FR-19) + 테스트.
   - 확인: `pnpm test renderer/components/RepoStrip` 초록.

10. **e2e** — `e2e/drawing.e2e.ts`(spec §11). 진짜 앱에서 캡처(라이트 · 다크, 칸 · 창)를 `e2e/artifacts/`에 남겨 본다.
    - 확인: 그 파일과 `code-pane`·`terminal`·`panel-window`·`nav-guard`·`settings` e2e 초록, 이어서 `pnpm test:e2e` 전체.

11. **변이** — 아래 표를 하나씩 되돌려 빨개지는지 본다.

12. **문서** — CLAUDE.md(현재 상태 한 단락 · 함정: 묘비 · 자산 경로 · Excalidraw import 한 자리 · 문서 표), 이 plan의 완료 증명.

## 변이 (11단계)

| 되돌릴 줄 | 빨개져야 할 것 |
|---|---|
| `sceneText`가 지운 요소를 거른다 | sync 테스트 "지운 요소를 남겨 저장한다", e2e "다른 창에서 지운 것이 되살아나지 않는다" |
| 저장소 `create`의 소속 검증 | "다른 workspace의 repo에는 만들 수 없다" |
| `updated_at`의 `+1` | "같은 밀리초의 두 저장도 충돌을 잡는다" |
| `notifyingDrawings`가 충돌에도 알린다 | "충돌로 끝난 저장은 알리지 않는다" |
| MCP `deps`에 그림을 넣는다 | "그림은 MCP deps에 없다" |
| sync의 메아리 판정 | "내 저장의 메아리는 캔버스를 건드리지 않는다" |
| sync의 다시 시도 | "충돌하면 합쳐서 다시 저장한다" |
| Dock의 `그림` 버튼 | Dock 테스트 |
| `isEditableTarget`의 `.excalidraw` | shortcut 테스트 |
| RepoStrip의 확인 글 | RepoStrip 테스트 |
| `EXCALIDRAW_ASSET_PATH` 한 줄 · 글꼴 복사 플러그인 | e2e "한글이 손글씨 글꼴로 그려진다" |
| `main.tsx`의 그림 해시 분기 | e2e "새 창에서 그린 것이 칸에 합쳐진다" |
| 끌어 놓기 막기 | e2e "파일을 끌어 놓아도 그림이 바뀌지 않는다" |

## 0단계 결과

하네스: 앱과 같은 CSP의 `index.html` + Excalidraw를 Vite로 빌드해(`out/spike/` — 커밋하지 않는다) 앱과 같은 Electron 43.3.0으로
file:에서 띄우고 Playwright로 몰았다(xvfb). 처음에 일반 Chromium으로 file:을 열었더니 module 스크립트가 뜨지 않았다 — Electron만 된다.

1. **`EXCALIDRAW_ASSET_PATH`는 Excalidraw를 import하기 전에 세워야 한다.** 모듈 맨 위의 대입은 늦다 — ESM import가 먼저 평가되고,
   Excalidraw는 모듈을 불러오는 순간 글꼴을 등록하며 주소를 만든다(그때 값이 없으면 esm.sh만 남는다). 그래서 대입만 하는 모듈을 따로
   두고 Excalidraw보다 먼저 import한다(spec FR-29 고침).
2. **로컬 글꼴은 CSP 아래 file:에서 뜬다** — `fetch`도 `FontFace.load()`도 된다. 한글을 치면 Xiaolai가 `loaded`가 된다.
3. **그래도 콘솔에 CSP 오류가 231줄 찍힌다.** Excalidraw는 글꼴마다 `url(로컬), url(esm.sh)`를 한 `FontFace`의 원본 목록으로 주고,
   Chromium은 그 목록의 원격 주소를 등록할 때 CSP 위반으로 알린다(실제로 내려받지는 않는다 — 로컬이 먼저 되므로). 대체 주소
   (`ASSETS_FALLBACK_URL`)는 공개되지 않은 정적 값이라 끌 수 없다. 그래서 Excalidraw보다 먼저 `FontFace`의 원본 목록에서
   `https://esm.sh/@excalidraw/excalidraw@`로 시작하는 원본만 걷는다(spec FR-29 고침 — 판정은 순수 함수).
4. **이미지 붙여넣기 · 이미지 끌어 놓기는 `tools.image: false`가 이미 막는다** — Excalidraw가 `isToolSupported("image")`를 보고
   "이미지 도구 미지원"을 띄운다(소스 확인 — `onPaste`보다 앞이다). 남는 길 둘: 다른 Excalidraw에서 복사한 요소에 이미지가 섞인 붙여넣기
   (`data.files`/`image` 요소 — `onPaste`가 거부한다), 그리고 **끌어 놓은 `.excalidraw` 파일 · 장면이 든 PNG는 지금 장면을 통째로
   바꾼다**(`loadFileToCanvas`) — 감싸는 요소의 capture 단계 막기가 필요하다(실측: 막으면 요소 수가 그대로다).
5. **환영 화면은 자식(`MainMenu`)을 넘기면 서지 않는다.** 라이브러리 버튼(`라이브러리`, `.sidebar-trigger`)은 선다 — CSS로 숨긴다.
6. **키** — 캔버스 안의 Esc와 Ctrl+Z는 Excalidraw가 전파를 막는다(감싸는 요소에 오지 않는다). Ctrl+N · I · M · J · Shift+I · Shift+H는
   `defaultPrevented` 없이 문서까지 간다 — 앱의 단축키로 그대로 산다. `?`는 Excalidraw가 도움말을 연다(앱 도움말도 열린다 —
   `isEditableTarget`이 막아야 한다). Ctrl+I는 Excalidraw의 스포이트도 켠다(수정키를 보지 않는다) — 무해하다(Esc로 풀린다).
7. **합치기** — `reconcileElements`가 버전이 큰 remote를 고른다(묘비 포함 2개 → 2개). 지운 요소는 `version`이 오르고 `isDeleted: true`로
   `getSceneElementsIncludingDeleted()`에 남는다.

## 달라진 것 (구현 중)

1. **빈 칸의 버튼은 `첫 그림 만들기`다** — 머리의 `새 그림`과 이름이 같으면 한 화면에 같은 이름의 버튼이 둘이다(spec FR-14 고침).
2. **IPC의 `get`은 없는 그림에 null이다**(`core.drawings.find`) — preload가 오류의 클래스를 벗겨 렌더러가 `NotFoundError`를 가려낼 수 없다.
   저장소의 `get`은 그대로 던진다(spec FR-21의 6 고침).
3. **동기화 규칙이 일곱이 됐다 — 날아가는 저장과 같은 장면은 다시 걸지 않는다**(spec FR-21의 7). 첫 e2e가 본문은 초록인데 앱 종료가 멈춰
   찾았다: Excalidraw가 다시 그려질 때마다 onChange를 불러(넘기는 속성이 렌더마다 새것이었다) 같은 장면의 저장이 늘 대기로 남았고, 창 닫기가
   그것을 흘려보내느라 닫히지 않았다. 열쇠 하나와 속성 고정 둘 다 했다 — 열쇠만으로도 끝나지만 속성이 새것이면 저장마다 캔버스가 다시 그려진다.
4. **라이브러리 숨김의 선택자** — 처음 쓴 `.default-sidebar-trigger`는 Excalidraw의 CSS(뒤에 불린다)에 졌고, 실제로 보이는 것은 그것을 감싼
   `label.sidebar-trigger__label-element`였다(캡처로 찾았다).
5. **그림 창의 글꼴** — 창 뿌리에 `font-family`가 없어 머리가 serif로 그려졌다(캡처). 패널 창 뿌리와 같게 고쳤다.
6. **지운 뒤 고른 것을 비우는 줄을 지웠다** — 변이가 살아남아 읽어 보니 쓸데없었다(지운 id는 `pickOpenDrawing`이 무시한다).

## 완료 증명

- 단위: `pnpm test` 3,397 통과(기준선 3,318 + 79) · 1 실패 — 기준선의 그것(root라 읽기 전용 파일을 쓴다). `pnpm typecheck`·`pnpm lint` 초록.
  경계 grep 둘(`from 'electron'` in core, `window.oneDesk` outside main.tsx) 출력 없음.
- 앱 시작 청크: 1,490,643 B → 1,509,681 B(+19,038 B — 그림 칸·창·동기화 코드, Excalidraw 없음). Excalidraw는 지연 청크(`percentages-*` 1.7 MB ·
  `index-*` 1.36 MB · `subset-shared` 1.8 MB, mermaid 청크들)로 나간다. 렌더러 산출물 28 MB(글꼴 14 MB 포함).
- 변이(11단계): 아래 표의 단위 열여섯은 전부 빨개졌다. 살아남은 하나(`setChosen(null)`)는 쓸데없는 줄이라 지웠다(달라진 것 6).

| 되돌린 줄 | 빨개진 테스트 |
|---|---|
| `sceneText`가 지운 요소를 거른다 | sync "지운 요소를 남겨 저장한다" |
| 저장소 `create`의 소속 검증 | "다른 workspace의 repo에는 만들 수 없다" |
| `updated_at`의 `+1` | "같은 밀리초의 두 저장도 충돌을 잡는다" |
| `notifyingDrawings`가 충돌에도 알린다 | changes "그림: … 충돌로 끝난 저장과 읽기는 알리지 않는다" |
| MCP `deps`에 그림 | "그림은 MCP deps에 없다" |
| sync의 메아리 판정 | "내 저장의 메아리는 캔버스를 건드리지 않는다" |
| sync의 다시 시도(3 → 1) | 충돌 테스트 셋 |
| sync의 날아가는 저장 판정 | "저장이 날아가는 사이 같은 장면의 onChange는 저장을 다시 걸지 않는다" |
| Dock의 `그림` 버튼 | Dock "그림 버튼은 칸을 그 대화 repo의 그림 칸으로 바꾼다" |
| `isEditableTarget`의 `.excalidraw` | shortcut "그림 칸(Excalidraw) 안은 글 받는 자리다" |
| RepoStrip의 확인 글 | RepoStrip "그 repo에 그림이 있으면 확인 글이 개수를 말한다" |
| `pickOpenDrawing`의 가장 최근 | openDrawing·DrawingPane 셋 |
| 그림 창이 이름을 따라간다 | DrawingWindow "코드 칸에서 바꾼 이름을 따라가고…" |
| `find`의 null | core "그림 창은 있는 그림만 연다" |
| 원격 대체 글꼴 걷기 | guards "esm.sh의 Excalidraw 원본만 걷는다" |
| 붙여넣기의 이미지 요소 | guards "붙일 데이터에 파일이 있거나 이미지 요소가 섞였으면 막는다" |

e2e 변이 여섯(줄마다 다시 빌드해 `e2e/drawing.e2e.ts`)도 전부 빨개졌다:

| 되돌린 줄 | 빨개진 자리 |
|---|---|
| `sceneText`가 지운 요소를 거른다 | 창에서 지운 것이 칸의 저장으로 되살아나 장면이 바뀐다 |
| `EXCALIDRAW_ASSET_PATH` 한 줄 | Xiaolai가 `loaded`가 되지 않는다 |
| `FontFace` 감싸기 | CSP 위반 230줄 |
| `main.tsx`의 그림 해시 분기 | 새 창에 캔버스가 서지 않는다(앱 창이 그려진다) |
| 그림 창의 `guardUnload` | 그리자마자 닫은 창의 도형이 저장되지 않는다 |
| 끌어 놓기 막기 | 끌어 놓은 `.excalidraw`가 장면을 바꾼다 |

- e2e 전체: `pnpm test:e2e` 33 파일 · 69 테스트 통과, 3 파일 건너뜀(진짜 CLI · WSL · opencode — 이 환경에 없다). 300초.
