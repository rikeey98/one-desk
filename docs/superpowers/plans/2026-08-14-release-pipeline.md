# 릴리스 파이프라인 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `v*` 태그를 밀면 macOS·Windows·Linux 산출물이 GitHub Release에 올라가고, Windows에서 agent 실행이 실제로 돈다.

**Architecture:** 실행 파일 탐색을 `claudeCode.ts`에서 떼어내 플랫폼을 인자로 받는 순수 모듈(`core/runner/executable.ts`)로 만든다. Windows 분기 전체가 순수 함수 안에 들어가므로 macOS 개발 장비에서 `'win32'`를 넘겨 검증할 수 있다. 그 위에 `electron-builder.yml`을 채우고 3러너 매트릭스 워크플로를 얹는다.

**Tech Stack:** Node 22 · pnpm 10.18.1 · electron-builder 26.15.3 · GitHub Actions · Vitest

**근거 문서:** `docs/superpowers/specs/2026-08-14-release-pipeline-design.md`

## Global Constraints

- **`core/`는 `electron`을 import하지 않는다.** 경로가 필요하면 인자로 받는다.
- **주석과 오류 메시지는 한국어.** 커밋 메시지는 영어 명령형.
- **들여쓰기 2칸**, 함수명 camelCase, 상수 UPPER_SNAKE_CASE.
- **`verbatimModuleSyntax: true`** — 타입 전용 import는 반드시 `import type`.
- **`appId: com.rikeey98.one-desk`** — 값 그대로.
- **`productName: one-desk`** — 지금의 실효값과 정확히 같아야 한다. 바꾸면 사용자 데이터 디렉토리가 이동한다.
- **`packageManager: "pnpm@10.18.1"`**, Node는 `22`.
- **첫 릴리스는 `v0.1.0`** — `package.json`의 `version`은 `0.1.0` 그대로 둔다.
- **저장소는 public이다.** 사내 게이트웨이 주소·CA 번들 경로·계정명을 어떤 파일에도 적지 않는다.
- **`shell: true`를 쓰지 않는다.** `manager.ts`는 이 계획에서 건드리지 않는다.
- 테스트는 TDD로 — 실패를 먼저 확인하고 구현한다.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `core/runner/executable.ts` (신규) | 실행 파일 후보 생성(순수) · 파일시스템 탐색 · 배치 shim 판별 |
| `core/runner/executable.test.ts` (신규) | 위 셋의 단위 테스트. Windows 분기는 `platform: 'win32'`로 |
| `core/runner/adapters/claudeCode.ts` (수정) | private `findExecutable` 제거, 새 모듈 사용, `.cmd` 거부 |
| `core/runner/adapters/claudeCode.preflight.test.ts` (신규) | preflight 동작 |
| `electron-builder.yml` (수정) | appId · productName · 플랫폼별 타겟 |
| `package.json` (수정) | `packageManager` 필드 |
| `.github/workflows/release.yml` (신규) | 3러너 매트릭스 · 버전 검증 · draft 릴리스 |

**왜 별도 모듈인가.** Windows 경로 규칙(`PATHEXT`, 구분자 `;`, 백슬래시)을 macOS에서 검증하려면 `node:path`의 `win32`/`posix` 변형을 명시적으로 골라야 한다. 이 로직이 어댑터 안에 private으로 남아 있으면 테스트가 닿지 않는다. 5단계의 OpenCode 어댑터도 같은 탐색이 필요하다.

---

## Task 1: 실행 파일 탐색 모듈

**Files:**
- Create: `core/runner/executable.ts`
- Test: `core/runner/executable.test.ts`

**Interfaces:**
- Consumes: 없음 (Node 표준 모듈만)
- Produces:
  - `executableCandidates(name: string, opts?: LookupOptions): string[]`
  - `findExecutable(name: string, opts?: LookupOptions): Promise<string | null>`
  - `isBatchShim(file: string): boolean`
  - `interface LookupOptions { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv }`

### 이 태스크가 잡아야 하는 결함

읽기 전에 무엇이 왜 깨지는지 알아야 한다.

