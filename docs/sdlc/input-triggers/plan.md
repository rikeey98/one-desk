# Plan: 입력 트리거 `@` — 파일 참조

- 출처: `intent.md`, `spec.md` (같은 디렉토리)
- 작성자: 권용현 (초안: Claude)
- 상태: 구현 완료 (2026-09-28)
- 작성일: 2026-09-28

## 0. 먼저 적어 두는 것

**마이그레이션이 없다.** `run_context_item.item_type`은 SQL에서 `text NOT NULL`이고 CHECK가 없다
(`drizzle/0001_natural_slayback.sql`). `core/db/schema.ts`의 enum에 `'file'`을 더해도 `pnpm db:generate`는
아무것도 만들지 않아야 한다 — 만들면 멈추고 들여다본다. 테이블 재생성 마이그레이션은 `run_context_item`의
기록을 태우므로 어떤 경우에도 쓰지 않는다(CLAUDE.md `root_run_id` 함정).

**파일을 읽는 자리는 하나, 멘션 문법도 하나다.** 읽기는 `core/files/read.ts`의 `readRepoFile`, 문법은
`shared/mentions.ts`. 피커(렌더러)와 해석·조립(core)이 같은 문법 함수를 쓴다.

**`/` 피커는 회귀하면 안 된다.** `renderer/slash.ts`는 고치지 않는다. `CommandPicker`는 껍데기만
`PickerPopover`로 떼고 DOM은 그대로 둔다. `slash.test.ts`·`CommandPicker.test.tsx`·`e2e/slash.e2e.ts`는
**한 줄도 고치지 않은 채** 초록이어야 한다 — 고쳐야 통과한다면 그것이 회귀다.

**`RunPanel.tsx`는 지금 prompt-history 작업이 고치는 중이다**(작업 트리에 `promptHistory.ts`와
`onPromptKeyDown`의 ↑↓ 분기가 있다). 이 plan은 그것이 들어간 뒤를 기준으로 한다 — 피커 분기가 history
분기보다 먼저라는 순서를 `@` 피커도 그대로 탄다.

**0단계 실측 결과에 따라 두 곳이 바뀐다.** M2가 "펼치지 않는다"면 7단계의 `esc`의 `@` 처리(spec §7의 2)를
빼고, M3에서 `＠`가 펼쳐지면 중화 글자를 바꾼다. 실측 결과는 spec §6에 적고 이 plan의 이탈 기록에 남긴다.

## 변경되는 파일

