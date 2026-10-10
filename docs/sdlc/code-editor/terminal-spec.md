# Spec: 코드 칸 — 터미널 (2/3)

- Intent: `docs/sdlc/code-editor/intent.md` (승인 2026-10-09)
- 앞 사이클: `spec.md` · `plan.md` (틀과 파일 칸, 구현 완료 — 칸의 틀·제목 줄 버튼·대상 repo 판정을 그대로 쓴다)
- 작성자: 권용현 (초안: Claude)
- 상태: 승인 (2026-10-10, 사용자 — 직전 답의 "이대로 승인하시면 plan을 쓰겠습니다."를 그대로 보냄)
- 작성일: 2026-10-10
- 적용한 규칙: CLAUDE.md의 세 경계·색 토큰·아이콘·e2e 이름 충돌, Windows 트리 종료(`taskkill /T /F`, 앱 종료 경로는 동기),
  창이 여럿일 때 push는 앱 창에만(item-windows FR-17), 렌더러가 경로를 넘기는 통로를 만들지 않는다(`core/app/reveal.ts`·파일 칸)

intent가 정한 세 칸 중 둘째다(사이클 순서는 2026-10-10에 사용자가 바꿨다 — 변경사항이 셋째). 첫 사이클이 만든 오른쪽 칸과 제목 줄
버튼 줄에 **터미널**을 한 종류로 더한다.

## 0. 사용자가 정한 것 (2026-10-10)

| 질문 | 답 |
|---|---|
| 자리 | **파일과 같은 칸, 번갈아** — 오른쪽 칸 하나에 한 종류씩. 제목 줄의 `터미널`을 누르면 칸이 터미널로 바뀌고, 셸은 보이지 않는 동안에도 돈다 |
| 개수 | **repo당 하나** — 칸은 지금 대상 repo의 셸 하나를 보인다. 다른 repo로 옮기면 그 repo의 셸로 바뀌고 앞 셸은 뒤에서 계속 돈다 |
| 셸 | **설정에서 고르기** — 앱 탭에 셸 경로 칸, 비면 기본값(Windows는 PowerShell) |
| 버튼 자리 | 제목 줄, `파일` 왼쪽 (첫 사이클의 FR-1을 따른다) |

## 1. 요약

제목 줄의 `터미널` 아이콘을 누르면 오른쪽 칸이 그 대화 repo의 셸이 된다. 명령을 치고(`pnpm test`, `git status`) 결과를
본다. 셸은 repo마다 하나이고, 칸을 닫거나 다른 repo로 옮기거나 인박스에 다녀와도 계속 돈다 — 돌아오면 출력이 그대로다. 앱을
끄면 셸과 셸이 띄운 프로세스(dev 서버 등)가 전부 끝난다.

**의사 터미널(pty)이 필요해 네이티브 모듈이 하나 는다** — `node-pty` 1.1.0. N-API 사전 빌드(Windows x64·arm64, macOS)를 품고
있어 Windows에서는 컴파일하지 않고, Electron을 올려도 다시 빌드하지 않는다(2026-10-10 tarball 확인). 화면은 `@xterm/xterm`
6.0.0이다(둘 다 2025-12-22 출시).

## 2. 기능 요구사항

### (A) 버튼과 칸

- **FR-1** 제목 줄 버튼 줄의 `파일` 왼쪽에 `터미널` 아이콘(`>_`, 새 아이콘 `IconTerminal`)이 선다. 규칙은 `파일`과 같다 — 아이콘뿐,
  이름은 `aria-label` `터미널`, 눌림은 `aria-pressed`, 대상이 없으면 `aria-disabled` + `title`이 이유를 말한다. 풍선은 `터미널 — <repo>`.
- **FR-2** 칸의 종류가 둘이 된다(`PaneKind` = `files` | `terminal`). **한 번에 하나다**(첫 사이클 FR-3). 열린 종류의 버튼을 다시
  누르면 닫히고, 다른 종류를 누르면 칸이 그 종류로 바뀐다. 칸의 자리·폭·경계·기억(열린 종류와 폭, 이 장비의 localStorage)은
  파일 칸과 같다 — 종류를 바꿔도 폭은 그대로다.
- **FR-3** 대상 repo는 파일 칸과 **같은 판정**이다(`paneTarget` — 이어 가는 대화는 뿌리 cwd, 새 대화는 작업 디렉토리 알약). 셸의
  작업 디렉토리는 그 repo의 경로다. **git이 아니어도 된다** — 파일 칸과 다르다(셸은 목록이 필요 없다).
