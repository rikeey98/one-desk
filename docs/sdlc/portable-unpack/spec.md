# Spec: Windows 포터블 exe를 한 번 더 실행해도 떠 있는 앱의 파일이 지워지지 않는다

- 출처: 대화 (2026-10-15) — "0.26.2 버전인데 wsl 폴더 등록해서 claude code 대화 걸면 /bin/sh: 0: cannot open
  /mnt/c/Users/{}/AppData/Local/Temp/{}/resources/wsl-launcher.sh: No such file 이라고 에러남". intent는 생략했다 — 결함 보고이고,
  고치는 방식(아래 §2)은 위임받았다.
- 작성자: 권용현 (초안: Claude)
- 상태: 구현됨, v0.26.3으로 릴리스 — 보고한 장비에서 확인받는다 (§5)
- 작성일: 2026-10-15

## 0. 무슨 일이 있었나

v0.26.2의 Windows 판에서 WSL repo로 대화를 보내면 시작조차 못 했다.

```
/bin/sh: 0: cannot open /mnt/c/Users/<사용자>/AppData/Local/Temp/<폴더>/resources/wsl-launcher.sh: No such file
```

### 원인 (실측 — 이 장비에서 릴리스 CI와 같은 명령으로 포터블 exe를 만들어 띄웠다)

1. **포터블 exe는 실행할 때마다 앱 전체(약 430 MB, 파일 738개)를 TEMP에 풀어 거기서 띄운다.** electron-builder `portable`의
   기본값은 빌드마다 고정된 이름 하나다(`%TEMP%\<ksuid>` — 예 `3Kit3xnVA63YkYGmIK6459SGHCb`). 런처는 `resources\wsl-launcher.sh`라
   그 폴더 안에 있다.
2. **래퍼(`portable.nsi`)는 풀기 전에 그 폴더를 `RMDir /r`로 비우고, 앱이 끝난 뒤에 다시 지운다.**
3. **앱이 떠 있는 동안 같은 exe를 다시 실행하면** — 창이 늦게 떠 한 번 더 누르거나, 바로가기를 다시 누르면 — 두 번째 래퍼가 같은
   폴더를 비우고, 다시 풀고, 두 번째 앱은 단일 인스턴스 잠금에 걸려 첫 창을 앞으로 가져온 뒤 곧바로 끝나고, 래퍼가 그 폴더를 다시
   지운다. Windows는 실행 중이거나 열려 있는 파일(실행 파일·DLL·`app.asar`·이미 읽은 `.node`)을 못 지우게 하므로 그것만 남고
   **나머지는 첫 인스턴스가 쓰는 중에 사라진다.** 실측: 두 번째 실행 뒤 `resources`에는 `app.asar`와 `app.asar.unpacked`만 남았고
   (`drizzle`·`mcp-bridge.mjs`·`wsl-launcher.sh`·`elevate.exe`가 없다), `app.asar.unpacked`의 파일 265개 중 better-sqlite3의 `.node`
   하나만 남았다.

### 재현

포터블 exe를 띄우고 → 같은 exe를 한 번 더 실행하고 → 첫 창에서 WSL repo를 등록해 대화를 보내면 보고와 같은 문장으로 실패한다(§4).

## 1. 증상이 하나가 아니다

앱이 시작한 뒤에 디스크에서 읽는 파일이 셋이라 증상도 셋이다. 실측은 파일이 사라진 것과 WSL 대화의 실패까지다.

| 사라진 파일 | 증상 |
|---|---|
| `resources\wsl-launcher.sh` | WSL repo의 대화·터미널이 시작하지 못한다 (보고된 것) |
| `resources\mcp-bridge.mjs` | claude가 MCP 서버를 failed로 두고 **one-desk 도구 없이 "성공"한다** — Windows repo도 같고, 조용하다 |
| node-pty의 `conpty.node`와 스크립트들 | 터미널 칸이 열리지 않는다 (node-pty는 처음 터미널을 열 때 그것을 읽는다) |

`drizzle`(마이그레이션)은 시작할 때만 읽어 영향이 없다. 앱을 다시 시작하면 새로 풀어 낫는다 — 다시 두 번 실행하기 전까지.

## 2. 정한 것

**FR-1 실행마다 자기 폴더에 푼다.** `electron-builder.yml`의 `portable.unpackDirName: true` — 래퍼가 `$PLUGINSDIR\app`
(`%TEMP%\nsXXXX.tmp\app`, 실행마다 새 이름)에 푼다. 두 번째 실행은 자기 폴더만 비우고 지운다.

