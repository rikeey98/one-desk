# Spec: 터미널 탭 — repo마다 여러 셸, 탭을 열 때 셸 고르기

- 출처: `intent.md` (승인 2026-10-27, 사용자 "spec 만들어줘 개발")
- 앞 사이클: `docs/sdlc/code-editor/terminal-spec.md` · `terminal-plan.md` (터미널, 구현 완료 — 이 spec이 그 FR-5·FR-11을 뒤집는다)
- 작성자: 권용현 (초안: Claude)
- 상태: **승인됨** (2026-10-27, 사용자 "spect 만들어줘 개발") — 구현 전. 사용자가 뒤집을 수 있는 결정은 §0-B에 모았다
- 작성일: 2026-10-27
- 적용한 규칙: CLAUDE.md의 세 경계, 렌더러는 이름만 넘긴다(`core/app/reveal.ts`), Windows 트리 종료(`taskkill /T /F`, 앱 종료는 동기),
  WSL 터미널은 세션째(`pkill -s`), push는 앱 창에만(item-windows FR-17), e2e 이름 충돌, 아이콘·색 토큰

## 0-A. intent의 미해결 질문에 대한 답

| 질문 | 답 | 자리 |
|---|---|---|
| 셸 목록을 어떻게 찾나 | core의 `discoverShells` 하나가 **키가 붙은 선택지 목록**을 만든다. Windows: `pwsh`는 PATH 탐색(지금 기본값과 같은 `findExecutable`), Windows PowerShell은 `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`, cmd는 `%SystemRoot%\System32\cmd.exe`, Git Bash는 아래 규칙. macOS·Linux는 `$SHELL` 하나. WSL repo는 그 distro의 셸 하나 | FR-8~12 |
| Git Bash와 WSL의 `bash.exe`를 어떻게 가르나 | **PATH의 `bash`는 아예 보지 않는다.** PATH의 `git.exe`에서 Git 설치 루트를 거슬러 올라가 `<루트>\bin\bash.exe`를, 그리고 고정 설치 자리 셋을 본다. 그 결과가 `%SystemRoot%` 아래이거나 `%LOCALAPPDATA%\Microsoft\WindowsApps` 아래면 버린다(둘 다 WSL의 `bash.exe`가 사는 자리다) | FR-10 |
| repo를 옮겼다 돌아오면 어느 탭이 보이나 | **그 repo에서 마지막으로 본 탭.** 이 장비의 localStorage에 repo id마다 탭 id 하나(`renderer/code/terminalTabs.ts`). 그 탭이 없으면(닫았거나 앱을 다시 켰다) 맨 왼쪽 탭 | FR-6 |
| 탭이 스스로 끝났을 때(`exit`) | **탭을 닫지 않는다.** 출력과 함께 남고, 끝남 줄의 `셸 다시 시작`이 같은 탭에 같은 셸을 새로 띄운다(지금 규칙 그대로). 탭 줄에서 그 탭은 끝남 표시(흐린 점 + `title`)를 단다. 닫기는 탭의 닫기 버튼이다 | FR-4·FR-17 |
| 탭 수 상한과 넘었을 때의 `+` | **repo당 8.** `shared/`의 상수 하나(`TERMINAL_TABS_PER_REPO`)를 core가 거부에, 렌더러가 버튼 잠금에 쓴다. 8개면 `+`와 셸 고르기가 `aria-disabled`이고 `title`이 이유(`터미널은 repo당 8개까지입니다 — 하나를 닫으세요`)를 말한다. 끝난 탭도 센다 | FR-3 |
| 출력 push와 IPC를 무엇으로 가르나 | `repoId` 자리에 **`tabId`**. `generation`은 그대로 남는다 — 탭 id는 `셸 다시 시작`을 넘어 그대로이고 generation이 그 탭 안의 셸을 가른다. 칸의 이어 붙이기 규칙(`terminalStream.ts`)은 키 이름만 바뀐다 | FR-13·FR-14 |

## 0-B. 이 spec이 정한 것 — 사용자가 뒤집을 수 있다

1. **`+`는 두 버튼이다** — `+`(이름 `새 터미널`)는 기본 셸로 바로 열고, 옆의 `▾`(이름 `셸 고르기`)가 메뉴를 연다. intent의 "`+`를 누르면 셸을
   고른다 · 그냥 누르면 기본 셸"을 이렇게 읽었다(한 번 누르면 메뉴, 두 번이면 기본 같은 모양은 키보드로 가르기 어렵다).
2. **도는 탭을 닫는 것은 두 번 누르기다**(`ConfirmButton`) — `셸 다시 시작`과 같은 이유(dev 서버까지 죽는다). 끝난 탭은 한 번에 닫힌다.
3. **탭을 바꾸면 xterm을 다시 그린다** — 보이는 탭 하나만 마운트하고, 돌아오면 core의 스냅샷(512 KiB)으로 다시 그린다(repo를 바꿀 때와
   같은 길). 대가는 **스크롤 위치가 맨 아래로 돌아간다는 것**이다. 탭마다 xterm을 숨겨 두는 안은 탭 8개 × 스크롤백 5,000줄을 메모리에 쥔다.