- **FR-4** 파일 칸에서 터미널로 바꿔도 파일 칸의 고친 글은 그대로다(버퍼 스토어가 쥔다 — 첫 사이클 FR-20). 터미널로 바꾼다고
  저장을 묻지 않는다.

### (B) 셸의 수명

- **FR-5** 셸은 **repo당 하나**이고, 칸이 그 repo의 터미널을 **처음 보일 때** 뜬다. 앱을 켜는 것만으로는 아무 셸도 뜨지 않는다.
- **FR-6** 셸은 칸을 닫아도, 다른 repo로 옮겨도, 인박스·설정에 다녀와도 **계속 돈다**. core가 셸마다 최근 출력을 쥐고(상한
  512 KiB — 넘으면 앞에서부터 버린다) 칸이 다시 붙을 때 넘기므로, 돌아오면 그때까지의 출력이 그대로 보인다.
- **FR-7** 셸이 스스로 끝나면(`exit`, 셸이 죽음) 칸의 출력 아래에 `셸이 끝났습니다 (종료 코드 N)`과 `셸 다시 시작`이 선다.
  끝난 셸은 다시 시작하기 전까지 그대로 둔다(출력도).
- **FR-8** 칸 머리: repo 이름 · 셸 이름(`pwsh` 등, 전체 경로는 `title`) · `셸 다시 시작`(도는 셸을 **트리째** 끝내고 새로 띄운다 —
  두 번 누르기 `ConfirmButton`, 셸이 띄운 dev 서버까지 죽기 때문이다) · `코드 칸 닫기`(셸은 계속 돈다).
- **FR-9** **앱을 끄면 모든 셸을 트리째 끝낸다.** Windows는 `taskkill /PID <pid> /T /F`를 **기다린다**(동기) — agent 실행의
  `cancelAll`과 같은 이유다(비동기면 메인 프로세스가 먼저 끝나 손자 프로세스가 남는다, CLAUDE.md). 다시 켜면 새로 시작한다 —
  출력은 메모리에만 있고 파일로 남기지 않는다.
- **FR-10** repo를 지우거나 경로를 바꾸면 그 repo의 셸을 트리째 끝낸다(옛 경로에서 계속 돌면 칸의 repo와 셸의 디렉토리가 갈린다).
  workspace를 지우면 그 아래 repo의 셸이 전부 끝난다.

### (C) 셸 고르기

- **FR-11** 설정의 **앱 탭**에 `터미널 셸` 절이 선다 — 경로 칸 하나와 저장(절마다 저장이 따로인 규칙 그대로). 저장은 `app_setting`의
  `terminal.shell` 키(마이그레이션 없음 — `agents.path.*`와 같은 키-값). 빈 칸이면 기본값이고, placeholder가 지금 무엇이 잡히는지
  말한다(`기본값: C:\Program Files\PowerShell\7\pwsh.exe`). 없는 파일을 저장하려 하면 거부한다.
- **FR-12** 기본값: Windows는 PATH의 `pwsh.exe`(PowerShell 7), 없으면 `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`.
  macOS·Linux는 `$SHELL`, 없으면 `/bin/bash`. 판정은 `core/runner/executable.ts`의 PATH 탐색을 쓴다.
- **FR-13** 셸에 붙이는 인자는 이름으로 정한다 — `bash`·`zsh`·`sh`·`fish`면 로그인 셸(`-l`, Git Bash는 `--login -i`), 그 밖(`pwsh`·
  `powershell`·`cmd`)은 인자 없음. 칸에서 인자를 넣을 수 없다.
- **FR-14** 셸을 바꾸면 **다음에 뜨는 셸부터** 적용된다. 도는 셸은 그대로이고, `셸 다시 시작`이 새 셸로 띄운다.

### (D) 입력과 화면

- **FR-15** 화면은 xterm.js(`@xterm/xterm` + `@xterm/addon-fit`)다. 칸의 폭·높이가 바뀌면 열·행을 다시 재고 셸에 알린다(pty
  resize). 스크롤백은 5,000줄. 글꼴은 `--font-mono`, 색은 토큰에서 읽는다(라이트·다크, 테마가 바뀌면 따라간다). 편집기처럼
  **지연 로드**한다 — 터미널을 열기 전에는 받지 않는다.