1. **Windows에서 확장자를 안 붙이면 못 찾는다.** 대상 환경의 실행 파일은 `%USERPROFILE%\.local\bin\claude.exe`이고 그 디렉토리는 PATH에 있다. `join(dir, 'claude')`는 그 파일을 가리키지 않는다.
2. **`access(X_OK)`는 Windows에서 실행 권한을 보지 않는다.** 파일시스템에 그 개념이 없어 존재 여부(`F_OK`)처럼 동작한다. npm 전역 설치가 함께 까는 확장자 없는 sh 스크립트를 "실행 가능"으로 통과시킨다. **그래서 Windows에서는 확장자 없는 후보를 아예 만들지 않는다.**
3. **`node:path`의 기본 `join`은 실행 중인 OS를 따른다.** macOS에서 `join('C:\\bin', 'claude.exe')`는 `C:\bin/claude.exe`가 되어 Windows 동작을 검증할 수 없다. **`win32.join`/`posix.join`을 platform 인자로 골라야 한다.** `delimiter`도 마찬가지다(`;` vs `:`).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`core/runner/executable.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { executableCandidates, isBatchShim } from './executable'

const WIN = { platform: 'win32' as const }
const POSIX = { platform: 'linux' as const }

describe('executableCandidates — Windows', () => {
  it('PATHEXT의 확장자를 붙인 후보를 만든다', () => {
    const out = executableCandidates('claude', {
      ...WIN,
      env: { PATH: 'C:\\bin', PATHEXT: '.EXE;.CMD' }
    })
    expect(out).toContain('C:\\bin\\claude.EXE')
    expect(out).toContain('C:\\bin\\claude.CMD')
  })

  it('확장자 없는 후보는 만들지 않는다 — access(X_OK)가 Windows에서 존재 여부만 보기 때문', () => {
    const out = executableCandidates('claude', {
      ...WIN,
      env: { PATH: 'C:\\bin', PATHEXT: '.EXE' }
    })
    expect(out).not.toContain('C:\\bin\\claude')
  })

  it('PATHEXT가 없으면 기본값을 쓴다', () => {
    const out = executableCandidates('claude', { ...WIN, env: { PATH: 'C:\\bin' } })
    expect(out).toContain('C:\\bin\\claude.EXE')
  })

  it('PATH를 세미콜론으로 쪼갠다', () => {
    const out = executableCandidates('claude', {
      ...WIN,
      env: { PATH: 'C:\\a;C:\\b', PATHEXT: '.EXE' }
    })
    expect(out).toContain('C:\\a\\claude.EXE')
    expect(out).toContain('C:\\b\\claude.EXE')
  })

  it('USERPROFILE 아래 .local\\bin을 폴백으로 둔다', () => {
    const out = executableCandidates('claude', {
      ...WIN,
      env: { PATH: '', PATHEXT: '.EXE', USERPROFILE: 'C:\\Users\\me' }
    })
    expect(out).toContain('C:\\Users\\me\\.local\\bin\\claude.EXE')
  })

  it('USERPROFILE 아래 .claude\\local을 폴백으로 둔다', () => {
    const out = executableCandidates('claude', {
      ...WIN,
      env: { PATH: '', PATHEXT: '.EXE', USERPROFILE: 'C:\\Users\\me' }
    })
    expect(out).toContain('C:\\Users\\me\\.claude\\local\\claude.EXE')
  })
})

describe('executableCandidates — POSIX', () => {
  it('확장자를 붙이지 않는다', () => {
    const out = executableCandidates('claude', { ...POSIX, env: { PATH: '/usr/bin' } })
    expect(out).toContain('/usr/bin/claude')
  })

  it('PATH를 콜론으로 쪼갠다', () => {
    const out = executableCandidates('claude', { ...POSIX, env: { PATH: '/a:/b' } })
    expect(out).toContain('/a/claude')
    expect(out).toContain('/b/claude')
  })

  it('HOME 아래 .local/bin을 폴백으로 둔다', () => {
    const out = executableCandidates('claude', { ...POSIX, env: { PATH: '', HOME: '/home/me' } })
    expect(out).toContain('/home/me/.local/bin/claude')
  })

  it('HOME 아래 .claude/local을 폴백으로 둔다', () => {
    const out = executableCandidates('claude', { ...POSIX, env: { PATH: '', HOME: '/home/me' } })
    expect(out).toContain('/home/me/.claude/local/claude')
  })

  it('/opt/homebrew/bin을 폴백으로 둔다', () => {
    const out = executableCandidates('claude', { ...POSIX, env: { PATH: '' } })
    expect(out).toContain('/opt/homebrew/bin/claude')
  })

  it('/usr/local/bin을 폴백으로 둔다', () => {
    const out = executableCandidates('claude', { ...POSIX, env: { PATH: '' } })
    expect(out).toContain('/usr/local/bin/claude')
  })

  it('PATH 후보가 폴백보다 앞선다', () => {
    const out = executableCandidates('claude', {
      ...POSIX,
      env: { PATH: '/usr/bin', HOME: '/home/me' }
    })
    expect(out.indexOf('/usr/bin/claude')).toBeLessThan(out.indexOf('/home/me/.local/bin/claude'))
  })

  it('HOME이 없으면 홈 기반 폴백을 만들지 않는다', () => {
    const out = executableCandidates('claude', { ...POSIX, env: { PATH: '' } })
    expect(out.some((p) => p.includes('.local/bin'))).toBe(false)
  })
})

describe('isBatchShim', () => {
  it('.cmd를 배치 shim으로 본다', () => {
    expect(isBatchShim('C:\\bin\\claude.cmd')).toBe(true)
  })

  it('.bat를 배치 shim으로 본다', () => {
    expect(isBatchShim('C:\\bin\\claude.bat')).toBe(true)
  })

  it('대문자 확장자도 잡는다', () => {
    expect(isBatchShim('C:\\bin\\claude.CMD')).toBe(true)
  })

  it('.exe는 아니다', () => {
    expect(isBatchShim('C:\\bin\\claude.exe')).toBe(false)
  })

  it('확장자 없는 POSIX 경로는 아니다', () => {
    expect(isBatchShim('/usr/local/bin/claude')).toBe(false)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test executable`
