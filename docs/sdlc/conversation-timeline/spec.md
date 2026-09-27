# Spec: OpenCode처럼 읽히는 대화 화면

- 출처: `intent.md` (승인 위임됨 2026-09-27)
- 선행: `docs/sdlc/conversation-fixes/spec.md` — 이 spec은 그것이 `main`에 들어간 상태를 전제로 쓴다
- 작성자: 권용현 (Claude가 초안)
- 상태: 초안 (2026-09-27)
- 작성일: 2026-09-27

## 1. 범위

**화면만 바꾼다.** 스키마·IPC·이벤트 모델은 그대로다(intent 제약). 필요한 데이터는 이미
렌더러에 와 있다 — text·tool_use·tool_result는 전역 push로 스토어에 쌓이고, 실행 조건과
사용량은 `Run` 행에 있다. 없는 것(도구 출력 전문·종료 코드·추론)은 이 기능이 흉내 내지 않고
`conversation-events`로 넘긴다.

**선행 기능에서 가져다 쓰는 것** (conversation-fixes):

- `Conversation.state`(대표 턴)·`Conversation.active`(running → pending → null) — FR-3
- 대화록의 실행 중 턴 멈추기 버튼과 그 이름 `실행 중인 턴 멈추기` — FR-11
- `INBOX_RULES`의 `clearsOnView` — 자동 확인은 여전히 `pick`에서만 — FR-4~6
- 이름을 비우면 `rename(root, null)` — FR-21 / workspace 전환 시 도크 선택 초기화 — FR-22
- opencode `error` 줄이 `RunEvent` `error`로 오고, 실패의 `errorMessage`가 마지막 error 이벤트에서
  채워진다 — FR-13 / `hydrate`가 seq 병합이다 — FR-19

여덟 조각이다. (A)가 규칙을 한 곳에 모으고 나머지가 그 위에 선다.

- **(A) 턴 투영** — 이벤트를 화면 블록으로 바꾸는 순수 함수 (`renderer/timeline.ts`)
- **(B) 턴 화면** — 접힌 턴과 펼친 턴 (D1), 턴 사이 공지 (D8)
- **(C) 마크다운** — 원시 HTML·이미지·앱 안 탐색 없이 (D2)
- **(D) 입력부** — 카드 하나, 중지, 예약 칩, 초안 보존 (D3·D4·D10)
- **(E) 대화 헤더** — 제목·메뉴·컨텍스트 링·사용량 (D5)
- **(F) 도크와 스크롤** — 최대화, 대화록만 스크롤, 바닥 따라가기 (D6·D7)
- **(G) 다시 보내기·답하기** (D9)
- **(H) 이름과 모양** — 상태 이름 표, opacity·글리프 정리 (D11)

**빠지는 것**

- intent의 "이 기능이 아닌 것" 전부 — 탭 스트립·홈·터미널·리뷰 패널, 권한 요청 카드, 여러 개
  예약·방향 지시(steer), 분기·되돌리기, 대화 안 찾기.
- **도구 출력 전문·종료 코드·추론(생각)·재시도 카드.** 이벤트를 넓혀야 한다
  (`conversation-events`). 이 기능의 셸 출력은 지금 있는 200자 요약(`summarize`)까지다.
- **코드 문법 강조.** 의존성이 하나 더 들고(shiki·highlight.js) 워커가 필요해진다. 코드 블록은
  모노 글꼴·언어 이름·복사까지다.
- **가상 스크롤, 메시지 간 이동 단축키, 타임라인 설정 프리셋.** 프리셋은 OpenCode의 기본값
  "컴팩트"(전부 묶고 접는다) 하나로 고정한 셈이다 — D1과 같은 철학이다.
- **마크다운을 asset 본문·이슈·메모에 붙이는 것.** 이번에는 agent 답변과 턴의 중간 텍스트뿐이다.
- **OS 알림·효과음, 첨부, `@` 멘션.**

## 2. 기능 요구사항

### (A) 턴 투영 — `renderer/timeline.ts`

- **FR-1.** `projectTurn(run, events)`는 **순수 함수**다. 입력은 run의 네 칸(`status`·`resultText`·
  `errorMessage`·`cwd`)과 그 run의 이벤트(seq 오름차순), 출력은 `TurnProjection`(§3)이다.
  컴포넌트는 그 결과를 그리기만 한다. **규칙을 컴포넌트에 두지 않는다** — `conversation.ts`·
  `usage.ts`처럼 렌더링 없이 경계값을 고정할 수 있어야 한다.

- **FR-2.** 블록은 여섯 종류다. 이벤트에서 블록으로 가는 규칙은 이 표 하나다.

  | 이벤트 | 블록 |
  |---|---|
  | `text` | `text` — 앞뒤 공백을 걷어 비면 버린다 |
  | `tool_use` (편집 계열, FR-4) | `edit` — 직전 블록이 `edit`면 거기에 붙는다 |
  | `tool_use` (그 밖) | `activity` — 직전 블록이 `activity`면 거기에 붙는다 |
  | `tool_use` 중 결과가 실패인 것 | `tool-error` — 묶음을 끊고 제자리에 따로 선다 |
  | `error` | `error` |
  | `raw` | `notice` — 연속된 raw는 하나로 합친다("해석하지 못한 출력 N줄") |
  | `session`·`usage`·`result` | 그리지 않는다 |

  **`result`를 보지 않는 이유**: 답은 run 행(`resultText`)에서 온다(FR-8). OpenCode 어댑터는
  text마다 result를 합성하는데(설계 2026-09-06 §7), 그것을 블록으로 그리면 같은 글이 두 번 나온다.

- **FR-3.** **tool_use와 tool_result는 `toolUseId`로 짝짓는다.** 두 번 훑는다 — 먼저 결과를 id별로
  모으고, 그다음 블록을 만든다. 실패 여부를 tool_use 자리에서 알아야 묶음에서 뺄 수 있다(FR-2).
  - 결과가 없는 use: run이 `running`이면 `running`, 끝났으면 `unknown`("결과 없음").
  - use가 없는 result는 버린다 — 스토어가 run당 2,000개만 들고 있어 앞이 잘렸을 수 있다.
  - id가 빈 문자열이면 짝짓지 않는다(어댑터가 id를 못 읽은 줄이다).

- **FR-4.** **도구 이름은 한 표(`TOOL_LABELS`)로 한국어 라벨과 종류를 얻는다.** 이름을 소문자로
  바꿔 찾는다 — claude(`Read`)와 opencode(`read`)가 한 칸을 쓴다.

  | 이름(소문자) | 라벨 | 종류 |
  |---|---|---|
  | `read` | 읽기 | read |
  | `edit`, `multiedit` | 편집 | edit |
  | `write` | 작성 | edit |
  | `notebookedit` | 노트북 편집 | edit |
  | `patch` | 패치 | edit |
  | `bash`, `bashoutput`, `killshell`, `killbash` | 셸 | shell |
  | `grep` | Grep | search |
  | `glob` | Glob | search |
  | `ls`, `list` | 목록 | search |
  | `webfetch` | 웹 가져오기 | web |
  | `websearch` | 웹 검색 | web |
  | `todowrite`, `todoread`, `taskcreate`, `taskupdate`, `taskget`, `tasklist` | 할 일 | todo |
  | `task`, `agent` | 하위 에이전트 | subagent |
  | `skill` | 스킬 | other |
  | `mcp__<서버>__<도구>` | `` `<도구>` 호출 `` | mcp |
  | 그 밖 | 이름 그대로 | other |

  **표에 없는 이름을 버리지 않는다.** 새 도구가 나와도 화면에서 사라지지 않고 원래 이름으로 보인다.
  **할 일 도구는 숨기지 않는다** — OpenCode 2.0.18은 todowrite를 타임라인에서 지우지만 one-desk에는
  할 일 패널이 없어, 숨기면 agent가 계획을 세운 흔적이 어디에도 남지 않는다.

