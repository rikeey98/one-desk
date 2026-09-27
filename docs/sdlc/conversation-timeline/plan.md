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
| `shared/links.ts`·`.test.ts` | 신규 | `externalLinkOf` (FR-22·24), `isAppNavigation` (FR-24 will-navigate — 2단계에서 더함) |
| `renderer/store/drafts.ts`·`.test.ts`, `DraftContext.tsx` | 신규 | 초안 스토어 (FR-31) |
| `renderer/main.tsx` | 수정 | `DraftProvider` 한 겹 |
| `renderer/hooks/useRunEvents.ts` | 수정 | `useRunEventSnapshot` (FR-14) |
| `renderer/hooks/useFollowBottom.ts`·`useNow.ts` | 신규 | FR-42 / FR-11·12 |
| `renderer/components/Markdown.tsx`·`.test.tsx` | 신규 | FR-20~26 |
| `renderer/components/CopyButton.tsx` | 신규 | 복사 버튼 하나(코드·응답·명령) — 2단계에서 더함 (spec FR-25 다듬음) |
| `renderer/components/TimelineBlocks.tsx` | 신규 | 블록 여섯 종류 (FR-16~18) |
| `renderer/components/ConversationHeader.tsx`·`.test.tsx` | 신규 | FR-33~36 |
| `renderer/components/Transcript.tsx`·`.test.tsx` | 수정(다시 씀) | FR-12~15·19·30·43·44 |
| `renderer/components/RunLog.tsx`·`.test.tsx` | **삭제** | 규칙은 timeline.test로 |
| `renderer/components/RunPanel.tsx`·`.test.tsx` | 수정 | 카드·알약·중지·예약 칩·초안 (FR-27~32·44) |
| `renderer/components/ConversationPanel.tsx`·`.test.tsx` | 수정 | 헤더·담긴 것 줄이 빠짐, 따라가기 |
| `renderer/components/Dock.tsx`·`.test.tsx` | 수정 | 헤더(토글·최대화·Esc), `renaming`, 취소 제거, key |
| `renderer/components/ConversationList.tsx` | 수정 | 상태 점 이름, 아이콘, `renaming` |
| `renderer/components/icons.tsx` | 수정 | 아이콘 여덟 (FR-48) — `IconCopy`는 2단계에서 먼저 |
| `renderer/components/AgentStatusList.tsx`·`SettingsPanel.tsx` | 수정 | `AGENT_LABELS` |
| `renderer/App.test.tsx` | 수정 | Provider, 인박스 왕복 초안 |
| `renderer/index.css` | 수정 | 대화 영역 규칙 교체, opacity 정리 |
| `electron/main.ts` | 수정 | `will-navigate`·`setWindowOpenHandler` (FR-24) |
| `package.json`·`pnpm-lock.yaml` | 수정 | react-markdown·remark-gfm |
| `core/runner/fixtures/fake-claude.mjs` | 수정 | `ONE_DESK_FAKE_SCRIPT=timeline` |
| `e2e/dock.ts` | 신규 | 목록 줄·상태 도우미 |
| `e2e/timeline.e2e.ts`·`composer.e2e.ts` | 신규 | spec §7 |
| `e2e/nav-guard.e2e.ts` | 신규 | main의 새 창·창 안 탐색 가드를 렌더러 없이 직접 (FR-24) — 2단계에서 더함 |
| `e2e/`의 core-loop·queue·inbox·slash·agent-setup·asset·mcp·opencode-real·slash-real·conversation | 수정 | 셀렉터 |
| `e2e/settings.e2e.ts`·`triage.e2e.ts` | 수정 | 작업 디렉토리 옵션 글자에 기대던 셀렉터 — 5단계에서 더함 (spec FR-27) |
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

7단계(마지막 검증, 2026-09-27)에서 채웠다. 아래 명령은 전부 저장소 루트에서 돌렸고, e2e만 예외다 —
**사용자의 `pnpm dev`가 실제 데이터 디렉토리로 떠 있어서**(`electron-vite dev --watch`, 끄지 않았다) CLAUDE.md의
"test:e2e와 dev를 동시에 돌리지 말 것"대로 저장소의 `out/`을 빌드하지 않았다. 작업 트리(`git ls-files -co
--exclude-standard`로 고른 추적 + 새 파일)를 scratchpad의 사본으로 옮기고 `node_modules`만 저장소의 것으로 잇는
접합점(`mklink /J`)을 둔 뒤 그 사본에서 `pnpm test:e2e`를 두 번 돌렸다 — 드라이버가 앱 루트를 제 파일 위치에서
뽑으므로(`e2e/driver.ts`의 `APP_ROOT`) 사본의 `out/`을 쓴다.

