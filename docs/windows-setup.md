# Windows 개발 환경 이관 가이드

맥에서 하던 one-desk 개발을 Windows 장비에서 이어가기 위한 문서다. 새 장비 앞에
앉아 위에서부터 순서대로 따라가면 된다.

**전제 두 가지.** 앞으로 Windows가 주력 개발 장비가 되고 맥은 가끔만 쓴다. 그리고
맥에 쌓인 앱 데이터(이슈·메모·대화 기록)를 그대로 가져간다 — §4가 그 절차다.

## 0. 이 문서가 확인한 것과 확인하지 못한 것

여기 적힌 사실은 대부분 저장소 안에 이미 실측으로 남아 있던 것들이다 —
`CLAUDE.md`의 "밟으면 조용히 깨지는 것들", `.github/workflows/release.yml`이
`windows-2022`로 고정된 이유, `core/runner/executable.ts`의 탐색 규칙. 매 릴리스마다
Windows 러너가 실제로 밟고 지나가는 경로다.

**그러나 이 가이드 전체를 Windows 장비에서 끝까지 돌려본 적은 없다.** 확인되지 않은
단계에는 ⚠️ 를 붙였다. 첫 실행 때 결과를 이 문서에 적어 넣어 ⚠️ 를 지워 나가면 된다.

## 1. 미리 깔 것

| 도구 | 버전 | 왜 |
| --- | --- | --- |
| Git for Windows | 최신 | |
| Node.js | **22** | Node 26은 renderer 테스트 78개를 깬다. 회귀가 아니라 환경 문제다. CI도 22로 고정돼 있다. 저장소 루트의 `.nvmrc`에 적혀 있으니 fnm이나 nvm-windows가 자동으로 맞춰 준다 |
| pnpm | 10.18.1 | `package.json`의 `packageManager`가 정답이다. `corepack enable` 후 `corepack prepare pnpm@10.18.1 --activate` |
| **Visual Studio Build Tools 2022** | 2022 | 아래 참조 — **최신 버전을 깔면 안 된다** |
| Python 3 | 3.x | node-gyp가 쓴다. VS Build Tools 설치 시 함께 넣을 수 있다 |

**npm이 아니라 pnpm을 쓴다.**

### Build Tools는 반드시 2022여야 한다

`better-sqlite3`는 네이티브 모듈이고, `postinstall`의 `electron-rebuild -f -w
better-sqlite3`가 **이 장비의 Electron ABI에 맞춰 소스에서 컴파일한다.** 그래서
C++ 컴파일러가 없으면 `pnpm install`이 통째로 실패한다. (크로스 컴파일이 불가능해
릴리스를 플랫폼마다 그 플랫폼 러너에서 빌드하는 것도 같은 이유다.)

문제는 **최신 Visual Studio 18(2026)을 깔면 pnpm이 번들한 node-gyp 11.1.0이 그것을
읽지 못한다**는 것이다. 증상은 컴파일러가 없을 때와 똑같다:

```
gyp ERR! find VS could not find a version of Visual Studio 2017 or newer
```

깔려 있는데 못 찾는다고 나오므로 원인을 짚기 어렵다. `release.yml`이
`windows-latest`가 아니라 `windows-2022`로 고정된 것이 이 함정을 피하려는
것이다(워크플로 주석 참조). node-gyp가 VS 18을 지원하면 그때 최신으로 옮긴다.

설치 시 고를 워크로드: **"C++를 사용한 데스크톱 개발"** 과 Windows SDK.

## 2. 받아서 돌리기

```powershell
git clone https://github.com/rikeey98/one-desk.git
cd one-desk

# .editorconfig가 LF로 못박혀 있다. autocrlf가 켜져 있으면 체크아웃만 해도
# 모든 파일이 바뀐 것으로 보인다.
git config core.autocrlf false

# node_modules가 깊어 260자 제한에 걸릴 수 있다 (관리자 권한 필요)
git config --system core.longpaths true

corepack enable
pnpm install          # postinstall이 better-sqlite3를 컴파일한다. 첫 설치는 느리다
```

