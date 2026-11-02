# Intent: repo마다 Excalidraw로 그림을 그린다

- 출처: 대화 (2026-11-02) — "tldraw 처럼 opensource 기반 찾아봐" → 후보 조사(Excalidraw · Drawnix · Quickdraw · React Flow) →
  "각 repo 에 excalidraw로 그림을 그릴수 있도록 하고 싶어". 이어 물은 세 가지에 사용자가 답했다(아래 "사용자가 정한 것").
- `docs/ideas.md`의 "무한 캔버스 (tldraw 같은 flow 그리기)"(2026-09-30)를 꺼내 쓴다 — 거기서는 지웠다.
- 작성자: 권용현 (초안: Claude)
- 상태: **승인됨** (2026-11-02, 사용자 "추천대로 진행해줘 spec 만들어줘 그리고 개발은 work tree로 개발해" — 아래 "spec 전에 정할 것"
  다섯을 전부 추천대로) — spec·plan은 `spec.md`·`plan.md`
- 작성일: 2026-11-02

## 문제

앱 안에 그림을 그릴 자리가 없다. repo의 구조나 흐름을 그려 보려면 앱 밖(웹 Excalidraw · draw.io)으로 나가야 하고, 그린 것은
repo · 대화와 떨어져 어딘가에 흩어진다. 대화를 보며 옆에서 그리고, 다음에 그 repo를 열면 그 그림이 그 자리에 있어야 한다.

## 사용자가 정한 것 (2026-11-02)

1. **라이브러리는 Excalidraw(MIT)다.** tldraw는 오픈소스가 아니다 — npm `tldraw` 5.6.0의 라이선스는 `SEE LICENSE IN LICENSE.md`이고
   실서비스에 라이선스 키가 필요하며 무료 키는 워터마크를 남긴다(ideas.md의 "확인 안 함"을 확인했다).
2. **저장은 앱 DB다** — repo에 파일로 남기지 않는다. git이 깨끗하게 남는다. 대가: agent는 그림을 볼 수 없다(repo 파일이 아니라
   `@`로도 못 짚는다).
3. **화면은 코드 칸이고, 버튼으로 별도 창에서도 연다** — "코드 칸으로 하고 버튼 클릭으로 새창으로 볼수 있게 해줘".
4. **agent와는 그리기만이다** — 이번 사이클은 사람이 그리고 저장하는 것까지. 맥락 담기 · MCP 도구 · agent가 그리기는 범위 밖.

## 현황 (읽고 확인한 것)

- **코드 칸은 두 종류다** — `renderer/code/layout.ts`의 `PaneKind = 'files' | 'terminal'`. 상태는 `Dock`이 쥐고 App이 내린 두 자리에
  포털로 그린다(칸은 `.code-column`, 버튼은 제목 줄의 `.titlebar-actions`). 대상 repo는 이어 가는 대화면 뿌리 cwd
  (`repoOfConversation`), 새 대화면 입력부의 작업 디렉토리 알약이고, 대상이 없으면 버튼이 이유를 단 채 잠긴다(`Dock.tsx` 555).
  칸 폭은 끌어서 바꾼다(최소 320px).
- **별도 창의 틀이 있다** — `shared/panelWindow.ts`의 `PanelKind = 'issue' | 'memo' | 'asset'`, 범위는 (종류, workspace, repo|전체)이고
  같은 범위는 창 하나다. 창은 `electron/windows.ts`의 `createWindow` 하나로 만들고(가드가 거기서 붙는다), 범위는 `core.panelScope`가
  검증한다. 바뀜 알림 `event:itemChanged`는 `core/changes.ts`의 래퍼가 모든 창으로 보낸다.
- **메모가 가장 가까운 저장 모양이다** — `memo`(workspace cascade · 제목 · 본문 text · 시각) + `memo_repo` 태그, `updateIfUnchanged`의
  낙관적 잠금, `useDebouncedSave` + 창 닫기 전 흘려보내기(`pendingSaves`).
- **CSP가 좁다** — `renderer/index.html`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`.
  main은 다운로드(`will-download`)와 http(s)가 아닌 새 창을 막는다.
- **Excalidraw 0.18.1** (2026-04-20, MIT, peer React `^17 || ^18 || ^19` — 앱은 React 19.2.8). `dist/prod`를 풀어 쟀다: JS 약 2.7MB
  (`index.js` 492K + 청크 1.8M · 432K), CSS 144K, 언어 1.7M(`ko-KR` 있음), **글꼴 14MB**(9종, CJK용 Xiaolai 포함). 글꼴은
  `window.EXCALIDRAW_ASSET_PATH`가 없으면 `https://esm.sh/…`에서 받는다 — 지금 CSP가 막으므로 앱에 실어야 한다.
  `validateEmbeddable` prop과 글꼴 subset worker가 있다.