- **문서와 반대인 값이다.** electron-builder 문서는 `false`가 "실행마다 고유한 $PLUGINSDIR"라고 하지만, 26.15.3·26.17.0의
  `NsisTarget.js`는 `typeof unpackDirName === "string" || !unpackDirName`이면 UNPACK_DIR_NAME(그 문자열, 아니면 새 ksuid)을 정의한다.
  그래서 `false`는 기본값과 같다(실측 — `false`로 빌드한 exe가 고정 이름에 풀었다). `true`만 그 정의를 건너뛰어 템플릿의
  `$PLUGINSDIR\app`이 남는다.
- `core/app/portableUnpack.test.ts`가 yml의 값, `NsisTarget.js`의 그 조건, `portable.nsi`의 `$PLUGINSDIR\app`을 읽어 지킨다 —
  electron-builder를 올리다 판정이 바뀌면 빨개진다. 그때는 §4의 "두 번 실행"을 다시 본다.

**FR-2 비정상 종료가 남긴 폴더는 다음 실행이 지운다.** 래퍼는 앱이 끝난 뒤에 정리하는데, 전원·로그오프로 래퍼가 먼저 끝나면 그
실행의 `nsXXXX.tmp`가 남는다 — 앱(434 MB)과 래퍼가 풀 때 쓴 `7z-out` 사본(434 MB)과 압축본까지 1 GB 가까이다. 고정 이름이던 때는
다음 실행이 같은 이름을 비워 앱 사본만큼은 되찾았지만, 실행마다 새 이름이면 아무도 그 이름을 다시 쓰지 않는다.

- 단일 인스턴스 잠금을 얻은 실행이 창을 띄운 뒤 뒤에서 `removePortableLeftovers`(`core/app/portableUnpack.ts`)를 부른다
  (`electron/main.ts`). 래퍼의 표식(`PORTABLE_EXECUTABLE_FILE`)과 자기 배치(`<TEMP>\ns….tmp\app\<exe>`)가 맞을 때만 돈다
  (`portableUnpackOf`) — 개발·e2e·예전 배치에서는 아무것도 하지 않는다.
- 후보는 TEMP 바로 아래의 `ns….tmp` 폴더 중 자기 것이 아닌 것이다. **`app\one-desk.exe`를 먼저 지워 본다** — 실행 중인 실행
  파일은 Windows가 지우지 못하게 하므로, 지워지면 그 폴더의 앱은 돌고 있지 않다. 지워지지 않으면(도는 인스턴스, 실행 파일 이름이
  다른 앱의 폴더, 아직 푸는 중) 파일 하나 건드리지 않는다.
- 실행 파일을 지운 뒤에는 이름을 `one-desk-leftover-<uuid>`로 바꿔 지운다. 지우다 막히면(백신이 갓 생긴 큰 파일을 쥐고 있다)
  다음 실행이 그 이름으로 찾아 마저 지운다. 실패는 전부 삼킨다.
- NSIS 폴더 이름은 `ns` + 영문자 하나(접두사 `nsa`에 틱 수 % 26을 더한다) + GetTempFileName의 16진수다(실측 `nscC36B`·
  `nsxD2D4`·`nsg72C1`·`nsaC05`). 처음에 16진수만 받았다가 실측한 이름을 보고 고쳤다 — g~z가 걸린 실행을 놓친다.

**FR-3 정리는 Electron의 `original-fs`로 한다.** Electron의 `fs`는 `.asar` 파일을 폴더처럼 보여 줘, `rm`이 남은 `app.asar` 안으로
들어가 지우려다 실패하고 그 파일이 남는다 — 실측에서 `app.asar` 둘(105 MB)이 남았고, 같은 파일을 PowerShell은 곧바로 지웠다.
일반 Node에서 도는 단위 테스트는 이것을 못 보므로 파일 함수를 **필수 인자**(`LeftoverFs`)로 받는다. main이
`createRequire(import.meta.url)('original-fs').promises`를 넘긴다(번들러가 모르는 모듈이라 `import`로 쓰지 않는다).

### 버린 안

- **NSIS 설치본으로 바꾼다.** 설치 위치가 고정돼 이 문제 자체가 없고 실행마다 430 MB를 풀지 않아도 된다. 그러나 릴리스 파이프라인
  설계(`docs/superpowers/specs/2026-08-14-release-pipeline-design.md` §1 "빠지는 것")가 "한 파일로 실행"을 요구사항으로 NSIS
  설치본을 뺐다 — 배포 형식은 사용자가 정할 일이다.
