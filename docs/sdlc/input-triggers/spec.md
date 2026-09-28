# Spec: 입력 트리거 `@` — 파일 참조

- 출처: `intent.md` (같은 디렉토리). 결정 1~8은 2026-09-28 사용자가 정했다(아래 §0)
- 작성자: 권용현 (초안: Claude)
- 상태: 구현 완료 (2026-09-28) — §6 실측, §7 전부 추천대로
- 작성일: 2026-09-28

## 0. intent 결정에 대한 답

| intent 질문 | 결정 (2026-09-28) | 이 spec에서 |
| --- | --- | --- |
| 1. 실어 보내는 방식 | **(c) 앱이 파일을 읽어 맥락 블록으로 싣는다** — 두 CLI가 같다 | FR-9~FR-14 |
| 2. run 기록에 남길지 | **남긴다** — 맥락 종류 `'file'` | FR-15~FR-17, §4 |
| 3. 검색 범위 | **지금 작업 디렉토리(repo) 하나, `.gitignore`를 따른다** | FR-5, §3-2 |
| 4. `@agent` | **뺀다** | §1 빠지는 것 |
| 5. `!` 셸 | **뺀다** | §1 빠지는 것 |
| 6. 삽입 모양 | **글자** — `@상대경로 `가 textarea에 들어간다 | FR-3 |
| 7. 줄 범위·디렉토리 | **뺀다** | §1 빠지는 것 |
| 8. "UI 그대로"의 기준 | **Desktop** — 그룹 머리·파일 아이콘·흐린 디렉토리 + 파일명 | FR-2 |

## 1. 범위

입력칸에서 `@`를 치면 **지금 작업 디렉토리 repo의 파일**을 퍼지로 고르는 피커가 뜬다. 고르면
`@src/a.ts ` 글자가 들어가고, 보내면 **core가 그 파일을 읽어 `<context>`에 싣고** run 기록에
`file` 맥락으로 남긴다. 지시문의 `@` 글자는 CLI에 그대로 가지 않는다 — claude가 스스로 펼치기
때문이다(§2, FR-12).

**빠지는 것**

- **`@agent`** — opencode에만 뜻이 있고(하위 에이전트 지정), claude에는 대응이 없다. "두 CLI에서
  같게"라는 이 기능의 전제와 어긋난다. 넣으려면 opencode 어댑터가 `--agent`를 받아야 하는데 그것은
  run 조건(agent-setup)의 일이다.
- **`!` 셸** — OpenCode의 `!`는 서버의 `session.shell`을 부르는데 헤드리스 `run`에는 대응이 없다
  (intent 조사). 앱이 직접 셸을 띄우면 권한 모델(`core/runner/permission.ts`) 밖에서 명령이 돈다.
- **줄 범위 `@path#10-20`** — 조립기가 줄을 잘라 실어야 하고, 잘린 원본을 원본처럼 보이지 않게 할
  표식 규칙이 필요하다(`conversation-events`의 "잘린 원본은 원본이 아니다"). 파일 참조가 한 번 돈 뒤에
  필요가 확인되면 따로 뗀다. `#`이 붙은 토큰은 이번 범위에서 **해석하지 않는 글자**다(FR-8의 가장
  긴 앞부분 규칙이 `src/a.ts#10-20`에서 `src/a.ts`를 잡는다 — 그러면 파일 전체가 실린다, §7의 8).
- **디렉토리 참조 `@src/`** — 무엇을 실을지(목록? 모든 파일?)가 정해지지 않았고, 모든 파일이면 크기
  상한(FR-13)과 곧바로 부딪힌다. 피커에 디렉토리를 띄우지 않고 Tab으로 파고들지도 않는다.
- **MCP resource(`@server:resource`)·최근 파일(frecency)** — OpenCode Desktop의 그룹 중 reference ·
  recent · resource는 두지 않는다. 그룹은 "파일" 하나다.
- **알약(contenteditable) 삽입** — 결정 6. 입력은 `<textarea>`와 문자열 초안 스토어 그대로다.
- **workspace의 다른 repo 파일** — 결정 3.
- **입력부의 "찾지 못한 참조" 경고** — §7의 9.

## 2. 먼저 적어 두는 사실 (intent 조사, 2026-09-28 실측)

