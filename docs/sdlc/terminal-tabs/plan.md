# Plan: 터미널 탭 — repo마다 여러 셸, 탭을 열 때 셸 고르기

- 출처: `spec.md`
- 상태: **승인됨** (2026-10-27, 사용자 "spect 만들어줘 개발") — **구현 완료**(2026-10-27, 아래 완료 증명·달라진 것). spec §0-B의 결정 여덟은 사용자가 뒤집을 수 있다

## 순서

각 단계는 테스트를 먼저 쓰고 빨간 것을 본 뒤 구현한다. 회귀 테스트는 대상 줄을 망가뜨려 빨개지는지 본다(아래 "변이"). 단계마다 끝에 적은 확인이
초록이어야 다음으로 간다. 역슬래시가 든 소스(Windows 경로 테스트)는 Bash heredoc이 아니라 Write/Edit 도구로 쓴다(CLAUDE.md — 두 개가 하나로 접힌다).

0. **기준선** — `pnpm typecheck` · `pnpm lint` · `pnpm test` 초록, `pnpm test:e2e` 전체 통과(파일 수·테스트 수·시간을 적어 둔다). `pnpm dev`가 떠
   있으면 끄거나 작업 트리 복사본에서 돌린다(CLAUDE.md의 `out/` 함정). 이 장비에 Git for Windows가 있는지(`where git`), `C:\Windows\System32\bash.exe`가
   있는지 적어 둔다 — 10단계의 Git Bash 시나리오와 Windows 가짜 경로 테스트의 재료다.
   - 확인: 네 명령의 결과를 이 plan의 완료 증명에 적는다.

1. **공유 모양** `shared/models.ts` (spec §2) — `TerminalShellKey`·`TERMINAL_SHELL_KEYS`·`TerminalShellOption`·`TERMINAL_TABS_PER_REPO`·`TerminalTab`,
   `TerminalSession`·`TerminalData`·`TerminalExit`의 `repoId` → `tabId`. 입력 타입 `TerminalOpenInput`(그대로)·`TerminalCreateInput`·`TerminalTabInput`
   (`{ workspaceId, tabId, cols, rows }`)·`TerminalTabRef`(`{ workspaceId, tabId }`). `isTerminalShellKey(value: unknown)`(IPC 경계에서 core가 쓰는 판정 —
   `shared/`라 renderer 타입 검사에도 걸리므로 node 모듈 없이).
   - 이 단계에서 typecheck는 일부러 빨갛다 — 2~5단계가 고친다. 테스트: `shared/terminal.test.ts`(core 프로젝트의 include가 `shared/**`를 잡는다 —
     CLAUDE.md 함정)로 `isTerminalShellKey`(경로 문자열 · 빈 문자열 · 대소문자 다른 키 · 숫자 거부).
   - 확인: 그 테스트 초록.

2. **셸 등록부** `core/terminal/shell.ts` + `shell.test.ts` (spec FR-8~12·15·16)
   - `ShellLookup`에 `exists: (path: string) => Promise<boolean>`를 더한다(고정 경로 판정 — 파일시스템을 직접 건드리지 않는 지금 원칙, `shell.ts` 머리 주석).
   - `findGitBash(lookup)` — FR-10의 세 단계. `discoverShells(env: ProcessEnvSpec, lookup, defaultFile)` → `TerminalShellOption[]`(순서 고정,
     `isDefault`는 `defaultFile`과 경로 비교 — Windows는 대소문자 무시). `resolveShellKey(key, env, lookup, setting)` → `ShellChoice` 또는 throw(FR-12).
     `default`는 지금의 `resolveShell(setting, lookup)`, WSL env면 `wsl`.
   - `nextTabLabel(base, others)`·`keepLabel(oldLabel, newBase)`(FR-15·16) — 순수.
   - 테스트(`platform: 'win32'`로 개발 장비에서): pwsh 있음/없음 · powershell·cmd(`SystemRoot`가 `D:\WIN`·없음) · cmd는 `ComSpec`을 따르지 않는다 ·
     Git Bash를 `…\Git\cmd\git.exe`·`…\Git\bin\git.exe`·`…\Git\mingw64\bin\git.exe`·scoop `…\git\current\cmd\git.exe`에서 · 고정 자리 셋 ·
     **`find('bash')`만 `C:\Windows\System32\bash.exe`를 돌려주는 장비에서 Git Bash 없음**(`find`가 `bash`로 불리지 않았는지도) · `WindowsApps\bash.exe`
     거름 · 있지 않은 고정 경로는 목록에 없다 · posix는 `login` 하나 · WSL env는 `wsl` 하나 · 키 거부 셋 · 이름 번호 매기기(빈 번호 채우기 포함) · 다시
     시작 이름 규칙.
   - 확인: `pnpm test core/terminal/shell` 초록.