| 파일 | 신규/수정 | 변경 내용 |
| --- | --- | --- |
| `shared/models.ts` | 수정 | `ContextItemType`에 `'file'`. `FileHit`·`FileSearchResult`·`FileSearchInput` |
| `shared/client.ts` | 수정 | `files: { search(input): Promise<FileSearchResult> }` |
| `shared/channels.ts` | 수정 | `filesSearch: 'files:search'` |
| `shared/mentions.ts` | **신규** | `findMentionToken`·`insertMention`·`scanMentions`·`formatMention`·`longestFileMatch(token, set)` |
| `shared/mentions.test.ts` | **신규** | 아래 테스트 1~9 (core 프로젝트의 `shared/**/*.test.ts` include에 걸린다 — 돌았는지 개수로 확인) |
| `core/db/schema.ts` | 수정 | `runContextItem.itemType` enum에 `'file'` (SQL 변화 없음) |
| `core/db/repositories/run.ts` | 수정 | `livingNames`/`loadContext`에 `file` — id를 첫 `:`로 갈라 repo가 살아 있으면 상대 경로를 이름으로 |
| `core/db/repositories/run.test.ts` | 수정 | 테스트 26~27 |
| `core/files/list.ts` | **신규** | `listRepoFiles(root, { findGit, spawn, timeoutMs })` — `git ls-files -co --exclude-standard -z`, 비동기, stdin 닫음, `windowsHide`, 5초, 200,000개 상한 |
| `core/files/list.test.ts` | **신규** | 테스트 10~14 |
| `core/files/match.ts` | **신규** | `matchFiles(paths, query, limit = 50)` |
| `core/files/match.test.ts` | **신규** | 테스트 15~17 |
| `core/files/read.ts` | **신규** | `readRepoFile(root, rel, { platform })` — 절대·`..`·realpath 탈출·일반 파일·NUL·UTF-8 fatal·BOM·256 KiB |
| `core/files/read.test.ts` | **신규** | 테스트 18~22 |
| `core/files/service.ts` | **신규** | 캐시(repo 경로별 10초, 프로미스째, 실패는 캐시 안 함) + `search` + `resolveMentions(repo, prompt)`(새 목록으로 해석, 읽기, 합계·개수 상한) |
| `core/files/service.test.ts` | **신규** | 테스트 23~25 |
| `core/context/assemble.ts` | 수정 | `AssembleInput.files: FileForPrompt[]`. `<files>` 블록(memos 뒤·skills 앞). `rewriteMentions`로 지시문의 `@` 다시 쓰기(FR-12). (M2에 따라) `esc`가 `@` → `&#64;` |
| `core/context/assemble.test.ts` | 수정 | 테스트 28~32 — **기존 테스트는 고치지 않는다** |
| `core/execution.ts` | 수정 | `collectContext`가 `file`을 거부. `launch`에 `resolveFileMentions` 단계(spec §5-3). `runs.create`의 `context`에 파일 refs. `ExecutionOptions`에 `files` 의존성 |
| `core/execution.test.ts` | 수정 | 테스트 33~37 |
| `core/index.ts` | 수정 | `createFileService` 생성, `files: { search }` 표면, 실행 서비스에 주입 |
| `core/index.test.ts` | 수정 | 테스트 38 |
| `electron/ipc/files.ts` | **신규** | `ipcMain.handle(CHANNELS.filesSearch, (_e, i) => core.files.search(i))` 한 줄 |
| `electron/ipc/index.ts` | 수정 | `registerFileHandlers(core)` |
| `electron/preload.ts` | 수정 | `files.search` |
| `renderer/components/PickerPopover.tsx` | **신규** | `CommandPicker`에서 뗀 껍데기 — popover 마운트·머리 줄·상태 줄·listbox. 클래스 `command-picker` 유지 |
| `renderer/components/CommandPicker.tsx` | 수정 | `PickerPopover`를 쓴다. **DOM·문구·이름 불변** |
| `renderer/components/FilePicker.tsx` | **신규** | 그룹 머리 `파일`, 줄 = `IconFile` + `.file-option-dir`(흐림) + `.file-option-name`, listbox 이름 `파일 참조`, option id `${listboxId}-f${i}` |
| `renderer/components/FilePicker.test.tsx` | **신규** | 테스트 39~41 |
| `renderer/components/icons.tsx` | 수정 | `IconFile` (aria-hidden) |
| `renderer/hooks/useFileSearch.ts` | **신규** | `useCommands` 모양 — 순번 가드, 키가 바뀌면 옛 결과 숨김, 120ms 디바운스 |
| `renderer/hooks/useFileSearch.test.tsx` | **신규** | 테스트 42~43 |
| `renderer/components/RunPanel.tsx` | 수정 | `token` → `trigger`(`slash`\|`mention`). `repoId = repos.find(r => r.path === effectiveCwd)?.id`. 피커 분기·삽입·aria-controls/activedescendant가 `trigger.kind`로 갈린다 |
| `renderer/components/RunPanel.test.tsx` | 수정 | 테스트 44~49 |
| `renderer/components/ConversationHeader.tsx` | 수정 | `TYPE_LABELS.file = '파일'` (Record라 빠지면 컴파일 오류) |
| `renderer/components/ConversationHeader.test.tsx` | 수정 | 테스트 50 |
| `renderer/components/ConversationPanel.tsx` | 수정 | `resend`가 `contextItems`에서 `file`을 뺀다 |
| `renderer/components/ConversationPanel.test.tsx` | 수정 | 테스트 51 |
| `renderer/index.css` | 수정 | `.file-option*` — 토큰 색만(`--text-muted`), 경로는 `--font-mono`, 디렉토리 앞 생략(`direction: rtl` 금지 — `text-overflow` + 파일명 `flex: none`) |
| `e2e/mention.e2e.ts` | **신규** | 한 바퀴(spec §9) |
| `core/files/realCli.test.ts` | **신규** | `ONE_DESK_REAL_CLI=1` 전용 — 중화가 claude의 펼치기를 막는다 |
| `docs/sdlc/input-triggers/spec.md` | 수정 | §6 실측 결과, §7 결정 |
| `docs/backlog.md` | 수정 | §2를 `docs/sdlc/input-triggers/`로 뗐다고 적는다 |
| `CLAUDE.md` | 수정 | 현재 상태 한 문단, 함정 절(아래 "CLAUDE.md에 남길 것"), 문서 표에 행 |