4. **칸을 열었는데 그 repo에 탭이 하나도 없으면 기본 셸 탭 하나를 띄운다** — 마지막 탭을 닫으면 그 자리에서는 빈 칸과 `+`가 남지만, 칸을 닫았다
   열거나 다른 repo에 다녀오면 새 탭이 뜬다(VS Code의 터미널 패널과 같다). "처음 보일 때 뜬다 · 앱을 켜는 것만으로는 뜨지 않는다"는 그대로다.
5. **macOS·Linux의 선택지는 `$SHELL` 하나다** — `/etc/shells`는 읽지 않는다(intent 범위 밖의 "추정"을 그대로 정했다). 여러 탭은 된다.
6. **마지막으로 본 탭은 localStorage에 둔다** — 칸 기하값(`renderer/code/layout.ts`)과 같은 자리다. 앱을 다시 켜면 탭 id가 전부 바뀌므로 맨 왼쪽
   탭으로 떨어진다.
7. **탭 이름은 셸의 짧은 이름 + 번호**(`pwsh` · `pwsh 2` · `cmd`) — 비어 있는 가장 작은 번호를 쓴다(`pwsh`를 닫고 새로 열면 다시 `pwsh`).
   메뉴의 선택지 이름은 긴 이름이다(`PowerShell 7` · `Windows PowerShell` · `명령 프롬프트` · `Git Bash`).
8. **칸 머리가 두 줄이 된다** — 첫 줄은 repo 이름 · 탭 줄 · `+` · `▾` · `코드 칸 닫기`, 둘째 줄은 지금 탭의 `대화에 붙이기` · `셸 다시 시작`.
   최종 배치는 캡처로 본다(plan 12단계).

## 1. 요약

터미널 칸 머리에 탭 줄이 선다. 탭마다 셸 하나이고, `+`가 그 repo에 기본 셸 탭을 하나 더 열며, `▾`가 그 장비에서 찾은 셸 중 하나를 골라
연다 — Windows에서는 PowerShell 7(있으면) · Windows PowerShell · 명령 프롬프트 · Git Bash(있으면). 탭은 보이지 않는 동안에도 돌고, 다른
탭·다른 repo·인박스에 다녀와도 출력이 남는다. 탭을 닫으면 그 셸이 트리째 끝나고, 앱을 끄면 모든 탭의 셸과 자식이 끝난다. 설정 앱 탭의
`터미널 셸`은 `+`와 처음 열 때의 **기본 셸**로 남는다.

렌더러는 여전히 경로를 보내지 않는다. 메뉴의 선택지는 core가 찾은 목록이고, 렌더러가 넘기는 것은 그 목록의 **키**(`cmd`)뿐이다. 목록에 없는
키는 core가 거부한다.

마이그레이션·스키마·새 의존성 없음.

## 2. 데이터의 모양 (먼저 정한다)

### 2-1. 셸 선택지 — 키가 붙은 등록부

```ts
// shared/models.ts
/** 렌더러가 넘길 수 있는 셸의 이름 — 경로가 아니다. `default`는 설정의 셸(비면 기본값) */
export type TerminalShellKey = 'default' | 'pwsh' | 'powershell' | 'cmd' | 'git-bash' | 'login' | 'wsl'
export const TERMINAL_SHELL_KEYS: readonly TerminalShellKey[]

/** `▾` 메뉴의 한 줄 — core가 이 장비·이 repo에서 찾은 것만 */
export interface TerminalShellOption {
  key: Exclude<TerminalShellKey, 'default'>
  /** 메뉴의 이름(`명령 프롬프트`) */
  label: string
  /** 실행 파일의 전체 경로 — 메뉴 줄의 `title` */
  path: string
  /** 지금 `default`가 이 셸로 풀리는가 — 메뉴에 `기본` 표식 */
  isDefault: boolean
}

/** 탭 수 상한 — core의 거부와 렌더러의 버튼 잠금이 같은 값을 본다 */
export const TERMINAL_TABS_PER_REPO = 8
```

core 쪽 등록부(`core/terminal/shell.ts`)는 키마다 **찾는 법 · 긴 이름 · 인자 규칙**을 쥔 표 하나다. 키를 받아 `ShellChoice`(`file`·`args`·
`name`)로 푸는 함수는 `resolveShellKey(key, repoEnv, lookup)` 하나이고, 메뉴 목록·탭 만들기·다시 시작이 전부 그것을 탄다 — 메뉴에 보인 것과
실제로 뜨는 것이 갈리지 않게.

### 2-2. 탭