검증:

```powershell
pnpm typecheck
pnpm lint
pnpm test             # 단위 테스트. CI가 windows-2022에서 매 릴리스 돌리는 범위다
pnpm dev              # 앱이 뜨는지
```

⚠️ `pnpm test:e2e`는 §5를 먼저 읽을 것 — Windows에서 통과하지 못할 가능성이 높고,
그게 이 장비에서 처음 손볼 일이 될 수 있다.

## 3. agent CLI 설치

### Claude Code

**네이티브 설치 스크립트로 `claude.exe`를 깐다. npm 전역 설치는 쓸 수 없다.**

npm 전역 설치가 만드는 `claude.cmd`는 `.cmd` 배치 파일인데, Node는 CVE-2024-27980
이후 배치 파일을 `shell: true` 없이 spawn하지 못한다(`EINVAL`). shell을 켜면 인자가
cmd.exe의 인용 규칙을 타고, 실행 취소가 죽이는 대상이 cmd.exe 껍데기가 되어 취소가
실제 agent에 닿지 않는다. 그래서 켜지 않고 **프리플라이트가 명확한 메시지로
거부한다.**

앱이 자동으로 찾는 곳은 `PATH`의 각 디렉토리에 `PATHEXT` 확장자를 붙인 조합과,
폴백으로 `%USERPROFILE%\.local\bin`, `%USERPROFILE%\.claude\local`이다
(`core/runner/executable.ts`). 네이티브 설치본은 보통 첫 폴백에 들어간다.

⚠️ **자동 탐색이 실패했을 때의 탈출구가 지금은 막혀 있다.** 코드 주석과 릴리스
노트는 "workspace 설정의 claude 경로에 넣으라"고 안내하지만, `workspace.claudePath`는
스키마(`core/db/schema.ts`)에만 있고 **IPC 핸들러도 편집 UI도 없다** —
`electron/ipc/workspaces.ts`는 list/create/rename/remove만 등록한다. 자동 탐색이
실패하면 `PATH`에 넣거나 위 폴백 디렉토리에 두는 수밖에 없다. (설계의 구멍이므로
여기서 고치지 않고 적어만 둔다.)

### AWS Bedrock을 쓴다면

`CLAUDE_CODE_USE_BEDROCK` 같은 값은 **Windows 사용자 또는 시스템 환경 변수**로
등록돼 있어야 한다. PowerShell 프로필에만 있으면 GUI로 띄운 앱이 물려받지 못한다.
Windows GUI 앱은 사용자·시스템 환경변수를 정상적으로 상속하므로, 등록만 해두면
앱이 자식 프로세스에 그대로 넘긴다 — 앱 쪽에 따로 설정할 것은 없다.

