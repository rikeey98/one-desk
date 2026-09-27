# Plan: OpenCode처럼 읽히는 대화 화면

- 출처: `intent.md`, `spec.md`
- 선행: `docs/sdlc/conversation-fixes/` — **그것이 `main`에 들어간 뒤 착수한다**
- 작성자: 권용현 (Claude가 초안)
- 상태: 초안 (2026-09-27)
- 작성일: 2026-09-27

## spec에서 다듬은 것

spec의 결정을 뒤집지 않고 모양만 맞춘다.

1. **착수 시점과 기준선.** fixes가 `Dock.tsx`·`Transcript.tsx`·`ConversationList.tsx`·
   `conversation.ts`·`fake-claude.mjs`와 그 테스트를 먼저 고친다(spec §6 우려 13). fixes가 병합된
   `main`에서 브랜치를 따고, 시작 전에 `pnpm test`의 통과 수를 기준선으로 적는다.

2. **이름을 여기서 정한다.** spec은 화면만 그렸다.
   - 파일: `renderer/timeline.ts`·`diff.ts`·`runStatus.ts`·`agents.ts`·`followBottom.ts`,
     `renderer/store/drafts.ts`·`DraftContext.tsx`, `renderer/hooks/useFollowBottom.ts`·`useNow.ts`,
     `renderer/components/Markdown.tsx`·`TimelineBlocks.tsx`·`ConversationHeader.tsx`,
     `shared/links.ts`, `e2e/dock.ts`·`timeline.e2e.ts`·`composer.e2e.ts`.
   - 클래스 — **e2e가 잡는 것은 이름을 지킨다**: `.turn`·`.turn-user`·`.turn-answer`(이제 답 칸)·
     `.status`·`.status-<enum>`·`.status-dot`·`.dock-conv*`·`.applied-context`·`.applied-chip`·
     `.run-panel`·`.run-prompt`(anchor)·`.run-chips`·`.run-start`(전송 버튼).
   - 새 클래스: 턴 `.turn-status`(상태 줄)·`.turn-summary`·`.turn-foot`(끝줄)·`.turn-meta`
     (메타 조각, `title`=`usageTitle`)·`.turn-notice`, 블록 `.tl-text`·`.tl-activity`·`.tl-tool`·
     `.tl-tool-error`·`.tl-edit`·`.tl-file`·`.tl-diff`·`.tl-error`·`.tl-notice`, 마크다운 `.md`·
     `.md-code`·`.md-code-head`·`.md-link-inert`·`.md-image`, 입력부 `.composer-queue`(예약 칩)·
     `.composer-queue-label`(`대기 중` span)·`.composer-card`·`.composer-controls`·`.pill`, 헤더
     `.conv-header`·`.conv-title`·`.conv-sub`·`.conv-menu`·`.conv-usage`, 대화록 `.transcript-wrap`·
     `.jump-latest`, 도크 `.dock-max`.
   - **없어지는 클래스**: `.turn-info`(→ `.turn-meta`), 지금의 `.turn-meta`(버튼 줄 → `.turn-foot`),
     `.turn-pending`, `.run-log`·`.log-*`, `.run-note`, `.dock-cancel`, `.run-settings`.
     `.turn-meta`는 **뜻이 바뀌어 재사용된다** — 옛 규칙(`opacity: .8`)을 남기지 않는다.

3. **`RunLog.tsx`와 `RunLog.test.tsx`는 지운다.** 중복 제거 규칙(세 테스트)은 지우기 전에
   `timeline.test.ts`로 옮긴다(spec FR-8). 재수출 껍데기를 남기지 않는다.

4. **블록별 펼침 state는 `Turn`이 쥔다.** `TimelineBlocks`는 그리기만 한다 — `Turn`은 run id로
   key가 잡혀 대화가 열려 있는 동안 살아 있다. 열림은 `Set<blockKey>` 하나다(블록 key와 도구 id).

5. **헤더는 `Dock`이 그린다.** `ConversationPanel`은 대화록 + 입력부만 남는다. 헤더에 필요한 것
   (`conversation`·`repos`·이름 바꾸기·끝내기)이 전부 Dock에 있어서, 그리면 prop을 한 겹 덜 내린다.
   `.applied-context`도 ConversationPanel에서 헤더로 옮긴다.