```ts
// shared/models.ts — 탭 id는 core가 randomUUID()로 만든다. 렌더러는 받은 것만 되돌려 준다
export interface TerminalTab {
  tabId: string
  repoId: string
  /** 탭 줄의 이름(`pwsh 2`) */
  label: string
  /** 이 탭을 연 키 — 다시 시작이 같은 키로 다시 푼다 */
  shellKey: TerminalShellKey
  shellPath: string
  exited: { exitCode: number } | null
}

/** 칸이 탭에 붙을 때 받는 것 — 지금의 TerminalSession에서 repoId 자리가 탭으로 */
export interface TerminalSession extends TerminalTab {
  generation: number
  snapshot: { text: string; end: number }
}

export interface TerminalData { tabId: string; generation: number; start: number; data: string }
export interface TerminalExit { tabId: string; generation: number; exitCode: number }
```

탭 목록의 진실은 **core에 있다** — Dock은 인박스에 가면 언마운트되고 `TerminalPane`은 repo가 바뀔 때마다 key로 다시 마운트되므로
(`renderer/components/Dock.tsx:739-746`) 렌더러가 쥐면 탭이 core에 고아로 남는다. 렌더러가 쥐는 것은 **어느 탭을 보고 있나** 하나뿐이다(§0-B의 6).

### 2-3. 설계 비교 — core가 탭을 어떻게 쥐나

| | A. 평평한 `Map<tabId, Shell>`, 셸에 `repoId` | B. `Map<repoId, Shell[]>` (repo마다 순서 있는 배열) | C. 탭 목록은 렌더러, core는 `Map<tabId, Shell>`만 |
|---|---|---|---|
| 탭 하나의 일(쓰기·크기·다시 시작·닫기·붙기) | `shells.get(tabId)` 한 번 | repo를 먼저 알아야 한다 — 렌더러가 repo id도 넘기거나 core가 다 훑는다 | A와 같다 |
| repo의 일(목록·상한·`killRepo`) | 값을 훑어 `repoId`로 거른다 — 많아야 수십 개 | 배열 하나 | 목록이 core에 없다 |
| 다시 시작이 자리를 지키나 | `Map.set`은 있던 키의 순서를 바꾸지 않는다 — 공짜 | 배열에서 찾아 바꿔 끼운다 | — |
| 인박스 왕복·repo 전환 | 탭이 core에 남는다 | 같다 | Dock이 언마운트되면 목록이 사라져 core의 셸이 고아가 된다 |
| 가장 가까운 예를 베끼는 사람 | 지금 코드(`shells.get(repoId)`, `core/terminal/service.ts:80·194·202`)의 키만 바꾸면 된다 | 접근마다 두 단계가 생긴다 | 목록 동기화 IPC가 따로 는다 |

**A로 간다.** 거의 모든 호출이 탭 하나를 겨누므로 그 길이 한 단계여야 하고, repo 단위 일은 드물다. `isCurrent`(`service.ts:95-97`)·`end`
(`160-191`)·`killAll`(`249-252`)이 그대로 산다 — 바뀌는 것은 키뿐이고, `killRepo`가 "그 repo의 셸 하나"에서 "그 repo의 셸 전부"가 된다.
C는 Dock의 수명과 셸의 수명이 다르다는 지금 구조의 전제(terminal-spec FR-6)와 맞지 않는다.

## 3. 기능 요구사항

### (A) 탭 줄

- **FR-1** 터미널 칸 머리의 첫 줄: repo 이름 · 탭 줄(`role="tablist"`, 이름 `터미널 탭`) · `+`(이름 `새 터미널`, `IconPlus`) · `▾`(이름
  `셸 고르기`, `IconChevronDown`, `aria-haspopup="menu"`) · `코드 칸 닫기`. 탭은 `role="tab"`이고 이름은 탭 이름 그대로(`pwsh 2`)다 — 끝남은
  이름에 넣지 않고 `title`(`끝남 (종료 코드 N)`)과 흐린 점으로 보인다. 탭 줄은 넘치면 가로로 스크롤한다(칸 하한 320px).
- **FR-2** 탭마다 닫기(이름 `<탭 이름> 터미널 닫기`, `IconClose`). 도는 탭은 `ConfirmButton`(두 번째 이름 `정말 닫기`), 끝난 탭은 한 번이다.
  닫으면 그 셸을 트리째 끝내고(FR-18) 탭이 사라진다. 지금 보던 탭을 닫으면 그 오른쪽, 없으면 왼쪽 탭을 본다. 마지막 탭이면 빈 칸에
  `열린 터미널이 없습니다`와 머리의 `+`·`▾`만 남는다.
- **FR-3** 탭은 repo당 `TERMINAL_TABS_PER_REPO`(8)개까지다 — 끝난 탭도 센다. 8개면 `+`·`▾`가 `aria-disabled`이고 `title`이
  `터미널은 repo당 8개까지입니다 — 하나를 닫으세요`다. core도 같은 상한으로 거부한다(동시에 두 번 눌러도 9개가 되지 않는다 — 띄우는 중인
  탭도 센다).