- **FR-5.** **도구 한 줄의 부제**는 `input`에서 처음 찾는 문자열이다.
  `command`(첫 줄) → `file_path`·`filePath`·`notebook_path`(작업 디렉토리 기준 상대 경로) →
  `pattern` → `url` → `query` → `description` → `subject`. 하나도 없으면 빈 문자열이다.
  - `todos` 배열(TodoWrite)은 "N개 중 M개 완료"다.
  - 문자열이 아닌 값은 쓰지 않는다 — 객체를 JSON으로 늘어놓으면 한 줄이 읽히지 않는다.
  - search 종류이고 결과 요약이 `Found N `으로 시작하면 `matches = N`이다(claude Grep의
    files_with_matches 출력 — **구현 전에 실제 로그로 형식을 확인한다**). 못 읽으면 null이고
    화면은 개수를 그리지 않는다. 200자 요약에서 줄을 세지 않는다 — 잘린 수를 세면 거짓이다.
  - 상대 경로는 `cwd`로 시작하면 그 뒤만, 아니면 전체다. `\`와 `/`를 같게 본다(Windows 경로).

- **FR-6.** **활동 묶음**은 연속된 비편집·비실패 도구 호출이다. 라벨은
  `${개수} ${라벨들} 사용됨`이고, 라벨들은 처음 나온 순서의 **고유** 라벨을 `, `로 잇는다
  (intent D1의 "4 읽기, Grep, 셸 사용됨", OpenCode `{{count}} {{tools}} 사용됨`). 안에 `running`인
  항목이 있으면 묶음도 `running`이다. 묶음을 끊는 것은 text·edit·tool-error·error·notice다.

- **FR-7.** **편집 블록**은 연속된 편집 계열 호출이고, 같은 파일은 한 줄로 합친다(hunk 여럿).
  diff는 `renderer/diff.ts`가 **입력만으로** 만든다 — 렌더러는 파일에 닿지 않는다(경계 2).

  | 입력 모양 | diff |
  |---|---|
  | claude `Edit {file_path, old_string, new_string}` / opencode `edit {filePath, oldString, newString}` | old → new 줄 diff 한 hunk |
  | claude `MultiEdit {file_path, edits[]}` | edit마다 hunk 하나 |
  | claude `Write {file_path, content}` / opencode `write {filePath, content}` | 전부 추가, "새로 씀" |
  | 모양을 모르는 것(`NotebookEdit`·`patch` 등) | diff 없이 경로만 — 펼칠 것이 없다 |

  - **줄 번호는 없다.** old_string 앞뒤 문맥이 없어 위치를 모른다 — OpenCode의 같은 폴백도 같은
    한계다.
  - 줄 diff는 LCS다. 두 쪽 줄 수의 곱이 1,000,000을 넘으면 "전부 지우고 전부 추가"로 떨어진다 —
    렌더러의 한 프레임을 diff 계산이 먹으면 안 된다.
  - 한 파일에 그리는 줄은 400줄까지이고 나머지는 "… N줄 더"다. `+N −M`은 자르기 전 diff에서 센다.

- **FR-8.** **답(answer)과 중복 방지.** 턴 하나에는 "답 칸"이 하나 있다.
  - `running`이면 답은 **스토어의 마지막 text 블록**이다(`final: false`). 없으면 null.
  - 끝났으면 답은 `resultText`(앞뒤 공백을 걷어 비지 않으면)다(`final: true`). **없으면 null이다
    — 스토어에 텍스트가 있어도 쓰지 않는다.** 앱을 다시 켜면 스토어가 비므로, 스토어에 기대면
    같은 턴이 재시작 전후로 다르게 보인다.
  - `pending`이면 null.
  - 끝났고 답이 있으면, 블록 목록의 **마지막 text 블록이 답과 같을 때**(앞뒤 공백 무시) 그
    블록을 뺀다. claude는 마지막 assistant 텍스트를 흘린 뒤 result에 같은 내용을 다시 담는다 —
    RunLog가 막던 바로 그 중복이다. 다르면 둘 다 남긴다.
  - 실패로 끝났고 `errorMessage`가 마지막 error 블록과 같으면 그 블록을 뺀다. fixes FR-13이
    `errorMessage`를 마지막 error 이벤트에서 채우므로, 빼지 않으면 오류 카드와 같은 글이 겹친다.

- **FR-9.** **접힌 턴에 쓰는 두 값.**
  - `summary = { tools, failed }` — tool_use 수와 실패한 결과 수. 도구가 0이면 null.
  - `current` — run이 `running`일 때 결과가 아직 없는 **마지막** tool_use. **OpenCode에서는
    항상 null이다** — 어댑터가 tool_use를 끝난 뒤에 결과와 함께 보고한다(CLAUDE.md). 그때 상태
    줄은 도구 없이 경과 시간만 보인다.

- **FR-10.** **턴 사이 공지** `switchNotice(prev, next)` — 요청한 모델(`run.model`)이나
  effort(`run.effort`)가 앞 턴과 다르면 `모델 → X · effort → Y`다(null은 "기본값", effort의 이름은
  `effortFieldOf(agentKind).label`). 첫 턴에는 없다.
  **관측값(`usage.model`)이 아니라 요청값을 비교한다.** effort는 요청값밖에 없고(CLAUDE.md), 관측
  모델은 턴이 끝나야 오므로 비교하면 공지가 진행 중에 떴다가 끝나며 바뀐다.

- **FR-11.** **시간과 메타 조각.**
  - `formatDuration(ms)` — 1초 미만 "1초 미만", 60초 미만 "N초", 1시간 미만 "M분 S초",
    그 위 "H시간 M분".
  - `metaPieces(run, now)` — agent 이름 · 모델(`usage.model` ?? `run.model`, 둘 다 없으면 뺀다) ·
    소요 시간(`startedAt`부터 `endedAt ?? now`, 시작 전이면 뺀다) · effort(`effort high`/
    `variant high`, 없으면 뺀다) · 권한 이름. 조각이 빠져도 구분점이 남지 않는다(`.turn-info`와
    같은 `::before` 방식).
  - **대기 시간(createdAt → startedAt)은 넣지 않는다.** 슬롯을 기다린 시간은 agent가 쓴 시간이
    아니다. OpenCode는 사용자 메시지 시각부터 재지만 거기에는 슬롯이 없다.

### (B) 턴 화면 (D1·D8)

- **FR-12.** **접힌 턴(기본)이 보여주는 것은 이 여섯뿐이고 이 순서다.**
  1. 사용자 버블 — 오른쪽, 평문(pre-wrap).
  2. 상태 줄 — `running`일 때: 스피너 · "작업 중" · 경과 시간 · 지금 도는 도구(라벨 + 부제) ·
     오른쪽 끝에 `실행 중인 턴 멈추기`(fixes FR-11). 뿌리 턴이 `pending`일 때(FR-30):
     "대기 중 · 실행 슬롯이 비면 시작합니다" · `대기 취소`.
  3. 활동 요약 한 줄 — "도구 7회" (실패가 있으면 " · 실패 1"). `summary`가 있을 때만.
  4. 답 칸 — FR-8의 답을 마크다운으로(`.turn-answer`). 진행 중이면 흐르는 텍스트, 끝났으면 최종 답.
  5. 오류 카드 — `errorMessage`(`role="alert"`). 지금과 같다.
  6. 끝줄 — 상태 알약 · 답변 필요 배지 · 메타 조각 · `응답 복사`(최종 답이 있을 때) ·
     `다시 보내기` 또는 `답하기`(FR-43·44) · `자세히`.

  **도구 한 줄·중간 텍스트·diff는 접힌 턴에 없다.** 2026-09-22 결정의 이유("도구 호출이 흐르면
  대화록이 그것으로 가득 찬다")가 그대로 남아 있다 — 접힌 턴은 OpenCode의 "텍스트만"에 가깝다.

- **FR-13.** **펼친 턴(`자세히`)은** 사용자 버블 → 상태 줄(running) → 블록들(FR-2, 순서대로) →
  최종 답(**끝났을 때만** — 진행 중에는 마지막 text가 블록 안에 제자리로 있다) → 오류 카드 →
  끝줄(`접기`). 활동 요약 줄은 없다 — 묶음 라벨이 대신한다. 블록이 하나도 없으면
  "기록된 활동이 없습니다". OpenCode의 "컴팩트"다.
  진행 중 마지막 text가 블록에 있다가 턴이 끝나면 답 칸으로 옮겨 가는데, 둘 다 맨 아래라 눈에는
  제자리다(FR-8의 중복 제거가 그 블록을 뺀다).

- **FR-14.** **접힌 턴은 로그 파일을 읽지 않는다.** 스토어 스냅샷만 구독한다
  (`useRunEventSnapshot`). 펼친 턴만 스토어가 비었을 때 `readLog`로 되살린다(`useRunEvents`).
  대화를 열 때마다 모든 턴의 로그를 읽지 않는다는 설계 §4-1 원칙 그대로다. **그 대가로, 앱을
  다시 켠 뒤의 끝난 턴은 한 번 펼치기 전까지 활동 요약이 없다**(§6 우려 4).

- **FR-15.** **펼치고 접는 것은 전부 사용자가 한다**(D1, CLAUDE.md). 턴(`자세히`/`접기`)·활동
  묶음·도구 한 줄·편집 파일 넷 다 접힌 채 시작하고, 상태 전이나 새 이벤트로 열리거나 닫히지
  않는다. 열림 state는 **블록 key**(첫 이벤트의 seq로 만든다)에 매달아, 이벤트가 붙어 블록이
  길어져도 풀리지 않는다. `open`을 강제하는 effect를 두지 않는다.

- **FR-16.** **도구 한 줄**(묶음을 펼쳤을 때).
  - 공통: 라벨(굵게) · 부제(한 줄, 말줄임, 전체는 `title`) · 상태(running 스피너 / unknown
    "결과 없음"). search 종류는 `matches`가 있으면 "(N개 일치)".
  - 셸: 펼치면 명령 전문(모노, `명령 복사`) + 결과 요약(모노, 최대 높이 안에서 스크롤). 요약이
    `…`로 끝나면 "출력 앞부분만 기록됩니다"를 `--text-muted`로 붙인다 — 잘린 것을 전부인 것처럼
    보이면 안 된다.
  - 하위 에이전트: 부제는 description, 오른쪽에 `subagent_type`. 펼치면 `input.prompt` 평문.
  - mcp·그 밖: 펼치면 `input`을 들여쓴 JSON으로(2,000자까지).
  - 읽기·검색·웹·할 일: 펼칠 것이 없다 — 한 줄로 끝난다(OpenCode의 컴팩트 행).
  - **도구의 입력·출력은 평문이다.** 마크다운으로 그리지 않는다(FR-26).

- **FR-17.** **실패한 도구**(`tool-error`)는 묶음 밖에 따로, `--danger-bg-soft` 바탕 한 줄이다 —
  라벨 · 부제 · "실패". 펼치면 결과 요약(오류 문구). 편집 계열이 실패해도 edit 블록이 아니라 여기로
  온다 — 실패한 편집의 diff는 일어나지 않은 변경이다.

- **FR-18.** **편집 블록**은 머리 "편집 · 파일 N개" 아래 파일 줄들이다 — 상대 경로 · "새로 씀"
  (Write) · `+N −M`. 파일 줄을 펼치면 diff: 줄마다 부호 칸(`+`/`−`/공백)과 본문, 추가는
  `--success-bg`, 삭제는 `--danger-bg-soft` 바탕. hunk 사이에는 가는 구분선.

- **FR-19.** **턴 사이 공지**(FR-10)는 그 턴의 사용자 버블 위에 가운데 정렬 한 줄로 선다 —
  양옆 가는 선, `--text-muted`, 보기 전용.

### (C) 마크다운 (D2)

- **FR-20.** **`react-markdown` + `remark-gfm`을 쓴다.** 버전은 설치 시점의 것을 정확히 고정한다
  (이 저장소는 전부 정확한 버전이다). **`rehype-raw`를 쓰지 않는다. `dangerouslySetInnerHTML`을
  쓰지 않는다.** 둘 다 grep 0건을 완료 증명에 넣는다.

- **FR-21.** **원시 HTML은 글자 그대로 보인다.** react-markdown은 `rehype-raw` 없이 HTML 노드를
  텍스트로 바꾼다(`skipHtml`을 켜지 않는다) — `<script>`는 실행되지 않고 화면에 "<script>…"로
  남는다. 지우지 않는 이유: agent가 HTML 조각을 설명하는 답에서 그 조각이 사라지면 답이 거짓말이 된다.

- **FR-22.** **링크는 `http:`·`https:`만 링크다.** 판정은 `shared/links.ts`의 `externalLinkOf(href)`
  하나다(FR-24가 main에서 같은 함수를 쓴다).
  - 통과하면 `<a href target="_blank" rel="noopener noreferrer">`. 새 창 요청은 main의
    `setWindowOpenHandler`로 가서 OS 브라우저로 열린다.
  - 그 밖(`javascript:`·`file:`·`data:`·`vbscript:`·상대 경로·`#조각`·`mailto:`)은 **링크가 아니라
    글자**다(`.md-link-inert`, 원래 주소는 `title`). 상대 경로와 `#`도 막는 것은 **앱 안 탐색
    금지** 때문이다 — 앱 창이 다른 문서로 넘어가는 경로를 렌더러에 하나도 두지 않는다.
  - GFM 자동 링크(맨 URL)도 같은 규칙을 탄다.