6. **초안 스토어는 `main.tsx`에서 만든다** — `createRunEventStore`와 같은 자리. **App.tsx는
   건드리지 않는다**(새 prop이 없다 — 배선 변이의 단골 자리가 생기지 않는다). 대신 `main.tsx`의
   Provider 한 줄은 단위 테스트가 못 잡으므로 `composer.e2e.ts`의 "인박스에 다녀와도 남는다"가
   맡는다. 단위 테스트의 렌더 도우미(RunPanel·ConversationPanel·Dock·App)는 `DraftProvider`로
   감싼다 — 도우미 한 곳씩이다.

7. **가짜 CLI 시나리오는 환경변수로 켠다.** e2e 드라이버는 `--scenario`를 못 넘긴다(fake-claude.mjs
   주석). `ONE_DESK_FAKE_SCRIPT=timeline`이면 기본 성공 시나리오 대신 이 순서로 낸다 — 사이마다
   `ONE_DESK_FAKE_STEP_MS`(기본 300ms):
   text "먼저 인증 모듈을 봅니다." → `Read {file_path: <cwd>/src/auth.ts}` + 성공 결과 →
   `Grep {pattern: 'expiresAt'}` + `Found 3 files…` → `Bash {command: 'pnpm test'}` + 성공 →
   `Bash {command: 'pnpm lint'}` + `is_error: true` → `Edit {file_path, old_string: 'a < b',
   new_string: 'a <= b'}` + 성공 → `mcp__onedesk__list_issues {}` + 성공 → 마크다운 답(코드 블록·목록·
   표·`https://example.com` 링크·`[x](javascript:alert(1))`·`![p](http://127.0.0.1:9/p.png)`·
   `<img src="http://127.0.0.1:9/q.png">`·`<script>window.__pwned=1</script>`) → 같은 텍스트의 result.
   기본 시나리오(`작업 중` → `끝남`)는 **건드리지 않는다** — 기존 e2e 전부가 그것에 기댄다.

8. **의존성은 devDependencies다.** `react`·`react-dom`이 이미 그쪽이다(렌더러는 번들된다).
   `pnpm add -D --save-exact react-markdown remark-gfm`. 설치한 버전을 완료 증명에 적는다.

9. **`AGENT_LABELS`로 옮길 곳은 셋이다** — `RunPanel`의 옵션, `SettingsPanel`의 옵션,
   `AgentStatusList`의 지역 표(spec FR-46).

10. **e2e는 단계마다 그 단계가 깬 파일만 돌린다.** `pnpm build` 뒤
    `pnpm vitest run --config vitest.e2e.config.ts e2e/<파일>`. **`pnpm dev`를 끄고 돌린다**
    (CLAUDE.md — 같은 `out/`을 쓴다). 전체 `pnpm test:e2e`는 마지막 단계에서.

## 변경되는 파일

