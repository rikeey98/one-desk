# 릴리스 파이프라인 설계 — GitHub Actions로 3개 플랫폼 빌드

**날짜:** 2026-08-14
**상태:** 승인됨
**근거:** electron-builder 26.15.3 문서(targets · mac · hooks), 기존 `electron-builder.yml`, `core/runner/adapters/claudeCode.ts`

---

## 1. 범위

`v*` 태그를 밀면 GitHub Actions가 macOS·Windows·Linux 산출물을 만들어 GitHub Release에 올린다. 지금은 `pnpm run pack`으로 로컬 macOS `.app`만 나오고, 그것을 남에게 건넬 방법이 없다.

**배포 대상은 소수의 동료·테스터다.** 이 전제가 서명 결정(유료 인증서 없음)과 릴리스 노트의 설치 안내를 결정한다.

**첫 실검증 대상은 Windows다.** 개발은 macOS에서 했지만 실제로 받아서 쓸 환경이 Windows이고, `core/`에는 `process.platform` 분기가 하나도 없다 — Windows 실행 경로는 한 번도 돌아본 적이 없다. 그래서 이 작업의 무게중심은 빌드 파이프라인이 아니라 **Windows에서 run이 실제로 도는 것**에 있다(§5).

### 들어가는 것

- `.github/workflows/release.yml` — 3개 러너 매트릭스, 태그 트리거 + 수동 실행
- `electron-builder.yml` 채우기 — `appId`, `productName`, 플랫폼별 타겟, ad-hoc 서명
- **`findExecutable`의 Windows 확장자 처리와 설치 경로 폴백 (§5)** — 이 작업의 핵심
- 태그와 `package.json` 버전 불일치 검증 (§6)
- 릴리스 노트의 고정 설치 안내 섹션 (§4)

### 빠지는 것

**자동 업데이트.** `electron-updater`는 서명된 앱을 전제로 하고, 서명하지 않기로 한 이상 macOS에서는 동작하지 않는다. 테스터 몇 명에게는 새 링크를 주는 편이 싸다.

**Intel Mac (x64).** 러너를 하나 더 쓰고 산출물이 하나 더 늘어난다. 테스터 중 Intel Mac이 나오면 그때 매트릭스에 한 줄 더한다 — 구조상 한 줄이다.

**Linux `.deb`, Windows NSIS 설치본.** "한 파일로 실행"이 요구사항이므로 AppImage와 portable exe만 만든다.

**유료 코드 서명·공증.** Apple Developer ID는 연 $99이고 Windows OV 인증서는 그보다 비싸다. 불특정 다수에게 배포할 때 다시 판단한다.

**CI에서의 e2e.** 지금까지 macOS에서만 돌던 Playwright+Electron e2e를 세 OS에 올리는 것은 별개의 작업이다. Linux에서는 xvfb가 필요하고, 새로 드러날 실패를 모두 잡아야 한다. 릴리스를 그것에 묶지 않는다.

**`Workspace.env` (Bedrock 환경변수) — 필요 없는 것으로 확인됐다.** CLAUDE.md가 "5단계 착수 전에 정할 것"으로 올려둔 항목이고, 평문 SQLite에 자격 증명을 넣을지가 막힌 결정이었다. **대상 Windows 환경을 실측해 보니 이 배관 자체가 불필요하다.**

macOS의 launchd는 GUI 앱에 최소 환경만 주지만, **Windows GUI 앱은 사용자·시스템 환경변수를 정상적으로 물려받는다.** 실측한 환경에서 Bedrock에 필요한 변수 셋(사용 플래그, 사내 게이트웨이 주소, 사설 CA 번들 경로)이 모두 **사용자 범위에 영구 등록**돼 있었다. 어댑터가 `env: { ...process.env }`로 통째로 넘기므로 패키징된 앱에 그대로 흘러간다.

자격 증명 자체도 문제가 되지 않는다. `aws sso login`이 받아온 토큰은 `~/.aws/sso/cache/`에 **파일로** 저장되고 Claude Code 안의 AWS SDK가 그 파일을 읽으므로, 프로세스를 어떻게 띄웠는지와 무관하다. **앱이 자격 증명을 손에 쥘 일이 없다** — 저장 위치를 고민할 필요도 없어진다.

