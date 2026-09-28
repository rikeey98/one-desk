# Intent: 입력 트리거 — `/` 말고도 `@` 등을 OpenCode처럼

- 출처: `docs/backlog.md` §2 (2026-09-28)
- 작성자: 권용현 (초안: Claude)
- 상태: 결정 반영 (2026-09-28)

## 문제

one-desk 입력부의 트리거는 `/`(슬래시 커맨드) 하나이고 그것도 Claude Code 실행에서만 켜진다
(`renderer/slash.ts`의 `findSlashToken`, `CommandPicker.tsx`). 파일을 짚어 말하려면 경로를 손으로
치거나, 맥락 담기(repo·이슈·메모·asset)에 없는 파일은 아예 실을 수 없다. OpenCode는 `@`로 파일·
agent를 고르고 `!`로 셸을 친다.

## 원하는 결과

입력칸에서 `@`를 치면 파일(과 경우에 따라 agent)을 퍼지로 고르는 피커가 뜨고, 고른 것이 실행에
실린다. 피커의 모양은 OpenCode를 따른다. 두 CLI 모두에서 같게 동작한다.

## 조사 (2026-09-28, 로컬 claude 2.1.283 · opencode 1.18.30 실측 + `anomalyco/opencode` v1.18.30 소스)

**OpenCode의 트리거**
- `/` — 입력 맨 앞에서만. 커맨드(MCP 것은 `:mcp`) 퍼지, 설명도 매칭.
- `@` — 캐럿 앞 공백 없는 가장 가까운 `@`. 파일·디렉토리(서버 `fs.find`, 네이티브 frecency 퍼지
  파인더 — ripgrep 아님, 20개), `@path#10-20` 줄 범위, 하위 에이전트(`primary`·`hidden` 제외), MCP
  resource. TUI `packages/tui/src/component/prompt/autocomplete.tsx`, Desktop
  `packages/app/src/components/prompt-input.tsx`.
- `!` — 캐럿이 0일 때 셸 모드. 서버의 `session.shell`을 부른다 — **헤드리스 `run`에는 대응이 없다.**

**헤드리스가 `@경로`를 펼치는가**
- `claude -p "... @notes.txt ..." --tools ""` — **펼친다.** 도구를 하나도 주지 않았는데 파일 내용으로
  답했고 stream-json에 tool_use가 없다. 세션 기록에는 합성 Read가 `attachment`로 남는다.
  **`--tools` 화이트리스트를 거치지 않는다** — deny 규칙까지 비켜 가는지는 실측하지 않았다.
- `opencode run "... @notes.txt ..."` — **펼치지 않는다**("맥락에 없다"로 답함).
- `opencode run "<메시지>" -f notes.txt` — 첨부로 들어가 정답. `-f`는 array 옵션이라 **메시지보다
  앞에 두면 메시지까지 파일명으로 먹는다**(실측 exit 1). 10 MiB 초과·디렉토리 거부. one-desk
  어댑터는 지금 `-f`를 쓰지 않는다.

**OpenCode 피커 UI**
- TUI: 입력칸 위 최대 10줄, 선택 줄은 primary 배경, 아이콘 없음, 파일명 가운데 생략, 키 ↑↓·Ctrl+P/N·
  Enter·Tab(디렉토리면 파고듦)·Esc. 고르면 `@name `이 글자로 들어가고 색 extmark가 씌워진다.
- Desktop: 입력칸 위 팝오버(`max-h-80`), **그룹**(reference → agent → resource → recent → file),
  파일 줄 = 파일 아이콘 + 흐린 디렉토리 + 파일명, agent는 brain 아이콘. 고르면 `contenteditable=false`
  알약. 미리보기 없음. Desktop 2.0.18 화면 캡처는 아직 없다(1.18.30 소스로 추정).

## one-desk에서 부딪히는 것

- 피커는 `popover` + CSS anchor positioning이다(CLAUDE.md). 범용 피커로 넓혀야 한다.
- 파일 목록 통로가 새로 필요하다 — **렌더러가 경로를 넘기면 안 된다**(`readBody`·`reveal.ts` 원칙).
  repo id + 질의를 받고 core가 그 repo 루트 밖을 거부한다.
- 맥락은 `ContextItemType = repo|issue|memo|asset`이고 `run_context_item.item_type`도 같은 enum이다.
  파일을 기록에 남기려면 종류와 마이그레이션이 는다.
- 입력은 `<textarea>`와 문자열 초안 스토어다. 알약(contenteditable)으로 가면 입력부와 초안·슬래시
  조립을 다시 짜야 한다.
- **권한:** claude가 `@`를 스스로 펼치면 읽기 전용이 아닌 경로(예: `.env`)도 도구 권한 밖에서 읽힌다.

## 결정할 것 (spec 전에)

1. 실어 보내는 방식 — (a) 글자로 두고 CLI에 맡김(opencode는 안 펼침) / (b) 앱이 해석해 claude는 글자,
   opencode는 `-f` / (c) 앱이 파일을 읽어 맥락 블록으로 직접 실음(두 CLI 같음, 기록 가능).
2. run 기록에 파일 참조를 남길지(남기면 `'file'` 종류 + 마이그레이션).
3. 검색 범위 — 지금 작업 디렉토리(repo) 하나 / workspace의 모든 repo. `.gitignore`를 따를지.
4. `@agent` — opencode만 뜻이 있다. 넣을지.
5. `!` 셸 — 헤드리스 대응이 없다. 뺄지.
6. 삽입 모양 — 글자(TUI) / 알약(Desktop).
7. 줄 범위 `#10-20`·디렉토리 참조 지원 여부.
8. "UI 그대로"의 기준 — TUI / Desktop.
