# Plan: 코드 칸 — 터미널 (2/3)

- 출처: `terminal-spec.md` (승인 2026-10-10)
- 상태: 승인 (2026-10-10, 사용자 — "좋아 커밋하고 0단계부터 구현 시작해")

## 순서

각 단계는 테스트를 먼저 쓰고 빨간 것을 본 뒤 구현한다. 회귀 테스트는 대상 줄을 망가뜨려 빨개지는지 본다(아래 "변이").

0. **기준선과 의존성** — typecheck·lint·단위·전체 e2e가 초록인지 본다. 그다음 의존성을 더한다: `node-pty` 1.1.0(**dependencies** —
   패키징에 실린다, better-sqlite3와 같은 자리), `@xterm/xterm` 6.0.0 · `@xterm/addon-fit` 0.11.0(devDependencies — 렌더러 번들).
   `pnpm.onlyBuiltDependencies`에 `node-pty`(설치 스크립트 `prebuild.js || node-gyp rebuild`가 사전 빌드를 고르게), `electron-builder.yml`의
   `asarUnpack`에 `'**/node_modules/node-pty/**'`. 확인: `pnpm install` 로그에 컴파일이 없다(사전 빌드를 골랐다), `pnpm dev`로 띄운
   메인 프로세스에서 `node-pty`가 로드된다, postinstall의 `electron-rebuild -w better-sqlite3`가 node-pty를 건드리지 않는다.
1. **셸 해석** `core/terminal/shell.ts` + 테스트 (spec FR-11~13·19)
   - `resolveShell(setting, { platform, env, find })` → `{ file, args, name }` — 설정 경로가 있으면 그것, 없으면 기본값(Windows: PATH의
     `pwsh.exe` → `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`, posix: `$SHELL` → `/bin/bash`). PATH 탐색은
     `executable.ts`의 `findExecutable`을 주입한다(`platform` 인자로 Windows·posix 둘 다 개발 장비에서 본다 — CLAUDE.md의 `win32`/`posix` 함정).
   - `shellArgs(file)` — basename이 `bash`·`zsh`·`sh`·`fish`면 로그인 셸(Git Bash `bash.exe`는 `--login -i`, 나머지 `-l`), 그 밖은 없음.
   - `shellEnv(env)` — `ONE_DESK_*`·`ELECTRON_*`를 빼고 `TERM=xterm-256color`.
2. **출력 버퍼** `core/terminal/buffer.ts` + 테스트 (FR-6)
   - 셸마다 하나. 지금까지 받은 글자의 **누적 위치**(`end`)와 최근 512 KiB(UTF-16 길이로 잰다 — `string.length`)를 쥔다. `snapshot()` →
     `{ text, end }`, 넘치면 앞에서부터 버린다(버린 길이만큼 `start`가 는다). 서로게이트 쌍을 가르지 않는다.
3. **셸 서비스** `core/terminal/service.ts` + 테스트 — 가짜 pty로 (FR-5~10·18·20)
   - 의존: `spawnPty`, `resolveShell`, `repoOf(workspaceId, repoId)`(그 workspace의 repo가 아니면 던진다 — 파일 칸의 `ownedRepo`와 같다),
     `killTree`(비동기)·`killTreeSync`, `emit`(이벤트), `platform`, 타이머.
   - `open({ workspaceId, repoId, cols, rows })` — 그 repo의 셸이 없으면 띄우고(cwd = repo 경로), 있으면 그대로. 돌려주는 것:
     `{ repoId, generation, shell, snapshot: { text, end }, exited: { exitCode } | null }`. **셸 키는 repo id 하나다**(repo당 하나).
   - `write(repoId, data)`·`resize(repoId, cols, rows)` — 서비스가 띄운 셸이 아니거나 끝난 셸이면 거부(쓰기)/무시(크기).
   - 출력은 버퍼에 쌓고 **16ms마다 모아** `{ repoId, generation, start, data }`(start = 이 조각의 누적 시작 위치)로 낸다. 끝나면
     모은 것을 먼저 내고 `{ repoId, generation, exitCode }`를 낸다.
   - `restart(repoId)` — 도는 셸을 트리째 끝내고(`killTree`) `generation`을 올려 새로 띄운다. 옛 셸의 늦은 출력·끝남은 generation으로 버린다.
   - `killRepo(repoId)`(FR-10)·`killAll()`(FR-9 — **`killTreeSync`**, 앱 종료 경로), 끝낸 셸은 목록에서 지운다.