macOS에서 같은 문제를 만나면 그때 다시 연다. 그 환경에서는 여전히 미해결이다.

**보안 메모:** 이 저장소는 public이다. 실측한 게이트웨이 주소와 CA 번들 경로는 내부 인프라 정보이므로 이 문서에 값을 적지 않는다. 변수 이름과 역할만 남긴다.

---

## 2. 산출물과 트리거

`v*` 태그 푸시 또는 `workflow_dispatch`로 시작한다. 세 러너가 병렬로 돌고, 모두 끝나면 **draft** 릴리스에 산출물이 모인다.

| 러너 | 아키텍처 | 타겟 | 산출물 |
|---|---|---|---|
| `macos-latest` | arm64 | `dmg` | `one-desk-<version>-arm64.dmg` |
| `windows-latest` | x64 | `portable` | `one-desk-<version>-x64.exe` |
| `ubuntu-latest` | x64 | `AppImage` | `one-desk-<version>-x64.AppImage` |

**draft로 만드는 이유:** 태그를 미는 순간 링크가 공개되면, 세 러너 중 하나가 실패했을 때 산출물이 두 개뿐인 릴리스가 이미 세상에 나가 있다. draft는 사람이 셋을 다 보고 나서 publish를 누르게 한다.

**"한 파일"의 의미가 플랫폼마다 다르다.** Windows portable exe와 Linux AppImage는 진짜 단일 실행 파일이다. macOS `.app`은 파일이 아니라 디렉토리(번들)라서 단일 파일이 될 수 없다 — 이것은 Electron이 아니라 macOS의 앱 구조다. 받는 사람 입장에서 파일 하나인 `.dmg`가 최선이다.

### 크로스 컴파일을 하지 않는 이유

`better-sqlite3`는 네이티브 모듈이고, `postinstall`의 `electron-rebuild -f -w better-sqlite3`가 Electron의 ABI에 맞춰 C++를 그 자리에서 컴파일한다. Mac에서 Windows용 바이너리를 만들 수 없다. **각 OS의 진짜 러너에서 자기 것만 빌드한다.** 저장소가 public이라 Actions 사용량은 무료다.

---

## 3. 워크플로 구조

각 러너가 같은 순서를 밟는다.

```
checkout
   │
   ├─ 버전 검증 (§6)  ← 태그 실행일 때만. 어긋나면 여기서 실패한다.
   ├─ pnpm / Node 설치
   ├─ pnpm install --frozen-lockfile   ← postinstall이 better-sqlite3를 리빌드한다
   │
   ├─ pnpm typecheck
   ├─ pnpm lint
   ├─ pnpm test                        ← 단위 370개
   │
   ├─ pnpm build
   ├─ pnpm exec electron-builder --<platform> --publish never
   └─ 산출물 업로드 (artifact)
         │
         └─ 세 러너가 끝난 뒤 별도 job이 모아서 draft 릴리스 생성
```

**검사를 빌드 앞에 둔다.** typecheck·lint·단위 테스트가 세 러너에서 중복 실행되지만, 세 OS에서 다 도는 것 자체가 정보다 — 지금껏 macOS에서만 검증됐다. 캐시가 도는 상황에서 러너당 몇 분이고, 깨진 것을 릴리스로 내보내는 비용보다 싸다.

**릴리스 생성을 별도 job으로 분리하는 이유.** 각 러너가 직접 릴리스에 올리면 셋이 경쟁하며 같은 릴리스를 만들려 하고, 하나가 실패해도 나머지 둘이 이미 올려버린다. 모으는 job은 세 빌드가 모두 성공해야 돌고, 릴리스를 한 번만 만든다.

`--publish never`를 명시한다. 빠뜨리면 electron-builder가 `GH_TOKEN`을 발견했을 때 스스로 릴리스에 올리려 들어, 모으는 job과 이중으로 올린다.

### 툴체인 고정

`package.json`에 `packageManager` 필드가 없어 CI가 어느 pnpm을 쓸지 정해지지 않는다. **`packageManager: "pnpm@10.18.1"`을 추가한다** — 로컬과 같은 버전이다. `pnpm/action-setup`이 이 필드를 읽으므로 워크플로에 버전을 중복해 적지 않아도 된다.

