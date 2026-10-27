# Intent: 터미널을 여러 개 · 셸을 골라서 — `+`로 새 터미널, Windows에서 cmd도

- 출처: 대화 (2026-10-27) — "teminer 기능을 추가 해줘 … 지금은 windows에서 powershell 만 있는데 cmd로도 할수있게하고 +로 여러
  terminal이 나오게 해야해"
- 작성자: 권용현 (초안: Claude)
- 상태: **승인됨** (2026-10-27, 사용자 "spec 만들어줘 개발") — spec·plan은 `spec.md`·`plan.md`
- 작성일: 2026-10-27
- 관계: 코드 칸의 둘째 사이클(`docs/sdlc/code-editor/terminal-spec.md`)의 결정 둘을 뒤집는다(아래). `agent-proposals`와는 독립이다 —
  같은 시기에 진행하지만 서로 기다리지 않는다.

## 문제

1. **터미널이 repo당 하나뿐이다.** dev 서버를 띄워 둔 채 다른 명령을 치려면 서버를 멈추거나 앱 밖의 터미널을 열어야 한다.
2. **셸을 그때그때 고를 수 없다.** Windows에서는 PowerShell이 기본이고, cmd를 쓰려면 설정 앱 탭의 `터미널 셸`에 `cmd.exe` 경로를
   직접 쳐 넣어야 한다 — 그러면 **모든** repo의 터미널이 cmd가 된다. "이 작업만 cmd로"가 안 된다.

## 현황 (읽고 확인한 것)

- **셸은 repo당 하나다** — `core/terminal/service.ts`의 `shells: Map<repoId, Shell>`, terminal-spec FR-5 "셸은 repo당 하나". 칸은 지금 대상
  repo의 셸 하나를 보이고, 다른 repo로 옮기면 그 repo의 셸로 바뀐다. 앞 셸은 뒤에서 계속 돈다.
- **셸은 설정 하나가 정한다** — 앱 탭의 `터미널 셸`(`app_setting`의 `terminal.shell`, FR-11). 비면 PATH의 `pwsh` → Windows PowerShell 5.1
  (posix는 `$SHELL`) — `core/terminal/shell.ts`의 `defaultShell`.
- **cmd는 지금도 기술적으로는 된다** — 설정에 `C:\Windows\System32\cmd.exe`를 넣으면 `shellArgs`가 인자 없이 띄운다(`shell.ts`의 주석
  "PowerShell·cmd는 인자가 없다"). 막힌 것은 **고르는 화면**과 **셸 여러 개**다.
- **렌더러는 repo id만 넘긴다** — cwd·셸·명령을 정하지 못한다(terminal-spec). 셸 경로를 렌더러가 보내는 통로는 없다.
- **WSL repo의 터미널은 그 distro 안의 셸이다**(`wsl.exe -d <distro>`, 세션째 끝내기 — CLAUDE.md WSL 절). PowerShell·cmd는 거기에
  해당하지 않는다.
- 앱 종료·repo 삭제·경로 변경·workspace 삭제가 그 repo의 셸을 트리째 끝낸다(`shutdown`의 `taskkillTreeSync`) — 셸이 여럿이 되면 전부여야 한다.

## 원하는 결과

- 터미널 칸 머리에 **탭 줄**이 선다. 탭마다 셸 하나이고, 이름은 셸 이름(`pwsh`·`cmd` — 같은 셸이 둘이면 `pwsh 2`)이다.
- 탭 줄 끝의 **`+`** 가 그 repo에 새 터미널을 연다. `+`를 누르면 **셸을 고른다** — Windows: PowerShell 7(있으면) · Windows PowerShell ·
  명령 프롬프트(cmd) · Git Bash(있으면). 그냥 누르면 기본 셸(설정값)이다.
- 탭마다 닫기가 있고, 닫으면 그 셸을 트리째 끝낸다. 마지막 탭을 닫으면 빈 칸에 `+`만 남는다.
- 셸은 지금처럼 **보이지 않는 동안에도 돈다** — 다른 탭·다른 repo·인박스에 다녀와도 각 탭의 출력이 그대로다.
- 앱을 끄면 **모든 탭의** 셸과 그 자식까지 끝난다(지금 약속 그대로).
- 설정 앱 탭의 `터미널 셸`은 **기본 셸**로 남는다(`+`를 그냥 눌렀을 때와 칸을 처음 열 때).