**건드리지 않는 것**

- `drizzle/` — §0.
- `renderer/slash.ts`·`e2e/slash.e2e.ts`·`renderer/context.ts` — 파일 칩이 없다(spec FR-9, §7의 6).
- `core/runner/adapters/*` — 새 CLI 플래그가 없다(opencode `-f`를 쓰지 않는다).
- `core/runner/fixtures/*` — 가짜 claude의 `ONE_DESK_PROMPT_CAPTURE`로 충분하다. 기본 시나리오를 건드리지 않는다.
- `App.tsx`의 칩 state — 바뀌지 않는다.

## 작업 순서

TDD다. 렌더러 테스트는 **Node 22**. 각 단계는 테스트가 **먼저 빨간 것을 본 뒤** 구현한다.

0. **실측(코드 없음).** 이 장비의 claude로 spec §6의 M1~M4를 돈다 — one-desk와 같은 인자
   (`-p --output-format stream-json --verbose`, `--tools` 읽기 전용 화이트리스트)로 **stdin**에 프롬프트를 넣고,
   임시 디렉토리의 `secret.txt`(무작위 문장)를 짚는다. 후보: `@secret.txt`, `<context>` 안 `@secret.txt`,
   `&lt;x&gt; @secret.txt`, `＠secret.txt`, `&#64;secret.txt`, `@"s e.txt"`, `@../`·`@~/`·절대 경로, `@dir/`.
   판정은 답에 그 문장이 나오는가 + stream-json에 tool_use가 없는가. **완료 확인**: 결과표를 spec §6에 적고,
   사람이 spec §7의 1·2·3·4·5·6·9를 정했다. 정해지지 않았으면 1단계로 가지 않는다.
1. **타입·채널·스키마 enum.** `shared/models.ts`·`client.ts`·`channels.ts`·`schema.ts`. **완료 확인**:
   `pnpm typecheck`가 `run.ts`의 `names` 객체, `ConversationHeader`의 `TYPE_LABELS`, preload/IPC의 `files` 자리에서만
   빨갛다(다른 곳이 깨지면 표에 올린다). `pnpm db:generate` → "No schema changes", `git status`에 `drizzle/` 변화 없음.
2. **`shared/mentions.ts`** — 테스트 1~9 → 구현. **완료 확인**: 초록, `pnpm test`의 파일 수가 1 늘었다(include 함정).
3. **`core/files/match.ts`** — 15~17 → 구현.
4. **`core/files/list.ts`** — 10~14 → 구현. **완료 확인**: 초록. 이 저장소(406개, 실측 0.04초)와 큰 repo 하나에서
   `listRepoFiles` + `matchFiles` 한 번의 시간을 재어 spec §7의 10에 적는다.
5. **`core/files/read.ts`** — 18~22 → 구현. junction은 Windows에서 권한 없이 만들 수 있다
   (`symlinkSync(target, path, 'junction')`); posix는 `'dir'` 심링크.