Node는 `22`로 고정한다(로컬 `v22.16.0`). 네이티브 모듈을 컴파일하므로 메이저가 흔들리면 `better-sqlite3` 빌드가 달라진다.

`--frozen-lockfile`은 `pnpm-lock.yaml`과 `package.json`이 어긋나면 실패한다. 이것이 의도다 — 락파일을 커밋하지 않은 채 릴리스가 나가는 것을 막는다.

---

## 4. macOS 서명 — 조용히 깨지는 자리

**서명을 끄면 Apple Silicon에서 앱이 실행되지 않는다.** arm64 macOS는 모든 실행 코드에 서명을 요구한다. 링커가 로컬 빌드에 ad-hoc 서명을 자동으로 붙이지만, **electron-builder가 번들을 수정하면서 그 서명을 깨뜨린다.** 결과는 "앱이 손상되었기 때문에 열 수 없습니다"이고, 이것은 `xattr`로 풀리지 않는다 — 격리 속성 문제가 아니라 서명이 없는 상태이기 때문이다.

electron-builder 문서가 답을 준다: `identity: null`은 서명을 아예 끄고, **`identity: "-"`는 ad-hoc 서명**을 한다. 후자를 쓴다. 유료 인증서 없이 앱이 실행 가능해진다.

**Gatekeeper는 여전히 남는다.** ad-hoc 서명은 "서명되어 있다"만 만족시키고 "신뢰할 수 있는 개발자가 서명했다"는 만족시키지 못한다. 테스터는 첫 실행에 한 번 우회해야 한다. 이 안내를 **릴리스 노트 본문의 고정 섹션**으로 넣는다.

```
## 설치

### macOS
1. .dmg를 열고 one-desk를 응용 프로그램으로 끌어다 놓습니다.
2. 터미널에서 한 번 실행합니다 (서명되지 않은 앱이라 필요합니다):
   xattr -dr com.apple.quarantine /Applications/one-desk.app

### Windows
포터블 실행 파일입니다. 설치 없이 바로 실행됩니다.
SmartScreen 경고가 뜨면 "추가 정보" → "실행"을 누르세요.

### Linux
chmod +x one-desk-*.AppImage && ./one-desk-*.AppImage

## 첫 실행 전에
Claude Code CLI가 설치되어 있어야 합니다.
흔한 설치 위치는 자동으로 찾지만, 못 찾으면 workspace 설정의
"claude 경로"에 실행 파일의 절대 경로를 붙여넣으세요.
  macOS/Linux: which claude
  Windows:     where.exe claude
```

**설정만으로는 검증되지 않는다.** `identity: "-"`를 넣었다고 실행되는지는 알 수 없다. **CI가 만든 DMG를 실제로 내려받아 여는 것까지가 이 항목의 완료 조건이다.** 구현 계획에 별도 단계로 넣는다.

---

## 5. `findExecutable` — 이 작업의 핵심

현재 구현(`core/runner/adapters/claudeCode.ts:54-66`)은 `process.env.PATH`를 쪼개 `join(dir, 'claude')`를 `access(X_OK)`로 확인한다. **POSIX만 상정한 코드다.** `core/` 전체에 `process.platform` 분기가 하나도 없다.

### 5-1. Windows — 확장자를 안 붙인다

Windows는 확장자로 실행 가능 여부를 정한다(`PATHEXT`). 실측한 대상 환경은 Claude Code 네이티브 설치 스크립트가 `%USERPROFILE%\.local\bin\claude.exe`에 깔아 두었고, PATH에도 그 디렉토리가 있다. 그런데 `join(dir, 'claude')`가 찾는 것은 확장자 없는 `claude`라서 **PATH에 있어도 못 찾는다.**

한 겹 더 있다. `access(path, X_OK)`는 **Windows에서 실행 권한을 검사하지 않는다** — 파일 시스템에 그 개념이 없어 `F_OK`(존재 여부)처럼 동작한다. npm 전역 설치는 Git Bash용 확장자 없는 sh 스크립트를 함께 깔기 때문에, 그런 환경에서는 **bash 스크립트를 "실행 가능"으로 통과시키고 그 경로를 반환한다.** spawn은 당연히 실패한다.

