# Spec: 리눅스 패키지가 RHEL 8(glibc 2.28)에서 돈다

- 출처: 대화 (2026-10-14) — RHEL에서 받은 보고(`docs/sdlc/linux-launch-env/`)의 장비가 RHEL 7이라는 답을 듣고, RHEL 7은 Electron
  자신이 막는다(그 spec §4)고 알린 뒤 "그럼 8이라고 가정하고 수정해줘". intent는 생략했다 — 고치는 방식은 위임받았다.
- 작성자: 권용현 (초안: Claude)
- 상태: 구현됨, v0.26.2로 릴리스 — 첫 릴리스 CI(v0.26.1)가 electron-rebuild의 사본을 잡아 고쳤다 (§3)
- 작성일: 2026-10-14

## 0. 무엇이 RHEL 8을 막나 (실측)

linux-launch-env의 실행 껍데기로 `XML_SetHashSalt`를 넘겨도 v0.26.0의 AppImage는 RHEL 8에서 시작하지 못한다. 패키지의 x86-64 ELF가
요구하는 기호 버전을 보면 막는 것은 **네이티브 모듈 둘**뿐이다.

| 파일 | 강한 요구 | 출처 |
|---|---|---|
| Electron 43 실행 파일 | `GLIBC_2.25`(`getrandom`) — `GLIBC_2.18`은 약한 참조 | 그대로 둔다 — RHEL 8(2.28) 안이다 |
| Chromium 동봉 라이브러리(libffmpeg·libEGL·…)·crashpad·chrome-sandbox | `GLIBC_2.17` 이하 | 〃 |
| better-sqlite3 13.0.3 `prebuilds/linux-x64.node` | `GLIBC_2.29`·`2.33`·`2.34`, `GLIBCXX_3.4.29` | 패키지에 든 사전 빌드 — 진입점(`lib/binding.js`)이 `build/Release`보다 먼저 집는다 |
| node-pty 1.1.0 `build/Release/pty.node` | `GLIBC_2.34` | 사전 빌드가 없어 러너(ubuntu-latest)에서 컴파일한다 — `forkpty`가 2.34에서 libutil에서 libc로 옮겨 왔다 |

RHEL 8은 glibc 2.28, libstdc++는 GCC 8.5의 것(`GLIBCXX_3.4.25`·`CXXABI_1.3.11`)이다. AlmaLinux 8.10 위에서 껍데기를 고친 패키지에
원래 사전 빌드를 넣고 띄우면 앱이 DB를 여는 순간 이렇게 죽는다(창이 뜨지 않는다 — main의 오류 대화상자에서 멈춘다):