Expected: FAIL — `Failed to resolve import "./executable"`

- [ ] **Step 3: 구현한다**

`core/runner/executable.ts`:

```ts
import { access, constants } from 'node:fs/promises'
import { posix, win32 } from 'node:path'

/**
 * PATHEXT가 비어 있을 때 쓸 기본값.
 * 실제 cmd.exe의 기본값은 더 길지만(.VBS, .JS 등) 우리가 spawn할 만한 것만 남긴다.
 * .JS를 넣으면 같은 디렉토리의 claude.js를 실행 파일로 오인할 수 있다.
 */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD'

export interface LookupOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
}

/**
 * PATH가 비어 있는 GUI 실행 환경을 위한 폴백 디렉토리.
 *
 * Finder/Dock에서 연 macOS 앱은 launchd의 최소 환경만 받아 PATH에
 * /usr/bin:/bin 정도만 있다. Linux 데스크톱 런처도 같다.
 * nvm/fnm/volta 아래의 npm 전역 설치는 경로에 Node 버전이 들어가
 * 예측할 수 없으므로 덮지 않는다 — 그 경우는 workspace 설정이 탈출구다.
 */
function fallbackDirs(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const p = platform === 'win32' ? win32 : posix
  const home = (platform === 'win32' ? env['USERPROFILE'] : env['HOME']) ?? ''
  const dirs: string[] = []
  if (home) {
    dirs.push(p.join(home, '.local', 'bin'))
    dirs.push(p.join(home, '.claude', 'local'))
  }
  if (platform !== 'win32') {
    dirs.push('/opt/homebrew/bin')
    dirs.push('/usr/local/bin')
  }
  return dirs
}

/**
 * 탐색할 절대 경로 후보를 순서대로 만든다. 파일시스템을 건드리지 않는다.
 *
 * platform을 인자로 받는 이유: node:path의 기본 join은 실행 중인 OS를 따르므로
 * macOS에서 join('C:\\bin', 'claude.exe')가 'C:\bin/claude.exe'가 된다.
 * 그러면 Windows 동작을 개발 장비에서 검증할 방법이 없다.
 */
export function executableCandidates(name: string, opts: LookupOptions = {}): string[] {
  const platform = opts.platform ?? process.platform
  const env = opts.env ?? process.env
  const p = platform === 'win32' ? win32 : posix

  const pathDirs = (env['PATH'] ?? '').split(p.delimiter).filter(Boolean)
  const dirs = [...pathDirs, ...fallbackDirs(platform, env)]

  // Windows는 확장자로 실행 가능 여부를 정한다. 확장자 없는 후보는 만들지 않는다 —
  // access(X_OK)가 Windows에서 실행 권한을 보지 않고 존재 여부처럼 동작해서,
  // npm이 Git Bash용으로 함께 까는 확장자 없는 sh 스크립트를 통과시킨다.
  const suffixes =
    platform === 'win32'
      ? (env['PATHEXT'] ?? DEFAULT_PATHEXT).split(';').filter(Boolean)
      : ['']

  return dirs.flatMap((dir) => suffixes.map((suffix) => p.join(dir, name + suffix)))
}

/** 후보를 순서대로 훑어 첫 번째로 접근 가능한 것을 돌려준다. */
export async function findExecutable(
  name: string,
  opts: LookupOptions = {}
): Promise<string | null> {
  for (const candidate of executableCandidates(name, opts)) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // 다음 후보
    }
  }
  return null
}

/**
 * shell 없이 spawn할 수 없는 배치 shim인가.
 *
 * Node는 CVE-2024-27980 대응 이후 .cmd/.bat를 shell:true 없이 spawn하면
 * EINVAL을 던진다(18.20.2+ / 20.12.2+). shell을 켜면 인자가 cmd.exe의 인용
 * 규칙을 타서 공백이 든 경로가 깨지고, terminate가 죽이는 대상이 cmd.exe
 * 껍데기가 되어 취소가 자식에 닿지 않는다. 그래서 켜지 않고 거부한다.
 */
export function isBatchShim(file: string): boolean {
  const lower = file.toLowerCase()
  return lower.endsWith('.cmd') || lower.endsWith('.bat')
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm test executable`
Expected: PASS (22개)

