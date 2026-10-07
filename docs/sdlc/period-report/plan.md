# Plan: 기간 리포트

- 출처: `spec.md` (승인 2026-10-07)
- 상태: 구현 완료 (2026-10-07, 사용자 위임으로 승인)

## 순서

각 단계는 테스트를 먼저 쓰고 빨간 것을 본 뒤 구현한다. 회귀 테스트는 대상 줄을 잠시 망가뜨려 빨개지는지 본다.

1. **`core/period/`로 기간 판정을 옮긴다** — `touchedIn`(tools.ts)과 대화 묶기·겹침(`groupTurns`·`conversationSpan`·
   `spanOverlaps`, conversations.ts에서 뗌). MCP는 이것을 import한다. `core/mcp/*.test.ts`가 그대로 초록이어야 한다.
2. **`core/reports/build.ts`** — 순수 함수 `buildReport(sources, input)`. sources는 workspace 목록과 workspace별
   issues/memos/runs 읽기 함수. 테스트: workspace 넘어 고르기, 없는 id 건너뛰기, 빈 workspaceIds, 기간 경계(`until` 제외),
   대화 겹침, `lastAnswer` 300자, `issueTitle`, 다른 workspace의 run이 섞이지 않음.
3. **배선** — `shared/models.ts`(타입), `core/index.ts`(`reports.build`), `shared/channels.ts`·`shared/client.ts`·
   `electron/preload.ts`·`electron/ipc/reports.ts`(+ index). `core/index.test.ts`에 실제 DB로 한 번.
4. **렌더러 순수 함수** `renderer/report/` — `period`·`project`(classify·totals·attach·runSeconds)·`days`·`track`·
   `markdown`·`format`. 각자 테스트.
5. **컴포넌트** — `ReportPanel`(헤더·탭·액션·상태) · `ReportConditions`(열/띠) · `ReportDocument` · `ReportDays` ·
   `ReportFlow` · 훅 `useReport`(디바운스·늦은 응답 버림·구독). 아이콘 넷. CSS(토큰만).
6. **App·Sidebar 배선** — `view: 'report'`, `onSelectReport`(필수), 조건 state, 이슈 열기·대화 열기·메모 저장·다듬기.
   App.test에 배선 테스트(사이드바 → 리포트, 이슈 줄 → 이슈 열림, 다듬기 → 칩·초안·전송 없음).
7. **e2e** `e2e/report.e2e.ts` + 기존 e2e 전체(부분 일치 충돌 확인).
8. **캡처** 라이트·다크 세 탭 → 확인 → 임시 캡처 테스트 삭제.
9. **문서** — CLAUDE.md 현재 상태 절·문서 표, DESIGN.md 컴포넌트 절, `docs/releases/v0.21.0.md`.
10. **릴리스** — 커밋 → `chore: release 0.21.0`(package.json) → 태그 `v0.21.0` → push.

## 바뀌는 파일

- 새: `core/period/{range,conversations}.ts(+test)`, `core/reports/build.ts(+test)`, `electron/ipc/reports.ts`,
  `renderer/report/*.ts(+test)`, `renderer/hooks/useReport.ts`, `renderer/components/Report*.tsx(+test)`, `e2e/report.e2e.ts`
- 고침: `core/mcp/tools.ts`·`conversations.ts`, `core/index.ts`, `shared/{models,channels,client}.ts`, `electron/preload.ts`,
  `electron/ipc/index.ts`, `renderer/App.tsx`·`App.test.tsx`, `renderer/components/Sidebar.tsx`·`icons.tsx`, `renderer/index.css`

## 위험

- 사이드바 `리포트`·탭 이름이 기존 e2e의 부분 일치와 부딪힐 수 있다 → 7단계에서 전체 e2e.
- `runs.list`가 hydrate(맥락)까지 해서 workspace가 많으면 무겁다 → NFR-2를 core 테스트에서 크게 재 보고, 넘으면 슬림 select를 더한다.
- dev가 떠 있으면 e2e가 dev 빌드를 갈아끼운다 → 확인 후 돌린다.

## 완료 증명

2026-10-07, Windows 11 · Node 22.

- `pnpm typecheck` — 오류 없음. `pnpm lint` — 오류 없음.
- `pnpm test` — 131 파일 통과(2 건너뜀), 2,451 테스트 통과.
- 경계 grep 셋(`from 'electron'` in core · `window.oneDesk` 밖 · `dangerouslySetInnerHTML|rehype-raw`) — 출력 없음.
- `vitest run --config vitest.e2e.config.ts e2e/report.e2e.ts` — 통과(workspace 둘 · 세 보기 · 복사 · 메모 저장 · 다듬기 ·
  다른 workspace의 이슈 열기).
- 전체 e2e(`vitest run --config vitest.e2e.config.ts`) — 26 파일 통과(2 건너뜀 — 진짜 CLI), 52 테스트. 새 이름의 부분 일치 충돌 없음.
- NFR-2: 실제 DB에 workspace 5 · 이슈 500 · run 2,000(지시 200자·조립 4,000자)을 넣고 `core.reports.build` 다섯 번 평균 38.2ms
  (예산 100ms). 슬림 select는 더하지 않았다.
- 변이 확인(되돌린 뒤 초록):
  - `buildReport`의 이슈 기간 거름·대화 겹침 판정을 지움 → `build.test` 둘 빨강.
  - `classify`의 "지금 done" 조건을 지움, `runSeconds`의 "기간 안에 시작" 조건을 지움 → `report.test` 셋 빨강.
  - `IssuePanel`의 `loaded` 가드를 지움 → "목록이 오기 전에는 열린 이슈를 접지 않는다"·"지우면 상세가 닫힌다" 빨강.
- 구현 중 찾은 결함: 다른 workspace에서 건너와 연 이슈·메모가 목록이 오기 전에 닫혔다(App 배선 테스트가 잡았다). 패널 테스트
  둘은 그동안 마운트 순간의 접힘 덕에 공짜로 통과하고 있었다 — 가짜 `list`가 같은 배열을 돌려줬기 때문이다. 둘 다 고쳤다.
- 캡처(1440×900 라이트·다크 세 보기, 1180 좁은 창)에서 고친 것: 열 안의 날짜 칸이 잘림 → 두 줄 격자, 요일 칸이 좁음 → 곁 칸
  300 → 260px, 진행 중 막대가 이번 주 끝(미래)까지 감 → 지금에서 멈춘다(`issueTrack`의 `now`, 테스트 추가).
- 계획과 달라진 것: 대화 제목 사다리를 `shared/conversationTitle.ts`로 옮겼다(리포트가 도크와 같은 이름을 쓰게). 리포트는
  workspace를 전부 읽고 고른 것만 그린다(체크 한 번에 다시 읽지 않고, 고르지 않은 workspace의 수도 보이게). 이번 주의 끝은
  "지금"이 아니라 다음 월요일 0시다(축이 한 주 전체를 그리게) — spec FR-3을 고쳤다.
