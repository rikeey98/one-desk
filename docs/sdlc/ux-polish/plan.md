# Plan: UI/UX 분석이 꼽은 여덟 가지

- 출처: `spec.md`
- 상태: 구현 완료 (2026-10-20)

## 순서

시안 단계(worktree `ux-proposal`, 커밋 `2d6210a`)가 여덟 항목을 먼저 코드로 보여줬고, 사용자가 "다 적용해줘"로 전부 들였다. 그래서
순서가 보통과 반대다 — 구현이 먼저 있고 테스트·배선·문서가 뒤따랐다. 회귀 테스트는 대상 줄을 망가뜨려 빨개지는지 봤다(아래 변이).

1. **표** `renderer/issueStatus.ts`(FR-3) · `renderer/shortcut.ts`의 `SHORTCUTS`·`matchShortcut`·`isEditableTarget`·`withShortcut`(FR-8) ·
   `renderer/report/project.ts`의 `reportItemCount`(FR-2b). `issueStatus.test`·`shortcut.test`.
2. **컴포넌트** `Dock`(`compact`·`toggleRequest`·`onToggleConsumed`, FR-1·FR-9) · `AddForm`(`focusRequested`) · `IssuePanel`·`MemoPanel`
   (`focusAdd`, 대칭) · `ShortcutHelp`(FR-10) · `Sidebar`(`.ws-tiles`, FR-7) · `IssuePanel` 배너(FR-4) · `RunPanel`·`ModelField`(FR-5) ·
   `FilePane`(FR-2a) · `ReportPanel`(FR-2b) · `SettingsPanel`(dirty 플래그, FR-11) · `AgentStatusList`(FR-12). 각 `*.test`.
3. **App 배선** — 전역 keydown → 일회성 prop(FR-9), `scopeLabel`·`document.title`(FR-6), `compact={openItem !== null}`. `App.test`의
   "전역 단축키 배선"·"제목 줄의 범위와 상세가 열렸을 때의 도크".
4. **CSS** — `index.css` 끝의 `docs/sdlc/ux-polish/` 블록(토큰만).
5. **기존 테스트의 이름** — 영어 패널 이름·`정리 안 됨 (N)`·`훑어보기`·`확인 중…` 버튼·effort `기본값`을 쓰던 단위·e2e 테스트.
6. **전체 검증** `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm test:e2e`.
7. **문서** CLAUDE.md(현재 상태 한 단락 · 접힌 사이드바 절 · 부분 일치 함정의 예 · 문서 표) · DESIGN.md(라벨·사이드바).

## 바뀌는 파일

`renderer/issueStatus.ts`(+test) · `renderer/shortcut.ts`(+test) · `renderer/report/project.ts` · `renderer/effort.ts`(+test) ·
`renderer/App.tsx`(+test) · `renderer/components/{AddForm,AgentStatusList,AssetPanel,ConversationList,Dock,IssueDetail,IssuePanel,
MemoPanel,ModelField,ReportPanel,RunPanel,SettingsPanel,ShortcutHelp,Sidebar}.tsx`(+test) · `renderer/components/code/FilePane.tsx`(+test) ·
`renderer/index.css` · `e2e/{triage,panel-collapse,report,events,opencode-real}.e2e.ts` · 문서.

## 변이 (App 배선 한 줄씩 — CLAUDE.md "배선도 검증 대상이다")

| 변이 | 빨개진 테스트 |
|---|---|
| `toggleRequest={dockToggle}` → `{false}` | "Ctrl+J는 도크를 접고 다시 펼친다" |
| `focusAdd={addFocus === 'issue'}` → `{false}` | "Ctrl+I는 새 이슈 입력칸에…" · "열린 상세가 있어도 Ctrl+I는…" |
| `compact={openItem !== null}` → `{false}` | "이슈를 열면 도크가 하한으로 내려가고(compact) 닫으면 돌아온다" |

## 위험

- `focusAdd`·`onFocusAddConsumed`는 패널 창(`PanelWindow`)도 같은 컴포넌트를 쓰므로 **선택 prop**이다 — 도크의 필수 prop 규칙과
  다르다. App의 한 줄을 지워도 컴파일되므로 위 변이 표의 `App.test`가 그 자리를 지킨다.
- 리포트의 제안은 preset마다 `reports.build`를 더 부른다 — 결과가 비었을 때만이고, 직접 지정 기간에서는 묻지 않는다.