- **앱이 나중에 읽는 파일만 userData로 복사해 쓴다.** 런처·브리지는 되지만 node-pty는 자기 폴더에서 `.node`와 스크립트를 찾으므로
  옮기지 못한다.
- **`unpackDirName: false`(문서의 값).** FR-1 — 동작하지 않는다.
- (원인 후보였던 것) **TEMP의 8.3 짧은 이름.** 사용자 이름이 길면 TEMP가 `C:\Users\ABCDEF~1\…`로 오고 `wslpath`는 그대로 옮긴다.
  WSL이 그 경로로 스크립트를 여는지 확인했다 — 연다. 원인이 아니었다.

## 3. 대가

- 고정 이름 폴더가 하던 "다음 실행이 지난 폴더를 비운다"를 이제 앱이 한다 — TEMP 아래를 지우는 코드가 앱에 생겼다. 범위는 이름
  규칙·실행 파일 이름·그것이 지워지는지, 셋이 다 맞는 폴더로 좁혔다.
- v0.26.2까지의 고정 이름 폴더(`%TEMP%\<ksuid>`)는 지우지 않는다 — 비정상 종료가 있었다면 버전마다 하나씩 남아 있을 수 있다. 그때의
  래퍼가 남긴 `nsXXXX.tmp`(앱이 없는 `7z-out`)도 이 앱의 것인지 가릴 표식이 없어 지우지 않는다.
- electron-builder 문서와 반대인 값에 기댄다 — 테스트가 지킨다(FR-1).

## 4. 확인 (2026-10-15, 이 장비 — Windows 11, WSL2 Ubuntu-24.04, WSL 안의 claude 로그인)

릴리스 CI와 같은 `pnpm build` + `electron-builder --win`으로 만든 포터블 exe를 실제로 띄웠다. 앱은 래퍼에 넘긴
`--remote-debugging-port`로 CDP에 붙어 몰았다(래퍼는 받은 인자를 앱에 넘긴다). 데이터 폴더는 `ONE_DESK_USER_DATA`로 따로 두었다.

| | 고치기 전 (고정 이름) | 고친 뒤 |
|---|---|---|
| 압축을 푼 곳 | `%TEMP%\3Kit3xnVA63YkYGmIK6459SGHCb` | `%TEMP%\nshD3C.tmp\app` (실행마다 다르다) |
| 두 번 실행한 뒤 첫 인스턴스의 런처·브리지 | 사라짐 | 남음 |
| 첫 인스턴스에서 WSL repo로 대화 | 실패 — 보고와 같은 문장 | 성공 — MCP `list_issues` 1회 호출, `PK_OK count=0` |

- 비정상 종료(래퍼를 먼저 강제로 끝냄): 남은 폴더(파일 738개)를 다음 실행이 지웠고, 다른 데이터 폴더로 돌고 있던 인스턴스의 폴더는
  그대로였다(738개). `original-fs`로 바꾸기 전에 막혀 남은 휴지통 폴더도 바꾼 뒤의 실행이 지웠다.
- 단위 17개(`core/app/portableUnpack.test.ts`) — 변이 13개 전부 잡힌다(판정 넷 · 못 읽는 TEMP · 휴지통 · 이름 규칙 둘 · 자기 폴더 ·
  도는 인스턴스 · 지운 것 보고 · 휴지통 이름 바꾸기 · 지우기). `main.ts`가 `original-fs`를 넘기는 것은 위 실측만 본다.
- **v0.26.3 릴리스 (run 38835553987, 2026-10-16):** 두 러너의 `pnpm test`가 위 단위 테스트(FR-1의 세 파일 읽기 포함)를 돌려 통과했다.
  릴리스에 올라간 exe(104,591,484 B — v0.26.2보다 5.7 KB 크다)를 받아 두 번 실행했다: 첫 실행은 `%TEMP%\nszB92C.tmp`(16진수 밖의
  `z` — FR-2의 이름 규칙), 둘째는 `nsdE8B8.tmp`에 풀었고 둘째 래퍼는 끝나며 자기 폴더만 지웠다. 첫 인스턴스의 런처·브리지·
  `drizzle`·`app.asar.unpacked`(파일 360개)가 그대로였고 앱은 계속 돌았다.

## 5. 남은 것

- 보고한 장비에서 확인받는다.
- 포터블은 실행마다 430 MB를 풀어 창이 뜨기까지 몇 초 걸리고 그동안 아무것도 보이지 않는다 — 사람이 한 번 더 누르게 되는 이유다.
  이번에는 고치지 않았다(electron-builder의 `portable.splashImage`로 그동안 그림을 띄울 수 있다).