| 파일 | 신규/수정 | 변경 내용 |
| --- | --- | --- |
| `renderer/timeline.ts`·`.test.ts` | 신규 | 투영·라벨표·부제·공지·시간·메타 (FR-1~11) |
| `renderer/diff.ts`·`.test.ts` | 신규 | 줄 diff·통계·상한 (FR-7) |
| `renderer/runStatus.ts`·`.test.ts` | 신규 | 상태 이름 표 (FR-45) |
| `renderer/agents.ts` | 신규 | agent 이름 표 (FR-46) |
| `renderer/followBottom.ts`·`.test.ts` | 신규 | 바닥 판정 (FR-42) |
| `renderer/usage.ts`·`.test.ts` | 수정 | `conversationUsage` (FR-36) |
| `renderer/dockHeight.ts`·`.test.ts` | 수정 | 0.5 / 280px (FR-40) |
| `shared/links.ts`·`.test.ts` | 신규 | `externalLinkOf` (FR-22·24) |
| `renderer/store/drafts.ts`·`.test.ts`, `DraftContext.tsx` | 신규 | 초안 스토어 (FR-31) |
| `renderer/main.tsx` | 수정 | `DraftProvider` 한 겹 |
| `renderer/hooks/useRunEvents.ts` | 수정 | `useRunEventSnapshot` (FR-14) |
| `renderer/hooks/useFollowBottom.ts`·`useNow.ts` | 신규 | FR-42 / FR-11·12 |
| `renderer/components/Markdown.tsx`·`.test.tsx` | 신규 | FR-20~26 |
| `renderer/components/TimelineBlocks.tsx` | 신규 | 블록 여섯 종류 (FR-16~18) |
| `renderer/components/ConversationHeader.tsx`·`.test.tsx` | 신규 | FR-33~36 |
| `renderer/components/Transcript.tsx`·`.test.tsx` | 수정(다시 씀) | FR-12~15·19·30·43·44 |
| `renderer/components/RunLog.tsx`·`.test.tsx` | **삭제** | 규칙은 timeline.test로 |
| `renderer/components/RunPanel.tsx`·`.test.tsx` | 수정 | 카드·알약·중지·예약 칩·초안 (FR-27~32·44) |
| `renderer/components/ConversationPanel.tsx`·`.test.tsx` | 수정 | 헤더·담긴 것 줄이 빠짐, 따라가기 |
| `renderer/components/Dock.tsx`·`.test.tsx` | 수정 | 헤더(토글·최대화·Esc), `renaming`, 취소 제거, key |
| `renderer/components/ConversationList.tsx` | 수정 | 상태 점 이름, 아이콘, `renaming` |
| `renderer/components/icons.tsx` | 수정 | 아이콘 여덟 (FR-48) |
| `renderer/components/AgentStatusList.tsx`·`SettingsPanel.tsx` | 수정 | `AGENT_LABELS` |
| `renderer/App.test.tsx` | 수정 | Provider, 인박스 왕복 초안 |
| `renderer/index.css` | 수정 | 대화 영역 규칙 교체, opacity 정리 |
| `electron/main.ts` | 수정 | `will-navigate`·`setWindowOpenHandler` (FR-24) |
| `package.json`·`pnpm-lock.yaml` | 수정 | react-markdown·remark-gfm |
| `core/runner/fixtures/fake-claude.mjs` | 수정 | `ONE_DESK_FAKE_SCRIPT=timeline` |
| `e2e/dock.ts` | 신규 | 목록 줄·상태 도우미 |
| `e2e/timeline.e2e.ts`·`composer.e2e.ts` | 신규 | spec §7 |
| `e2e/`의 core-loop·queue·inbox·slash·agent-setup·asset·mcp·opencode-real·slash-real·conversation | 수정 | 셀렉터 |
| `e2e/zz-timeline-capture.e2e.ts` | 임시 | 캡처 — **커밋하지 않는다** |
| `CLAUDE.md`·`DESIGN.md` | 수정 | 현재 상태·함정 / 대화 화면 규칙 |

**건드리지 않는 것**: `core/`(픽스처 제외) · `shared/models.ts`·`events.ts`·`client.ts`·
`channels.ts`·`inbox.ts` · `electron/ipc/*` · preload · `drizzle/` · `renderer/App.tsx` ·
`renderer/conversation.ts`(fixes가 준 `state`·`active`를 쓰기만 한다) · `CommandPicker.tsx` ·
`slash.ts` · `ModelField.tsx`.

## 작업 순서

각 단계는 **실패하는 테스트를 먼저 쓰고** 구현한다. 회귀 테스트는 대상을 잠시 망가뜨려 빨개지는지
본다(CLAUDE.md). 단계 끝마다 `pnpm typecheck` + 그 단계의 단위 테스트, 화면이 바뀐 단계는 깬 e2e
파일까지 돌린다(다듬은 것 10).

### 1. 순수 모듈

`timeline.ts`·`diff.ts`·`runStatus.ts`·`agents.ts`·`followBottom.ts`·`usage.ts`(+`conversationUsage`)·
`shared/links.ts`·`store/drafts.ts`. **아직 아무도 쓰지 않는다** — 화면은 그대로다.

