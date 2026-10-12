# Intent: WSL2 안의 repo를 WSL 안의 claude로 돌린다

- 출처: 대화 (2026-10-12)
- 작성자: 권용현 (초안: Claude)
- 상태: 승인 (2026-10-12, 사용자 — "승인, 가정 그대로 spec 써 줘")

## 정해진 것 (2026-10-12, 사용자)

- **사용자들이 원하는 것은 "WSL 안의 claude로 도는 것"이다** — WSL 폴더를 Windows의 `claude.exe`로 건드리는
  것이 아니다.
- **repo마다 설정에서 고른다** — 그 repo의 claude를 Windows의 것으로 쓸지, WSL 안의 것으로 쓸지.
- **코드 수정은 WSL 경로의 폴더에서 일어난다.** agent가 Linux 경로에서 직접 고친다.
- **이슈·메모(대화·run 기록도)는 one-desk의 DB다** — 지금처럼 Windows `userData`에 있고 바뀌지 않는다.
- **skills/agents는 WSL 환경의 것이다** — repo 안의 `.claude/skills`는 repo와 함께 WSL 안에 있고, 글로벌
  `~/.claude/skills`도 WSL 홈의 것이다.

## 문제

one-desk는 Windows 앱이고 사용자의 상당수가 코드는 WSL2 안에 둔다 — 도구체인(node·python·git·claude 로그인)이
전부 Linux 쪽에 있다. 지금 one-desk는 그 repo를 다룰 수 없다.

등록은 된다. repo 경로 검사가 `statSync(...).isDirectory()`뿐이라 `\\wsl.localhost\Ubuntu\home\me\proj` 같은 UNC
경로가 통과한다. 그러나 그 뒤에 뜨는 프로세스는 **전부 Windows 프로세스가 UNC 경로를 cwd로 받아 도는 것**이다.

- agent는 WSL 안의 claude가 아니라 Windows의 `claude.exe`다. 로그인·`~/.claude`·Bedrock 환경변수가 Windows
  쪽에 따로 있어야 하고, repo의 훅·스크립트가 Linux 전제면 거기서 어긋난다.
- git도 Windows git이다. 9P 파일시스템 위라 느리고, 소유자가 달라 `dubious ownership`으로 `git ls-files`가
  거부될 수 있다 — 그러면 `@` 피커·파일 칸·코드 칸이 전부 빈다.
- 터미널은 pwsh가 UNC cwd에서 뜬다. Windows 셸이다.
- 글로벌 skill 경로는 앱 탭에 한 벌뿐이고 Windows 홈 기준이라 WSL 홈의 `~/.claude/skills`를 보지 않는다.

즉 "WSL 폴더를 본다"는 어설프게 되고 "WSL 안의 claude로 돌린다"는 아예 안 된다.

## 원하는 결과

repo 설정에 **claude 실행 환경** 선택 하나(`Windows` | `WSL — <distro>`)가 있고, WSL을 고른 repo는

- agent(claude)가 **그 distro 안에서** 그 repo의 Linux 경로를 cwd로 뜬다 — 로그인·설정·환경변수·훅 전부 WSL
  쪽 claude의 것이다.
- 설정 화면의 CLI 상태(실행 파일 → 인증 → 모델)·슬래시 커맨드 목록·모델 probe도 WSL 안의 claude가 답한다.
- MCP 도구(이슈·메모 읽기/쓰기)가 지금처럼 동작한다 — agent는 WSL 안에 있고 DB는 Windows에 있다.
- 취소·앱 종료가 WSL 안의 agent와 그 자식 프로세스까지 끝낸다.
- git(`@` 피커·파일 칸)과 터미널도 같은 선택을 따른다 — WSL repo면 WSL git·WSL 셸. "셸은 Windows인데
  agent는 Linux"를 남기지 않는다.
- repo 안의 skill·agent 파일과 WSL 홈의 글로벌 skill이 목록에 오르고 맥락에 담긴다.
- 코드 칸에서 그 repo의 파일을 읽고 고칠 수 있다.

Windows를 고른 repo(기본값)는 지금과 똑같이 돈다. **이 기능으로 기존 사용자의 동작이 바뀌지 않는다.**

## 영향받는 것

- 사람: Windows에서 one-desk를 쓰되 코드와 도구체인을 WSL2에 두는 사용자.
- 데이터: `repo`에 실행 환경과 distro(마이그레이션 하나). 경로는 어느 표기로 저장하는지가 결정 사항이다(아래).
  이슈·메모·run은 그대로.