자격 증명도 앱이 손댈 일이 없다. `aws sso login`이 받은 토큰은
`%USERPROFILE%\.aws\sso\cache\`에 파일로 저장되고 Claude Code 안의 AWS SDK가 직접
읽는다.

### OpenCode

`opencode`를 설치하고 로그인해 둔다. `.cmd` 설치본을 거부하는 것은 Claude Code와
같은 이유다. 모델은 `provider/model` 형식으로 적는다 — 예: `anthropic/claude-sonnet-4-5`.

## 4. 앱 데이터 옮기기

사용자 데이터 위치는 `electron-builder.yml`의 `productName: one-desk`가 정한다.

| | 경로 |
| --- | --- |
| macOS | `~/Library/Application Support/one-desk/` |
| Windows | `%APPDATA%\one-desk\` |

### 복사

**앱을 완전히 끈 상태에서** 세 파일을 복사한다:

```
one-desk.db
one-desk.db-wal
one-desk.db-shm
```

DB가 WAL 모드로 열리므로(`core/db/open.ts`) 체크포인트되지 않은 최근 기록이
`-wal`에만 남아 있을 수 있다. `.db` 하나만 복사하면 그만큼이 조용히 사라진다.

옮긴 뒤 첫 실행에 마이그레이션 `0001`~`0005`가 필요한 만큼 돌고, 돌기 **전에**
`one-desk.db.<시각>.bak` 백업이 자동으로 만들어진다.

### 옮긴 뒤 반드시 다시 지정할 것

DB에 든 경로는 전부 macOS 것이다. 셋 다 손봐야 한다.

**글로벌 asset 경로 — 앱에서 바꾼다.** 사이드바 하단의 설정 화면에 "Claude Code
글로벌 경로"와 "OpenCode 글로벌 경로" 입력이 있다.
`~/.claude/skills` → `%USERPROFILE%\.claude\skills` 식으로 고친다.

**repo 경로 — 앱에서 바꿀 수 없다.** `electron/ipc/repos.ts`는 create·rename·remove만
등록하고 path 편집은 없다. 두 가지 길이 있다:

- **repo를 지우고 다시 등록한다.** 간단하지만 그 repo에 달린 asset 행과 이슈·메모의
  repo 태그가 cascade로 함께 사라진다. 과거 run이 그 repo를 맥락으로 담았던 기록도
  끊긴다.
- **앱을 끄고 SQLite로 직접 고친다.** 기록이 전부 살아남는다. 이쪽을 권한다.

```sql
-- 앱을 완전히 끈 상태에서 %APPDATA%\one-desk\one-desk.db 를 연다
UPDATE repo
   SET path = 'C:\Users\<사용자>\WorkSpace\one-desk'
 WHERE path = '/Users/yonghyun-kwon/WorkSpace/one-desk';

-- 남아 있다면 macOS 경로이므로 비운다. 비우면 자동 탐색으로 돌아간다
UPDATE workspace SET claude_path = NULL, opencode_path = NULL;

SELECT name, path FROM repo;   -- 확인
```

SQLite 문자열 안에서 백슬래시는 특별한 뜻이 없으므로 Windows 경로를 그대로 넣으면
된다.

**claude / opencode 경로** — §3에서 적었듯 편집 UI가 없다. 위 SQL로 비워 두고 자동
탐색에 맡긴다.

## 5. Windows에서 다르게 도는 것들

### ⚠️ e2e는 아마 이대로는 안 돈다

가짜 CLI 픽스처(`core/runner/fixtures/fake-claude.mjs` 등)는 `#!/usr/bin/env node`
셔뱅을 단 `.mjs` 파일이고 **Windows는 셔뱅을 모른다.** spawn이 즉시 실패하므로 run이
얽힌 e2e 시나리오는 통과하지 못할 것으로 본다.

같은 이유로 단위 테스트 쪽에서는 이미 알려진 현상이 있다. Windows에서 run은 항상
`failed`로 끝나고(그래서 `core/index.test.ts`의 run 테스트들이 `succeeded`가 아니라
`endedAt`만 본다), `markFinished`와 그에 딸린 `onRunUpdate`가 `await
core.execution.start(...)` **안에서** 이미 다 지나가 버린다. 그래서 `start()` 뒤에
만든 파일은 그 run의 asset 재스캔이 영영 보지 못한다 — "실행 중에 생긴 파일"을
흉내내려면 run을 띄우기 **전에** 써 둬야 한다. 맥에서는 가짜 CLI가 실제로 100ms쯤
돌아 순서가 맞아떨어지므로 **로컬은 초록인데 릴리스 CI만 깨진다**(v0.7.0·v0.7.1이
연속으로 이것에 걸렸다).

CI는 `pnpm test`까지만 돌리고 e2e는 돌리지 않는다. 즉 **e2e의 Windows 동작은 아무도
확인한 적이 없다.** 여기서 막히면 그게 이 장비에서 처음 할 일이다 — 픽스처를 `node
<파일>` 형태로 띄우도록 고치는 쪽이 유력하다.

### 열린 DB 핸들

