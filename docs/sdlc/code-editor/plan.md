# Plan: 대화 옆 코드 칸 — 틀과 파일 칸 (1/3)

- 출처: `spec.md` (승인 2026-10-09)
- 상태: 승인 (2026-10-09, 사용자 — "좋아 커밋하고 0단계부터 구현 시작해"), 구현 완료 (2026-10-09)
- 작성일: 2026-10-09

각 단계는 테스트를 먼저 쓰고 빨간 것을 본 뒤 구현한다. 회귀 테스트는 대상 줄을 잠시 망가뜨려 빨개지는지 본다
(CLAUDE.md 컨벤션). 단계마다 `pnpm test`·`pnpm typecheck`·`pnpm lint`가 초록인 채로 끝난다 — 어느 단계 뒤에서
멈춰도 앱은 돈다(칸은 8단계에서야 화면에 선다).

## 바뀌는 파일

### core

- `core/files/text.ts` (new) — 순수 함수. 바이트 → 텍스트 판정(BOM 유무, 줄바꿈 `lf`/`crlf`/`mixed`/`none`,
  `\n` 텍스트), 텍스트 → 바이트 되살리기(줄바꿈·BOM), 내용 해시(sha256 hex). 외톨이 `\r`이 있으면 `mixed`다.
- `core/files/read.ts` (modified) — `readRepoFile`이 `maxBytes`를 인자로 받는다(기본 256 KiB 그대로 — `@` 참조는
  바뀌지 않는다). 성공 결과에 `hash`·`eol`·`bom`·`text`(`\n`, BOM 없음)를 더한다. 기존 `content`는 그대로 둔다
  (`resolveMentions`가 쓴다). 판정 순서와 이유 문구는 바꾸지 않는다.
- `core/files/write.ts` (new) — `writeRepoFile(root, rel, text, expectedHash, opts)`. spec §3-4의 3~5: realpath
  안쪽·일반 파일 확인(읽기와 같은 검사 — 읽기 쪽 검사 함수를 떼어 둘이 같이 쓴다), 디스크 해시 비교, 디스크의
  줄바꿈·BOM으로 되살려 **제자리에** 쓴다(`writeFile`의 기본 `'w'` — 같은 inode). 상한 2 MiB. 충돌·지워짐·쓰기
  실패는 결과로, 잘못된 호출(밖·파일 아님·`mixed`)은 던진다.
- `core/files/service.ts` (modified) — `tree(input, { fresh })`(목록 전체, `fresh`면 10초 캐시를 건너뛴다),
  `open(input)`, `save(input)`, `probe(input)`(지금 해시 또는 지워짐). 공통 검사: repo의 workspace 소속(기존
  `search`와 같다), 경로가 목록에 있는가 — `open`·`probe`는 캐시 목록, `save`는 **새 목록**(spec §3-4의 2).
  상수 `MAX_OPEN_BYTES = 2 MiB`.
- `core/index.ts` (modified) — `files` 표면에 넷을 더한다(한 줄씩).

### shared · electron

- `shared/models.ts` (modified) — `FileRef { workspaceId, repoId, path }`, `FileTreeResult`, `FileOpenResult`,
  `FileSaveInput`(`FileRef` + `content` + `expectedHash`), `FileSaveResult`, `FileProbeResult`. 모양은 spec §3-3.
- `shared/channels.ts`·`shared/client.ts`·`electron/preload.ts`·`electron/ipc/files.ts` (modified) — `files.tree`·
  `open`·`save`·`probe`. 핸들러는 core 호출 한 줄씩(경계 3).

### renderer — 순수 함수

- `renderer/code/tree.ts` (new) — 경로 목록 → 폴더 트리(폴더 먼저, 이름순 대소문자 무시), 펼친 폴더 집합 → 보이는
  줄(깊이 포함). 접힌 폴더의 아래는 만들지 않는다(NFR-6).
- `renderer/code/target.ts` (new) — 칸의 대상 repo(FR-6): `(conversation | null, newCwd, repos)` →
  `{ repo } | { reason }`. 이어 가는 대화는 `repoOfConversation`, 새 대화는 `newCwd`와 경로가 같은 repo.
- `renderer/code/editPath.ts` (new) — 편집 줄의 CLI 경로 → repo 상대 경로(`/` 구분) 또는 null(FR-23).
  절대 경로는 repo 경로를 앞에서 떼고, 상대 경로는 repo 기준. `..`로 밖에 나가면 null.