4. **core 배선** `core/index.ts` · `core/db/repositories/setting.ts` + 테스트
   - `CoreOptions.spawnPty`(**필수** — 선택이면 main의 한 줄을 빠뜨려도 조용히 컴파일되고 터미널만 죽는다. `homeDir`와 같은 규칙).
     `core/index.test.ts`의 `open()`은 가짜를 넘긴다.
   - 설정 키 `terminal.shell`(`TERMINAL_SHELL_KEY`) — `settings.terminalShell()` → `{ path: string | null, resolved: string | null }`
     (resolved는 placeholder가 말할 지금의 셸), `setTerminalShell(path | null)` — 빈 문자열은 null, 없는 파일이면 던진다.
   - `repos.remove`·`repos.update`(경로가 바뀔 때)·`workspaces.remove`(지우기 전에 그 repo 목록을 읽어 둔다)가 `killRepo`를 부른다.
     `shutdown()`이 `manager.cancelAll()` 다음에 `terminal.killAll()`.
   - 이벤트 `onTerminalData`·`onTerminalExit`(core의 emitter, 다른 push와 같은 모양).
5. **통로** — `shared/models.ts`(`TerminalOpenInput`·`TerminalSession`·`TerminalData`·`TerminalExit`), `shared/channels.ts`
   (`terminal:open`·`write`·`resize`·`restart`, push `event:terminalData`·`event:terminalExit`, `settings:terminalShell`·`setTerminalShell`),
   `shared/client.ts`, `electron/preload.ts`, `electron/ipc/terminal.ts`(새 — core 호출 한 줄씩, push는 **`getMainWindow`로만**),
   `electron/main.ts`가 `node-pty`의 `spawn`을 넘긴다. `write`는 `ipcRenderer.send`(응답을 기다리지 않는 한 방향 — 키마다 왕복하지 않는다),
   나머지는 `invoke`.
6. **칸 종류와 버튼** — `renderer/code/layout.ts`(`PaneKind = 'files' | 'terminal'`, 모르는 값은 닫힘 그대로), `icons.tsx`(`IconTerminal`),
   `Dock`(제목 줄 버튼 둘 — `터미널`이 `파일` 왼쪽, 같은 종류를 다시 누르면 닫힘·다른 종류면 바뀜, 칸 안에 `TerminalPane` 또는
   `FilePane`) + `Dock.test`. 칸의 폭·자리·기억은 그대로 공유한다.