3. **셸 서비스** `core/terminal/service.ts` + `service.test.ts` — 가짜 pty로 (spec FR-2~5·12~14·17~21)
   - `shells: Map<tabId, Shell>`(셸에 `tabId`·`repoId`·`label`·`shellKey`), `starting: Map<repoId, Promise<TerminalTab[]>>`(FR-5 — 없을 때 첫 탭),
     `pendingByRepo: Map<repoId, number>`(상한이 띄우는 중을 센다 — `await` 전에 올리고 `finally`에서 내린다), `killedDuringLaunch`(FR-19 — 띄우는 중
     `killRepo`·`killAll`이 repo id를 적고, `launch`가 spawn 뒤에 보고 곧바로 `end`, 목록에 넣지 않고 던진다).
   - 의존 바뀜: `resolveShell: (key, repo) => Promise<ShellChoice>`(키 해석은 core/index가 등록부로), `discover: (repo) => Promise<TerminalShellOption[]>`,
     `newId: () => string`(테스트가 `tab-1`… 을 준다 — 실제는 `randomUUID`), `wslLauncher(distro, tabId)`.
   - 메서드: `open`·`shells`·`create`·`attach`·`restart`·`close`·`write`·`resize`·`killRepo`·`killAll`. `isCurrent`는 `shells.get(shell.tabId) === shell`,
     `restart`는 같은 키로 `shells.set(tabId, 새 셸)`(Map 순서가 자리를 지킨다).
   - 기존 테스트를 옮긴다(키만 바뀐다): 수명·출력·쓰기·다시 시작·끝내기·WSL 여섯. "repo당 하나다"(`service.test.ts:97-105`)는 "열기는 하나만 띄우고, 만들기는
     따로 띄운다"로 바꾼다.
   - 새 테스트: spec §7의 core 목록 전부. 특히 — 탭 둘의 출력·끝남이 `tabId`로 갈린다 · 상한(8 + 띄우는 중 둘을 `Promise.all`로 → 하나는 거부) · `killRepo`가
     탭 셋을 다 `killTree`하고 다른 repo의 탭은 안 건드린다 · 띄우는 중 `killRepo`(가짜 `resolveShell`을 미뤄 둔 프로미스로) → spawn된 pty가 곧바로 끝나고
     목록에 없다 · `killAll`이 탭마다 `killTreeSync` · WSL 탭 둘이 서로 다른 pidfile을 겨눈다 · 남의 workspace로 `attach`·`restart`·`close`.
   - 확인: `pnpm test core/terminal` 초록.

4. **core 배선** `core/index.ts` + `core/index.test.ts` (spec FR-11·19·21)
   - `shellLookup()`에 `exists`(`fs/promises`의 `access` — `core/`에서 fs는 써도 된다, 경계는 electron), 서비스에 `resolveShell: (key, repo) =>
     resolveShellKey(key, envOfRepo(repo), shellLookup(), settings.terminalShell())`, `discover`, `newId: randomUUID`, `wslLauncher: (distro, tabId) =>
     wslLauncherFor(distro, \`term-${tabId}\`)`. 표면 `terminal`이 여덟(`core/index.ts:934-939` 자리).
   - 기존 배선 테스트(`core/index.test.ts:810-895·1516-1567`)를 새 표면으로 옮기고, repo 삭제·경로 변경·실행 환경 변경·workspace 삭제·`shutdown`이 **탭 둘을 다**
     끝내는지로 넓힌다. WSL pidfile 이름(`:835`)은 `term-${session.tabId}`.
   - 확인: `pnpm test core` 초록, `pnpm typecheck`의 core 쪽 오류 없음.

5. **통로** — `shared/channels.ts`(`terminalShells`·`terminalCreate`·`terminalAttach`·`terminalClose` 추가, 나머지 그대로), `shared/client.ts`, `electron/preload.ts`
   (`write(tabId, …)`·`resize(tabId, …)`는 `send`), `electron/ipc/terminal.ts`(한 줄씩, push는 `getMainWindow`로만 — 그대로).
   - 경계 grep 둘(`from 'electron'` in `core/`, `window.oneDesk` outside `main.tsx`) 출력 없음.
   - 확인: `pnpm typecheck`에서 남은 오류가 렌더러뿐이다.