Windows는 열린 핸들이 있는 파일을 지우지 못한다. POSIX는 열려 있어도 unlink되므로
맥에서는 핸들을 흘려도 `rmSync`가 조용히 성공하지만, Windows에서는 `EBUSY: resource
busy or locked`로 죽는다. 테스트에서 연 DB는 반드시 `db.$client.close()`로 닫을 것
(v0.2.0 릴리스가 실제로 이렇게 한 번 깨졌다).

### 그 밖에

- **`pnpm test:e2e`와 `pnpm dev`를 동시에 돌리지 말 것.** `test:e2e`가 `out/`을
  e2e용 빌드로 갈아끼워 실행 중인 dev 앱이 낡은 코드를 돌리게 된다. OS와 무관한
  함정이지만 장비를 옮긴 직후 다시 밟기 쉽다.
- **`dev` 스크립트의 `--watch`를 지우지 말 것.** 없으면 main과 preload가 시작할 때
  한 번만 빌드돼, `core/`를 고쳐도 앱이 낡은 코드를 계속 돌린다.
- **`pnpm run pack`의 `run`을 빼지 말 것** — `pnpm pack`은 내장 명령이라 다른 일을 한다.

## 6. git이 실어 나르지 않는 것

clone만으로는 따라오지 않는다. 맥에서 손으로 복사해야 하는 것들이다.

| 대상 | 왜 안 따라오나 |
| --- | --- |
| `.claude/settings.local.json` | `.gitignore`에 `.claude/`가 있다 |
| `.git/info/exclude` | **clone을 따라가지 않는다.** git의 설계다 |
| `memory/`, `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md` | 위 `exclude`가 무시하고 있다 |
| `DREAMS.md` | 추적도 무시도 되지 않은 개인 파일 |

**`.git/info/exclude`를 먼저 옮길 것.** 그 파일 없이 개인 md들만 복사하면 Windows
쪽 clone에서 전부 미추적으로 튀어나와 실수로 커밋하기 쉽다.

## 7. 맥에 남는 일

- **macOS 산출물은 맥에서만 만들 수 있다.** 네이티브 모듈 때문에 크로스 컴파일이
  안 된다. 필요하면 맥에서 `pnpm run pack`.
- Windows `.exe` 릴리스는 어느 장비에서 태그를 밀든 GitHub Actions가 만든다.
  `v*` 태그를 밀거나 `gh workflow run release.yml`.
- 태그와 `package.json`의 버전이 어긋나면 워크플로가 먼저 막아 준다.

## 8. 이어서 할 일

- **진행 중:** `docs/sdlc/conversation-context/` — intent·spec은 승인됐고 plan은
  draft다. 대화에 담긴 맥락을 대화록에 표시하는 작업.
- **남은 5단계 과제:** diff 뷰어, 마크다운 렌더링, 검색/필터/정렬.
- 착수 전에 `CLAUDE.md`를 읽을 것. 특히 "절대 지켜야 할 경계 세 가지"와 "밟으면
  조용히 깨지는 것들".

## 첫 실행 체크리스트

Windows에서 하나씩 지워 나가고, 막힌 곳은 이 문서에 적어 둔다.

- [ ] Node 22 / pnpm 10.18.1 / VS Build Tools **2022** / Python 3
- [ ] `git config core.autocrlf false`, `core.longpaths true`
- [ ] `pnpm install` 성공 (better-sqlite3 컴파일 통과)
- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm test` 초록
- [ ] `pnpm dev`로 앱이 뜬다
- [ ] `claude.exe` 네이티브 설치, 앱이 자동으로 찾는다
- [ ] `one-desk.db` + `-wal` + `-shm` 복사, 첫 실행 마이그레이션 통과
- [ ] repo 경로 SQL 수정, 글로벌 asset 경로 재지정
- [ ] 실제 run 한 번 성공 (맥락 담기 → 실행 → 로그 → 완료)
- [ ] ⚠️ `pnpm test:e2e` — 결과를 §5에 적을 것