- [ ] **Step 5: 변이로 테스트가 진짜 도는지 확인한다**

세 곳을 하나씩 망가뜨리고 **이름이 지정된 테스트가 빨개지는지** 본다. 확인 후 되돌린다.

1. `suffixes`의 win32 분기를 `['']`로 바꾼다 → "PATHEXT의 확장자를 붙인 후보를 만든다"가 실패해야 한다
2. `suffixes`에 `''`를 추가한다(`[...exts, '']`) → "확장자 없는 후보는 만들지 않는다"가 실패해야 한다
3. `fallbackDirs`에서 `.local/bin` 줄을 지운다 → 해당 폴백 테스트 둘(win/posix)이 실패해야 한다
4. `p`를 항상 `posix`로 고정한다 → Windows 구분자 테스트가 실패해야 한다

- [ ] **Step 6: 커밋**

```bash
git add core/runner/executable.ts core/runner/executable.test.ts
git commit -m "feat: resolve executables per platform with PATHEXT and fallbacks"
```

---

## Task 2: 어댑터 배선과 `.cmd` 거부

**Files:**
- Modify: `core/runner/adapters/claudeCode.ts` — 1-2행(import), 54-66행(private `findExecutable` 삭제), 71-88행(`preflight`)
- Test: `core/runner/adapters/claudeCode.preflight.test.ts` (신규)

**Interfaces:**
- Consumes: Task 1의 `findExecutable`, `isBatchShim`, `LookupOptions`
- Produces: `claudeCodeAdapter.preflight(explicitPath: string | null, opts?: LookupOptions)` — 인터페이스 `AgentAdapter.preflight(explicitPath: string | null)`을 그대로 만족한다(선택 인자를 더하는 것은 할당 가능성을 깨지 않는다). 호출자 `core/index.ts:89`는 바꾸지 않는다.

**두 번째 인자를 더하는 이유:** 테스트가 platform과 env를 넣을 수 있어야 한다. 인터페이스를 바꾸면 `core/index.ts`와 나중의 OpenCode 어댑터까지 번진다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`core/runner/adapters/claudeCode.preflight.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeCodeAdapter } from './claudeCode'

let dir: string

/** 실행 비트가 선 파일을 만든다. POSIX 탐색이 X_OK를 보기 때문에 0o755여야 한다. */
async function makeExecutable(path: string): Promise<string> {
  await writeFile(path, '#!/bin/sh\n', { mode: 0o755 })
  return path
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'one-desk-preflight-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('preflight — 명시 경로', () => {
  it('실행 가능한 명시 경로를 그대로 쓴다', async () => {
    const exe = await makeExecutable(join(dir, 'claude'))
    const out = await claudeCodeAdapter.preflight(exe)
    expect(out).toEqual({ ok: true, executable: exe })
  })

  it('없는 명시 경로는 사유와 함께 거부한다', async () => {
    const out = await claudeCodeAdapter.preflight(join(dir, 'nope'))
    expect(out.ok).toBe(false)
    expect(out.reason).toContain('설정된 경로')
  })

  it('명시 경로가 .cmd면 거부한다 — shell 없이 spawn하면 EINVAL이다', async () => {
    const exe = await makeExecutable(join(dir, 'claude.cmd'))
    const out = await claudeCodeAdapter.preflight(exe)
    expect(out.ok).toBe(false)
    expect(out.executable).toBeUndefined()
    expect(out.reason).toContain('claude.exe')
  })
})

describe('preflight — PATH 탐색', () => {
  it('PATH에서 찾은 실행 파일을 쓴다', async () => {
    const exe = await makeExecutable(join(dir, 'claude'))
    const out = await claudeCodeAdapter.preflight(null, {
      platform: 'linux',
      env: { PATH: dir }
    })
    expect(out).toEqual({ ok: true, executable: exe })
  })

  it('PATH가 비어도 홈 폴백에서 찾는다', async () => {
    const bin = join(dir, '.local', 'bin')
    await mkdir(bin, { recursive: true })
    const exe = await makeExecutable(join(bin, 'claude'))
    const out = await claudeCodeAdapter.preflight(null, {
      platform: 'linux',
      env: { PATH: '', HOME: dir }
    })
    expect(out).toEqual({ ok: true, executable: exe })
  })

  it('못 찾으면 workspace 설정을 가리키는 사유를 준다', async () => {
    const out = await claudeCodeAdapter.preflight(null, {
      platform: 'linux',
      env: { PATH: dir, HOME: dir }
    })
    expect(out.ok).toBe(false)
    expect(out.reason).toContain('workspace 설정')
  })

  it('PATH에서 찾은 것이 .cmd면 거부한다', async () => {
    const exe = await makeExecutable(join(dir, 'claude.cmd'))
    // platform은 linux로 두되 이름이 .cmd인 파일을 찾게 한다.
    // win32로 두면 win32.join이 macOS에서 해석되지 않는 경로를 만든다.
    const out = await claudeCodeAdapter.preflight(exe)
    expect(out.ok).toBe(false)
    expect(exe).toContain('.cmd')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test claudeCode.preflight`
