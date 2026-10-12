# Plan: WSL2 안의 repo를 WSL 안의 claude로 돌린다

- 출처: `spec.md` (승인 2026-10-12 — "승인, UNC 저장으로 가고 plan 써 줘")
- 상태: 승인 (2026-10-12, 사용자 — "그렇게 진행해줘"), 구현 중

## 순서

각 단계는 테스트를 먼저 쓰고 빨간 것을 본 뒤 구현한다. 회귀 테스트는 대상 줄을 망가뜨려 빨개지는지 본다(아래 "변이").
**실측이 설계를 가르는 단계(1·9)는 그 결과를 이 문서의 "달라진 것"에 적고 spec을 고친 뒤 다음으로 간다.**
개발 장비가 macOS·Windows라 WSL 갈래는 `platform`·`spawn`을 주입해 단위 테스트로 보고, 실제 `wsl.exe`는 9단계가 사용자 장비에서 본다.

0. **기준선** — typecheck·lint·단위·전체 e2e가 초록인지 본다. 의존성 변화 없음.
1. **실측 — interop과 파이프 (spec §4의 1·2, 설계가 갈린다).** 코드를 쓰기 전에 Windows 장비의 WSL에서 셋을 잰다. 결과를 "달라진 것"에
   명령·출력 그대로 적는다.
   - env가 interop 경계를 넘는가: `FOO=1 /mnt/c/Windows/System32/cmd.exe /c set FOO`. 넘으면 FR-22(브리지 env 그대로), 안 넘으면 FR-23(`cmd.exe /c set …`).
     어느 쪽이든 **URL·토큰은 인자 파일**이다(FR-22의 (2)) — 결정은 `ELECTRON_RUN_AS_NODE` 하나다.
   - `wsl.exe -d <D> -- cat`에 Node가 `stdin.write` 뒤 `end()`하면 안쪽이 EOF를 받고 바이트가 그대로 돌아오는가(UTF-8 한글·`\n` 보존·1 MB).
   - `wsl.exe`를 `taskkill /T /F`하면 안의 `sleep 1000`이 죽는가(`ps`로 확인). 죽으면 FR-18의 그룹 kill은 **보조**가 되고 pidfile은 남긴다(터미널
     다시 시작과 앱 종료의 동기 경로가 그것을 쓴다) — 단순화는 spec 개정으로 적는다.