7. **터미널 칸** + 테스트
   - 출력 이어 붙이기 `renderer/code/terminalStream.ts`(순수 함수): 칸은 **열기 전에 구독부터** 하고 그 사이 온 조각을 모아 두었다가,
     스냅샷을 받으면 `end`보다 앞의 조각(또는 조각의 앞부분)을 버리고 나머지를 이어 쓴다. 다른 generation의 조각은 버린다. 테스트:
     겹친 조각을 잘라 쓴다 · 스냅샷 전에 온 조각 · 옛 generation · 순서가 맞는 조각은 그대로.
   - `TerminalView.tsx`(xterm을 감싸는 얇은 껍데기, **지연 로드** — 편집기와 같은 `React.lazy`) — `write`·`fit`·키 처리(선택이 있으면
     Ctrl+C는 복사, Ctrl+V 붙여넣기), 테마는 CSS 토큰을 읽고 `prefers-color-scheme`이 바뀌면 다시 읽는다, 크기가 바뀌면
     (ResizeObserver) fit → `resize` IPC(디바운스).
   - `TerminalPane.tsx` — 머리(repo 이름 · 셸 이름 · `셸 다시 시작`(ConfirmButton) · `코드 칸 닫기`), 열기·구독·이어 붙이기, 끝남 줄
     (`셸이 끝났습니다 (종료 코드 N)` + `셸 다시 시작`), 칸 안의 Esc는 `preventDefault`+`stopPropagation`.
   - `TerminalPane.test`는 `TerminalView`를 `vi.mock`으로 바꾼다(jsdom에서 xterm을 그릴 수 없다 — 편집기와 같다): 열기 인자, 스냅샷을
     쓰고 그 뒤 조각만 이어 씀, 끝남과 다시 시작, 대상 repo가 바뀌면 다른 셸을 연다, Esc가 밖으로 새지 않는다.
8. **설정 앱 탭** — `터미널 셸` 절(경로 칸 + `터미널 셸 저장`, placeholder `기본값: …`, 없는 파일이면 그 절에 오류). 초안 state는
   `SettingsPanel`이 쥔다(CLAUDE.md — 탭 전환이 언마운트다). `SettingsPanel.test`.
9. **CSS·DESIGN.md** — 터미널 칸(머리는 파일 칸과 같은 결, 본문은 `--bg`, 안쪽 여백 8px), 끝남 줄, 제목 줄 버튼 둘. 토큰만.
10. **e2e** `e2e/terminal.e2e.ts`(진짜 셸) + 전체 e2e
    - 터미널을 열어 `echo one-desk-terminal`의 출력이 `.xterm-rows`에 보인다.
    - repo 둘: 다른 repo의 대화로 옮기면 다른 셸, 돌아오면 앞의 출력이 남아 있다. 파일 칸으로 바꿨다 돌아와도 같은 셸이다.
    - `셸 다시 시작` 뒤 앞의 출력이 없다. `exit`를 치면 끝남 줄이 선다.
    - 설정에서 셸 경로를 바꾸면(Windows는 `cmd.exe`) 다시 시작한 셸이 그것이다.
    - **앱을 끄면 셸이 띄운 자식이 남지 않는다** — 셸에서 `node -e "console.log('PID='+process.pid); setInterval(()=>{},1e9)"`를 띄워
      출력의 pid를 읽고, 앱을 닫은 뒤 그 pid가 없는지 본다(`process.kill(pid, 0)`이 던진다).
11. **패키징 확인** — `pnpm run pack`의 `dist/win-unpacked/one-desk.exe`를 임시 Playwright 스크립트로 띄워 터미널에서 `echo`가 돈다
    (asar 밖에 둔 `conpty.dll`·`OpenConsole.exe`를 실제로 찾는다). 임시 스크립트는 저장소에 넣지 않는다.
12. **캡처** 라이트·다크(터미널 칸, 끝남 줄, 제목 줄 버튼 둘, 설정 절) → 확인 → 임시 캡처 삭제.
13. **문서** — CLAUDE.md(현재 상태 · 함정 · 문서 표), DESIGN.md, 이 plan의 완료 증명.

## 바뀌는 파일

`package.json`·`pnpm-lock.yaml`·`electron-builder.yml` · `core/terminal/{shell,buffer,service}.ts`(+test, 새) · `core/index.ts`(+test) ·
`core/db/repositories/setting.ts`(+test) · `shared/{models,channels,client}.ts` · `electron/{preload,main}.ts` · `electron/ipc/{index,terminal}.ts` ·
`renderer/code/{layout,terminalStream}.ts`(+test) · `renderer/components/icons.tsx` · `renderer/components/Dock.tsx`(+test) ·
`renderer/components/code/{TerminalPane,TerminalView}.tsx`(+test, 새) · `renderer/components/SettingsPanel.tsx`(+test) · `renderer/index.css` ·
`e2e/terminal.e2e.ts`(새) · `CLAUDE.md` · `DESIGN.md` · 이 plan.