6. **이어 붙이기와 탭 고르기** — `renderer/code/terminalStream.ts`(`repoId` → `tabId`, 규칙 그대로) + 테스트의 키 이름, `renderer/code/terminalTabs.ts`(새) +
   `terminalTabs.test.ts`: `pickTab(tabs, remembered)`(기억한 것이 있으면 그것, 없으면 첫째, 빈 목록이면 null) · `nextActiveAfterClose(tabs, closedId,
   activeId)`(보던 탭이면 오른쪽, 없으면 왼쪽, 다른 탭을 닫았으면 그대로) · `readActiveTab`·`writeActiveTab`(localStorage, 막혀도 던지지 않는다 — `layout.ts`의
   `read`/`write`와 같은 모양).
   - 확인: `pnpm test renderer/code` 초록.

7. **터미널 칸** `renderer/components/code/TerminalPane.tsx`(탭 줄·메뉴·빈 칸) · `TerminalTabView.tsx`(새 — 지금 `TerminalPane`의 붙기·끝남·다시 시작·
   `대화에 붙이기`를 `tabId`로, `key={tabId}`) + `TerminalPane.test.tsx` (spec FR-1~7·17)
   - 칸은 마운트하면 구독(`onTerminalExit` — 자기 repo의 탭들) → `open` → `pickTab` → 그 탭의 `TerminalTabView`. 탭 목록 state는 `open`·`create`·`close`의 응답과
     끝남 push로만 바뀐다. 마지막 크기(`cols`·`rows`)는 ref에 두고 `create`에 넘긴다(아직 잰 적이 없으면 80×24 — 붙은 뒤 `resize`가 맞춘다).
   - 메뉴: `▾`를 누르면 `shells`를 묻고 `role="menu"`를 연다. 줄을 고르면 `create`. Esc·바깥 누르기·고르기가 닫는다. 메뉴의 Esc는 `preventDefault`+
     `stopPropagation`(칸의 Esc 규칙이 이미 감싸지만, 메뉴가 먼저 닫혀야 한다).
   - 탭 줄 키보드: ←→·Home·End로 탭 사이, 보이는 탭만 `tabIndex=0`.
   - 테스트(`TerminalView`는 지금처럼 대역): spec §7의 renderer 목록 전부. 가짜 클라이언트에 `terminal.shells`·`create`·`attach`·`close`와
     `events.onTerminalData`·`onTerminalExit`가 있어야 한다(없으면 던진다 — `useItemChanged`와 같은 함정). 대역의 `onReady`는 effect에서 한 번만(CLAUDE.md —
     무한 루프).
   - `Dock.test`의 `TerminalPane` 대역은 prop이 그대로라 손대지 않는다 — 초록인지만 본다.
   - 확인: `pnpm test renderer` 초록, `pnpm typecheck` 전체 초록.

8. **설정 안내문** `SettingsPanel.tsx:811-812`의 문장(spec FR-22) + `SettingsPanel.test`에 문장을 잡는 단언이 있으면 고친다.
   - 확인: `pnpm test renderer/components/SettingsPanel` 초록.

9. **CSS·DESIGN.md** — 탭 줄(가로 스크롤, 보이는 탭은 파일 칸의 눌림 토큰, 끝남 점은 `--text-muted`), 머리 두 줄, 메뉴(대화 헤더 `⋯` 메뉴와 같은 결 —
   새 모양을 만들지 않는다), 빈 칸. 토큰만, hex 없음, rem. `DESIGN.md`에 탭 줄 한 절.
   - 확인: `pnpm lint` 초록, `grep -n "#[0-9a-fA-F]\{3,6\}" renderer/index.css`가 `:root` 블록 밖에서 새 줄을 내지 않는다.