## 범위 (이번 사이클)

- repo마다 그림 여럿 — 만들기 · 이름 바꾸기 · 지우기 · 목록.
- 코드 칸의 셋째 종류 — 제목 줄 `파일` · `터미널` 옆 버튼 하나, 칸 안은 그림 목록 + 캔버스.
- 칸 머리의 버튼으로 지금 그림을 별도 OS 창에서 연다.
- 자동 저장 — 메모와 같은 디바운스 · 낙관적 잠금 · 창 닫기 전 흘려보내기.
- 라이트/다크 따라가기, 한국어 UI, 오프라인(글꼴 · 언어 파일을 앱에 싣는다).

## 범위 밖

- agent 연결 전부 — 맥락 담기, MCP 도구, agent가 그리기, Mermaid → 그림 변환.
- `.excalidraw` 파일 가져오기/내보내기, 파일로 저장(다운로드가 막혀 있다), 협업 · 실시간 동기화, Excalidraw 라이브러리(공유 도형 모음),
  embeddable(iframe).
- 홈 · 리포트 · 인박스 · 검색에 그림을 올리기. repo 없는(workspace 전체) 그림.

## spec 전에 정할 것 (추천 포함)

1. **그림은 repo 하나에 속한다**(`repo_id` NOT NULL) **— 추천.** 칸이 repo 하나를 보고 "각 repo에"가 그 뜻이다. 메모처럼 태그로 두면
   repo가 없는 그림 · 여러 repo의 그림이 생겨 칸이 무엇을 보일지 흐려진다. **대가: repo를 지우면 그 그림도 지워진다**(이슈 · 메모는
   태그만 빠지고 남는다) — repo 삭제 확인에 `그림 N개도 지워집니다`를 띄운다.
2. **새 창의 단위는 그림 하나다 — 추천.** 버튼의 뜻이 "지금 보는 그림을 크게"다. 같은 그림은 창 하나(다시 누르면 앞으로 가져온다).
   대안: repo 하나 = 창 하나(창 안에 목록 + 캔버스, item-windows와 같은 모양).
3. **같은 그림이 칸과 창에 동시에 열려 있을 때 — 둘 다 고칠 수 있고 요소 단위로 합친다(추천).** Excalidraw는 요소마다 `version`을
   가지고 협업용 병합 함수가 있다 — spec에서 실측한다. 실측이 실패하면 단순안: 창이 열린 동안 칸의 그 그림은 읽기 전용.
4. **이미지 붙여넣기는 이번에 막는다 — 추천.** Excalidraw는 이미지를 dataURL로 그림 안에 넣어 그림 한 행이 수 MB가 된다
   (본문을 통째로 다시 쓰는 자동 저장마다). 대안: 허용하되 그림 하나의 상한.
5. **저장은 자동이다 — 추천.** Excalidraw는 저장 버튼이 없는 도구라 사람이 그렇게 기대한다. 코드 칸 파일의 명시적 Ctrl+S와 다르다.

## 우려

- **크기** — JS 약 2.7MB는 xterm처럼 칸을 처음 열 때 지연 로드한다. 글꼴 14MB는 패키지에 더해진다. 글꼴을 덜어 내면(예: Xiaolai)
  한국어 글자가 손글씨 글꼴로 안 그려질 수 있다 — 어떤 글꼴로 그려지는지 spec에서 실측한다.
- **보안** — 그림은 사람이 그린 것이지만 요소에 링크와 embeddable을 단다. embeddable은 전부 거부하고, 링크는 main의 가드를 그대로
  탄다. CSP를 넓혀야 하면(worker · blob 등) 필요한 것만 넓힌다.
- **조용히 아무것도 안 하는 메뉴** — Excalidraw 메뉴의 "저장 · 내보내기"는 다운로드라 main이 막는다. 메뉴에서 숨긴다.
- **키 충돌** — Excalidraw의 단축키 · Esc가 도크의 Esc 사다리와 전역 단축키(Ctrl+N · Ctrl+I · Ctrl+M · Ctrl+J)와 겹친다. 캔버스에
  포커스가 있을 때 누가 이기는지 spec에서 정한다.
- **테스트** — jsdom은 Excalidraw를 못 그린다(CodeMirror · xterm과 같다). 판정은 컴포넌트 밖 순수 함수에 두고 캔버스는 e2e가 본다.
- **마이그레이션 하나** — 새 테이블(첫 실행에 돈다).