- **FR-23.** **이미지는 그리지 않는다.** `img` 자리에 `[이미지: alt]` 글자를 둔다 — `<img>` 요소가
  DOM에 생기지 않는다. CSP(`img-src 'self' data:`)가 원격 로드를 이미 막지만, `data:`는 통과하고
  "막혔다"는 깨진 아이콘을 보여줄 이유도 없다.

- **FR-24.** **main도 막는다(심층 방어).** `electron/main.ts`에서
  - `will-navigate`: 앱 자신의 URL(개발 서버 주소 또는 `index.html`)이 아니면 `preventDefault`.
  - `setWindowOpenHandler`: `externalLinkOf(url)`가 통과시킨 것만 `shell.openExternal`, 나머지는
    조용히 거부(지금은 **어떤 URL이든** 연다).

  **렌더러 규칙 하나에 기대지 않는 이유**: 앱 창이 원격 문서로 넘어가면 preload가 그 문서에도
  붙어 `window.oneDesk`가 노출된다 — CLAUDE.md가 경고한 `runs.start({ permission: 'full' })`가
  그 문서의 것이 된다. 막는 자리가 한 곳이면 그 한 곳의 실수가 곧 사고다.

- **FR-25.** **코드 블록**은 머리(언어 이름 · `코드 복사`)와 본문(모노, 가로 스크롤은 블록 안에서만)
  이다. 인라인 코드는 모노 알약. 표는 가로 스크롤 상자 안에 그린다 — 넓은 표가 대화록 전체를
  가로로 밀면 안 된다. GFM 작업 목록의 체크박스는 `disabled`다.

- **FR-26.** **마크다운을 쓰는 곳은 답 칸과 펼친 턴의 text 블록 둘뿐이다.** 사용자 버블·도구
  입력/출력·오류 카드·공지는 평문이다. 사용자 버블은 사람이 친 글이라 `*`나 `#`이 뜻을 바꾸면
  안 되고, 도구 출력은 셸 출력이지 문서가 아니다.

### (D) 입력부 (D3·D4·D10)

- **FR-27.** **입력부는 카드 하나다.** 위에서 아래로:
  1. (카드 밖, 위) 오류·경고(`form-error`, 없는 경로 경고, repo 없음 안내) — 지금 문구 그대로.
  2. (카드 밖, 위) 예약 칩(FR-30).
  3. 카드 윗줄 — 이번 턴에 담을 맥락 칩(`<이름> 맥락에서 빼기`). 비었으면 지금의 안내문
     ("왼쪽 항목의 ＋를 눌러 맥락을 담으세요")을 `--text-muted` 한 줄로. 칩이 많으면 두 줄 높이
     안에서 세로 스크롤한다 — 카드가 대화록을 밀어내면 안 된다.
  4. 입력칸 — 테두리 없이 카드에 녹는다. `aria-label="지시"`, placeholder는 지금 문구
     (`무엇을 시킬지 적으세요. …로 실행합니다.`, 키 이름은 `shortcut.ts`).
  5. 카드 아랫줄 — 알약 선택 다섯(**agent · 모델 · effort/variant · 권한 · 작업 디렉토리**) +
     오른쪽 끝 전송 버튼.

  **보이는 글자는 알약이지만 접근성 이름은 그대로다**: `agent`·`모델`·`effort`/`variant`·`권한`·
  `작업 디렉토리`를 `aria-label`로 준다. `<label>`로 `<select>`를 감싸지 않는다 — 감싸면 옵션
  글자가 이름에 빨려 들어간다(CLAUDE.md). 잠김 규칙(이어가면 agent 비활성, 작업 디렉토리
  readOnly)과 기본값 규칙은 **바꾸지 않는다** — RunPanel의 effect들을 그대로 두고 모양만 바꾼다.
  작업 디렉토리 알약의 옵션 글자는 repo 이름만이고 경로는 `title`로 읽는다.

- **FR-28.** **전송 버튼은 둘 중 하나다.**
  - 대화에 `running` 턴이 있고 입력칸이 비었으면(앞뒤 공백 무시) **중지**다 — `IconStop`,
    `aria-label="중지"`. 누르면 그 running 턴을 `runs.cancel`한다. 예약은 건드리지 않는다
    (fixes FR-9 — 예약은 이어서 뜬다).
  - 그 밖에는 **실행**이다 — `IconSend`, `aria-label="실행"`(e2e의 `{ name: '실행', exact: true }`가
    이 이름을 잡는다). 활성 조건은 지금의 `ready` 그대로다.
  - 실행 단축키는 지금(Ctrl/⌘+Enter)을 유지한다. **Esc로 멈추지 않는다** — 이 앱에서 Esc는 "안쪽부터
    푼다"(피커 → 이름 편집 → 최대화 → 열린 항목)의 약속이 이미 있고, 멈춤은 되돌릴 수 없다.

- **FR-29.** **도크 헤더의 `취소`를 없애고, 멈추기를 대화 헤더로 올린다.** 멈추는 자리는 셋이다 —
  입력부의 중지(FR-28), 대화록 상태 줄의 `실행 중인 턴 멈추기`(FR-12, fixes FR-11), 그리고 대화
  헤더(FR-33) 오른쪽의 `멈추기` 버튼(`IconStop` + 글자, `aria-label="이 대화의 실행 멈추기"`) — 대화에
  running 턴이 있을 때만 보인다. **헤더의 것이 있어야 하는 이유**: 입력칸에 초안이 있으면 전송 버튼이
  실행(예약)이 되고, 대화록을 위로 올려 두면 상태 줄이 화면 밖이다 — 그 둘이 겹쳐도 한 번에 멈출 수
  있어야 한다(2026-09-27 초안 검토에서 Claude가 결정, 초안의 "최신으로 이동 한 번 뒤" 공백을 메움).
  대기 턴은 예약 칩(FR-30)과 상태 줄의 `대기 취소`다. lifecycle FR-24가 도크 헤더 취소를 남긴 이유
  ("대화록의 턴별 취소는 pending에만 있어 running을 덮지 못한다")는 fixes FR-11로 사라졌다(§6 우려 2).

