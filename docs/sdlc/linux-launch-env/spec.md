# Spec: 리눅스 패키지가 사용자의 LD_LIBRARY_PATH에 깨지지 않는다

- 출처: 대화 (2026-10-14) — "이거 linux redhat에서 실행하니깐 symbol lookup error: undefined symbol: XML_SetHashSalt 라고 나와".
  intent는 생략했다 — 결함 보고이고, 고치는 방식(아래 §2)은 위임받았다.
- 작성자: 권용현 (초안: Claude)
- 상태: 구현됨 — 보고한 장비(RHEL)에서 확인받는다 (§5)
- 작성일: 2026-10-14

## 0. 무슨 일이 있었나

v0.26.0의 AppImage가 RHEL에서 시작조차 못 했다.

```
symbol lookup error: …/one-desk: undefined symbol: XML_SetHashSalt
```

### 원인 (실측 — 받은 v0.26.0 AppImage를 WSL Ubuntu 24.04에서 풀어 봤다)

1. **Electron 실행 파일이 시스템의 `libexpat.so.1`을 직접 쓴다.** `readelf -d`의 NEEDED에 `libexpat.so.1`이 있고 `nm -D`로 보면
   `XML_SetHashSalt`를 포함해 expat 함수 열한 개를 가져온다(Chromium은 리눅스에서 expat을 번들하지 않는다). `XML_SetHashSalt`는
   expat **2.1.0(2012)** 에서 생겼다 — RHEL 8(2.2.5)·9(2.5.0)의 시스템 expat에는 있다.
2. **electron-builder의 AppRun은 사용자의 `LD_LIBRARY_PATH`를 그대로 이어 붙인다.** `LD_LIBRARY_PATH="$APPDIR/usr/lib:<사용자의 값>"`
   으로 Electron을 exec한다. `usr/lib`에는 electron-builder가 2019년에 넣은 여섯 개(libXss·libXtst·libappindicator·libgconf·
   libindicator·libnotify)뿐이고 expat은 없다 — 그래서 expat은 **사용자의 값이 가리키는 폴더**에서 먼저 찾는다.
3. 그 폴더에 2.1.0보다 오래된 `libexpat.so.1`이 있으면 이 오류가 난다. 설계 도구(EDA)·오래된 상용 소프트웨어가 자기 라이브러리
   폴더를 `LD_LIBRARY_PATH`에 넣고 거기에 오래된 expat을 들고 오는 경우가 흔하다. 시스템 expat 자체가 그렇게 오래될 수는 없다 —
   Electron 실행 파일이 `GLIBC_2.25`를 요구하므로 RHEL 7(glibc 2.17)이면 이 오류보다 먼저 glibc 버전 오류가 난다(§4 — CentOS 7.9의
   라이브러리로 실측했다).

### 재현

시스템의 libexpat을 복사해 `XML_SetHashSalt` 이름 하나만 바꾼(`XML_SetHashSalX`) 파일을 폴더에 두고 그 폴더를
`LD_LIBRARY_PATH`로 준 채 v0.26.0의 AppRun을 띄우면 보고와 **글자까지 같은** 오류로 exit 127이다. `LD_LIBRARY_PATH`를 지우고
띄우면 뜬다.

## 1. 증상이 하나가 아니다

사용자의 `LD_LIBRARY_PATH`로 Electron 실행 파일이 뜨는 자리가 셋이다. 하나만 막으면 나머지가 같은 이유로 죽는다.

| 자리 | 그 값을 받는 경로 | 막지 않으면 |
|---|---|---|
| 앱 자신 | AppRun → Electron | 시작조차 못 한다 (보고된 증상) |
| Chromium의 자식(GPU·유틸리티) | 앱의 환경을 그대로 물려받아 다시 exec한다 | 앱이 `process.env`를 고치면 그 뒤에 뜨는 GPU 프로세스가 같은 오류로 죽는다 |
| MCP 브리지 | agent가 띄운다 — 서버 env를 **agent의 환경 위에** 얹는다(claude 2.1.296 실측, wsl-support §4-C) | agent는 MCP를 failed로 두고 도구 없이 "성공"한다 |