**따라서 Windows에서는 `PATHEXT`의 확장자를 붙인 후보만 검사하고, 확장자 없는 이름은 후보에서 제외한다.** `where.exe`와 같은 규칙이다.

### 5-2. Windows — `.cmd`는 찾되 거부한다

npm 전역 설치(`npm i -g @anthropic-ai/claude-code`)는 `claude.cmd`를 만든다. Node는 [CVE-2024-27980](https://nodejs.org/en/blog/vulnerability/april-2024-security-releases-2) 대응 이후 **`shell: true` 없이 `.cmd`/`.bat`를 spawn하면 `EINVAL`을 던진다**(18.20.2+ / 20.12.2+, 이 프로젝트는 Node 22).

`shell: true`로 우회하지 않는다. 켜는 순간 두 가지가 따라온다 — 인자가 cmd.exe의 인용 규칙을 타므로 공백이 든 임시 경로(`--mcp-config`)가 깨질 수 있고, `manager.ts:185`의 `terminate`가 죽이는 대상이 cmd.exe 껍데기가 되어 **취소가 자식 프로세스에 닿지 않는다.** 고아 프로세스가 남는다.

**대신 preflight가 명확히 거부한다.** 해석된 실행 파일의 확장자가 `.cmd`나 `.bat`이면 `ok: false`로 돌리고, 네이티브 설치 스크립트를 쓰라고 안내한다. 실측 환경은 `.exe`라 이 경로를 타지 않지만, npm으로 깐 사람이 **암호 같은 `EINVAL` 대신 행동 가능한 메시지**를 받는다.

`.exe`에는 이 문제가 전부 없다. `shell` 없이 spawn되고 취소도 프로세스에 직접 꽂힌다. **그래서 이번 작업에서 `manager.ts`는 건드리지 않는다.**

### 5-3. macOS/Linux — 폴백 디렉토리

Finder/Dock에서 실행한 macOS 앱은 launchd의 최소 환경만 받아 `PATH`에 `/usr/bin:/bin` 정도만 있다. Linux 데스크톱 런처도 같다. **기존 PATH 탐색을 먼저 하고, 실패했을 때만 폴백 디렉토리를 훑는다** — 개발 환경(`pnpm dev`)에서는 첫 탐색이 성공하므로 동작이 달라지지 않는다.

| 경로 | 근거 |
|---|---|
| `~/.local/bin` | Claude Code 네이티브 설치 스크립트의 기본 위치 (Windows도 동일) |
| `~/.claude/local` | 구버전 local 설치 |
| `/opt/homebrew/bin` | Homebrew (Apple Silicon) |
| `/usr/local/bin` | Homebrew (Intel) · 수동 설치 · Linux |

폴백은 세 OS 모두에 적용한다. Windows에서도 PATH가 어떤 이유로 비면 `~/.local/bin\claude.exe`를 찾아준다 — 확장자 규칙은 5-1이 그대로 적용된다.

**nvm/fnm/volta 아래의 npm 전역 설치는 덮지 않는다.** 경로에 Node 버전이 들어가 예측할 수 없다. 그 경우는 workspace 설정의 절대 경로가 탈출구이므로, **실패 메시지가 그 설정 위치를 가리켜야 한다.**

### 5-4. 검증

`findExecutable`은 `process.env`만 읽으므로 주입 이음매를 새로 만들 필요가 없다. `PATH`를 임시 디렉토리로, `HOME`(Windows는 `USERPROFILE`)을 임시 디렉토리로 가리키고 그 안에 가짜 실행 파일을 심으면 된다.

**Windows 동작은 macOS에서도 테스트해야 한다.** 개발 장비가 macOS이므로, 플랫폼 분기를 `process.platform`으로 직접 읽으면 Windows 경로가 CI의 windows 러너에서만 돌게 되어 사실상 검증되지 않는다. **플랫폼을 인자로 받게 만든다** — 기본값은 `process.platform`이고, 테스트는 `'win32'`를 명시적으로 넘긴다. 이 이음매가 없으면 5-1과 5-2는 테스트할 방법이 없다.

**회귀 방지:** 폴백 목록에서 한 줄을 지우면 대응하는 테스트가 빨개져야 한다. 목록 전체를 한 테스트로 덮으면 한 줄 삭제를 놓친다 — 경로마다 테스트를 하나씩 둔다. 같은 이유로 `.cmd` 거부와 `PATHEXT` 후보 생성도 각각 테스트를 갖는다.

---

## 6. 버전 검증

electron-builder는 산출물 이름과 앱 버전을 **`package.json`의 `version`에서만** 읽는다. 태그는 보지 않는다. `v0.2.0` 태그를 밀었는데 `package.json`이 `0.1.0`이면 `one-desk-0.1.0-arm64.dmg`가 조용히 나온다 — 릴리스 페이지는 `v0.2.0`인데 파일 이름은 `0.1.0`이고, 앱의 "정보"에도 `0.1.0`이 뜬다.

**태그로 실행됐을 때, 빌드를 시작하기 전에 둘을 비교하고 다르면 실패시킨다.** 태그의 `v` 접두사를 뗀 문자열과 `package.json`의 `version`이 정확히 같아야 한다.

`package.json`을 태그에서 자동으로 덮어쓰는 방식은 쓰지 않는다. 커밋되지 않은 버전으로 빌드가 나가 저장소의 이력과 산출물이 어긋난다.

**첫 릴리스는 `v0.1.0`** — `package.json`을 건드리지 않고 태그만 민다.

---

## 7. `electron-builder.yml` 채우기

현재 파일은 두 항목뿐이라 `appId`도 `productName`도 없다.

**데이터 위치를 정하는 것은 `productName`이다 — `appId`가 아니다.** Electron은 `userData`를 `appData` + **앱 이름**으로 만들고(`shell/common/electron_paths.cc`의 `DIR_USER_DATA`), 앱 이름은 `productName`이 있으면 그것을, 없으면 `package.json`의 `name`을 쓴다. 지금은 `productName`이 어디에도 없으므로 앱 이름이 `one-desk`이고 데이터는 `~/Library/Application Support/one-desk`(Windows는 `%APPDATA%\one-desk`)에 있다.

**따라서 `productName`은 `one-desk`로, 지금의 실효값과 정확히 같게 둔다.** `One Desk`처럼 보기 좋게 바꾸면 앱이 새 디렉토리를 보게 되어 기존 데이터가 사용자 눈에서 사라진다. 대문자화는 첫 릴리스 이후에는 **마이그레이션 없이 불가능한 변경**이다.

`appId`는 데이터 위치와 무관하다 — macOS 번들 식별자와 Windows AppUserModelId로 쓰인다. 기본값 `com.electron.one-desk`는 이 앱의 것이 아니므로 바로잡되, 이것 역시 서명·알림 식별에 쓰이므로 첫 릴리스 전에 확정한다.

```yaml
appId: com.rikeey98.one-desk
productName: one-desk

extraResources:
  - from: drizzle
    to: drizzle
asarUnpack:
  - '**/node_modules/better-sqlite3/**'

mac:
  target: dmg
  # 유료 인증서 없이 arm64에서 실행되려면 ad-hoc 서명이 필요하다 (§4).
  identity: '-'
  artifactName: ${name}-${version}-${arch}.${ext}

win:
  target: portable
  artifactName: ${name}-${version}-${arch}.${ext}

linux:
  target: AppImage
  category: Development
  artifactName: ${name}-${version}-${arch}.${ext}
```

`extraResources`와 `asarUnpack` 두 줄은 그대로 둔다. 전자는 `electron/main.ts:10`이 `process.resourcesPath`에서 마이그레이션을 찾기 때문이고, 후자는 네이티브 `.node` 파일이 asar 안에 있으면 로드되지 않기 때문이다. **둘 다 지금 산출물이 동작하는 이유이므로 건드리지 않는다.**

`build/icon.icns` · `icon.ico` · `icon.png`가 이미 있어 아이콘은 자동으로 잡힌다.

---

## 8. 검증

### 자동 — 단위 테스트

| 항목 | 방법 |
|---|---|
| Windows `PATHEXT` 후보 생성 | `platform='win32'`을 넘기고 `claude.exe`만 찾아지는지 |
| Windows 확장자 없는 파일 무시 | 확장자 없는 `claude`를 심어두고 **찾지 않는 것**을 확인 |
| `.cmd` 거부 메시지 | `claude.cmd`만 있는 상태에서 preflight가 `ok: false`인지 |
| 폴백 경로 탐색 | `PATH=''` + 임시 `HOME`/`USERPROFILE`, **경로마다 하나씩** |

### 수동 — 산출물을 실행해야만 드러나는 것

| 항목 | 방법 |
|---|---|
| 세 산출물이 나온다 | `workflow_dispatch`로 수동 실행 |
| 버전 불일치 검증이 실제로 막는다 | 어긋난 버전으로 한 번 돌려 실패를 본다 |
| **Windows에서 run이 끝까지 돈다** | **exe를 대상 환경에서 실행 → workspace 만들고 agent 한 번 돌린다** |
| DMG가 실제로 열린다 | CI 산출물을 내려받아 macOS에서 연다 (§4) |
| AppImage 실행 | 해당 환경이 있으면 확인. 없으면 미검증임을 릴리스 노트에 적는다 |

**세 번째 줄이 이 작업의 진짜 완료 조건이다.** 나머지 자동 테스트는 전부 "가짜 실행 파일을 올바르게 골랐는가"를 볼 뿐이고, 실제 `claude.exe`가 뜨는지 · Bedrock 환경변수가 전달되는지 · 네이티브 모듈이 그 플랫폼에서 로드되는지는 대상 환경에서 한 번 돌려야만 드러난다.

**첫 실행 점검 목록** — 실패했을 때 어디를 볼지 미리 정해 둔다.

1. 앱이 뜨고 workspace가 만들어진다 → `better-sqlite3`가 Windows에서 로드됐다
2. run이 프리플라이트를 통과한다 → §5가 `claude.exe`를 찾았다
3. agent가 응답한다 → Bedrock 환경변수가 전달됐다
4. agent가 만든 이슈/메모가 남는다 → MCP 서버(`127.0.0.1`)에 도달했다

**4번이 조용히 실패할 수 있는 자리 — 확인 결과 해당 없음.** 대상 환경에는 TLS를 가로채는 사내 프록시가 있어, `NO_PROXY`에 루프백이 빠져 있으면 MCP 호출이 프록시로 나가 실패한다. CLAUDE.md가 적어둔 대로 **MCP 도구 실패는 조용해서** agent가 이슈·메모를 못 고치는데 뚜렷한 오류가 안 남는다.

**실측 결과 `NO_PROXY`에 `127.0.0.1`과 `localhost`가 모두 들어 있어 이 위험은 없다.** 다만 1~3이 통과했는데 4만 안 되는 증상이 나오면 여기를 가장 먼저 본다 — 프록시 정책은 사내에서 바뀔 수 있고, 바뀌어도 앱은 조용하다.

---

## 9. 이 설계가 남기는 한계

**Linux 산출물은 아무도 실행해보지 않는다.** 빌드 성공과 실행 성공은 다르다. 특히 `better-sqlite3`가 그 플랫폼의 Electron ABI에 맞게 리빌드됐는지는 앱을 띄워 DB를 열어봐야 안다. **릴리스 노트에 미검증임을 밝히고**, 실패 시 로그를 받을 창구(GitHub Issues)를 안내한다. Windows는 §8의 수동 검증이 덮고, macOS는 개발 장비가 있다.

**`.cmd` 설치 환경은 지원하지 않는다.** npm 전역 설치로 `claude.cmd`를 쓰는 사람은 preflight에서 거부당하고 네이티브 설치 스크립트로 안내받는다. `shell: true`를 켜면 인용과 취소가 함께 깨지므로(§5-2), 지원하려면 `manager.ts`의 종료 처리까지 Windows용으로 다시 설계해야 한다 — 별도 작업이다.

**macOS의 환경변수 문제는 그대로 남는다.** Windows는 GUI 앱이 사용자 환경변수를 물려받아 해결됐지만(§1), macOS의 launchd는 그렇지 않다. macOS에서 Bedrock을 쓰려는 사람이 나오면 그때 `Workspace.env`나 로그인 셸 환경 가져오기를 다시 검토한다. §5의 폴백은 실행 파일을 찾아줄 뿐 환경변수는 건드리지 않는다.