- `renderer/conversation.ts` (modified) — `pathKey`를 내보낸다(`target.ts`·`editPath.ts`가 같은 규칙을 쓴다 —
  따로 적으면 구획은 `api`인데 칸은 "등록된 repo가 아닙니다"인 어긋남이 생긴다).
- `renderer/code/layout.ts` (new) — 칸 열림·폭의 localStorage 읽기/쓰기(try/catch, `listWidth.ts` 모양)와 폭 자르기
  (칸 ≥ 320px, 대화 ≥ 360px, 둘 다 못 지키면 칸의 320px가 이긴다 — 위험 10). 기본은 반반.
- `renderer/code/language.ts` (new) — 확장자 → 언어 불러오기 함수. 각 불러오기는 동적 `import()`라 언어 패키지가
  첫 번들에 들지 않는다(FR-12). 모르는 확장자는 null(평문).

### renderer — 스토어

- `renderer/store/codeBuffers.ts` (new) + `CodeBufferContext.tsx` (new) — 앱이 켜진 동안의 상태(spec §3-2):
  repo마다 열린 경로·펼친 폴더, (repo, 경로)마다 `{ text, baseHash, diskHash, deleted, readOnly }`. 고친 것이 있는
  버퍼 목록, `subscribe`(`useSyncExternalStore` 모양). `drafts.ts`와 같은 자리·같은 규칙 — **기본값 없는 Context**
  (Provider가 없으면 던진다).
- `renderer/store/closeGuard.ts` (new) — `beforeunload` 판정 하나(FR-21, spec §4의 6): ① 대기 중 저장이 있으면
  지금처럼 미루고 흘려보낸다 ② 그다음 고친 버퍼가 있으면 미루고 스토어에 "닫기 확인 요청"을 세운다 ③ 둘 다 없으면
  닫는다. 확인의 답(모두 저장 · 버림 · 취소)을 받는 함수를 같이 낸다. `pendingSaves.ts`의 `guardUnload`를 이것이
  감싼다 — 기존 `guardUnload` 테스트는 그대로 둔다.
- `renderer/main.tsx` (modified) — 앱 창에만 버퍼 스토어를 만들어 Provider로 내리고, `beforeunload`를
  `closeGuard`로 바꾼다. 패널 창은 지금 그대로(`guardUnload`만 — 코드 칸이 없다, spec §4의 7).

### renderer — 컴포넌트

- `renderer/components/code/CodeEditor.tsx` (new) — CodeMirror 6을 감싸는 얇은 컴포넌트. props: 문서 키, 텍스트,
  읽기 전용, 언어 이름, 처음 갈 줄, `onChange(text)`, `onSave()`. 확장: 줄 번호, 강조(`@lezer/highlight`),
  괄호 짝, 들여쓰기, 실행 취소, 찾기(`@codemirror/search`), Mod-s → `onSave`. 문서 키가 바뀌면 상태를 새로 만들고,
  같은 키에 바깥 텍스트가 바뀌면(디스크 다시 읽기) 커서 줄을 지키며 교체한다.
- `renderer/components/code/editorTheme.ts` (new) — 색은 전부 `var(--…)`(FR-13). 강조 색도 토큰이다 — 새 토큰이
  필요하면 `index.css` `:root`와 다크 블록에 같이 더한다.
- `renderer/components/code/FileTree.tsx` (new) — 찾기 칸(`파일 이름으로 찾기`) + 트리/퍼지 결과. 펼침은 스토어가
  쥔다. 퍼지는 렌더러에서 다시 만들지 않고 기존 `files.search`를 부른다(`@` 피커와 같은 `matchFiles`·같은 상한 50 —
  FR-9). 렌더러에 같은 판정을 하나 더 두면 피커와 칸이 같은 질의에 다른 순서를 낸다.
- `renderer/components/code/FilePane.tsx` (new) — 칸 하나. 머리(경로·`●`·저장 상태·`파일 저장`·`고친 것 버리기`·
  `파일 목록 새로고침`·`코드 칸 닫기`·`저장하지 않은 파일 N`), 트리, 편집기 자리(편집기 / 열 수 없는 이유 +
  `VS Code에서 열기`), 충돌 배너(FR-19 — 기존 `ConflictBanner`는 문구가 "이 항목"이라 문구를 받게 넓히거나 칸
  전용을 둔다), 디스크 바뀜 표시(FR-22). 바뀜 확인은 칸이 보이는 동안 2초마다 `files.probe`, 보일 때 한 번. 트리는
  열 때·repo가 바뀔 때·같은 workspace의 run이 끝날 때(`events.onRunUpdate`)·새로고침에 다시 읽는다(FR-10). 안에서
  쓴 Esc가 `defaultPrevented`면 `stopPropagation`한다 — CodeMirror가 찾기 창을 닫은 Esc가 도크 최대화를 풀거나
  App의 "열린 항목 닫기"까지 가지 않게(CLAUDE.md "안쪽부터 푼다").