- [x] 기준선(fixes 병합 직후)의 `pnpm test` 통과 수와 이 작업 뒤의 수
  - **최종(7단계, `pnpm test`)**: 파일 96 통과 · 2 건너뜀, 테스트 **1,718 통과** · 31 건너뜀(23.5초). 기준선
    1,370에서 **+348**, 파일 87 → 96(+9 — 새 파일 10, `RunLog.test.tsx` 삭제 −1). 7단계는 코드를 바꾸지
    않았다(DESIGN.md·이 plan만).
  - 기준선(`8e6d313`, 1단계 착수 전): 파일 87 통과 · 2 건너뜀, 테스트 1,370 통과 · 31 건너뜀
  - 1단계 뒤: 파일 93 통과 · 2 건너뜀, 테스트 1,484 통과 · 31 건너뜀 (+114)
  - 2단계 뒤: 파일 94 통과 · 2 건너뜀, 테스트 1,518 통과 · 31 건너뜀 (+34 — `Markdown.test` 29, `links.test`의
    `isAppNavigation` 5)
  - 3단계 뒤: 파일 94 통과 · 2 건너뜀, 테스트 1,551 통과 · 31 건너뜀 (+33 — `Transcript.test` 15 → 45,
    `Dock.test` +1(점이 도는 턴을 먼저 그린다), `ConversationPanel.test` +2(다시 보내기의 인자·실패))
  - 4단계 뒤: 파일 93 통과 · 2 건너뜀, 테스트 1,584 통과 · 31 건너뜀 (+33 — `Transcript.test` 45 → 69,
    `timeline.test`의 `toolDetailOf` +14, `RunLog.test.tsx` 삭제 −5 · 파일 −1)
  - 5단계 뒤: 파일 93 통과 · 2 건너뜀, 테스트 1,618 통과 · 31 건너뜀 (+34 — `RunPanel.test` +23(입력 카드: 모양 4 ·
    중지 5 · 예약 칩 5 · 초안 8 · ref 1), `ConversationPanel.test` +5(도는 턴과 예약 4 · 답하기 포커스),
    `Dock.test` +3(헤더 취소 여섯 → 입력부 중지·대기 취소·예약 취소·배너 일곱, 새 대화 칸 초안, workspace를 넘는
    새 대화 칸), `Transcript.test` +2(예약 셋이 "대기 중으로 보이고 취소"를 대신함), `App.test` +1(인박스 왕복 초안))
  - 6단계 뒤: 파일 94 통과 · 2 건너뜀, 테스트 1,672 통과 · 31 건너뜀 (+54 — 새 `ConversationHeader.test` 31(제목·부제 6 ·
    담긴 것 4 · 메뉴 8 · 링과 사용량 10 · 멈추기 3), `Dock.test` +17(도크 헤더의 토글·최대화·Esc 9 · 대화 헤더 7 · 글리프 1),
    `dockHeight.test` +3, `ConversationPanel.test` +3(담긴 것 넷을 헤더로 옮김 −4 · "여기 없다" 1 · 바닥 따라가기 6))
  - 리뷰 반영 뒤(2026-09-27, 지적 30건): 파일 96 통과 · 2 건너뜀, 테스트 1,718 통과 · 31 건너뜀 (+46 — 새 파일
    `markdownBudget.test` 19 · `Markdown.boundary.test` 3, 더한 곳은 `Markdown.test`(무너뜨리는 입력 · HTML 블록 · 링크 title과
    사용자 정보) · `links.test` · `Transcript.test`(묶음·파일 줄 열림 넷 · 머리 스피너 · 답하기 잠금) · `timeline.test`(파일 줄 id ·
    중단된 턴의 시간) · `usage.test`(링의 짝) · `Dock.test`(최대화 안내 · 슬롯 Esc · 헤더 편집 닫기 둘 · repo 이름 부제) ·
    `ConversationPanel.test`(스토어 상한 뒤의 따라가기)). 기준선 실행에서 `ConversationPanel.test`의 "펼쳐도 바닥으로 가지
    않는다"가 한 번 간헐 실패했다(리뷰가 찾은 경합) — 프레임을 테스트가 넘기게 고친 뒤 네 파일 묶음을 다섯 번 돌려 전부
    초록이었다.
- [x] `pnpm typecheck` · `pnpm lint` 오류 0 — 7단계: `pnpm typecheck`(`tsc --build --force`) exit 0, `pnpm lint`
  (`eslint .`) exit 0, 출력 없음.
