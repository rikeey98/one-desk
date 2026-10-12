# Spec: WSL2 안의 repo를 WSL 안의 claude로 돌린다

- Intent: `docs/sdlc/wsl-support/intent.md` (승인 2026-10-12, 가정 그대로)
- 작성자: 권용현 (초안: Claude)
- 상태: 승인 (2026-10-12, 사용자 — "승인, UNC 저장으로 가고 plan 써 줘". §0의 경로 표기는 UNC 저장으로 확정)
- 개정: 2026-10-12 첫 실측(§4-B) — `wsl.exe`의 구분자를 `--`에서 `--exec`로(FR-8·FR-33, 사용자 승인 "응 진행해줘")
- 작성일: 2026-10-12
- 적용한 규칙: CLAUDE.md의 세 경계 · `agentCommand`를 거치지 않는 spawn을 만들지 않는다 · 렌더러가 경로·명령을 정하지
  못한다(`reveal`·파일 칸·터미널 FR-18) · Windows 트리 종료(앱 종료 경로는 동기) · `checkAgents`는 실행과 같은 판정 ·
  `core/`는 `os.homedir()`를 부르지 않는다 · 설계 결정을 코드에서 바꾸지 않는다

## 0. intent의 가정과 spec이 바꾼 것

intent의 가정을 그대로 받되, 코드를 읽으니 **가정 하나는 뒤집는 쪽이 훨씬 단순했다.** 아래 표의 첫 줄이 그것이다 —
승인하면서 같이 정해 주면 된다. 나머지는 가정 그대로다.

| 질문 | intent의 가정 | spec |
|---|---|---|
| 경로 표기 | Linux 경로(`/home/me/proj`)를 `repo.path`에 두고 UNC는 파생 | **UNC(`\\wsl$\<distro>\home\me\proj`)를 `repo.path`에 두고 Linux 경로와 distro를 파생** (§2-A, 이유는 바로 아래) |
| 파일 읽기/쓰기·asset 스캔 | UNC로 Node `fs` | 그대로 — UNC를 저장하니 **코드 변경이 없다** |
| git·터미널 | WSL을 따른다 | 그대로 |
| opencode | claude만 | 그대로 — WSL repo에서 opencode를 고르면 막는다(FR-7) |
| 범위 | repo | 그대로 — `repo.agent_env` 컬럼 하나 |
| distro 목록 | `wsl.exe --list --quiet` | 그대로 — 단 그 출력은 UTF-16LE다(FR-4) |
| MCP 브리지 | WSL 안에서 Windows 포트로 (실측 1순위) | **브리지는 Windows에 남긴다** — claude가 WSL interop으로 Windows 실행 파일을 띄운다(§2-D). 네트워크를 건너지 않으므로 intent의 실측 1순위가 사라지고 다른 실측 하나로 바뀐다(§4의 1) |

**UNC를 저장하는 이유.** `repo.path`는 `statSync`로 검증되고, asset `file_path`의 접두사이고, `run.cwd`로 기록돼
`repoOfCwd`가 비교하고, 폴더 선택 대화상자가 돌려주는 값이다. 넷 다 **Windows 파일시스템이 읽을 수 있는 경로**를
전제하는데 UNC가 바로 그것이다 — 저장하면 파일 칸·asset 스캔·`moveAssetPathPrefix`·`repoOfCwd`·폴더 선택이 **한 줄도
안 바뀐다.** Linux 경로를 저장하면 그 다섯 자리마다 "WSL repo면 UNC로 바꿔 읽는다"가 들어가고, 글로벌 asset(repo가
없다)은 distro를 어디서 가져올지가 따로 필요하다. Linux 경로는 UNC에서 결정적으로 나온다(`\\wsl$\<distro>\a\b` →
distro `<distro>`, `/a/b`) — 반대도 그렇지만 저장은 한쪽이어야 하고, 읽는 자리가 많은 쪽을 저장한다. 사용자가 보는
경로가 UNC인 것은 화면에서 Linux 경로를 **같이** 보여 메운다(FR-6).

## 1. 요약

repo 탭에 **claude 실행 환경** 선택 하나가 생긴다 — `Windows`(기본) | `WSL`. WSL을 고른 repo는 경로가
`\\wsl$\<distro>\…`여야 하고, 그 repo의 **모든 프로세스**(claude 실행 · 슬래시 커맨드 probe · CLI 상태 · git ls-files ·
터미널 셸)가 `wsl.exe -d <distro>`로 그 distro 안에서 뜬다. 파일 읽기/쓰기·asset 스캔은 지금처럼 Windows가 UNC로 한다.
MCP는 지금 구조 그대로다 — 브리지는 Windows 프로세스이고, WSL 안의 claude가 interop으로 그것을 자식으로 띄운다.
이슈·메모·대화는 바뀌지 않는다. Windows repo(기본값)는 **아무것도 바뀌지 않는다.**

한 줄로: **"이 repo의 프로세스는 어디서 뜨나"를 repo가 말하고, 프로세스를 띄우는 자리는 전부 그 답을 묻는다.**

## 2. 기능 요구사항

### (A) repo의 실행 환경

- **FR-1** `repo`에 `agent_env TEXT NOT NULL DEFAULT 'host'` 컬럼이 는다(마이그레이션 `0011`, 백필 없음 — 기본값이
  곧 지금 동작). 값은 `host` | `wsl`. `Repo.agentEnv`로 IPC에 나간다.
- **FR-2** `agentEnv = 'wsl'`인 repo의 `path`는 **`\\wsl$\<distro>\<linux 경로>` 또는 `\\wsl.localhost\<distro>\…`**여야
  한다. 등록·수정에서 core가 검증한다(`core/wsl/path.ts`의 순수 함수 `parseWslPath` — distro와 Linux 경로를 돌려주거나
  null). 모양이 아니면 거부한다: `WSL repo의 경로는 \\wsl$\<배포판>\… 이어야 합니다`. 존재 검사(`statSync`)는 지금처럼
  한다 — UNC도 Windows 경로다. `host`인 repo에 UNC 경로를 넣는 것은 막지 않는다(지금도 된다 — 다만 FR-6의 안내가 선다).
- **FR-3** `agentEnv`는 `repo.update`로 바꾼다(`UpdateRepoInput.agentEnv?`). **환경이 바뀌면 그 repo의 터미널 셸을 트리째
  끝낸다**(경로 변경과 같은 이유 — 터미널 FR-10) 그리고 그 repo cwd의 슬래시 커맨드 캐시·agent 정보 캐시를 비운다
  (환경이 다르면 다른 claude다). 도는 run은 그대로 끝까지 돈다(시작할 때의 환경).
- **FR-4** distro 목록은 `wsl.exe --list --quiet`다(`core.wsl.listDistros`, 결과 캐시 없음 — 설정 화면을 열 때마다).
  **출력이 UTF-16LE다** — 바이트를 그대로 `utf8`로 읽으면 글자 사이에 NUL이 끼어 아무 이름도 맞지 않는다. `wsl.exe`가
  없거나(Windows가 아니다, WSL 미설치) 실패하면 빈 목록 + 이유. macOS·Linux에서는 `agentEnv = 'wsl'`을 **저장도
  거부한다**(`WSL은 Windows에서만 쓸 수 있습니다`).