- 먼저 쓸 테스트: spec §7의 `timeline`·`diff`·`links`·`followBottom`·`drafts`·`usage`·`runStatus`
  (표가 `RunStatus` 여섯을 다 덮고 영어 enum과 같은 글자가 없다).
- **`Found N` 형식을 여기서 확인한다**(spec §6 우려 3). 이 장비의 실제 run 로그에서 Grep의
  `tool_result`를 읽기만 한다(`<userData>/logs/*/stream.jsonl`). 형식이 다르면 파서를 맞추고, 로그가
  없으면 `matches`를 비워 두고 우려 3에 그렇게 적는다.
- `RunLog.test.tsx`의 세 경우를 `timeline.test.ts`로 옮겨 둔다(지우는 것은 4단계).
- 깨질 수 있는 것: 없다.
- 완료 확인: typecheck 초록. `projectTurn`에서 FR-8의 중복 제거를 빼면 빨개지고, 짝짓기를 한 번
  훑기로 바꾸면 "실패한 도구는 묶음 밖" 테스트가 빨개진다.

### 2. 마크다운과 탐색 가드

`pnpm add -D --save-exact react-markdown remark-gfm`, `Markdown.tsx`, `electron/main.ts`.
화면에는 아직 붙이지 않는다.

- 먼저 쓸 테스트: `Markdown.test.tsx`의 보안 고정 전부(spec §7). jsdom에 `navigator.clipboard`가
  없으므로 테스트가 `writeText`를 세운다.
- `electron/main.ts`: `will-navigate`는 앱 자신의 URL(`ELECTRON_RENDERER_URL`의 origin 또는
  `index.html`의 `file:` URL)이 아니면 막고, `setWindowOpenHandler`는 `externalLinkOf`를 통과한
  것만 연다. main에는 단위 테스트가 없다 — 판정을 `shared/links.ts`에 두는 이유이고(`core/app/reveal.ts`와
  같은 구조), 실제 동작은 4단계의 `timeline.e2e.ts`가 본다.
- 확인할 것: **Vite dev의 전체 새로고침이 막히지 않는가**(`pnpm dev`로 한 번), 앱 안에 지금 새 창을
  여는 곳이 있는가(`grep -rn "target=\"_blank\"\|window.open" renderer/` — 있으면 그것도
  `externalLinkOf`를 통과하는지 본다), react-markdown이 vitest(jsdom)에서 ESM 그대로 도는가.
- 번들 크기를 잰다: 설치 전후 `pnpm build`의 `out/renderer/assets/*.js` 합계(NFR-7).
- 깨질 수 있는 것: 없다(아직 쓰는 곳이 없다).
- 완료 확인: typecheck·lint 초록. `a`의 `externalLinkOf` 검사를 빼면, `rehype-raw`를 끼우면 각각
  보안 테스트가 빨개진다. `grep -rn "dangerouslySetInnerHTML\|rehype-raw" renderer/` 출력 없음.

### 3. 접힌 턴과 상태 이름

`Transcript`의 `Turn`을 접힌 모양으로 다시 쓴다 — 사용자 버블 · 상태 줄(`useNow`) · 활동 요약 ·
답 칸(`Markdown`) · 오류 카드 · 끝줄(상태 알약 한국어, 메타 조각, `응답 복사`, `다시 보내기`/`답하기`,
`자세히`) · 턴 사이 공지. `useRunEventSnapshot`을 더하고 접힌 턴은 그것만 쓴다. **펼친 턴은 이
단계에서는 아직 `RunLog`다** — 단계마다 앱이 온전해야 한다. `ConversationList`의 상태 점 이름을
`RUN_STATUS_LABELS`로, agent 이름을 `AGENT_LABELS`로(셋 다).

- 먼저 쓸 테스트: `Transcript.test.tsx`의 FR-12(여섯 칸)·FR-14(접힌 턴은 `useRunEvents`를 안
  부른다)·FR-15(시작돼도 접힌 채 / 펼쳐 둔 턴은 끝나도 열림)·FR-19·FR-43·FR-44. `다시 보내기`는
  `ConversationPanel`이 `runs.resume`을 부르고 `onStarted`로 넘긴다. `답하기`는 이 단계에서는
  `Transcript`의 콜백까지이고, 입력칸에 포커스를 주는 배선은 입력칸 ref가 생기는 5단계에서 한다.