6. **`core/files/service.ts`** — 23~25 → 구현.
7. **`assemble.ts`** — 28~32 → 구현. **완료 확인**: 새 테스트 초록 + **기존 `assemble.test.ts` 전체가 수정 없이 초록**.
8. **`execution.ts`** — 33~37 → 구현. **완료 확인**: `execution.test.ts` 전체 초록.
9. **`run.ts`** — 26~27 → 구현.
10. **core 표면·IPC·preload** — 38 → 구현. **완료 확인**: `pnpm typecheck` 0, 경계 grep 둘 무출력.
11. **`PickerPopover` 떼기** — 테스트를 새로 쓰지 않는다. **완료 확인**: `CommandPicker.test.tsx`·`RunPanel.test.tsx`
    전체가 수정 없이 초록.
12. **`FilePicker`·`useFileSearch`·`IconFile`** — 39~43 → 구현.
13. **`RunPanel`** — 44~49 → 구현. **완료 확인**: 기존 `RunPanel.test.tsx`(prompt-history 것 포함) 초록.
14. **`ConversationHeader`·`ConversationPanel`** — 50~51 → 구현.
15. **e2e** `e2e/mention.e2e.ts` — `launchApp` 뒤 `app.repoDir`에서 `git init`(테스트 프로세스의
    `execFileSync`는 괜찮다 — 앱 밖이다), `notes/a.txt`(무작위 문장)·`.gitignore`(`ignored.txt`)·`ignored.txt`를 쓴다.
    workspace·repo 등록 → 입력칸 `@not` → `getByRole('option', { name: 'notes/a.txt', exact: true })` → Enter →
    입력칸이 `@notes/a.txt `인지 → `@ign`에서 option 0개 → 실행(`{ name: '실행', exact: true }`) → 성공 대기 →
    캡처 stdin 단언 → 헤더의 담긴 것에 `파일 · notes/a.txt`(title). **완료 확인**: `pnpm exec electron-vite build &&
    pnpm exec vitest run --config vitest.e2e.config.ts e2e/mention.e2e.ts e2e/slash.e2e.ts` 통과, 그다음 e2e 전체
    (짧은 라벨 함정 — `파일 참조`·경로 option).
16. **realCli** — `ONE_DESK_REAL_CLI=1 pnpm test realCli`로 한 번 돈다(0단계의 회귀).
17. **문서** — spec §6·§7, backlog, CLAUDE.md.
18. **전체 검증** — 아래 완료 증명.
19. **커밋 하나** — `feat: @로 작업 디렉토리의 파일을 짚어 맥락으로 싣는다`.

## 테스트 (실패를 먼저 본다)

`shared/mentions.test.ts`
1. `findMentionToken`: 줄머리 `@ab|` → `{ start: 0, query: 'ab' }`. 줄 가운데 `보고 @ab|` → 열림. `a@b|` → null. 캐럿이 토큰 가운데면 `end`가 토큰 끝.
2. 따옴표: `@"a b|` → `{ query: 'a b', quoted: true }`. 닫힌 따옴표 뒤 공백이면 null.
3. `insertMention`: 토큰을 `@path `로 바꾸고 캐럿은 공백 뒤. 뒤에 붙어 있던 글자는 보존(`slash.ts` `insertCommand`와 같은 공백 규칙).
4. `formatMention`: 공백·선행 `"`가 있으면 따옴표 형식.
5. `scanMentions`: 줄머리·공백 뒤만, 이메일 제외, 따옴표 형식 포함, 개행 뒤도 줄머리다.
6. `longestFileMatch`: `src/a.ts를` → `src/a.ts`, `src/a.ts,` → `src/a.ts`, `src/a.tsx`가 있으면 `src/a.tsx`를 이긴다(더 긴 것), 없으면 null.
7. `longestFileMatch`: Windows에서만 `src\a.ts` → `src/a.ts` (platform 인자).
8. `#10-20`이 붙은 토큰은 앞의 파일을 잡는다(spec §7의 8 — 결정이 바뀌면 이 테스트가 바뀐다).
9. 빈 질의 `@|` → 열림, query `''`.

`core/files/list.test.ts` (임시 디렉토리 + 진짜 git, 비동기)
10. 추적·추적 안 함·무시됨 셋 중 앞 둘만, `/` 구분.
11. 한글 파일명(`메모.txt`)이 인용 없이 온다(`-z`).
12. git 저장소가 아니면 `{ ok: false }`이고 reason이 "git 저장소가 아니라"로 시작한다.
13. git을 못 찾으면(주입) `git 실행 파일을 찾을 수 없습니다`. 타임아웃(주입한 spawn이 끝나지 않음)이면 프로세스를 죽이고 실패.
14. 200,000개 상한(주입한 출력) → `truncated: true`.