2. **경로** `core/wsl/path.ts` + 테스트 (FR-2·§4의 9)
   - `parseWslPath(path)` → `{ distro, linuxPath } | null`. `\\wsl$\<d>\…`·`\\wsl.localhost\<d>\…` 둘 다, 구분자 `\`→`/`, 한글·공백, 루트만
     (`\\wsl$\Ubuntu` → `/`), distro가 비거나 `-`로 시작하면 null. 순수 함수 — `node:path`를 쓰지 않는다(호스트 OS를 타면 macOS 테스트가 갈린다).
   - `envOfRepo(repo)` → `ProcessEnvSpec`(`{ kind: 'host' } | { kind: 'wsl', distro, linuxPath }`). `agentEnv = 'wsl'`인데 파싱이 null이면 던진다
     (저장 때 막았으므로 여기 오면 데이터가 깨진 것이다).
   - `renderer/conversation.ts`의 `pathKey`가 두 접두사를 하나로 접는다(`\\wsl.localhost\` → `\\wsl$\`) + 테스트.
3. **스키마** — `repo.agent_env TEXT NOT NULL DEFAULT 'host'`, `pnpm db:generate`로 `0011`. `Repo.agentEnv`·`CreateRepoInput.agentEnv?`·
   `UpdateRepoInput.agentEnv?`. 저장소 테스트: 기본값 `host`, `update`가 `agentEnv`만 바꾼다, `moveAssetPathPrefix`는 손대지 않는다.
   **`Run`의 스프레드 함정은 여기 없다**(repo 행은 `hydrate`를 타지 않는다) — 그래도 `repos.list`의 결과에 컬럼이 **의도대로** 실리는지 한 줄 본다.
4. **distro 목록과 경로 변환** `core/wsl/distros.ts`·`paths.ts` + 테스트 (FR-4·FR-11)
   - `listDistros({ platform, spawn })` → `{ distros: string[], reason: string | null }`. `wsl.exe --list --quiet`의 stdout을 **UTF-16LE로** 디코드
     (픽스처 바이트 — BOM 유무 둘 다, `\r\n`, 빈 줄). `platform !== 'win32'`면 spawn 없이 빈 목록 + 이유. spawn 실패·exit≠0도 빈 목록 + 이유.
   - `createWslPaths({ spawn, userDataDir })` — `toLinux(distro, windowsPath)`: distro마다 `wslpath -a -u <userDataDir>`를 **한 번** 묻고(프로미스째
     캐시 — 동시 호출이 한 번만 띄운다, 실패는 캐시하지 않는다 — opencode 버전 게이트와 같은 규칙) 그 아래 경로는 접두사 치환, `userDataDir` 밖
     (`execPath` — 설치 폴더)은 그때마다 `wslpath`. 드라이브 문자·역슬래시만 보는 결정적 변환으로 **대신하지 않는다**(automount 루트가 설정값이다).
5. **spawn 변환** `core/wsl/launch.ts` + `core/runner/executable.ts` + 테스트 (FR-8~10·33)
   - `wrapForEnv(env, cmd, args, cwd, { launcher, launcherPath, pidfile })` → `{ cmd, args, cwd }`. host면 `agentCommand`의 런처 규칙 그대로
     (`ONE_DESK_AGENT_LAUNCHER`), wsl이면 `['wsl.exe', '-d', distro, '--cd', linuxCwd, '--', '/bin/sh', launcherPath, pidfile, cmd, ...args]`
     (launcher=false면 `'--', cmd, ...args`). **cwd는 Windows 쪽에서는 넘기지 않는다**(`wsl.exe`는 `--cd`로 받는다 — Node의 `cwd` 옵션에 UNC를
     주면 `wsl.exe` 자신이 그 UNC에서 뜨려다 실패할 수 있다). 테스트: 인자가 문자열에 끼지 않는다(프롬프트·경로에 `"`·`$`·공백·`;`가 있어도 배열
     원소 그대로), distro가 `-`로 시작하면 던진다.
   - `agentCommand(env, executable, args)` — **env 필수.** 네 호출 자리(`manager.ts`·`commands/probe.ts`·`agent/exec.ts`·`adapters/opencode.ts`)를
     전부 고친다. typecheck가 빠진 자리를 잡는다.
   - `core/wsl/launcher.sh`(extraResources — `electron-builder.yml`에 한 줄, `resolveBridgePath`와 같은 모양의 `resolveLauncherPath`):
     ```sh
     #!/bin/sh
     # one-desk: 새 프로세스 그룹을 만들고 그 id를 적은 뒤 로그인 셸로 명령을 exec한다 (docs/sdlc/wsl-support/ FR-10)
     pidfile="$1"; shift
     if [ "$(ps -o pgid= -p $$ | tr -d ' ')" != "$$" ]; then exec setsid /bin/sh "$0" "$pidfile" "$@"; fi
     echo "$$" > "$pidfile"
     exec bash -lc 'exec "$0" "$@"' "$@"
     ```
     — 그룹 리더가 아니면 `setsid`로 자기를 다시 띄운다(util-linux `setsid`는 리더가 아닐 때 fork 없이 exec한다). 단위 테스트는 **macOS·Linux에서
     진짜로 돈다**(`/bin/sh launcher.sh <tmp pidfile> /bin/echo a 'b c'` → stdout `a b c`, pidfile의 수가 그 프로세스 그룹). CI(Linux)에서도 돈다.