- **FR-4** 탭을 누르면(또는 탭 줄에서 ←→, ARIA 탭 패턴의 roving tabindex) 그 탭을 본다. 본문은 그 탭의 셸에 **새로 붙는다** — 구독 →
  붙기(스냅샷) → 이어 쓰기, 지금 순서 그대로(`TerminalPane.tsx:37-67`, `terminalStream.ts`). 보이지 않는 탭의 출력 조각은 칸이 버리고,
  돌아오면 스냅샷이 그것을 준다.
- **FR-5** 칸을 열었을 때 그 repo에 탭이 없으면 기본 셸(`default`) 탭 하나를 띄운다. 동시에 두 번 열려도(StrictMode, 칸 전환) 하나다 —
  지금의 `starting`(`service.ts:82·208-213`)이 repo마다 막는 것을 그대로 쓴다.
- **FR-6** 보이는 탭은 repo마다 기억한다 — `renderer/code/terminalTabs.ts`의 `readActiveTab(repoId)`·`writeActiveTab(repoId, tabId)`(키
  `one-desk.terminal.tab.<repoId>`). 칸이 붙을 때 기억한 탭이 목록에 있으면 그것, 없으면 맨 왼쪽(`pickTab` — 순수 함수).

### (B) 셸 고르기

- **FR-7** `▾`가 메뉴(`role="menu"`)를 열고 줄마다 `role="menuitem"`이다 — 이름은 선택지의 긴 이름(`명령 프롬프트`), `title`은 경로, 지금 기본
  셸로 풀리는 줄에는 글자 `기본`(`aria-hidden` — 이름에 섞이지 않게, 대신 `aria-describedby`). 고르면 그 키로 탭을 열고 메뉴가 닫힌다.
  Esc·바깥 누르기가 메뉴만 닫는다(Esc 사다리 — 칸 `<section>`이 이미 Esc를 막는다, `TerminalPane.tsx:78-83`). 메뉴는 열 때마다
  `terminal.shells`로 새로 묻는다(캐시하지 않는다 — 셸은 드물게 깔리고 찾는 데 수 ms다).
- **FR-8** Windows host repo의 선택지와 순서: `pwsh`(PowerShell 7, PATH의 `pwsh` — `defaultShell`과 같은 탐색, `shell.ts:28-36`) ·
  `powershell`(Windows PowerShell, `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`) · `cmd`(명령 프롬프트,
  `%SystemRoot%\System32\cmd.exe` — `%ComSpec%`가 아니다: 사용자가 바꿀 수 있는 값이라 "cmd"라는 이름이 다른 것을 띄울 수 있다) ·
  `git-bash`(FR-10). `SystemRoot`가 없으면 `C:\Windows`(지금 규칙). 고정 경로는 **있을 때만** 목록에 오른다.
- **FR-9** macOS·Linux host repo: `login`(이름은 `$SHELL`의 끝 조각, 없으면 `/bin/bash`) 하나. WSL repo(Windows): `wsl`(이름
  `WSL · <distro>`, 탭 이름 `wsl · <distro>` — 지금 머리의 이름, `service.ts:109`) 하나 — 설정의 셸은 WSL repo에 쓰지 않는다(지금 규칙).
- **FR-10** Git Bash 찾기 — `findGitBash(lookup)`:
  1. PATH에서 `git`을 찾는다(`findExecutable`). 그 디렉토리의 끝 조각이 `cmd`·`bin`이면 부모를, `mingw64\bin`이면 그 위의 위를 Git 루트로 본다.
     Git for Windows의 기본 PATH 항목은 `<루트>\cmd`이고 scoop은 `…\git\current\cmd`다.
  2. 그 루트의 `bin\bash.exe`, 이어서 고정 자리 `%ProgramFiles%\Git\bin\bash.exe` · `%ProgramFiles(x86)%\Git\bin\bash.exe` ·
     `%LOCALAPPDATA%\Programs\Git\bin\bash.exe` 중 처음으로 **있는** 것.
  3. 그 경로가 `%SystemRoot%` 아래이거나 `%LOCALAPPDATA%\Microsoft\WindowsApps` 아래면 버린다(대소문자 무시, 경로 경계에서) — 둘 다 WSL의
     `bash.exe`(배포판을 띄우는 껍데기)다. 1·2가 그 자리를 만들 수 없지만, 규칙이 바뀌어도 WSL이 "Git Bash"로 뜨지 않게 거름을 따로 둔다.
  **PATH의 `bash`는 보지 않는다** — Windows의 PATH에는 `C:\Windows\System32`가 Git보다 앞에 오는 일이 흔하다. 인자는 지금 규칙(`--login -i`,
  `shell.ts:48-52`).