- **pending 턴의 모양은 이 단계에서 바꾸지 않는다** — 뿌리가 아닌 pending을 대화록에서 빼는 것은
  예약 칩과 같이 5단계에서 한다. 따로 하면 그 사이에 예약이 화면에서 사라진다.
- 깨질 수 있는 기존 테스트:
  - `Transcript.test` — 상태 글자(`succeeded` → `완료`), `.turn-info` 묶음 여섯(→ `.turn-meta`와
    `title`), "지난 턴의 로그는 접혀 있고"의 `useRunEvents` 호출 단언(접힌 턴이 스냅샷 훅을 쓰게 되어
    모의 대상이 둘로 갈린다).
  - `Dock.test` — `getByRole('img', { name: 'succeeded' })` 둘 → `완료`. "도크를 접으면 본문이
    사라진다"는 `로그 줄`이 **접힌 채로도 보이게 된다**(진행 중 답 칸) — 단언을 답 칸으로 옮긴다.
- 깨질 수 있는 e2e: **영어 `aria-label` 정규식을 쓰는 아홉 파일 전부**(spec §6 우려 9). 여기서
  `e2e/dock.ts` 도우미를 만들고 옮긴다. core-loop 8단계는 접힌 답 칸의 `작업 중`을 먼저 본다(우려 10).
- 완료 확인: typecheck, `Transcript`·`Dock`·`ConversationList`·`AgentStatusList`·`SettingsPanel`
  테스트, e2e core-loop·queue·inbox·slash·agent-setup·asset·mcp. `Turn`에 상태를 따라 `open`을
  세우는 effect를 넣으면 FR-15 테스트가 빨개진다.

### 4. 펼친 턴 — 타임라인 블록

`TimelineBlocks.tsx`(text·activity·tool 한 줄·edit/diff·tool-error·error·notice), `Turn`의
`Set<blockKey>` 펼침, `RunLog.tsx`·`.test.tsx` 삭제와 `.run-log`·`.log-*` CSS 삭제. 가짜 CLI에
`ONE_DESK_FAKE_SCRIPT=timeline`을 더하고 `e2e/timeline.e2e.ts`를 쓴다.

- 먼저 쓸 테스트: `Transcript.test`의 FR-13(블록 순서, 진행 중엔 답 칸이 없고 끝나면 생김),
  FR-15의 세 번째("새 이벤트가 와도 열린 묶음이 닫히지 않는다" — 스토어에 push해 재렌더),
  FR-16~18(셸 명령·잘린 출력 안내, 실패 도구가 묶음 밖, 편집 `+1 −1`).
- 깨질 수 있는 기존 테스트: `Transcript.test`의 "지난 턴의 로그는…"·"진행 중인 턴도…"(모의가
  돌려주는 text가 이제 `.tl-text`로 그려진다 — 글자 단언은 대체로 그대로), `Dock.test`의
  "스토어가 비어 있으면 로그 파일에서 되살린다", `App.test`의 `자세히` 흐름.
- 깨질 수 있는 e2e: core-loop 9단계의 주석과 범위(`.log-result`가 사라진다 — `.turn-answer`로 이미
  좁혀 있어 단언은 그대로여야 한다).
- `timeline.e2e.ts`의 보안 단언(spec §7): `shell.openExternal`은 `app.electron.evaluate`로 기록만
  하게 바꿔 세운다 — e2e가 사용자의 브라우저를 열면 안 된다.
- 완료 확인: typecheck, `Transcript` 테스트, e2e core-loop·timeline. `grep -rn "RunLog" renderer/`
  출력 없음.

### 5. 입력 카드·예약 칩·중지·초안