- `renderer/components/code/CodePaneContext.tsx` (new) — 대화록이 쓰는 "이 경로를 칸에서 열기"(FR-23). Dock이
  내린다. 기본값은 null이고 null이면 대화록에 버튼이 없다 — 대화록은 도크 밖(테스트)에서도 그려지므로 던지지
  않는다. 대신 Dock 테스트가 배선을 고정한다.
- `renderer/components/code/CloseConfirm.tsx` (new) — 닫기 확인(FR-21). `role="alertdialog"`, 버튼 셋. App이
  그린다(칸이 접혀 있거나 인박스에 있어도 보여야 한다).
- `renderer/components/Dock.tsx` (modified) — 칸 열림·폭 state(마운트 때 `layout.ts`에서), 새 대화의 작업
  디렉토리(`newCwd`, ConversationPanel이 올려 준다), 대상 repo(`target.ts`), `.dock-split`에 경계와 칸,
  `CodePaneContext` 제공, 헤더에 버튼 슬롯. 칸은 `ConversationPanel`의 key 바깥이다(FR-2).
- `renderer/components/ConversationHeader.tsx` (modified) — **필수** prop `paneButtons: ReactNode`를 오른쪽 끝에
  그린다(새 대화 헤더에도). `Sidebar`의 `repoTree`와 같은 슬롯 모양 — 헤더가 칸 상태를 알 필요가 없다.
- `renderer/components/ConversationPanel.tsx`·`RunPanel.tsx` (modified) — **필수** prop `onCwdChange(cwd)`. RunPanel의
  cwd를 정하는 effect가 값을 바꿀 때마다 부른다(새 대화일 때만 의미가 있다). 선택이면 한 줄을 빠뜨려도 조용히
  컴파일되고 칸이 알약을 안 따라간다.
- `renderer/components/TimelineBlocks.tsx` (modified) — `EditFileRow`의 `li` 안, 펼치기 버튼 **옆**에 아이콘 버튼
  `<displayPath> 코드 칸에서 열기`(버튼 안의 버튼은 안 된다). 줄은 첫 hunk의 `newStart`, 없으면 1.
- `renderer/components/icons.tsx` (modified) — 필요하면 저장 아이콘(`IconSave`)을 더한다. 버튼은 `IconFolder`.
- `renderer/App.tsx` (modified) — `CloseConfirm`을 그린다(스토어의 요청을 듣는다).
- `renderer/index.css` (modified) — 칸·트리·경계·배너. 토큰만, rem.

### 의존성

- `package.json`·`pnpm-lock.yaml` (modified) — devDependencies, 정확한 버전, **2주 넘게 된 것만**(2026-09-25 이전):
  `@codemirror/state` 6.7.6 · `@codemirror/view` 6.43.13 · `@codemirror/commands` 6.11.1 · `@codemirror/search` 6.7.2 ·
  `@codemirror/language` 6.12.4 · `@lezer/highlight` 1.2.4 · `@codemirror/lang-javascript` 6.2.5 ·
  `@codemirror/lang-json` 6.0.2 · `@codemirror/lang-css` 6.3.1 · `@codemirror/lang-html` 6.4.12 ·
  `@codemirror/lang-markdown` 6.5.2 · `@codemirror/lang-python` 6.2.1 · `@codemirror/lang-yaml` 6.1.3.
  `pnpm.overrides`로 `@codemirror/state`·`@codemirror/view`·`@codemirror/language`·`@lezer/highlight`를 위 버전 하나로
  묶는다(아래 위험 1).

### 테스트 · 문서

- 위 순수 함수·스토어마다 `*.test.ts`, `core/files/{text,write}.test.ts`, `core/files/{read,service}.test.ts` 보강,
  `FilePane.test.tsx`, `Dock.test.tsx`·`ConversationHeader.test.tsx`·`RunPanel.test.tsx`·`Transcript.test.tsx`·
  `App.test.tsx` 보강.
- `e2e/code-pane.e2e.ts` (new).
- `CLAUDE.md`(현재 상태 단락 · 함정 · 문서 표), `DESIGN.md`(코드 칸), 이 plan의 완료 증명.

## 순서

