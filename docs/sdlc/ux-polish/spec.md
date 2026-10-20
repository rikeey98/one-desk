# Spec: UI/UX 분석이 꼽은 여덟 가지

- 출처: `intent.md`
- 작성자: 권용현 (초안: Claude)
- 상태: 승인 (2026-10-20, 사용자 — "다 적용해줘")
- 작성일: 2026-10-20

## 1. 범위

렌더러만 바뀐다. core·IPC·스키마·마이그레이션 없음. 리포트의 제안(FR-2)은 이미 있는 `core.reports.build`를 preset마다 한 번 더
부르는 것이고, 제목 줄(FR-6)은 `document.title`까지만이다(main의 창 제목은 그것을 따른다).

**빠지는 것**: intent "범위 밖".

## 2. 기능 요구사항

### ① 상세와 도크

- **FR-1** 이슈·메모·asset 상세가 열려 있는 동안 도크는 **하한(`MIN_DOCK_PX` = 280px)** 으로 내려간다. 끌기 손잡이는 그동안 없다.
  닫으면 끌어 둔 높이로 돌아온다 — **저장된 높이(`readDockHeight`)는 건드리지 않는다.** 도크의 필수 prop `compact`이고 App이
  `openItem !== null`을 내린다. 최대화한 도크는 그대로다(최대화가 세 패널을 숨긴다 — 상세가 열릴 길이 없다).

### ② 빈 상태

- **FR-2a** 코드 칸의 파일 목록을 못 얻으면(`treeResult.ok === false`) 오른쪽 칸의 "왼쪽 목록에서 파일을 고르세요"를 그리지
  않는다 — 왼쪽의 이유(`code-pane-reason`)만 남는다.
- **FR-2b** 리포트가 고른 기간에 비면 안내 아래에 **데이터가 있는 가장 가까운 preset**을 개수와 함께 제안한다 —
  `이번 주 → 지난 7일 → 지난주 → 지난 30일` 순으로 지금 preset을 건너뛰며 `reports.build`를 불러 처음으로 개수가 0보다 큰
  것. 개수는 이슈 + 메모 + 대화(`reportItemCount`). 누르면 그 preset으로 `onQueryChange`. 어디에도 없으면 "기간을 넓혀 보세요".
  기본 preset(period-report FR-4)은 그대로다. 직접 지정 기간에서는 묻지 않는다.

### ③ 한국어

- **FR-3** 패널 제목 `이슈`·`메모`·`스킬 / 에이전트`, asset 구획 `스킬`·`에이전트`·`지시 파일`, 사이드바 구분 `워크스페이스`.
  이슈 목록의 상태 배지는 `renderer/issueStatus.ts`의 `ISSUE_STATUS_LABELS`(`열림`·`진행 중`·`완료`) 하나이고 상세의 상태
  드롭다운도 같은 표다(값은 enum 그대로). **`열림`은 배지를 그리지 않는다**(`showsStatusBadge`) — 기본 상태에 배지를 달면 목록
  전체가 같은 말을 반복한다. 클래스(`.status-<enum>`)는 그대로다.

### ④ 개수

- **FR-4** 훑기 배너의 개수는 괄호가 아니라 `.group-count` 알약이다(`⚠ 정리 안 됨 [3]`). 버튼 이름은 `훑기`(옛 `훑어보기`).

### ⑤ 입력 카드

- **FR-5** 알약 다섯(agent · 모델 · effort/variant · 권한 · 작업 디렉토리)이 **값만** 보인다 — `pill-name` 접두사를 뺀다. 빈 값의
  이름이 종류를 말한다: effort 드롭다운의 빈 항목은 `effort 기본값`(`EFFORT_OPTIONS` 한 표 — 설정 화면도 같은 글자), variant
  placeholder는 `variant 기본값`, 모델 칸은 `compact` 모드에서 placeholder `모델 기본값`이고 이름(`모델`)은 `sr-only`로 남아
  접근성 이름이 그대로다.

### ⑥ 제목 줄

- **FR-6** 제목 줄 가운데(`.titlebar-title`, `aria-hidden` — 사이드바가 이미 같은 정보를 접근성 트리에 준다)에 지금 보는 범위:
  workspace 화면이면 `<workspace> · <repo>`(repo를 안 골랐으면 workspace만), 인박스·리포트·설정이면 그 이름. `document.title`은
  `<범위> — one-desk`, 범위가 없으면 `one-desk`. 제목 줄은 drag 영역이라 글자는 누를 수 없다(code-editor 함정 2).

### ⑦ 접힌 사이드바