`RunPanel`의 모양을 카드로(칩 줄 · 입력칸 · 알약 다섯 · 전송/중지), 예약 칩과 뿌리 pending 안내,
대화록에서 뿌리가 아닌 pending 빼기, 도크 헤더의 `취소` 제거(FR-29), 초안 스토어와 `main.tsx`의
`DraftProvider`, `ConversationPanel`의 key를 `new:<workspaceId>`로, `답하기`의 입력칸 ref.
**RunPanel의 effect 일곱과 `ready` 판정은 옮기지도 고치지도 않는다** — 모양만 바꾼다.

- 먼저 쓸 테스트: `RunPanel.test`의 FR-28(중지/실행 전환, 중지가 running 턴 id로 `cancel`, 예약은
  건드리지 않음)·FR-30(칩의 두 이유, `예약 취소`, 뿌리 pending 안내)·FR-31(재마운트 뒤 초안, 전송
  성공이 비움, 키가 섞이지 않음), `Transcript.test`의 FR-30(뿌리가 아닌 pending은 대화록에 없다),
  `App.test`의 인박스 왕복 초안.
- 깨질 수 있는 기존 테스트:
  - `RunPanel.test` — "예약으로 잠겼을 때 그 이유를 보여준다" 둘(문구가 칩으로), 보이는 칸 이름을
    글자로 찾는 곳이 있으면(대부분 `getByLabelText`라 그대로다), 옵션 글자에서 경로가 빠진 것.
  - `ConversationPanel.test` — 예약 두 테스트. "실행 중이어도 입력은 받는다"는 **치기 전에는
    버튼이 `중지`다** — 단언 순서를 확인한다.
  - `Dock.test` — 헤더 취소 셋("실행 중인 run에만…"·"대기 중인 run에도…"·"끝난 run에는…")을
    입력부 중지·예약 칩·상태 줄 멈추기로 옮긴다. "탭을 옮기면 입력 중이던 프롬프트가…"는 그대로
    통과하고, "돌아오면 남아 있다"를 한 줄 더한다.
  - `Transcript.test` — "예약된 턴은 대기 중으로 보이고 취소할 수 있다"는 RunPanel로 옮긴다.
  - 렌더 도우미 넷(RunPanel·ConversationPanel·Dock·App)에 `DraftProvider`.
- 깨질 수 있는 e2e: conversation — `page.getByText('대기 중')`은 `.composer-queue-label` 하나에만
  걸려야 한다(상태 알약의 `대기 중`은 뿌리 pending에서만 대화록에 나오고 이 시나리오에는 없다).
  3턴은 칩(`.composer-queue`의 `셋째 지시`)을 먼저 기다린 뒤 `.turn-user`를 20초로 기다린다.
  core-loop·opencode-real의 `getByLabel('권한')`, agent-setup의 `getByLabel('모델'|'effort',
  { exact: true })`는 `aria-label`을 지켜 그대로여야 한다 — 돌려서 확인한다.
- 완료 확인: typecheck, `RunPanel`·`ConversationPanel`·`Dock`·`Transcript`·`App` 테스트, e2e
  conversation·core-loop·agent-setup·slash. 초안을 RunPanel의 `useState`로 되돌리면 FR-31 테스트
  (RunPanel·App)가 빨개진다.

### 6. 헤더·도크·스크롤

`ConversationHeader`(제목·`⋯` 메뉴·부제·담긴 것 줄·링·사용량 팝오버), Dock 헤더(토글 아이콘과
이름, 최대화, Esc), `renaming: { id, where }`, `dockHeight` 0.5/280, 대화 칸 레이아웃(헤더·대화록·
입력부, `.dock-main`은 스크롤하지 않는다), `useFollowBottom`과 `최신으로 이동`, `ConversationList`의
글리프(`새 대화`·끝낸 대화 토글), 대화 영역의 `opacity` 정리, `icons.tsx`.
`e2e/composer.e2e.ts`를 쓴다.

- 먼저 쓸 테스트: `ConversationHeader.test`(spec §7), `Dock.test`의 FR-37~39(토글 이름, 최대화 클래스,
  Esc가 풀고 안쪽 Esc는 먼저 소비됨)·FR-34(`renaming`이 한 곳에만), `followBottom.test`,
  `ConversationPanel.test`의 "펼쳐도 바닥으로 가지 않는다"(스크롤 속성을 세워 흉내).