0. **기준선과 의존성.** dev가 떠 있지 않은 것을 확인하고(CLAUDE.md — `out/`을 덮는다) `electron-vite build`로
   지금 렌더러 산출물(`out/renderer/assets/*.js`) 크기를 적는다. 의존성을 더하고 `pnpm why @codemirror/state`·
   `@codemirror/view`가 **한 벌**인지 본다. 아직 아무 코드도 쓰지 않으므로 기존 테스트가 그대로 초록이다.
1. **core 순수 함수** `text.ts` — 바이트 왕복(LF·CRLF·BOM·끝 개행 없음·빈 파일), `mixed` 판정(외톨이 `\r` 포함),
   해시. 왕복은 **바이트 비교**로 고정한다.
2. **읽기 확장** `read.ts` — `maxBytes`, 새 필드. 기존 `read.test.ts`는 손대지 않고 초록이어야 한다(`@`의 256 KiB가
   그대로인지 — 상한을 기본값으로 둔 줄을 망가뜨려 기존 테스트가 빨개지는지 본다).
3. **쓰기** `write.ts` — 충돌(해시 다름)은 쓰지 않음, 지워짐, CRLF 파일에 `\n` 텍스트를 써도 CRLF, BOM 유지, junction
   으로 밖을 가리키는 경로 거부(Windows에서 관리자 없이 되는 `symlinkSync(…, 'junction')`), `..`는 **없는 이름**으로
   (CLAUDE.md — 있는 이름이면 realpath가 대신 막아 `..` 검사를 지워도 초록이었다), 읽기 전용 속성 파일이 결과로 오는 것,
   `mixed` 저장이 던지는 것. 같은 inode인지(하드링크 하나 만들어 둘 다 바뀌는지)도 본다.
4. **서비스와 표면** `service.ts`·`index.ts`·shared·preload·ipc — 다른 workspace의 repo 거부, 목록에 없는 경로 거부
   (`.git/config`·무시된 파일), `save`는 새 목록을 받는다(캐시에 있던 파일을 지운 뒤 저장이 거부되는지), `tree`의
   `fresh`. 여기까지 화면은 그대로다.
5. **renderer 순수 함수** — `tree.ts`(정렬·폴더 먼저·펼침·5만 경로를 만드는 시간), `target.ts`(이어 가는 대화 ·
   새 대화 · 기타 · repo 없음 · Windows 대소문자), `editPath.ts`(절대·상대·밖·끝 구분자·Windows), `layout.ts`(자르기·
   저장 실패), `language.ts`(확장자 표). `pathKey`를 내보낸다.
6. **스토어** `codeBuffers.ts`·`closeGuard.ts` — 버퍼가 칸 닫기·키 바꾸기에 남음, 고친 것 목록, 닫기 판정의 순서
   (대기 저장 먼저 → 고친 버퍼 → 닫기), "모두 저장" 중 하나가 충돌이면 닫지 않음, "버림"이면 우회하고 닫음.
   `main.tsx`에 Provider와 가드를 건다(이 두 줄은 e2e가 맡는다).
7. **편집기·칸 컴포넌트** — `CodeEditor`(jsdom에서는 그리지 않는다 — 아래 위험 2), `FileTree`, `FilePane`,
   `CloseConfirm`. `FilePane.test`는 `CodeEditor`를 `vi.mock`으로 textarea로 바꾸고 본다: 열기 → 고치기 → 저장 →
   기대 해시 갱신(두 번째 저장이 자기와 충돌하지 않는다 — CLAUDE.md의 `expected.current` 함정과 같다), 충돌 배너의
   두 길, 디스크 바뀜(고친 것 없음 → 교체 / 있음 → 표시 / 지워짐 → 저장 막힘), 열 수 없는 이유, 섞인 줄바꿈 읽기 전용,
   목록 이유, run이 끝나면 트리 다시 읽기, Esc 전파 차단.
8. **도크 배선** — `Dock`·`ConversationHeader`·`ConversationPanel`·`RunPanel`. `Dock.test`: 버튼이 서고 누르면 칸이
   열린다, 기타 대화는 비활성+이유, 칸이 다시 마운트돼도 열린 채(localStorage), 대화를 바꾸면 대상 repo가 바뀐다,
   새 대화에서 작업 디렉토리 알약을 바꾸면 칸이 따라간다, 칸은 대화를 바꿔도 다시 마운트되지 않는다(트리 펼침이
   남는다), 폭 경계. `ConversationHeader.test`: 슬롯이 두 헤더에 다 선다. `RunPanel.test`: `onCwdChange`가 effect의
   모든 갈래(다시 실행 경로·사이드바 선택·폴백)에서 불린다.