- **FR-30.** **예약은 입력칸 위 칩이다(D3).** 규칙은 **뿌리가 아닌 pending 턴**이다.
  - 뿌리가 아닌 pending 턴(= 이어 보낸 지시)은 **대화록에 그리지 않고** 입력부 위 칩으로 그린다:
    `대기 중`(단독 `<span>`) · 지시 첫 줄 · 이유 · `예약 취소`. 이유는 그 대화에 running 턴이 있으면
    "앞 턴이 끝나면 보냅니다", 없으면 "실행 슬롯이 비면 보냅니다". 칩은 `role="status"`다 —
    잠긴 전송의 이유를 입력부만 보는 사람도 읽어야 한다(지금 `run-note`가 하던 일).
  - **뿌리 턴이 pending이면 대화록에 남는다**(FR-12의 대기 상태 줄). 새 대화의 첫 지시가 슬롯을
    기다리는 동안 대화록이 비면 무엇이 걸려 있는지 보이지 않는다(§6 우려 1). 이때 입력부는
    "첫 지시가 실행을 기다리는 중입니다 — 시작된 뒤에 다음 지시를 보낼 수 있습니다"를
    `role="status"`로 보인다.
  - 턴이 시작되면 칩이 사라지고 대화록에 나타난다. **대화당 예약은 하나** — `reserved`의 판정과
    잠금은 지금 그대로다.

- **FR-31.** **초안은 대화마다 보존한다(D10).** 초안은 `renderer/store/drafts.ts`의 스토어가 쥔다.
  스토어는 `main.tsx`에서 하나 만들어 Context로 내린다(`RunEventStore`와 같은 자리·같은 모양).
  - 키는 대화 id, 새 대화면 `new:<workspaceId>`다. 도크의 `ConversationPanel` key도 이 값이다 —
    새 대화 칸이 workspace를 넘어 같은 인스턴스로 남지 않는다.
  - RunPanel은 마운트할 때 스토어에서 읽어 시작하고, 칠 때마다 쓴다. 전송이 성공하면 그 키를 비운다.
  - **Dock·ConversationPanel·RunPanel에 두지 않는다.** Dock은 인박스·설정에 가면 언마운트되고
    (App이 `view === 'workspace'`일 때만 그린다), ConversationPanel은 대화를 바꿀 때마다 key로
    재마운트된다 — 설정 화면 FR-11과 같은 이유다. **App state에도 두지 않는다** — 한 글자마다
    App 전체가 다시 그려진다.
  - "다시 실행"의 `draftPrompt`는 지금처럼 새 대화에서만 반영되고, 반영하면 그 키의 초안을 덮는다.
  - 앱을 끄면 사라진다. 저장하지 않는다(localStorage도 쓰지 않는다 — 대화 id가 남는 곳이 늘 뿐이다).

- **FR-32.** **슬래시 피커는 그대로다.** 입력칸의 `anchor-name: --run-prompt`, popover, ARIA 연결,
  키 규칙을 바꾸지 않는다. 카드가 바닥에 붙으므로 피커는 늘 입력칸 위로 열린다.

### (E) 대화 헤더 (D5)

- **FR-33.** **헤더는 대화 칸 맨 위에 고정된다**(`ConversationHeader`, Dock이 그린다). 왼쪽은
  제목과 `⋯`, 그 아래 부제(agent 이름 · repo 이름, 끝낸 대화면 · "끝낸 대화"), 오른쪽은 컨텍스트
  링. 둘째 줄은 "이 대화에 담긴 것"이다 — 지금 대화록과 입력부 사이에 있던 `.applied-context`를
  그대로 옮긴다(한 줄, 넘치면 잘리고 전체는 `title`). 새 대화는 제목 "새 대화"만 있고 메뉴·링이 없다.

- **FR-34.** **이름 바꾸기**: 제목을 누르거나 `⋯` → `이름 바꾸기`. 제목 자리가 `RenameField`로
  바뀐다. 편집 state는 목록 줄의 것과 **하나로** Dock이 쥔다(`renaming: { id, where }`) — 두 자리에서
  같은 대화를 동시에 고치는 상태가 생기지 않는다. 빈 이름은 `rename(root, null)`(fixes FR-21).
  제목 자체는 버튼이 아니다(`title="눌러서 이름 바꾸기"`인 제목 요소) — 키보드 경로는 메뉴다.
  **제목을 버튼으로 만들지 않는 이유**: 접근성 이름이 제목과 같은 버튼이 생기면 이슈 줄
  (`{ name: <이슈 이름>, exact: true }`)과 부딪힌다 — 대화 제목은 담은 이슈의 이름이다.

- **FR-35.** **`⋯` 메뉴**(`aria-label="대화 메뉴"`, `aria-haspopup="menu"`)는 `role="menu"` 안의
  `menuitem` 둘이다: `이름 바꾸기`·`대화 끝내기`(끝낸 대화에는 없다 — lifecycle FR-22). popover +
  anchor positioning으로 띄운다(DESIGN.md 오버레이 규칙). ↑↓로 오가고, Esc·바깥 클릭으로 닫는다.
  **Esc는 `preventDefault`와 `stopPropagation`을 한다** — 안쪽부터 푼다(FR-39의 최대화가 같은 Esc에
  같이 풀리면 안 된다). `대화 끝내기`는 지금의 `closeConversation`이다 — 보고 있던 대화면 새
  대화로 돌아간다(lifecycle FR-23).

- **FR-36.** **컨텍스트 링과 사용량.**
  - 링은 **`usage`가 있는 가장 최근 턴**의 `contextTokens ÷ contextWindow`다 — CLAUDE.md의 "점유는
    마지막 요청의 프롬프트 크기"다. **OpenCode 공식(마지막 assistant tokens에 output까지 더함)을
    베끼지 않는다.** 80%를 넘으면 `--warn` 색.
  - 창 크기를 모르면(OpenCode) 링 대신 `컨텍스트 53.3k` 글자다. 사용량이 하나도 없으면 아무것도 없다.
  - 링(또는 그 글자)은 버튼이고 이름은 `사용량, ` + `formatContext`의 결과다(`사용량, 컨텍스트 5%`)
    — 무엇을 여는지와 지금 값을 함께 말한다. 누르면 팝오버: 누적 입력 · 출력 · 캐시 읽기 · 캐시 쓰기 토큰, 추정 비용
    (`$0.3870`, "정가 기준 추정"), 마지막 턴 컨텍스트(`53,347 / 1,000,000`). 누적은
    `conversationUsage(runs)`가 계산한다 — 토큰·비용은 더하고(아는 것만), 컨텍스트는 마지막 non-null
    (`mergeUsage`와 같은 규칙).
  - **비용은 누를 때만 보인다.** run-info FR-4("화면에 돈을 상시 띄우지 않는다")를 지킨다.

### (F) 도크와 스크롤 (D6·D7)

- **FR-37.** **도크 헤더는 토글 · 슬롯 표시기 · 최대화다.** 토글은 `IconChevronDown` + "대화"이고
  이름은 `aria-label`로 `대화창 숨기기`/`대화창 보이기`다. **글자 "실행"을 버린다** — 아이콘이
  `aria-hidden`이 되면 토글의 이름이 정확히 "실행"이 되어 전송 버튼의
  `{ name: '실행', exact: true }`와 부딪힌다. "접기"/"펼치기"도 쓰지 않는다 — 턴의 `접기`와 부분
  일치로 부딪힌다. 취소는 없다(FR-29).

- **FR-38.** **최대화(D6)**: `대화창 최대화`/`대화창 원래 크기로` 버튼(아이콘, 이름은 aria-label).
  최대화하면 도크가 본문 전체 높이를 쓴다 — 도크에 `.dock-max`를 붙이고 CSS
  `.main:has(> .dock-max) > .columns { display: none }`로 세 패널을 **숨긴다(언마운트하지 않는다 —
  입력 중이던 이슈 본문이 지워지지 않는다)**. 인라인 높이와 크기 조절 핸들은 쓰지 않는다. 접힌
  도크에서 누르면 펼치면서 최대화한다. 최대화 state는 Dock이 쥐고 저장하지 않는다.
  **"원래 크기로"라고 부르고 "축소"라고 부르지 않는다** — 패널의 `축소` 버튼(e2e가 exact로 잡는다)과
  부분 일치로 부딪힌다.

- **FR-39.** **Esc로 최대화를 푼다.** 도크 `<section>`의 `onKeyDown`에서, `e.defaultPrevented`가
  아니면 풀고 `preventDefault`·`stopPropagation`한다. 안쪽(피커·이름 편집·메뉴)이 먼저 Esc를
  삼키므로 그쪽이 열려 있으면 최대화는 그대로다. React의 `stopPropagation`은 document까지 닿지
  않으므로 App의 "열린 항목 닫기"도 같은 Esc에 같이 돌지 않는다(RenameField가 기대는 것과 같은 성질).

- **FR-40.** **기본 도크 높이를 올린다.** `DEFAULT_DOCK_RATIO` 0.34 → **0.5**,
  `MIN_DOCK_PX` 120 → **280**(도크 헤더 + 대화 헤더 + 입력 카드 + 대화록 두어 줄). 저장된 높이가
  하한보다 작으면 읽을 때 클램프되므로 따로 옮길 것이 없다. **왜 하한을 올리나**: 입력부가 고정되면
  (FR-41) 도크가 그보다 짧을 때 입력 카드가 잘린다 — 스크롤로 빠질 곳이 없다.

- **FR-41.** **스크롤은 대화록만 한다(D7).** `.dock-main`은 세로 flex이고 넘치지 않는다 —
  헤더(고정) · 대화록(`flex: 1; min-height: 0; overflow-y: auto`) · 입력부(고정). 지금의
  `.conversation-panel { min-height: 100% }`와 `.dock-main`의 스크롤은 걷어낸다 — 그 모양은 "실행
  패널이 기본 높이에 안 들어간다"를 우회한 것이었고, FR-40이 그 원인을 없앤다. 목록(`.dock-side`)은
  지금처럼 따로 스크롤한다.