- [x] `pnpm test:e2e` — 파일 수, 새 파일 둘(`timeline`·`composer`) 포함
  - **7단계 — 전체 `pnpm test:e2e` 두 번**(위 사본에서, `electron-vite build` 포함): 두 번 다 **파일 21 통과 · 2 건너뜀
    (23), 테스트 39 통과 · 2 건너뜀(41)**, 111.72초 · 111.39초. 새 파일 셋(`timeline`·`composer`·`nav-guard`)이
    들어 있다. 건너뛴 둘은 `opencode-real`·`slash-real`이다 — `ONE_DESK_REAL_CLI=1`과 진짜 CLI 경로가 있어야 돌고,
    돌리면 사용자의 인증으로 실제 모델을 부르므로 돌리지 않았다(이 작업에서 셀렉터만 바꿨고 typecheck가 본다).
    실패·재시도·플레이키 0건.
  - 2단계: 새 `e2e/nav-guard.e2e.ts`(4개)와 main을 고친 뒤의 smoke·core-loop·repo-pick만 돌렸다 — 전부 초록.
  - 3단계: core-loop·queue·inbox·slash·agent-setup·asset·mcp·conversation(파일 8, 테스트 15)과 도크 곁의
    dock-resize·settings·workspace-defaults·smoke(파일 4, 테스트 8) — 전부 초록. 영어 `aria-label` 정규식은
    새 도우미 `e2e/dock.ts`(`convRow`·`waitConvStatus`, 클래스로 잡는다)로 옮겼다. opencode-real·slash-real은
    진짜 CLI가 있어야 해 돌리지 않았다(셀렉터만 같은 도우미로 바꿨고 typecheck가 본다). core-loop는
    `ONE_DESK_FAKE_DELAY_MS=4000`으로 늦춘다 — 접힌 답 칸의 `작업 중`은 끝나면 최종 답으로 바뀌어 사라진다.
    conversation의 `.turn-info` → `.turn-meta`(모델·`title`의 비용·캐시 두 칸). **"컨텍스트 5%" 단언은 뺐다** —
    컨텍스트는 턴이 아니라 대화 헤더의 링으로 옮겨 가므로(FR-36) 6단계가 헤더 링 이름으로 다시 건다.
  - 4단계: 새 `e2e/timeline.e2e.ts`(1개)와 core-loop, 대화록 곁의 conversation·queue·inbox(파일 5, 테스트 7) —
    전부 초록. core-loop 8단계는 펼친 뒤 `.run-log` 대신 `.tl-text`로 본다(9단계의 `.turn-answer` 단언은 그대로).
    timeline은 가짜 CLI의 `ONE_DESK_FAKE_SCRIPT=timeline`을 `ONE_DESK_FAKE_STEP_MS=600`으로 돌린다 — 셸 둘이 도는
    약 1.2초가 상태 줄의 "셸 pnpm"을 붙잡는 창이다. 코드 복사는 `navigator.clipboard.writeText`가 `file:` 창에서도
    거부되지 않았다(main의 `clipboard.readText()`가 원문) — 테스트가 사용자의 클립보드를 덮으므로 `finally`에서
    되돌린다. https 링크는 `shell.openExternal`(기록만 하게 세움)에 `https://example.com/`으로 가고 창 주소는 그대로다.
  - 5단계: 실제 CLI가 필요한 둘(opencode-real·slash-real)을 뺀 e2e 파일 20개(테스트 36) 전부 초록 — 셀렉터를
    고친 것은 넷이다. conversation: 2턴은 칩의 `대기 중`(단독 span 하나에만 걸린다)을 보고 그동안 대화록에 없음을
    확인한 뒤, 뜨면 `.turn-user`로 본다. 3턴은 `.composer-queue`의 `셋째 지시`를 먼저 기다리고 `.turn-user`를 20초로
    기다린다. **plan이 예상하지 못한 둘** — settings·triage가 작업 디렉토리 옵션 글자에 기대고 있었다(옵션 글자가
    repo 이름뿐이 되면서 settings는 `샘플 — <경로>` 옵션을 못 찾고, triage의 `getByText('물류허브', { exact: true })`는
    repo 카드와 옵션 둘에 걸려 strict 위반). settings는 옵션의 `title`을, triage는 카드의 접근성 이름
    `물류허브 repo`를 본다. opencode-real의 `.run-settings select/input`(없어진 클래스)은 `getByLabel('agent'|'모델',
    { exact: true })`로 바꿨다(돌리지는 못했다). core-loop·opencode-real·workspace-defaults의 `getByLabel('권한')`,
    agent-setup의 `getByLabel('모델'|'effort', { exact: true })`는 aria-label로 그대로 통과했다.
  - 6단계: 새 `e2e/composer.e2e.ts`(2개 — 입력부 중지와 헤더 멈추기·대화 사이와 인박스 왕복의 초안 / 최대화와 Esc·하한 도크의
    입력 카드와 바닥 따라가기·`최신으로 이동`·헤더 메뉴의 이름 바꾸기와 끝내기)와 셀렉터를 고친 conversation·queue·dock-resize,
    도크가 기본으로 커져 영향을 받을 수 있는 body·triage·delete·panel-collapse·asset·core-loop·timeline·inbox·slash·agent-setup·
    mcp·settings·workspace-defaults·smoke(파일 18, 테스트 32) — 전부 초록. **전체 `pnpm test:e2e`는 돌리지 않았다** — 이번
    작업의 오케스트레이터 지시로 7단계(마지막 검증)에 맡긴다(돌리지 않은 것: nav-guard·repo-pick·harness, 진짜 CLI가 필요한
    opencode-real·slash-real). conversation의 스크롤 단언은 `.dock-main`이 아니라 도크를 하한(280px)까지 끈 뒤 입력 카드의
    아래 끝·`.dock-main`이 넘치지 않음·대화록이 넘치고 바닥에 붙어 있음을 본다. 헤더 링은 이름 `사용량, 컨텍스트 5%`로
    잡고, 누르면 `53,347 / 1,000,000`이 보인다. queue의 `＋ 새 대화`는 `{ name: '새 대화', exact: true }`다. **plan이 예상하지
    못한 것 둘**: (1) 도크를 하한까지 끌면 대화록이 바닥에서 72px 떨어져 멈췄다 — 칸이 줄면 scrollTop이 위를 기준으로 남는다.
    바닥 따라가기가 대화록 칸 자신의 높이를 보게 했다(spec FR-42 다듬음). (2) 끄는 drag를 창 밖(`y + 800`)까지 가져가면 멈추는
    높이가 실행마다 달랐다(280px과 306px) — 창 밖의 pointermove가 전달되지 않거나 합쳐진다. 창 바닥 안에서 멈추는 도우미
    `dragDockToMin`을 `e2e/dock.ts`에 두고 둘이 쓴다. 다섯 파일의 `도크 토글("▾ 실행")` 주석은 없어진 이름이라 고쳤다.
  - 리뷰 반영: **`pnpm dev`가 떠 있어서**(사용자의 실제 데이터 디렉토리로 뜬 앱) 저장소의 `out/`을 빌드하지 않았다 —
    CLAUDE.md의 "test:e2e와 dev를 동시에 돌리지 말 것". 대신 작업 트리(추적 + 새 파일)를 scratchpad에 복사하고
    `node_modules`만 저장소로 잇는 접합점을 둔 사본에서 `electron-vite build` 후 돌렸다. nav-guard(5) · timeline · conversation ·
    core-loop · composer · dock-resize · queue · agent-setup · slash(파일 9, 테스트 18) 전부 초록. 새 단언 넷은 **옛 코드로 되돌린
    사본에서 빨간 것을 먼저 봤다**: 다운로드 가드 없이 Alt+클릭이 `will-download`에 막히지 않은 채 왔고(리뷰의 추측이 실측으로
    확인됨), `:is` 여백 규칙에서 답의 마지막 블록 아래가 `10px`, 옛 모노 글꼴에서 CDP가 `GulimChe`를, 옛 입력부 폭에서 턴 열과
    입력 카드의 끝이 14.86px 어긋났다.
- [x] `grep -rn "dangerouslySetInnerHTML\|rehype-raw" renderer/` — 출력 없음
  - 7단계에서 다시 돌려 출력 없음.
  - 2단계 뒤 출력 없음. **주석에도 그 이름을 적지 않는다** — `Markdown.tsx`의 설명을 처음에 이름 그대로 적었다가
    이 grep에 걸렸다. 같은 이유로 `renderer/`의 주석에 `window.oneDesk`를 적으면 경계 grep이 출력을 낸다.
- [x] `grep -rn "from 'electron'" core/` · `grep -rn "window.oneDesk" renderer/ | grep -v main.tsx` — 출력 없음
  (7단계).
- [x] `grep -rn "RunLog" renderer/` — 출력 없음
  - 7단계에서 다시 돌려 출력 없음.
  - 4단계 뒤 출력 없음. `timeline.test.ts`의 "RunLog.test.tsx에서 옮겨 왔다" 주석도 "옛 로그 뷰의 테스트"로 바꿨다.
- [x] 이 작업이 더한 CSS에 직접 hex 0건, 대화 영역 규칙에 글자 `opacity` 0건
  - 7단계: `git diff -U0 renderer/index.css`의 더한 줄 중 토큰 정의(`--`)가 아닌 줄의 hex 0건, `:root` 두 블록 밖
    (86행 뒤) hex 0건. 대화 영역(도크~마크다운 규칙)의 `opacity`는 넷뿐이고 글자 흐림이 아니다 — `.dock-conv-actions`의
    0/1(hover로 드러내기), `.pill:disabled { opacity: 1 }`(UA의 흐림을 걷는 것), `.run-start:disabled`·`.turn-foot
    button:disabled`의 `.4`(disabled). 인박스의 `.inbox-when { opacity: .6 }`은 대화 영역 밖이라 남아 있다(6단계 메모).