Expected: FAIL — `.cmd` 거부 테스트 둘이 `ok: true`를 받는다. PATH 탐색 테스트는 두 번째 인자가 무시돼 실제 `process.env`를 보므로 실패한다.

- [ ] **Step 3: 구현한다**

`core/runner/adapters/claudeCode.ts` 상단 import를 바꾼다:

```ts
import { access, constants } from 'node:fs/promises'
import type { AgentAdapter, PreflightResult, ResolvedRunSpec, SpawnSpec } from '../types'
import { claudeCodePermissionArgs } from '../permission'
import { findExecutable, isBatchShim, type LookupOptions } from '../executable'
import type { RunEventInit, ToolEffect } from '@shared/events'
```

`node:path`의 `delimiter`·`join`은 더 이상 쓰지 않으므로 그 import를 지운다.

54-66행의 private `findExecutable` 전체를 지우고, 그 자리에 사유 상수를 둔다:

```ts
/**
 * .cmd/.bat는 shell 없이 spawn할 수 없고(EINVAL), shell을 켜면 인용과 취소가
 * 함께 깨진다. 암호 같은 EINVAL 대신 행동 가능한 안내를 준다.
 */
const BATCH_SHIM_REASON =
  'claude.cmd는 직접 실행할 수 없습니다. 네이티브 설치 스크립트로 claude.exe를 설치하거나, workspace 설정에 claude.exe의 절대 경로를 지정하세요.'
```

`preflight`를 바꾼다:

```ts
  async preflight(explicitPath: string | null, opts: LookupOptions = {}): Promise<PreflightResult> {
    if (explicitPath) {
      try {
        await access(explicitPath, constants.X_OK)
      } catch {
        return { ok: false, reason: `설정된 경로에서 실행할 수 없습니다: ${explicitPath}` }
      }
      if (isBatchShim(explicitPath)) return { ok: false, reason: BATCH_SHIM_REASON }
      return { ok: true, executable: explicitPath }
    }
    const found = await findExecutable('claude', opts)
    if (!found) {
      return {
        ok: false,
        reason: 'PATH에서 claude 실행 파일을 찾을 수 없습니다. workspace 설정에서 경로를 지정하세요.'
      }
    }
    if (isBatchShim(found)) return { ok: false, reason: BATCH_SHIM_REASON }
    return { ok: true, executable: found }
  },
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm test claudeCode.preflight`
Expected: PASS (8개)

- [ ] **Step 5: 전체 스위트가 초록인지 확인한다**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: 기존 370개 + 신규 30개 통과, 타입·린트 깨끗

- [ ] **Step 6: 변이 확인**

1. `preflight`의 `isBatchShim(explicitPath)` 줄을 지운다 → "명시 경로가 .cmd면 거부한다"가 실패해야 한다
2. `findExecutable('claude', opts)`를 `findExecutable('claude')`로 바꾼다 → PATH 탐색 테스트들이 실패해야 한다

- [ ] **Step 7: 커밋**

```bash
git add core/runner/executable.ts core/runner/adapters/claudeCode.ts core/runner/adapters/claudeCode.preflight.test.ts
git commit -m "fix: find the Claude executable on Windows and reject batch shims"
```

---

## Task 3: 패키징 설정

**Files:**
- Modify: `electron-builder.yml` (전체)
- Modify: `package.json` — `"private": true` 다음 줄에 `packageManager` 추가

