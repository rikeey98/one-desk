# 릴리스 파이프라인 설계 — GitHub Actions로 3개 플랫폼 빌드

**날짜:** 2026-08-14
**상태:** 승인됨
**근거:** electron-builder 26.15.3 문서(targets · mac · hooks), 기존 `electron-builder.yml`, `core/runner/adapters/claudeCode.ts`

---

## 1. 범위

`v*` 태그를 밀면 GitHub Actions가 macOS·Windows·Linux 산출물을 만들어 GitHub Release에 올린다. 지금은 `pnpm run pack`으로 로컬 macOS `.app`만 나오고, 그것을 남에게 건넬 방법이 없다.

**배포 대상은 소수의 동료·테스터다.** 이 전제가 서명 결정(유료 인증서 없음)과 릴리스 노트의 설치 안내를 결정한다.

### 들어가는 것

- `.github/workflows/release.yml` — 3개 러너 매트릭스, 태그 트리거 + 수동 실행
- `electron-builder.yml` 채우기 — `appId`, `productName`, 플랫폼별 타겟, ad-hoc 서명
- `findExecutable`의 흔한 설치 경로 폴백 (§5)
- 태그와 `package.json` 버전 불일치 검증 (§6)
- 릴리스 노트의 고정 설치 안내 섹션 (§4)

### 빠지는 것

**자동 업데이트.** `electron-updater`는 서명된 앱을 전제로 하고, 서명하지 않기로 한 이상 macOS에서는 동작하지 않는다. 테스터 몇 명에게는 새 링크를 주는 편이 싸다.

**Intel Mac (x64).** 러너를 하나 더 쓰고 산출물이 하나 더 늘어난다. 테스터 중 Intel Mac이 나오면 그때 매트릭스에 한 줄 더한다 — 구조상 한 줄이다.

**Linux `.deb`, Windows NSIS 설치본.** "한 파일로 실행"이 요구사항이므로 AppImage와 portable exe만 만든다.

**유료 코드 서명·공증.** Apple Developer ID는 연 $99이고 Windows OV 인증서는 그보다 비싸다. 불특정 다수에게 배포할 때 다시 판단한다.

**CI에서의 e2e.** 지금까지 macOS에서만 돌던 Playwright+Electron e2e를 세 OS에 올리는 것은 별개의 작업이다. Linux에서는 xvfb가 필요하고, 새로 드러날 실패를 모두 잡아야 한다. 릴리스를 그것에 묶지 않는다.