`core/files/match.test.ts`
15. 등급 순서 — 파일명 앞글자 > 파일명 안 > 경로 안 > 건너뛰기. 대소문자 무시.
16. 같은 등급은 짧은 경로 → 사전순. 50개 상한.
17. 빈 질의는 얕은 경로부터 사전순.

`core/files/read.test.ts`
18. 정상 파일은 내용, BOM은 걷힌다.
19. 절대 경로·`../x`·`a/../../x`는 `repo 밖의 파일`.
20. junction(Windows)/심링크(posix)로 루트 밖 디렉토리를 가리키는 `link/secret.txt` → `repo 밖의 파일`. **루트 자체가 심링크 경로여도** 안의 파일은 통과한다(양쪽 realpath).
21. 디렉토리 → `파일이 아닙니다`. NUL → `바이너리`. 잘못된 UTF-8(`0xff`) → `UTF-8 텍스트가 아닌`.
22. 256 KiB + 1바이트 → 크기 거부, 정확히 256 KiB → 통과.

`core/files/service.test.ts`
23. 캐시: 10초 안의 두 번째 `search`는 git을 다시 띄우지 않고, 동시에 온 둘도 한 번, 실패는 다음에 다시 띄운다(가짜 시계).
24. `search`가 다른 workspace의 repo id를 받으면 던진다.
25. `resolveMentions`: **캐시가 아니라 새 목록**을 쓴다(캐시 뒤에 만든 파일이 해석된다). 같은 파일 두 번은 하나. 합계 512 KiB·21개 초과는 거부. 무시된 파일(`@.env`)은 해석되지 않는다.

`core/db/repositories/run.test.ts`
26. `file` 맥락으로 만든 run의 `contextItems`에 `{ type: 'file', id: '<repoId>:notes/a.txt', label: 'notes/a.txt' }`.
27. 그 repo를 지우면 `file` 항목이 빠진다(다른 종류와 같은 규칙).

`core/context/assemble.test.ts`
28. `files`가 있으면 `<files><file repo path>`가 memos 뒤·skills 앞, 본문의 `<`·`&`·`"`(속성)가 이스케이프.
29. 해석된 멘션은 `@`만 빠진다(`@src/a.ts를` → `src/a.ts를`, 따옴표 형식 포함). 해석 안 된 `@x`·`@../y` → `＠x`·`＠../y`. `a@b.com`은 그대로.
30. 슬래시 지시문 + 멘션 → 첫 글자 `/`, 파일은 뒤의 `<context>`.
31. `@`가 없고 `files`가 비면 결과가 이 변경 전과 같다(기존 테스트 전부 + 대표 입력의 스냅샷 비교 하나).
32. (M2가 "펼친다"일 때만) 이슈 본문의 `@secret` → `&#64;secret`.

`core/execution.test.ts`
33. `context`에 `{ type: 'file' }`을 넣으면 `start`가 거부되고 run 행이 생기지 않는다.
34. 지시문 `@notes/a.txt 봐`(진짜 git repo를 작업 디렉토리로) → `assembledPrompt`에 파일 문장, `run_context_item`에 file 행, 저장된 `userPrompt`는 원문.
35. 크기 초과·바이너리 멘션 → `start` 거부, run 행 없음, 오류 문구에 경로.
36. 지시문에 `@`가 없으면 git을 띄우지 않는다(주입한 `listRepoFiles` 호출 0).
37. `resume`(이어 가는 턴)도 뿌리의 cwd repo로 해석한다. agentKind가 opencode여도 `assembledPrompt`가 claude일 때와 같다.

`core/index.test.ts`
38. `core.files.search`가 등록된 repo에서 파일을 찾는다(IPC 표면 배선).