10. **e2e** `e2e/terminal.e2e.ts` (진짜 셸) — 헬퍼 `terminalPane`·`termText`·`waitShellIdle`·`run`은 그대로 쓴다(보이는 탭 하나만 마운트하므로 `.xterm-rows`는
    늘 하나다). 탭은 `terminalPane(page).getByRole('tab', { name, exact: true })`로 잡는다.
    - 기존 넷을 고친다: 셋째("설정에서 셸을 바꾸면 다시 시작한 셸이 그것이다")는 `.terminal-shell` 대신 **보이는 탭의 이름**(`aria-selected="true"`인 tab의
      글자)이 `cmd`/`sh`가 되는지 본다(FR-16).
    - 새 시나리오:
      1. (Windows) `셸 고르기` → menuitem `명령 프롬프트` → 탭 `cmd`가 서고 보인다 → `echo tab-cmd-%OS%` → `tab-cmd-Windows_NT`(spec §6의 3). 탭 `pwsh`(또는
         `powershell`)로 돌아가면 앞의 `…-42` 출력이 그대로다.
      2. 탭 A에서 `node -e "console.log('PID='+(process.pid*1)); setInterval(()=>{},1e9)"`(PID A) → `새 터미널` → 탭 B에서 같은 명령(PID B) → 탭 A로 돌아가
         `PID=<A>`가 보인다 → 인박스에 다녀와도(사이드바 `인박스` → workspace 버튼) 그 repo의 마지막 탭(B)이 보이고 `PID=<B>`가 그대로다 → **탭 B를 닫는다**
         (`<B 이름> 터미널 닫기` → `정말 닫기`) → PID B는 10초 안에 없고 PID A는 산다(`process.kill(pid, 0)`) → 앱을 끈다 → PID A도 없다.
      3. 상한: `새 터미널`을 일곱 번(첫 탭 포함 8) → `새 터미널`의 `aria-disabled="true"`와 `title` → 하나를 닫으면 풀린다. (셸 여덟을 띄우므로 이 시나리오는
         셸이 준비될 때까지 기다리지 않는다 — 탭 수와 잠김만 본다.)
      4. (Git Bash가 있는 장비에서만 — `셸 고르기` 메뉴에 `Git Bash`가 있을 때) 그 탭에서 `echo "gb-$((40+2))"` → `gb-42`. 없으면 `it.skipIf`가 아니라 메뉴를
         열어 본 뒤 건너뛰고 그 사실을 출력에 남긴다(장비에 따라 조용히 빠지지 않게).
    - `e2e/wsl.e2e.ts`(가짜 wsl.exe) 전체 초록 — 터미널 셀렉터가 바뀐 곳이 있으면 고친다.
    - 전체 `pnpm test:e2e` 초록(이름 충돌은 전체에서만 드러난다 — CLAUDE.md).
    - 확인: 0단계보다 테스트 수가 는 채로 전부 통과.

11. **WSL 실측** — `ONE_DESK_REAL_WSL=1 pnpm test:e2e wsl-real`(이 장비: Ubuntu-24.04, 메모리 `wsl-dev-environment`). 기존 5단계(터미널)에 더한다: WSL repo의
    `셸 고르기` 메뉴에 줄이 `WSL · Ubuntu-24.04` 하나 · `새 터미널`로 둘째 WSL 탭 → 둘째 탭에서 `python3 -c 'import time; time.sleep(9999)' &` → 그 탭을 닫으면
    그 프로세스가 끝나고(세션째 — `pgrep -f`로) 첫째 탭은 산다 · pidfile 둘(`term-<tabId>.pid`)이 각자의 것이다. 관찰은 `ONE_DESK_REAL_WSL_OUT`에 남는다.
    - 확인: 그 e2e 초록과 관찰 파일.

12. **캡처** — 라이트·다크(`page.emulateMedia` — 메모리 `e2e-capture-dark-mode`), 1440×900: 탭 셋(pwsh · cmd · pwsh 2, 하나는 끝남), 메뉴 열림, 빈 칸.
    칸 하한 320px에 탭 8개(가로 스크롤과 머리 두 줄). 탭 전환이 눈에 띄게 늦는지(512 KiB를 채운 탭 — `1..20000 | % { "line $_" }`) 본다(spec §6의 1).
    OS 단추는 `page.screenshot`에 찍히지 않으므로 제목 줄은 화면 영역으로 찍는다(CLAUDE.md). 확인 뒤 임시 캡처를 지운다.
    - 확인: 캡처를 보고 고친 것을 "달라진 것"에 적는다.

13. **문서** — CLAUDE.md(현재 상태의 터미널 절: "셸은 repo당 하나" → 탭, 함정 절의 터미널 항목에 Git Bash 찾기·키 등록부·`term-<tabId>`·띄우는 중 끝내기, 문서 표에
    이 디렉토리), `docs/sdlc/code-editor/terminal-spec.md` 머리에 "FR-5·FR-11은 `terminal-tabs`가 뒤집었다" 한 줄, 이 plan의 완료 증명.
    - 확인: `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm test:e2e` 마지막으로 한 번 더 초록.