- **FR-11** `default` 키는 지금의 `resolveShell(settings.terminalShell(), …)`(`core/index.ts:417`)이다 — 설정이 있으면 그 경로, 없으면 기본값.
  `+`와 FR-5가 이것을 쓴다. 설정의 셸이 목록의 어느 것과도 같지 않으면(예: nushell) 메뉴에는 없고 `+`로만 열린다. WSL repo의 `default`는 `wsl`이다.
- **FR-12** core는 받은 키를 **그 repo의 목록에서** 찾는다. `TERMINAL_SHELL_KEYS`에 없는 문자열, 그 repo·그 장비의 목록에 없는 키(`git-bash`가 없는
  장비, WSL repo의 `cmd`, posix의 `cmd`)는 셸을 띄우기 전에 `이 repo에서 쓸 수 없는 셸입니다: <키>`로 던진다. 렌더러가 경로를 보내는 통로는 없다.

### (C) 통로

- **FR-13** IPC(`shared/client.ts`의 `terminal`, 핸들러는 core 호출 한 줄씩 — 경계 3):
  - `open({ workspaceId, repoId, cols, rows })` → `TerminalTab[]` — 그 repo의 탭 목록(만든 순). 없으면 FR-5로 하나 띄운 뒤 준다.
  - `shells({ workspaceId, repoId })` → `TerminalShellOption[]`
  - `create({ workspaceId, repoId, shell: TerminalShellKey, cols, rows })` → `TerminalSession`
  - `attach({ workspaceId, tabId })` → `TerminalSession` — 스냅샷을 준다. 셸을 띄우지 않는다.
  - `restart({ workspaceId, tabId, cols, rows })` → `TerminalSession` — 같은 탭 id, 새 generation, **같은 키를 지금 다시 푼다**(그래서 `default`
    탭은 바꾼 설정을 따른다 — 앞 사이클 FR-14 그대로).
  - `close({ workspaceId, tabId })` → `void`
  - `write(tabId, data)`·`resize(tabId, cols, rows)` — 지금처럼 `send`(한 방향).
  - push `event:terminalData`·`event:terminalExit` — `{ tabId, generation, … }`, 앱 창에만(지금 규칙, `electron/ipc/terminal.ts:21-26`).
- **FR-14** 탭을 받는 호출(`attach`·`restart`·`close`)은 그 탭의 repo가 넘긴 workspace의 것인지 매번 본다(`repoOf(workspaceId, shell.repoId)`) —
  지금 `open`이 다시 붙을 때마다 보는 것과 같다(`service.ts:204-206`, 앞 사이클 FR-18). 모르는 탭 id는 `열린 터미널이 없습니다`로 던진다.
  `write`는 모르는·끝난 탭이면 던지고(핸들러가 로그로 남긴다), `resize`는 조용히 무시한다(지금 규칙).

### (D) 이름

- **FR-15** 탭 이름은 `nextTabLabel(base, others)` — `base`는 지금의 `shellName`(`pwsh`·`powershell`·`cmd`·`bash`)이거나 `wsl · <distro>`이고,
  `others`는 그 repo의 다른 탭 이름이다. `base`가 비었으면 `base`, 아니면 `base 2`, `base 3` … 중 비어 있는 가장 작은 것.
- **FR-16** 다시 시작한 셸의 `base`가 같으면 이름을 그대로 둔다. 다르면(설정을 바꾼 `default` 탭) 새로 매긴다.

### (E) 수명과 끝내기 — 지금의 약속을 탭마다

- **FR-17** 탭의 셸이 스스로 끝나면 그 탭은 남는다. 보고 있으면 끝남 줄(`셸이 끝났습니다 (종료 코드 N)` + `셸 다시 시작`, 지금 그대로 —
  `TerminalPane.tsx:136-141`), 보고 있지 않으면 탭의 끝남 표시. 칸은 자기 repo의 모든 탭의 `terminalExit`를 듣는다(탭 표시를 위해) — 데이터는
  보이는 탭의 것만 받는다.
- **FR-18** 탭을 닫으면 그 셸을 **트리째** 끝낸다 — Windows `taskkill /T /F`(비동기), WSL은 pidfile의 세션을 안에서 KILL한 뒤 pty, macOS·Linux는
  pty kill. 지금의 `end(shell, false)`(`service.ts:160-191`) 그대로다. 끝난 탭을 닫으면 신호를 보내지 않는다(지금 규칙 — 끝난 세션의 sid는
  재사용됐을 수 있다).