`renderer/components/FilePicker.test.tsx`
39. option 이름이 상대 경로이고 디렉토리 부분에 `.file-option-dir`가 있다. listbox 이름 `파일 참조`, 그룹 머리 `파일`.
40. `loading`·빈 결과·`reason`이 각각 `불러오는 중…`·`일치하는 파일이 없습니다`·alert.
41. `truncated`면 "일부에서만 찾습니다".

`renderer/hooks/useFileSearch.test.tsx`
42. 늦게 온 옛 질의의 응답이 새 결과를 덮지 않는다.
43. `enabled`가 거짓이면 부르지 않는다. 디바운스 안의 연속 입력은 한 번만 부른다.

`renderer/components/RunPanel.test.tsx`
44. `@no`를 치면 `files.search`가 `{ workspaceId, repoId: <작업 디렉토리의 repo>, query: 'no' }`로 불리고 listbox `파일 참조`가 보인다. **agent가 opencode여도.**
45. Enter → 입력칸이 `@notes/a.txt `, 실행(`runs.start`)이 불리지 않았다. Tab도 같다.
46. `@` 피커가 열린 동안 ↑는 피커 선택을 옮기고 history를 넘기지 않는다.
47. Esc로 닫고 다시 치면 열린다(`dismissed` 공유).
48. 작업 디렉토리가 repo 목록에 없으면 이유가 alert로 보이고 `files.search`를 부르지 않는다.
49. `/` 피커는 claude에서만 — opencode에서 `/`는 여전히 열리지 않는다(기존 테스트가 있으면 그것으로 갈음).

`renderer/components/ConversationHeader.test.tsx`
50. `file` 항목이 `파일 · notes/a.txt`로 보인다.

`renderer/components/ConversationPanel.test.tsx`
51. 다시 보내기의 `runs.resume` 인자 `context`에 `file`이 없고 `userPrompt`는 원문 그대로다.

## 변이 확인

아래 한 줄씩을 지우거나 바꿔 **반드시 빨개지는** 테스트가 있는지 본다. 살아남으면 테스트를 고친다.

| 변이 | 빨개져야 할 테스트 |
| --- | --- |
| `assemble.ts`에서 해석된 멘션의 `@` 떼기를 건너뜀 | 29, e2e(`@notes/a.txt`가 없어야 한다) |
| 해석 안 된 `@`의 `＠` 치환을 건너뜀 | 29 |
| `readRepoFile`의 realpath 비교를 정규화 경로 비교로 바꿈 | 20 |
| `..` 검사 제거 | 19 |
| `list.ts`에서 `--exclude-standard` 제거 | 10, 25(`@.env`), e2e(`@ign` option 0개) |
| `list.ts`에서 `-z` 제거 | 11 |
| `resolveMentions`가 새 목록 대신 캐시를 씀 | 25 |
| `collectContext`의 `file` 거부 제거 | 33 |
| `launch`에서 `runs.create`의 파일 refs 제거 | 34, 26은 통과해도 34가 잡아야 한다 |
| `RunPanel`이 `repoId` 대신 다른 repo(예: 첫 repo)를 넘김 | 44 (repo 둘을 둔 테스트여야 한다) |
| `RunPanel`의 `@` 트리거를 `agentKind === 'claude-code'`로 가둠 | 44 |
| 피커 분기를 history 분기 뒤로 옮김 | 46 |
| `ConversationPanel.resend`의 `file` 거르기 제거 | 51 |
| `electron/ipc/files.ts` 등록 한 줄 제거 | e2e (단위 테스트는 못 잡는다 — IPC 배선은 e2e 몫) |

## 리스크