```
Error: /lib64/libm.so.6: version `GLIBC_2.29' not found (required by …/better-sqlite3/prebuilds/linux-x64.node)
```

## 1. 정한 것

**릴리스 CI가 두 모듈을 RHEL 8과 같은 glibc·libstdc++ 위에서 다시 빌드하고, 산출물로 하한을 확인한다.**

- **FR-1 컨테이너에서 다시 빌드한다.** 리눅스 빌드가 `pnpm install` 직후 `build/linux/build-native.sh`를 manylinux_2_28 이미지
  (AlmaLinux 8 + gcc-toolset-14 — PyPA가 "glibc 2.28 이상 어디서나 도는 바이너리"를 만들려고 관리한다) 안에서 부른다. 이미지는 2주
  넘은 태그를 **다이제스트로** 고정한다(`2026.09.29-1@sha256:407f…`) — 올릴 때는 둘을 같이 바꾼다. 저장소는 같은 경로에 올리고
  (pnpm의 node_modules는 심볼릭 링크다) 러너의 Node를 읽기 전용으로 빌려 `--nodedir`로 쓴다 — 헤더를 받으러 나가지 않는다.
  `--user`로 러너의 사용자와 같게 띄워 만든 파일의 주인이 바뀌지 않는다. 그 뒤의 `pnpm test`는 다시 빌드한 것으로 돈다.
- **FR-2 gcc-toolset이 libstdc++를 맞춘다.** 툴셋은 시스템 libstdc++(GCC 8)에 없는 것만 정적으로 넣는다 — 그래서 만든 것이 RHEL 8의
  libstdc++로 돈다. 시스템 GCC 8로는 안 된다 — better-sqlite3가 `-std=c++20`이다.
- **FR-3 better-sqlite3는 사전 빌드 자리를 갈아 끼운다.** 패키지에 사전 빌드가 있으면 `binding.gyp`가 빌드를 건너뛰므로
  `--force_build=1`로 연다(패키지 자신의 `build-release` 스크립트와 같다). 결과를 `prebuilds/linux-x64.node`에 두고 `build/`는
  지운다. **덮어쓰기 전에 지운다** — pnpm은 node_modules의 파일을 저장소에서 하드 링크하므로 제자리에서 덮으면 pnpm 저장소(CI가
  캐시한다)의 원본까지 바뀐다.
- **FR-4 node-pty는 `build/Release/pty.node` 하나만 남긴다.** 진입점(`lib/utils.js`)이 `build/Release`를 먼저 본다. 중간 산출물은
  패키지에 실을 이유가 없어 지운다(리눅스에는 `spawn-helper`가 없다 — macOS 것이다). **postinstall의 electron-rebuild가 남긴
  `bin/<플랫폼>-<arch>-<ABI>/` 사본도 지운다** — `-w better-sqlite3`는 고르는 것이 아니라 더하는 것이라(고르는 것은 `-o`) 리눅스에서는
  node-pty도 다시 빌드하고, 결과를 그 자리에 복사해 둔다(`replaceExistingNativeModule`). node-pty는 그 자리를 읽지 않지만 러너의
  glibc로 빌드된 것이라 패키지에 실리면 하한 검사에 걸린다(§3의 첫 릴리스 CI).
- **FR-5 하한 검사 한 자리.** `build/linux/check-glibc.sh`가 x86-64 ELF의 **강한** 요구만 보고 `GLIBC_2.28`·`GLIBCXX_3.4.25`·
  `CXXABI_1.3.11`을 넘으면 실패한다. 약한 참조는 없어도 로더가 멈추지 않는다. 다른 아키텍처의 ELF(better-sqlite3가 품은
  linux-arm64 사전 빌드 — `GLIBCXX_3.4.29`)는 이 패키지에서 로드되지 않아 건너뛴다. build-native.sh가 두 패키지 폴더 전체에
  (다시 빌드한 파일만이 아니라 — 실리는 것은 폴더째다), check-appimage.sh가 패키지 전체에 부른다 — 하한을 두 자리에 적지 않는다.
- **FR-6 정말 뜨고 도는지.** `build/linux/smoke-native.mjs`가 두 모듈을 불러 SQLite에 질의하고 pty로 셸을 띄워 셸이 계산한 글자를
  기다린다. build-native.sh는 컨테이너(곧 RHEL 8의 glibc·libstdc++, 이미지가 얹은 `LD_LIBRARY_PATH`는 뺀다) 안의 Node로,
  check-appimage.sh는 패키지의 Electron으로(껍데기를 거쳐 `ELECTRON_RUN_AS_NODE`) 부른다 — Node 헤더로 빌드한 것이 Electron에서
  뜨는지는 둘 다 N-API라서 되는 것이고(better-sqlite3 `NAPI_VERSION=10`, node-pty는 node-addon-api), 그것을 릴리스마다 본다.
- **FR-7 설치 안내.** 하한을 glibc 2.28로 적는다 — RHEL 8·Debian 10·Ubuntu 20.04 이상. RHEL 7은 그대로 안 된다.

### 버린 안

| 안 | 버린 이유 |
|---|---|
| 리눅스 job 전체를 컨테이너(`container:`)에서 | matrix에 Windows가 있어 갈라야 하고, electron-builder·테스트까지 옮기는 큰 변경이다. 그래도 better-sqlite3는 사전 빌드를 먼저 집으므로 강제 빌드가 따로 필요하다 |
| zig cc로 glibc 2.28을 겨눠 러너에서 빌드 | 컨테이너가 필요 없고 libc++를 정적으로 넣지만, node-gyp·LTO와 함께 쓰는 사례가 드물다. manylinux가 이 용도의 표준이다 |
| 러너에서 libstdc++만 정적으로 링크 | glibc의 기호 버전(2.34)은 그대로다 |
| AlmaLinux 8 이미지에 매번 dnf로 툴셋 설치 | 느리고 움직이는 부분이 많다. manylinux는 툴셋·python이 다 있다 |
| glibc 2.17(RHEL 7)까지 내린다 | Electron 자신이 `GLIBC_2.25`를 요구한다 — 실행 파일을 고쳐야 하는 다른 일이다(linux-launch-env §4) |

## 2. 대가

1. **리눅스 빌드가 길어진다.** 이미지(압축 약 275 MB)를 받고 두 모듈을 빌드한다 — WSL 12코어에서 76초(대부분 SQLite의 LTO)였고
   러너는 코어가 적어 더 걸린다.
2. **하한이 정확히 2.28이다.** 두 모듈 모두 `fcntl64@GLIBC_2.28`을 요구한다(glibc 2.28 헤더가 `fcntl`을 그리로 돌린다) — 빌드
   환경의 glibc가 곧 하한이다. 하한을 2.27로 낮춘 변이가 이 둘을 잡는다.
3. **의존성을 올리면 다시 본다.** better-sqlite3가 진입점의 순서를 바꾸거나 Electron이 더 새 glibc를 요구하게 되면 check-appimage
   3단계가 릴리스를 막는다 — 그때 정한다.
4. 진짜 RHEL 8 장비가 아니라 AlmaLinux 8.10의 userland에서 확인했다(커널은 WSL의 6.18 — RHEL 8은 4.18). 두 모듈은 커널 기능에
   기대지 않는다.

## 3. 확인 (2026-10-14, WSL Ubuntu 24.04 — docker가 없어 이미지를 받아 사용자 네임스페이스 + chroot로 돌렸다)

- **빌드:** manylinux_2_28(`2026.09.29-1`, 이미지의 환경 변수 그대로) 안에서 `build-native.sh` — 76초. 결과는 GLIBC 최고 2.28,
  GLIBCXX 3.4.22, CXXABI 1.3.9. 컨테이너 안의 스모크 통과(SQLite 3.53.4).
- **CI 재현:** 저장소 사본에서 `pnpm install --ignore-scripts` → 위 빌드 → `pnpm test`(3017 통과, 4 건너뜀 — 다시 빌드한
  better-sqlite3로) → `pnpm build` → `electron-builder --linux` → `check-appimage.sh` 1~4단계 통과(x86-64 ELF 17개). 이 WSL에는
  러너에 있는 NSS·ALSA가 없어 그 패키지를 받아 네임스페이스 안에서만 시스템 라이브러리 폴더에 겹쳐 올렸다.
- **RHEL 8 실측:** AlmaLinux 8.10 rootfs(glibc 2.28, libstdc++ 8.5, GTK 3.22.30)에 데스크톱 라이브러리와 Xvfb를 깔고, 사용자의
  `LD_LIBRARY_PATH`에 `XML_SetHashSalt`를 지운 libexpat을 둔 채(보고와 같은 조건) AppRun으로 띄워 Playwright로 몰았다 — 1.3초에
  창이 뜨고(앱의 glibc 2.28, `LD_LIBRARY_PATH` = `<AppDir>/usr/lib`, 표식 = 사용자의 값), 가짜 claude가 MCP 브리지로 이슈를 만들어
  DB에 쓰고 화면이 다시 읽고, 터미널(node-pty) 셸이 `LD=[…/oldexpat] MARK=[none] SUM=42`를 찍는다. 한글은 Noto CJK로 보인다.
- **대조:** 같은 패키지에 원래 better-sqlite3 사전 빌드만 되돌리면 RHEL 8의 ldd가 `GLIBC_2.29`·`2.33`·`2.34`·`GLIBCXX_3.4.29`를
  못 찾고, 앱은 §0의 오류로 창을 띄우지 못한다(Playwright 60초 초과).
- **변이:** check-glibc.sh — x86-64만 고르는 줄을 지우면 linux-arm64 사전 빌드(`GLIBCXX_3.4.29`)로 실패한다, 하한을 2.27로 낮추면
  두 모듈(2.28)을 잡는다, 원래 사전 빌드를 주면 실패한다. build-native.sh — 갈아 끼우기를 빼면 자기 검사(원래 사전 빌드)가,
  `--force_build=1`을 빼면 복사할 파일이 없어 실패한다.
- **돌리지 못한 것:** docker로 부르는 CI 단계 자체 — 같은 이미지·환경 변수를 chroot로 썼다. 다음 릴리스의 CI가 처음 돈다.
- **첫 릴리스 CI (v0.26.1, run 38590659432, 2026-10-14):** docker 단계 1분 37초 통과(자체 검사·스모크 포함), 다시 빌드한 것으로
  `pnpm test` 통과, check-appimage 1·2단계 통과. **3단계가 실패했다** — `node-pty/bin/linux-x64-148/node-pty.node`가 `GLIBC_2.32`·
  `2.34`를 요구한다. postinstall의 electron-rebuild가 러너에서 node-pty를 다시 빌드하고 남긴 사본이다(FR-4). 위의 CI 재현은
  `pnpm install --ignore-scripts`로 돌아 그 사본이 생기지 않았다 — **재현할 때는 설치 스크립트를 켠다.** build-native.sh가 그 사본을
  지우고 자체 검사를 두 패키지 폴더 전체로 넓혔다(FR-5). 흉내낸 트리(그 자리에 Ubuntu 24.04의 실행 파일)로 넓힌 검사가 잡고, 지우면
  통과하는 것을 봤다. v0.26.1의 태그는 옮기지 않고 그 빌드에 남겼다 — 릴리스는 v0.26.2다.
- **v0.26.2 릴리스 CI (run 38642516044):** docker 단계 1분 56초(넓힌 자체 검사 포함) 통과, `pnpm test` 통과, check-appimage 1~4단계
  통과 — 대조는 `undefined symbol: XML_SetHashSalt`로 죽고, 껍데기는 뜨고, x86-64 ELF 17개의 최고 요구가 `GLIBC_2.28`·
  `GLIBCXX_3.4.22`·`CXXABI_1.3.9`이고, 패키지의 Electron이 better-sqlite3(SQLite 3.53.4)와 node-pty를 불러 쓴다.