9. **대화록 진입점** — `TimelineBlocks`·`Transcript.test`: 컨텍스트가 있으면 repo 안 편집 줄에만 버튼, 누르면 (경로,
   첫 hunk 줄)로 부른다, 밖이면 버튼이 없다, 컨텍스트가 없으면 버튼이 없다. `Dock.test`에 배선 하나(대화록의 버튼 →
   칸이 열리고 그 파일).
10. **App** — `CloseConfirm` 배선. `App.test`: 스토어가 확인을 요청하면 대화상자가 선다.
11. **CSS** — 토큰만. 다크에서 강조 색 대비를 본다.
12. **e2e** `e2e/code-pane.e2e.ts`(아래 완료 증명) → 그다음 **전체 e2e**(새 이름의 부분 일치 충돌, NFR-4).
13. **캡처** — 임시 `e2e/zz-*.e2e.ts`로 라이트·다크 × 기본 높이·최대화 × (트리+편집기 / 충돌 배너 / 닫기 확인)을 찍어
    보이고, 확인받은 뒤 지운다.
14. **번들 크기와 문서** — 0단계 기준선과 비교해 첫 번들과 언어 조각의 크기를 적는다. CLAUDE.md·DESIGN.md·이 plan.

## 위험

1. **CodeMirror가 두 벌 깔리면 조용히 깨진다.** `@codemirror/state`가 두 인스턴스면 확장이 "알 수 없는 값"으로 거부되거나
   강조가 안 먹는다. pnpm 10의 해석은 `highest`라, 직접 의존을 6.43.13으로 박아도 언어 패키지의 `^6.x`가 더 새 판을
   끌어올 수 있다 — `pnpm.overrides`로 넷을 묶고 0단계에서 `pnpm why`로 본다. 업데이트할 때도 넷을 같이 올린다(CLAUDE.md
   함정으로 적는다). 언어 패키지 하나가 묶은 판보다 새 `@codemirror/language`를 요구하면(설치 경고) 그 언어 패키지를
   한 판 낮춘다 — 본체를 2주 안 된 판으로 올리지 않는다.
2. **jsdom에서 CodeMirror를 믿을 수 없다** — 측정(`getClientRects`)이 없어 뷰가 경고나 오류를 낸다. 그래서 컴포넌트
   테스트는 `CodeEditor`를 대신하고, CodeMirror에 걸린 것(Mod-s, 바깥 텍스트 교체, 처음 갈 줄, 읽기 전용)은 e2e만 본다.
   `CodeEditor`를 얇게 두는 이유다 — 판정은 거기 두지 않는다.
3. **언어 조각이 `file://`에서 안 불릴 수 있다.** 렌더러는 CSP `script-src 'self'`로 `file://`에서 뜬다. 동적 `import()`의
   조각이 같은 디렉토리라 통과할 것으로 보지만 재보지 않았다 — e2e는 빌드한 앱을 띄우므로 `.ts` 파일을 열어 강조 클래스가
   붙는지로 본다. 실패하면 언어 패키지를 첫 번들에 넣고(크기를 적는다) spec FR-12를 고친다.
4. **e2e의 앱 종료가 매달릴 수 있다.** 닫기 가드가 고친 버퍼를 보고 닫기를 멈추면 드라이버의 `close()`가 끝나지 않는다.
   이 테스트는 끝나기 전에 고친 것을 저장하거나 버린다. 다른 e2e는 칸을 열지 않아 해당이 없다. 창을 "X처럼" 닫을 때는
   CLAUDE.md대로 main의 `BrowserWindow.close()`를 부른다(`page.close()`는 beforeunload를 건너뛴다).
5. **바뀜 확인이 2초마다 파일을 읽는다.** 상한 2 MiB를 읽어 해시하는 것이 칸이 보이는 동안 2초마다다. 쓸 만한 값이지만,
   `probe`는 먼저 `stat`의 (크기, mtime)이 지난번과 같으면 지난 해시를 돌려주고 다를 때만 읽는다(core 메모리, 경로 키).
   mtime이 그대로인 채 내용이 바뀌는 경우는 저장 직전의 해시 비교(§3-4의 4)가 마지막으로 막는다.
6. **Windows의 파일 잠금.** dev 서버·백신·인덱서가 잠깐 잡고 있으면 쓰기가 `EBUSY`/`EPERM`이다 — 결과로 보이고 다시
   저장하면 된다(spec §3-5). 받아들인다.