- **FR-19** repo를 지우거나 경로·실행 환경을 바꾸면 그 repo의 **모든 탭**을 끝낸다(`killRepo`, `core/index.ts:601-605·668-676`). workspace를
  지우면 그 아래 repo의 모든 탭(`core/index.ts:510-515`). 띄우는 중인 탭도 — 끝낸 뒤에 spawn이 돌아오면 그 셸을 곧바로 끝내고 목록에 넣지
  않는다(지금 코드에 없는 틈이다: `launch`가 `killRepo` 뒤에 끝나면 셸이 `shells`에 들어가 앱을 끌 때까지 돈다 — 탭이 여럿이 되며 넓어지므로
  같이 막는다).
- **FR-20** 앱을 끄면 모든 탭을 **동기로** 끝낸다(`killAll` — `killTreeSync`·`killSessionSync`, `core/index.ts:976-978`). 바뀌지 않는다.
- **FR-21** WSL 탭의 pidfile은 탭마다다 — `term-<tabId>.pid`(지금은 `term-<repoId>`, `core/index.ts:431`). 한 repo의 WSL 탭 둘이 같은 pidfile을
  쓰면 하나를 닫을 때 다른 탭의 세션을 겨눈다. 다시 시작은 같은 탭 id라 같은 이름이고, 읽고 곧바로 지우는 규칙(`service.ts:163-168`)이 옛 세션을
  겨누지 않게 한다.

### (F) 설정

- **FR-22** 설정 앱 탭의 `터미널 셸`은 그대로다(`SettingsPanel.tsx:808-822`, `app_setting`의 `terminal.shell`). 안내문만 바뀐다: `코드 칸의 터미널이
  처음 열 때와 +로 띄울 셸. … 다른 셸은 터미널 칸의 ▾에서 고릅니다.` 저장 규칙·placeholder·검증은 그대로다.

## 4. 바뀌는 자리

| 자리 | 지금 | 바뀜 |
|---|---|---|
| `core/terminal/shell.ts` | `defaultShell`·`resolveShell(setting)`·`shellArgs`·`shellName`·`shellEnv` | + 등록부(키 → 찾는 법·긴 이름), `discoverShells`, `findGitBash`, `resolveShellKey`, `nextTabLabel`. 파일시스템은 `find`·`exists`로 주입(지금 원칙) |
| `core/terminal/service.ts` | `Map<repoId, Shell>`, `open`·`write`·`resize`·`restart`·`killRepo`·`killAll` | `Map<tabId, Shell>`(셸에 `repoId`·`tabId`·`label`·`shellKey`), `open`(목록)·`shells`·`create`·`attach`·`restart`·`close`, `killRepo`는 전부, 띄우는 중 끝내기, 상한 |
| `core/index.ts` | `resolveShell: () => …`, `wslLauncher(distro, repoId)` | `resolveShell: (key, repo) => …`(키 해석), `discover`, `wslLauncher(distro, tabId)` → `term-<tabId>`, `terminal` 표면 여섯 |
| `shared/models.ts`·`client.ts`·`channels.ts` | `TerminalOpenInput`·`TerminalSession{repoId, shell}`·`TerminalData{repoId}`·`TerminalExit{repoId}` | §2의 모양. 채널 `terminal:shells`·`terminal:create`·`terminal:attach`·`terminal:close` 추가, `terminal:open`은 목록을 준다 |
| `electron/preload.ts`·`electron/ipc/terminal.ts` | 네 호출 | 여덟 호출, 한 줄씩 |
| `renderer/code/terminalStream.ts` | `repoId`로 거른다 | `tabId`로 거른다(규칙은 그대로) |
| `renderer/code/terminalTabs.ts` (새) | — | `pickTab`·`nextActiveAfterClose`(순수), `readActiveTab`·`writeActiveTab`(localStorage) |
| `renderer/components/code/TerminalPane.tsx` | 칸 = 셸 하나 | 칸 = 탭 줄 + 메뉴 + 보이는 탭의 본문(`TerminalTabView` — 지금 `TerminalPane`의 붙기·끝남·다시 시작·`대화에 붙이기`를 탭 id로 옮긴 것, key = tabId) |
| `SettingsPanel` | 안내문 | 안내문 한 문장 |
| `Dock` | `TerminalPane` key = repo id | 그대로 — prop도 그대로다 |
| `electron/main.ts` | `spawnPty` | 그대로 |

## 5. 비기능 요구사항

- **NFR-1 세 경계.** `core/terminal/`은 electron·fs를 직접 쓰지 않는다(pidfile 지우기 하나 — 지금 그대로). 렌더러는 `useClient()`. 핸들러는 한 줄.
- **NFR-2 렌더러가 경로·명령을 정하지 못한다.** IPC 인자에 경로 자리가 없다 — `create`의 `shell`은 `TerminalShellKey`이고 core가 FR-12로 거른다.
  `TerminalShellOption.path`는 core → 렌더러 한 방향(`title`)이다.