## 2. 정한 것

**Electron은 사용자의 `LD_LIBRARY_PATH` 없이 띄우고, 앱이 사용자 대신 띄우는 프로세스에는 그 값을 되돌려 준다.**

- **FR-1 실행 껍데기.** electron-builder의 afterPack 훅(`build/linux/afterPack.mjs`)이 리눅스 패키지의 Electron 실행 파일을
  `<이름>.bin`으로 옮기고 그 자리에 `build/linux/launcher.sh`를 둔다. AppRun은 `$APPDIR/<이름>`을 exec하므로 껍데기가 먼저 돈다.
  껍데기는 AppRun이 붙인 앞자리(`<AppDir>/usr/lib`)를 떼어 사용자의 값을 **글자 그대로** 얻고(빈 칸 = 현재 디렉토리까지),
  Electron을 `LD_LIBRARY_PATH=<AppDir>/usr/lib`로(usr/lib이 없으면 — linux-unpacked — 변수 없이) exec한다. AppImage가 넣어 둔
  라이브러리는 지금처럼 앞에 둔다 — 걷어 내는 것은 사용자의 값뿐이다. 다른 플랫폼에서 훅은 아무것도 하지 않는다.
- **FR-2 표식.** 껍데기는 사용자의 값을 `ONE_DESK_ORIG_LD_LIBRARY_PATH`에 남긴다 — **늘** 남긴다. 빈 값은 "사용자가 두지
  않았다"이고, 표식이 없으면 껍데기를 거치지 않은 것(Windows·macOS·`pnpm dev`)이다.
- **FR-3 사용자 대신 띄우는 프로세스.** `core/runner/userEnv.ts`의 `userProcessEnv(process.env)`가 표식을 보고 `LD_LIBRARY_PATH`를
  되돌리고 표식을 지운다. 표식이 없으면 복사본만이다. 띄우는 자리마다 거친다 — claude·opencode run(`buildCommand`), opencode
  설정 확인(`verifyRunnable`)과 `--version`, 인증·모델 조회(`runCli`), 슬래시 커맨드 probe, `git ls-files`, 터미널 셸
  (`shellEnv(userProcessEnv(…))` — `shellEnv`가 `ONE_DESK_*`를 지우므로 순서가 바뀌면 표식이 먼저 사라진다). agent의 Bash 도구가
  부르는 설계 도구는 그 라이브러리 폴더가 있어야 돌므로, 걷어 내기만 하면 이번에는 agent가 깨진다.
- **FR-4 `process.env`는 고치지 않는다.** 고치면 그 뒤에 뜨는 Chromium의 자식이 사용자의 값을 받는다(§1).
- **FR-5 MCP 브리지.** 브리지는 앱 자신의 실행 파일(`process.execPath` = `<이름>.bin`)이다. `appLoaderEnv(process.env)` — 앱이 뜬
  `LD_LIBRARY_PATH`(없으면 빈 값 — glibc는 빈 값을 없는 것으로 본다) — 를 MCP 설정의 서버 env(claude `env`·opencode
  `environment`)에 얹는다. 고정 값(`ELECTRON_RUN_AS_NODE`·URL·토큰)은 그 뒤에 써서 덮이지 않는다. WSL 브리지(Windows
  프로세스)에는 싣지 않는다. `McpHostOptions.execEnv`는 **필수**다 — 빠뜨려도 조용히 컴파일되면 그런 리눅스에서만 MCP가 빠진다.
- **FR-6 데스크톱 앱은 앱의 환경이다.** VS Code 열기(`code --new-window`)와 Electron의 `shell`(브라우저·파일 관리자)은 되돌리지
  않는다 — VS Code도 Electron이라 사용자의 값으로는 같은 이유로 못 뜰 수 있고, 데스크톱에서 띄운 것과 같아지는 쪽이 낫다.