- **FR-42.** **바닥 따라가기.**
  - 대화록이 바닥에서 24px 안이면 "붙어 있다". 붙어 있을 때 **내용 버전**이 바뀌면 바닥으로 내린다.
    내용 버전은 턴 수 · 각 턴의 상태 · 활성 턴(`conversation.active`)의 이벤트 수 · 답 길이다.
  - **사용자가 펼치거나 접어서 높이가 바뀐 것으로는 움직이지 않는다** — 내용 버전이 아니다. 지난
    턴의 `자세히`를 눌렀는데 화면이 바닥으로 튀면 방금 누른 것이 사라진다. 그래서 ResizeObserver를
    계기로 쓰지 않는다.
  - 붙어 있지 않으면 대화록 아래 가운데에 `최신으로 이동` 버튼이 뜬다. 누르면 바닥으로 가고 다시
    붙는다. 버튼은 스크롤러 **밖**(형제)에 있어 스크롤되지도 잘리지도 않는다.
  - 대화를 바꾸면(재마운트) 바닥에서 시작한다.

### (G) 다시 보내기·답하기 (D9)

- **FR-43.** **다시 보내기**: 대화의 **마지막 턴**이 `failed`·`interrupted`, 또는 시작된 뒤
  취소된(`canceled` + `startedAt !== null`) 턴이면 끝줄에 `다시 보내기`가 붙는다. 누르면
  `runs.resume({ conversationId, userPrompt, context, model, effort, permission })` — 전부 그 턴의
  값이다(`context`는 `contextItems`의 `{type, id}`, 지워진 항목은 core가 이미 뺐다). 예약이 있으면
  (`reserved`) 비활성이다.
  - **그 대화에 세션이 하나도 없으면 그리지 않는다**(어느 턴에도 `externalSessionId`가 없다).
    resume은 그때 "이어받을 세션이 없습니다"로 실패하는 턴을 하나 더 쌓는다(core `beginRun`).
    그런 턴(대개 첫 턴의 preflight 실패)은 인박스의 `다시 실행`이 맡는다(§6 우려 7).
  - 인박스의 `다시 실행`은 그대로다(새 대화를 연다). 이름을 다르게 둔 것은 하는 일이 달라서다.

- **FR-44.** **답하기**: 마지막 턴이 답변 필요(`needsAnswer`)면 끝줄에 `답하기`가 붙고, 누르면
  입력칸에 포커스를 준다(보낼 대상은 이미 이 대화다). RunPanel은 입력칸 ref를 밖으로 받는다.

### (H) 이름과 모양 (D11)

- **FR-45.** **run 상태의 화면 이름은 `renderer/runStatus.ts`의 표 하나다.**

  | status | 이름 |
  |---|---|
  | `pending` | 대기 중 |
  | `running` | 실행 중 |
  | `succeeded` | 완료 |
  | `failed` | 실패 |
  | `canceled` | 취소됨 |
  | `interrupted` | 중단됨 |

  대화록의 상태 알약, 목록 상태 점의 `aria-label`·`title`이 이 표를 쓴다. RunLog의 표(`pending:
  '대기'`)는 RunLog와 함께 사라진다. **클래스(`status-succeeded` 등)는 enum 그대로 둔다** — 색과
  e2e 셀렉터가 거기 걸려 있다. `shared/`가 아니라 `renderer/`에 두는 것은 core가 이 이름을 쓰지
  않아서다(인박스 카테고리 이름은 `shared/inbox.ts`에 따로 있다 — 다른 개념이다).

- **FR-46.** **agent 이름도 한 표다**(`renderer/agents.ts`의 `AGENT_LABELS`). 헤더 부제·메타 줄·
  실행 패널의 옵션·설정 화면·`AgentStatusList`가 같이 쓴다 — 지금은 세 곳에 따로 적혀 있다
  (CLAUDE.md "하나의 enum을 옮겨 적은 표는 공유한다").

- **FR-47.** **대화 영역의 `opacity` 흐림을 토큰으로 바꾼다.** `.turn-info`·`.turn-meta`·
  `.turn-pending`·`.applied-label`·`.applied-chip`·`.log-meta`·`.dock-toggle`·`.dock-slots-waiting`·
  `.run-settings label`·`.chip-remove`의 `opacity`를 걷고 `--text-muted`/`--text-secondary`를 쓴다.
  `opacity`는 `disabled`(`.4`)에만 남는다(DESIGN.md).

- **FR-48.** **글리프를 아이콘으로 바꾼다.** 도크 토글 `▾`/`▴`, `＋ 새 대화`의 `＋`, `끝낸 대화` 토글의
  `▸`/`▾`, RunPanel 칩 안의 인라인 SVG를 `icons.tsx`로. 더할 아이콘: `IconChevronDown`, `IconMore`,
  `IconStop`, `IconSend`, `IconCopy`, `IconMaximize`, `IconArrowDown`, `IconClose`(`IconCheck`는
  복사 완료에 재사용). 아이콘은 전부 `aria-hidden`이고 이름은 버튼의 `aria-label`이 준다.
  **예외는 그대로 둔다** — 입력부 안내문의 `＋`는 문장 속 글자이고 e2e가 그 문장을 잡는다.

- **FR-49.** **움직임은 상태를 전하는 것만.** 상태 줄과 running 도구 한 줄의 스피너 하나뿐이다
  (12px 원, 0.8초 회전). `prefers-reduced-motion: reduce`면 회전하지 않는 점이다. 그 밖의 전환은
  120ms 색·테두리 변화까지(DESIGN.md).

## 3. 인터페이스

```ts
// renderer/timeline.ts — 순수 함수만 (FR-1~FR-11)
export type ToolCategory =
  'read' | 'edit' | 'shell' | 'search' | 'web' | 'todo' | 'subagent' | 'mcp' | 'other'
export const TOOL_LABELS: Record<string, { label: string; category: ToolCategory }>  // 키는 소문자
export function toolLabelOf(name: string): { label: string; category: ToolCategory }
export function toolSubtitleOf(input: unknown, cwd: string): string

export interface ToolItem {
  /** toolUseId. 비어 있으면 `seq:<n>` */
  id: string
  name: string
  label: string
  category: ToolCategory
  subtitle: string
  input: unknown
  state: 'running' | 'done' | 'failed' | 'unknown'
  /** tool_result.summary — 200자 요약이다 */
  output: string | null
  /** search 종류에서 `Found N`을 읽었을 때만 */
  matches: number | null
}

export interface EditFile {
  path: string
  /** cwd 기준 상대 경로 */
  displayPath: string
  created: boolean
  added: number
  removed: number
  hunks: DiffHunk[]
  /** 400줄에서 자른 나머지 줄 수 */
  truncated: number
}

export type TimelineBlock =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'activity'; key: string; label: string; items: ToolItem[]; running: boolean }
  | { kind: 'edit'; key: string; files: EditFile[]; running: boolean }
  | { kind: 'tool-error'; key: string; item: ToolItem }
  | { kind: 'error'; key: string; message: string }
  | { kind: 'notice'; key: string; text: string; lines: string[] }

export interface TurnProjection {
  blocks: TimelineBlock[]
  answer: { text: string; final: boolean } | null
  summary: { tools: number; failed: number } | null
  current: ToolItem | null
}

export function projectTurn(
  run: Pick<Run, 'status' | 'resultText' | 'errorMessage' | 'cwd'>,
  events: readonly RunEvent[]
): TurnProjection
export function switchNotice(
  prev: Pick<Run, 'model' | 'effort' | 'agentKind'> | null,
  next: Pick<Run, 'model' | 'effort' | 'agentKind'>
): string | null
export function formatDuration(ms: number): string
export function metaPieces(run: Run, now: number): string[]

// renderer/diff.ts
export interface DiffLine { sign: '+' | '-' | ' '; text: string }
export interface DiffHunk { lines: DiffLine[] }
export function lineDiff(before: string, after: string): DiffHunk
export function diffStats(hunks: DiffHunk[]): { added: number; removed: number }

// shared/links.ts — 렌더러와 main이 같은 판정을 쓴다 (FR-22·FR-24)
/** http/https 절대 URL이면 정규화한 문자열, 아니면 null */
export function externalLinkOf(href: string): string | null

// renderer/runStatus.ts (FR-45) · renderer/agents.ts (FR-46)
export const RUN_STATUS_LABELS: Record<RunStatus, string>
export const AGENT_LABELS: Record<AgentKind, string>

// renderer/usage.ts — 추가 (FR-36)
export function conversationUsage(runs: readonly Run[]): {
  inputTokens: number | null; outputTokens: number | null
  cacheReadTokens: number | null; cacheWriteTokens: number | null
  costUsd: number | null
  contextTokens: number | null; contextWindow: number | null
} | null

// renderer/store/drafts.ts (FR-31)
export function createDraftStore(): {
  get(key: string): string
  set(key: string, value: string): void
}
export function draftKeyOf(conversationId: string | null, workspaceId: string): string
// renderer/store/DraftContext.tsx — DraftProvider, useDraftStore()

// renderer/hooks/useRunEvents.ts — 추가 (FR-14)
/** 스토어만 본다. 로그 파일을 읽지 않는다 — 접힌 턴용 */
export function useRunEventSnapshot(runId: string | null): readonly RunEvent[]

// renderer/followBottom.ts (FR-42)
export function isNearBottom(
  box: { scrollTop: number; scrollHeight: number; clientHeight: number },
  threshold?: number  // 기본 24
): boolean
// renderer/hooks/useFollowBottom.ts
export function useFollowBottom(
  ref: RefObject<HTMLElement | null>, version: string
): { atBottom: boolean; jump(): void }
// renderer/hooks/useNow.ts — running일 때만 1초마다 (FR-11·FR-12)
export function useNow(active: boolean): number
```