- 코드 — 프로세스를 띄우는 자리가 아홉 파일이다(`core/agent/exec.ts`·`core/commands/probe.ts`·`core/files/list.ts`·
  `core/index.ts`·`core/runner/adapters/opencode.ts`·`core/runner/manager.ts`·`core/runner/terminate.ts`·
  `core/terminal/service.ts`·`electron/main.ts`). agent 실행 파일을 spawn하는 자리는 이미 `agentCommand`
  (`core/runner/executable.ts`) 하나를 거치게 돼 있어, 그 자리가 "이 repo의 환경으로 감싼다"의 자연스러운
  이음매다. 그러나 `agentCommand`는 실행 파일만 알고 repo를 모른다 — 시그니처가 바뀐다.
  - 실행 파일 탐색(`findExecutable`·`PATHEXT`·`.cmd` 거부·npm 껍데기 벗기기)은 전부 Windows 규칙이다. WSL
    안에서는 `which`로 찾아야 하고 그 규칙들은 적용되지 않는다. CLI 경로 설정(앱 기본값·workspace 예외)도
    환경마다 뜻이 다르다.
  - MCP 브리지(`core/mcp/configFile.ts`)는 Electron 바이너리를 `ELECTRON_RUN_AS_NODE=1`로 띄운다. WSL 안에서는
    그것이 없다 — WSL의 node로 `bridge.mjs`를 띄워야 하고, 브리지가 Windows 쪽 `127.0.0.1:<port>`에 붙어야 한다.
  - 취소(`core/runner/terminate.ts`)는 `taskkill /T /F`다. `wsl.exe`를 죽이는 것이 안의 프로세스를 죽이는지는
    모른다. 앱 종료의 동기판(`taskkillTreeSync`)도 같다.
  - 파일 읽기/쓰기(`core/files/read.ts`, 코드 칸)와 asset 스캔은 Node `fs`다. UNC로 가면 동작은 하되 느리고,
    realpath 탈출 판정이 UNC에서 맞는지 봐야 한다. 대안(WSL 안에서 `cat`)은 바이트 보존(CRLF·BOM)이 번거롭다.
  - 글로벌 asset 경로(`assets.globalRoots.claude`)가 환경마다 한 벌 더 필요하다.
  - 대화의 repo 판정(`repoOfCwd` — 뿌리 턴의 cwd와 repo 경로 비교)은 cwd가 Linux 경로로 기록되면 표기가 갈린다.
- 화면: repo 탭(실행 환경 선택), 앱 탭(WSL 글로벌 경로), 실행 탭의 CLI 상태, 작업 디렉토리 알약의 경로 표기.

## 제약

- 세 경계(`core/`는 electron 없음 · renderer는 core 없음 · IPC는 얇다)를 지킨다.
- **`agentCommand`를 거치지 않는 spawn을 만들지 않는다** — 그 함수의 주석이 요구하는 규칙이고, 환경 감싸기가
  한 자리라도 빠지면 그 경로만 조용히 Windows에서 돈다.
- 권한 정책(`--tools`·`--allowedTools`·`OPENCODE_PERMISSION`)은 환경과 무관하게 같아야 한다. WSL이라고 느슨해지면
  안 된다.
- 개발 장비는 macOS·Windows다. WSL 갈래는 **플랫폼과 래퍼를 인자로 주입**해 다른 OS에서도 단위 테스트로
  보고(`core/runner/terminate.ts`가 하는 방식), 실제 WSL은 e2e가 아니라 실측 기록으로 남긴다 — CI 러너에 WSL이
  없다.
- 이 기능은 opencode를 다루지 않는다 — 선택지는 claude만이고 opencode는 Windows 그대로다. (가정 — 아래 질문)

## 미해결 질문

- **MCP 브리지가 WSL 안에서 Windows 쪽 포트에 붙는가.** WSL2의 기본 NAT 네트워킹에서 Linux의 `127.0.0.1`은
  Windows가 아니다. 호스트 IP(`/etc/resolv.conf`의 nameserver)로 가거나 mirrored 네트워킹이 필요할 수 있고,
  그러면 MCP 서버가 `127.0.0.1`에만 묶인 것(전체 설계)을 손대야 한다. **실측 1순위 — 안 되면 설계가 바뀐다.**
- **`taskkill`이 `wsl.exe` 안의 프로세스를 끝내는가.** 안 되면 `wsl.exe -d <distro> -- kill` 경로가 따로 필요하다.
  실측 2순위.
- 경로를 어느 표기로 저장하나. (가정: **Linux 경로**(`/home/me/proj`)를 `repo.path`에 두고 UNC는 파일 접근 때
  파생한다 — 사용자가 보는 것과 agent의 cwd가 같아야 한다)
- 파일 읽기/쓰기·asset 스캔은 UNC로 가나, WSL 안에서 하나. (가정: **UNC** — 바이트 보존이 쉽고 코드가 그대로다.
  느린 것은 감수)
- git·터미널도 WSL을 따르는 것이 맞나, 아니면 agent만인가. (가정: **따른다** — 위 "원하는 결과")
- opencode도 같은 선택지를 주나. (가정: **이번에는 claude만** — opencode는 사용자가 없다)
- 실행 환경을 repo가 아니라 workspace에 두는 것이 맞지 않나. (가정: **repo** — 사용자가 그렇게 말했고, 한
  workspace에 Windows repo와 WSL repo가 섞일 수 있다)
- distro 목록은 어디서 오나. (가정: `wsl.exe --list --quiet`로 읽어 드롭다운, 없으면 자유 입력)