- **FR-7 릴리스 확인.** afterPack 훅이 돌지 않아도 빌드는 초록이다. 릴리스 CI의 리눅스 빌드가 electron-builder 다음에
  `build/linux/check-appimage.sh`로 산출물을 본다 — 이 장비의 libexpat을 위처럼 바꾼 폴더를 AppRun처럼 넘겨 (1) `<이름>.bin`을 바로
  띄우면 보고와 같은 오류로 죽고(흉내가 효력이 있다는 대조) (2) 껍데기로 띄우면 뜨고 사용자의 값을 표식으로 받는지.
  Electron은 `ELECTRON_RUN_AS_NODE`로 띄운다 — 화면 없이 로더를 전부 지난다. 실패하면 release job이 돌지 않는다.

### 버린 안

| 안 | 버린 이유 |
|---|---|
| 새 libexpat을 AppImage의 usr/lib에 넣는다 | expat 하나만 고친다 — 같은 폴더의 오래된 libstdc++·libz 등이 다음 오류가 된다. usr/lib은 AppRun이 모든 자식에게 물려주므로 넣은 라이브러리가 사용자의 도구에 새고, 빌드 장비의 glibc를 요구하는 라이브러리를 넣으면 오래된 배포판에서 그것이 먼저 깨진다 |
| main이 시작하자마자 `process.env.LD_LIBRARY_PATH`를 되돌린다 | 오류는 main이 돌기 전 로더에서 난다. 그리고 FR-4 |
| 걷어 내기만 하고 되돌리지 않는다 | 가장 단순하지만 agent의 Bash 도구·터미널에서 사용자의 도구가 라이브러리를 못 찾는다 — 사용자의 셸과 앱의 셸이 갈린다 |
| AppRun을 갈아 끼운다 | electron-builder가 AppImage를 만드는 도중에 쓰는 파일이라 덮을 이음매가 없다. 실행 파일 이름만 기대는 껍데기가 판이 바뀌어도 산다 |

## 3. 대가

1. **사용자의 `LD_LIBRARY_PATH`에만 있는 라이브러리를 Electron이 못 쓴다.** 시스템에 없는 Electron 의존 라이브러리를 그 변수로
   대 주던 장비라면 이제 "cannot open shared object file"로 못 뜬다. 주요 배포판은 전부 패키지로 있어 받아들였다.
2. **`ld.so.conf`로 시스템 전체에 오래된 expat이 잡힌 장비는 고치지 못한다.** 그런 장비에서는 python의 `pyexpat`부터 깨지므로
   드물다고 봤다.
3. `process.execPath`가 `<이름>.bin`이다 — 프로세스 목록에도 그 이름으로 보인다. 창의 WM_CLASS는 앱 이름에서 오므로 그대로다.

## 4. 이 결함과 별개로 드러난 것

- **배포판의 하한은 glibc 2.34였다 → RHEL 8(2.28)로 내렸다** (`docs/sdlc/linux-glibc-floor/`). Electron 실행 파일은 `GLIBC_2.25`까지지만
  네이티브 모듈이 더 높았다 — better-sqlite3 13의 linux-x64 사전 빌드(패키지에 들어 있고 `lib/binding.js`가 `build/Release`보다 먼저
  집는다 — postinstall의 electron-rebuild가 컴파일한 것은 쓰이지 않는다)가 `GLIBC_2.34`·`GLIBCXX_3.4.29`, 러너에서 컴파일하는
  node-pty가 `GLIBC_2.34`다. 이제 릴리스 CI가 둘을 manylinux_2_28 컨테이너에서 다시 빌드한다.