**컴포넌트** (새 파일은 †)

| 컴포넌트 | 하는 일 | state |
|---|---|---|
| `Markdown` † | FR-20~26 | 없음 |
| `Transcript` | 턴 목록, 공지, 따라가기 | 없음 |
| `Turn` (Transcript 안) | FR-12~13 | 펼침(턴·블록별) |
| `TimelineBlocks` † | 블록 여섯 종류 | 블록별 펼침은 `Turn`이 준다 |
| `ConversationHeader` † | FR-33~36 | 메뉴·팝오버 열림만 |
| `RunPanel` | 입력 카드(FR-27~32) | 지금 그대로 + 초안은 스토어 |
| `Dock` | 헤더 토글·최대화·`renaming` | `maximized`·`renaming` 추가 |

`Dock`이 새로 들고 가는 것: `maximized`, `renaming: { id, where: 'list' | 'header' } | null`
(`renamingId`를 대체). 둘 다 workspace가 바뀌면 fixes FR-22처럼 처음 상태로 돌아간다 — 단
`maximized`는 보기 방식이라 남긴다.

**IPC·스키마 변경 없음.** 새로 쓰는 client 메서드도 없다(`runs.resume`·`cancel`·`rename`·`close`는
이미 있다).

## 4. 화면

```
┌ 도크 ─────────────────────────────────────────────────────────────────────────┐
│ ⌄ 대화   [실행 중 1/3]                                                   [⤢]   │
├───────────────┬───────────────────────────────────────────────────────────────┤
│ + 새 대화      │ 로그인 깨짐 +2  ⋯                                         (◔)  │
│ ● 로그인 깨짐… │ Claude Code · api                                              │
│   api · 3턴   │ 이 대화에 담긴 것  이슈 · 로그인 깨짐  메모 · 재현  repo · api   │
│ ● 인증 정리    ├───────────────────────────────────────────────────────────────┤
│   api · 1턴   │                               ┌─────────────────────────┐     │
│               │                               │ 로그인이 깨졌어. 고쳐줘   │     │
│ › 끝낸 대화 4  │                               └─────────────────────────┘     │
│               │  도구 7회 · 실패 1                                              │
│               │  원인은 토큰 만료 검사가 `<`가 아니라 `<=`여서…                 │
│               │  ┌ ts ────────────────────────────────────── [코드 복사] ┐     │
│               │  │ if (now >= expiresAt) return refresh()                │     │
│               │  └────────────────────────────────────────────────────────┘     │
│               │  [완료]  Claude Code · sonnet · 22초 · 편집 허용    ⧉   자세히 › │
│               │  ──────────────────── 모델 → opus ────────────────────         │
│               │                                     ┌───────────────┐         │
│               │                                     │ 테스트도 돌려   │         │
│               │                                     └───────────────┘         │
│               │  ◌ 작업 중 · 12초 · 셸 pnpm test                 [■ 멈추기]    │
│               │  이제 테스트를 돌려 보겠습니다.                                  │
│               │                     [ ↓ 최신으로 이동 ]                         │
│               ├───────────────────────────────────────────────────────────────┤
│               │ 대기 중  린트도 돌려줘 — 앞 턴이 끝나면 보냅니다     [예약 취소] │
│               │ ┌───────────────────────────────────────────────────────────┐ │
│               │ │ (이슈 · 로그인 깨짐 ×)                                      │ │
│               │ │ 무엇을 시킬지 적으세요. Ctrl+Enter로 실행합니다.              │ │
│               │ │ (Claude Code)(sonnet)(effort ⌄)(편집 허용 ⌄)(api)        (↑) │ │
│               │ └───────────────────────────────────────────────────────────┘ │
└───────────────┴───────────────────────────────────────────────────────────────┘
```

펼친 턴(자세히)의 블록:

```
  먼저 인증 모듈을 봅니다.
  4 읽기, Grep, 셸 사용됨 ›               ← 활동 묶음. 누르면 아래가 열린다
    읽기   src/auth/token.ts
    Grep   expiresAt  (3개 일치)
    셸     pnpm test                       ← 누르면 명령 + 출력 요약
  ✕ 셸   pnpm lint   실패                  ← 실패한 도구는 묶음 밖
  편집 · 파일 1개
    src/auth/token.ts               +1 −1 › ← 누르면 diff
```

**치수** — 전부 DESIGN.md의 여섯 글자 크기·네 간격·기존 모서리 안에서 고른다. OpenCode를 닮게 하는
것은 크기보다 **구조**(오른쪽 버블 / 왼쪽 버블 없는 답 / 한 줄 활동 / 바닥 카드)다.

| 요소 | 값 |
|---|---|
| 대화록 열 | 가운데 정렬, `max-width: 800px`, 좌우 16px, 위 12px |
| 턴 간격 / 턴 안 간격 | 24px (OpenCode TurnGap) / 8px |
| 사용자 버블 | 오른쪽, `max-width: 80%`, `padding: 8px 12px`, 모서리 10px, `--accent-bg`, `.8125rem`/1.5 |
| 답 칸 | **버블 없음**(OpenCode처럼 바탕 없이 왼쪽), `.8125rem`/1.6, 문단 간격 8px |
| 마크다운 제목 | h1 `.9375rem` · h2 `.875rem` · h3 이하 `.8125rem`, 전부 600, 위 12px 아래 4px |
| 코드 블록 | `--bg-muted`, 모서리 6px, 머리 `.6875rem` `--text-muted`, 본문 `.75rem` 모노/1.55, 안쪽 8px 10px |
| 인라인 코드 | `--bg-muted`, 모서리 4px, `1px 4px`, `.75rem` 모노 |
| 표 | 1px `--border`, 셀 `4px 8px`, 머리 행 `--bg-panel` |
| 상태 줄 | `.75rem` `--text-secondary`, 스피너 12px(`--accent`) |
| 활동 요약·묶음 라벨 | `.75rem` `--text-secondary`, 묶음 라벨 hover `--text` |
| 도구 한 줄 | 높이 24px, `.75rem`, 라벨 600 `--text`, 부제 `--text-muted`, 들여쓰기 12px |
| 셸 출력·diff | `.6875rem` 모노/1.55, `--bg-muted`, 모서리 6px, `max-height: 240px` 스크롤 |
| 실패 도구 | `--danger-bg-soft` 바탕, 글자 `--danger-text` |
| 끝줄 | `.6875rem` `--text-muted`, 아이콘 버튼 24px(`.row-action`) |
| 공지선 | `.6875rem` `--text-muted`, 양옆 1px `--border-faint` |
| 대화 헤더 | `padding: 6px 12px`, 아래 1px `--border-faint`; 제목 `.875rem` 600, 부제 `.6875rem` `--text-muted` |
| 컨텍스트 링 | 18px, 선 2px — 바탕 `--border`, 채움 `--accent`(80% 넘으면 `--warn`) |
| 입력 카드 | `--bg`, 1px `--border-strong`, 모서리 10px, `padding: 8px 10px`; `:focus-within`이면 `--accent-border` |
| 입력칸 | 테두리 없음, `.8125rem`/1.5, `min-height: 56px` |
| 알약 선택 | 높이 22px, 모서리 99px, 1px `--border`, `--bg-muted`, `.6875rem`, 좌우 8px |
| 전송/중지 | 28px 원, `--accent` 면 · `--on-accent` 아이콘 14px, `disabled`면 `opacity: .4` |
| 예약 칩 | `--bg-muted`, 모서리 7px, `.75rem`, 좌우 10px; `대기 중`은 600 |
| 최신으로 이동 | 알약, `--bg`, 1px `--border-strong`, `.6875rem` — 그림자 없음(DESIGN.md: 그림자는 최상위 레이어 하나) |

**라이트·다크 모두 토큰만으로 된다 — 새 색 토큰이 필요 없다.** diff는 `--success-bg`/
`--danger-bg-soft`, 코드·출력은 `--bg-muted`, 실패는 `--danger-*`를 쓴다. 다크에서 이 조합은 이미
다른 자리(상태 알약, 칩 hover)에서 쓰이고 있다. 새 CSS 블록에 hex는 0건이다.

**모서리 10px에 대해**: DESIGN.md의 Shapes 절은 4/5/6/7px이라고 적었지만 Layout 절과 실제 CSS는
패널·도크·버블에 10px을 쓴다. 입력 카드와 버블은 "떠 있는 판"이라 10px을 따른다(§6 우려 12).

## 5. 비기능 요구사항

- **NFR-1.** 마이그레이션·IPC·이벤트 모델 변경 없음. core 코드 변경 없음(테스트 픽스처
  `fake-claude.mjs`의 시나리오 추가는 예외 — 제품 코드가 아니다).