## 변이 (되돌려 빨개지는지 볼 것)

| 망가뜨릴 줄 | 빨개져야 할 테스트 |
|---|---|
| 셸 키를 repo id가 아니라 `open` 호출마다 새로 | repo당 하나 — 두 번 열면 같은 셸(FR-5) |
| 버퍼 상한을 지움 | 512 KiB를 넘으면 앞을 버린다(FR-6) |
| 모아 보내기를 지우고 받는 대로 emit | 16ms 안의 조각은 한 번에 나간다(FR-20) |
| `restart`가 generation을 올리지 않음 | 옛 셸의 늦은 출력은 버린다 |
| `killAll`이 비동기 `killTree`를 씀 | 앱 종료는 동기 트리 종료다(FR-9) |
| `repos.remove`의 `killRepo` 한 줄을 지움 | repo를 지우면 그 셸이 끝난다(FR-10) |
| `shellEnv`가 `ONE_DESK_*`를 남김 | 앱 내부 변수를 뺀다(FR-19) |
| `repoOf`가 workspace를 보지 않음 | 남의 workspace repo는 열 수 없다(FR-18) |
| 이어 붙이기가 `end` 앞의 조각을 버리지 않음 | 겹친 출력이 두 번 찍히지 않는다 |
| 같은 종류 버튼을 다시 눌러도 닫히지 않음 | 같은 종류를 다시 누르면 닫힌다(FR-2) |
| 칸의 Esc `stopPropagation`을 지움 | Esc가 도크 최대화를 풀지 않는다(FR-16) |
| main이 `spawnPty`를 넘기지 않음 | 컴파일이 깨진다(필수 인자) |

## 위험

1. **`node-pty`가 ESM 메인에서 로드되는가.** 메인은 `"type": "module"`이고 node-pty는 CommonJS다 — better-sqlite3와 같은 처지라
   default import 상호운용으로 될 것이지만 0단계에서 `pnpm dev`로 먼저 본다. electron-vite가 dependencies를 외부로 두므로 번들에 들어가지 않는다.
2. **PowerShell은 뜨는 데 1~2초 걸리고 프로필이 무엇을 찍을지 모른다.** e2e는 프롬프트 모양에 기대지 않고 `echo`의 고유 문자열만
   기다린다(넉넉한 타임아웃). ConPTY는 처음에 화면 지우기 같은 제어 문자를 내므로 출력 비교는 `.xterm-rows`의 글자로만 한다.
3. **pnpm의 node_modules 배치에서 electron-builder가 node-pty의 사전 빌드 파일(.dll·.exe)을 싣는가.** better-sqlite3는 `.node` 하나라
   드러나지 않던 문제다 — 11단계가 패키징한 앱으로 본다. 빠지면 `files`/`extraResources`로 명시한다.
4. **e2e가 진짜 셸을 띄운다.** 개발자의 셸 프로필이 결과에 섞일 수 있다 — e2e는 설정에서 셸을 명시하지 않으면 기본값(pwsh/powershell)을
   쓰고, 고유 문자열만 본다. 앱을 끌 때 남는 프로세스가 없는지는 10단계의 pid 확인이 본다(남으면 e2e 장비에 쌓인다).
5. **jsdom에서는 xterm을 그릴 수 없다** — `TerminalView`에 판정을 두지 않는다. 키 처리(Ctrl+C 복사)·fit·테마는 e2e와 캡처로만 본다.
6. **Dock이 커진다** — 칸 종류 분기만 두고, 터미널의 열기·구독·이어 붙이기는 `TerminalPane`과 순수 함수에 둔다.

## 완료 증명

(구현 뒤에 채운다)