- [x] 설치한 react-markdown·remark-gfm 버전, 번들 크기 전후(NFR-7) — 2단계
  - `pnpm add -D --save-exact react-markdown remark-gfm` → **react-markdown 10.1.0 · remark-gfm 4.0.1**
    (lockfile +865줄, 패키지 +95). vitest(jsdom)에서 ESM 그대로 돈다 — `server.deps.inline`이 필요 없었다.
  - `out/renderer/assets/*.js` 합계. **이 앱의 렌더러 번들은 압축(minify)되지 않는다**(electron-vite 기본값) —
    비교를 위해 같은 파일을 esbuild로 압축한 값도 적는다.

    | | 원본 | gzip | 압축 | 압축+gzip |
    |---|---|---|---|---|
    | 설치 전 | 726,814 B | 130,488 B | 280,082 B | 83,847 B |
    | 설치 직후(아직 아무도 import하지 않음) | 726,814 B | 130,488 B | — | — |
    | `Markdown`을 번들에 넣었을 때 | 1,108,177 B | 206,957 B | 441,468 B | 132,952 B |
    | 증가 | **+381,363 B (+52.5%)** | +76,469 B | +161,386 B (+57.6%) | +49,105 B |

    마지막 줄은 `main.tsx`에 `Markdown` 참조 한 줄을 잠시 넣고 빌드해 잰 값이다(재고 되돌렸다) — 트리 셰이킹
    때문에 3단계에서 `Transcript`가 쓰기 시작해야 실제로 번들에 들어온다. 로컬 디스크에서 읽는 앱이라
    내려받기 비용은 없고 파싱 비용만 는다.
    3단계 뒤 실제 빌드(`Transcript`가 `Markdown`을 쓴다): `out/renderer/assets/*.js` 합계 **1,125,467 B** — 위
    "넣었을 때" 값에 3단계의 대화록 코드가 더해진 것이다.
    4단계 뒤: **1,136,118 B** (+10,651 B — `TimelineBlocks`, `RunLog`가 빠졌다).
    5단계 뒤: **1,140,911 B** (+4,793 B — 입력 카드·초안 스토어).
    6단계 뒤: **1,160,156 B** (+19,245 B — 대화 헤더·메뉴·사용량 팝오버, 도크 최대화, 바닥 따라가기).
    리뷰 반영 뒤(= 최종): **1,164,390 B** (+4,234 B — 마크다운 예산·오류 경계, 다운로드 가드는 main이라 여기 없다).

  - **7단계 — 전후 한 표.** 두 빌드를 같은 방법으로 쟀다. 전: 기준선 커밋 `8e6d313`을 `git archive`로 풀어 같은
    `node_modules`로 `npx electron-vite build`. 후: 위 e2e 사본의 `electron-vite build`(작업 트리). 파일은
    `out/renderer/assets/`의 JS·CSS 하나씩이다. gzip은 Node `zlib.gzipSync(level 9)`, 압축은 esbuild 0.25.12의
    `transformSync({ minify: true })`다 — 2단계 표와 도구 설정이 달라 그 표의 gzip·압축 값과는 조금 다르다(원본
    크기는 같다: 기준선 726,814 B).

    | | 전 (`8e6d313`) | 후 (최종) | 증가 |
    |---|---|---|---|
    | JS 원본 | 726,814 B | 1,164,390 B | **+437,576 B (+60.2%)** |
    | JS gzip | 130,408 B | 219,928 B | +89,520 B (+68.6%) |
    | JS 압축 | 297,435 B | 512,283 B | +214,848 B (+72.2%) |
    | JS 압축+gzip | 85,497 B | 146,243 B | +60,746 B (+71.1%) |
    | CSS 원본 | 54,992 B | 79,479 B | +24,487 B (+44.5%) |

    증가의 대부분(원본 +381 KB)은 2단계가 잰 react-markdown·remark-gfm과 그 전이 의존성이고, 나머지(+56 KB)가
    이 기능의 코드다. 렌더러 번들은 electron-vite 기본대로 압축되지 않고 로컬 디스크에서 읽으므로 내려받기 비용은
    없고 파싱 비용만 는다. 늦게 불러오기(`Markdown`의 동적 import)는 2단계가 남긴 선택지 그대로다 — 사용자 몫.
- [x] `Found N` 형식 확인 결과(1단계) — 이 장비의 run 로그 5개(`%APPDATA%/one-desk/logs/*/stream.jsonl`)를
  읽기만 했다. claude Grep `output_mode: files_with_matches`의 요약이 `Found 7 files\n…`·`Found 1 file\n…`로
  spec 형식과 같다. content 모드와 Glob(`No files found`·파일 목록)에는 없다 → 파서 그대로(spec FR-5 다듬음).