7. **해시 비교와 쓰기 사이의 틈**(spec §3-4) — 받아들인다.
8. **`RunPanel`에 필수 prop이 늘면** RunPanel·ConversationPanel 테스트의 렌더 도우미를 고쳐야 한다. 테스트 하나하나가
   아니라 도우미의 기본값 한 줄이다.
9. **큰 repo.** 목록은 이미 `@` 피커가 받는 것과 같다(상한 20만). 트리는 접힌 폴더 아래를 만들지 않고, 한 폴더에 수천
   개가 있으면 그대로 그린다(가상 스크롤 없음) — 5단계의 시간 테스트로 경계를 적어 두고, 실제로 느리면 다음 사이클로 넘긴다.
10. **칸 폭과 좁은 창.** 목록 196 + 대화 360 + 칸 320 = 876px에 여백이 붙는다. 창이 1280px 아래면 세 패널 중 둘이 숨는
    기존 규칙과 별개로 도크가 그 폭보다 좁아질 수 있다 — `layout.ts`의 자르기는 칸을 320px 아래로 줄이지 않는다
    (그보다 좁은 편집기는 쓸 데가 없다). 대화가 360px를 못 지키는 것은 둘을 합쳐 680px도 안 되는 창뿐이다. 캡처에서
    1280×800을 같이 본다.

## 완료 증명

2026-10-09, Windows 11 · Node 22.23.2.

- [x] **번들**(`out/renderer/assets`, 압축 안 함): 첫 JS 1,324,557 B → **1,366,629 B(+42,072, +3.2%)**, CSS 118,084 → 126,676 B.
  편집기 조각 `CodeEditor-*.js` 699,729 B(칸을 처음 열 때), 언어 조각 아홉 합 약 414 KB(그 확장자를 처음 열 때). 지연 불러오기
  전에는 첫 JS가 2,067,377 B(+56%)였다(달라진 것).
- [x] `pnpm why` — `@codemirror/state` 6.7.6 · `view` 6.43.13 · `language` 6.12.4 · `@lezer/highlight` 1.2.4가 각각 한 벌.
- [x] 테스트를 먼저 쓰고 빨간 것을 본 뒤 구현했다 — 예외는 `FilePane`(구현이 먼저였다, 달라진 것). 변이 확인(되돌린 뒤 초록):
  - `write.ts`의 해시 비교를 끔 → "연 뒤에 디스크가 바뀌었으면 쓰지 않고 충돌" 빨강 (FR-19)
  - `encodeText`의 CRLF 되살리기를 지움 → 왕복 테스트 넷 빨강 (FR-18)
  - `readRepoFile`의 상한을 2 MiB로 → 기존 "정확히 상한이면 통과하고 1바이트 넘으면 거부" 빨강 (`@`의 256 KiB가 그대로다)
  - `save`의 새 목록을 캐시 목록으로 → "캐시 목록에 있었어도 새 목록에서 빠졌으면 던진다" 등 둘 빨강 (spec §3-4의 2)
  - `save`의 목록 검사를 끔 → "`.git` 안이나 무시된 파일은 던진다" 빨강
  - `FilePane`이 저장 뒤 `markSaved`를 안 부름 → "두 번째 저장은 새 해시를 기대한다" 빨강
  - `FilePane`의 Esc `stopPropagation`을 지움 → "편집기가 쓴 Esc는 바깥으로 가지 않는다" 빨강
  - `FilePane`이 고친 버퍼도 디스크를 따라가게 → "고친 것이 있으면 따라가지 않고 알린다" 빨강
  - `closeGuard`의 고친 버퍼 검사를 끔 → 닫기 확인 테스트 둘 빨강 (FR-21)
  - Dock이 `CodePaneContext`에 null을 내림 → "대화록 편집 줄의 코드 칸에서 열기는 칸을 열고 그 파일을 연다" 빨강 (FR-23)
  - Dock이 `onCwdChange`를 빈 함수로 → "새 대화 칸에서는 작업 디렉토리 알약을 따른다" 빨강 (FR-6)
  - RunPanel의 작업 디렉토리 알림 effect를 지움 → 알림 테스트 둘 빨강 (갈래마다가 아니라 한 effect로 알리게 설계해 "한 갈래"
    변이는 없다)