- 깨질 수 있는 기존 테스트:
  - `Dock.test` — `getByText('▾ 실행')`·`{ name: '▾ 실행' }`(→ `대화창 숨기기`), 크기 조절
    테스트의 하한 값, `renamingId`를 가정한 이름 바꾸기 테스트.
  - `dockHeight.test` — 새 기본 비율·하한.
  - `ConversationPanel.test` — "이 대화에 담긴 것" 넷은 `ConversationHeader.test`로 옮긴다. Dock의
    "탭을 옮기면 담긴 것 줄도…"는 Dock 컨테이너 안에서 `.applied-chip`을 세므로 그대로다.
- 깨질 수 있는 e2e:
  - queue — `{ name: '＋ 새 대화' }` → `{ name: '새 대화', exact: true }`.
  - conversation — 스크롤 단언(`.dock-main`이 더는 스크롤하지 않는다 → `.transcript`와 입력 카드의
    아래 끝), `.turn-info` → `.turn-meta`와 헤더 링 이름.
  - dock-resize — 기본 0.5에서 +200px이 상한 안인지(창 900px이면 450 → 650 ≤ 765).
  - **도크가 기본으로 커져 세 패널이 짧아진다** — body·triage·delete·panel-collapse·asset을 한 번씩
    돌려 가려진 줄이 없는지 본다(Playwright는 스크롤해 주지만 hover로 펼치는 줄 끝 버튼은 민감하다).
- 완료 확인: typecheck·lint, 위 테스트, e2e 전부 한 번(`pnpm test:e2e`). 메뉴의 Esc에서
  `stopPropagation`을 빼면 "메뉴를 닫는 Esc가 최대화를 풀지 않는다"가 빨개진다. 따라가기에
  ResizeObserver 계기를 더하면 "펼쳐도 바닥으로 가지 않는다"가 빨개진다.

### 7. 캡처·문서·전체 검증

- `e2e/zz-timeline-capture.e2e.ts`로 라이트·다크 일곱 장면씩 찍고 본다(spec §7 "화면 캡처").
  고칠 것이 나오면 고치고 다시 찍는다. 끝나면 zz 파일을 지운다.
- `CLAUDE.md` — 현재 상태 한 절, 그리고 함정:
  (1) 대화록의 답은 마크다운이고 **링크 판정은 `shared/links.ts` 하나를 렌더러와 main이 같이 쓴다**,
  `rehype-raw`·`dangerouslySetInnerHTML` 금지, (2) 상태 이름은 한국어라 **e2e는 목록 줄을
  클래스(`e2e/dock.ts`)로 잡는다**, (3) 가짜 CLI의 `작업 중`과 상태 줄의 `작업 중`이 겹친다,
  (4) 예약 칩은 **뿌리가 아닌** pending이다 — 뿌리 pending은 대화록에 남는다, (5) 초안은
  `main.tsx`의 스토어가 쥔다 — RunPanel `useState`로 되돌리지 말 것, (6) 접힌 턴은 로그 파일을 읽지
  않는다, (7) 도크 토글의 이름에 "실행"·"접기"를 넣지 말 것, (8) 바닥 따라가기의 계기는 내용 버전이다.
  낡은 문장도 고친다: "`자세히`로 펼친 RunLog", 도크 헤더의 `취소`, "대화록의 각 턴은 전부 접힌
  채로 시작한다"의 설명(접힌 턴이 이제 무엇을 보여주는지).
- `DESIGN.md` — Components에 대화록(버블·답 칸·끝줄·블록)·입력 카드·대화 헤더를 더하고, Shapes의
  모서리 목록을 CSS와 맞추고(10px), 없어진 `.dock-tab` 문장을 지운다(spec §6 우려 12).
- 전체: `pnpm test`·`pnpm typecheck`·`pnpm lint`·`pnpm test:e2e`, spec §7의 grep.

## 리스크

- **fixes와 같은 파일을 연달아 고친다.** fixes 병합 전에 시작하면 `Dock.tsx`·`Transcript.tsx`에서
  충돌이 크게 난다 → 병합 뒤 착수(다듬은 것 1). fixes가 늦어지면 1·2단계(순수 모듈·마크다운)만
  먼저 할 수 있다 — 그 둘은 fixes의 파일을 건드리지 않는다.
