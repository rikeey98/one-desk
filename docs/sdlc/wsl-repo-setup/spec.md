# Spec: WSL repo를 한 번에 등록하고, WSL 설정을 한 탭에 모은다

- 출처: 대화 (2026-10-14) — "wsl 폴더를 등록하는게 좀 불편함 설정도 레포를 먼저 만들어야지 할수 있자나 동선이 어색해",
  그리고 두 안 중 "1안으로 해주고 설정에 wsl 관련 설정을 모아서 따로 보여줘 ui/ux 전문가처럼해줘". intent는 생략했다 — 문제와
  방향(아래 §0)을 사용자가 같은 대화에서 정했고, 화면의 세부는 위임받았다.
- 작성자: 권용현 (초안: Claude)
- 상태: 구현됨 — 캡처로 확인받는다 (§6)
- 작성일: 2026-10-14

## 0. 문제와 정한 것

다른 장비에서 WSL repo를 등록해 보니 두 군데서 막혔다.

1. **폴더를 찾기 어렵다.** 등록 폼의 폴더 선택은 Windows 대화상자인데, 그 장비에서는 탐색 창에 `Linux` 항목이 보이지 않았다.
   `\\wsl.localhost\<배포판>\home\<사용자>`를 주소줄에 직접 쳐야 했다.