| 리스크 | 영향 | 완화 |
| --- | --- | --- |
| 0단계에서 claude가 `＠`·`&#64;`까지 펼친다 | 중화가 성립하지 않는다 | 중화를 "`@` 제거"로 바꾸고 spec §7의 1을 다시 정한다. 착수 전에 드러나게 0단계가 맨 앞이다 |
| M2가 "펼친다" — 기존 맥락 본문이 이미 구멍이다 | 이 기능과 무관하게 권한 밖 읽기 | spec §7의 2의 결정. 따로 떼기로 하면 backlog에 올리고 이 plan의 32를 뺀다 |
| git의 `safe.directory` 거부(외장 드라이브·다른 사용자 소유) | 그 repo에서 `@`가 안 된다 | 이유 줄에 git 첫 줄을 그대로 보인다. `-c safe.directory=*`로 우회하지 않는다 — git의 보안 판단을 앱이 뒤집는 일이다 |
| 큰 repo에서 메인 프로세스의 매칭이 느리다 | 입력 중 MCP 응답 지연 | 200,000개 상한, 120ms 디바운스, 4단계에서 측정. 느리면 매칭을 worker로 옮기는 것을 spec에 올린다 |
| 파일 원문이 `run.assembled_prompt`에 쌓인다 | DB가 커지고 비밀이 남는다 | 턴 512 KiB 상한. 보존 정책은 spec §7의 7 — `conversation-next`로 |
| `PickerPopover`를 떼며 `CommandPicker` DOM이 바뀐다 | `/` e2e·단위가 깨진다 | 11단계에서 테스트를 고치지 않고 초록인지 본다. 고쳐야 하면 뗀 방식을 되돌린다 |
| 새 이름 `파일 참조`·경로 option이 기존 e2e의 부분 일치에 걸린다 | e2e 무더기 실패 | 15단계에서 e2e 전체. `getByRole('option')`을 이름 없이 세는 e2e가 있는지 grep(`slash.e2e.ts`는 이름 정규식이라 안전) |
| e2e의 `repoDir`가 git 저장소가 아니다 | 피커가 이유만 보인다 | `mention.e2e.ts`만 `git init`한다. 다른 e2e는 `@`를 치지 않는다 |
| junction/심링크 테스트가 CI 권한에 막힌다 | Windows CI만 빨강 | Windows는 junction(권한 불필요), posix는 dir 심링크. 만들기 실패 시 건너뛰지 말고 실패시킨다 — 건너뛰면 탈출 검사가 무방비다 |
| 테스트가 연 DB·git 자식 프로세스 핸들 | Windows `EBUSY` | `db.$client.close()`, git 자식은 `close` 이벤트까지 기다린다 |
| 줄 끝 | CRLF가 섞인다 | 새 파일은 LF. `git diff --check`와 `file`로 확인 |

## CLAUDE.md에 남길 것 (17단계)

- 현재 상태: `@` 파일 참조 한 문단 — 지시문의 멘션이 곧 맥락(칩 없음), core가 git 목록 + realpath로 해석, 마이그레이션 없음.
- 함정: **claude는 프롬프트의 `@경로`를 도구 권한 밖에서 펼친다** — 조립기의 중화를 지우지 말 것(0단계 실측 인용).
- 함정: 피커와 해석은 같은 목록(`listRepoFiles`)이어야 한다 — 따로 두면 피커에 없는 `.env`가 손으로 치면 실린다.
- 함정: `file` 맥락 id는 `<repoId>:<상대 경로>`이고 `ContextItemRef`로 들어오면 거부된다 — "다시 보내기"가 거르는 이유.
- 문서 표: `docs/sdlc/input-triggers/` 행.

## 완료 증명

- [x] spec §6 실측표가 채워지고 §7의 결정이 적혔다(2026-09-28, 전부 추천대로)
- [x] `pnpm test` — 작업 전 105 파일·2134개(prompt-history 반영 후) → 112 파일·2216개 통과(건너뜀: realCli 둘)
- [x] `pnpm typecheck` 0 · `pnpm lint` 0
- [~] `pnpm test:e2e` — 45개 중 42 통과, 2 건너뜀, **1 실패**: `composer.e2e.ts`의 "최대화 … 최신으로 이동".
  이 작업 전 코드(stash)로도 3/3 실패하는 기존 실패다 — 이 작업과 무관. `mention.e2e.ts`·`slash.e2e.ts` 통과
- [x] `ONE_DESK_REAL_CLI=1 pnpm test realCli`(`core/files/realCli.test.ts`) 통과. **중화를 끄면 실패** — claude가
  `PELICAN-1111`(repo 안)·`CRANE-4444`(repo 밖)을 둘 다 답했다