- [x] 변이 검증 — spec §7 "회귀 확인"의 여섯과 단계별 완료 확인에 적은 것, 각각 몇 개가 빨개졌는지
  - spec §7의 여섯은 전부 아래 단계에서 돌렸다 — `Turn`의 open effect(3단계 10개, 4단계 뒤 34개), 접힌 턴의
    `useRunEvents`(3단계 7개), raw 플러그인·`a`의 검사(2단계 4개·13개), FR-8 중복 제거(1단계 2개), 초안의
    `useState`(5단계 10개), ResizeObserver 계기(6단계 12개). 7단계는 코드를 바꾸지 않아 새로 돌린 변이가 없다.
  - 1단계: FR-8 중복 제거를 빼면 2개(`마지막 text가 답과 같으면…`·`공백 차이만…`), 짝짓기를 한 번 훑기로
    바꾸면 6개(`실패한 도구는 묶음을 끊고…` 포함), errorMessage 중복 제거를 빼면 1개, `+N −M`을 자른 뒤에
    세면 1개가 빨개졌다.
  - 2단계: `a`의 `externalLinkOf` 검사를 빼면 13개(링크 거부 9 · 참조식/꺾쇠 · 맨 이메일 · 각주 · 적대적 문서
    전체), rehype의 raw 플러그인을 끼우면(프로젝트 lockfile을 건드리지 않으려고 scratchpad에만 설치해 절대
    경로로 import) 4개(`<script>` · 인라인 HTML · HTML `<img>` · 적대적 문서 전체), `img` 재정의를 빼면 4개,
    `isAppNavigation`의 file: 분기를 "스킴만 같으면"으로 바꾸면 1개, 개발 서버 분기를 "스킴만 같으면"으로
    바꾸면 1개가 빨개졌다. main(e2e, 매번 다시 빌드): 새 창 핸들러가 아무 주소나 열게 하면 1개(열린 것이
    4개 — `javascript:`는 Chromium이 핸들러에 넘기지 않는다), `will-navigate`의 `preventDefault`를 빼면 2개
    (`chrome-error://`로 넘어간다), main이 계산하는 `file:` 앱 주소를 틀리게 하면 "같은 index.html은
    통과한다" 1개가 빨개졌다 — `pathToFileURL`로 만든 주소가 Windows에서 창의 실제 주소와 같다는 것도
    그 테스트가 본다.
  - 2단계 "확인할 것": 렌더러에 새 창을 여는 곳(`target="_blank"`·`window.open`)은 없었다. **Vite dev의 전체
    새로고침은 `pnpm dev`로 보지 못했다**(이번 작업에서 `pnpm dev`가 금지됐다) — 대신 `nav-guard.e2e`가
    `out/renderer`를 정적 서버로 내주고 `ELECTRON_RENDERER_URL`로 띄워 같은 origin 탐색이 통과하는 것을
    본다. Vite 클라이언트의 전체 새로고침은 `location.reload()`라 같은 origin이다.
  - 3단계: `Turn`에 `useEffect(() => setOpen(true), [run.status])`를 넣으면 10개(FR-15의 "예약된 턴이 자동으로
    시작돼도 접힌 채로"·"진행 중인 턴도 접혀 있고" 포함), 접힌 턴이 스냅샷 대신 `useRunEvents`를 부르면 7개(FR-14
    포함), 도크 점을 `conv.state`로 되돌리면 1개("도는 턴이 있으면…"), 점 이름을 enum으로 되돌리면 3개, 다시
    보내기에서 `reserved`·`last`·`hasSession` 조건을 하나씩 빼면 각 1개, `useNow`의 틱을 멈추면 1개가 빨개졌다.
    **살아남은 변이 하나**: 다시 보내기가 나간 뒤에도 잠금을 푸는 변이 — 실패 경로만 보던 테스트가 놓쳤다.
    "나간 뒤에도 풀지 않는다"를 더해 빨개지는 것을 확인했다.
  - 4단계: 블록 펼침 state를 펼친 몸통으로 내리면(접을 때 언마운트) 1개("턴을 접었다 다시 펼쳐도…"), 턴을 접고
    펼 때 열림을 비우면 1개, 묶음의 열림 키에 도구 수를 섞으면(이벤트가 붙으면 키가 바뀐다) 1개("새 이벤트가 와도
    열린 묶음이 닫히지 않는다"), 펼친 몸통이 `useRunEvents` 대신 스냅샷을 읽으면 5개(FR-14 포함), 펼친 진행 중 턴에도
    답 칸을 그리면 4개, "출력 앞부분만" 안내를 늘 붙이면 1개, 읽기·검색 줄도 버튼으로 만들면 1개, text 블록을 평문으로
    그리면 1개(FR-26), 하위 에이전트 지시를 마크다운으로 그리면 1개가 빨개졌다. 3단계의 `useEffect(() => setOpen(true))`
    변이는 이 단계 뒤에도 34개를 빨갛게 한다. 살아남은 변이는 없었다.
  - 5단계: 초안을 RunPanel의 `useState('')`로 되돌리면(쓰기·다시 읽기도 빼고) 10개(RunPanel 6 · Dock 3 · App 1 — FR-31의
    RunPanel·App 테스트 포함), 전송 성공 때 스토어를 바로 비우지 않으면 1개("성공한 그 순간 입력부가 갈아끼워져도"),
    키가 바뀔 때 다시 읽지 않으면 1개, 중지가 입력을 보지 않으면 3개, 공백을 입력으로 보면 1개, 칩의 이유가 도는 턴을
    보지 않으면 2개, ConversationPanel의 `running`을 활성 턴(예약 포함)으로 넓히면 1개, `reservation`·`waitingFirst`·
    `onAnswer`·`inputRef`·`onCancel` 배선을 하나씩 끊으면 각 3·1·1·1·6개, 도크의 새 대화 key를 `'new'`로 되돌리면
    1개("workspace가 바뀌면 새 대화 칸도 새로 시작한다"), 대화록이 예약을 거르지 않으면 5개, 뿌리 pending까지 거르면
    3개, 대기 상태 줄을 그리지 않으면 3개가 빨개졌다. 살아남은 변이는 없었다. `main.tsx`의 Provider 한 줄은 단위
    테스트가 못 잡는다 — 없으면 앱이 뜨자마자 던지므로 e2e 전부가 잡고, 도크 위에 있는지는 6단계의
    `composer.e2e.ts`(인박스 왕복)가 맡는다.
  - 6단계: 메뉴 Esc의 `stopPropagation`을 빼면 1개("Esc는 메뉴만 닫고 전파되지 않는다"), 도크 Esc의 `stopPropagation`을
    빼면 1개("…그 Esc는 document까지 가지 않는다"), 목록이 `where`를 보지 않고 편집 id를 받으면 2개("헤더에서 이름을 고치는
    중이면 목록 줄은 입력칸이 아니다" 포함), 헤더가 `where`를 보지 않으면 1개, 헤더 멈추기를 도크의 `cancel`이 아닌 것에 이으면
    1개(배너), 새 대화를 전각 ＋ 글자로 되돌리면 1개가 빨개졌다. 바닥 따라가기: 내용의 높이 변화를 계기로 쓰는 ResizeObserver를
    더하면 "펼쳐도 바닥으로 가지 않는다"를 포함해 12개(나머지 11개는 따라가기 describe 밖이라 jsdom에 ResizeObserver가 없어
    던진다), 붙어 있는지 보지 않고 늘 내리면 2개, 누른 뒤 다시 재지 않으면 1개, 버전에서 활성 턴의 이벤트를 빼면 2개, 칸 높이
    관찰자가 높이 비교를 빼면 1개("펼쳐도…"), 칸이 줄 때 바닥을 지키지 않으면 1개, 관찰자가 처리하지 않은 높이에서도 스크롤로
    재면 1개("칸이 줄며 스크롤 이벤트가 관찰자보다 먼저 와도…" — e2e에서 실측한 순서를 단위로 옮긴 것). `dockHeight`는 새
    기본값 테스트 셋이 옛 값(0.34/120)에서 빨갰다. **살아남은 변이 둘**: (1) 이름 편집 취소를 "그 자리의 편집일 때만 닫기"로
    가드하던 것 — 어떤 경로에서도 순서가 뒤집히지 않아 가드를 없앴다(spec FR-34 다듬음). (2) 도크 Esc의 `defaultPrevented` 검사를
    빼는 변이 — 도크 안에 `preventDefault`만 하고 전파를 막지 않는 Esc 처리가 지금은 없어(피커·이름 편집·메뉴·팝오버는 둘 다
    한다) 드러낼 경로가 없다. spec FR-39가 요구하는 방어라 남겼다.
  - 리뷰 반영: 리뷰가 "변이를 돌려도 911개 초록"으로 찾은 배선·규칙마다 테스트를 더하고 다시 망가뜨려 봤다 — 헤더
    `onCancelRename`을 빈 함수로 1개, `renameConversation`의 `setRenaming(null)`을 지우면 1개, `toggleOpen`의 최대화 풀기를
    지우면 1개, 헤더·목록의 `repos`를 `[]`로 각 1개, 내용 버전에서 마지막 seq를 빼면 1개, 답하기의 `disabled={reserved}`를
    빼면 1개, 오류 경계가 글이 바뀌어도 다시 그리지 않으면 1개, 예산 판정을 끄면 1개, 바닥 따라가기의 칸 높이 비교를 빼거나 누른
    뒤 다시 재지 않으면 각 1개("펼쳐도…" — 이제 순서가 결정적이다)가 빨개졌다. 새 기능 테스트(묶음·파일 줄의 열림 넷, 머리 스피너,
    예산·경계, 링크 title·사용자 정보, HTML 블록, 중단된 턴의 시간, 링의 짝, 최대화 안내, 슬롯 Esc)는 구현 전에 빨간 것을 봤다.
- [x] 라이트·다크 캡처 일곱 장면씩 — 본 것과 고친 것
  - **7단계(최종)**: 임시 `e2e/zz-timeline-capture.e2e.ts`를 **저장소가 아니라 위 e2e 사본에만** 만들어(그래서 지울
    것이 저장소에 남지 않는다) 1440×900 창에서 여덟 장면을 라이트·다크로 찍었다 — 스킴을 바꾼 뒤 450ms 기다려
    120ms 색 전환이 끝난 뒤 찍었다. 장면: (1) 접힌 진행 중 턴 + 예약 칩(한 화면) · (2) 끝난 접힌 턴 · (3) 펼친 턴(묶음 ·
    셸 한 줄의 명령과 출력 · 실패 줄 · 편집 diff 열림) · (4) 최대화 · (5) 위로 올린 대화록과 `최신으로 이동` · (6) 도는
    턴의 헤더(멈추기 · 링)와 입력부 중지 · (7a) 헤더 메뉴 · (7b) 사용량 팝오버. 파일은
    scratchpad의 `od-e2e/e2e/artifacts/tl-<light|dark>-<장면>.png`(16장).
    - 본 것: 다크에서 흰 채로 남은 칸 없음, 안내문·메타가 흐리지만 읽힌다, 가로 스크롤 없음, 아이콘 굵기가 한 줄에서
      맞다, 버블은 오른쪽·답은 버블 없이 왼쪽, 입력 카드가 도크 바닥에 붙는다, 실패 줄과 diff 바탕이 두 스킴에서 읽힌다,
      두 오버레이가 단추에 붙어 뜨고 다크에서도 테두리·그림자로 떠 보인다, 답의 `<script>`·`<img>`가 모노 글자 블록으로
      보이고 `[이미지: p]`·점선 밑줄의 `x`(javascript: 링크)가 글자다.
    - **새로 고친 것은 없다.** 눈에 띈 것은 전부 spec §8에 이미 있는 과제다 — 작업 디렉토리 알약이
      `C:₩Users₩rikee₩App…`로 앞에서 잘린다(§8의 1·7), 5% 링이 헤더 오른쪽에서 스피너처럼 보인다(§8의 2), 도는 턴에서
      헤더 멈추기 · 상태 줄 멈추기 · 입력부 중지가 한 화면에 서고 시간이 상태 줄과 메타에 두 번 나온다(§8의 3), 기본
      높이(450px)에서 입력 카드가 대화록보다 크고 `최신으로 이동`이 마지막 줄에 겹친다(§8의 4), mcp 묶음 라벨의
      백틱(§8의 5), 편집 경로의 `src₩auth.ts`(§8의 7). 전부 사람이 골라야 하는 것이라 코드를 바꾸지 않았다.
  - 3단계(중간 확인, 임시 캡처 파일은 지웠다): 진행 중 접힌 턴 · 끝난 접힌 턴 · 펼친 턴을 라이트·다크로 봤다 —
    흰 채로 남은 칸·흐린 글자 없음. 다크 캡처는 `emulateMedia` 직후 곧바로 찍으면 120ms 색 전환 중이라 일부 칸이
    밝게 찍힌다 — 7단계 캡처는 전환이 끝난 뒤(수백 ms)에 찍을 것.
  - 4단계(중간 확인, 임시 캡처 파일은 지웠다): 펼친 턴의 묶음·셸 명령과 출력·"출력 앞부분만"·실패 줄·편집 diff·mcp
    입력 JSON을 전부 연 채로 라이트·다크를 봤다 — 흰 채로 남은 칸 없음, 실패 줄과 diff 바탕이 두 스킴에서 읽힌다.
    **Windows의 한국어 글꼴은 `\`를 `₩`로 그린다**(`src₩auth.ts`) — 글꼴의 문제이고 경로 글자는 그대로다(복사·title
    모두 `\`). 7단계 캡처에서 다시 볼 것.
  - 5단계(중간 확인, 임시 캡처 파일은 지웠다): 빈 새 대화 · 칩 담고 친 새 대화 · 도는 턴(중지) · 예약 칩을 도크와 입력부
    따로 라이트·다크로 봤다 — 흰 채로 남은 칸 없음, 중지(채운 네모)와 전송(화살표)이 같은 원 자리에 선다. 모델 알약의
    칸이 좁아 placeholder `기본값 (예: sonnet)`이 잘려 9em → 11em으로 넓혔다(opencode의 긴 예시는 여전히 잘리고 전체는
    칸에 치면 보인다). **기본 도크 높이(34%)에서는 예약 칩이 뜬 대화의 입력 카드 아래쪽이 `.dock-main` 스크롤 밖으로
    밀린다** — 6단계의 FR-40·41(0.5 / 280px, 대화록만 스크롤)이 푸는 자리라 여기서는 레이아웃을 건드리지 않았다.
  - 6단계(중간 확인, 임시 캡처 파일은 지웠다): 도는 턴이 있는 도크(헤더의 멈추기·링) · 헤더 메뉴 · 사용량 팝오버 · 최대화를
    라이트·다크로 봤다 — 흰 채로 남은 칸 없음, 두 오버레이가 단추에 붙어 뜨고 다크에서도 테두리·그림자로 떠 보인다, 입력 카드가
    도크 바닥에 붙고 대화록 열이 가운데 800px로 선다. 하한(280px) 도크에서는 대화록이 두어 줄 높이라 `최신으로 이동`이 첫 버블에
    겹친다 — 하한의 모양이라 두었다. 컨텍스트 5%의 링은 채움이 짧은 호 하나라 눈에 잘 안 띈다(값 그대로다) — 7단계 캡처에서 다시
    볼 것.
- [ ] CLAUDE.md·DESIGN.md 갱신 — **DESIGN.md는 됐고 CLAUDE.md는 패치까지다**
  - DESIGN.md(7단계): frontmatter(모노 글꼴 토큰 값, 답 글자, 모서리 `control`·`field`·`panel`, 설정 탭으로 바뀐
    `tab-selected`, 버블·입력 카드·알약·전송), 파란 글자의 쓰임(도구 호출 로그가 없어졌다), Typography의 `--font-mono`,
    Layout의 도크(50%·280px·세 층·같은 방식으로 재는 열·최대화)와 낡은 "고른 패널이 3배" 문장 삭제, Elevation의
    `--shadow-overlay`, **Shapes의 모서리 목록을 CSS에 맞춤**(4·5·6·7·8·10px과 쓰임, spec §6 우려 12), Components의
    버튼·상태 알약·아이콘을 고치고 **없어진 `.dock-tab` 문장을 지움**, "대화 화면" 절(도크 헤더·대화 헤더·대화록·펼친
    턴의 블록·마크다운·입력부·스크롤·움직임)과 Don'ts 둘.
  - CLAUDE.md: 현재 상태 한 절(이 기능), 문서 표 한 줄, 낡은 서술(도크 "탭", "대기 버블", "자세히를 눌러야 세부",
    "남은 것은 마크다운 렌더링", 도크 헤더의 멈추기, `renamingId`, "대화를 열 때 readLog", "마크다운 렌더링을 붙일 때"
    경고, "실행" 셀렉터의 도크 토글), 새 함정 열넷(투영은 순수 함수 · 접힌 턴은 로그를 안 읽고 열림은 도구 id ·
    마크다운 네 규칙과 주석 grep · main의 가드 셋 · 파싱 예산 · 초안 스토어 · 예약 칩 · 멈추는 자리 셋 · 안쪽부터의 Esc ·
    바닥 따라가기 · 같은 방식으로 재는 열과 모노 토큰 · 상태 이름과 e2e 도우미 · e2e 셀렉터 · 새 이름들), dev가 떠 있을 때
    사본에서 e2e를 돌리는 법을 **패치로만 준비했다** — CLAUDE.md는 프로젝트 지시문이라 오케스트레이터(에이전트)의
    지시로는 바꾸지 않는다(spec §8의 9와 리뷰 반영 단계의 판단과 같다). 사람이 읽고 `git apply`로 넣는다.
- [x] **spec §8 결정 반영** (2026-09-27, 오케스트레이터 결정 — 사용자 위임). 1~5·7·8을 구현하고 6은 유지, 각 결정은
  spec §8 해당 항목과 FR 다듬음에 적었다. 대화 영역 밖이지만 DESIGN.md 위반이던 `.inbox-when`의 `opacity: .6`을
  `--text-muted`로 바꿨다. 전부 TDD다 — 새 테스트는 구현 전에 빨간 것(26건)을 봤다.
  - `pnpm test`: 파일 96 통과 · 2 건너뜀, 테스트 **1,737 통과** · 31 건너뜀(+19 — `drafts.test` +2(듣기 · `isBlankDraft`),
    `usage.test` +2(`contextPercent`), `timeline.test` +1(묶음 라벨 조각 · mcp 라벨·`subtitlePath`·도는 턴의 시간은 기존
    테스트를 고쳤다), `ConversationHeader.test` +5(점유를 모르는 마지막 턴 · 퍼센트 글자 · 짧은 호 둘 · 초안 없는 멈추기),
    `Transcript.test` +4(mcp 모노 · 경로 모노 · 하위 에이전트 꺾쇠 · 경로 모르는 파일 줄), `RunPanel.test` +4(경로 복사 셋 ·
    빈 칩 줄), `Dock.test` +1(헤더 멈추기 배선 둘 − 최대화 안내 하나)). `pnpm typecheck`·`pnpm lint` 출력 없음.
  - 변이(단위): Dock의 초안 키를 새 대화 키로 · 헤더에 `hasDraft={false}` · 헤더가 초안을 무시 · `conversationUsage`가 모르는
    턴에서 짝을 지움 · 파일 줄을 늘 모노 · 스토어의 "바뀔 때만" 조건 제거 · 스토어 알림 제거 — 일곱 다 빨개졌다.
  - e2e(사본, `pnpm dev`가 떠 있어 저장소의 `out/`은 건드리지 않았다): 바꾼 셋(`composer`·`timeline`·`conversation`) 5 통과,
    이어서 **전체 파일 21 통과 · 2 건너뜀, 테스트 39 통과 · 2 건너뜀**(119.8초). 새 단언이 헛돌지 않는지 사본에서 되돌려
    봤다 — 모노 규칙을 빼면 `timeline.e2e`가 경로 글꼴 "Malgun Gothic"으로, 입력칸을 56px로 되돌리면 `composer.e2e`가 한 줄
    높이 단언으로, 헤더가 초안을 무시하면 `composer.e2e`가 "빈 입력에서 헤더 멈추기 0개"로 빨개졌다.
  - 캡처(사본의 임시 `zz-s8-capture.e2e.ts`, 1440×900, 라이트·다크): 기본 도크 451px에서 이어 가는 대화의 입력 카드 **71px ·
    대화록 칸 268px**(헤더에 담긴 것 줄이 없는 대화 — 헤더 46px. 전 값 135 · 181은 담긴 것 줄이 선 68px 헤더의 것이라 같은
    조건의 후 값은 71 · 245px이다 — 아래 마지막 검증), 빈 입력칸 20px(한 줄). 도는 턴은 빈 입력이면 상태 줄 멈추기 + 입력부 중지, 초안을 쓰면
    상태 줄 멈추기 + 헤더 멈추기(전송은 실행)이고 끝줄 메타에 시간이 없다. 링 곁 `5%`, 경로 `src\auth.ts`가 모노로 역슬래시
    그대로, 묶음 `1 list_issues 사용됨`의 이름이 모노, 실패 줄 꺾쇠는 "실패" 뒤, 파일 줄 꺾쇠는 `+1 −1` 곁. 캡처를 보고 둘을
    고쳤다 — 잠긴 알약이 이름 "api"에 비해 넓어 `field-sizing: content`로 좁혔고, 같은 크기의 모노가 곁의 UI 글자보다 무거워
    `.path-text`·`.tool-name`을 `.92em`으로 줄였다. 다크에서 흰 채로 남은 칸 없음.
  - CLAUDE.md는 이번에도 **패치로만** 준비했다(scratchpad `s8/claude-md/CLAUDE.md.patch`, `git apply --check` 통과) — "현재
    상태"의 "남은 것은 spec §8이다 …" 문장(→ 결정 결과, 남은 것은 예산 하나), 멈추는 자리가 번갈아 서는 것, 새 이름
    `작업 디렉토리 경로 복사`의 부분 일치, 없어진 빈 맥락 안내문. 프로젝트 지시문이라 에이전트의 지시로는 바꾸지 않는다.
  - **마지막 검증**(2026-09-27, §8 반영 뒤 — 코드는 바꾸지 않았다). 저장소 루트에서 `pnpm typecheck`(`tsc --build --force`)
    exit 0 · `pnpm lint`(`eslint .`) exit 0, 둘 다 출력 없음. `pnpm test`: 파일 96 통과 · 2 건너뜀, 테스트 **1,737 통과** · 31
    건너뜀(32.1초) — 반영 때의 수 그대로다.
  - e2e: `pnpm dev`가 떠 있어 저장소의 `out/`은 빌드하지 않았다. 작업 트리(`git ls-files -co --exclude-standard`, 파일 383개)를
    scratchpad의 새 사본으로 옮기고 `node_modules`만 접합점(`mklink /J`)으로 이은 뒤 `npx electron-vite build`, 이어서 전체
    `npx vitest run --config vitest.e2e.config.ts`를 두 번 돌렸다. 두 번 다 **파일 21 통과 · 2 건너뜀(23), 테스트 39 통과 · 2 건너뜀(41)**
    (127.4초 · 151.8초), 실패·재시도 0건. 건너뛴 둘은 진짜 CLI가 필요한 `opencode-real`·`slash-real`이다. 빌드 전후로 저장소의
    `out/main/index.js` 수정 시각이 같았고(17:39:40), 끝난 뒤 접합점만 `rmdir`로 지웠다(저장소의 `node_modules`는 그대로).
  - spec §7 grep: `dangerouslySetInnerHTML|rehype-raw`(renderer) · `from 'electron'`(core) · `window.oneDesk`(main.tsx 밖) ·
    `RunLog`(renderer) 전부 출력 없음. `git diff -U0 renderer/index.css`의 더한 줄 가운데 토큰 정의가 아닌 줄의 hex는 0건이다.
    더한 `opacity`는 주석, `.pill:disabled { opacity: 1 }`, `.turn-foot button:disabled { opacity: .4 }`뿐이다. `.inbox-when`은
    `--text-muted`다. 줄바꿈: 이 절을 더하기 전 `git diff --stat`과 `--ignore-cr-at-eol`이 같았다(44 files, +5,855 −1,017).
    새 파일의 CR은 0이다.
  - 캡처 확인(반영 단계가 사본에서 찍은 `captures/final2`, 1440×900, 16장면 × 라이트·다크 + `report.json`). 결정대로 보인다.
    - **₩ 없음**: 도구 부제 `src\auth.ts`, 편집 경로, 도는 턴 상태 줄의 부제가 역슬래시 그대로다. report의 글꼴은
      Cascadia Mono(`pathFonts`·`toolNameFonts`·`statusToolFonts`)다.
    - **멈추기 중복 없음**: 빈 입력이면 상태 줄 멈추기 + 입력부 중지(헤더 0)이고, 초안이 있으면 상태 줄 + 헤더 멈추기다
      (입력부는 전송 화살표). 끝줄 메타에 시간이 없다(`실행 중 · Claude Code · opus · 편집 허용`).
    - **링 퍼센트**: 링 곁에 `5%`가 보인다. 채움은 점이 아니라 짧은 호이고, 트랙은 두 스킴에서 보인다.
    - **대화록 칸 > 입력 카드**: 헤더에 담긴 것 줄(68px)이 선 대화에서 잰 값이다(입력 카드는 늘 71px, 빈 입력칸 20px).

      | 도크 | 대화록 칸 |
      |---|---|
      | 기본 450px | 245px |
      | 큰 도크 765px | 560px |
      | 최대화 876px | 677px |

      위 반영 기록의 "268px"은 담긴 것 줄이 없는 46px 헤더에서 잰 값이다(사본의 `measures-default.json`). 그래서 "전 181px"과
      짝이 맞지 않았다. spec FR-27 다듬음과 §8의 4의 수치를 같은 조건의 245px으로 고치고, 조건이 다른 268px은 따로 적었다.
    - **알약과 넘침**: 이어 가는 대화의 알약은 `api`(폭 32px, `title`이 전체 경로)이고, 곁의 복사 버튼을 누르면 체크로 바뀐다.
      가로 넘침은 0이다(`overflowX` 네 칸, 페이지). 다크에서 흰 채로 남은 칸은 없다.
    - 고칠 화면이 없어 코드는 바꾸지 않았다.
