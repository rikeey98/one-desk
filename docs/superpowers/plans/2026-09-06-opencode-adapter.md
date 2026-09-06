# OpenCode 어댑터 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** one-desk가 Claude Code 외에 OpenCode로도 헤드리스 실행을 돌릴 수 있게 하는 두 번째 `AgentAdapter`를 붙인다.

**Architecture:** `AgentAdapter`(preflight/buildCommand/parseLine)의 두 번째 구현체를 `core/runner/adapters/opencode.ts`에 만든다. 권한은 파일이 아니라 `OPENCODE_PERMISSION` 환경변수로 넘긴다 — 그것만이 repo의 `opencode.json`을 이긴다. 그럼에도 남는 `ask`는 어댑터의 새 선택적 메서드 `verifyRunnable`이 실행 직전에 잡아 거부한다. MCP 설정 파일은 형식이 달라 호스트가 agent 종류별로 갈라 쓴다.

**Tech Stack:** TypeScript, Vitest, Electron, better-sqlite3/drizzle. opencode CLI 1.18.27 실측 기준.

**Spec:** `docs/superpowers/specs/2026-09-06-opencode-adapter-design.md`

## Global Constraints

- **`core/`는 `electron`을 import하지 않는다.** 경로가 필요하면 인자로 받는다.
- **`renderer/`는 `core/`를 import하지 않는다.** `window.oneDesk` 참조는 `renderer/main.tsx` 한 곳뿐이다. 컴포넌트는 `useClient()`를 쓴다.
- **IPC 핸들러는 얇다.** core 메서드 호출만 한다.
- **생성하는 권한 설정에 `ask`를 절대 넣지 않는다** (전체 설계 §7·§382). 모든 정책은 `allow` 아니면 `deny`.
- 들여쓰기 2칸, 함수명 camelCase, 상수 UPPER_SNAKE_CASE.
- `verbatimModuleSyntax: true` — 타입 전용 import는 `import type`.
- **주석과 오류 메시지는 한국어.**
- 커밋 메시지는 영어, 명령형.
- **TDD.** 실패를 먼저 확인하고 구현한다. 회귀 테스트를 추가할 때는 대상 코드를 잠시 망가뜨려 그 테스트가 실제로 실패하는지 확인한다.
- 명령은 `pnpm`을 쓴다. `pnpm test` / `pnpm typecheck` / `pnpm lint`.
- OpenCode 권한 키는 15개다: `bash doom_loop edit external_directory glob grep list lsp question read skill task todowrite webfetch websearch`. 값은 `ask`/`allow`/`deny`.

---

## 파일 구조

**새로 만드는 파일**

| 파일 | 책임 |
|---|---|
| `core/runner/adapters/common.ts` | 두 어댑터가 공유하는 것 — `withLoopbackBypass`, `stripNeedsAnswer`, `summarize`. CLI가 아니라 one-desk의 규약에 속하는 것들이다. |
| `core/runner/adapters/opencode.ts` | OpenCode 어댑터 본체 |
| `core/runner/adapters/opencode.command.test.ts` | preflight·buildCommand |
| `core/runner/adapters/opencode.parse.test.ts` | parseLine |
| `core/runner/adapters/opencode.verify.test.ts` | `verifyRunnable`의 ask 검사 |
| `core/runner/adapters/fixtures/opencode-stream.jsonl` | 실측 스트림 픽스처 |
| `core/runner/fixtures/fake-opencode.mjs` | e2e·수동 확인용 가짜 CLI |

**고치는 파일**

| 파일 | 무엇을 |
|---|---|
| `core/runner/permission.ts` | `opencodePermissionConfig` 추가 |
| `core/runner/types.ts` | `AgentAdapter`에 선택적 `verifyRunnable`, `VerifyRunnableInput` 추가 |
| `core/runner/adapters/claudeCode.ts` | 공유 헬퍼를 `common.ts`에서 import (동작 변화 없음) |
| `core/mcp/configFile.ts` | agent 종류별 본문 분기 |
| `core/mcp/host.ts` | `RunContext`에 `agentKind` |
| `core/execution.ts` | `prepare`에 `agentKind` 전달, `verifyRunnable` 호출 |
| `core/index.ts` | adapters 맵 교체, `verifyRunnable` 배선 |
| `renderer/components/RunPanel.tsx` | agent 선택 (하드코딩 `'claude-code'` 제거) |

---

## Task 1: 권한 정책

OpenCode의 세 권한 단계를 `OPENCODE_PERMISSION`에 실을 순수 객체로 만든다.

**Files:**
- Modify: `core/runner/permission.ts`
- Test: `core/runner/permission.test.ts`

**Interfaces:**
- Consumes: `Permission` (`@shared/models`)
- Produces: `opencodePermissionConfig(permission: Permission): Record<string, 'allow' | 'deny'>`, `OPENCODE_PERMISSION_KEYS: readonly string[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`core/runner/permission.test.ts` 끝에 더한다.

```ts
import { opencodePermissionConfig, OPENCODE_PERMISSION_KEYS } from './permission'

describe('opencodePermissionConfig', () => {
  const LEVELS = ['read_only', 'edit', 'full'] as const

  it.each(LEVELS)('%s에 ask가 하나도 없다', (level) => {
    // 설계 §7·§382. 헤드리스에서 ask는 곧 무한 대기다.
    const values = Object.values(opencodePermissionConfig(level))
    expect(values).not.toContain('ask')
    expect(values.every((v) => v === 'allow' || v === 'deny')).toBe(true)
  })

  it.each(LEVELS)('%s가 알려진 키 15개를 전부 명시한다', (level) => {
    // 이름을 대지 않은 키는 repo·전역 설정의 값이 그대로 살아남는다 (설계 §2-1).
    const config = opencodePermissionConfig(level)
    for (const key of OPENCODE_PERMISSION_KEYS) {
      expect(config, `${key}가 빠졌다`).toHaveProperty(key)
    }
  })

  it('키 목록이 실측한 15개다', () => {
    expect([...OPENCODE_PERMISSION_KEYS].sort()).toEqual([
      'bash', 'doom_loop', 'edit', 'external_directory', 'glob', 'grep',
      'list', 'lsp', 'question', 'read', 'skill', 'task', 'todowrite',
      'webfetch', 'websearch'
    ])
  })

  it('읽기 전용은 읽기만 연다', () => {
    const config = opencodePermissionConfig('read_only')
    expect(config['read']).toBe('allow')
    expect(config['grep']).toBe('allow')
    expect(config['edit']).toBe('deny')
    expect(config['bash']).toBe('deny')
    expect(config['*']).toBe('deny')
  })

  it('편집 허용은 edit만 더 연다 — bash는 여전히 막힌다', () => {
    // 전체 설계 §7 "파일 수정 자동 승인, 그 외 차단".
    const config = opencodePermissionConfig('edit')
    expect(config['edit']).toBe('allow')
    expect(config['bash']).toBe('deny')
  })

  it('전체 허용은 전부 연다', () => {
    const config = opencodePermissionConfig('full')
    expect(config['bash']).toBe('allow')
    expect(config['*']).toBe('allow')
    expect(Object.values(config).every((v) => v === 'allow')).toBe(true)
  })

  it('question은 전체 허용에서만 열린다', () => {
    // OpenCode에는 사람에게 되묻는 도구가 따로 있다. 헤드리스에서 열려 있으면
    // 답할 사람 없이 멈춘다 (설계 §3-2).
    expect(opencodePermissionConfig('read_only')['question']).toBe('deny')
    expect(opencodePermissionConfig('edit')['question']).toBe('deny')
    expect(opencodePermissionConfig('full')['question']).toBe('allow')
  })
})
```

- [ ] **Step 2: 돌려서 실패를 확인한다**

Run: `pnpm test permission`
Expected: FAIL — `opencodePermissionConfig is not a function` (import 오류)

- [ ] **Step 3: 구현한다**

`core/runner/permission.ts` 끝에 더한다.

```ts
/**
 * OpenCode의 권한 키. config 스키마 `$defs.PermissionConfig`가 열거하는 것
 * 그대로다 (1.18.27 실측, 15개).
 *
 * **전부 명시해야 한다.** OpenCode는 설정을 키 단위로 병합하므로, 이름을 대지
 * 않은 키는 프로젝트 `opencode.json`이나 전역 설정의 값이 그대로 살아남는다.
 * 거기 `ask`가 있으면 헤드리스 실행이 답할 사람 없이 멈춘다 (설계 §2-1·§3-1).
 */
export const OPENCODE_PERMISSION_KEYS = [
  'bash', 'doom_loop', 'edit', 'external_directory', 'glob', 'grep', 'list',
  'lsp', 'question', 'read', 'skill', 'task', 'todowrite', 'webfetch', 'websearch'
] as const

/** 읽기 전용에서 살려두는 키. claude 어댑터의 READ_ONLY_TOOLS와 대응이 어긋나지 않게 유지한다. */
const OPENCODE_READ_KEYS = [
  'read', 'glob', 'grep', 'list', 'lsp', 'todowrite', 'webfetch', 'websearch'
]