- **claude는 프롬프트 속 `@경로`를 스스로 펼친다.** `claude -p "... @notes.txt ..." --tools ""`가 도구
  없이 파일 내용으로 답했고 stream-json에 tool_use가 없다. **`--tools` 화이트리스트를 거치지 않는다.**
  그래서 앱이 파일을 맥락으로 실은 뒤 지시문에 `@경로`가 남으면 (1) 같은 파일이 두 번 들어가고
  (2) 앱이 거른 파일(예: `.gitignore`된 `.env`, repo 밖 `@../other/.env`, `@~/.ssh/id_rsa`)도 권한 밖에서
  읽힌다.
- **opencode `run`은 펼치지 않는다.** `-f`로 첨부해야 들어가는데 one-desk는 `-f`를 쓰지 않고, 이
  spec도 쓰지 않는다(결정 1의 c — 두 CLI가 같은 길).
- one-desk는 프롬프트를 **stdin**으로 넘긴다(`core/runner/adapters/claudeCode.ts:202`). intent의 실측은
  인자였다 — stdin에서도 펼치는지는 §6의 실측 M1이다.

## 3. 기능 요구사항

### 3-1. 피커

- **FR-1. 여는 조건.** 캐럿 앞 토큰이 `@`로 시작하고 그 `@`가 **줄머리이거나 공백 바로 뒤**일 때
  열린다(`a@b.com`에서는 열리지 않는다). `/`와 달리 **줄 가운데서도 열린다** — 파일은 문장 속에서
  짚는다. 따옴표 형식 `@"`로 시작하면 닫는 따옴표 전까지가 질의다. **두 agent 모두에서 열린다**
  (`/` 피커는 여전히 claude만).