**Interfaces:**
- Consumes: 없음
- Produces: `pnpm exec electron-builder --mac|--win|--linux`가 각각 dmg·portable exe·AppImage를 `dist/`에 만든다. Task 4가 이 파일 이름 규칙(`one-desk-<version>-<arch>.<ext>`)에 의존한다.

**주의:** `productName`은 반드시 `one-desk`다. Electron은 `userData`를 `appData` + 앱 이름으로 만들고 앱 이름은 `productName`을 우선하므로, `One Desk`처럼 바꾸면 기존 사용자 데이터가 있는 디렉토리를 앱이 더 이상 보지 않는다.

- [ ] **Step 1: `electron-builder.yml`을 채운다**

```yaml
appId: com.rikeey98.one-desk
# 지금의 실효 앱 이름과 정확히 같아야 한다. Electron은 userData를
# appData + 앱 이름으로 만들고 앱 이름은 productName을 우선하므로,
# 이 값을 바꾸면 기존 사용자 데이터 디렉토리를 더 이상 보지 않는다.
productName: one-desk

# electron/main.ts가 app.isPackaged일 때 process.resourcesPath에서
# 마이그레이션을 찾는다.
extraResources:
  - from: drizzle
    to: drizzle
# 네이티브 .node는 asar 안에서 로드되지 않는다.
asarUnpack:
  - '**/node_modules/better-sqlite3/**'

mac:
  target: dmg
  # 유료 인증서 없이 Apple Silicon에서 실행되려면 ad-hoc 서명이 필요하다.
  # identity를 비우면 electron-builder가 링커의 ad-hoc 서명을 깨뜨린 채로
  # 두어 "앱이 손상되었습니다"가 뜨고, 이것은 xattr로 풀리지 않는다.
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

- [ ] **Step 2: `package.json`에 `packageManager`를 더한다**

`"private": true,` 다음 줄에:

```json
  "packageManager": "pnpm@10.18.1",