- **NFR-2.** 경계 셋 그대로 — `renderer/`는 core를 모르고, `window.oneDesk`는 `main.tsx` 한 곳,
  `shared/links.ts`는 순수 함수(electron·DOM 모름).
- **NFR-3.** 투영은 이벤트 수에 선형이다. `Turn`은 `useMemo`로 (이벤트 배열 참조, run 네 칸)이
  같으면 다시 계산하지 않는다. 스토어는 프레임 단위로 알리므로 진행 중 턴의 재투영은 프레임당
  한 번이 상한이다. diff는 FR-7의 상한이 막는다.
- **NFR-4.** 상태 줄은 live region이 **아니다** — 경과 시간이 1초마다 읽히면 안 된다. 예약 칩과
  입력부 안내만 `role="status"`다.
- **NFR-5.** 색은 `:root` 토큰에서만, 글자 흐림은 `--text-muted`, 대비 4.5:1(DESIGN.md).
- **NFR-6.** **새 접근성 이름이 기존 셀렉터와 부분 일치로 부딪히지 않는다.** 새로 생기는 이름:
  `중지`·`실행 중인 턴 멈추기`(fixes)·`예약 취소`·`대기 취소`·`다시 보내기`·`답하기`·`응답 복사`·
  `코드 복사`·`명령 복사`·`대화 메뉴`·`이름 바꾸기`(menuitem)·`대화 끝내기`(menuitem)·
  `사용량, 컨텍스트 …`·`최신으로 이동`·`대화창 최대화`·`대화창 원래 크기로`·`대화창 숨기기`·
  `대화창 보이기`·`새 대화`. 검토한 충돌: `실행`(토글 글자를 버린다)·`접기`(토글 이름을 피했다,
  FR-37), `축소`(FR-38), 제목과 같은 이름의 버튼(FR-34). `자세히`·`응답 복사`는 턴마다 하나씩이라
  e2e는 턴으로 범위를 좁혀 잡는다.
- **NFR-7.** 번들 증가(react-markdown·remark-gfm과 그 전이 의존성)를 빌드 산출물 크기로 재서
  완료 증명에 적는다.

## 6. 우려 사항

1. **D3를 좁혔다 — 뿌리 턴의 대기는 대화록에 남는다.** D3는 "대화록에는 턴이 시작된 뒤에야
   나타난다"인데, 새 대화의 첫 지시가 슬롯을 기다릴 때 그것까지 칩으로 빼면 대화록이 비어 무엇이
   걸려 있는지 보이지 않는다(queue.e2e의 두 번째 대화가 정확히 그 상태다). 규칙을 "뿌리가 아닌
   pending"으로 잡아 상태가 바뀌어도 칩 ↔ 대화록을 오가지 않게 했다. D3의 "예약"이 설계 §3-2의
   "대화당 예약"(이어 보낸 지시)을 가리킨다고 읽은 것이다 — 다르게 읽는다면 여기서 정해야 한다.
2. **lifecycle FR-24를 뒤집는다 — 도크 헤더의 `취소`가 사라진다(FR-29).** 그 절이 남긴 이유는
   fixes FR-11(대화록의 running 턴 멈추기)로 해소됐다. 남는 틈: 입력칸에 초안이 있고 대화록을 위로
   올려 둔 상태에서는 중지 버튼이 전송 버튼이라 멈추려면 `최신으로 이동`을 한 번 거쳐야 한다.
   초안이 있을 때도 보조 중지 버튼을 두는 안은 D4의 문장("입력이 비었으면")을 넘어서므로 넣지 않았다.
3. **도구 출력은 200자 요약까지다.** 셸 출력은 잘린 채로 보이고("출력 앞부분만 기록됩니다"),
   "(N개 일치)"는 claude Grep의 `Found N` 한 형식에서만 읽는다 — 그 형식은 **구현 전에 실제
   로그로 확인해야 한다**. glob·opencode는 개수가 없다. 전문과 종료 코드는 `conversation-events`다
   — 그 intent(E2·E5)가 Grep `numFiles`·셸 원문·공지 이벤트를 실으면 `ToolItem.matches`·`output`과
   `notice` 블록을 거기서 채운다. **투영의 출력 모양(§3)은 그대로 두고 입력만 넓히는 자리다.**
4. **접힌 턴의 활동 요약은 앱을 다시 켜면 사라진다**(FR-14). 접힌 턴이 로그를 읽지 않는다는
   원칙을 지킨 대가다. 한 번 펼치면 스토어가 채워져 접어도 남는다. 요약을 run 행에 저장하면
   해결되지만 스키마 변경이다 — `conversation-events`에서 같이 다룰 수 있다.
5. **intent의 영향 범위 밖 파일 둘** — `electron/main.ts`(FR-24)와 `shared/links.ts`(FR-22).
   D2의 "앱 안 탐색 금지"를 렌더러 한 겹이 아니라 두 겹으로 막으려면 main이 필요하고, 두 곳이
   같은 판정을 쓰려면 shared가 필요하다. IPC는 건드리지 않는다.
6. **"마크다운 라이브러리 하나"가 패키지 둘이다.** `remark-gfm`은 `react-markdown`의 플러그인이고
   (표·작업 목록·자동 링크), 없으면 agent 답의 표가 파이프 글자로 남는다. 전이 의존성(unified·
   micromark 계열)이 여럿 딸려 온다 — NFR-7로 크기를 잰다.
7. **다시 보내기는 세션이 있는 대화에서만 된다**(FR-43). 첫 턴이 세션 없이 실패한 대화는 버튼이
   없다. `runs.start({ parentRunId })`로 같은 대화에 새 세션을 여는 길이 IPC에 이미 있지만(뿌리가
   부모에서 승계된다), 그러면 "같은 대화인데 세션이 둘"인 상태가 생겨 resume이 어느 세션을 잇는지가
   `latestSessionRun`의 순서에 기대게 된다. 결정이 더 필요해 이번에는 넣지 않았다.
8. **공지는 요청값을 비교한다**(FR-10). 모델 칸을 비워 둔(CLI 기본값) 두 턴 사이에 CLI의 기본
   모델이 바뀌어도 공지가 없다. 관측값을 쓰면 진행 중에 공지가 떴다가 바뀐다 — 이쪽이 덜 나쁘다.
9. **상태 이름이 한국어가 되면 e2e 아홉 파일이 깨진다.** 목록 줄 버튼을 영어
   `aria-label`(`/running.*X/`·`/succeeded/`)로 잡던 곳들이다(core-loop·queue·inbox·slash·
   agent-setup·asset·mcp·opencode-real·slash-real). 한국어 정규식으로 바꾸지 않고 **클래스로
   잡는 도우미**(`.dock-conv` + `.status-dot.status-<enum>`)로 옮긴다 — 화면 문구가 바뀔 때마다
   e2e가 다시 깨지지 않게.
10. **가짜 CLI의 텍스트 "작업 중"이 상태 줄 "작업 중"과 겹친다.** core-loop의
    `page.getByText('작업 중')`은 strict 위반이 된다. 셀렉터를 `.turn-answer`/`.tl-text`로 좁힌다.
    상태 줄 문구를 바꾸지 않는 것은 D1이 그 말을 정했기 때문이다.
11. **최대화 중에는 맥락을 담을 수 없다**(FR-38). 세 패널이 숨기 때문이다. OpenCode의 세션 화면처럼
    대화에 몰두하는 모드로 본다 — 담으려면 원래 크기로 돌아온다.
12. **DESIGN.md가 스스로 어긋나 있다.** Shapes는 7px까지, Layout과 CSS는 10px이고, Components의
    "탭" 항목은 이미 없는 `.dock-tab`을 말한다. 이 기능의 plan 마지막 단계에서 문서를 CSS에 맞춘다.
13. **fixes와 같은 파일을 연달아 고친다** — `Dock.tsx`·`Transcript.tsx`·`ConversationList.tsx`·
    `conversation.ts`·`fake-claude.mjs`와 그 테스트들. fixes가 `main`에 들어간 뒤에 착수한다.

## 7. 검증

**단위** (새 파일은 †)