6. **실행 파일 해석과 preflight** `core/runner/agentPath.ts`·`adapters/claudeCode.ts` + 테스트 (FR-12·13·7)
   - `resolveAgentPath`가 `env`(ProcessEnvSpec)를 받는다. wsl이면 `ONE_DESK_AGENT_PATH` → `appDefaults.claudeWsl`(새 설정 키
     `agents.path.claude.wsl`, `AgentPaths.claudeWsl`) → null. workspace 예외는 wsl에서 **무시**(테스트가 고정).
   - claude `preflight(explicitPath, { env, runCli })`: wsl 갈래는 explicitPath가 있으면 `test -x`, 없으면 `bash -lc 'command -v claude'`(둘 다
     `wrapForEnv(launcher=false)`로 띄운다 — `runCli` 주입). 결과를 (distro, 설정값)으로 캐시, 실패는 캐시하지 않는다. `.cmd`·`PATHEXT`·npm 껍데기는
     wsl 갈래에 없다. 이유 문구에 distro: `실행 파일이 없습니다 (Ubuntu): /home/me/.local/bin/claude`.
   - opencode: `core/index.ts`의 preflight 자리에서 repo가 wsl이면 `{ ok: false, reason: 'WSL repo에서는 OpenCode를 아직 쓸 수 없습니다' }`
     (어댑터에 넣지 않는다 — 어댑터는 repo를 모른다). `execution.test`: opencode + wsl repo는 `startedAt` null·그 이유로 실패.
7. **run** `core/execution.ts`·`core/runner/manager.ts`·`terminate.ts` + 테스트 (FR-15~19)
   - `StartSpec.env: ProcessEnvSpec`(**필수**)·`pidfile`. 실행 서비스가 cwd의 repo에서 `envOfRepo`로 만든다(cwd가 등록 repo가 아니면 host).
     `resolveExecutable(kind, workspaceId)`가 `(kind, workspaceId, cwd)`로 넓어진다 — 판정이 repo마다 다르다.
   - manager: `wrapForEnv`로 spawn, wsl이면 `cwd` 옵션 없음. **`--mcp-config`·`--resume`·권한·`--tools`는 환경과 무관** — `permission.test`의
     `mentionsAsk` 등 기존 단언을 wsl 갈래 인자에도 돌린다(`buildCommand` 결과를 `wrapForEnv` 전에 보므로 그대로다 — 변환이 인자를 바꾸지 않는다는
     테스트 하나).
   - 취소(`terminate.ts`): `GroupKiller`(`killGroup(distro, pgid, signal, onFail)` 비동기, `killGroupSync` 동기 — `execFileSync('wsl.exe', […])`,
     `SHUTDOWN_KILL_TIMEOUT_MS`). `terminate(child, { env, pidfile, killGroup, killTree })`: wsl이면 pidfile을 읽어(없으면 taskkill만) `TERM` →
     `KILL_GRACE_MS` → `KILL` → 그래도 `child`가 살아 있으면 `taskkillTree`. `cancelAll`은 `killGroupSync` + `taskkillTreeSync`. 테스트는 spawn 주입으로
     호출 순서·인자를 고정한다(1단계 결과에 따라 순서가 바뀌면 여기서 반영).
   - pidfile 정리: run 종료(`finish`)에서 지우고, 부팅 때 `<userData>/wsl/` 통째로(`clearMcpConfigs` 옆).
8. **MCP** `core/mcp/configFile.ts`·`bridge.mjs`·`host.ts` + 테스트 (FR-21~24)
   - `writeMcpConfig(dir, runId, target, agentKind, env)`: wsl이면 `command`는 `toLinux(execPath)`, `args`는 `[toLinux(bridgePath), toLinux(configFile)]`,
     `env`는 1단계 결과에 따라 `{ ELECTRON_RUN_AS_NODE: '1' }`만 또는 없음(FR-23이면 `command`가 `cmd.exe`의 Linux 경로). URL·토큰은 본문에 **인자 파일로**
     남는다 — 설정 파일 자신이 그 파일이므로 `mcpServers` 밖에 `oneDesk: { url, token }`을 같이 쓴다(claude는 모르는 키를 무시한다 — 실측 확인 항목).
     토큰이 `args`에 없다는 테스트.
   - `bridge.mjs`: env에 `ONE_DESK_MCP_URL`이 없고 `process.argv[2]`가 있으면 그 파일의 `oneDesk.url`·`token`을 읽는다. `bridge.test`에 한 줄.
   - `host.ts`의 `prepare`가 `env`를 받아 넘긴다(`toLinux`는 프로미스라 `prepare`가 await — 이미 async다).