- **RHEL 7(glibc 2.17)은 Electron 자신이 막는다** (2026-10-14 실측 — 사용자가 장비를 RHEL 7이라고 했다). Electron 43 실행 파일은
  `getrandom@GLIBC_2.25`를 강한 참조로 가져오는데(`readelf -V`의 `Flags: none`) RHEL 7의 마지막 glibc(2.17-326.el7_9.3)는
  `GLIBC_2.17`까지만 정의하고 `getrandom`이 없다. CentOS 7.9 패키지 70여 개로 실행 파일의 의존성을 전부 채우고 그 로더
  (`ld-2.17.so --inhibit-cache --library-path …`)로 띄우면 오래된 expat을 앞에 둬도 `version 'GLIBC_2.25' not found`로 exit 1이다 —
  로더는 기호를 묶기 전에 버전부터 보므로 **보통의 RHEL 7에서는 보고의 오류가 나올 수 없다.** RHEL 7 라이브러리에 없는 강한 참조는
  `getrandom` 하나뿐이다(없는 약한 참조 29개 — `gbm_bo_get_fd_for_plane`·`statx` 등 — 는 로더를 멈추지 않는다). Claude Code
  2.1.296의 실행 파일은 `GLIBC_2.17`까지만 요구한다.
- **app.asar에 저장소가 통째로 들어간다** — `electron-builder.yml`에 `files`가 없어 docs·테스트·소스가 실린다. 동작에는 영향이 없다.
- 한국어가 □로 보이면 그 장비에 한글 글꼴이 없는 것이다(WSL Ubuntu가 그랬다).

## 5. 확인

- 단위: `core/runner/userEnv.test.ts` — 되돌리기·빈 표식·글자 보존, 브리지 env, 그리고 **진짜 sh로** 껍데기(AppRun의 앞자리,
  빈 값, 빈 칸 보존, usr/lib 없음, 심볼릭 링크를 거친 APPDIR, 껍데기를 가리키는 링크, 인자 그대로 — posix에서만) · 모든 플랫폼에서
  CR 없음·표식 이름·`.bin` 이름의 짝. 띄우는 자리마다(`runCli`·probe·git·두 어댑터·`--version`·터미널·run 전체와 MCP 설정 —
  `index.test`의 run은 가짜 CLI가 받은 환경과 설정 파일의 브리지 env를 함께 본다).
- 변이 26개를 전부 잡는다 — 자리마다 되돌리기, 터미널 순서 뒤집기, 브리지 env 빼기·순서 뒤집기·WSL에 싣기, 껍데기의 앞자리·
  APPDIR·usr/lib·readlink·빈 표식(6개는 리눅스에서만 돈다 — WSL Ubuntu 24.04의 복사본에서 돌렸다).
- 전체 단위: Windows 2976 통과(45 건너뜀 — posix 전용), WSL Ubuntu 24.04 3017 통과.
- 실측 (WSL Ubuntu 24.04, 2026-10-14): v0.26.0을 풀어 껍데기·새 app.asar를 넣고 같은 도구(mksquashfs·runtime)로 AppImage를
  다시 만들었다(Electron 실행 파일은 릴리스와 바이트가 같다). `check-appimage.sh`는 v0.26.0을 "`.bin`이 없다"로 거부하고 고친 것은
  통과한다(대조가 보고와 같은 오류를 낸다). 같은 오래된 expat을 `LD_LIBRARY_PATH`에 둔 채 AppRun으로 띄워 Playwright로 몰았다 —
  앱이 뜨고(앱 안의 `LD_LIBRARY_PATH` = `<AppDir>/usr/lib`, 표식 = 사용자의 값), zygote·네트워크 유틸리티가 다시 exec돼 뜨고, 가짜
  claude(`fake-claude-mcp.mjs` — 서버 env를 자기 환경 위에 얹어 브리지를 띄운다)가 MCP로 이슈를 만들고, 터미널 셸의 값이
  사용자의 것이다(`LD=[…/oldexpat] MARK=[none]`). `/proc/<pid>/environ`은 Chromium이 프로세스 제목을 쓰며 덮어 비어 보인다 —
  앱의 환경은 앱 안에서 물었다.