- `renderer/timeline.test.ts` † — FR-2 표의 행마다 하나. FR-3 짝짓기(순서 뒤섞인 result, 빈 id,
  use 없는 result, 결과 없이 끝난 use → `unknown`). FR-4 라벨(대소문자 두 벌이 같은 칸, mcp 이름,
  표에 없는 이름이 이름 그대로). FR-5 부제 우선순위·상대 경로(`/`·`\` 둘 다)·`Found N`·todos.
  FR-6 묶음 라벨(고유·순서·개수)과 끊김. FR-7 편집 블록 합치기. **FR-8 넷**: 진행 중 = 마지막 text,
  끝남 = resultText, 끝남 + 스토어에 text가 있어도 resultText 없으면 null, 마지막 text == resultText면
  블록에서 빠지고 다르면 남는다(RunLog.test의 세 경우를 옮긴다). errorMessage 중복 제거.
  FR-9 current(claude 모양 / opencode 모양 = null). FR-10·FR-11 경계값(59.9초·60초·3600초).
- `renderer/diff.test.ts` † — 한 줄 바꿈, 앞뒤 공통 줄, 빈 old(=작성), 곱 상한 폴백, 400줄 자르기와
  `+N −M`이 자르기 전 값인지.
- `shared/links.test.ts` † — `https:`·`http:` 통과, `javascript:`(대소문자·앞 공백·제어 문자 섞은 것),
  `file:`·`data:`·`vbscript:`·상대·`#`·`mailto:`·빈 문자열 거부.
- `renderer/components/Markdown.test.tsx` † — **보안 고정**: `<script>window.__x=1</script>`는
  `script` 요소 0개이고 글자로 보인다, `![a](https://e.x/p.png)`·`<img src=…>`는 `img` 0개,
  `[a](javascript:alert(1))`·`[a](file:///etc/passwd)`·`[a](#top)`·`[a](/x)`는 `a` 0개(글자),
  `[a](https://e.x)`는 `target="_blank"`·`rel`에 `noopener`·`noreferrer`. 코드 블록 복사가
  `navigator.clipboard.writeText`를 원문으로 부른다. 표·작업 목록이 그려진다.
- `renderer/components/Transcript.test.tsx` — 다시 쓴다. FR-12 접힌 턴의 여섯 칸(진행 중 답 칸 =
  마지막 text, 상태 줄의 도구·시간, 요약 줄), FR-13 펼친 턴의 블록 순서, FR-14 **접힌 턴은
  `useRunEvents`(readLog)를 부르지 않고 펼친 턴만 부른다**, FR-15 **예약된 턴이 시작돼 대화록에
  나타나도 접힌 채다 · 펼쳐 둔 턴은 끝나도 접히지 않는다 · 새 이벤트가 와도 열린 묶음이 닫히지
  않는다**, FR-19 공지, FR-43 다시 보내기의 조건 넷(마지막 턴만 / 세션 없으면 없음 / reserved면
  비활성 / resume 인자), FR-44 답하기가 포커스 콜백을 부른다, FR-30 뿌리 pending은 대화록에,
  뿌리가 아닌 pending은 대화록에 없다.
- `renderer/components/RunPanel.test.tsx` — 기존 테스트는 이름으로 잡으므로 대부분 그대로.
  더한다: FR-28 중지/실행 전환과 중지가 running 턴 id로 `cancel`, FR-30 예약 칩의 두 이유와
  `예약 취소`, FR-31 **언마운트 뒤 다시 마운트해도 초안이 남는다 · 전송 성공이 초안을 비운다 ·
  다른 키의 초안이 섞이지 않는다**.
- `renderer/components/ConversationHeader.test.tsx` † — 제목·부제·담긴 것 줄(ConversationPanel.test의
  "이 대화에 담긴 것" 넷을 옮긴다), 메뉴 두 항목과 끝낸 대화의 메뉴, Esc가 전파되지 않음, 링의
  이름과 창 모름일 때 글자, 팝오버의 누적·비용.
- `renderer/components/Dock.test.tsx` — 토글·최대화(FR-37·38), **Esc가 최대화를 풀고 안쪽 Esc는
  먼저 소비된다**(FR-39), `renaming`이 목록과 헤더 중 한 곳에만(FR-34), 상태 점 이름이 한국어
  (`getByRole('img', { name: '완료' })`).
- `renderer/dockHeight.test.ts` — 새 기본 비율·하한. `renderer/usage.test.ts` — `conversationUsage`.
  `renderer/followBottom.test.ts` † — 경계(23·24·25px). `renderer/store/drafts.test.ts` †.
- `renderer/App.test.tsx` — **인박스에 다녀와도 초안이 남는다**(FR-31의 배선: 도크가 언마운트되는
  경로를 실제로 탄다).

**회귀 확인** — 구현 전에 망가뜨려 빨개지는지 본다(CLAUDE.md 컨벤션).

- `Turn`에 `useEffect(() => setOpen(true), [run.status])`를 넣으면 FR-15 테스트가 빨개진다.
- 접힌 턴에서 `useRunEvents`를 부르면 FR-14 테스트가 빨개진다.
- `Markdown`에 `rehype-raw`를 끼우거나 `a`의 `externalLinkOf` 검사를 빼면 보안 테스트가 빨개진다.
- FR-8의 중복 제거를 빼면 "같은 답이 두 번 나오지 않는다"가 빨개진다.
- 초안을 RunPanel `useState`로 되돌리면 FR-31 테스트(RunPanel·App)가 빨개진다.
- `followBottom`에 ResizeObserver 계기를 더하면 "펼쳐도 바닥으로 가지 않는다"가 빨개진다(단위는
  스크롤 속성을 직접 세워 흉내 낸다).

**e2e** — 바꾸는 것

- `e2e/dock.ts` † — 도우미: `convRow(page, text)` = `.dock-conv` + `hasText`,
  `waitConvStatus(page, text, status)` = 그 줄 안의 `.status-dot.status-<status>`.
- core-loop·queue·inbox·slash·agent-setup·asset·mcp·opencode-real·slash-real — 영어 `aria-label`
  정규식을 도우미로(§6 우려 9). queue의 `＋ 새 대화` → `{ name: '새 대화', exact: true }`.
- core-loop 8단계 — 접힌 채로 `.turn-answer`에 "작업 중"이 흐르는 것을 먼저 보고(성공 기준 1),
  `자세히` 뒤에는 `.tl-text`로 본다(§6 우려 10).
- conversation — `대기 중`은 예약 칩의 단독 span이다(그대로 통과해야 한다). 3턴은 칩으로 먼저
  기다린 뒤 대화록 등장을 20초로 기다린다(뿌리가 아닌 pending은 대화록에 없다). `.turn-info` →
  `.turn-meta`(모델 이름·`title`의 `$0.3870`)와 헤더 링의 이름(`컨텍스트 5%`). 스크롤 단언은
  `.dock-main`이 아니라 `.transcript`로 — 도크를 하한까지 끌어내린 뒤 **입력 카드의 아래 끝이 도크
  안에 있고 대화록이 바닥에 붙어 있음**을 본다(D7의 핵심 약속).
- dock-resize — 단언이 상대값이라 그대로이되, 기본 0.5에서 +200px이 상한(0.85) 안인지 확인한다.

**e2e** — 새로 쓰는 것 (가짜 CLI에 도구·마크다운 시나리오를 더한다 — plan 참고)

- `e2e/timeline.e2e.ts` † — 접힌 진행 중 턴의 상태 줄(작업 중 · 시간 · 셸 도구), 끝난 뒤 활동 요약
  "도구 N회 · 실패 1", 펼침 → 묶음 라벨 → 셸 한 줄 → 명령, 편집 블록 `+1 −1`. **보안**: 답의 `img`
  0개, `script`가 실행되지 않음(`window.__pwned` 없음), 원격 주소로 나간 요청 0건
  (`page.on('request')`), `javascript:` 링크가 글자, `https` 링크를 누르면 main의 `shell.openExternal`
  (테스트가 `app.electron.evaluate`로 바꿔 세운다 — repo-pick.e2e와 같은 방식)이 그 URL을 받고 앱의
  URL은 그대로. 코드 복사 → main의 `clipboard.readText()`가 원문.
- `e2e/composer.e2e.ts` † — 입력부의 중지로 실행 중 턴을 멈춘다(상태 `취소됨`), 대화 A에 친 초안이
  B를 거쳐 돌아와도, 인박스에 다녀와도 남는다, 최대화하면 `.columns`가 안 보이고 Esc로 돌아온다,
  헤더 메뉴로 이름 바꾸기·끝내기, 위로 올리면 `최신으로 이동`이 뜨고 누르면 바닥.

**화면 캡처** — 단위·e2e가 초록이어도 화면은 따로 본다(lifecycle의 사용자 확인 수정 넷이 전부
그렇게 나왔다).

1. 임시 파일 `e2e/zz-timeline-capture.e2e.ts`를 만든다(커밋하지 않는다). 가짜 CLI의 타임라인
   시나리오로 대화를 만들고, 라이트에서 한 벌 찍은 뒤 `page.emulateMedia({ colorScheme: 'dark' })`로
   다크 한 벌을 찍는다(듣지 않으면 `app.electron.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark' })`).
2. 찍는 장면 일곱: 접힌 진행 중 턴 · 끝난 접힌 턴 · 펼친 턴(묶음·diff 열림) · 예약 칩 · 헤더 메뉴와
   사용량 팝오버 · 최대화 · 위로 올린 대화록과 `최신으로 이동`. `e2e/artifacts/tl-<light|dark>-<n>.png`
   (이미 gitignore).
3. `pnpm dev`가 떠 있지 않은 것을 확인하고(CLAUDE.md) `pnpm build` 후 그 파일만 돌린다:
   `pnpm vitest run --config vitest.e2e.config.ts e2e/zz-timeline-capture.e2e.ts`.
4. 캡처를 열어 본다 — 다크에서 흰 채로 남은 칸(직접 hex), 흐린 안내문, 잘린 입력 카드, 가로 스크롤,
   아이콘 굵기 어긋남, 버블·답의 정렬. 고칠 것이 나오면 고치고 다시 찍는다.
5. 끝나면 zz 파일을 지운다. 캡처 요약을 plan의 완료 증명에 적는다.

**grep**

- `grep -rn "dangerouslySetInnerHTML\|rehype-raw" renderer/` — 출력 없음
- `grep -rn "from 'electron'" core/` · `grep -rn "window.oneDesk" renderer/ | grep -v main.tsx` — 출력 없음
- 이 기능이 더한 CSS 블록에 직접 hex 0건, 대화 영역 규칙에 글자 `opacity` 0건

**명령** — `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm test:e2e` 전부 초록.