/**
 * 권한 단계를 `OPENCODE_PERMISSION` 환경변수에 실을 객체로 바꾼다.
 *
 * **파일이 아니라 환경변수인 이유:** `OPENCODE_CONFIG`가 가리키는 파일은 run의
 * cwd에 있는 `opencode.json`에게 진다. 환경변수만이 그것을 이긴다 (설계 §2).
 *
 * `"*"`도 넣지만 그것은 미래에 생길 키를 위한 것이지 보호 수단이 아니다 —
 * 구체적인 키가 와일드카드를 이긴다 (설계 §2-2).
 *
 * 절대 규칙: 어떤 경우에도 'ask'를 만들지 않는다 (설계 §7).
 */
export function opencodePermissionConfig(
  permission: Permission
): Record<string, 'allow' | 'deny'> {
  const config: Record<string, 'allow' | 'deny'> = {}

  if (permission === 'full') {
    config['*'] = 'allow'
    for (const key of OPENCODE_PERMISSION_KEYS) config[key] = 'allow'
    return config
  }

  config['*'] = 'deny'
  for (const key of OPENCODE_PERMISSION_KEYS) config[key] = 'deny'
  for (const key of OPENCODE_READ_KEYS) config[key] = 'allow'
  // 편집 허용은 파일 수정만 더 연다. bash는 그대로 막힌다 (전체 설계 §7).
  if (permission === 'edit') config['edit'] = 'allow'
  return config
}
```

- [ ] **Step 4: 돌려서 통과를 확인한다**

Run: `pnpm test permission`
Expected: PASS

- [ ] **Step 5: 회귀 테스트가 진짜인지 확인한다**

`opencodePermissionConfig`의 `if (permission === 'edit') config['edit'] = 'allow'` 줄을 잠시 지우고 `pnpm test permission`을 돌린다. "편집 허용은 edit만 더 연다"가 실패해야 한다. 확인 후 되돌린다.

- [ ] **Step 6: 전체 테스트와 타입체크**

Run: `pnpm test && pnpm typecheck`
Expected: 전부 통과

- [ ] **Step 7: 커밋**

```bash
git add core/runner/permission.ts core/runner/permission.test.ts
git commit -m "feat(runner): map permission levels to an OpenCode permission config"
```

---

## Task 2: 공유 헬퍼 추출과 어댑터 뼈대

`withLoopbackBypass` 등 CLI에 속하지 않는 헬퍼를 `common.ts`로 옮기고, OpenCode 어댑터의 preflight와 buildCommand를 만든다.

**Files:**
- Create: `core/runner/adapters/common.ts`
- Create: `core/runner/adapters/opencode.ts`
- Create: `core/runner/adapters/opencode.command.test.ts`
- Modify: `core/runner/adapters/claudeCode.ts` (헬퍼를 import로 교체)
- Test: `core/runner/adapters/opencode.command.test.ts`

**Interfaces:**
- Consumes: `opencodePermissionConfig` (Task 1), `findExecutable`·`isBatchShim`·`LookupOptions` (`../executable`), `ResolvedRunSpec`·`SpawnSpec`·`PreflightResult` (`../types`)
- Produces: `opencodeAdapter` — `kind: 'opencode'`, `preflight(explicitPath, opts?)`, `buildCommand(spec)`. `common.ts`가 `withLoopbackBypass(env)`, `stripNeedsAnswer(raw)`, `summarize(content)`를 내보낸다.

- [ ] **Step 1: `common.ts`를 만든다 (동작 변화 없는 이동)**

`core/runner/adapters/claudeCode.ts`에서 `LOOPBACK_HOSTS`·`withLoopbackBypass`·`NEEDS_ANSWER_MARK`·`stripNeedsAnswer`·`summarize`를 **주석까지 그대로** 잘라내 `core/runner/adapters/common.ts`로 옮기고 `export`를 붙인다. 파일 머리에 다음 주석을 단다.

```ts
/**
 * 어댑터들이 공유하는 것. **CLI에 속한 지식은 여기 두지 않는다** — 도구 이름
 * 판정이나 인자 조립은 각 어댑터의 책임이다 (전체 설계 §329).
 *
 * 여기 있는 셋은 CLI가 아니라 one-desk의 규약에 속한다.
 * - withLoopbackBypass: MCP 서버가 항상 127.0.0.1이라는 우리 쪽 사정
 * - stripNeedsAnswer: [NEEDS_ANSWER] 표식은 우리가 프롬프트로 심은 규약이다
 * - summarize: 로그 길이 정책
 */
```

`claudeCode.ts`는 셋을 `import { stripNeedsAnswer, summarize, withLoopbackBypass } from './common'`으로 바꾼다.

- [ ] **Step 2: 이동이 아무것도 깨지 않았는지 확인한다**

Run: `pnpm test claudeCode && pnpm typecheck`
Expected: PASS — 기존 claude 테스트가 전부 초록이어야 한다. 하나라도 빨간색이면 잘라내기가 잘못된 것이다.

- [ ] **Step 3: 실패하는 테스트를 쓴다**

`core/runner/adapters/opencode.command.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { opencodeAdapter } from './opencode'
import type { ResolvedRunSpec } from '../types'

function spec(over: Partial<ResolvedRunSpec> = {}): ResolvedRunSpec {
  return {
    runId: 'run-1',
    cwd: '/tmp/work',
    model: null,
    permission: 'edit',
    prompt: '무엇이든',
    resumeSessionId: null,
    executable: '/usr/local/bin/opencode',
    mcp: null,
    ...over
  }
}

describe('opencodeAdapter.buildCommand', () => {
  it('run과 --format json으로 시작한다', () => {
    const built = opencodeAdapter.buildCommand(spec())
    expect(built.args.slice(0, 3)).toEqual(['run', '--format', 'json'])
    expect(built.cmd).toBe('/usr/local/bin/opencode')
    expect(built.cwd).toBe('/tmp/work')
  })

  it('프롬프트를 인자에 싣지 않는다', () => {
    // stdin으로 넘긴다 — 맥락이 합쳐지면 수십 KB라 인자 길이 제한에 걸린다.
    const built = opencodeAdapter.buildCommand(spec({ prompt: '아주 긴 프롬프트' }))
    expect(built.args).not.toContain('아주 긴 프롬프트')
  })

  it('권한을 OPENCODE_PERMISSION 환경변수로 넘긴다', () => {
    // 파일(OPENCODE_CONFIG)은 repo의 opencode.json에게 진다 (설계 §2-3).
    const built = opencodeAdapter.buildCommand(spec({ permission: 'read_only' }))
    const parsed = JSON.parse(built.env['OPENCODE_PERMISSION']!)
    expect(parsed['read']).toBe('allow')
    expect(parsed['edit']).toBe('deny')
    expect(Object.values(parsed)).not.toContain('ask')
  })

  it('--auto는 전체 허용에서만 붙는다', () => {
    expect(opencodeAdapter.buildCommand(spec({ permission: 'full' })).args).toContain('--auto')
    expect(opencodeAdapter.buildCommand(spec({ permission: 'edit' })).args).not.toContain('--auto')
    expect(opencodeAdapter.buildCommand(spec({ permission: 'read_only' })).args).not.toContain('--auto')
  })

  it('모델이 있으면 -m으로 붙이고 없으면 붙이지 않는다', () => {
    const withModel = opencodeAdapter.buildCommand(spec({ model: 'anthropic/claude-sonnet-4-5' }))
    expect(withModel.args).toContain('-m')
    expect(withModel.args[withModel.args.indexOf('-m') + 1]).toBe('anthropic/claude-sonnet-4-5')
    expect(opencodeAdapter.buildCommand(spec({ model: null })).args).not.toContain('-m')
  })

  it('이어서 실행은 --session으로 넘긴다', () => {
    const built = opencodeAdapter.buildCommand(spec({ resumeSessionId: 'ses_abc' }))
    expect(built.args).toContain('--session')
    expect(built.args[built.args.indexOf('--session') + 1]).toBe('ses_abc')
  })

  it('MCP가 있으면 OPENCODE_CONFIG로 설정 파일을 가리킨다', () => {
    const built = opencodeAdapter.buildCommand(spec({
      mcp: { serverName: 'one-desk', configFile: '/data/mcp/run-1.json', token: 't', url: 'http://127.0.0.1:1/mcp' }
    }))
    expect(built.env['OPENCODE_CONFIG']).toBe('/data/mcp/run-1.json')
  })

  it('MCP가 없으면 OPENCODE_CONFIG를 세우지 않는다', () => {
    // 사용자 설정을 우리 것으로 덮을 이유가 없다. 권한은 환경변수가 따로 지킨다.
    expect(opencodeAdapter.buildCommand(spec({ mcp: null })).env['OPENCODE_CONFIG']).toBeUndefined()
  })

  it('루프백을 프록시 예외로 넣는다', () => {
    const built = opencodeAdapter.buildCommand(spec())
    expect(built.env['NO_PROXY']).toContain('127.0.0.1')
    expect(built.env['no_proxy']).toContain('127.0.0.1')
  })
})