- **FR-2. 모양 (Desktop).** 입력칸 위 popover 하나. 머리 줄은 `파일 · ↑↓ 선택 · Enter/Tab 삽입 ·
  Esc 닫기`, 그 아래 그룹 머리 `파일`, 줄마다 **파일 아이콘 + 흐린 디렉토리 + 파일명**
  (`src/components/` 흐리게, `RunPanel.tsx` 보통 굵기). 긴 디렉토리는 앞을 생략한다(파일명은 늘 보인다).
  미리보기는 없다. 경로는 모노 글꼴이다(`--font-mono` — `\`가 `₩`로 보이지 않게).
- **FR-3. 삽입.** Enter/Tab이 `@<repo 상대 경로> `(뒤에 공백 하나)를 토큰 자리에 넣고 피커를 닫는다.
  경로에 공백이 있거나 `"`로 시작하면 `@"<경로>" `로 넣는다. 구분자는 늘 `/`다(git이 주는 그대로).
  Tab은 Enter와 같다 — 디렉토리로 파고들지 않으므로 셸식 앞부분 채우기가 없다.
- **FR-4. 키.** ↑↓ 이동, Enter/Tab 삽입, Esc 닫기. **피커가 열린 동안 Enter는 실행을 일으키지 않고,
  ↑↓는 history(prompt-history)를 넘기지 않는다** — `/` 피커와 같은 규칙, 같은 분기다.
- **FR-5. 무엇을 보여주나.** 지금 작업 디렉토리에 해당하는 repo(`repos`에서 `path === 작업 디렉토리`)의
  **`git ls-files -co --exclude-standard`가 주는 파일**이다 — 추적 중이거나, 추적하지 않았지만 무시되지
  않은 파일. 디렉토리·서브모듈 자리는 없다.
- **FR-6. 퍼지 순위는 core가 매긴다.** 파일명 앞글자 일치 > 파일명 안 일치 > 경로 안 일치 > 경로 글자
  건너뛰기(`rnpl` → `RunPanel`). 대소문자를 가리지 않는다. 같은 등급은 짧은 경로가 먼저, 그다음 사전순.
  빈 질의(`@`만)는 얕은 경로부터 사전순. **최대 50개.**
- **FR-7. 상태 줄.** 목록을 얻는 중이면 `불러오는 중…`, 결과가 없으면 `일치하는 파일이 없습니다`,
  파일을 못 찾는 이유가 있으면 그 이유(`role="alert"`) — `작업 디렉토리를 먼저 고르세요` · `작업 디렉토리가
  등록된 repo가 아닙니다` · `git 저장소가 아니라 파일 목록을 만들 수 없습니다`(§7의 4) · `git 실행 파일을
  찾을 수 없습니다` · git의 오류 첫 줄.

### 3-2. 보낼 때 — 해석

- **FR-8. 멘션 해석 (core가 권위).** 보낼 때 core가 **원문 지시문**에서 줄머리·공백 뒤의 `@토큰`을
  전부 찾는다(따옴표 형식 포함). 각 토큰에서 **가장 긴 앞부분이 그 repo의 파일 목록(FR-5와 같은
  함수, 캐시가 아니라 새로 얻은 것)에 정확히 있으면** 그 파일의 멘션이다. 가장 긴 앞부분 규칙은 손으로
  친 `@src/a.ts를`·`@src/a.ts,`(한국어 조사·문장 부호)를 잡으려는 것이다. Windows에서는 `\`를 `/`로
  바꿔 한 번 더 찾는다. 같은 파일을 두 번 짚으면 맥락은 하나다.
- **FR-9. 멘션이 곧 맥락이다.** 파일 맥락은 **지시문의 멘션에서만** 나온다. `StartRunInput.context`·
  `ResumeRunInput.context`에 `{ type: 'file' }`이 오면 core가 거부한다(`파일은 지시문의 @로만 담을 수
  있습니다`) — 두 통로가 생기면 칩과 글자가 어긋난다(§7의 6). 입력부에는 파일 칩이 없다.
- **FR-10. 읽기.** 멘션된 파일을 core가 읽는다. 아래는 전부 **전송을 거부한다**(`start`/`resume`이
  run 행을 만들기 전에 던진다 — `instructions` 거부·`assertFound`와 같은 자리, 같은 모양). 초안은
  남는다(RunPanel은 성공한 뒤에만 비운다).
  - 경로가 절대 경로이거나, 정규화 뒤 `..`로 repo 밖을 가리키거나, **실제 경로(realpath)가 repo 루트의
    실제 경로 밖**이다(심링크·junction 탈출) → `repo 밖의 파일은 담을 수 없습니다: <경로>`
  - 일반 파일이 아니다 → `파일이 아닙니다: <경로>`
  - 못 읽는다 → `파일을 읽을 수 없습니다: <경로>`
  - 앞 8,000바이트에 NUL이 있다(git의 판정) → `바이너리 파일은 담을 수 없습니다: <경로>`
  - UTF-8로 풀리지 않는다(`TextDecoder` fatal) → `UTF-8 텍스트가 아닌 파일은 담을 수 없습니다: <경로>`.
    앞의 BOM은 걷는다.
  - 크기 상한(FR-13)을 넘는다.
- **FR-11. 시점.** 파일은 **보낸 순간** 읽는다 — 예약 턴(앞 턴이 도는 중에 보낸 것)도 보낸 순간의 내용이
  실린다. discovered asset이 launch에서 읽히는 것과 같은 자리다(`resolveAssets`).

### 3-3. 보낼 때 — 조립

- **FR-12. 지시문의 `@`는 CLI에 가지 않는다.** 조립된 프롬프트(`assembledPrompt`)에서
  - 해석된 멘션은 **앞의 `@`만 뗀다** — `@src/a.ts를` → `src/a.ts를`, `@"a b.txt"` → `"a b.txt"`.
    파일 내용은 `<files>`에 있으므로 경로 글자만으로 뜻이 통한다.
  - 해석되지 않은 `@토큰`(줄머리·공백 뒤)은 `@`를 전각 `＠`(U+FF20)로 바꾼다 — `@../x/.env`·`@~/.ssh/…`를
    claude가 펼치지 못하게 한다(§7의 1, §6의 M3).
  - 저장하는 `userPrompt`는 **원문 그대로**다. ↑ history·"다시 보내기"·"다시 실행"이 원문에서 다시 해석한다.
  - `@`가 없는 지시문의 조립 결과는 지금과 **글자 하나까지 같다**(slash-commands FR-8과 같은 약속).
- **FR-13. 크기 상한.** 파일 하나 **256 KiB**, 한 턴 합계 **512 KiB**(UTF-8 바이트), 한 턴 **20개**.
  넘으면 FR-10처럼 거부한다 — 자르지 않는다(§7의 5).
- **FR-14. `<files>` 블록.** `<context>` 안, `memos` 뒤·`skills` 앞에 둔다. 속성과 본문은 **반드시
  이스케이프**한다 — 외부 repo의 파일이라 신뢰할 수 없는 입력이다(asset 본문과 같다).

  ```
    <files>
      <file repo="api" path="src/a.ts">…이스케이프한 본문…</file>
    </files>
  ```

  슬래시 지시문이면 slash-commands FR-7 그대로 커맨드가 맨 앞이고 `<context>`(파일 포함)가 뒤다.

### 3-4. 기록과 표시

- **FR-15. 기록.** 해석된 멘션마다 `run_context_item`에 `item_type = 'file'`, `item_id = '<repoId>:<repo
  상대 경로>'` 한 행. repo id(UUID)에는 `:`가 없으므로 첫 `:`로 가른다.
- **FR-16. 이름.** `loadContext`가 `file` 항목의 이름을 **상대 경로**로 붙인다. repo 행이 지워졌으면
  다른 종류처럼 뺀다("이름이 없다 = 지워졌다"). **파일이 디스크에서 사라진 것은 보지 않는다** — 목록을
  그릴 때 stat하지 않는다(repo-instructions NFR-4와 같은 이유). 기록은 "그때 무엇을 실었나"다.
- **FR-17. 표시.** 대화 헤더의 "이 대화에 담긴 것"에 `파일 · src/a.ts`로 보인다(`ConversationHeader`의
  `TYPE_LABELS`). 제목 사다리(`titleFromContext`)는 파일을 보지 않는다 — asset과 같다. 인박스는 바뀌지 않는다.
- **FR-18. "다시 보내기".** `ConversationPanel.resend`는 `run.contextItems`에서 `file`을 빼고 넘긴다 — 원문
  지시문이 멘션을 다시 가져온다(FR-9). 그때의 파일 내용이 다시 읽힌다.

## 4. 데이터 모델

- `shared/models.ts`의 `ContextItemType`에 `'file'`, `core/db/schema.ts`의 `runContextItem.itemType` enum에
  `'file'`.
- **마이그레이션이 없다.** `run_context_item.item_type`은 `text NOT NULL`이고 CHECK가 없다
  (`drizzle/0001_natural_slayback.sql`). drizzle의 `enum`은 타입에만 있다 — `asset.kind`에
  `instructions`를 더했을 때와 같다(repo-instructions FR-13). `pnpm db:generate`가 아무 파일도 만들지 않는
  것을 확인한다. **테이블을 다시 만드는 마이그레이션을 쓰지 말 것** — `root_run_id` 함정 그대로
  `DROP TABLE`이 cascade를 태우거나 행을 옮기는 사이 맥락 기록이 사라진다.
- 컬럼을 새로 두지 않는다(`item_path` 등). `item_id`는 원래 다형 참조이고(외래키 없음) 파일도 그 한 형태다.

## 5. 인터페이스

### 5-1. 파일 검색 — `files.search`

```ts
interface FileHit { path: string }            // repo 상대, '/' 구분
type FileSearchResult =
  | { ok: true; files: FileHit[]; truncated: boolean }
  | { ok: false; reason: string }

client.files.search(input: { workspaceId: string; repoId: string; query: string }): Promise<FileSearchResult>
```

- **렌더러는 경로를 넘기지 않는다** — repo id와 질의뿐이다. core가 repo 행을 찾아(workspace 소속 확인)
  그 `path`에서 git을 부른다(`readBody`·`reveal.ts`의 원칙).
- 실패는 던지지 않고 `{ ok: false, reason }` — preload가 IPC 오류의 클래스를 벗겨내므로(`AssetBody`와 같다).
  없는 repo id·다른 workspace의 repo는 던진다(잘못된 호출이다).
- 목록은 core가 **repo 경로별로 10초** 캐시한다. 캐시는 프로미스째 담아 동시에 온 질의가 git을 한 번만
  띄우고, 실패는 캐시하지 않는다(opencode 버전 게이트와 같은 규칙). 10초는 agent가 방금 만든 파일이 곧
  보이게 하려는 것이다.
- `truncated`: 목록이 **200,000개**를 넘으면 앞의 200,000개에서만 찾고 `true`. 피커가 "파일이 많아 일부에서만
  찾습니다"를 보인다.
- IPC 핸들러는 `core.files.search(input)` 한 줄이다.

### 5-2. core 모듈 `core/files/`

| 파일 | 하는 일 |
| --- | --- |
| `list.ts` | `listRepoFiles(root, deps)` — `git ls-files -co --exclude-standard -z`를 **비동기 spawn**(stdin 닫음, `windowsHide`, 5초 타임아웃). `-z`라 한글 파일명이 `\354\225…`로 인용되지 않는다. 실행 파일은 `findExecutable('git')`(`core/runner/executable.ts`) |
| `match.ts` | `matchFiles(paths, query, limit)` — FR-6. 순수 |
| `read.ts` | `readRepoFile(root, rel, platform)` — FR-10의 검사 전부. 순수하지 않지만 경로 규칙은 `platform` 인자로 가른다(`executable.ts`와 같은 이유) |
| `service.ts` | 캐시 + `search` + `resolveMentions(repo, prompt)` |

멘션 문법은 `shared/mentions.ts` 하나다 — 렌더러(피커의 여는 조건·삽입)와 core(해석·조립의 다시 쓰기)가
같은 함수를 쓴다. 따로 적으면 피커가 넣은 것을 core가 못 읽는다.

```ts
findMentionToken(text, cursor): { start; end; query; quoted } | null   // FR-1
insertMention(text, token, path): { text; cursor }                      // FR-3
scanMentions(text): { start; end; raw; quoted }[]                       // FR-8의 토큰 찾기
formatMention(path): string                                             // '@a.ts ' | '@"a b.ts" '
```

### 5-3. 실행 서비스

`launch`(`core/execution.ts`)의 순서:

1. `collectContext` — 지금대로. `file` 항목이 오면 거부(FR-9).
2. `resolveAssets` — 지금대로.
3. **새 단계** `resolveFileMentions` — 지시문에 줄머리·공백 뒤 `@`가 없으면 아무것도 하지 않는다(git을 띄우지
   않는다). 있으면 작업 디렉토리의 repo를 찾고(없으면 멘션 0개 — 전부 `＠`로 중화), 목록을 새로 얻어 해석,
   파일을 읽는다. 거부 사유가 있으면 던진다.
4. `assemblePrompt({ …, files })` — `<files>`와 FR-12의 다시 쓰기는 조립기가 한다(순수).
5. `runs.create({ context: [...spec.context, ...파일 refs] })`.

### 5-4. 렌더러

- `renderer/components/CommandPicker.tsx`의 popover 껍데기(마운트 시 `togglePopover`, 머리 줄, 상태 줄,
  listbox)를 `PickerPopover`로 떼고 `CommandPicker`·`FilePicker`가 쓴다. **`CommandPicker`의 DOM은 바뀌지
  않는다**(클래스·문구·이름).
- `RunPanel`의 `token`이 `trigger: { kind: 'slash' | 'mention', … } | null`로 넓어진다. `/`는 지금의
  `findSlashToken`(claude만), `@`는 `findMentionToken`(둘 다). 한 번에 하나만 열린다 — 토큰의 첫 글자가
  다르므로 겹치지 않는다. `dismissed`·`selectedIndex`·`onPromptKeyDown`의 분기는 둘이 같이 쓴다.
- `useFileSearch(workspaceId, repoId, query, enabled)` — `useCommands`의 모양(순번 가드, 키가 바뀌면 옛
  결과를 안 보임). 질의마다 IPC 한 번, 120ms 디바운스.
- option의 id는 `${listboxId}-f${index}`다 — 경로에는 id에 못 쓰는 글자가 있다. 접근성 이름은 디렉토리와
  파일명이 사이 공백 없이 이어진 **상대 경로 그대로**다(e2e가 `{ name: 'notes/a.txt', exact: true }`로 잡는다).
  listbox 이름은 `파일 참조`.

## 6. 실측이 남은 것 (plan 0단계 — 결과에 따라 FR-12·§7의 2가 바뀐다)

| | 질문 | 왜 |
| --- | --- | --- |
| M1 | claude가 **stdin으로 받은** `-p` 프롬프트(stream-json, `--tools` 화이트리스트, one-desk의 실제 인자)의 `@경로`를 펼치는가 | intent의 실측은 인자였다 |
| M2 | `<context>` 안 — 태그 사이·줄 가운데·`&lt;`로 이스케이프된 본문 속 — 의 `@경로`도 펼치는가 | 펼치면 **지금도** 이슈·메모·asset 본문(외부 repo의 SKILL.md, agent가 MCP로 쓴 이슈)이 권한 밖 읽기 통로다. 이 기능은 임의 파일 본문을 더하므로 구멍이 커진다 |
| M3 | 중화 후보가 펼쳐지지 않는가 — `＠경로`, `&#64;경로`, `@` 제거 | FR-12의 근거 |
| M4 | `@"공백 있는 경로"`를 펼치는가, `~`·절대 경로·`..`를 펼치는가, 디렉토리를 펼치는가 | 중화할 모양의 범위 |

### 실측 결과 (2026-09-28, claude 2.1.283, haiku, `-p --output-format stream-json --verbose --tools "" --strict-mcp-config`, 프롬프트는 **stdin**)

도구를 하나도 주지 않았다 — 답에 비밀 문장이 나오면 CLI가 스스로 펼친 것이다. 모든 경우 stream-json에 tool_use는 0개였다.

| | 프롬프트 속 모양 | 펼쳤나 |
| --- | --- | --- |
| M1 | `@secret.txt …` (stdin) | **펼침** |
| M2 | `<context>`(줄바꿈)`<issue>본문에서 @secret.txt 참고</issue>` | **펼침** |
| M2 | `&lt;x&gt; @secret.txt` | **펼침** |
| M2 | `x@secret.txt` · `파일은@secret.txt` · `(@…)` · `"@…"` · `` `@…` `` · `<issue>@…` | 안 펼침 |
| M2 | `a<탭>@secret.txt` | **펼침** — 공백류 뒤면 펼친다 |
| M3 | `＠secret.txt` · `&#64;secret.txt` | 안 펼침 |
| M4 | `@"s e.txt"` | **펼침** |
| M4 | `@../out.txt` · `@<절대 경로>` | **펼침 — repo 밖 파일도 읽는다** |
| M4 | `@dir/inner.txt` | **펼침** |
| M4 | `@dir/` | 안 펼침(내용 없음) |

**결론.** (1) 펼치는 조건은 "`@`가 줄머리이거나 공백류 바로 뒤"다 — §7의 1의 추천 규칙이 정확히 그 모양이다. (2) M2는
"펼친다" — **이 기능 이전부터** 이슈·메모·asset 본문 속 `@경로`가 권한 밖 읽기 통로였다(`..`·절대 경로로 repo 밖까지).
§7의 2대로 조립기의 `esc`가 모든 `@`를 `&#64;`로 바꾼다. (3) `＠`·`&#64;` 둘 다 중화로 성립한다.

## 7. 우려 — 사람이 정할 것

> **결정 (2026-09-28, 사용자): 전부 추천대로 간다.** 아래 각 항목의 추천이 곧 결정이다.

1. **[결정 필요] 해석되지 않은 `@토큰`의 중화.** 추천: **줄머리·공백 뒤의 모든 `@`를 `＠`로**(FR-12).
   단순하고 파일 시스템을 보지 않아 테스트가 결정적이다. 대가: `@Override`·`@types/node`·`@username`도
   모델에게 `＠`로 간다(뜻은 통한다). 대안: 디스크에 실제로 있는 경로(작업 디렉토리 기준·절대·`~`)만
   중화 — 글자 변형이 적지만 core가 사용자가 친 임의 경로를 stat하게 되고, claude의 해석 규칙(M4)을
   정확히 흉내 내야 한다. 흉내가 한 군데 어긋나면 구멍이다.
2. **[결정 필요] 맥락 본문의 `@`도 막을지 (M2가 "펼친다"일 때).** 추천: **조립기의 `esc`가 `@`를 `&#64;`로도
   바꾼다** — 이미 `<`·`>`·`&`를 엔티티로 바꾸는 자리라 규칙이 하나 는다. 대가: `@`가 든 이슈·메모·asset
   본문의 조립 결과가 지금과 달라진다(과거 run의 기록은 그대로). 이것은 이 기능 이전부터 있던 구멍이라 따로
   뗄 수도 있지만, 이 기능이 임의 파일 본문을 싣는 순간 커지므로 같이 막기를 추천한다.
3. **[결정 필요] `.gitignore`된 파일은 손으로 쳐도 싣지 않는다.** 추천: **싣지 않는다** — 피커와 해석이 같은
   목록(FR-5·FR-8)을 쓰는 것이 규칙이다(`checkAgents`가 실행과 같은 판정을 쓰는 것과 같은 이유). 그러면
   `.env`·빌드 산출물이 구조적으로 못 실린다. 대가: 무시된 로컬 메모 파일을 짚고 싶은 사람은 못 짚는다
   (그 `@`는 `＠`가 되어 글자로 간다 — §7의 9 때문에 보낼 때는 모른다).
4. **[결정 필요] git 저장소가 아닌 repo.** 추천: **피커가 이유를 보이고 멘션을 해석하지 않는다.** 폴백으로
   디렉토리를 훑으면 `.gitignore`를 못 따라 `.env`·`node_modules`가 들어온다 — 3의 결정과 어긋난다. 대가:
   git이 아닌 repo에서는 `@`가 아무것도 싣지 않는다. 또 **git의 `safe.directory` 거부**(다른 사용자 소유
   디렉토리, 외장 드라이브)도 여기에 걸린다 — 이유 줄에 git의 첫 줄을 그대로 보인다.
5. **[결정 필요] 크기 상한의 값과 넘었을 때.** 추천: 파일 256 KiB · 턴 512 KiB · 20개, **넘으면 전송 거부**
   (FR-13). 256 KiB는 대략 6~8만 토큰이다. 자르면(앞부분만) 모델은 잘린 파일을 전부로 읽는다 — 잘림 표식을
   넣어도 "파일을 봤다"는 답이 틀린다. opencode `-f`의 한도는 10 MiB였지만 그것은 첨부이지 프롬프트가 아니다.
6. **[결정 필요] 맥락 칩과의 관계.** 추천: **지시문의 `@토큰`이 곧 맥락이고 입력부에 파일 칩은 없다**
   (FR-9). 이유: (1) 초안 스토어가 문자열 하나라 칩을 따로 두면 초안·재마운트·"다시 실행"마다 둘을 맞춰야
   한다 — 칩 state는 `App`에 있고 workspace를 바꾸면 비워지는데 글자는 초안 스토어에 남는다. (2) 글자를 지웠는데
   칩이 남거나 그 반대가 되면 무엇이 실리는지 사람이 모른다. (3) 손으로 친 `@경로`가 피커로 넣은 것과 같게
   동작한다. 대가: 보내기 전에는 무엇이 실릴지 한눈에 모은 곳이 없다 — 보낸 뒤에는 대화 헤더가 보인다(FR-17).
   대안(피커가 칩도 더함)은 위 (1)·(2) 때문에 추천하지 않는다.
7. **[확인 필요] 파일 원문이 DB에 남는다.** `run.assembled_prompt`에 파일 내용이 평문으로 턴마다 들어간다(최대
   512 KiB/턴). 보존·삭제 규칙이 없다 — `conversation-events` spec §9의 3(`raw.jsonl`)과 같은 결이고 그 결정
   (`conversation-next`)에 함께 올려야 한다. `.gitignore`된 비밀은 3으로 막히지만 추적 중인 설정 파일은 실린다.
8. **[확인 필요] `@src/a.ts#10-20`은 파일 전체를 싣는다.** 줄 범위를 뺐지만 가장 긴 앞부분 규칙(FR-8)이
   `src/a.ts`를 잡는다. 대안은 "`#` 뒤가 있으면 해석하지 않는다"인데 그러면 `＠`로 중화되어 아무것도 안
   실린다. 추천: 전체를 싣는다 — 모델은 지시문의 `#10-20` 글자를 읽는다.
9. **[결정 필요] 입력부의 "찾지 못한 참조" 경고.** 손으로 친 `@경로`가 해석되지 않으면 조용히 `＠` 글자로 간다.
   추천: **이번에는 두지 않는다** — 보낸 뒤 헤더의 "담긴 것"이 무엇이 실렸는지 말하고, 경고를 두려면 입력마다
   해석 IPC가 하나 더 필요하다. 필요하면 다음 사이클에서 `files.resolve`로 뗀다.
10. **[확인 필요] 퍼지 매칭을 core에서.** 추천대로 core다 — 큰 repo(수만 개)의 목록을 IPC로 통째 넘기면 질의마다
    수 MB가 오간다. 대가: 메인 프로세스에서 20만 개를 훑는 데 수십 ms가 걸릴 수 있고 그동안 MCP 서버도 멈춘다
    (`execFileSync` 함정과 같은 뿌리). 200,000개 상한과 디바운스가 완화책이다. plan 4단계에서 이 저장소와 큰
    repo 하나로 잰다.
11. **[확인 필요] `git`이 PATH에 없는 장비.** Windows GUI 앱은 사용자 PATH를 물려받으므로(CLAUDE.md 환경변수 절)
    Git for Windows를 깐 사람은 잡힌다. `Git\cmd\git.exe`는 `.exe`라 `.cmd` 함정이 없다(실측 `where git`).
    설정 화면에 git 경로 칸은 두지 않는다.

## 8. 비기능 요구사항

- **NFR-1.** 경계 셋 — `core/`는 electron을 import하지 않고, `renderer/`는 core를 import하지 않으며, IPC 핸들러는
  core 호출 한 줄이다.
- **NFR-2.** 렌더러가 파일 경로를 core에 넘기는 통로는 **지시문 글자뿐**이고, core는 그것을 repo의 git 목록과
  realpath 검사로만 해석한다. 파일을 읽는 함수는 `readRepoFile` 하나다.
- **NFR-3.** git은 비동기로 띄운다 — `execFileSync` 금지(메인 프로세스의 MCP 서버가 멈춘다).
- **NFR-4.** 파일 본문은 신뢰할 수 없는 입력이다 — 조립기는 이스케이프하고, 화면은 파일 본문을 그리지 않는다
  (피커는 경로만).
- **NFR-5.** `/` 피커의 동작·DOM·접근성 이름이 바뀌지 않는다 — 기존 `slash.test.ts`·`CommandPicker.test.tsx`·
  `RunPanel.test.tsx`·`e2e/slash.e2e.ts`가 **수정 없이** 통과한다.
- **NFR-6.** 새 런타임 의존성 없음(ripgrep을 번들하지 않는다 — `rg`는 이 장비 PATH에도 없다, 실측). 마이그레이션 없음.
- **NFR-7.** 새 접근성 이름(`파일 참조`, 경로 option)이 기존 e2e 셀렉터와 부분 일치로 부딪히지 않는다 — e2e 전체로 확인.

## 9. 수용 기준

| 확인 | 대응 | 방법 |
| --- | --- | --- |
| `@`가 줄머리·공백 뒤에서 열리고 `a@b`에서는 안 열린다. opencode에서도 열린다 | FR-1 | `shared/mentions.test.ts`, `RunPanel.test.tsx` |
| 피커가 디렉토리를 흐리게, 파일명을 보통으로 그리고 option 이름이 상대 경로다 | FR-2 | `FilePicker.test.tsx` |
| Enter가 `@경로 `를 넣고 실행하지 않는다. 공백 경로는 따옴표 | FR-3·4 | `RunPanel.test.tsx`, `mentions.test.ts` |
| `@` 피커가 열린 동안 ↑는 history가 아니다 | FR-4 | `RunPanel.test.tsx` |
| `.gitignore`된 파일이 목록에 없고, 한글 파일명이 온전하다 | FR-5 | `core/files/list.test.ts`(임시 디렉토리에 `git init`) |
| 순위 규칙 | FR-6 | `core/files/match.test.ts` |
| git 저장소가 아니면 이유가 보인다 | FR-7 | `list.test.ts`, `FilePicker.test.tsx` |
| `@src/a.ts를`이 `src/a.ts`로 해석되고, 무시된 파일은 해석되지 않는다 | FR-8 | `core/files/service.test.ts` |
| context에 `file`을 넣으면 거부 | FR-9 | `execution.test.ts` |
| `..`·절대 경로·junction 탈출·디렉토리·바이너리·UTF-8 아님·크기 초과가 각각 거부되고 run 행이 생기지 않는다 | FR-10·13 | `core/files/read.test.ts`, `execution.test.ts` |
| 조립 결과에 `@src/a.ts`가 없고 `src/a.ts`와 `<file repo path>`가 있다. 해석 안 된 `@x`는 `＠x`다. `@` 없는 지시문은 지금과 같다 | FR-12·14 | `assemble.test.ts`(기존 테스트 수정 없음) |
| 파일 본문의 `<`·`&`가 이스케이프된다 | FR-14 | `assemble.test.ts` |
| `run_context_item`에 `file` 행이 남고 `contextItems`에 상대 경로 이름으로 나온다. repo를 지우면 빠진다 | FR-15·16 | `run.test.ts` |
| 헤더에 `파일 · 경로` | FR-17 | `ConversationHeader.test.tsx` |
| 다시 보내기가 `file`을 context로 넘기지 않는다 | FR-18 | `ConversationPanel.test.tsx` |
| 마이그레이션이 생기지 않는다 | §4 | `pnpm db:generate` 뒤 `git status`에 `drizzle/` 변화 없음 |
| **한 바퀴** | 전체 | `e2e/mention.e2e.ts` — git repo에서 `@not` → option `notes/a.txt` → Enter → 실행. 가짜 CLI가 받은 stdin에 `<file repo="…" path="notes/a.txt">`와 파일 문장이 있고 `@notes/a.txt`가 없다. 무시된 파일은 option에 없다. 헤더에 `파일 · notes/a.txt` |
| **claude가 실제로 펼치지 못한다** | FR-12 | `ONE_DESK_REAL_CLI=1` 전용 테스트 — 중화된 `＠secret.txt`에 비밀 문장으로 답하지 않는다(M1·M3의 회귀) |
| 경계 | NFR-1 | 경계 grep 둘 무출력 |