## 바뀌는 파일

`shared/models.ts` · `shared/terminal.test.ts`(새) · `shared/{channels,client}.ts` · `core/terminal/{shell,service}.ts`(+test) · `core/index.ts`(+test) ·
`electron/preload.ts` · `electron/ipc/terminal.ts` · `renderer/code/terminalStream.ts`(+test) · `renderer/code/terminalTabs.ts`(+test, 새) ·
`renderer/components/code/{TerminalPane,TerminalTabView}.tsx`(+test) · `renderer/components/SettingsPanel.tsx` · `renderer/index.css` · `DESIGN.md` ·
`e2e/terminal.e2e.ts` · `e2e/wsl-real.e2e.ts` · `CLAUDE.md` · `docs/sdlc/code-editor/terminal-spec.md`(머리 한 줄) · 이 plan.

`electron/main.ts`·`Dock.tsx`·`buffer.ts`·`core/wsl/`·`package.json`은 바뀌지 않는다.

## 변이 (되돌려 빨개지는지 볼 것)

| 망가뜨릴 줄 | 빨개져야 할 테스트 |
|---|---|
| `findGitBash`가 PATH의 `bash`를 먼저 본다 | System32 `bash.exe`만 있는 장비에서 Git Bash가 없다 |
| WSL 자리 거름(`SystemRoot`·`WindowsApps`)을 지운다 | `WindowsApps\bash.exe`는 Git Bash가 아니다 |
| `mingw64\bin`을 루트 거슬러 오르기에서 뺀다 | `mingw64\bin\git.exe`에서 Git Bash를 찾는다 |
| cmd 경로를 `ComSpec`에서 읽는다 | cmd는 `ComSpec`을 따르지 않는다 |
| `resolveShellKey`가 목록 밖의 키를 받아 준다 | WSL repo의 `cmd` · 없는 `git-bash`가 셸을 띄우기 전에 던진다 |
| `isDefault`를 `default` 해석이 아니라 첫 줄로 | `기본` 표식이 설정의 셸을 따른다 |
| `shells`의 키를 `tabId`가 아니라 `repoId`로 | 같은 repo의 탭 둘이 따로 쓰고 따로 출력한다 |
| `open`이 탭이 있어도 새로 띄운다 | 다시 열면 같은 목록, 동시에 두 번 열어도 하나 |
| 상한이 띄우는 중을 세지 않는다 | 7개에서 두 번 동시에 만들면 하나는 거부 |
| 상한이 끝난 탭을 세지 않는다 | 끝난 탭도 센다 |
| `restart`가 새 탭 id를 만든다 | 다시 시작은 탭 id와 자리를 지킨다 |
| `restart`가 탭의 키가 아니라 `default`로 푼다 | cmd 탭을 다시 시작하면 cmd다 |
| `killRepo`가 첫 탭만 끝낸다 | repo를 지우면 탭 셋이 다 끝난다 |
| 띄우는 중 끝내기 검사를 지운다 | `killRepo` 뒤에 돌아온 셸은 곧바로 끝나고 목록에 없다 |
| `killAll`이 비동기 `killTree`를 쓴다 | 앱 종료는 탭마다 동기 트리 종료다 |
| WSL pidfile 이름을 `term-<repoId>`로 되돌린다 | WSL 탭 둘이 서로 다른 pidfile을 겨눈다 (core·index 둘 다) |
| `attach`가 workspace를 보지 않는다 | 남의 workspace로 붙을 수 없다 |
| `nextTabLabel`이 늘 개수+1을 붙인다 | 빈 번호를 채운다 |
| `terminalStream`이 `tabId`를 보지 않는다 | 다른 탭의 조각을 버린다 |
| `nextActiveAfterClose`가 늘 첫 탭으로 | 보던 탭을 닫으면 오른쪽 |
| 칸이 보이지 않는 탭의 끝남을 버린다 | 보이지 않는 탭이 끝나면 탭 줄이 끝남을 보인다 |
| 도는 탭 닫기를 `ConfirmButton` 대신 버튼으로 | 도는 탭은 두 번 눌러야 닫힌다 |
| `+`의 잠금이 `TERMINAL_TABS_PER_REPO` 대신 다른 수 | 8개면 잠기고 `title`이 이유를 말한다 |
| 메뉴 Esc의 `stopPropagation`을 지운다 | 메뉴를 닫는 Esc는 도크 최대화를 풀지 않는다 |
| e2e: 탭 닫기가 `killTree` 대신 pty kill만 | 탭을 닫으면 그 탭의 `node`가 끝난다 (Windows e2e) |