```

- [ ] **Step 3: 로컬에서 macOS 산출물이 나오는지 확인한다**

```bash
rm -rf dist
pnpm build && pnpm exec electron-builder --mac --publish never
ls dist/*.dmg
```

Expected: `dist/one-desk-0.1.0-arm64.dmg`가 있다

- [ ] **Step 4: 만들어진 DMG를 실제로 연다**

```bash
open dist/one-desk-0.1.0-arm64.dmg
```

Finder에 마운트되면 앱을 `/Applications`로 끌어다 놓고 **실행해서 창이 뜨는지 본다.** "손상되었습니다"가 뜨면 §4의 ad-hoc 서명이 안 먹은 것이므로 여기서 멈추고 원인을 찾는다. 확인 후 마운트를 해제한다.

이 단계는 자동화할 수 없다. **설정이 문법에 맞는 것과 앱이 열리는 것은 다르다.**

- [ ] **Step 5: 커밋**

```bash
git add electron-builder.yml package.json
git commit -m "build: configure per-platform targets and ad-hoc mac signing"
```

---

## Task 4: 릴리스 워크플로

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: Task 3의 `artifactName` 규칙 — 산출물이 `dist/one-desk-*.{dmg,exe,AppImage}`로 떨어진다
- Produces: 없음 (최종 산출물)

- [ ] **Step 1: 워크플로를 쓴다**

```yaml
name: release

on:
  push:
    tags: ['v*']
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build:
    strategy:
      # 한 플랫폼이 깨져도 나머지 산출물은 보고 싶다.
      fail-fast: false
      matrix:
        include:
          - os: macos-latest
            flag: --mac
          - os: windows-latest
            flag: --win
          - os: ubuntu-latest
            flag: --linux
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      # electron-builder는 산출물 이름과 앱 버전을 package.json에서만 읽는다.
      # 태그와 어긋나면 v0.2.0 릴리스에 0.1.0 파일이 조용히 올라간다.
      - name: Verify tag matches package.json version
        if: startsWith(github.ref, 'refs/tags/v')
        shell: bash
        run: |
          tag="${GITHUB_REF_NAME#v}"
          pkg="$(node -p "require('./package.json').version")"
          if [ "$tag" != "$pkg" ]; then
            echo "태그($tag)와 package.json 버전($pkg)이 다릅니다." >&2
            exit 1
          fi

      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      # postinstall의 electron-rebuild가 better-sqlite3를 이 러너의
      # Electron ABI에 맞춰 컴파일한다. 크로스 컴파일이 불가능한 이유다.
      - run: pnpm install --frozen-lockfile

      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test

      - run: pnpm build
      # --publish never가 없으면 electron-builder가 GH_TOKEN을 발견했을 때
      # 스스로 릴리스에 올려 아래 release job과 이중으로 올린다.
      - run: pnpm exec electron-builder ${{ matrix.flag }} --publish never

      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.os }}
          path: |
            dist/*.dmg
            dist/*.exe
            dist/*.AppImage
          if-no-files-found: error

  release:
    # 세 빌드가 모두 성공해야 돈다. 러너가 각자 올리면 셋이 같은 릴리스를
    # 만들려 경쟁하고, 하나가 실패해도 나머지가 이미 올려버린다.
    needs: build
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: artifacts
          merge-multiple: true

      - uses: softprops/action-gh-release@v2
        with:
          # 세 산출물이 다 올라왔는지 사람이 보고 publish를 누른다.
          draft: true
          generate_release_notes: true
          files: artifacts/*
          body: |
            ## 설치

            ### macOS
            1. `.dmg`를 열고 one-desk를 응용 프로그램으로 끌어다 놓습니다.
            2. 터미널에서 한 번 실행합니다 (서명되지 않은 앱이라 필요합니다):
               ```
               xattr -dr com.apple.quarantine /Applications/one-desk.app
               ```

            ### Windows
            포터블 실행 파일입니다. 설치 없이 바로 실행됩니다.
            SmartScreen 경고가 뜨면 "추가 정보" → "실행"을 누르세요.

            ### Linux
            ```
            chmod +x one-desk-*.AppImage && ./one-desk-*.AppImage
            ```
            이 산출물은 실행 검증을 거치지 않았습니다. 문제가 생기면 Issues로 알려주세요.

            ## 첫 실행 전에

            Claude Code CLI가 설치되어 있어야 합니다.
            흔한 설치 위치는 자동으로 찾습니다. 못 찾으면 workspace 설정의
            "claude 경로"에 실행 파일의 절대 경로를 넣으세요.

            - macOS/Linux: `which claude`
            - Windows: `where.exe claude`

            Windows에서 npm 전역 설치(`claude.cmd`)를 쓰고 있다면 실행되지 않습니다.
            네이티브 설치 스크립트로 `claude.exe`를 설치해 주세요.
```

- [ ] **Step 2: 커밋하고 푸시한다**

```bash
git add .github/workflows/release.yml
git commit -m "ci: build and publish release artifacts for three platforms"
git push
```

- [ ] **Step 3: 수동으로 한 번 돌린다**

```bash
gh workflow run release.yml
sleep 30 && gh run list --workflow=release.yml --limit 1
```

`gh run watch`로 끝날 때까지 본다. 세 job이 모두 초록이고 artifact가 셋 올라와야 한다. `release` job은 태그가 아니므로 건너뛴다(`if`).

실패하면 `gh run view --log-failed`로 원인을 보고 고친 뒤 다시 돌린다.

- [ ] **Step 4: Windows 산출물을 대상 환경에서 검증한다**

`gh run download`로 `windows-latest` artifact를 받아 대상 Windows 장비에서 실행하고, 설계 §8의 네 단계를 순서대로 확인한다.

1. 앱이 뜨고 workspace가 만들어진다 → `better-sqlite3`가 Windows에서 로드됐다
2. run이 프리플라이트를 통과한다 → Task 2가 `claude.exe`를 찾았다
3. agent가 응답한다 → Bedrock 환경변수가 전달됐다
4. agent가 만든 이슈/메모가 남는다 → MCP 서버에 도달했다

**이것이 이 계획의 진짜 완료 조건이다.** 앞의 모든 테스트는 가짜 실행 파일을 올바르게 골랐는지만 본다.

- [ ] **Step 5: 태그를 밀어 릴리스를 만든다**

4번까지 통과한 뒤에만 한다.

```bash
git tag v0.1.0
git push origin v0.1.0
```

draft 릴리스에 산출물 셋이 올라왔는지 확인하고 publish한다.

---

## Task 5: 문서 갱신

**Files:**
- Modify: `CLAUDE.md` — 상태 줄, "5단계 착수 전에 정할 것" 절, 함정 목록, 문서 표

**Interfaces:**
- Consumes: Task 1-4의 결과
- Produces: 없음

- [ ] **Step 1: "5단계 착수 전에 정할 것" 절을 해소된 것으로 바꾼다**

그 절 전체를 아래로 교체한다. **막힌 결정이 사라졌다는 것이 요점이다.**

```markdown
## 환경변수 — Windows에서는 해결됐다

한동안 5단계 선결 과제로 잡아뒀던 항목이다. 실측으로 **배관 자체가 불필요**한 것이 확인됐다.

**Windows GUI 앱은 사용자·시스템 환경변수를 정상적으로 물려받는다.** macOS의 launchd와 다르다. 대상 환경에서 Bedrock에 필요한 변수 셋(사용 플래그·게이트웨이 주소·CA 번들 경로)이 모두 사용자 범위에 영구 등록돼 있었고, 어댑터의 `env: { ...process.env }`가 그대로 넘긴다.

자격 증명도 문제가 아니다. `aws sso login`이 받은 토큰은 `~/.aws/sso/cache/`에 **파일로** 저장되고 Claude Code 안의 AWS SDK가 직접 읽는다 — **앱이 자격 증명을 손에 쥘 일이 없어** 평문 SQLite 저장 여부를 정할 필요가 없다.

**macOS에서는 여전히 미해결이다.** launchd가 최소 환경만 주므로 그 환경에서 Bedrock을 쓰려는 사람이 나오면 `Workspace.env`나 로그인 셸 환경 가져오기를 그때 검토한다.
```

- [ ] **Step 2: 함정 목록에 셋을 더한다**

"밟으면 조용히 깨지는 것들" 절 끝에:

```markdown
**`node:path`의 기본 `join`은 실행 중인 OS를 따른다.** macOS에서 `join('C:\\bin', 'claude.exe')`는 `C:\bin/claude.exe`가 된다. Windows 경로 규칙을 다루는 코드는 `win32`/`posix` 변형을 platform 인자로 골라야 개발 장비에서 검증할 수 있다 — `core/runner/executable.ts`가 그 패턴이다.

**`access(path, X_OK)`는 Windows에서 실행 권한을 보지 않는다.** 파일시스템에 그 개념이 없어 존재 여부(`F_OK`)처럼 동작한다. 그래서 Windows에서는 확장자 없는 후보를 아예 만들지 않는다 — 만들면 npm이 Git Bash용으로 함께 까는 sh 스크립트를 실행 파일로 골라버린다.

**`productName`이 사용자 데이터 위치를 정한다 — `appId`가 아니다.** Electron은 `userData`를 `appData` + 앱 이름으로 만들고 앱 이름은 `productName`을 우선한다. `electron-builder.yml`의 `productName: one-desk`를 보기 좋게 바꾸면 기존 사용자의 DB 디렉토리를 앱이 더 이상 보지 않는다.
```

- [ ] **Step 3: 문서 표에 두 줄을 더한다**

```markdown
| `docs/superpowers/specs/2026-08-14-release-pipeline-design.md` | 릴리스 파이프라인 설계 — 3플랫폼 빌드, Windows 실행 경로, 서명 |
| `docs/superpowers/plans/2026-08-14-release-pipeline.md` | 릴리스 파이프라인 구현 계획 (5개 태스크) |
```

- [ ] **Step 4: 상태 줄을 갱신한다**

문서 첫머리의 "**현재 상태:**" 문단에 릴리스 파이프라인이 붙었다는 것과, Windows 실행 경로가 `core/runner/executable.ts`로 분리됐다는 것을 적는다.

- [ ] **Step 5: 커밋**

```bash
git add CLAUDE.md
git commit -m "docs: record the release pipeline and resolved env-var question"
```

---

## 자체 검토 결과

**설계 커버리지:**

| 설계 절 | 태스크 |
|---|---|
| §2 산출물과 트리거 | Task 3(타겟) · Task 4(트리거) |
| §3 워크플로 구조 · 툴체인 고정 | Task 4 · Task 3 Step 2 |
| §4 macOS ad-hoc 서명 · 릴리스 노트 | Task 3 Step 1·4 · Task 4 Step 1 |
| §5 findExecutable 네 갈래 | Task 1 · Task 2 |
| §6 버전 검증 | Task 4 Step 1 |
| §7 electron-builder.yml | Task 3 |
| §8 검증 (자동/수동) | Task 1 Step 5 · Task 2 Step 6 · Task 4 Step 3·4 |
| §9 한계 (릴리스 노트 명시) | Task 4 Step 1의 body |

**타입 일관성:** `LookupOptions`가 Task 1에서 정의되고 Task 2에서 같은 이름·같은 형태로 쓰인다. `executableCandidates`/`findExecutable`/`isBatchShim` 세 이름이 두 태스크에서 일치한다.

**빠진 것 하나를 발견해 채웠다:** 설계 §9가 "Linux 미검증을 릴리스 노트에 밝힌다"고 했는데 초안의 릴리스 노트 본문에 그 문장이 없었다. Task 4 Step 1의 Linux 절에 넣었다.