- **NFR-3 판정은 한 자리.** 키 → 셸은 `resolveShellKey` 하나(메뉴·만들기·다시 시작), 탭 상한은 `TERMINAL_TABS_PER_REPO` 하나(core·렌더러), 탭 이름은
  `nextTabLabel` 하나. 기본 셸 탐색은 `defaultShell`을 `pwsh` 선택지가 그대로 쓴다 — `+`의 셸과 메뉴의 `기본` 표식이 갈리지 않게.
- **NFR-4 이름 충돌** (전부 `e2e/*.e2e.ts`·`renderer/`를 grep해 확인했다):
  - `새 터미널` — `새 대화`(e2e는 전부 `exact: true`, `composer`·`dock-repo`·`queue`), `새 창으로 열기`와 겹치지 않는다. `새 터미널`은 `셸 고르기`를
    품지 않고 그 반대도 아니다(그래서 `▾`의 이름을 `새 터미널 셸 고르기`로 하지 않았다 — `새 터미널`이 부분 일치로 둘을 잡는다).
  - `셸 고르기` — `셸 다시 시작`(e2e `exact: true`), 설정의 `터미널 셸 저장`·`터미널 셸 실행 파일`과 서로 품지 않는다.
  - `<탭 이름> 터미널 닫기` — 제목 줄의 `터미널`은 `exact: true`로만 잡힌다(`terminal.e2e.ts:74·102`, `wsl-real.e2e.ts:248·293`). `코드 칸 닫기`와 서로
    품지 않는다. 끝남 줄에 닫기를 따로 두지 않는다 — 같은 이름의 버튼이 둘이 된다.
  - `정말 닫기` — 기존 `정말 다시 시작`(부분 일치로 잡힌다, `terminal.e2e.ts:116`)과 서로 품지 않는다.
  - `터미널 탭`(tablist) — region `터미널 칸`(부분 일치로 잡힌다, `terminal.e2e.ts:43`)과 role이 다르다. 칸 안에 **새 region을 두지 않는다**.
  - 탭(`role="tab"`)의 이름 `pwsh`·`cmd`·`wsl · Ubuntu` — 설정·리포트의 탭 질의(`{ name: '앱' }`·`'실행'`·`'repo'`·`'정보'`·`'WSL'`·`'문서'`·`'요일'`은
    **부분 일치이고 대소문자를 가리지 않는다** — `wsl.e2e.ts:138`의 `{ name: 'WSL' }`는 `wsl · Ubuntu`를 잡는다). 코드 칸은 workspace 화면에만
    서므로(`renderer/App.tsx:687`) 설정·리포트 화면에서는 부딪히지 않는다. 코드 칸을 다른 화면에 두는 날 다시 본다.
  - 메뉴 줄 `PowerShell 7`·`Windows PowerShell`·`명령 프롬프트`·`Git Bash` — 대화 헤더 메뉴의 `이름 바꾸기`·`대화 끝내기`와 겹치지 않는다. `PowerShell`만으로
    잡으면 둘이 걸린다 — e2e는 전체 이름으로 잡는다.
  - 칸 안의 `role="status"`는 끝남 줄 하나여야 한다(`terminal.e2e.ts:123`이 칸 안의 status를 하나로 읽는다) — 빈 칸 안내문과 상한 안내는 status가 아니다.
- **NFR-5 메모리 상한.** 탭마다 버퍼 512 KiB(`buffer.ts:11`) × repo당 8. repo 수에는 상한이 없다 — 앞 사이클과 같다(셸을 띄우는 것은 사람이다).
- **NFR-6 색·아이콘.** 새 색 없음(끝남 점은 `--text-muted`, 보이는 탭은 파일 칸의 눌림 토큰). 아이콘은 `icons.tsx`의 `IconPlus`·`IconChevronDown`·
  `IconClose` — 글리프(`+`·`▾`·`×`)를 버튼에 넣지 않는다.

## 6. 우려

1. **탭을 바꿀 때마다 스냅샷을 다시 그린다** — 512 KiB 출력을 xterm이 다시 해석하는 데 짧게 걸린다(앞 사이클의 repo 전환과 같은 비용 — 측정은 plan
   12단계 캡처에서 눈으로). 느리면 탭마다 xterm을 숨겨 두는 안으로 바꾼다(§0-B의 3).
2. **Git Bash의 `bin\bash.exe`는 `usr\bin\bash.exe`를 띄우는 껍데기다.** `taskkill /T`가 트리를 따라가므로 끝내기는 같다(Windows Terminal·VS Code도 이
   경로를 쓴다). e2e가 Git이 깔린 장비에서 pid로 본다(plan 10단계).
3. **cmd는 시작할 때 `Microsoft Windows [Version …]`을 찍는다** — intent 성공 기준의 `ver`는 그 배너와 구별되지 않는다. e2e는 `echo tab-cmd-%OS%`를 친다
   (되울림에는 `%OS%`가 남고 출력에만 `tab-cmd-Windows_NT`가 있다 — 지금 e2e의 `$(40+2)`와 같은 수법).