## 위험

1. **e2e가 셸 여덟을 띄운다**(상한 시나리오). PowerShell 하나가 프로필로 3초쯤 걸리는 장비라 여덟이면 칸이 한동안 바쁘다 — 그 시나리오는 셸이 준비될 때까지
   기다리지 않고 탭 수만 본다. 그래도 느리면 상한 시나리오는 cmd로 연다(가볍다).
2. **Git Bash 시나리오는 장비를 탄다.** CI의 `windows-2022` 러너에는 Git이 있으므로 돈다(그 러너의 Git은 `C:\Program Files\Git`). 로컬에 없으면 건너뛰고 출력에
   남긴다(10단계의 4).
3. **`cmd.exe`의 되울림과 출력이 한 줄에 섞일 수 있다** — ConPTY가 줄을 다시 그리므로 출력 비교는 `.xterm-rows`의 글자로만 한다(앞 사이클 위험 2와 같다).
   `%OS%`가 되울림에 그대로 남는지 첫 실행에서 본다 — cmd의 줄 편집이 `%`를 펼치지 않는다는 것은 추정이다.
4. **`TerminalPane`이 커진다** — 탭 줄·메뉴·빈 칸만 두고, 붙기·끝남·다시 시작은 `TerminalTabView`에, 고르기 규칙은 `terminalTabs.ts`의 순수 함수에 둔다.
   Dock은 건드리지 않는다.
5. **앞 사이클 테스트를 고쳐 쓰는 단계(3·4·10)는 약속을 지우기 쉬운 자리다** — 옮긴 테스트마다 앞 사이클의 FR 번호를 그대로 달고, 변이 표의 줄로 다시 확인한다.
6. **띄우는 중 끝내기(FR-19)의 테스트는 순서에 기댄다** — 가짜 `resolveShell`을 미뤄 둔 프로미스로 두고, `killRepo` 뒤에 풀어 spawn이 돌아오게 한다. 진짜 타이머를
   쓰지 않는다(`vi.useFakeTimers`가 이미 켜져 있다, `service.test.ts:82`).

## 완료 증명

구현 2026-10-27, 브랜치 `feat/terminal-tabs`(worktree `D:\Workspace\one-desk-tabs`, main `55954c0` 위). 커밋은 단계마다 하나(10단계는 둘).

**기준선 (0단계).** `pnpm typecheck`·`pnpm lint` 초록, `pnpm test` 180 files / 3114 passed · 49 skipped, `pnpm test:e2e` 34 files 중 30 통과 ·
67 tests 중 62 통과 · 1 실패 · 4 skipped(238초). 실패 하나는 `workspace-defaults.e2e`의 `{ name: '설정' }`이 홈의 `설정에서 경로 지정`과 부분 일치한
strict 위반으로, 이 작업과 무관하고 다음 전체 실행 두 번에서 통과했다(경합 — 고치지 않았다). 이 장비: PATH의 첫 `git`은
`C:\Program Files\Git\mingw64\bin\git.exe`(다음이 `…\Git\cmd\git.exe`), `C:\Program Files\Git\bin\bash.exe` 있음, `C:\Windows\System32\bash.exe` 없음.

**테스트 먼저.** 단계마다 테스트를 먼저 쓰고 빨간 것을 본 뒤 구현했다 — 1단계 `isTerminalShellKey` 없음(2 failed), 2단계 `findGitBash is not a function`
(28 failed), 7단계 옛 `TerminalPane.test`가 새 칸에서 12 failed. 3·4단계는 테스트를 통째로 다시 써 옛 서비스로는 컴파일되지 않았고, 그 대신 아래
변이로 각 줄을 확인했다.

**마지막 실행.** `pnpm typecheck` 초록 · `pnpm lint` 초록 · `pnpm test` **182 files passed · 2 skipped / 3180 passed · 49 skipped** ·
`pnpm test:e2e` **31 files passed · 3 skipped / 67 passed · 4 skipped (254초)** — 기준선보다 테스트 넷(터미널 탭 시나리오)이 늘었다. 경계 grep 둘 출력 없음.
e2e가 끝난 뒤 `setInterval(()=>{},1e9)` node 프로세스 0개.