2. **등록한 뒤에야 WSL로 바꿀 수 있다.** 등록 폼에는 실행 환경 칸이 없어 WSL 폴더도 `Windows`로 등록되고, 설정 → repo 탭에 가서
   라디오를 바꾸고 저장해야 했다. 그것을 빠뜨리면 Windows의 claude가 UNC 경로에서 돈다. wsl-support spec **FR-5**("등록 폼은
   그대로다 — 환경은 등록 뒤 repo 탭에서 바꾼다")가 정한 동선이고, 이 spec이 그것을 뒤집는다.

그리고 WSL 설정이 세 탭에 흩어져 있었다 — WSL claude 경로·WSL 글로벌 skill 경로는 앱 탭, WSL claude의 상태는 실행 탭의 CLI 상태,
repo마다의 실행 환경은 repo 탭.

| 질문 | 답 (2026-10-14) |
|---|---|
| 등록 동선 | **1안** — 등록 폼에서 알아서 맞춘다. 폴더 버튼 옆의 `WSL` 버튼이 WSL 홈에서 대화상자를 열고, WSL 폴더면 `WSL 안의 claude로 실행`이 켜진 채 나타난다 |
| WSL 설정 | **설정에 `WSL` 탭을 따로 둔다** — 흩어진 WSL 관련 설정을 모은다 |
| 화면의 세부 | 위임 ("ui/ux 전문가처럼") |

### 실측 (2026-10-14, Windows 11 · Store WSL 3.0.1 · Electron 43)

| `dialog.showOpenDialog`의 `defaultPath` | 결과 |
|---|---|
| `\\wsl$\Ubuntu-24.04\home\rikeey` | 그 폴더에서 열린다 — 주소줄 `Linux › Ubuntu-24.04 › home › rikeey`, 탐색 창에 `Linux`가 없어도 된다 |
| `\\wsl$` · `\\wsl.localhost` (배포판 목록) | **받지 않는다** — 파일 이름 칸에 `wsl$`가 들어가고 마지막 폴더에서 열린다 |

그래서 시작 폴더는 늘 **배포판 하나의 홈**이다. 배포판이 여럿이면(Docker Desktop이 `docker-desktop` 배포판을 따로 깐다 — 흔하다)
**기본 배포판**이다. 다른 배포판은 대화상자 주소줄의 `Linux`를 눌러 간다.

`wsl.exe --list --verbose`는 이렇다(UTF-16LE). 머리 줄은 로캘을 탈 수 있으므로 기본 배포판은 `*`로 시작하는 줄로만 판다.

```
  NAME            STATE           VERSION
* Ubuntu-24.04    Stopped         2
```

## 1. 범위

렌더러(등록 폼 · 사이드바 repo 카드 · 설정 화면) + core 둘(`listDistros`의 기본 배포판, 대화상자 시작 폴더) + IPC 하나
(`app:pickDirectory`가 선택 인자를 받는다). 마이그레이션·스키마 변경 없음.

**빠지는 것**: WSL repo가 없을 때 WSL claude를 미리 확인하는 것(그러려면 WSL VM을 띄워야 한다 — 설정 화면을 열었다고 VM을 깨우지
않는다. §5의 1), 등록 폼에서 배포판을 고르는 메뉴(기본 배포판 + 대화상자의 `Linux`로 충분하다), repo 탭의 실행 환경 라디오를 WSL
탭으로 옮기는 것(그 값은 repo의 것이고 repo 탭의 저장 하나에 묶여 있다 — WSL 탭은 목록과 바로가기다).

## 2. 기능 요구사항

### (A) 등록 폼 — 사이드바의 `repo 등록`

- **FR-1** 경로 칸 오른쪽, 폴더 선택 아이콘 다음에 `WSL` 버튼이 선다(글자 버튼 — 펭귄 글리프는 쓰지 않는다, DESIGN.md "아이콘
  자리에 유니코드 글리프 금지"). 접근성 이름은 `WSL 폴더 고르기`, 풍선은 `WSL 폴더 고르기 — <기본 배포판>의 홈에서 엽니다`.
  **WSL을 쓸 수 있고(`supported`) 배포판이 하나 이상일 때만** 선다. 폼은 열릴 때 `wsl.listDistros()`를 한 번 부르고, 실패하면 WSL을
  쓸 수 없는 것으로 본다(버튼·체크 없음 — 폼은 지금처럼 돈다).
- **FR-2** 누르면 `app.pickDirectory({ start: 'wsl' })`. **렌더러는 배포판도 경로도 넘기지 않는다** — 시작 폴더는 core가 정한다
  (FR-11, wsl-support FR-32의 원칙). 고른 결과는 폴더 선택과 같게 처리한다: 경로를 채우고, 이름이 비었으면 폴더 이름으로 채운다.
- **FR-3** 경로 칸의 값이 WSL 경로(`parseWslPath`가 푸는 `\\wsl$\…`·`\\wsl.localhost\…`)이고 WSL을 쓸 수 있으면 — 쳤든 붙여
  넣었든 골랐든 — 경로 칸 아래에 체크 `WSL 안의 claude로 실행`이 **켜진 채** 서고, 그 밑에 모노로 **두 줄** — 배포판(흐리게) ·
  Linux 경로 — 이 선다(체크의 접근성 설명이다). 한 줄로 이으면 좁은 사이드바에서 `Ubuntu-` / `24.04`, `onedesk-` / `capture`처럼
  하이픈에서 끊겼다(캡처). 끄면 그 자리가 `Windows의 claude가 이 폴더를 다룹니다`로 바뀐다. 배포판이 목록에 없으면 경고 한 줄(`이
  배포판이 wsl --list에 없습니다 — 꺼져 있거나 이름이 다를 수 있습니다`, repo 탭과 같은 문구)이되 등록은 막지 않는다. 대화상자가 넣은
  경로는 칸을 끝까지 밀어 고른 폴더 이름이 보이게 한다(칸의 풍선은 전체 경로).
- **FR-4** 사람이 끈 체크는 경로가 WSL 경로인 동안 남는다(한 글자 고칠 때마다 다시 켜지지 않는다). 경로가 WSL 경로가 아니게
  되거나 대화상자가 새 경로를 넣으면 기본(켜짐)으로 돌아간다.
- **FR-5** `추가`는 체크가 켜져 있으면 `agentEnv: 'wsl'`을 실어 보낸다. 그 밖에는 지금과 같은 모양(`agentEnv` 없음 = host)이다.
  등록이 끝나면 체크도 처음으로 돌아간다.
- **FR-6** 사이드바의 WSL repo 카드는 이름 뒤에 작은 `WSL` 표식을 단다(등록 결과가 눈에 보이게). 카드의 풍선은 `WSL · <배포판> ·
  <Linux 경로>`다. 접근성 이름은 그대로 `<이름> repo`다.

### (B) 설정 — `WSL` 탭

- **FR-7** 탭 줄이 `실행 · 앱 · repo · WSL · 정보`가 된다. `WSL`은 WSL을 쓸 수 있을 때(`supported`)만 선다 — 다른 OS에서는 지금처럼
  넷이다. 탭은 값의 범위로 가른다는 규칙(settings-screen FR-2)의 **예외다**: WSL은 "이 장비 안의 또 하나의 장비"라 값이 거의 전부
  장비 범위이고(앱 탭과 같다), 한 절(WSL repo)만 workspace 범위다. 그 절은 제목이 범위를 말한다.
- **FR-8** 절은 의존 순서다 — 바탕(배포판) → 그 위의 claude → 그것을 쓰는 repo → 드물게 고치는 skill 경로. 맨 위 범위 문장의
  오른쪽 끝에 탭 전체의 `다시 확인`(보조 버튼 — 배포판 목록과 CLI 상태를 캐시를 버리고 다시 묻는다)이 선다. 절마다 두지 않는 것은
  배포판이 없을 때의 빈 상태도 같은 버튼을 가리켜야 해서다.
  1. **배포판** — 설치된 배포판을 알약으로(`기본` 표식), 목록 이름 `WSL 배포판`. 하나도 없으면 빈 상태: `이 PC에 WSL 배포판이
     없습니다` + 설치 명령 `wsl --install`(모노) + 다음 행동 문장. 목록을 못 얻었으면 그 이유. 다시 확인에서 못 얻으면 보던 목록을
     지우지 않고 이유만 바꾼다(탭이 사라지지 않게).
  2. **WSL 안의 claude** — 상태 한 줄은 실행 탭 CLI 상태의 WSL 줄과 **같은 컴포넌트·같은 데이터**(`AgentStatusRow`,
     `checkAgents`·`probeAgents`의 `wsl`)다 — 따로 묻지 않는다(실행 탭과 다른 말을 하면 안 된다). WSL repo가 없으면 상태 대신 안내
     (`<workspace>에 WSL repo가 없어 아직 확인하지 않았습니다…`). 그 아래 `WSL claude 경로` 칸과 `WSL claude 경로 저장`(앱 탭에서
     옮겨 온다 — 이름·동작 그대로. 칸의 안내 글은 모노가 아니다 — 한글이 고정폭 대체 글꼴로 벌어진다).
  3. **WSL repo — `<workspace>`** — 지금 고른 workspace에서 실행 환경이 WSL이거나 경로가 WSL 폴더인 repo. 줄마다 이름 · `<배포판> ·
     <Linux 경로>`(모노) · 표식(`WSL claude` / `Windows claude`) · `repo 탭에서 열기`(보조 버튼, 접근성 이름 `<이름>: repo 탭에서
     열기`). WSL 폴더인데 Windows claude인 줄은 안내 한 줄을 단다. 없으면 빈 상태: 등록 폼의 `WSL` 버튼을 가르친다. workspace를
     고르지 않았으면 그 안내.
  4. **WSL 글로벌 skill 경로** — 앱 탭에서 옮겨 온다(이름·동작 그대로).
- **FR-9** `repo 탭에서 열기`는 repo 탭으로 옮기고 그 repo 덩어리를 화면에 들여와 실행 환경 라디오에 포커스를 준다.
- **FR-10** 앱 탭에서 WSL 두 절이 빠진다. 대신 `CLI 기본 경로`·`글로벌 asset 경로`의 안내가 `WSL 탭`을 가리킨다(WSL을 쓸 수
  있을 때만). 실행 탭의 `CLI 경로 — 이 workspace만` 안내도 `WSL 탭의 claude 경로`를 가리킨다. 초안 state는 지금처럼 전부
  `SettingsPanel`이 쥔다 — 탭 컴포넌트(`WslTab`)는 그리기만 한다(settings-screen FR-11).

### (C) core

- **FR-11** `core.wsl.folderStart(): Promise<string | null>` — 대화상자의 시작 폴더. 기본 배포판의 홈 UNC(`\\wsl$\<배포판>\home\me`,
  `wslHome.of` — 캐시 규칙 그대로). 홈을 못 물으면 그 배포판의 루트(`\\wsl$\<배포판>`). 배포판이 없거나 Windows가 아니면 null(대화상자는
  OS 기본 위치에서 열린다).
- **FR-12** `WslDistros.defaultDistro: string | null`. 배포판이 하나면 그것, 여럿이면 `wsl.exe --list --verbose`의 `*` 줄 이름(그 이름이
  `--quiet` 목록에 있을 때만), 못 정하면 null이고 그때 `folderStart`는 목록의 첫 배포판이다. `--verbose`의 실패는 오류가 아니다(null).
- **FR-13** `app:pickDirectory`가 선택 인자 `{ start?: 'wsl' }`를 받는다. `'wsl'`이 아닌 값은 무시한다. 핸들러는 `folderStart`를
  부르고 대화상자를 여는 것뿐이다.

## 3. 비기능 요구사항

- **NFR-1** 이름이 부분 일치로 부딪히지 않는다(CLAUDE.md) — `WSL 폴더 고르기`는 `폴더 선택`을, `<이름>: repo 탭에서 열기`는
  `<이름> repo`를 품지 않는다. 탭 이름 `WSL`, 체크 `WSL 안의 claude로 실행`, 목록 `WSL 배포판`·`WSL claude 상태`는 기존 셀렉터와
  겹치지 않는다(e2e를 돌려 확인).
- **NFR-2** 색은 토큰만, 다크에서도 4.5:1(DESIGN.md). 새 토큰 없음.
- **NFR-3** 판정은 순수 함수다 — 등록 폼의 실행 환경(`registerEnvOf`·`wslPickerOf`), WSL repo 목록(`wslRepoRowsOf`), 카드 풍선
  (`repoTitleOf`) — 전부 `renderer/agentEnv.ts` — 기본 배포판 파싱(`parseDefaultDistro`), 시작 폴더(`folderStartOf`), IPC 인자
  (`core/app/pickStart.ts`의 `pickStartOf` — electron IPC에는 테스트가 없어 `reveal.ts`처럼 떼어 둔다).
- **NFR-4** 설정 화면은 한국어를 낱말째 넘긴다(`word-break: keep-all`) — 기본값은 음절 사이 어디서나 끊어 `로그` / `인`처럼 낱말이
  갈렸다(캡처에서 찾았다. WSL 탭만이 아니라 설정 화면 전체가 그랬다).

## 4. 검증

- 단위: 등록 폼(버튼이 서는 조건, 시작 인자, 체크의 기본·유지·초기화, payload), 순수 함수, repo 카드 표식, WSL 탭(절·빈 상태·
  옮겨 온 두 저장·탭 왕복 초안·바로가기), core(`defaultDistro`·`folderStart`).
- e2e: `wsl.e2e.ts`(Windows, 가짜 wsl.exe) — 대화상자를 바꿔 세우고 `WSL` 버튼 → 시작 폴더가 기본 배포판의 홈 → 체크가 켜진 채 등록
  → repo 탭의 라디오가 WSL → WSL 탭의 목록·상태. `repo-pick.e2e.ts`는 그대로 초록이어야 한다.
- 실측: 대화상자가 WSL 홈에서 열린다(§0 표). 앱 캡처(라이트·다크).

## 5. 우려

1. **WSL repo가 없으면 WSL claude 상태가 없다.** 미리 보려면 기본 배포판에서 판정해야 하는데, 그것이 WSL VM을 깨운다(메모리를 쓴다).
   설정을 열 때마다 깨우지 않는다. 등록이 한 번에 되므로 "등록 → 상태 확인"이 짧다. 필요하면 WSL 탭에 명시적인 `확인` 버튼을 더한다.
2. **WSL 탭은 탭 규칙의 예외다**(FR-7). 범위가 섞인 절은 제목에 workspace 이름을 단다.
3. 기본 배포판 판정은 `*` 표식에 기대므로 wsl.exe가 형식을 바꾸면 `defaultDistro`가 null이 되고 첫 배포판으로 떨어진다 — 틀린
   배포판에서 열릴 뿐 막히지는 않는다.
4. Linux 경로가 사이드바 칸보다 길면 경로 줄이 하이픈이나 글자 사이에서 한 번 더 넘어간다. `/` 뒤에서만 끊으려고 `<wbr>`을 넣어 봤지만
   브라우저는 여전히 맞는 만큼 하이픈에서 끊었고, 테스트 환경의 접근성 설명에 공백이 끼었다 — 두 줄로 가른 것으로 멈췄다.

## 6. 구현 결과 (2026-10-14)

- 단위: 전체 2952개 초록. 새로 `renderer/agentEnv.test.ts`(10) · `core/wsl/folderStart.test.ts`(5) · `core/app/pickStart.test.ts`(2),
  늘어난 것 `AddRepoForm.test`(4 → 14) · `SettingsPanel.test`의 WSL 탭(17, 앱 탭의 WSL 절 넷을 옮겼다) · `distros.test`(8 → 13) ·
  `RepoStrip.test`(+1) · `index.test`(+1).
- **변이 18개를 전부 잡는다** — 체크를 잊지 않음 둘, 늘 host로 보냄, 시작 인자 빠짐, WSL 탭 필터 뺌, `statuses`·`focusRepoId` 배선
  끊음, 다시 확인이 캐시를 버리지 않음·배포판을 다시 묻지 않음, 앱 탭 안내 뺌, 카드 풍선·표식, 기본 배포판 무시, 홈 실패 시 던짐,
  `--verbose` 안 띄움, `*` 이름 대조 뺌, IPC 인자 무조건 WSL, `core.wsl.folderStart` 늘 null.
- e2e: `wsl.e2e`(가짜 wsl.exe — 대화상자를 바꿔 세우고 시작 폴더 `\\wsl$\Ubuntu\home\me`를 본다)와 `repo-pick`·`settings`·`asset`.
  `wsl-real.e2e`는 등록 폼의 체크와 WSL 탭(`2b-wsl-tab`)을 진짜 WSL로 본다.
- 캡처(라이트·다크, 진짜 Ubuntu-24.04와 로그인된 claude 2.1.296): 한 번 고친 것 — 경로 줄의 하이픈 끊김(두 줄로), 경로 칸이 앞부분만
  보임(끝까지 민다), 한국어 낱말 가운데 줄바꿈(NFR-4), 범위 문장의 두 줄 넘김(문장을 줄였다), 모노 안내 글의 벌어진 한글, 상태 상자만 넓은
  폭(640px로 맞췄다).