- [x] `e2e/code-pane.e2e.ts` 두 테스트 초록 — git repo(LF `src/auth.ts`, BOM+CRLF `win.cs`)에서 `events` 시나리오로 대화를 돌린 뒤:
  트리에서 열기 → Ctrl+S → **디스크 바이트**(고친 줄만 다르고 CRLF·BOM 그대로) · `.ts`에 강조 클래스(언어 조각이 `file://`에서
  불렸다, 위험 3) · 깨끗한 버퍼가 디스크를 따라감 · 고친 채 디스크가 바뀌면 `디스크에서 바뀜` → 저장 → 충돌 배너 → 덮어쓰기
  → 디스크가 내 내용 · 대화록의 `코드 칸에서 열기` → 그 파일의 41번째 줄에 커서 · 인박스 왕복 뒤에도 칸과 고친 것이 남음 ·
  고친 채 창을 닫으면(main의 `BrowserWindow.close()`) `CloseConfirm` → `모두 저장하고 닫기` → 앱이 끝나고 디스크에 저장됨.
  계획은 `저장하지 않고 닫기`였는데 디스크까지 보는 `모두 저장`으로 바꿨다 — 버리고 닫는 길은 단위 테스트와 캡처 스크립트가 탔다.
- [x] 전체 e2e 초록 — 28개 파일 · 55개 테스트(기존 2개 건너뜀은 그대로). 첫 실행에서는 셋이 이름 충돌로 깨졌다(달라진 것).
  `timeline.e2e`가 세 파일을 함께 돌린 한 번 시간 초과로 실패했는데, 단독 세 번과 전체 실행에서 초록이다.
- [x] 캡처 라이트·다크(기본 높이·최대화·충돌·닫기 확인·1280×800). 캡처에서 고친 것: `버리기`가 24px 아이콘 버튼 폭에 갇혀 두 줄로
  꺾였다, 충돌 배너의 버튼 글자가 꺾였다(좁은 칸에서는 버튼이 아래 줄로), 한글 주석이 가짜 이탤릭으로 기울었다(주석을 기울이지
  않는다). 임시 캡처 스크립트는 지웠다.
- [x] `grep -rn "from 'electron'" core/`와 `grep -rn "window.oneDesk" renderer/ | grep -v main.tsx`가 비어 있다.
- [x] `pnpm typecheck`·`pnpm lint`·`pnpm test`(2,639개) 초록. e2e와 동시에 돌린 한 번은 `core/index.test.ts`의 커맨드 캐시 테스트가
  흔들렸다 — 단독 세 번과 부하 없는 전체에서 초록이고 이 작업이 건드리지 않은 곳이다.

## 달라진 것

구현 중에 계획과 달라지면 여기 적는다.

- 2026-10-09 (0단계) `pnpm.overrides`가 넷이 아니라 여덟이다 — 언어 패키지의 `^1.x` 범위가 2주 안 된 `@lezer/lr`
  1.4.11·`@lezer/css` 1.3.9·`@lezer/markdown` 1.8.0·`@lezer/javascript` 1.5.6을 끌어와, 각각 2026-09-25 이전의 마지막 판
  (1.4.10·1.3.8·1.7.2·1.5.5)으로 묶었다. 새로 들어온 하위 패키지 28개 중 나머지는 전부 2주가 넘었다.
  기준선: 렌더러 JS 1,324,557 B · CSS 118,084 B (`out/renderer/assets`, 압축 안 함).
- 2026-10-09 (2단계) `readRepoFile`의 결과 모양은 그대로 두고 같은 모듈에 `openRepoFile`을 더했다 — 기존 테스트가 결과를
  `toEqual`로 고정해 필드를 더할 수 없었다. 판정은 둘이 같은 `loadBytes`·`resolveRepoPath`를 지나고(NFR-2), 이유 문구의
  동사만 다르다(`@`는 "담을", 칸은 "열"). 쓰기도 `resolveRepoPath`를 쓴다.
- 2026-10-09 (4단계) `open`은 목록에 없는 경로를 **던지지 않고 이유로** 돌려준다(spec §3-3은 던진다고 적었다). 대화록의
  편집 줄이 무시된 파일(`.env`)을 가리킬 수 있어 사람이 만나는 실패이기 때문이다. 캐시 목록에 없으면 한 번 새로 받는다
  (agent가 방금 만든 파일). `save`는 spec대로 던진다. `probe`는 목록을 보지 않는다 — 2초마다 git을 띄울 수 없고 돌려주는
  것은 해시뿐이다(repo 밖은 `resolveRepoPath`가 막는다).
- 2026-10-09 (4단계) 전체 `pnpm test`에서 `core/index.test.ts`의 "rescan은 다시 훑고 갱신된 목록을 준다"가 한 번 실패했다.
  단독으로는 변경 전후 모두 통과하고 다시 돌린 전체도 초록이라, 부하에서 흔들리는 기존 테스트로 본다(이 작업과 무관).