**WSL 실측 (11단계).** `ONE_DESK_REAL_WSL=1`, Ubuntu-24.04 — 1 passed, 관찰은 `e2e/artifacts/wsl-real-tabs/observations.json`. `5d-terminal-tabs`:
메뉴 줄은 `WSL · Ubuntu-24.04` 하나(+`기본`), 둘째 탭 이름 `wsl · Ubuntu-24.04 2`, pidfile 둘(`term-1e72f125-….pid`·`term-76a5ac6a-….pid`, 세션 1080·844),
둘째 탭의 `python3 … sleep(13013) &`(pid 1103)는 그 탭을 닫으니 사라지고 첫 탭의 셸은 살았다. 9단계(앱 종료 뒤) `wslLeft`·`winLeft` 빈 문자열, 5c의 백그라운드
작업 여섯 모두 끝남. 나머지 단계(MCP·큰 출력·취소)도 전부 ok.

**변이.** 망가뜨리고 돌려 빨강을 본 뒤 되돌렸다(`node scratchpad/mutate.mjs` — 바꾸고, vitest를 돌리고, 되돌린다).

| 망가뜨린 줄 | 결과 |
|---|---|
| `findGitBash`가 PATH의 `bash`를 먼저 본다 | 빨강 — System32 bash.exe만 있는 장비 |
| WSL 자리 거름을 지운다 | 빨강 — SystemRoot·WindowsApps 아래 |
| `mingw64\bin` 거슬러 오르기를 뺀다 | 빨강 — mingw64\bin |
| cmd를 `ComSpec`에서 | 빨강 — cmd는 ComSpec을 따르지 않는다 |
| WSL에서 목록 밖의 키를 받아 준다 | 빨강 — WSL repo의 cmd |
| `isDefault`를 첫 줄로 | 빨강 — 기본 표식은 설정이 풀린 셸 |
| `nextTabLabel`이 개수+1 | 빨강 — 빈 번호 채우기 |
| `shells` 키를 repoId로 | 빨강 23 |
| `open`이 탭이 있어도 띄운다 | 빨강 6 |
| 상한이 띄우는 중을 세지 않는다 | 빨강 — 동시에 두 번 |
| 상한이 끝난 탭을 세지 않는다 | 빨강 — 끝난 탭도 센다 |
| `restart`가 새 탭 id | 빨강 6 |
| `restart`가 `default`로 푼다 | 빨강 — cmd 탭을 다시 시작하면 cmd |
| `killRepo`가 첫 탭만 | 빨강 — 탭 셋이 다 끝난다 |
| 띄우는 중 끝내기 검사를 지운다 | 빨강 3 (repo 끝내기·앱 종료·다시 시작 중 닫기) |
| `killAll`이 비동기 | 빨강 2 |
| WSL pidfile을 `term-<repoId>`로 (service) | 빨강 5 |
| WSL pidfile을 하나로 (core/index) | 빨강 2 |
| `attach`가 workspace를 보지 않는다 | 빨강 2 |
| core/index: 메뉴의 기본 표식에 다른 해석 | 빨강 — `기본` 표식은 설정 화면이 말하는 셸 |
| core/index: 키 해석 없이 설정의 셸 | 빨강 2 |
| `terminalStream`이 tabId를 보지 않는다 | **처음엔 살았다** — 그 테스트의 다른 탭 조각이 이미 쓴 범위라 위치 규칙에 걸렸다. 이어 쓸 자리(3)로 고친 뒤 빨강 |
| `nextActiveAfterClose`가 첫 탭으로 | 빨강 |
| `pickTab`이 기억을 보지 않는다 | 빨강 |
| 칸이 보이지 않는 탭의 끝남을 버린다 | 빨강 |
| 도는 탭 닫기를 한 번 누르기로 | 빨강 |
| 잠금을 다른 수(9)로 | 빨강 |
| 메뉴 Esc의 `stopPropagation`을 지운다 | **살았다** — 칸 `<section>`의 Esc 규칙이 이미 감싼다. 그 줄을 지웠다(달라진 것 2) |
| 닫은 뒤 볼 탭을 정하지 않는다 | 빨강 |
| 본 탭을 기억하지 않는다 | 빨강 |
| 붙은 셸 크기를 맞추지 않는다 | 빨강 |
| 다시 시작 응답을 탭 줄에 반영하지 않는다 | 빨강 2 |
| e2e: 탭 닫기가 pty kill만 | **처음엔 살았다** — ConPTY가 콘솔 자식을 같이 끝낸다. 콘솔 밖(detached) 손자로 바꾼 뒤 빨강(`expected 'alive' to be 'gone'`) — 달라진 것 3 |