- **FR-16** 키: 터미널에 포커스가 있으면 키는 셸로 간다 — **Esc도** 앱(도크 최대화 풀기·열린 항목 닫기)에 가지 않는다(안쪽의 Esc는
  `preventDefault`+`stopPropagation`, CLAUDE.md의 Esc 규칙). Ctrl+C는 선택이 있으면 복사, 없으면 셸로(Windows Terminal과 같다).
  Ctrl+V는 붙여넣기다.
- **FR-17** 출력 속 링크를 누르는 것은 이번 범위 밖이다(xterm의 링크 추가 기능 — 다음에 넣으면 `externalLinkOf`를 통과한 http(s)만).

### (E) 경계와 보안

- **FR-18** 렌더러는 **repo id만** 넘긴다 — 작업 디렉토리·셸 경로·실행할 명령을 렌더러가 정하지 못한다(파일 칸·`reveal`과 같은 원칙).
  셸 경로는 core가 설정에서 읽고, repo 경로는 core가 그 workspace의 repo에서 찾는다. 셸에 키 입력을 쓰는 통로(`write`)는 셸 id로만
  받고, core가 만든 셸이 아니면 거부한다.
- **FR-19** 셸의 환경은 앱의 환경 그대로이고(Windows GUI 앱이 물려받은 사용자 환경 — CLAUDE.md의 환경변수 절) `TERM=xterm-256color`를
  더한다. 앱 내부 변수(`ONE_DESK_*`·`ELECTRON_*`)는 뺀다 — 셸에서 띄운 `electron`·`claude`가 그것을 받아 엉뚱하게 돌지 않게.
- **FR-20** 출력은 **앱 창에만** push한다(item-windows FR-17 — 패널 창에는 터미널이 없다). 셸이 많이 쏟아낼 때 IPC가 밀리지
  않게 16ms마다 모아서 보낸다.
- **FR-21** pty는 core에 있고 `node-pty`는 **주입**한다(`CoreOptions`의 필수 인자) — core 단위 테스트는 가짜 pty로 돌고, 진짜
  `node-pty`는 electron 메인이 넘긴다(`core/`가 `electron`을 import하지 않는 경계는 그대로, `node-pty`는 electron이 아니지만
  네이티브라 테스트에서 떼어 둔다).

### (F) agent와의 관계

- **FR-22** agent는 이 터미널을 읽지도 쓰지도 않는다(intent의 가정 — 이번엔 아니다). 터미널 출력은 맥락에 담기지 않는다.

## 3. 바뀌는 자리

| 자리 | 지금 | 바뀜 |
|---|---|---|
| `core/terminal/` (새) | — | 셸 서비스(열기·쓰기·크기·다시 시작·끝내기·전부 끝내기), 출력 버퍼, 셸 해석(설정 > 기본값, 인자 규칙) |
| `core/index.ts` | `shutdown`이 agent를 끝낸다 | `CoreOptions.spawnPty`(필수) 주입, `shutdown`에 모든 셸 트리 종료, repo 삭제·경로 변경·workspace 삭제에 그 셸 종료, `terminal.shell` 설정 |
| `shared/models.ts`·`client.ts`·`channels.ts`, `electron/preload.ts`·`electron/ipc/terminal.ts` (새) | — | `terminal.open`·`write`·`resize`·`restart`·`close`, push `terminal:data`·`terminal:exit`. 핸들러는 core 호출 한 줄씩(경계 3) |
| `electron/main.ts` | — | `node-pty`의 `spawn`을 core에 넘긴다 |
| `renderer/code/layout.ts` | `PaneKind = 'files'` | `'files' \| 'terminal'` |
| `Dock` | 칸 상태 · 버튼 하나 | 버튼 둘, 종류 전환 |
| `renderer/components/code/TerminalPane.tsx` (새) | — | 칸 머리 + xterm(지연 로드), 출력 붙이기·크기·키 |
| `SettingsPanel` 앱 탭 | CLI 기본 경로 · 글로벌 asset 경로 · 동시 실행 상한 | `터미널 셸` 절 |
| `icons.tsx` | — | `IconTerminal` |
| 의존성 | `better-sqlite3` 하나가 네이티브 | `node-pty` 1.1.0(dependencies — 패키징에 실린다), `@xterm/xterm` 6.0.0 · `@xterm/addon-fit` 0.11.0(devDependencies — 렌더러 번들) |
| 패키징 | `asarUnpack`에 better-sqlite3 | `node-pty`도 asar 밖(`.node`·`conpty.dll`·`OpenConsole.exe`). `pnpm.onlyBuiltDependencies`에 `node-pty`(설치 스크립트가 사전 빌드를 고른다) |