- 2026-10-09 (6단계) `closeGuard`의 "모두 저장" 실패는 **칸에 열지 않고 확인 창 안에 경로와 이유로 남긴다**(spec FR-21 다듬음).
  칸의 대상은 보는 대화의 repo라 다른 repo의 실패 파일을 칸에 열 수 없다.
- 2026-10-09 (7단계) **`FilePane`은 구현을 테스트보다 먼저 썼다** — TDD 순서를 어겼다. 그래서 테스트를 쓴 뒤 핵심 줄 셋을 망가뜨려
  빨개지는 것을 확인했다(완료 증명의 변이 목록). `CodeEditor`의 `react-hooks/exhaustive-deps` 끄기 주석은 지웠다 — 이 저장소는
  그 eslint 플러그인을 쓰지 않아 "규칙을 찾을 수 없다"로 lint가 깨진다.
- 2026-10-09 (8단계) 도크는 대화 칸과 코드 칸을 `.dock-work` 한 겹으로 감싼다 — 칸 폭의 하한·상한을 CSS(`min-width`가
  `max-width`를 이긴다)가 맡고, 끌기의 쓸 수 있는 폭을 그 래퍼에서 잰다. 버튼은 `disabled`가 아니라 `aria-disabled`다 — 비활성
  버튼에는 `title` 풍선이 뜨지 않아 이유가 안 보인다. `layout.ts`에 `resetPaneWidth`(경계 두 번 누르기)를 더했다.
- 2026-10-09 (11단계) 저장하지 않음 표시는 글리프 `●`가 아니라 CSS 원이다 — DESIGN.md("아이콘 자리에 유니코드 글리프를 넣지
  않는다"). 구문 강조 토큰 여덟(`--code-*`)을 라이트·다크로 더했다.
- 2026-10-09 (12단계) 전체 e2e에서 셋(`events` 둘·`timeline` 하나)이 깨졌다 — 대화록 버튼 이름을 `<경로> 코드 칸에서 열기`로 지었더니
  파일 줄을 `{ name: /auth\.ts/ }`로 잡는 셀렉터가 두 버튼을 잡았다(NFR-4가 경고한 그대로). 기존 테스트를 고치지 않고 새 이름을
  `코드 칸에서 열기`로 바꾸고 경로는 `aria-describedby`로 옮겼다(spec FR-23 다듬음). Windows에서는 표시 경로가 `src\auth.ts`라
  처음 이름도 플랫폼마다 달랐다.
- 2026-10-09 (14단계 앞당김) **편집기를 지연 불러오기로 바꿨다**(spec FR-12 다듬음). CodeMirror 본체가 첫 번들에 들어가 2,067,377 B
  (+56%)였다 — `FilePane`이 `CodeEditor`를 `lazy()`로 불러 칸을 처음 열 때 받는다.
- 2026-10-10 **배치를 안 B로 바꿨다**(사용자 — 구현 캡처를 본 뒤 "안 B · 창 오른쪽에 전체 높이로 이거로 수정해줘"). 칸의 상태는
  그대로 `Dock`이 쥐고, App이 workspace 화면에서만 두는 창 오른쪽 열(`.code-column`)에 **포털**로 그린다 — 자리는
  `CodePaneSlotContext`로 내린다(없으면 칸이 서지 않는다). 도크 안의 `.dock-work` 래퍼는 걷었다(도크 구조가 이 작업 전으로
  돌아갔다). 폭은 사이드바를 뺀 창 폭 기준이 됐다 — 기본 40%(`DEFAULT_PANE_RATIO`), 칸 320px · 본문 560px(`MIN_MAIN_PX`, 옛
  `MIN_CONVERSATION_PX` 360px를 대신한다). 도크를 접어도 칸이 남는다(spec FR-5 바뀜). 테스트: `Dock.test` 셋("내려받은 자리에
  선다"·"도크를 접어도 칸은 남는다"·"자리가 없으면 서지 않는다"), `App.test` 하나("앱 창 오른쪽 열에 서고, 인박스에 다녀와도
  다시 선다"), `layout.test` 기준 변경. 변이: 포털을 `open &&` 안으로 → 접기 테스트 빨강, App이 자리에 null을 내림 → App
  테스트 빨강. 단위 2,643개·코드 칸 e2e 초록. 1280×800에서는 본문이 약 630px라 이슈 배너 버튼·입력부 알약이 줄바꿈된다(spec
  §4의 5).