- **FR-7** 접힌 사이드바에서 workspace가 **둘 이상이면** 화면 이동 타일 아래 `워크스페이스` 목록(`.ws-tiles`)이 선다 — 타일은
  이름의 첫 글자(`initialOf`), `aria-label`·`title`이 전체 이름, 고른 것은 `.ws-tile-selected` + `aria-current`, 배지는 그 workspace의
  인박스 수. 하나뿐이면 타일이 없다. 펼쳐져 있으면 목록이 타일을 대신한다 — 같은 이름의 버튼이 둘 서지 않는다.

### ⑧ 단축키

- **FR-8** 전역 단축키 표는 `renderer/shortcut.ts`의 `SHORTCUTS` 하나다: 새 대화 Ctrl+N · 새 이슈 입력칸 Ctrl+I · 새 메모 입력칸
  Ctrl+M · 대화창 보이기/숨기기 Ctrl+J · 인박스 Ctrl+Shift+I · 단축키 목록 `?`. 수정키는 Ctrl과 ⌘를 둘 다 받고(실행 단축키와
  같다) Alt가 섞이면 아무것도 아니다. **수정키 없는 키(`?`)는 글을 받는 자리(`isEditableTarget` — input·textarea·select·
  contentEditable·CodeMirror·xterm) 안에서 듣지 않는다.** 판정(`matchShortcut`)·도움말·버튼 `title`(`withShortcut`)이 같은 표를
  읽는다.
- **FR-9** App이 keydown을 받아 **받는 쪽에 일회성 prop으로 내린다 — DOM을 짚지 않는다.** 도크 토글은 `Dock`의 필수 prop
  `toggleRequest` + `onToggleConsumed`(헤더 토글과 같은 `toggleOpen`), 새 이슈·메모는 `IssuePanel`·`MemoPanel`의 `focusAdd` +
  `onFocusAddConsumed`(→ `AddForm`의 `focusRequested`). 새 이슈·메모는 **열린 상세를 먼저 닫는다** — 열린 패널의 추가 칸은 CSS로
  숨어 포커스를 못 받는다. 도크 토글은 workspace 화면에서만 받는다 — 다른 화면에서 세워 두면 돌아오는 순간 접힌다. 새 대화는
  기존 `focusNew`를 탄다.
- **FR-10** `?`는 `ShortcutHelp` — `popover="manual"` dialog(`aria-label="단축키"`), 표의 여섯 + 지시 보내기(Ctrl+Enter) + Esc.
  Esc 사다리(conversation-timeline FR-39)의 **맨 안쪽**이다 — 자기 Esc에 `preventDefault`·`stopPropagation`을 같이 해 열린 항목을
  닫는 App의 Esc가 돌지 않는다(App의 Esc 핸들러는 `defaultPrevented`를 본다).

### 작은 것

- **FR-11** 설정의 저장 버튼 여섯(실행 기본값 · CLI 경로 · CLI 기본 경로 · 터미널 셸 · 글로벌 asset 경로 · 동시 실행 상한)은
  **그 절에 바뀐 것이 있을 때만** 활성이다. 절마다 따로인 것은 그대로다(CLAUDE.md "경로 절과 기본값 절을 한 저장으로 합치지 말 것").
- **FR-12** CLI 상태의 `확인 중…`은 버튼이 아니라 `role="status"` 글자(스피너 붙음)이고 `다시 확인` 버튼은 자리를 지킨 채 잠긴다.

## 3. 비기능

- **NFR-1** 새 색·크기는 전부 `index.css` 토큰이다 — 다크에서 같은 값으로 맞는다.
- **NFR-2** 새 이름이 기존 e2e와 부분 일치로 부딪히지 않는다: `훑기`(배너 `정리 안 됨`과 다른 글자), 패널 `이슈`·`메모`(상세의
  `이슈 id 복사`·`메모 id 복사`는 region이 아니라 button이라 role이 가른다), 타일(`ul[aria-label="워크스페이스"]`)은 펼친 목록과 동시에
  서지 않는다.
- **NFR-3** 영어 enum(`open`·`doing`·`done`)이 화면 글자로 나가지 않는다 — `App.test`의 "목록의 상태는 읽기 전용 배지다"가 본다.

## 4. 대가

- 이슈가 열린 동안 도크는 280px이다 — 대화록이 좁다. 상세를 닫으면 돌아온다.
- 리포트가 비면 `reports.build`가 최대 세 번 더 돈다(workspace를 넘는 읽기라 수십 ms).
- `?`는 Shift+/라 한국어 자판에서도 같은 자리다. 수정키 없는 단축키는 이것 하나뿐이다.