**캡처 (12단계).** `e2e/artifacts/terminal-tabs/` — `tabs-{light,dark}.png`(powershell · 끝난 cmd · powershell 2, 512 KiB 가까이 찬 탭), `menu-{light,dark}.png`,
`narrow-8-{light,dark}.png`(칸 하한에 탭 8개), `empty-{light,dark}.png`, WSL은 `e2e/artifacts/wsl-real-tabs/5d-terminal-tabs.png`. 20,000줄(약 220 KB)
찬 탭으로 돌아오는 데 76 ms(클릭부터 마지막 줄이 보일 때까지, 20 ms 간격 poll) — spec §6의 1의 우려는 이 크기에서 드러나지 않았다.

## 달라진 것

1. **캡처로 고친 것 둘.** 넘친 탭 줄에서 새로 연 탭이 오른쪽 밖에 섰고, 칸을 좁히면 보던 탭이 다시 밖으로 밀렸다 — 보이는 탭(이름 + 닫기)을 `scrollIntoView`
   하고 탭 줄 폭이 바뀔 때도 다시 데려온다(ResizeObserver). Chromium의 가로 스크롤바가 화살표와 함께 굵게 그려져 숨기고 세로 휠로 민다. 탭 줄과
   repo 이름 사이에 `--border-faint` 선을 그었다(잘린 탭 조각이 `api 2`처럼 이름에 붙어 읽혔다).
2. **메뉴의 Esc가 `stopPropagation`을 하지 않는다.** plan 7단계는 "메뉴의 Esc는 `preventDefault`+`stopPropagation`"이었지만 메뉴는 칸 안에 그려지고 칸이
   Esc를 이미 막아 그 줄을 지워도 아무 테스트도 빨개지지 않았다. 지우고, 행동은 "메뉴를 닫는 Esc는 메뉴만 닫는다 — 칸 밖으로 새지 않는다"가 지킨다
   (메뉴를 칸 밖으로 옮기면 그것이 빨개진다).
3. **e2e의 탭 닫기 확인은 Windows에서 콘솔 밖 손자다.** plan 10단계의 "탭 B의 `node`가 끝난다"는 트리 종료 없이도 성립했다(ConPTY). 탭 B는 `detached`
   손자를 띄워 그 pid를 본다. posix는 닫기가 pty kill이라(FR-18) 평범한 node 그대로다.
4. **다시 시작이 셸을 못 띄우면 그 탭은 core에서 사라진다**(spec에 없던 경우). 끝낸 셸을 도는 것처럼 남기지 않으려는 것이고, 칸은 이유를 보인 채 목록을
   다시 읽는다. 오류 줄은 칸 하나(`TerminalPane`)에 모았다 — 열기·만들기·붙기·다시 시작·닫기의 실패가 같은 `role="alert"`이고 `다시 시도`는 목록을
   다시 읽는다.
5. **붙은 뒤 셸 크기를 맞춘다.** 칸은 xterm을 재기 전에 `open`을 부르므로 첫 탭은 80×24로 뜬다 — `TerminalTabView`가 붙자마자 `resize`를 보낸다
   (xterm의 첫 fit은 `onResize`를 내지 않는다). 새 탭은 마지막으로 잰 크기로 연다.
6. **이름.** plan의 `keepLabel(oldLabel, newBase)`는 `restartLabel({ base, label }, newBase, others)`다(다르면 새로 매기려면 다른 탭 이름이 필요하다).
   WSL repo의 `resolveShellKey`는 distro 안의 명령(`sh -c 'exec "${SHELL:-/bin/bash}" -l'`)을 돌려주고 wsl.exe로 감싸기는 서비스가 한다(런처·pidfile이
   탭마다라). 메뉴 줄 WSL의 `path`(title)는 `wsl.exe -d <distro>`다.
7. **머리에서 셸 이름 글자(`.terminal-shell`)가 없어졌다** — 탭 이름이 셸 이름이고 전체 경로는 탭의 `title`이다. 옛 e2e 셋째 시나리오는 보이는 탭의 이름을 본다.
8. **`terminal.e2e`의 "설정에서 셸을 바꾸면"은 placeholder가 기본값을 말할 때까지 기다린 뒤 친다** — 전체 e2e 한 번에서 설정을 읽기 전에 친 글자가 덮여 저장이
   잠긴 채 깨졌다(앞 사이클부터 있던 경합).