- **FR-5** `CreateRepoInput.agentEnv?`(기본 `host`). repo 등록 폼은 그대로다 — 환경은 등록 뒤 repo 탭에서 바꾼다(폼에
  선택지를 더하지 않는다. 등록 폼은 사이드바의 좁은 칸이다).
- **FR-6** 화면(repo 탭): repo마다 `claude 실행 환경` 라디오(`Windows` · `WSL`)가 이름·경로·설명 아래에 선다. WSL을 고르면
  경로 칸 밑에 `배포판 <distro> · <linux 경로>`가 서고(파싱 결과 — 모양이 아니면 그 자리에 거부 문구), 목록의 distro에 없는
  이름이면 경고 한 줄(`이 배포판이 wsl --list에 없습니다`)이되 저장은 막지 않는다(distro가 잠시 꺼져 있을 수 있다). `host`인
  repo의 경로가 `\\wsl$\`로 시작하면 안내 한 줄: `WSL 폴더입니다 — Windows의 claude가 이 경로에서 돕니다. WSL 안의 claude를
  쓰려면 실행 환경을 바꾸세요`. 저장은 지금의 repo 줄 저장 버튼 하나다(`<이름> 저장`).
- **FR-7** WSL repo에서 agent를 `opencode`로 고르면 **실행 전에 막는다** — `verifyRunnable` 전, preflight 자리에서
  `WSL repo에서는 OpenCode를 아직 쓸 수 없습니다`. 실행 패널의 agent 드롭다운은 그 옵션을 `disabled`로 두고 `title`이
  같은 말을 한다. workspace 기본 agent가 opencode여도 WSL repo를 고르면 claude로 떨어진다(저장하지 않는다 — 그 run만).

### (B) 프로세스는 어디서 뜨나 — 이음매 하나

- **FR-8** `core/wsl/launch.ts`의 순수 함수 `wrapForEnv(env: ProcessEnvSpec, cmd, args, cwd)`가 **spawn 직전의 마지막
  변환**이다. `host`면 그대로(`agentCommand`가 하던 것 그대로 — 런처 포함), `wsl`이면
  `wsl.exe -d <distro> --cd <linux cwd> --exec /bin/sh <launcher.sh> <pidfile> <linux cmd> <args…>`다. `ProcessEnvSpec`은
  `{ kind: 'host' } | { kind: 'wsl'; distro: string }`이고 **repo에서만 나온다**(`envOfRepo(repo)`).
  **구분자는 `--`가 아니라 `--exec`다**(개정 2026-10-12 — §4-B). wsl.exe는 `--` 뒤의 명령줄을 기본 셸에 `bash -c` 문자열로
  넘겨 인자 배열이 셸 문법이 된다 — Windows 경로의 `\`가 이스케이프로 먹히고 `$(…)`가 실행된다. `--exec`만 셸 없이 argv를
  그대로 넘긴다. 그래서 안쪽 명령은 실행 파일이어야 하고(`kill`은 `/usr/bin/kill`), 셸이 필요한 자리는 `sh -c`·`bash -lc`를
  명시한다(FR-12·FR-27·FR-29 — 코드는 셋 다 이미 그랬다). 이 문서의 다른 자리에 적힌 `wsl.exe -d <distro> --exec …`도 같은 개정이다.
- **FR-9** `agentCommand`가 `ProcessEnvSpec`을 **필수 인자**로 받게 바뀐다(`agentCommand(env, executable, args)`). 선택
  인자로 두면 한 호출 자리만 빠뜨려도 그 경로가 조용히 Windows에서 돈다 — `resolveAgentPath`가 앱 기본 경로를 필수로
  받는 것과 같은 이유. 호출 자리는 넷이다: run(`manager.ts`), 슬래시 커맨드 probe(`commands/probe.ts`), CLI 한 번
  띄우기(`agent/exec.ts` — `auth status`·`models`), opencode 설정 확인(`adapters/opencode.ts` — WSL에서는 FR-7로
  오지 않는다). **`git ls-files`(`files/list.ts`)와 터미널 pty도 같은 함수를 탄다** — 그 둘은 `agentCommand`를 안 거치던
  자리라 새로 거치게 한다.
- **FR-10** 런처 `core/wsl/launcher.sh`(extraResources — 브리지와 같은 이유로 번들하지 않는다)는 두 가지만 한다:
  **새 프로세스 그룹**을 만들고(`setsid`), 그 그룹 id를 `<pidfile>`에 쓴 뒤 **로그인 셸을 거쳐** 명령을 `exec`한다
  (`exec bash -lc 'exec "$0" "$@"' <cmd> <args…>` — `-l`이 `~/.profile`의 PATH·환경변수를 읽고, 인자는 셸 문자열에
  끼워 넣지 않아 인용 문제가 없다). 셸은 `bash`로 고정한다(`$SHELL`이 fish·zsh면 문법이 다르다 — bash는 모든 distro에
  있다). **stdin·stdout·stderr는 건드리지 않는다** — `wsl.exe`가 파이프를 그대로 잇고 claude의 JSON 스트림이 그 위로
  흐른다(`wsl.exe`는 자식 명령의 stdout에 UTF-16 변환을 하지 않는다 — 그것은 `--list` 같은 자기 출력뿐이다. §4의 2).
- **FR-11** `<pidfile>`은 Windows 쪽 `<userData>/wsl/<runId | 'term-' + repoId>.pid`를 Linux 경로로 옮긴 것이다
  (`/mnt/c/Users/…`). Windows 경로 → Linux 경로 변환은 `wsl.exe -d <distro> --exec wslpath -a -u <path>`로 하되
  **distro마다 `userData` 하나를 한 번만 묻고** 그 아래는 접두사로 만든다(`core/wsl/paths.ts`, 캐시 — automount 루트가
  `/mnt`가 아닌 설정을 따른다). 못 묻으면(wslpath 실패) 그 run은 시작 전에 실패다(`WSL 경로를 변환하지 못했습니다`).
- **FR-12** WSL 쪽 claude의 실행 파일은 **Linux 경로**다. 해석 순서는 지금과 평행하되 자리가 다르다: `ONE_DESK_AGENT_PATH`
  (테스트 이음매 — WSL에서도 그 값을 그대로 쓴다) → **앱 탭의 `WSL claude 경로`**(`app_setting`의 `agents.path.claude.wsl`,
  비면 다음) → `bash -lc 'command -v claude'`의 결과. workspace 예외(`claude_path`)는 Windows 경로라 WSL에는 쓰지 않는다
  (실행 탭의 그 칸은 WSL repo에 적용되지 않는다고 placeholder가 말한다). 탐색 결과는 (distro, 설정값)으로 캐시하고 `다시
  확인`이 비운다. **`PATHEXT`·`.cmd` 거부·npm 껍데기 벗기기는 WSL 갈래에 없다** — Linux에는 그 개념이 없다.
- **FR-13** preflight(claude)의 WSL 갈래는 `wsl.exe -d <distro> --exec test -x <경로>`다(없으면 `실행 파일이 없습니다
  (<distro>): <경로>`). `checkAgents`가 이 판정을 그대로 쓴다 — 실행과 같은 길(CLAUDE.md). **`checkAgents`·`probeAgents`는
  workspace 단위라 repo마다 환경이 다를 수 있다** — 결과가 `AgentStatuses`에서 `{ host: …, wsl?: { distro, … } }`로
  넓어지고, `wsl` 칸은 그 workspace에 WSL repo가 있을 때만 있으며 **첫 WSL repo의 distro**로 판정한다(두 distro를 섞은
  workspace는 둘째를 보여주지 않는다 — §4의 5). 실행 탭의 CLI 상태가 그만큼 한 줄 더 선다: `claude (WSL · Ubuntu)`.
- **FR-14** 인증(`auth status`)·모델 목록·슬래시 커맨드 probe·agent 정보(`init`)는 전부 FR-9의 이음매를 타므로 WSL
  claude의 답이다. **캐시 키에 환경이 들어간다** — 커맨드 캐시는 cwd가 키인데 cwd(UNC)는 환경을 바꿔도 같다. FR-3이
  환경을 바꿀 때 비우는 것으로 지킨다.

### (C) 실행

- **FR-15** run의 `cwd`는 지금처럼 `repo.path`(UNC)를 기록한다. spawn할 때 FR-8이 Linux 경로로 `--cd`한다. `repoOfCwd`·
  도크 구획·코드 칸의 대상 판정은 **바뀌지 않는다.** 작업 디렉토리 알약의 `title`과 `작업 디렉토리 경로 복사`는 UNC
  그대로다(Windows에서 붙여 넣어 열리는 경로).
- **FR-16** `--mcp-config <파일>`·`--resume <세션>`·권한 플래그·`--tools`·`--allowedTools`·`--effort`는 **환경과 무관하게
  같다.** 설정 파일 경로만 Linux 경로로 바꿔 넘긴다(FR-11의 변환). 권한 정책이 환경에 따라 달라지면 안 된다 —
  `permission.test`의 단언이 WSL 갈래의 인자에도 돈다.
- **FR-17** 환경변수: `wsl.exe`에 주는 env는 지금의 `built.env`(`withLoopbackBypass` 포함)이지만 **그것은 wsl.exe의
  환경이지 claude의 환경이 아니다.** claude의 환경은 WSL 쪽 로그인 셸(FR-10)이 만든다 — Bedrock 변수·프록시는 WSL의
  `~/.profile`·`/etc/environment`에 있어야 한다. `WSLENV`로 Windows 변수를 넘기지 않는다(어느 변수를 넘길지 앱이 정하면
  사용자가 WSL 쪽에 둔 값과 겹쳐 어느 쪽이 이기는지 사람이 모른다). 릴리스 노트가 이것을 말한다.
- **FR-18** 취소: WSL run의 `cancel`은 `wsl.exe -d <distro> --exec kill -TERM -- -<pgid>`(pidfile의 그룹 id, 음수 = 그룹)이고,
  유예(`KILL_GRACE_MS`) 뒤에도 wsl.exe가 살아 있으면 `-KILL`로 한 번 더, 그래도 남으면 `taskkill /T /F`로 `wsl.exe`를
  죽인다(연결이 끊기면 run은 끝난다 — 안의 프로세스가 남는 것은 §4의 1). pidfile이 아직 없으면(런처가 쓰기 전) wsl.exe만
  `taskkill`한다. **앱 종료(`cancelAll`)는 동기판**이다 — `execFileSync('wsl.exe', ['-d', distro, '--exec', 'kill', '-KILL', '--',
  `-${pgid}`])`, `SHUTDOWN_KILL_TIMEOUT_MS` 안에서. `terminate.ts`에 `TreeKiller`와 평행한 `GroupKiller`가 생기고
  **플랫폼·distro·spawn을 인자로 받아** macOS에서 단위 테스트가 돈다(실제 WSL은 §5의 실측).
- **FR-19** pidfile은 run이 끝나면(어느 상태로든) 지우고, 부팅 때 `<userData>/wsl/`을 통째로 치운다(`clearMcpConfigs`와
  같은 자리). 터미널의 pidfile은 셸이 끝나거나 앱이 끝날 때 지운다.
- **FR-20** 세션 이어가기(`--resume`)는 그대로다 — 세션은 WSL 쪽 claude의 `~/.claude/projects/`에 있고 cwd(Linux 경로)로
  묶인다. **환경을 바꾼 repo의 옛 대화를 이으면 세션이 없다** — claude가 "No conversation found"로 실패하고 그 실패
  이유가 그대로 보인다. 앱이 미리 막지 않는다(어느 환경에서 만든 세션인지 run 행에 없다 — §4의 6).

### (D) MCP — 브리지는 Windows에 남는다

- **FR-21** WSL run의 MCP 설정 파일은 `command`가 **Windows 실행 파일의 Linux 경로**(`/mnt/c/…/one-desk.exe` — `execPath`를
  FR-11로 변환)이고 `args`는 **브리지의 Linux 경로와 설정 파일 자신의 Linux 경로**(`[bridge.mjs, <이 파일>]`)다. WSL은
  Linux 프로세스가 Windows 실행 파일을 띄우면 interop으로 Windows 프로세스를 만들고 stdin·stdout을 잇는다 — claude ↔
  브리지의 stdio가 그 경계를 넘고, 브리지 ↔ 앱의 HTTP는 **지금처럼 Windows 안의 `127.0.0.1`**이다. 네트워크가 WSL을
  건너지 않으므로 MCP 서버의 바인딩(`127.0.0.1`)·NAT·mirrored 네트워킹 어느 것도 손대지 않는다.
- **FR-22** **브리지는 WSL run에서 env에 기대지 않는다.** interop 경계에서 Linux 환경이 Windows 프로세스로 넘어가는지는
  문서가 분명하지 않다(`WSLENV`는 그 목록을 "포함할 변수"라고 말한다). 그래서 `ELECTRON_RUN_AS_NODE`·`ONE_DESK_MCP_URL`·
  `ONE_DESK_MCP_TOKEN`을 env로 주는 대신 — (1) `ELECTRON_RUN_AS_NODE`는 **Windows 쪽 설정 파일 하나로 대체할 수 없으므로**
  FR-23의 배치 파일이 세운다(실측을 못 해 env에 기대지 않는 쪽으로 갔다 — §4-A), (2) URL·토큰은 브리지가 둘째 인자의 파일에서 읽는다(파일은 Windows
  쪽 0600, 토큰은 인자에 나가지 않는다 — 지금의 "토큰은 커맨드 인자에 넣지 않는다" 그대로). 브리지(`bridge.mjs`)는 env가
  있으면 env, 없으면 둘째 인자의 파일 — 둘 중 하나다. Windows run은 바뀌지 않는다(env).
- **FR-23** **(개정 2026-10-12 — 실측 없이 가기로 해 이것이 유일한 길이다)** `command`는 `cmd.exe`의 Linux 경로
  (`/mnt/c/Windows/System32/cmd.exe`, `%SystemRoot%`를 `wslpath`로), `args`는 `['/c', '<Windows 경로>\<runId>.bridge.cmd']`뿐이고
  `env`가 없다. 그 배치가 `set ELECTRON_RUN_AS_NODE=1` 뒤에 `"<exe>" "<bridge>" "<bridge.json>"`(전부 Windows 경로)을 띄운다 —
  env가 interop 경계를 넘든 안 넘든 같다. 인용은 배치 안의 따옴표뿐이고(`%`만 `%%`), 배치는 `chcp 65001`을 먼저 둔다(§4-B — 없으면
  ASCII가 아닌 사용자 경로가 깨진다). 원래의 "실측으로 FR-22(env)와 둘 중 하나를 고른다"는 사라졌다. ~~`cmd.exe /c "<경로>"`는 인자가
  하나라 interop의 인용 규칙에 걸릴 것이 없다~~ — 틀렸다(§4-B 남은 것 3): cmd.exe는 `/c` 뒤를 자기 규칙으로 다시 읽어, 배치 경로
  (`<userData>\mcp\…`)에 `&`·`^`·`%이름%`이 있으면 쪼개거나 바꾼다.
- **FR-24** `--allowedTools`의 `mcp__one-desk` 접두사·`--strict-mcp-config`·`mcpToolPrefixes`는 그대로다. MCP 도구의
  시각·권한·workspace 경계(전체 설계 §8)는 환경을 모른다 — 토큰이 run을 정한다.

### (E) git · 파일 · asset

- **FR-25** `listRepoFiles`가 `ProcessEnvSpec`을 받아 WSL repo면 `git`을 WSL 안에서 띄운다(`wsl.exe -d <distro> --cd <linux>
  --exec git ls-files …` — 런처·pidfile 없이, 5초 안에 끝나는 조회다. FR-8의 변환에서 런처를 빼는 선택지가 있다:
  `wrapForEnv(env, cmd, args, cwd, { launcher: false })`). git은 WSL의 `git`이고 `findExecutable('git')`(Windows PATH)은
  타지 않는다. 출력(`-z`, 상대 경로 `/` 구분)은 그대로 쓴다. `@` 피커·멘션 해석·파일 칸 트리·저장 전 목록 확인이 전부
  이 함수라 **한 자리다.**
- **FR-26** 파일 읽기(`@`·코드 칸)·쓰기·해시·asset 스캔·`readBody`는 **바뀌지 않는다** — `repo.path`가 UNC라 지금 코드가
  그대로 Windows에서 읽고 쓴다. 줄바꿈·BOM 되살리기도 그대로다(파일은 그 바이트 그대로 9P를 지난다). `resolveRepoPath`의
  realpath가 UNC를 어느 형태로 돌려주는지는 실측하지 못했으므로(`\\?\UNC\…` 접두사·`wsl.localhost`) 비교 전에 양쪽을
  `foldUncPrefix`로 같은 형태(`\\wsl$\…`)로 맞춘다 — 순수 함수이고 단위 테스트가 그 모양을 고정한다(개정 2026-10-12).
- **FR-27** 글로벌 asset 경로: 앱 탭의 `글로벌 skill 경로 (claude)` 옆에 **`WSL 글로벌 skill 경로 (claude)`** 칸이 선다
  (`app_setting`의 `assets.globalRoots.claude.wsl`, 여러 줄, **Linux 경로**, 기본 `~/.claude/skills`). 스캔은 WSL repo가
  있는 workspace에서 그 repo들의 distro마다 `~`를 그 distro의 홈(`wsl.exe -d <distro> --exec sh -c 'echo $HOME'`, distro마다
  한 번 캐시)으로 풀고 UNC(`\\wsl$\<distro>\home\me\.claude\skills`)로 바꿔 지금의 `scanDir`로 훑는다. asset 행의
  `file_path`는 그 UNC다(동일성 키는 그대로 `(workspace_id, file_path)` — distro가 경로 안에 있어 두 distro의 같은 skill이
  두 행이 되는 것이 **맞다**). Windows 글로벌 경로는 WSL repo에도 그대로 훑는다(글로벌은 workspace 범위다 — WSL repo만
  있는 workspace에서 Windows의 `~/.claude/skills`가 보이는 것은 §4의 7).
- **FR-28** 맥락 조립(`collectContext`)은 asset 본문을 UNC로 읽는다 — 그대로. `instructions` 종류(`CLAUDE.md`)가 거부되는
  것도 그대로.

### (F) 터미널

- **FR-29** WSL repo의 터미널 셸은 **WSL 안의 로그인 셸**이다 — pty로 `wsl.exe -d <distro> --cd <linux 경로> --exec /bin/sh
  <launcher.sh> <pidfile> sh -c 'exec "${SHELL:-/bin/bash}" -l'`을 띄운다(그 사용자의 `$SHELL`, 없으면 bash — `wsl.conf`의 사용자).
  앱 탭의 `터미널 셸` 설정은 WSL repo에 적용되지 않는다(칸 밑에 한 줄: `WSL repo는 그 배포판의 기본 셸입니다`). 칸 머리의 셸
  이름은 `wsl · <distro>`. (개정 2026-10-12 — 원래 문장 "명령 없이 — distro의 기본 셸"은 FR-30의 런처와 맞지 않았다. 코드는 처음부터
  이 모양이었다.)
- **FR-30** `셸 다시 시작`·repo 삭제·경로/환경 변경·앱 종료의 트리 종료는 FR-18의 `GroupKiller`를 탄다 — pty를 런처로
  띄워(FR-10, 명령은 FR-29의 `sh -c '… -l'`) pidfile에 그룹 id가 있다. 앱 종료는 동기다(터미널 FR-9). **셸의 백그라운드 작업은
  그룹 밖이다**(§4-B 남은 것 2).
- **FR-31** 환경: `shellEnv`(앱 내부 변수를 뺀 Windows 환경)는 wsl.exe에 주고 안쪽 셸의 환경은 WSL이 만든다 — FR-17과 같다.

### (G) 경계와 보안

- **FR-32** 렌더러는 **repo id와 `agentEnv` 값**만 넘긴다. distro·Linux 경로·`wsl.exe`의 인자를 렌더러가 만들지 않는다 —
  core가 `repo.path`에서 판다. `listDistros`는 읽기 전용이다.
- **FR-33** `wsl.exe` 호출은 **전부 인자 배열**이고 `shell: true`가 없다. 런처의 `bash -lc`는 문자열이 고정 상수(`exec "$0"
  "$@"`)이고 사용자 값(경로·프롬프트·distro)은 인자로만 들어간다. distro 이름은 `wsl --list`의 값이거나 UNC에서 판 것이고
  `-`로 시작하면 거부한다(`wsl.exe`의 옵션으로 읽힐 수 있다). **Node 쪽의 배열은 이 보장의 절반이다** — 나머지 절반은 wsl.exe가
  그 배열을 안쪽에 배열로 넘기는 것이고, 그것은 `--exec`일 때뿐이다(FR-8 개정). v0.24.0·v0.25.0은 `--`로 띄워 이 조항이 지켜지지
  않았다(§4-B).
- **FR-34** `core/`는 `wsl.exe`를 **직접 찾지 않는다** — `%SystemRoot%\System32\wsl.exe`는 Windows 경로 규칙이라
  `executable.ts`의 PATH 탐색(`findExecutable('wsl')`)을 쓰고, 테스트는 `spawn`을 주입한다. `core/wsl/*`의 모든 함수가
  `platform`과 `spawn`을 인자로 받는다 — macOS 개발 장비에서 두 갈래가 다 돈다.
- **FR-35** 로그: run의 `stream.jsonl`·`raw.jsonl`은 환경을 모른다(claude의 stdout 그대로). `run` 행에도 환경 컬럼을 두지
  않는다(§4의 6) — 대화 헤더 부제·끝줄 메타에 `WSL`을 적지 않는다. 대신 **작업 디렉토리 알약**이 UNC 경로라 사람이 안다.

## 3. 바뀌는 자리

| 자리 | 지금 | 바뀜 |
|---|---|---|
| `core/db/schema.ts` · `drizzle/0011_*.sql` | `repo` 7컬럼 | `agent_env` 추가(기본 `host`) |
| `shared/models.ts` | `Repo`·`CreateRepoInput`·`UpdateRepoInput`, `AgentStatuses` | `agentEnv`, `AgentStatuses`에 `wsl?` 칸, `WslDistros` |
| `core/wsl/` (새) | — | `path.ts`(UNC ↔ distro·Linux 경로, 순수) · `launch.ts`(`wrapForEnv`, 순수) · `paths.ts`(`wslpath` 변환 캐시) · `distros.ts`(`--list`, UTF-16LE) · `launcher.sh`(extraResources) · `kill.ts`(`GroupKiller` 비동기·동기) |
| `core/runner/executable.ts` | `agentCommand(executable, args)` | `agentCommand(env, executable, args)` — 필수 인자. WSL 갈래는 `wrapForEnv` |
| `core/runner/agentPath.ts` | Windows 경로 해석 | WSL 갈래: `ONE_DESK_AGENT_PATH` → `agents.path.claude.wsl` → `command -v` |
| `core/runner/adapters/claudeCode.ts` | preflight = 파일 stat | WSL 갈래 `test -x`; `buildCommand`의 `--mcp-config` 경로 변환 |
| `core/runner/manager.ts` · `terminate.ts` | spawn·taskkill | `ProcessEnvSpec`을 `StartSpec`에, 취소·`cancelAll`의 WSL 갈래, pidfile |
| `core/mcp/configFile.ts` · `bridge.mjs` | env로 URL·토큰 | WSL 본문(interop 경로·인자 파일), 브리지가 인자 파일도 읽음 |
| `core/files/list.ts` | Windows `git` | `ProcessEnvSpec` 인자, WSL 갈래 |
| `core/files/read.ts` | realpath 비교 | UNC 형태 정규화(실측 뒤 필요하면) |
| `core/assets/service.ts` | `globalRoots()` | distro별 WSL 글로벌 루트 추가 |
| `core/terminal/service.ts` · `shell.ts` | 설정 셸, repo.path cwd | WSL 갈래(`wsl.exe --cd`), `GroupKiller` |
| `core/agent/exec.ts` · `commands/probe.ts` · `adapters/opencode.ts` | `agentCommand` 호출 | `env` 인자 전달 (opencode는 WSL이면 FR-7로 먼저 막힘) |
| `core/index.ts` | `agentPathOf(kind, ws)` | `envOfRepo`, `checkAgents`/`probeAgents`의 `wsl` 칸, `repos.update`의 검증·셸 종료·캐시 비우기, 부팅 때 `wsl/` 치우기, `wsl.listDistros` |
| `electron/ipc/repos.ts`·`app.ts`, `preload`, `channels` | — | `agentEnv` 통과, `wsl.listDistros` 한 줄 |
| `electron-builder.yml` | extraResources에 `bridge.mjs` | `launcher.sh` 추가 |
| `RepoTab` | 이름·경로·설명 | 실행 환경 라디오, 파싱 결과·경고·안내 |
| `SettingsPanel` 앱 탭 | 글로벌 경로·CLI 기본 경로·셸·상한 | `WSL claude 경로` · `WSL 글로벌 skill 경로` (초안 state는 `SettingsPanel`에 — FR-11 규칙) |
| 실행 탭 CLI 상태 · `AgentStatusList` | claude · opencode 두 줄 | `claude (WSL · <distro>)` 줄 |
| `RunPanel` agent 드롭다운 | 둘 다 가능 | WSL repo면 opencode `disabled` |
| 릴리스 노트·`release-install.md` | — | WSL 절: 환경변수는 WSL의 `~/.profile`, 세션은 환경마다 따로 |

IPC 새 채널은 `wsl.listDistros` 하나다. 나머지는 기존 채널의 타입 확장.

## 4. 우려

1. **interop 경계를 env가 넘는가.** FR-21의 브리지는 Windows 프로세스인데 `ELECTRON_RUN_AS_NODE`가
   없으면 Electron이 **창을 띄운다.** 원래는 실측 1순위였으나 **2026-10-12에 사용자가 실측을 건너뛰기로 해**("내가 실측을
   할수 없는 환경이라 실측은 건너뛰고 만들어줘") 어느 쪽이든 되는 FR-23(배치 파일)으로 갔다. 그것도 안 되면(interop 자체가 꺼진 distro — `wsl.conf`의 `interop.enabled=false`) WSL 쪽 node로 브리지를
   띄우고 호스트 IP로 HTTP를 건너는 intent의 원안으로 돌아가야 하고, 그것은 MCP 서버의 바인딩을 바꾸는 별도 spec이다.
   **interop이 꺼진 distro는 이번 범위에서 지원하지 않는다**(preflight가 `interop`을 한 번 확인해 거부한다 — plan).
2. **`wsl.exe`의 파이프 통과.** 자식 명령의 stdout/stdin이 바이트 그대로 지나는지(UTF-16 변환·`\r\n` 삽입 없음), 큰 출력
   (수 MB의 JSON 줄)이 밀리지 않는지, stdin을 닫으면(`stdin.end()`) 안쪽 claude의 stdin이 EOF를 받는지 — 셋 다 실측
   (`ONE_DESK_REAL_CLI=1`의 WSL 변형). 특히 **stdin EOF**가 안 넘어가면 claude가 3초를 기다린 뒤 진행한다(CLAUDE.md의
   stdin 함정)는 것으로 그치지만, 프롬프트 자체가 안 가면 run이 빈 지시로 돈다.
3. **취소가 안의 프로세스를 끝내는가 (실측 2순위).** FR-18은 그룹 kill로 설계했지만, `wsl.exe`를 taskkill했을 때 안의 프로세스가
   스스로 죽는지(파이프 EOF → claude 종료)도 같이 잰다 — 죽는다면 pidfile 경로를 단순화할 수 있다(단순화는 spec 개정으로).
4. **로그인 셸이 사용자의 환경변수를 다 읽지는 않는다.** Ubuntu의 `~/.bashrc`는 비대화형이면 맨 위에서 `return`하므로 거기
   적은 `export`는 `bash -lc`에서 안 보인다. `~/.profile`·`/etc/environment`에 두라고 릴리스 노트가 말한다. macOS launchd
   절(CLAUDE.md)과 같은 모양의 문제이고 앱이 풀 수 없다 — `-i`를 더하면 프롬프트·작업 제어 경고가 stdout·stderr에
   섞인다.
5. **CLI 상태는 workspace 단위, 환경은 repo 단위.** 한 workspace에 distro가 둘이면 첫 것만 보인다. repo마다 상태를 보이는
   것은 설정 화면 구조(실행 탭 = workspace 범위)를 바꾸는 일이라 이번엔 하지 않는다 — 실행은 어차피 run마다 그 repo로
   판정하므로 막히는 run은 제 이유를 말한다.
6. **run 행에 환경이 없다.** 어느 환경에서 만든 세션인지 모르므로 FR-20의 실패를 앱이 예측하지 못한다. 컬럼을 더하면 "환경을
   바꾼 repo의 옛 대화"를 헤더에 표시할 수 있지만, `Run`의 스프레드가 새 컬럼을 IPC로 흘리는 함정(CLAUDE.md)까지 딸려
   온다. 써 본 뒤 필요하면 더한다.
7. **Windows 글로벌 skill이 WSL repo에도 보인다.** 글로벌이 workspace 범위라 거르면 "repo를 고르면 글로벌 + 그 repo"
   규칙이 깨진다. WSL repo의 run에 Windows 글로벌 skill을 담으면 본문은 UNC가 아니라 Windows 경로에서 읽어 프롬프트에
   실리므로 **동작은 한다**(skill은 글자다). 혼란만 남는다 — 목록의 경로 `title`이 어디 것인지 말한다.
8. **UNC 위의 fs는 느리다**(9P). 큰 repo의 파일 칸 트리는 `git ls-files`(WSL 안, 빠르다)가 만들고 파일 읽기만 UNC다 — 2초
   폴링(`hash`)이 그 위에서 돈다. 파일 하나 stat이라 괜찮을 것으로 본다. 느리면 폴링 간격을 WSL repo에서 늘린다(plan에서
   잰다).
9. **`\\wsl$` vs `\\wsl.localhost`.** 둘 다 받고(FR-2) 저장은 사용자가 넣은 그대로다. 폴더 선택 대화상자는 Windows 11에서
   `\\wsl.localhost\`를 돌려준다. 같은 폴더를 두 표기로 두 번 등록하면 두 repo다 — `repoOfCwd`가 문자열 비교라 서로 다른
   repo로 본다. 막지 않는다(Windows의 `C:\a`와 `c:\A`도 같은 처지였고 `pathKey`가 대소문자만 접는다). 비교 전에 두 접두사를
   하나로 접는 것은 `pathKey` 한 자리라 싸다 — plan에서 넣는다.
10. **릴리스 CI에 WSL이 없다.** 단위 테스트는 주입으로 두 갈래를 다 보지만 실제 `wsl.exe`는 사용자의 Windows 장비에서
    `ONE_DESK_REAL_CLI=1` 류의 수동 검증뿐이다. plan의 완료 증명에 그 실측 기록(명령·출력)을 남긴다.

## 4-A. 구현하며 바뀐 것 (plan "달라진 것"과 같다 — 2026-10-12)

- **브리지 인자 파일은 설정 파일 자신이 아니라 `<runId>.bridge.json`이다**(FR-22 다듬음). 설정 파일에 모르는 키(`oneDesk`)를 두면
  claude가 거부할 수 있어 실측 항목이 하나 늘 뿐이라, 0600 파일을 하나 더 쓰고 `removeMcpConfig`가 둘을 지운다.
- **`parseWslPath`는 `shared/wslPath.ts`다**(FR-2의 `core/wsl/path.ts` 대신) — repo 탭의 파싱 결과와 `pathKey`의 접두사 접기(§4의 9)가
  렌더러에도 필요하고 렌더러는 core를 import할 수 없다. `core/wsl/env.ts`의 `envOfRepo`가 core 쪽 판정이다.
- **`launcherPath`는 `bridgePath`와 같이 선택 인자다**(§3의 "필수" 대신) — 기본값이 이 파일 기준 경로이고 패키징 앱만 main이 넘긴다.
  반면 `agentCommand`의 실행 환경, `StartSpec.env`, `RunContext.env`, `AgentDefaults.claudeWsl`은 **필수**다.
- **같은 경로를 다시 보내는 `repos.update`는 존재를 검사하지 않는다**(FR-2 다듬음) — 실행 환경만 바꾸는 저장이 드라이브를 뺀 날 막히면
  안 되고, e2e가 `\\wsl$\…`가 없는 장비에서도 라디오를 바꿔 볼 수 있다. 경로를 **바꿀 때**는 지금처럼 검사한다.
- `AgentStatuses`·`AgentProbes`의 `wsl` 칸은 `distro`를 품는다(FR-13). `WslDistros`에 `supported`가 있어 렌더러가 Windows가 아닌
  장비에서 라디오·앱 탭의 두 절을 그리지 않는다(FR-4).
- **실측은 하지 않는다 — 사용자 결정(2026-10-12).** 구현 환경이 Linux 컨테이너이고 사용자도 WSL 장비가 없어 §4의 1·2·3,
  `realpath`의 UNC 형태, `wslpath`, 실제 run·MCP·취소·터미널·앱 종료를 보지 않은 채로 간다. 결과에 따라 설계가 갈리던 두 자리는
  **어느 쪽이든 되게** 바꿨다: 브리지는 FR-23의 배치 파일(env에 기대지 않는다), `resolveRepoPath`는 `foldUncPrefix`(FR-26).
  나머지(파이프·그룹 kill·`wslpath`)는 spec대로 구현했고 처음 쓰는 사람이 본다 — 릴리스 노트가 그렇게 말한다.
  → **그 첫 실측이 §4-B다.** 결과에 따라 갈리던 것은 전부 되는 쪽이었지만, 실측 없이 가정한 것 하나(`wsl.exe -- …`가 인자를
  배열로 넘긴다)가 틀려 모든 run이 시작조차 못 했다.

## 4-B. 첫 실측 (2026-10-12 — Windows 11 Home 26200 · WSL 3.0.1 · Ubuntu-24.04 · claude 2.1.296)

v0.25.0을 진짜 WSL과 진짜 claude로 처음 돌렸다(`e2e/wsl-real.e2e.ts`의 첫 실행). 결함이 둘 나왔다.

**하나: `wsl.exe -- …`는 셸을 거친다.** wsl.exe는 `--` 뒤의 명령줄을 기본 셸에 `/bin/bash -c` **문자열**로 넘긴다 — Node가 배열로
보낸 인자가 셸 문법이 된다. 앱과 같은 인자 배열(Node `spawnSync`)로 `printf '[%s]\n' 'C:\WINDOWS\System32\cmd.exe' '$HOME'
'$(echo INJECTED)'`를 보내면 `--`는 `[C:WINDOWSSystem32cmd.exe]` · `[/home/rikeey]` · `[INJECTED]`를 찍고(인자에 홑따옴표가
하나 있으면 `unexpected EOF`로 실행조차 안 된다), `--exec`(`-e`)는 여덟 인자를 바이트 그대로 넘긴다.

- **증상**: 모든 WSL run이 시작 전에 `MCP 서버를 준비하지 못했습니다: WSL 경로를 변환하지 못했습니다 (Ubuntu-24.04): wslpath:
  C:WINDOWSSystem32cmd.exe`로 실패했다(FR-23의 `cmd.exe` 경로가 첫 `wslpath`다). 터미널도 런처 경로를 변환하지 못해 뜨지 않았다.
  `bash -lc 'command -v claude'`·`test -x`·`git ls-files`는 인자에 `\`가 없어 우연히 됐다 — 그래서 CLI 상태와 `@` 목록은 초록이었다.
- **셸 해석이 닿은 사용자 값은 하나다 — 앱 탭의 `WSL claude 경로`.** CLI 상태 판정은 돌았으므로 그 값이 `test -x <경로>`·`auth status`·
  probe의 명령으로 `bash -c`를 지났다(`$`·`$(…)`·따옴표·`\`가 해석됐다). 사용자가 자기 장비에 친 값이라 신뢰 경계를 넘지는 않았다.
  프롬프트는 stdin이라 닿지 않았고, `--model`(자유 입력) 같은 run 인자는 run이 경로 변환에서 먼저 막혀 닿지 않았다.
- **테스트가 못 잡은 이유**: 가짜 wsl.exe(`fake-wsl.mjs`)가 `--` 뒤를 배열 그대로 띄웠다 — 진짜와 뜻이 다른 것을 흉내냈다. 가짜는 이제
  `--`를 받으면 exit 2로 실패한다(되돌리면 manager의 WSL run 테스트들이 `failed`로 빨개진다).
- **고침**: FR-8의 구분자를 `--exec`로. 안쪽 명령(`wslpath`·`test`·`bash -lc`·`sh -c`·`git`·`kill` = `/usr/bin/kill`)은 전부 실행
  파일이라 셸 없이 돈다(실측).

**둘: 실행 환경을 바꿔 저장해도 CLI 상태를 다시 판정하지 않았다.** 설정 화면은 workspace를 고를 때만 `checkAgents`·`probeAgents`를
불렀다 — 방금 WSL로 바꾼 repo의 WSL 줄이 무엇이 다시 묻게 할 때까지 "확인 중"이었다(세 번 재서 27초 · 62초 · 90초 넘게). core는
FR-3대로 캐시를 비웠으니 화면만의 일이다. `SettingsPanel`의 `saveRepo`가 실행 환경이나 경로가 바뀐 저장 뒤 둘을 다시 부른다 —
6.1초(probe가 실제로 CLI를 띄우는 시간). 이름·설명만 고친 저장은 다시 부르지 않는다.

**고친 뒤** (같은 시나리오 — 실제 모델 호출 세 번):

| 무엇 | 결과 |
|---|---|
| §4의 1 — interop · 브리지(FR-23) | WSL의 claude가 `mcp__one-desk__list_issues`를 불러 `[]`를 받았다. 배치 파일 브리지가 interop으로 뜨고 Windows의 `127.0.0.1`에 닿는다 |
| §4의 2 — 파이프 | 프롬프트(stdin)가 들어가고 EOF가 넘어간다(턴이 곧바로 시작). 셸 출력 340 KB 턴의 `raw.jsonl` 47 KB가 밀리지 않았다 — claude가 30 KB를 넘는 도구 출력을 파일로 빼고 미리보기만 싣기 때문이다. 수 MB짜리 한 줄은 재지 않았다 |
| §4의 3 — 취소 | `중지` 1.3초 뒤 canceled, 1.4~1.9초 뒤 claude · Bash 도구의 셸 · 그 손자(python)가 WSL에서, MCP 브리지(`cmd.exe`와 Electron 브리지)가 Windows에서 전부 사라졌다. 손자 둘은 claude와 **다른 프로세스 그룹**이었다(Bash 도구가 그룹을 따로 만든다) — 그룹 TERM을 받은 claude가 자식을 거둔 것이다. `run_in_background`로 띄운 프로세스는 재지 않았다 |
| 앱 종료 | 터미널 셸(런처 그룹)·브리지가 WSL·Windows 어디에도 남지 않았다 — WSL은 cwd가 repo 아래인 프로세스, Windows는 데이터 폴더와 `.bridge.`를 품은 명령줄로 찾는다(`wsl-real.e2e.ts`). 셸의 **백그라운드 작업**은 예외다(아래 남은 것 2) |
| FR-26 — realpath의 UNC 형태 | `@README.md` 멘션이 실려 답에 그 내용이 나왔다(`foldUncPrefix`를 거친 비교 통과). 코드 칸도 UNC로 읽는다 |
| FR-25 · FR-29 | `@` 목록은 WSL의 git, 터미널은 `bash -l`(cwd = repo, 커널 `6.18.40.1-microsoft-standard-WSL2`) |
| probe(슬래시 커맨드 · 모델) | init 직후 끊긴 probe의 세션 파일에 assistant 응답이 없다 — wsl.exe를 죽이면 안의 claude도 모델 호출 전에 끝난다 |

참고: Claude Code는 단독 `sleep N`을 스스로 막는다(`Blocked: standalone sleep 300`) — 취소 시나리오는 python으로 잔다.

**고친 뒤의 리뷰가 찾은 것 둘 (같은 v0.25.1에서 고쳤다).**

- **릴리스 빌드의 `launcher.sh`가 CRLF였을 것이다.** 저장소에 `.gitattributes`가 없고 Git for Windows의 기본은 `core.autocrlf=true`다 —
  이 장비의 작업 트리가 LF인 것은 `.git/config`가 끄기 때문이고(`docs/windows-setup.md`), 릴리스 CI의 Windows 러너는 끄지 않는다.
  CRLF 런처를 WSL의 dash는 `shift: not found`·`Syntax error`로 거부해 pidfile도 안 쓰고 끝난다(실측) — 모든 WSL run과 터미널이
  다시 깨지는데 probe·인증·git은 런처를 안 써서 CLI 상태는 초록이다. `.gitattributes`의 `*.sh text eol=lf`가 막고,
  `launcher.test.ts`의 "CR이 없다"가 **Windows에서도** 바이트로 본다(그 describe는 다른 테스트와 달리 건너뛰지 않는다).
- **ASCII가 아닌 사용자 경로에서 브리지가 뜨지 않았다.** 배치(FR-23)는 UTF-8로 쓰지만 cmd.exe는 OEM 코드 페이지(949)로 읽는다 —
  `C:\Users\홍길동` 같은 계정이면 경로가 깨져 브리지가 `Cannot find module`로 죽고, claude는 MCP를 failed로 두고 도구 없이 "성공"한다.
  배치의 둘째 줄 `chcp 65001 >nul`이 고친다(실측 — WSL interop으로 `한글 폴더` 아래 배치를 띄워 없으면 exit 1, 있으면 통과).

**남은 것 (이 개정의 범위 밖 — 따로 정한다).**

1. **CLI 상태의 인증·모델 판정이 로그인 셸 밖에서 돈다.** run은 런처의 `bash -lc`라 `~/.profile`을 읽지만, `auth status`(`runCliIn`)와
   probe(`probeCommands`)는 런처 없이 `--exec <claude>`로 떠 `~/.profile`의 변수(Bedrock·프록시 — FR-17이 거기 두라고 한 것)를 못
   본다. 그런 사용자에게 설정 화면은 "로그인 필요"를 띄우는데 run은 된다 — "`checkAgents`는 실행과 같은 판정"(CLAUDE.md)이 WSL에서
   깨진 자리다. `--`와 `--exec`의 환경은 같으므로(PWD·SHLVL·`_`·WSL_INTEROP만 다르다 — 리뷰 실측) 이 개정이 만든 것이 아니라 run이
   처음 돌면서 보이게 된 것이다. 고치는 길은 그 둘도 고정 상수 `bash -lc 'exec "$0" "$@"'`로 감싸는 것이고, 로그인 셸이 stdout에
   찍는 글자가 `auth status --json`의 파싱을 깨지 않게 해야 한다.
2. **터미널 셸의 백그라운드 작업이 셸 종료를 비켜 간다.** 터미널은 작업 제어가 있는 대화형 `bash -l`이라 작업마다 프로세스 그룹이
   따로다. 끝낼 때의 그룹 KILL(FR-30)은 셸의 그룹만 맞히고, 셸이 SIGKILL로 죽어 HUP을 넘기지 못하므로 `npm run dev &`나 `bg`로 보낸
   작업은 앱을 끈 뒤에도 WSL에 남는다(리뷰 실측 — 앱 종료 경로에서 재현, 셸 다시 시작·repo 삭제에서는 경합). 포그라운드 작업은 pty가
   끊길 때의 HUP으로 죽는다. 고치는 길은 그룹 대신 **세션**을 끝내거나(`pkill -KILL -s <sid>` — 런처가 세션 리더면 pidfile의 수가 곧
   sid), KILL 앞에 HUP을 보내 bash가 작업에 넘기게 하는 것이다. run 쪽은 Bash 도구의 자식이 다른 그룹이어도 claude가 TERM을 받고
   거둬 남지 않았다(위 표) — `run_in_background`로 띄운 것은 재지 않았다.
3. **배치 경로(`<userData>\mcp\…`)에 `&`·`^`·`%이름%`이 있으면 cmd.exe가 `/c` 뒤를 쪼개거나 바꾼다**(리뷰 실측). Windows 계정 이름에
   그 글자가 허용되므로 그런 장비에서는 브리지가 뜨지 않고 run은 MCP 없이 "성공"한다. 막는 길은 둘이다 — run 전에 그 경로를 거부하고
   이유를 말하거나, cmd.exe를 걷어내고 Electron 실행 파일을 interop으로 직접 띄우며 `ELECTRON_RUN_AS_NODE`를 `WSLENV`로 넘기는 것
   (리뷰가 실측에서 통과를 봤다 — FR-22로 돌아가는 설계 변경이다).

## 5. 검증

- 단위(core): `parseWslPath`(두 접두사, 한글·공백 경로, 모양 아님, `-`로 시작하는 distro 거부) · `wrapForEnv`(host는
  그대로·런처 유무·인자가 문자열에 안 끼는지) · `agentCommand`가 env를 필수로 받는다(타입) · `listDistros`의 UTF-16LE 디코딩
  (픽스처 바이트) · `GroupKiller` 비동기·동기(spawn 주입, 호출 인자 고정) · `manager`의 WSL 취소 순서(TERM → KILL → taskkill)와
  pidfile 정리 · `cancelAll`이 동기판을 부른다 · `configFile`의 WSL 본문(interop 경로·인자 파일·env 없음) · `bridge.mjs`가 인자
  파일에서 URL·토큰을 읽는다 · `agentPath`의 WSL 갈래 순서 · preflight WSL 갈래 · `listRepoFiles`의 WSL spawn 인자 ·
  `repos.update`의 거부(모양·비Windows)와 셸 종료·캐시 비우기 · 글로벌 루트에 distro별 UNC가 더해진다 · opencode 거부(FR-7).
  **변이**: `agentCommand` 호출 자리 하나에서 `env`를 `{ kind: 'host' }`로 바꿔도 테스트가 잡는지 — 자리마다 하나씩.
- 단위(renderer): `RepoTab`(라디오·파싱 결과·경고·안내·저장 payload에 `agentEnv`) · 앱 탭의 두 칸(초안 state가 탭 전환에
  남는다) · `AgentStatusList`의 WSL 줄 · `RunPanel`의 opencode `disabled` · App 배선(`listDistros`·`agentEnv` prop).
- e2e(가짜 CLI, Windows·macOS): `agentEnv`가 IPC를 왕복해 repo 탭에 반영된다 · WSL repo를 고르면 opencode가 막힌다 ·
  **가짜 `wsl.exe`**(`ONE_DESK_FAKE_WSL` — 인자를 캡처 파일에 쓰고 안의 명령을 그대로 띄우는 node 스크립트)로 run이 `wsl.exe
  -d <distro> --cd <linux 경로> --exec …` 모양으로 떴는지, `--mcp-config`가 Linux 경로인지, 취소가 `kill -TERM -- -<pgid>`를
  보냈는지. 이 가짜는 e2e의 기존 가짜 CLI 규칙을 따른다(기본 시나리오를 건드리지 않는다). **가짜는 `--`를 받으면 exit 2로
  실패한다**(§4-B) — 진짜와 뜻이 다른 것을 배열 그대로 흉내내던 것이 결함을 가렸다.
- ~~실측은 없다(§4-A — 사용자 결정).~~ 첫 실측은 §4-B다. 같은 시나리오를 **선택 실행 e2e `e2e/wsl-real.e2e.ts`**
  (`ONE_DESK_REAL_WSL=1`, 배포판은 `ONE_DESK_REAL_WSL_DISTRO`)가 진짜 wsl.exe·진짜 claude로 다시 돈다 — 실제 모델을 세 번 부른다.
- 캡처(라이트·다크): repo 탭의 라디오와 안내, 실행 탭의 WSL 줄, 터미널 칸 머리 `wsl · Ubuntu`.