4. **이 spec은 앞 사이클 테스트 몇을 고쳐 쓴다** — "repo당 하나다"(`service.test.ts:97-105`)는 "탭마다 따로, 열기는 하나"로, `core/index.test.ts:835`의
   pidfile 이름은 `term-<tabId>`로. 지운 약속이 아니라 옮긴 약속이다(plan의 변이 표가 둘 다 본다).
5. **띄우는 중 끝내기(FR-19)** 는 지금 코드에 없던 틈을 같이 막는 것이다 — 범위를 조금 넓혔다. 탭이 여럿이면 `+`를 누르고 곧바로 repo를 지우는 일이
   실제로 생긴다.

## 7. 검증

- 단위(core, 가짜 pty — `core/terminal/service.test.ts`·`shell.test.ts`):
  - 등록부: Windows에서 pwsh 있음/없음 · powershell·cmd 고정 경로(`SystemRoot` 없음 포함) · Git Bash를 `git.exe`의 `cmd`·`bin`·`mingw64\bin`에서 · 고정
    자리 · **PATH에 `C:\Windows\System32\bash.exe`만 있으면 Git Bash가 없다** · `%LOCALAPPDATA%\Microsoft\WindowsApps\bash.exe`도 · posix는 `login` 하나 ·
    WSL repo는 `wsl` 하나 · `isDefault`가 `default`의 해석과 같다. `platform` 인자로 개발 장비에서 Windows 규칙을 본다.
  - 키: 목록에 없는 키 · 모르는 문자열 · WSL repo의 `cmd`가 셸을 띄우기 전에 던진다.
  - 탭: `open`은 없을 때만 하나 띄우고 동시에 두 번 열어도 하나 · `create`는 같은 repo에 둘째 셸을 띄우고 둘은 따로 쓴다 · 출력·끝남이 `tabId`로 갈린다 ·
    상한 8(띄우는 중 포함, 끝난 탭 포함) · 이름 `pwsh`·`pwsh 2`·빈 번호 채우기 · 다시 시작이 탭 id를 지키고 generation을 올리고 `default`는 설정을 다시
    읽는다 · 다시 시작 뒤 이름 규칙(FR-16) · `close`가 트리째 끝내고 목록에서 뺀다 · 끝난 탭 `close`는 신호 없음 · 남의 workspace로 `attach`·`restart`·
    `close`가 던진다 · `killRepo`가 그 repo의 **모든** 탭을 끝내고 다른 repo는 그대로 · 띄우는 중 `killRepo`면 돌아온 셸을 곧바로 끝낸다 · `killAll`이
    모든 탭을 동기로 · WSL 탭의 pidfile이 탭마다.
- 단위(core 배선 — `core/index.test.ts`): repo 삭제·경로 변경·실행 환경 변경·workspace 삭제가 탭 둘을 다 끝낸다 · `shutdown`이 탭 둘을 다 끝낸다 ·
  WSL 탭 pidfile 이름. 가짜 pty pid는 있을 수 없는 번호(2147483644 근처 — CLAUDE.md)다.
- 단위(renderer): `terminalStream`(키가 `tabId` — 다른 탭의 조각을 버린다) · `terminalTabs`(`pickTab`·닫은 뒤 고르기) · `TerminalPane`(xterm 대역 —
  탭 줄 그리기, 탭을 바꾸면 다른 탭에 붙는다, `+`가 `default`로 `create`, 메뉴 줄이 `shells`의 키로 `create`, 상한이면 잠김과 `title`, 도는 탭 닫기는 두
  번, 끝난 탭은 한 번, 보던 탭을 닫으면 오른쪽, 마지막을 닫으면 빈 칸, 보이지 않는 탭의 끝남이 탭 표시가 된다, 기억한 탭으로 붙는다, 메뉴의 Esc가 칸
  밖으로 새지 않는다).
- e2e(진짜 셸 — `e2e/terminal.e2e.ts`): §plan 10단계. Windows에서 `▾` → `명령 프롬프트` → `echo tab-cmd-%OS%`의 출력, PowerShell 탭은 그대로 · 한 탭에서
  `node`로 오래 도는 프로세스를 띄운 채 다른 탭에서 명령, 탭을 오가고 인박스에 다녀와도 두 탭의 출력이 그대로 · **탭을 닫으면 그 탭의 `node`(pid)가 끝나고
  다른 탭의 `node`는 산다** · **앱을 끄면 두 탭의 `node`가 다 끝난다** · Git Bash가 있으면 그 탭도 · 기존 네 시나리오(이름 셀렉터만 고친다).
- `wsl.e2e`(가짜 wsl.exe, Windows) 그대로 초록 · `wsl-real.e2e`(선택 실행)는 이 장비에서 한 번 돌린다(WSL 탭 둘의 세션 종료).
- 실제 앱 캡처(라이트·다크, 1440×900 · 칸 하한 320px에 탭 8개).