- [x] `pnpm db:generate` → "No schema changes", `drizzle/` 변화 없음
- [x] `slash.ts`·`slash.test.ts`·`CommandPicker.tsx`·`CommandPicker.test.tsx`·`e2e/slash.e2e.ts`의 diff가 비었고,
  `assemble.test.ts`는 추가만 있다(삭제 줄 0)
- [x] 변이 — 전부 빨강 확인 후 되돌림:
  해석된 멘션 `@` 떼기 건너뜀 → 5 실패 · `＠` 중화 건너뜀 → 5 · `esc`의 `&#64;` 제거 → 1 · realpath 비교 제거 → 1 ·
  `..` 검사 제거 → 2(처음엔 0 — 아래 이탈 4) · `--exclude-standard` 제거 → 2 · `-z` 제거 → 2 ·
  `resolveMentions`가 캐시 사용 → 1 · `collectContext`의 file 거부 제거 → 1 · `runs.create`의 파일 refs 제거 → 1 ·
  RunPanel이 첫 repo를 넘김 → 2 · `@`를 claude로 가둠 → 4 · `resend`의 file 거르기 제거 → 1 ·
  `loadContext`의 file 이름 제거 → 2. IPC 등록 한 줄은 `mention.e2e.ts`만 잡는다(단위 테스트는 preload를 타지 않는다)
- [x] 경계 grep 둘 무출력, `core/files/`의 테스트 아닌 파일에 `execFileSync` 없음
- [x] 측정: 이 저장소(426개) 목록 36ms + 매칭 0.9ms. 20만 개 합성 목록 매칭 53~109ms(질의당, 메인 프로세스) —
  120ms 디바운스로 치는 동안은 한 번이다. worker로 옮길 만큼은 아니라고 본다(spec §7의 10)
- [x] 새 파일이 LF다
- [ ] 수동(실제 앱에서 이 저장소로 `@run` → RunPanel.tsx): **하지 않았다.** 대신 e2e가 빌드된 앱에서 피커를
  캡처했다(`e2e/artifacts/mention-picker.png` — 파일 아이콘·흐린 디렉토리·파일명, 입력칸 위 popover)

## 계획 이탈 기록

1. **`PickerPopover`를 떼지 않았다.** `FilePicker`가 같은 popover·anchor 클래스(`command-picker`)를 쓰는
   독립 컴포넌트다 — `CommandPicker`를 한 글자도 바꾸지 않는 편이 NFR-5를 더 확실히 지킨다. 대가로 popover 마운트
   3줄이 두 벌이다.
2. **option에 `aria-label`을 명시했다.** 디렉토리·파일명 두 칸이라 jsdom이 이름을 `notes/ a.txt`로 계산했다.
3. **파일 속성은 `"`까지 막는 `attr()`로 조립한다.** 기존 `esc`는 `"`를 막지 않는다 — 기존 블록의 조립 결과를
   바꾸지 않으려고 새 `<file>` 속성에만 썼다(기존 `repo name="…"` 등의 속성 탈출은 이 작업 밖이다).
4. **`..` 검사 테스트를 "없는 이름"으로 바꿨다.** `../x`는 이 장비의 임시 폴더에 `x`가 있어 realpath 검사가 대신
   막았고, `..` 검사를 지워도 초록이었다.
5. **`list.test.ts`의 타임아웃 사례는 가짜 자식으로 돈다.** 진짜 node 자식은 10번 중 1번 흔들렸다.
6. **새 파일 목록에서 빠진 것:** `shared/mentions.ts`에 `rewriteMentions`를 두었다(plan은 `assemble.ts`) — 문법과
   같은 경계 정규식을 한 곳에서 쓰려는 것이다. 조립기는 그것을 부른다.
7. 테스트 번호와 1:1은 아니다 — `useFileSearch` 42·43, RunPanel 44~48과 "이메일 `@`에서 열리지 않는다" 하나를 더했다.
   RunPanel 49(`/`는 claude만)는 기존 슬래시 테스트로 갈음했다.