describe('opencodeAdapter.preflight', () => {
  it('명시 경로가 실행 불가면 거부한다', async () => {
    const result = await opencodeAdapter.preflight('/없는/경로/opencode')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('/없는/경로/opencode')
  })

  it('.cmd 설치본을 거부하고 대안을 안내한다', async () => {
    // .cmd는 shell 없이 spawn하면 EINVAL이고, shell을 켜면 취소가 자식에 닿지 않는다.
    const dir = mkdtempSync(join(tmpdir(), 'od-pre-'))
    const shim = join(dir, 'opencode.cmd')
    writeFileSync(shim, '')
    chmodSync(shim, 0o755)
    try {
      const result = await opencodeAdapter.preflight(shim)
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('opencode.exe')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('실행 가능한 명시 경로를 그대로 쓴다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'od-pre-'))
    const bin = join(dir, 'opencode')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
    try {
      const result = await opencodeAdapter.preflight(bin)
      expect(result).toEqual({ ok: true, executable: bin })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 4: 돌려서 실패를 확인한다**

Run: `pnpm test opencode.command`
Expected: FAIL — `./opencode` 모듈이 없다

- [ ] **Step 5: 어댑터를 만든다**

`core/runner/adapters/opencode.ts`

```ts
import { access, constants } from 'node:fs/promises'
import type { AgentAdapter, PreflightResult, ResolvedRunSpec, SpawnSpec } from '../types'
import { opencodePermissionConfig } from '../permission'
import { findExecutable, isBatchShim, type LookupOptions } from '../executable'
import { withLoopbackBypass } from './common'

const BATCH_SHIM_REASON =
  'opencode.cmd는 직접 실행할 수 없습니다. 네이티브 설치본(opencode.exe)을 쓰거나, workspace 설정에 opencode.exe의 절대 경로를 지정하세요.'

// `: AgentAdapter`가 아니라 `satisfies`인 이유는 claudeCode.ts와 같다 —
// preflight의 두 번째 인자(opts)가 테스트의 이음매인데, 인터페이스로 표기하면
// 타입에서 잘려 테스트가 부를 수 없다.
export const opencodeAdapter = {
  kind: 'opencode',

  async preflight(explicitPath: string | null, opts: LookupOptions = {}): Promise<PreflightResult> {
    let executable: string
    if (explicitPath) {
      try {
        await access(explicitPath, constants.X_OK)
      } catch {
        return { ok: false, reason: `설정된 경로에서 실행할 수 없습니다: ${explicitPath}` }
      }
      executable = explicitPath
    } else {
      const found = await findExecutable('opencode', opts)
      if (!found) {
        return {
          ok: false,
          reason:
            'PATH에서 opencode 실행 파일을 찾을 수 없습니다. workspace 설정에서 경로를 지정하세요.'
        }
      }
      executable = found
    }
    // 배치 shim 판별은 두 경로가 합류한 뒤 한 번만 한다 (claudeCode.ts와 같은 이유).
    if (isBatchShim(executable)) return { ok: false, reason: BATCH_SHIM_REASON }
    return { ok: true, executable }
  },

  buildCommand(spec: ResolvedRunSpec): SpawnSpec {
    const args = ['run', '--format', 'json']

    // --auto는 "명시적으로 deny가 아닌 권한을 자동 승인"이다. 전체 허용에서만
    // 쓴다 (전체 설계 §376). 다른 단계에 켜면 우리가 막은 것이 열린다.
    if (spec.permission === 'full') args.push('--auto')

    // 모델은 provider/model 형식이다 (전체 설계 §199).
    if (spec.model) args.push('-m', spec.model)
    if (spec.resumeSessionId) args.push('--session', spec.resumeSessionId)

    const env = withLoopbackBypass(process.env)

    // **권한은 환경변수로 간다.** OPENCODE_CONFIG가 가리키는 파일은 run의 cwd에
    // 있는 opencode.json에게 지지만, 이 환경변수는 그것도 이긴다 (설계 §2-4).
    env['OPENCODE_PERMISSION'] = JSON.stringify(opencodePermissionConfig(spec.permission))

    // MCP 설정만 파일로 간다 — mcp 섹션에 해당하는 환경변수가 없다.
    // 파일이 없는 경로를 가리키면 opencode가 조용히 무시하므로(설계 §8),
    // 파일을 만드는 쪽(호스트)이 실패를 삼키지 않아야 한다.
    if (spec.mcp) env['OPENCODE_CONFIG'] = spec.mcp.configFile

    // 프롬프트는 stdin으로 넘긴다 — RunManager가 쓰고 닫는다.
    return { cmd: spec.executable, args, env, cwd: spec.cwd }
  },

  parseLine(): [] {
    // Task 3에서 채운다.
    return []
  }
} satisfies AgentAdapter
```

- [ ] **Step 6: 돌려서 통과를 확인한다**

Run: `pnpm test opencode.command`
Expected: PASS

- [ ] **Step 7: 회귀 테스트가 진짜인지 확인한다**

`buildCommand`의 `if (spec.permission === 'full') args.push('--auto')`를 `args.push('--auto')`로 잠시 바꾸고 돌린다. "--auto는 전체 허용에서만 붙는다"가 실패해야 한다. 되돌린다.

- [ ] **Step 8: 전체 테스트와 린트**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: 전부 통과

- [ ] **Step 9: 커밋**

```bash
git add core/runner/adapters/common.ts core/runner/adapters/opencode.ts \
        core/runner/adapters/opencode.command.test.ts core/runner/adapters/claudeCode.ts
git commit -m "feat(runner): add the OpenCode adapter preflight and command builder"
```

---

## Task 3: 스트림 파싱과 실측 픽스처

NDJSON 한 줄을 정규화 이벤트로 옮긴다.

**Files:**
- Create: `core/runner/adapters/fixtures/opencode-stream.jsonl`
- Create: `core/runner/adapters/opencode.parse.test.ts`
- Modify: `core/runner/adapters/opencode.ts`

**Interfaces:**
- Consumes: `stripNeedsAnswer`·`summarize` (`./common`), `RunEventInit`·`ToolEffect` (`@shared/events`)
- Produces: `opencodeAdapter.parseLine(line: string, runId: string): RunEventInit[]`

- [ ] **Step 1: 실측 픽스처를 뜬다**

opencode에 로그인돼 있어야 하고 **무료 모델이라 비용이 들지 않는다.** 빈 디렉토리에서 돌린다.

```bash
mkdir -p /tmp/od-fx && cd /tmp/od-fx && printf 'hello from one-desk probe\n' > notes.txt
OPENCODE_PERMISSION='{"*":"deny","read":"allow","edit":"allow","bash":"deny"}' \
  opencode run --format json -m opencode/nemotron-3.5-lightning-free \
  "Read notes.txt, then create summary.txt whose entire contents are exactly: OK" \
  </dev/null > stream.ndjson
cp stream.ndjson <repo>/core/runner/adapters/fixtures/opencode-stream.jsonl
```

받은 파일이 다음을 만족하는지 눈으로 확인한다. 아니면 프롬프트를 조정해 다시 뜬다.

- 모든 줄이 단독 JSON이고 `type`·`sessionID`·`part`를 갖는다
- `type: "tool_use"`이고 `part.tool === "read"`인 줄이 있다
- `type: "tool_use"`이고 `part.tool === "write"`인 줄이 있다
- `type: "text"`인 줄이 있다

**모델을 못 쓰는 환경이면** 위 성질을 만족하는 줄을 손으로 만들어 넣되, 커밋 메시지에 "합성 픽스처"임을 남긴다. 설계 §6-2가 요구하는 것은 *실제 형태*이지 특정 실행이 아니다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`core/runner/adapters/opencode.parse.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { opencodeAdapter } from './opencode'
import type { RunEventInit } from '@shared/events'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = resolve(HERE, 'fixtures/opencode-stream.jsonl')

function parseAll(): RunEventInit[] {
  return readFileSync(FIXTURE, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .flatMap((line) => opencodeAdapter.parseLine(line, 'run-1'))
}

describe('opencodeAdapter.parseLine — 실측 픽스처', () => {
  it('세션 id를 집는다', () => {
    const session = parseAll().find((e) => e.type === 'session')
    expect(session).toBeDefined()
    expect((session as { sessionId: string }).sessionId).toMatch(/^ses/)
  })

  it('읽기 도구를 read 효과로 옮긴다', () => {
    const read = parseAll().find((e) => e.type === 'tool_use' && e.name === 'read')
    expect(read).toMatchObject({ effect: 'read' })
  })

  it('쓰기 도구를 write 효과와 대상 경로로 옮긴다', () => {
    // 이 두 값이 앞으로 diff 뷰어의 입력이다 (전체 설계 §329).
    const write = parseAll().find((e) => e.type === 'tool_use' && e.name === 'write')
    expect(write).toMatchObject({ effect: 'write' })
    expect((write as { targetPaths: string[] }).targetPaths[0]).toMatch(/summary\.txt$/)
  })

  it('도구 한 줄에서 tool_use와 tool_result가 같은 id로 나온다', () => {
    const events = parseAll()
    const use = events.find((e) => e.type === 'tool_use')!
    const result = events.find((e) => e.type === 'tool_result')!
    expect((use as { toolUseId: string }).toolUseId).not.toBe('')
    expect((result as { toolUseId: string }).toolUseId)
      .toBe((use as { toolUseId: string }).toolUseId)
    expect((result as { ok: boolean }).ok).toBe(true)
  })

  it('최종 텍스트가 text와 result 둘 다로 나온다', () => {
    // OpenCode에는 종료 이벤트가 없어 result를 합성한다 (설계 §7).
    const events = parseAll()
    const text = events.filter((e) => e.type === 'text').at(-1)!
    const result = events.filter((e) => e.type === 'result').at(-1)!
    expect((result as { resultText: string }).resultText)
      .toBe((text as { text: string }).text)
    expect((result as { status: string }).status).toBe('succeeded')
  })
})

describe('opencodeAdapter.parseLine — 단위', () => {
  it('깨진 줄을 raw로 흘려보낸다', () => {
    // 한 줄이 깨졌다고 run 전체를 죽이지 않는다 (전체 설계 §11).
    expect(opencodeAdapter.parseLine('{깨진', 'run-1'))
      .toEqual([{ type: 'raw', runId: 'run-1', at: expect.any(Number), line: '{깨진' }])
  })

  it('모르는 type은 버린다', () => {
    const line = JSON.stringify({ type: 'step_finish', sessionID: 'ses_x', part: {} })
    expect(opencodeAdapter.parseLine(line, 'run-1')).toEqual([])
  })

  it('[NEEDS_ANSWER] 표식을 떼고 needsAnswer를 세운다', () => {
    const line = JSON.stringify({
      type: 'text', sessionID: 'ses_x',
      part: { type: 'text', text: '[NEEDS_ANSWER]\nA와 B 중 어느 쪽으로 할까요?' }
    })
    const events = opencodeAdapter.parseLine(line, 'run-1')
    const result = events.find((e) => e.type === 'result')!
    expect((result as { needsAnswer: boolean }).needsAnswer).toBe(true)
    expect((result as { resultText: string }).resultText).toBe('A와 B 중 어느 쪽으로 할까요?')
    // 표식은 로그에도 새어나가면 안 된다.
    const text = events.find((e) => e.type === 'text')!
    expect((text as { text: string }).text).not.toContain('[NEEDS_ANSWER]')
  })

  it('bash 도구는 execute 효과다', () => {
    const line = JSON.stringify({
      type: 'tool_use', sessionID: 'ses_x',
      part: { tool: 'bash', callID: 'c1', state: { status: 'completed', input: {}, output: '' } }
    })
    const use = opencodeAdapter.parseLine(line, 'run-1')[0]!
    expect((use as { effect: string }).effect).toBe('execute')
  })

  it('실패한 도구는 ok=false다', () => {
    const line = JSON.stringify({
      type: 'tool_use', sessionID: 'ses_x',
      part: { tool: 'read', callID: 'c1', state: { status: 'error', input: {}, output: '없음' } }
    })
    const result = opencodeAdapter.parseLine(line, 'run-1')
      .find((e) => e.type === 'tool_result')!
    expect((result as { ok: boolean }).ok).toBe(false)
  })
})
```

- [ ] **Step 3: 돌려서 실패를 확인한다**

Run: `pnpm test opencode.parse`
Expected: FAIL — `parseLine`이 빈 배열만 낸다

- [ ] **Step 4: parseLine을 구현한다**

`core/runner/adapters/opencode.ts`의 `parseLine` 자리를 갈아끼우고, 파일 위쪽에 도구 표를 더한다.

```ts
import { stripNeedsAnswer, summarize, withLoopbackBypass } from './common'
import type { RunEventInit, ToolEffect } from '@shared/events'

type RawEvent = RunEventInit

/**
 * 도구 이름 → 효과. **소문자다** — claude는 `Edit`, opencode는 `edit`이다.
 * 어느 도구가 파일을 쓰는지 아는 것은 어댑터의 책임이다 (전체 설계 §329).
 */
const TOOL_EFFECTS: Record<string, ToolEffect> = {
  read: 'read', glob: 'read', grep: 'read', list: 'read',
  webfetch: 'read', websearch: 'read', lsp: 'read',
  write: 'write', edit: 'write', patch: 'write',
  bash: 'execute'
}

function toolEffect(name: string): ToolEffect {
  return TOOL_EFFECTS[name] ?? 'other'
}

function targetPaths(input: unknown): string[] {
  if (typeof input !== 'object' || input === null) return []
  const path = (input as Record<string, unknown>)['filePath']
  return typeof path === 'string' ? [path] : []
}
```

```ts
  parseLine(line: string, runId: string): RawEvent[] {
    const at = Date.now()
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(line) as Record<string, unknown>
    } catch {
      // 깨진 줄 때문에 run 전체를 죽이지 않는다 (전체 설계 §11)
      return [{ type: 'raw', runId, at, line }]
    }

    const part = (typeof obj['part'] === 'object' && obj['part'] !== null)
      ? (obj['part'] as Record<string, unknown>)
      : null
    const sessionId = typeof obj['sessionID'] === 'string' ? obj['sessionID'] : null

    switch (obj['type']) {
      case 'step_start':
        // sessionID는 모든 줄에 실려 오지만 줄마다 내면 같은 값이 로그를 채운다.
        return sessionId ? [{ type: 'session', runId, at, sessionId }] : []

      case 'tool_use': {
        if (!part) return []
        const name = String(part['tool'] ?? '')
        const state = (typeof part['state'] === 'object' && part['state'] !== null)
          ? (part['state'] as Record<string, unknown>)
          : {}
        const toolUseId = String(part['callID'] ?? '')
        // 한 줄에 입력과 결과가 함께 온다 — 이미 끝난 도구를 보고받는 것이다.
        // (그래서 diff 뷰어의 before 스냅샷을 여기서 걸 수 없다. 설계 §10-1)
        return [
          {
            type: 'tool_use', runId, at, toolUseId, name,
            effect: toolEffect(name),
            targetPaths: targetPaths(state['input']),
            input: state['input']
          },
          {
            type: 'tool_result', runId, at, toolUseId,
            ok: state['status'] === 'completed',
            summary: summarize(state['output'])
          }
        ]
      }

      case 'text': {
        if (!part) return []
        const { text, marked } = stripNeedsAnswer(String(part['text'] ?? ''))
        // OpenCode에는 claude의 result 같은 종료 이벤트가 없다. text마다 result를
        // 함께 내면 RunManager가 덮어써서 마지막 것이 남는다 (설계 §7).
        return [
          { type: 'text', runId, at, text },
          {
            type: 'result', runId, at,
            status: 'succeeded',
            resultText: text,
            sessionId,
            needsAnswer: marked
          }
        ]
      }

      default:
        // step_finish의 토큰·비용은 아직 쓰는 곳이 없다.
        return []
    }
  }
```

- [ ] **Step 5: 돌려서 통과를 확인한다**

Run: `pnpm test opencode.parse`
Expected: PASS

- [ ] **Step 6: 회귀 테스트가 진짜인지 확인한다**

`TOOL_EFFECTS`에서 `write: 'write'`를 잠시 지우고 돌린다. "쓰기 도구를 write 효과와 대상 경로로 옮긴다"가 실패해야 한다. 되돌린다.

- [ ] **Step 7: 전체 테스트와 린트**

Run: `pnpm test && pnpm typecheck && pnpm lint`

- [ ] **Step 8: 커밋**

```bash
git add core/runner/adapters/opencode.ts core/runner/adapters/opencode.parse.test.ts \
        core/runner/adapters/fixtures/opencode-stream.jsonl
git commit -m "feat(runner): parse the OpenCode NDJSON stream into normalized events"
```

---

## Task 4: `verifyRunnable` — 남은 `ask`를 실행 전에 잡는다

15개 키를 다 명시해도 미래의 키·깨진 JSON·MCP 도구 이름으로 `ask`가 남을 수 있다. 셋 다 증상이 "조용히 영원히 멈춤"이라 마지막 확인이 필요하다.

**Files:**
- Modify: `core/runner/types.ts`
- Modify: `core/runner/adapters/opencode.ts`
- Create: `core/runner/adapters/opencode.verify.test.ts`

**Interfaces:**
- Consumes: `opencodePermissionConfig` (Task 1), `withLoopbackBypass` (Task 2)
- Produces: `VerifyRunnableInput { executable: string; cwd: string; permission: Permission }`, `AgentAdapter.verifyRunnable?(input): Promise<PreflightResult>`, `opencodeAdapter.verifyRunnable(input, probe?)`, `type ConfigProbe = (input: { executable: string; cwd: string; env: Record<string, string> }) => Promise<string>`

- [ ] **Step 1: 타입을 더한다**

`core/runner/types.ts`

```ts
/** 실행 직전 마지막 확인에 필요한 것. preflight는 cwd를 받지 않는다. */
export interface VerifyRunnableInput {
  executable: string
  cwd: string
  permission: Permission
}
```

`AgentAdapter`에 더한다.

```ts
  /**
   * preflight를 통과한 뒤, 실제로 쓸 cwd와 권한으로 마지막 확인을 한다.
   *
   * **필요한 어댑터만 구현한다.** claude는 권한 플래그를 우리가 전부 소유하므로
   * 합쳐질 남의 설정이 없다. OpenCode는 설정이 병합되고 그중 일부는 우리가
   * 이길 수 없어(설계 §2-3) 이 단계가 필요하다.
   */
  verifyRunnable?(input: VerifyRunnableInput): Promise<PreflightResult>
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`core/runner/adapters/opencode.verify.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest'
import { opencodeAdapter } from './opencode'

const input = { executable: '/bin/opencode', cwd: '/tmp/work', permission: 'edit' as const }

function probeReturning(permission: unknown) {
  return vi.fn(async () => JSON.stringify({ permission }))
}

describe('opencodeAdapter.verifyRunnable', () => {
  it('ask가 없으면 통과시킨다', async () => {
    const probe = probeReturning({ '*': 'deny', read: 'allow', edit: 'allow' })
    await expect(opencodeAdapter.verifyRunnable(input, probe)).resolves.toEqual({ ok: true })
  })

  it('ask가 남아 있으면 거부하고 키 이름을 알려준다', async () => {
    const probe = probeReturning({ '*': 'deny', read: 'allow', webfetch: 'ask' })
    const result = await opencodeAdapter.verifyRunnable(input, probe)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('webfetch')
    expect(result.reason).toContain('/tmp/work')
  })

  it('ask가 여럿이면 전부 알려준다', async () => {
    const probe = probeReturning({ bash: 'ask', webfetch: 'ask' })
    const result = await opencodeAdapter.verifyRunnable(input, probe)
    expect(result.reason).toContain('bash')
    expect(result.reason).toContain('webfetch')
  })

  it('우리가 실을 환경변수를 그대로 실어 확인한다', async () => {
    // 이걸 빼먹으면 실행할 때와 다른 설정을 검사하게 되어 검사가 무의미해진다.
    const probe = probeReturning({})
    await opencodeAdapter.verifyRunnable(input, probe)
    const passed = probe.mock.calls[0]![0]
    expect(passed.cwd).toBe('/tmp/work')
    expect(passed.executable).toBe('/bin/opencode')
    expect(JSON.parse(passed.env['OPENCODE_PERMISSION']!)['edit']).toBe('allow')
  })

  it('설정을 읽지 못하면 거부한다', async () => {
    // 조용히 통과시키면 검사가 있으나 마나다.
    const probe = vi.fn(async () => { throw new Error('spawn 실패') })
    const result = await opencodeAdapter.verifyRunnable(input, probe)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('확인하지 못했습니다')
  })

  it('출력이 JSON이 아니면 거부한다', async () => {
    const probe = vi.fn(async () => '이건 JSON이 아니다')
    const result = await opencodeAdapter.verifyRunnable(input, probe)
    expect(result.ok).toBe(false)
  })

  it('permission이 아예 없으면 통과시킨다', async () => {
    // 아무도 권한을 정하지 않았다는 뜻이고, 우리 환경변수가 이미 전부 정했다.
    const probe = vi.fn(async () => JSON.stringify({ permission: null }))
    await expect(opencodeAdapter.verifyRunnable(input, probe)).resolves.toEqual({ ok: true })
  })
})
```

- [ ] **Step 3: 돌려서 실패를 확인한다**

Run: `pnpm test opencode.verify`
Expected: FAIL — `verifyRunnable is not a function`

- [ ] **Step 4: 구현한다**

`core/runner/adapters/opencode.ts`에 더한다.

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * 해결된 설정을 JSON 문자열로 가져온다. 테스트가 갈아끼우는 이음매다.
 *
 * **동기 실행을 쓰면 안 된다.** `execFileSync`는 이벤트 루프를 막아 같은
 * 프로세스에 떠 있는 MCP 서버가 연결을 받지 못하게 만든다.
 */
export type ConfigProbe = (input: {
  executable: string
  cwd: string
  env: Record<string, string>
}) => Promise<string>

const defaultProbe: ConfigProbe = async ({ executable, cwd, env }) => {
  const { stdout } = await execFileAsync(executable, ['debug', 'config'], { cwd, env })
  return stdout
}
```

`opencodeAdapter` 안에 더한다.

```ts
  /**
   * 실행 직전 마지막 확인 — 해결된 설정에 `ask`가 남아 있지 않은지 본다.
   *
   * 15개 키를 전부 명시해도 구멍이 셋 남는다: opencode가 나중에 추가하는 키,
   * OPENCODE_PERMISSION이 깨진 JSON일 때의 조용한 무시, MCP 도구 이름 같은
   * 임의 키. 셋 다 증상이 같다 — **헤드리스 실행이 아무 말 없이 영원히 멈추고
   * 동시 실행 슬롯을 계속 점유한다** (설계 §3-3·§8).
   *
   * 모델을 호출하지 않으므로 비용도 지연도 작다.
   */
  async verifyRunnable(
    input: VerifyRunnableInput,
    probe: ConfigProbe = defaultProbe
  ): Promise<PreflightResult> {
    const env = withLoopbackBypass(process.env)
    // 실제로 실행에 쓸 환경변수를 그대로 실어야 검사가 의미를 갖는다.
    env['OPENCODE_PERMISSION'] = JSON.stringify(opencodePermissionConfig(input.permission))

    let raw: string
    try {
      raw = await probe({ executable: input.executable, cwd: input.cwd, env })
    } catch {
      return {
        ok: false,
        reason: `OpenCode 설정을 확인하지 못했습니다. ${input.cwd} 에서 실행할 수 있는지 보세요.`
      }
    }

    let permission: unknown
    try {
      permission = (JSON.parse(raw) as Record<string, unknown>)['permission']
    } catch {
      return { ok: false, reason: 'OpenCode 설정을 확인하지 못했습니다. 출력을 읽을 수 없습니다.' }
    }

    if (typeof permission !== 'object' || permission === null) return { ok: true }

    const asking = Object.entries(permission as Record<string, unknown>)
      .filter(([, value]) => value === 'ask')
      .map(([key]) => key)
    if (asking.length === 0) return { ok: true }

    return {
      ok: false,
      reason:
        `${asking.join(', ')} 권한이 '물어보기'로 남아 있어 실행할 수 없습니다. ` +
        '헤드리스 실행에는 답할 사람이 없어 멈춥니다. ' +
        `${input.cwd}/opencode.json 에서 해당 항목을 지우거나 allow/deny로 바꾸세요.`
    }
  },
```

`VerifyRunnableInput`을 `../types`에서 import한다.

- [ ] **Step 5: 돌려서 통과를 확인한다**

Run: `pnpm test opencode.verify`
Expected: PASS

- [ ] **Step 6: 회귀 테스트가 진짜인지 확인한다**

`asking.length === 0` 검사를 `true`로 잠시 바꿔 항상 통과하게 만들고 돌린다. "ask가 남아 있으면 거부하고 키 이름을 알려준다"가 실패해야 한다. 되돌린다.

- [ ] **Step 7: 전체 테스트와 타입체크**

Run: `pnpm test && pnpm typecheck && pnpm lint`

- [ ] **Step 8: 커밋**

```bash
git add core/runner/types.ts core/runner/adapters/opencode.ts \
        core/runner/adapters/opencode.verify.test.ts
git commit -m "feat(runner): reject a run when OpenCode still resolves a permission to ask"
```

---

## Task 5: 실행 서비스가 `verifyRunnable`을 부른다

**Files:**
- Modify: `core/execution.ts`
- Test: `core/execution.test.ts`

**Interfaces:**
- Consumes: `VerifyRunnableInput`·`PreflightResult` (Task 4)
- Produces: `ExecutionOptions.verifyRunnable?: (agentKind: AgentKind, input: VerifyRunnableInput) => Promise<PreflightResult>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`core/execution.test.ts`의 `SetupOptions`에 통로를 하나 더한다.

```ts
  /** 어댑터의 마지막 확인을 물리는 통로. 없으면 부르지 않는다 */
  verifyRunnable?: (
    agentKind: AgentKind,
    input: VerifyRunnableInput
  ) => Promise<PreflightResult>
```

`setup()`의 `createExecutionService({...})` 호출에 더한다 (`mcp`·`onError`와 같은 방식이다).

```ts
    ...(options.verifyRunnable ? { verifyRunnable: options.verifyRunnable } : {}),
```

그리고 `describe('ExecutionService', ...)` 안에 테스트를 더한다.

```ts
  it('verifyRunnable이 거부하면 run이 시작하지 않고 실패로 끝난다', async () => {
    const verifyRunnable = vi.fn(async () => ({
      ok: false, reason: "bash 권한이 '물어보기'로 남아 있어 실행할 수 없습니다."
    }))
    const local = setup({ verifyRunnable })

    const run = await local.service.start({
      workspaceId: local.workspaceId,
      agentKind: 'opencode' as const,
      cwd: process.cwd(),
      permission: 'edit' as const,
      userPrompt: '고쳐줘',
      context: []
    })

    const saved = local.runs.get(run.id)
    expect(saved.status).toBe('failed')
    expect(saved.errorMessage).toContain('물어보기')
    // preflight 실패와 같은 성질 — 슬롯을 잡은 적이 없다.
    expect(saved.startedAt).toBeNull()
    rmSync(local.logDir, { recursive: true, force: true })
  })

  it('verifyRunnable에 실제로 쓸 실행 파일·cwd·권한을 넘긴다', async () => {
    // 이걸 빠뜨리면 실행할 때와 다른 조건을 검사하게 되어 검사가 무의미해진다.
    const verifyRunnable = vi.fn(async () => ({ ok: true }))
    const local = setup({ verifyRunnable })

    await local.service.start({
      workspaceId: local.workspaceId,
      agentKind: 'opencode' as const,
      cwd: process.cwd(),
      permission: 'read_only' as const,
      userPrompt: '봐줘',
      context: []
    })

    expect(verifyRunnable).toHaveBeenCalledWith('opencode', {
      executable: process.execPath,
      cwd: process.cwd(),
      permission: 'read_only'
    })
    rmSync(local.logDir, { recursive: true, force: true })
  })

  it('verifyRunnable이 없으면 그대로 진행한다', async () => {
    // claude 어댑터는 구현하지 않는다. 기본 setup에는 통로가 없다.
    const run = await startBase()
    expect(ctx.runs.get(run.id).status).not.toBe('failed')
  })
```

`AgentKind`·`VerifyRunnableInput`·`PreflightResult` import를 파일 머리에 더한다.

- [ ] **Step 2: 돌려서 실패를 확인한다**

Run: `pnpm test execution`
Expected: FAIL — `verifyRunnable`이 옵션에 없다

- [ ] **Step 3: 구현한다**

`core/execution.ts`의 옵션 타입에 더한다.

```ts
  /**
   * preflight 뒤 마지막 확인. 어댑터가 구현했을 때만 불린다.
   * 실행 파일 탐색과 달리 cwd와 권한이 있어야 하는 검사라 자리가 따로다.
   */
  verifyRunnable?: (
    agentKind: AgentKind,
    input: VerifyRunnableInput
  ) => Promise<PreflightResult>
```

`const executable = preflight.executable` 바로 뒤, MCP 준비 앞에 넣는다.

```ts
    // preflight와 같은 자리에 두는 이유도 같다 — 확인되지 않은 run이 포트를
    // 열거나 슬롯을 잡았다 놓는 낭비를 만들지 않고, startedAt이 null인 실패로 남는다.
    if (opts.verifyRunnable) {
      const verified = await opts.verifyRunnable(spec.agentKind, {
        executable,
        cwd: spec.cwd,
        permission: spec.permission
      })
      if (!verified.ok) {
        return notify(opts.runs.markFinished(created.id, {
          status: 'failed',
          resultText: null,
          externalSessionId: null,
          needsAnswer: false,
          exitCode: null,
          errorMessage: verified.reason ?? '실행 전 확인에 실패했습니다.'
        }))
      }
    }
```

- [ ] **Step 4: 돌려서 통과를 확인한다**

Run: `pnpm test execution`
Expected: PASS

- [ ] **Step 5: 회귀 테스트가 진짜인지 확인한다**

`if (!verified.ok)` 블록을 잠시 지우고 돌린다. "verifyRunnable이 거부하면…"이 실패해야 한다. 되돌린다.

- [ ] **Step 6: 전체 테스트**

Run: `pnpm test && pnpm typecheck`

- [ ] **Step 7: 커밋**

```bash
git add core/execution.ts core/execution.test.ts
git commit -m "feat(execution): run the adapter's last-mile check before queueing"
```

---

## Task 6: MCP 설정 파일을 agent 종류별로 쓴다

OpenCode의 MCP 설정은 키 이름과 구조가 claude와 다르다.

**Files:**
- Modify: `core/mcp/configFile.ts`
- Modify: `core/mcp/host.ts`
- Modify: `core/execution.ts`
- Test: `core/mcp/configFile.test.ts`

**Interfaces:**
- Consumes: `AgentKind` (`@shared/models`), `McpConfigTarget` (기존)
- Produces: `writeMcpConfig(dir, runId, target, agentKind: AgentKind)`, `RunContext.agentKind: AgentKind`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`core/mcp/configFile.test.ts`에 더한다.

```ts
it('opencode는 mcp.<이름>에 type/local과 command 배열로 쓴다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'od-mcp-'))
  try {
    const file = writeMcpConfig(dir, 'run-1', {
      execPath: '/apps/one-desk',
      bridgePath: '/apps/bridge.mjs',
      url: 'http://127.0.0.1:5300/mcp',
      token: 'tok'
    }, 'opencode')
    const body = JSON.parse(readFileSync(file, 'utf8'))

    expect(body.mcpServers).toBeUndefined()
    const server = body.mcp[MCP_SERVER_NAME]
    expect(server.type).toBe('local')
    // claude는 command와 args가 따로지만 opencode는 배열 하나다.
    expect(server.command).toEqual(['/apps/one-desk', '/apps/bridge.mjs'])
    // env가 아니라 environment다.
    expect(server.environment.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(server.environment.ONE_DESK_MCP_TOKEN).toBe('tok')
    expect(server.enabled).toBe(true)
    // 기본 5초는 브리지가 한 번 더 중계하는 구조에 빠듯하다.
    expect(server.timeout).toBeGreaterThanOrEqual(30000)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('claude 형식은 그대로다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'od-mcp-'))
  try {
    const file = writeMcpConfig(dir, 'run-1', {
      execPath: '/apps/one-desk', bridgePath: '/apps/bridge.mjs',
      url: 'http://127.0.0.1:5300/mcp', token: 'tok'
    }, 'claude-code')
    const body = JSON.parse(readFileSync(file, 'utf8'))
    expect(body.mcp).toBeUndefined()
    expect(body.mcpServers[MCP_SERVER_NAME].args).toEqual(['/apps/bridge.mjs'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('두 형식 모두 0600으로 쓴다', () => {
  // 토큰이 들어 있다.
  const dir = mkdtempSync(join(tmpdir(), 'od-mcp-'))
  try {
    for (const kind of ['claude-code', 'opencode'] as const) {
      const file = writeMcpConfig(dir, `run-${kind}`, {
        execPath: '/a', bridgePath: '/b', url: 'u', token: 't'
      }, kind)
      expect(statSync(file).mode & 0o777).toBe(0o600)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: 돌려서 실패를 확인한다**

Run: `pnpm test configFile`
Expected: FAIL — 네 번째 인자를 받지 않는다

- [ ] **Step 3: `configFile.ts`를 고친다**

`writeMcpConfig`의 본문 조립을 두 함수로 가르고 인자를 하나 받는다.

```ts
import type { AgentKind } from '@shared/models'

function claudeBody(target: McpConfigTarget): string {
  return JSON.stringify({
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command: target.execPath,
        args: [target.bridgePath],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          ONE_DESK_MCP_URL: target.url,
          ONE_DESK_MCP_TOKEN: target.token
        }
      }
    }
  })
}

/**
 * OpenCode는 키 이름과 구조가 다르다 — `mcp`, `type: "local"`, `command`가
 * 배열이고 `env`가 `environment`다. 전송은 똑같이 stdio라 bridge.mjs는 그대로다.
 */
function opencodeBody(target: McpConfigTarget): string {
  return JSON.stringify({
    mcp: {
      [MCP_SERVER_NAME]: {
        type: 'local',
        command: [target.execPath, target.bridgePath],
        environment: {
          ELECTRON_RUN_AS_NODE: '1',
          ONE_DESK_MCP_URL: target.url,
          ONE_DESK_MCP_TOKEN: target.token
        },
        enabled: true,
        // 지정하지 않으면 기본 5초다. 브리지가 앱 안의 HTTP 서버로 한 번 더
        // 중계하는 구조라 여유를 둔다.
        timeout: 30_000
      }
    }
  })
}
```

`writeMcpConfig`의 시그니처와 본문 선택을 바꾼다.

```ts
export function writeMcpConfig(
  dir: string,
  runId: string,
  target: McpConfigTarget,
  agentKind: AgentKind
): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, `${runId}.json`)
  const body = agentKind === 'opencode' ? opencodeBody(target) : claudeBody(target)
  writeFileSync(file, body, { mode: 0o600 })
  chmodSync(file, 0o600)
  return file
}
```

파일 이름은 그대로 `${runId}.json`이라 `removeMcpConfig`·`clearMcpConfigs`는 손대지 않는다.

> **쓰기 실패를 삼키지 않는 것은 이미 되어 있다.** `writeMcpConfig`가 던지면
> `execution.ts`의 `mcp.prepare` try/catch가 run을 실패로 끝낸다("MCP 없이 조용히
> 진행하지 않는다"). 설계 §8이 요구하는 성질이 기존 코드에 이미 있으므로
> **그 catch를 없애거나 완화하지 말 것** — 없애면 opencode가 설정 없이 떠서
> 사용자의 `ask` 설정으로 되돌아간다.

- [ ] **Step 4: 호스트와 실행 서비스를 잇는다**

`core/mcp/host.ts`의 `RunContext`에 더한다.

```ts
export interface RunContext {
  runId: string
  workspaceId: string
  permission: Permission
  /** 설정 파일 형식이 CLI마다 다르다. */
  agentKind: AgentKind
}
```

`prepare` 안의 호출을 고친다.

```ts
      const configFile = writeMcpConfig(opts.configDir, ctx.runId, {
        execPath: opts.execPath,
        bridgePath: opts.bridgePath,
        url,
        token
      }, ctx.agentKind)
```

`core/execution.ts`의 `prepare` 호출에 더한다.

```ts
        const prepared = await opts.mcp.prepare({
          runId: created.id,
          workspaceId: spec.workspaceId,
          permission: spec.permission,
          agentKind: spec.agentKind
        })
```

- [ ] **Step 5: 돌려서 통과를 확인한다**

Run: `pnpm test configFile && pnpm test mcp && pnpm typecheck`
Expected: PASS. 타입 오류가 나면 `RunContext`를 만드는 다른 자리(테스트 포함)에 `agentKind`를 더한다.

- [ ] **Step 6: 회귀 테스트가 진짜인지 확인한다**

`opencodeBody`의 `command`를 claude처럼 문자열로 잠시 바꾸고 돌린다. opencode 형식 테스트가 실패해야 한다. 되돌린다.

- [ ] **Step 7: 전체 테스트**

Run: `pnpm test && pnpm typecheck && pnpm lint`

- [ ] **Step 8: 커밋**

```bash
git add core/mcp/configFile.ts core/mcp/configFile.test.ts core/mcp/host.ts core/execution.ts
git commit -m "feat(mcp): write the run config in the agent's own format"
```

---

## Task 7: 배선과 가짜 CLI

어댑터를 실제로 꽂고, 모델 없이 확인할 수 있는 가짜 CLI를 둔다.

**Files:**
- Modify: `core/index.ts`
- Create: `core/runner/fixtures/fake-opencode.mjs`
- Test: `core/runner/fixtures.test.ts`

**Interfaces:**
- Consumes: `opencodeAdapter` (Task 2·3·4)
- Produces: 없음 (배선)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`core/runner/fixtures.test.ts`에 더한다.

```ts
const FAKE_OPENCODE = resolve(HERE, 'fixtures/fake-opencode.mjs')

describe.skipIf(POSIX_ONLY)('fake-opencode.mjs', () => {
  it('실행 권한을 갖는다', () => {
    expect(statSync(FAKE_OPENCODE).mode & 0o111).toBeGreaterThan(0)
  })

  it('직접 실행하면 opencode 형식 NDJSON을 낸다', () => {
    const out = execFileSync(FAKE_OPENCODE, [], { input: '', encoding: 'utf8' })
    const lines = out.trim().split('\n')
    expect(lines.length).toBeGreaterThan(1)
    const first = JSON.parse(lines[0]!)
    expect(first).toMatchObject({ type: 'step_start' })
    expect(String(first.sessionID)).toMatch(/^ses/)
    // 마지막에 최종 텍스트가 있어야 result가 합성된다.
    expect(lines.some((l) => JSON.parse(l).type === 'text')).toBe(true)
  })
})
```

`core/index.test.ts`에 더한다.

```ts
import { createAdapters } from './index'

describe('createAdapters', () => {
  it('opencode는 OpenCode 어댑터를 쓴다', () => {
    // 임시 매핑(opencode → claudeCodeAdapter)이 남아 있으면 여기서 걸린다.
    // 배선 한 줄은 그 자체로 되돌릴 수 있는 변이다.
    expect(createAdapters()['opencode'].kind).toBe('opencode')
  })

  it('claude-code 매핑은 그대로다', () => {
    expect(createAdapters()['claude-code'].kind).toBe('claude-code')
  })
})
```

- [ ] **Step 2: 돌려서 실패를 확인한다**

Run: `pnpm test fixtures`
Expected: FAIL — `fake-opencode.mjs`가 없다

- [ ] **Step 3: 가짜 CLI를 만든다**

`core/runner/fixtures/fake-opencode.mjs`

```js
#!/usr/bin/env node
// 가짜 OpenCode. 실제 CLI의 NDJSON 형태만 흉내낸다 — 모델을 부르지 않는다.
// 서버 이름 같은 값을 리터럴로 박지 않는다: 과거에 fake-claude-mcp.mjs가
// `.mcpServers.onedesk`를 하드코딩해 상수 하나 바뀌자 e2e가 통째로 깨졌고,
// 단위 테스트는 전부 초록이었다.

const sessionId = 'ses_fake000000000000000000000'
const delay = Number(process.env.ONE_DESK_FAKE_DELAY_MS ?? 0)

// `opencode debug config` 흉내. verifyRunnable이 실행 직전에 이걸 부른다 —
// 여기서 NDJSON을 뱉으면 JSON.parse가 깨져 모든 run이 거부된다.
if (process.argv.includes('debug') && process.argv.includes('config')) {
  const permission = process.env.OPENCODE_PERMISSION
    ? JSON.parse(process.env.OPENCODE_PERMISSION)
    : {}
  process.stdout.write(JSON.stringify({ permission }))
  process.exit(0)
}

// Claude Code와 마찬가지로 stdin을 읽고 닫히기를 기다린다.
let prompt = ''
process.stdin.on('data', (chunk) => { prompt += chunk })
process.stdin.on('end', () => {
  const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`)
  const at = () => Date.now()

  emit({ type: 'step_start', timestamp: at(), sessionID: sessionId, part: { type: 'step-start' } })
  emit({
    type: 'tool_use', timestamp: at(), sessionID: sessionId,
    part: {
      type: 'tool', tool: 'read', callID: 'call-fake-1',
      state: {
        status: 'completed',
        input: { filePath: `${process.cwd()}/notes.txt` },
        output: '가짜 읽기 결과'
      }
    }
  })

  setTimeout(() => {
    emit({
      type: 'text', timestamp: at(), sessionID: sessionId,
      part: { type: 'text', text: `가짜 OpenCode가 처리했습니다: ${prompt.trim().slice(0, 40)}` }
    })
    emit({ type: 'step_finish', timestamp: at(), sessionID: sessionId, part: { type: 'step-finish', reason: 'stop' } })
    process.exit(0)
  }, delay)
})
```

실행 권한을 준다.

```bash
chmod +x core/runner/fixtures/fake-opencode.mjs
```

- [ ] **Step 4: 배선을 바꾼다**

`core/index.ts`

```ts
import { opencodeAdapter } from './runner/adapters/opencode'
```

`createCore` 밖으로 맵 조립을 꺼내 배선을 검증 가능하게 만든다.

```ts
/**
 * agent 종류 → 어댑터. **밖으로 꺼낸 이유는 테스트가 이 한 줄을 볼 수 있게
 * 하기 위해서다** — 배선(맵 한 줄)은 그 자체로 되돌릴 수 있는 변이이고,
 * 과거 두 단계에서 새어나간 자리는 예외 없이 이런 한 줄이었다.
 */
export function createAdapters(): Record<AgentKind, AgentAdapter> {
  return {
    'claude-code': claudeCodeAdapter,
    opencode: opencodeAdapter
  }
}
```

`createCore` 안에서는 그것을 부른다.

```ts
  const adapters = createAdapters()
```

임시 매핑을 설명하던 주석은 지운다. `verifyRunnable`을 실행 서비스에 잇는다.

```ts
    verifyRunnable: async (agentKind, input) => {
      const adapter = adapters[agentKind]
      return adapter.verifyRunnable ? adapter.verifyRunnable(input) : { ok: true }
    },
```

- [ ] **Step 5: 돌려서 통과를 확인한다**

Run: `pnpm test fixtures && pnpm test index`
Expected: PASS

- [ ] **Step 6: 전체 테스트와 경계 확인**

```bash
pnpm test && pnpm typecheck && pnpm lint
grep -rn "from 'electron'" core/                        # 출력 없어야 함
grep -rn "window.oneDesk" renderer/ | grep -v main.tsx  # 출력 없어야 함
```

- [ ] **Step 7: 커밋**

```bash
git add core/index.ts core/runner/fixtures/fake-opencode.mjs core/runner/fixtures.test.ts
git commit -m "feat(core): wire the OpenCode adapter and add a fake CLI fixture"
```

---

## Task 8: 실행 패널에서 agent를 고른다

여기까지 해도 `RunPanel`이 `agentKind: 'claude-code'`를 리터럴로 박아 넘기고 있어 **OpenCode를 쓸 방법이 없다.** 설계 문서가 UI를 다루지 않았으므로 여기서 최소한만 연다.

**Files:**
- Modify: `renderer/components/RunPanel.tsx`
- Test: `renderer/components/RunPanel.test.tsx`

**Interfaces:**
- Consumes: `Workspace.defaultAgentKind` (기존 스키마), `conversation.last.agentKind`
- Produces: 없음 (UI)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`renderer/components/RunPanel.test.tsx`의 `makeWorkspace`가 `defaultAgentKind`를 리터럴로 박고 있다. 인자를 하나 더 받게 고친다.

```ts
function makeWorkspace(
  defaultPermission: Permission,
  defaultAgentKind: AgentKind = 'claude-code'
): Workspace {
  return {
    id: 'w1', name: 'ws', description: null, defaultAgentKind,
    defaultModelClaude: null, defaultModelOpencode: null, defaultPermission,
    claudePath: null, opencodePath: null, createdAt: 0, updatedAt: 0
  }
}
```

그리고 테스트를 더한다. `renderPanel(client, panelRepos, chips, onStarted, resumeOpts, workspaces)` 순서에 주의한다. 이 파일의 이웃 테스트가 쓰는 조회 방식을 그대로 따른다 — 프롬프트는 `findByPlaceholderText(/무엇을 시킬지/)`, 드롭다운은 `getByLabelText`다.

```ts
it('workspace 기본값을 agent로 쓴다', async () => {
  const start = vi.fn().mockResolvedValue({ id: 'run-1' })
  const client = makeClient({ start })
  renderPanel(client, repos, [], vi.fn(), {}, [makeWorkspace('edit', 'opencode')])

  await userEvent.type(await screen.findByPlaceholderText(/무엇을 시킬지/), '뭐든')
  await userEvent.click(screen.getByRole('button', { name: '실행' }))

  expect(start).toHaveBeenCalledWith(expect.objectContaining({ agentKind: 'opencode' }))
})

it('agent를 바꾸면 그 run에만 적용된다', async () => {
  // 권한과 같은 규칙이다 — 선택은 그 run에만 적용된다 (전체 설계 §386).
  const start = vi.fn().mockResolvedValue({ id: 'run-1' })
  const client = makeClient({ start })
  renderPanel(client, repos, [], vi.fn(), {}, [makeWorkspace('edit', 'claude-code')])

  await userEvent.selectOptions(screen.getByLabelText('agent'), 'opencode')
  await userEvent.type(await screen.findByPlaceholderText(/무엇을 시킬지/), '뭐든')
  await userEvent.click(screen.getByRole('button', { name: '실행' }))

  expect(start).toHaveBeenCalledWith(expect.objectContaining({ agentKind: 'opencode' }))
})

it('대화를 이어갈 때는 원본의 agent로 잠긴다', async () => {
  // 세션은 특정 CLI가 특정 디렉토리에서 만든 것이라 다른 조합으로 이어받을 수
  // 없다 (전체 설계 §362).
  const opencodeParent: Run = {
    id: 'p9', workspaceId: 'w1', agentKind: 'opencode', model: null,
    cwd: '/tmp/api', permission: 'edit', userPrompt: '원래 지시', assembledPrompt: 'x',
    status: 'succeeded', externalSessionId: 'ses_1', parentRunId: null, rootRunId: 'p9',
    resultText: null, needsAnswer: false, timeoutMs: null, exitCode: 0,
    errorMessage: null, logPath: '/tmp/x', reviewedAt: null, reviewedKind: null,
    startedAt: 1, endedAt: 2, createdAt: 0, contextItems: []
  }
  const opencodeConversation = groupConversations([opencodeParent])[0]!

  renderPanel(makeClient(), repos, [], vi.fn(), { conversation: opencodeConversation },
    [makeWorkspace('edit', 'claude-code')])

  await waitFor(() => expect(screen.getByLabelText('agent')).toHaveValue('opencode'))
  expect(screen.getByLabelText('agent')).toBeDisabled()
})
```

- [ ] **Step 2: 돌려서 실패를 확인한다**

Run: `pnpm test RunPanel`
Expected: FAIL — agent combobox가 없다

- [ ] **Step 3: 구현한다**

`RunPanel.tsx`에 권한 드롭다운과 같은 모양으로 더한다.

```tsx
const [agentKind, setAgentKind] = useState<AgentKind>('claude-code')

// 권한과 같은 규칙이다 — workspace 기본값에서 시작하고, 선택은 그 run에만 적용된다.
// 대화를 이어갈 때는 원본의 agent가 우선이다: 세션은 특정 CLI가 만든 것이라
// 다른 CLI로 이어받을 수 없다 (전체 설계 §362).
useEffect(() => {
  if (conversation) setAgentKind(conversation.last.agentKind)
  else if (workspace) setAgentKind(workspace.defaultAgentKind)
}, [workspace, conversation])
```

```tsx
<label>
  agent
  <select
    value={agentKind}
    disabled={Boolean(conversation)}
    onChange={(e) => setAgentKind(e.target.value as AgentKind)}
  >
    <option value="claude-code">Claude Code</option>
    <option value="opencode">OpenCode</option>
  </select>
</label>
```

130행의 `agentKind: 'claude-code'`를 `agentKind`로 바꾼다.

- [ ] **Step 4: 돌려서 통과를 확인한다**

Run: `pnpm test RunPanel`
Expected: PASS

- [ ] **Step 5: 회귀 테스트가 진짜인지 확인한다**

`agentKind`를 다시 `'claude-code'` 리터럴로 잠시 되돌리고 돌린다. 두 테스트가 실패해야 한다. 되돌린다.

- [ ] **Step 6: 전체 테스트와 경계 확인**

```bash
pnpm test && pnpm typecheck && pnpm lint
grep -rn "window.oneDesk" renderer/ | grep -v main.tsx  # 출력 없어야 함
```

- [ ] **Step 7: 커밋**

```bash
git add renderer/components/RunPanel.tsx renderer/components/RunPanel.test.tsx
git commit -m "feat(renderer): pick the agent per run instead of hardcoding claude-code"
```

---

## Task 9: 문서 갱신

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-08-07-one-desk-design.md`

- [ ] **Step 1: 전체 설계의 §346을 정정한다**

설계 문서 §11이 요구한 그대로다. `2026-08-07-one-desk-design.md`의 §346 문단 뒤에 다음을 덧붙인다.

```markdown
> **2026-09-06 실측으로 해소됨.** 병합된다 — `permission` 안에서 키 단위로 합쳐진다.
> 게다가 `OPENCODE_CONFIG`는 run의 cwd에 있는 `opencode.json`을 이기지 못하고,
> `"*"`는 구체 키를 이기지 못한다. 그래서 **권한은 `OPENCODE_PERMISSION` 환경변수로
> 넘긴다** — 그것만이 프로젝트 설정을 이긴다. 알려진 키 15개를 전부 명시하고,
> 그럼에도 남는 `ask`는 실행 직전 검사가 잡는다.
> 자세한 근거는 `2026-09-06-opencode-adapter-design.md` §2·§3.
```

- [ ] **Step 2: `CLAUDE.md`를 갱신한다**

"현재 상태" 문단에 OpenCode 어댑터가 붙었음을 적고, "밟으면 조용히 깨지는 것들"에 다음 셋을 더한다.

```markdown
**OpenCode는 설정을 병합하고, 우리가 이길 수 없는 자리가 있다.** 우선순위는
`OPENCODE_PERMISSION` 환경변수 > 프로젝트 `opencode.json` > `OPENCODE_CONFIG`가
가리키는 파일 > 전역 설정이고, `permission` 안에서 키 단위로 합쳐진다. **`"*"`는
구체 키를 이기지 못한다.** 그래서 권한은 파일이 아니라 환경변수로 넘기고 알려진
키 15개를 전부 명시한다 — 이름을 대지 않은 키는 남의 설정 값이 그대로 산다.

**OpenCode는 설정이 잘못돼도 조용히 무시한다.** `OPENCODE_CONFIG`가 없는 파일을
가리켜도, 인라인 JSON을 넣어도, `OPENCODE_PERMISSION`이 깨진 JSON이어도 종료 코드
0으로 사용자 설정에 그대로 되돌아간다. 셋 다 증상이 같다 — 헤드리스 실행이 아무
말 없이 영원히 멈추고 동시 실행 슬롯을 계속 점유한다. `verifyRunnable`이 실행
직전에 해결된 설정을 다시 읽어 `ask`가 남았는지 보는 이유다.

**OpenCode의 `tool_use`는 이미 끝난 도구를 보고한다.** `part.state.status`가
`completed`이고 출력까지 함께 온다. 그래서 전체 설계 §553의 "쓰기 도구 호출을
감지하면 원본을 복사한다"가 OpenCode에서는 성립하지 않는다 — 복사할 시점에 원본이
이미 없다. diff 뷰어 설계에서 정면으로 다뤄야 한다.
```

문서 표에 새 설계·계획 두 줄을 더한다.

- [ ] **Step 3: 커밋**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-08-07-one-desk-design.md
git commit -m "docs: record the OpenCode config merge rules and their consequences"
```

---

## 마무리

- [ ] `pnpm test && pnpm typecheck && pnpm lint`가 전부 초록
- [ ] `pnpm test:e2e`가 초록 (`pnpm dev`와 동시에 돌리지 않는다)
- [ ] 경계 확인 두 줄이 빈 출력
- [ ] 계획의 체크박스가 전부 채워짐