- **e2e가 넓게 깨진다.** 상태 이름·도크 토글·새 대화 글자·예약 위치·스크롤 구조가 한꺼번에 바뀐다
  → 단계마다 깬 파일을 그 단계에서 고치고 돌린다. RTL은 이름을 **전체 일치**로, Playwright는 **부분
  일치**로 잡아서 단위 테스트가 초록인 채로 e2e만 깨지는 일이 반복됐다(CLAUDE.md) — 새 이름은
  spec NFR-6의 목록으로 미리 대조했지만 단계마다 e2e를 실제로 돌려 확인한다.
- **jsdom에 없는 것이 많다** — 레이아웃·popover·`navigator.clipboard`·스크롤. popover는 지금처럼
  옵셔널 호출(`togglePopover?.()`), 클립보드는 테스트가 세우고, 스크롤은 `scrollTop`·`scrollHeight`·
  `clientHeight`를 `defineProperty`로 세운다. **실제로 보이는가는 e2e와 캡처만 답한다.**
- **react-markdown의 ESM이 vitest에서 변환 문제를 낼 수 있다.** 2단계에서 가장 먼저 확인한다 —
  막히면 `vitest.config.ts`의 `server.deps.inline`이 첫 수단이다.
- **`will-navigate`가 dev의 새로고침을 막을 수 있다.** 같은 origin은 통과시키고 2단계에서 `pnpm dev`로
  확인한다.
- **Electron의 `navigator.clipboard` 권한.** `file:`로 뜬 창에서 `writeText`가 거부되면 복사 버튼이
  조용히 실패한다 → e2e가 main의 `clipboard.readText()`로 확인하고, 실패하면 "복사하지 못했습니다"를
  `role="status"`로 보인다.
- **Windows 경로.** 상대 경로 계산이 `\`와 드라이브 문자를 다뤄야 한다(`C:\repo\src` vs `c:\repo`).
  `timeline.test`에 두 형식을 다 넣는다. 가짜 CLI의 `file_path`는 `cwd`로 만들어 두 OS에서 같게 한다.
- **CRLF.** lifecycle 때 도구가 파일을 CRLF로 다시 써 diff가 부풀었다(그 plan의 남은 일). 커밋 전에
  `git diff --stat`이 이 작업의 크기와 맞는지 본다.
- **긴 run의 투영 비용.** 스토어 상한 2,000개 × 프레임당 한 번이다. 느리면 활성 턴만 재투영하고 끝난
  턴은 메모를 유지하는지부터 본다(`useMemo`의 의존성이 이벤트 배열 참조라 끝난 턴은 다시 돌지 않아야
  한다).

## 완료 증명

(구현 후 채운다)

- [ ] 기준선(fixes 병합 직후)의 `pnpm test` 통과 수와 이 작업 뒤의 수
- [ ] `pnpm typecheck` · `pnpm lint` 오류 0
- [ ] `pnpm test:e2e` — 파일 수, 새 파일 둘(`timeline`·`composer`) 포함
- [ ] `grep -rn "dangerouslySetInnerHTML\|rehype-raw" renderer/` — 출력 없음
- [ ] `grep -rn "from 'electron'" core/` · `grep -rn "window.oneDesk" renderer/ | grep -v main.tsx` — 출력 없음
- [ ] `grep -rn "RunLog" renderer/` — 출력 없음
- [ ] 이 작업이 더한 CSS에 직접 hex 0건, 대화 영역 규칙에 글자 `opacity` 0건
- [ ] 설치한 react-markdown·remark-gfm 버전, 번들 크기 전후(NFR-7)
- [ ] `Found N` 형식 확인 결과(1단계)
- [ ] 변이 검증 — spec §7 "회귀 확인"의 여섯과 단계별 완료 확인에 적은 것, 각각 몇 개가 빨개졌는지
- [ ] 라이트·다크 캡처 일곱 장면씩 — 본 것과 고친 것
- [ ] CLAUDE.md·DESIGN.md 갱신