## 뒤집는 결정

- **terminal-spec FR-5 "셸은 repo당 하나"** → repo당 여럿. 근거: 오래 도는 명령(dev 서버)과 다른 명령을 같이 쓰는 일이 실제로 잦다.
  "처음 보일 때 뜬다 · 앱을 켜는 것만으로는 뜨지 않는다"는 그대로다.
- **셸은 설정 하나로만 정한다(FR-11)** → 설정은 기본값이고, 탭을 열 때 고를 수 있다.

## 제약

- **렌더러는 여전히 경로를 보내지 않는다.** `+`의 선택지는 core가 그 장비에서 찾은 셸 목록이고, 렌더러는 **목록의 이름(키)** 만 넘긴다 —
  `core/app/reveal.ts`가 `'data'`·`'logs'` 같은 이름만 받는 것과 같은 원칙. 임의 실행 파일을 띄우는 통로를 만들지 않는다.
- **WSL repo에서는 셸 선택지가 WSL 셸 하나다**(여러 탭은 된다).
- 탭 하나의 출력 버퍼 상한(512 KiB)은 그대로이고, 탭 수에는 상한을 둔다(추정: repo당 8 — spec에서 정한다) — 메모리와 프로세스가 무한히
  늘지 않게.
- 끝내기는 탭마다 지금 규칙 그대로(Windows `taskkill /T /F`, WSL `pkill -s`, 앱 종료는 동기).
- 짧은 새 이름(`+`의 접근성 이름, 탭 닫기)은 기존 e2e의 부분 일치를 본다 — `새 터미널`·`<탭 이름> 터미널 닫기` 같은 이름을 spec에서 고른다.
  `셸 다시 시작`과도 겹치지 않게.
- 세 경계, App prop 필수, 색 토큰·아이콘 규칙.

## 범위 밖

- 탭을 앱 재시작 뒤에도 되살리는 것(지금도 셸은 앱을 끄면 끝난다).
- 칸을 나눠 터미널 둘을 나란히 보는 것(분할).
- 탭 이름 바꾸기, 탭 끌어 옮기기.
- macOS·Linux의 셸 고르기 화면 — 셸 목록은 `$SHELL` 하나로 시작하고, 여러 탭만 된다(추정 — spec에서 `/etc/shells`를 볼지 정한다).

## 미해결 질문 (spec에서 다룬다)

- [ ] 셸 목록을 어떻게 찾나 — PATH 탐색(`pwsh`·`bash`)과 고정 경로(`%SystemRoot%\System32\cmd.exe`·Windows PowerShell). Git Bash는
  PATH의 `bash.exe`가 WSL의 `bash.exe`(System32)일 수 있다 — 구별 규칙.
- [ ] repo를 옮겼다 돌아오면 어느 탭이 보이나(가정: 그 repo에서 마지막으로 본 탭).
- [ ] 탭이 스스로 끝났을 때(`exit`) — 지금의 `셸 다시 시작`을 탭마다 둘지, 탭을 닫을지.
- [ ] 탭 수 상한과, 넘었을 때 `+`의 모양.
- [ ] 출력 push(`event:terminalData`)와 IPC가 지금 `repoId` + `generation`으로 셸을 가른다 — 탭 id로 바꾸는 모양.

## 성공 기준

- Windows에서 터미널 칸의 `+` → `명령 프롬프트`를 고르면 cmd 탭이 열리고 `ver`가 Windows 버전을 찍는다. PowerShell 탭은 그대로 돈다.
- 한 탭에서 오래 도는 명령을 띄운 채 다른 탭에서 명령을 치고, 탭을 오가도 각 탭의 출력이 그대로다. 다른 repo·인박스에 다녀와도 같다.
- 탭을 닫으면 그 셸의 자식 프로세스까지 끝난다. 앱을 끄면 모든 탭의 셸과 자식이 끝난다(pid로 확인 — 지금 `terminal.e2e`의 방식).
- 렌더러에서 셸 경로를 보낼 길이 없다(IPC 인자는 repo id와 셸 이름 키뿐이고, 목록에 없는 키는 core가 거부한다).
- `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm test:e2e` 전부 통과.