**`Workspace.env` (Bedrock 환경변수).** CLAUDE.md의 "5단계 착수 전에 정할 것"에 그대로 남는다. §5의 폴백은 실행 파일 탐색만 고치고 환경변수는 건드리지 않는다.

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
"claude 경로"에 `which claude` 결과를 붙여넣으세요.
```

**설정만으로는 검증되지 않는다.** `identity: "-"`를 넣었다고 실행되는지는 알 수 없다. **CI가 만든 DMG를 실제로 내려받아 여는 것까지가 이 항목의 완료 조건이다.** 구현 계획에 별도 단계로 넣는다.

---

## 5. `findExecutable` 폴백

Finder/Dock에서 실행한 macOS 앱은 launchd의 최소 환경만 받는다. `.zshrc`가 export한 것은 하나도 들어오지 않고, `PATH`에는 `/usr/bin:/bin` 정도만 있다. 현재 `findExecutable`은 `process.env.PATH`만 보므로 `claude`를 찾지 못하고 **모든 run이 프리플라이트에서 실패한다.** Linux 데스크톱 런처도 같은 문제를 겪는다. Windows GUI 앱은 시스템·사용자 환경변수를 정상적으로 물려받으므로 해당 없다.

**기존 PATH 탐색을 먼저 하고, 실패했을 때만 폴백 디렉토리를 훑는다.** 개발 환경(`pnpm dev`)에서는 첫 탐색이 성공하므로 동작이 달라지지 않는다.

폴백 목록 — 순서대로:

| 경로 | 근거 |
|---|---|
| `~/.local/bin` | Claude Code 공식 설치 스크립트의 기본 위치 |
| `~/.claude/local` | 구버전 local 설치 |
| `/opt/homebrew/bin` | Homebrew (Apple Silicon) |
| `/usr/local/bin` | Homebrew (Intel) · 수동 설치 · Linux |

**nvm/fnm/volta 아래의 npm 전역 설치는 덮지 않는다.** 경로에 Node 버전이 들어가 예측할 수 없다. 그 경우는 workspace 설정의 절대 경로가 탈출구다 — 그래서 실패 메시지가 설정 위치를 가리켜야 한다.

**테스트 가능하다.** `findExecutable`은 `process.env.PATH`와 `HOME`만 읽으므로, `PATH=''`로 두고 `HOME`을 임시 디렉토리로 가리킨 뒤 그 안에 `.local/bin/claude`를 심으면 폴백 경로가 검증된다. 주입 이음매를 새로 만들 필요가 없다.

**회귀 방지:** 폴백 목록에서 한 줄을 지우면 대응하는 테스트가 빨개져야 한다. 목록 전체를 한 테스트로 덮으면 한 줄 삭제를 놓친다 — 경로마다 테스트를 하나씩 둔다.

---

## 6. 버전 검증

electron-builder는 산출물 이름과 앱 버전을 **`package.json`의 `version`에서만** 읽는다. 태그는 보지 않는다. `v0.2.0` 태그를 밀었는데 `package.json`이 `0.1.0`이면 `one-desk-0.1.0-arm64.dmg`가 조용히 나온다 — 릴리스 페이지는 `v0.2.0`인데 파일 이름은 `0.1.0`이고, 앱의 "정보"에도 `0.1.0`이 뜬다.

**태그로 실행됐을 때, 빌드를 시작하기 전에 둘을 비교하고 다르면 실패시킨다.** 태그의 `v` 접두사를 뗀 문자열과 `package.json`의 `version`이 정확히 같아야 한다.

`package.json`을 태그에서 자동으로 덮어쓰는 방식은 쓰지 않는다. 커밋되지 않은 버전으로 빌드가 나가 저장소의 이력과 산출물이 어긋난다.

**첫 릴리스는 `v0.1.0`** — `package.json`을 건드리지 않고 태그만 민다.

---

## 7. `electron-builder.yml` 채우기

현재 파일은 두 항목뿐이라 `appId`도 `productName`도 없다. 기본값은 `com.electron.one-desk`가 되는데, **`appId`는 macOS에서 `app.getPath('userData')` 경로를 결정한다.** 나중에 바꾸면 기존 사용자의 DB가 있는 디렉토리를 앱이 더 이상 보지 않는다 — 사용자 눈에는 데이터가 사라진 것이다. 첫 릴리스 전에 확정한다.

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

| 항목 | 방법 |
|---|---|
| 폴백 경로 탐색 | 단위 테스트 — `PATH=''` + 임시 `HOME`, 경로마다 하나씩 |
| 버전 불일치 검증 | 워크플로를 어긋난 버전으로 한 번 돌려 실패하는 것을 본다 |
| 세 산출물이 나온다 | `workflow_dispatch`로 수동 실행 |
| **DMG가 실제로 열린다** | **CI 산출물을 내려받아 macOS에서 연다** (§4) |
| exe / AppImage 실행 | 해당 OS가 있으면 확인. 없으면 릴리스 노트에 미검증임을 적는다 |

**마지막 두 줄이 이 작업에서 가장 중요하다.** 나머지는 전부 "설정이 문법에 맞는가"를 볼 뿐이고, 서명·격리·네이티브 모듈 로드는 산출물을 실행해야만 드러난다.

---

## 9. 이 설계가 남기는 한계

**Windows와 Linux 산출물은 저자가 실행해볼 수 없다.** 빌드가 성공했다는 것과 실행된다는 것은 다르다. 특히 `better-sqlite3`가 그 플랫폼의 Electron ABI에 맞게 리빌드됐는지는 앱을 띄워 DB를 열어봐야 안다. **테스터의 첫 실행이 사실상 첫 검증이 된다** — 릴리스 노트에 이를 밝히고, 실패 시 로그를 받을 창구(GitHub Issues)를 안내한다.

**환경변수는 여전히 못 넘긴다.** §5는 실행 파일을 찾아줄 뿐이다. Bedrock으로 도는 환경(`CLAUDE_CODE_USE_BEDROCK`, `AWS_REGION`, `AWS_PROFILE`)은 패키징된 앱에서 여전히 전달할 방법이 없다. CLAUDE.md의 5단계 선결 과제 그대로다.