스키마·마이그레이션 없음. MCP 없음. 창 가드는 그대로다.

## 4. 우려

1. **네이티브 모듈이 하나 는다.** 사전 빌드라 Windows에서 컴파일은 없지만, asar 밖에 두는 것(`asarUnpack`)과 릴리스 산출물(portable
   exe)에서 셸이 실제로 뜨는지는 **패키징한 앱으로만** 확인된다. plan에서 `pnpm run pack` 산출물을 띄워 본다. CI의 `pnpm install`은
   설치 스크립트가 사전 빌드를 고르므로 VS 빌드 도구를 새로 요구하지 않는다(실패하면 `node-gyp rebuild`로 떨어진다 — 그때는 지금
   better-sqlite3와 같은 조건이다).
2. **터미널은 임의 명령을 실행하는 통로다.** 렌더러가 오염되면(마크다운 렌더링 구멍 같은 것) 셸에 키를 쓸 수 있다. 위험의 크기는 이미 있는
   `runs.start({ permission: 'full' })`과 같다 — 새 구멍이 아니라 같은 구멍의 다른 입구다. 막는 것은 지금처럼 렌더러의 입력 가드다
   (마크다운 규칙·탐색 가드). FR-18이 렌더러가 명령·경로를 고르지 못하게 하지만 키 입력은 본질상 막을 수 없다.
3. **pty가 메인 프로세스에 산다.** VS Code는 별도 프로세스(pty host)에 둔다. 출력 폭주(빌드 로그)가 메인을 바쁘게 하면 IPC와 MCP
   서버가 같이 느려진다 — 16ms 모아 보내기와 버퍼 상한으로 줄인다. 실제로 막히면 별도 프로세스로 떼는 것이 다음 단계다.
4. **셸이 띄운 dev 서버는 칸을 닫아도 돈다** — 의도다(FR-6). 앱을 끄면 죽는다(FR-9). 어디서 돌고 있는지 보여주는 표시(제목 줄 아이콘의
   점 등)는 이번 범위 밖이다.
5. macOS 사전 빌드의 `spawn-helper`는 설치 과정에서 실행 권한을 잃는 알려진 문제가 있다 — macOS 산출물은 CI에서 만들지 않으므로
   개발 장비에서 처음 쓸 때 확인한다.
6. 번들: xterm은 지연 로드 조각으로 나가 첫 JS는 늘지 않는다(편집기와 같은 방식). 조각 크기는 plan에서 잰다.

## 5. 검증

- 단위(core, 가짜 pty): repo당 하나 · 다시 붙으면 버퍼를 준다 · 버퍼 상한 · 셸이 끝나면 알리고 다시 시작 · `셸 다시 시작`과 앱 종료가
  트리째 끝낸다(Windows는 동기) · repo 삭제·경로 변경·workspace 삭제가 그 셸을 끝낸다 · 모르는 셸 id에 쓰기는 거부 · 셸 해석(설정 >
  기본값, 인자 규칙, `platform` 인자로 Windows·posix 둘 다) · 환경에서 앱 내부 변수를 뺀다.
- 단위(renderer): `Dock`(버튼 둘 · 종류 전환 · 같은 종류 다시 누르면 닫힘 · 대상 없으면 비활성), `TerminalPane`(xterm은 jsdom에서
  그릴 수 없으므로 편집기처럼 대역 — 붙이기·끝남·다시 시작·Esc를 삼킴), 설정 앱 탭(저장·빈 칸 = 기본값·placeholder), App 배선.
- e2e(진짜 셸): 터미널을 열어 `echo`의 출력이 보인다 · 다른 repo로 옮겼다 돌아오면 출력이 남아 있다 · 파일 칸으로 바꿨다 돌아와도 같은
  셸이다 · `셸 다시 시작` · 설정에서 셸 경로를 바꾸면 다음 셸이 그것이다. 앱을 끄면 셸이 띄운 자식 프로세스가 남지 않는다(pid로 확인).
- 패키징: `pnpm run pack` 산출물에서 터미널이 뜬다.
- 실제 앱 캡처(라이트·다크).