9. **실측 — 실제 run (사용자 Windows 장비).** 여기까지의 core를 `pnpm dev`로 띄워(렌더러는 아직 없으니 DB를 SQL로 `agent_env='wsl'`) WSL repo에서
   한 턴: MCP `list_issues` 한 번, 취소 한 번, 앱 종료 뒤 `ps`로 잔존 확인, `realpath`의 UNC 형태(`node -e "fs.realpathSync('\\\\wsl$\\Ubuntu\\home')"`).
   `\\?\UNC\` 접두사로 돌아오면 `resolveRepoPath`의 비교 전 정규화 + 단위 테스트(순수 — 픽스처 문자열). 결과를 "달라진 것"에 적는다.
10. **git · asset · 터미널** + 테스트 (FR-25·27·29~31)
    - `listRepoFiles(root, { env, … })`: wsl이면 `wrapForEnv(launcher=false)`로 `git` 그대로(Windows PATH 탐색 없음). `files/service.ts`가 `getRepo`에서
      `envOfRepo`를 만들어 넘긴다(목록 캐시 키는 root 그대로).
    - `assets/service.ts`의 `globalRoots(workspaceId)`: 그 workspace의 wsl repo distro마다 `assets.globalRoots.claude.wsl`(여러 줄, 기본 `~/.claude/skills`)의
      `~`를 `wsl.exe -d <d> -- sh -c 'echo $HOME'`(distro마다 한 번 캐시, 실패는 캐시하지 않음)으로 풀어 UNC로 바꿔 더한다. 설정 저장소에 키·getter·setter.
      스캔 자체는 그대로(`scanDir`에 UNC). 테스트: 두 distro → 두 루트, 홈 조회 실패 → 그 distro만 빠지고 나머지는 훑는다, Windows 글로벌은 그대로.
    - 터미널: `launch`가 `envOfRepo(repo)`를 보고 wsl이면 `spawnPty('wsl.exe', ['-d', distro, '--cd', linuxPath, '--', '/bin/sh', launcher, pidfile,
      'sh', '-c', 'exec "${SHELL:-/bin/bash}" -l'], { cwd: <userData> })`. `resolveShell` 설정은 무시, 세션의 `shell`은 `wsl · <distro>`. `killRepo`·
      `restart`·`killAll`이 `killGroup`/`killGroupSync`를 먼저 부르고 pty.kill. 테스트(가짜 pty·spawn): 인자 모양, 설정 셸 무시, 동기 경로.
11. **core 배선** `core/index.ts` + 테스트 (FR-3·13·14)
    - `repos.create`·`update`의 검증: `agentEnv='wsl'`이면 `parseWslPath` 통과 + `platform === 'win32'`(아니면 `WSL은 Windows에서만 쓸 수 있습니다`).
      `update`로 환경이 바뀌면 `terminal.killRepo` + 그 repo cwd의 커맨드 캐시·agent 정보 캐시 비우기(지금의 `다시 확인`이 쓰는 함수).
    - `checkAgents`·`probeAgents`의 `wsl?` 칸: 그 workspace의 첫 wsl repo로 판정, 없으면 키 없음. `AgentStatuses`/`AgentProbes` 타입 확장.
    - `wsl.listDistros()` — IPC 한 줄(`wsl:listDistros`), preload·client·channels.
    - 부팅: `<userData>/wsl/` 치우기, `launcherPath`를 `CoreOptions`로(**필수** — `bridgePath`와 같은 규칙; 테스트는 fixture 경로).
12. **화면** + 테스트
    - `RepoTab`: 줄마다 `claude 실행 환경` 라디오(그룹 이름 `<repo 이름> claude 실행 환경`, 옵션 `Windows`·`WSL`), WSL이면 경로 칸 밑에 파싱 결과
      `배포판 Ubuntu · /home/me/proj` 또는 거부 문구, distro 목록에 없으면 경고, host인데 `\\wsl$`면 안내. 저장 payload에 `agentEnv`. 초안 state는
      `SettingsPanel`(탭 전환 보존 — FR-11 규칙, `RepoTab`은 그리기만).
    - 앱 탭: `WSL claude 경로`(한 줄, Linux 경로, placeholder `비우면 WSL의 PATH에서 찾습니다`)·`WSL 글로벌 skill 경로 (claude)`(여러 줄, 기본
      `~/.claude/skills`) — 각자 저장(절마다 저장이 따로). Windows가 아니면 두 절을 그리지 않는다(`app.platform`은 이미 info 탭이 쓴다).
    - `AgentStatusList`: `wsl` 칸이 있으면 `claude (WSL · Ubuntu)` 줄. 실행 탭의 CLI 경로 절 placeholder에 `WSL repo에는 적용되지 않습니다` 한 줄.
    - `RunPanel`: 작업 디렉토리의 repo가 wsl이면 agent 드롭다운의 OpenCode `disabled` + `title`, 선택값이 opencode였으면 claude로(저장 없이).
      `RunPanel.test`·`App.test`(배선 — `agentEnv`가 RunPanel까지 내려간다, `listDistros`가 설정까지 내려간다).
    - 작업 디렉토리 알약·`작업 디렉토리 경로 복사`: 바뀌지 않음(UNC 그대로) — 테스트 한 줄로 고정.
13. **CSS·DESIGN.md** — 라디오 줄·파싱 결과 줄(`--text-muted`, 모노 `.path-text`)·경고(`--warning` 토큰이 있으면 그것). 토큰만.
14. **e2e** `e2e/wsl.e2e.ts`(가짜 `wsl.exe`) + 전체 e2e
    - 가짜 `core/runner/fixtures/fake-wsl.mjs`: 인자를 `ONE_DESK_WSL_CAPTURE`에 JSON 한 줄로 적고, `--list --quiet`면 UTF-16LE로 `Ubuntu\r\nDebian\r\n`,
      `wslpath`면 `/mnt/c/...`를 규칙으로 만들어 찍고, `-- kill …`이면 캡처만, 그 밖(`--`, 명령)이면 **런처·pidfile을 건너뛰고 안의 명령을 그대로
      띄운다**(가짜 claude가 돌게 — `ONE_DESK_AGENT_LAUNCHER`를 그대로 적용). 드라이버가 `ONE_DESK_WSL_PATH`로 물린다(`findExecutable('wsl')`
      앞의 테스트 이음매 — `ONE_DESK_AGENT_PATH`와 같은 성격). **기본 시나리오는 건드리지 않는다.**
    - 시나리오: repo 탭에서 WSL로 바꿔 저장 → IPC 왕복 → 다시 열어도 WSL · 한 턴이 `wsl.exe -d Ubuntu --cd /home/me/proj -- /bin/sh <launcher> …`
      모양으로 떴고 `--mcp-config`가 `/mnt/c/…` · 취소가 `kill -TERM -- -<pgid>`를 캡처에 남긴다 · opencode가 막힌다 · 글로벌 WSL 경로 저장.
    - Windows·macOS 둘 다 돈다(가짜라서). macOS에서는 `agentEnv='wsl'` 저장이 거부되는 것을 **대신** 본다(`platform` 분기 — 드라이버가 `ONE_DESK_FAKE_PLATFORM`
      같은 이음매를 두지 않는다. OS마다 다른 테스트가 도는 것이 맞다).
15. **실측 — 전체 (사용자 Windows 장비)**: 9단계를 화면으로 다시(설정 → 실행 → MCP → 취소 → 터미널 `echo` → 앱 종료 `ps`), 라이트·다크 캡처.
    릴리스 노트 초안(`docs/releases/`는 태그 때) — WSL 절: 환경변수는 `~/.profile`, 세션은 환경마다, interop 필요.
16. **문서** — CLAUDE.md(현재 상태 한 절 + 함정: `agentCommand` env 필수, `wsl.exe --list`는 UTF-16, launcher.sh는 extraResources, 취소 순서,
    UNC 저장 이유), spec의 "달라진 것" 반영, `docs/ideas.md`의 WSL 항목 삭제, 아키텍처 다이어그램 JSON에 `core/wsl` 한 상자.

## 바뀌는 파일

`drizzle/0011_*.sql`(+meta) · `core/db/schema.ts` · `core/db/repositories/{repo,setting}.ts`(+test) · `core/wsl/{path,launch,distros,paths,kill}.ts`(+test, 새) ·
`core/wsl/launcher.sh`(새) · `core/runner/{executable,agentPath,manager,terminate,types}.ts`(+test) · `core/runner/adapters/{claudeCode,opencode}.ts`(+test) ·
`core/agent/exec.ts` · `core/commands/probe.ts` · `core/mcp/{configFile,host}.ts`·`bridge.mjs`(+test) · `core/files/{list,service}.ts`(+test) ·
`core/assets/service.ts`(+test) · `core/terminal/service.ts`(+test) · `core/execution.ts`(+test) · `core/index.ts`(+test) · `shared/{models,channels,client}.ts` ·
`electron/{preload,main}.ts` · `electron/ipc/{index,repos,app}.ts` · `electron-builder.yml` · `renderer/conversation.ts`(+test) ·
`renderer/components/{SettingsPanel,RunPanel,App,AgentStatusList}.tsx`(+test) · `renderer/components/settings/RepoTab.tsx`(+test) · `renderer/index.css` ·
`core/runner/fixtures/fake-wsl.mjs`(새) · `e2e/driver.ts` · `e2e/wsl.e2e.ts`(새) · `CLAUDE.md` · `DESIGN.md` · `docs/ideas.md` · `docs/diagrams/*.json` · 이 plan.

## 변이 (되돌려 빨개지는지 볼 것)

| 망가뜨릴 줄 | 빨개져야 할 테스트 |
|---|---|
| `agentCommand`의 `env`를 선택 인자로 | typecheck는 통과하므로 — 네 호출 자리마다 `{ kind: 'host' }`로 바꿔 각 자리의 wsl 테스트가 빨개지는지 (manager·probe·exec·index) |
| `wrapForEnv`가 wsl에서 `--cd`를 빼고 Node `cwd`를 넘김 | spawn 옵션에 cwd가 없고 `--cd`에 Linux 경로가 있다 (FR-8) |
| `wrapForEnv`가 프롬프트·경로를 `bash -c` 문자열에 끼움 | 인자가 배열 원소 그대로다 (FR-33) |
| `parseWslPath`가 `-`로 시작하는 distro를 받음 | 거부된다 (FR-33) |
| `listDistros`가 utf8로 디코드 | UTF-16LE 픽스처에서 `Ubuntu`가 나온다 (FR-4) |
| `toLinux`가 드라이브 문자로 결정적 변환 | `wslpath`를 distro마다 한 번 부른다; 실패는 캐시하지 않는다 (FR-11) |
| `launcher.sh`의 `setsid` 분기를 지움 | pidfile의 수가 그 프로세스 그룹이다 (진짜 sh, macOS·Linux) |
| `resolveAgentPath`가 wsl에서 workspace `claudePath`를 씀 | wsl은 workspace 예외를 무시한다 (FR-12) |
| preflight wsl 갈래의 실패를 캐시 | 못 읽은 판정은 캐시하지 않는다 |
| opencode + wsl 거부 한 줄을 지움 | `execution.test`의 그 run이 `startedAt` null이 아니다 (FR-7) |
| `terminate`가 wsl에서 pidfile을 읽지 않고 taskkill만 | 호출 순서 TERM → KILL → taskkill (FR-18) |
| `cancelAll`이 비동기 `killGroup`을 씀 | 앱 종료는 동기다 |
| `writeMcpConfig`의 wsl 본문에 토큰을 `args`로 | 토큰이 `args`에 없다 (FR-22) |
| `bridge.mjs`가 인자 파일을 읽지 않음 | env 없이 인자 파일만으로 URL·토큰을 얻는다 |
| `listRepoFiles`가 wsl에서 Windows `git`을 씀 | spawn 인자가 `wsl.exe …`다 (FR-25) |
| 글로벌 루트에서 wsl distro를 빼먹음 | 두 distro → 두 UNC 루트 (FR-27) |
| 터미널이 wsl에서 설정 셸을 씀 | 인자에 설정 셸이 없고 `wsl.exe --cd`다 (FR-29) |
| `repos.update`가 환경 변경에 셸을 안 끝냄 / 캐시를 안 비움 | 각 1 (FR-3) |
| `repos.update`가 macOS에서 wsl을 받음 | `WSL은 Windows에서만` (FR-4) |
| `checkAgents`가 `wsl` 칸을 항상 넣음 / 안 넣음 | wsl repo 없으면 키 없음, 있으면 첫 distro (FR-13) |
| `pathKey`가 두 접두사를 접지 않음 | `\\wsl.localhost\U\a`와 `\\wsl$\U\a`가 같은 repo (§4의 9) |
| App이 `agentEnv`를 RunPanel에 안 내림 | opencode가 wsl repo에서 비활성이 아니다 (배선) |
| main이 `launcherPath`를 안 넘김 | 컴파일이 깨진다 (필수 인자) |

## 위험

1. **1단계·9단계의 실측이 설계를 바꿀 수 있다** — env가 안 넘어가고 `cmd.exe /c set`도 안 되면(interop 꺼짐), WSL 안 node 브리지 + 호스트 IP가 되고
   그것은 MCP 바인딩을 바꾸는 별도 spec이다. 그때는 여기서 멈추고 spec부터 다시 쓴다.
2. **`wsl.exe`가 stdin EOF를 안쪽에 전하지 않을 수 있다.** 그러면 프롬프트를 stdin이 아니라 인자로 줘야 하는데 인자 길이 상한(32 KB)이 있다. 1단계가
   본다. 안 되면 프롬프트를 pidfile 옆 파일로 쓰고 런처가 `< file`로 잇는 안(spec 개정).
3. **`setsid`의 동작이 distro마다 같은가** — util-linux 기준이다. busybox 계열(Alpine)은 `setsid`가 있지만 옵션이 다르다. 런처는 옵션 없이 쓴다.
4. **`wslpath`는 WSL 안에서만 돈다** — distro가 꺼져 있으면 첫 호출이 distro를 부팅하느라 수 초 걸린다(캐시가 그 뒤를 막는다). 첫 run이 느린 것은 감수.
5. **UNC `realpath`** — Node가 `\\?\UNC\wsl$\…`로 돌려주면 `p.relative`가 `..`로 시작해 **모든 파일이 밖**이 된다 → 코드 칸이 통째로 빈다. 9단계가 가장
   먼저 보는 항목이고, 정규화는 순수 함수라 픽스처로 고정한다.
6. **`checkAgents`가 느려진다** — wsl 갈래는 프로세스를 띄운다(`test -x`). 캐시로 두 번째부터는 없다. `probeAgents`와 합치지 않는 규칙은 그대로.
7. **e2e의 가짜 `wsl.exe`는 interop·파이프·kill을 흉내내지 않는다** — 인자 모양만 본다. 진짜는 15단계뿐이고 CI에 없다. 완료 증명에 실측 기록을 남기는
   것이 그 빈자리의 전부다.
8. **Dock·RunPanel이 또 커진다** — 판정(`envOfRepo`·opencode 비활성 조건)은 `renderer/`의 순수 함수(`agentEnv.ts`)에 두고 컴포넌트는 적용만 한다.

## 완료 증명

(구현 뒤에 적는다 — 기준선 · 테스트 먼저 · 변이 표 · e2e · 실측 1·9·15단계의 명령과 출력 · 최종 수치 · 번들)

## 달라진 것

(구현 중 spec과 달라진 것을 적는다 — 1단계와 9단계의 실측 결과가 첫 항목이 된다)
