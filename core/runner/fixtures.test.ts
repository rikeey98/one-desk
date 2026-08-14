import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const FAKE = resolve(HERE, 'fixtures/fake-claude.mjs')
const FAKE_MCP = resolve(HERE, 'fixtures/fake-claude-mcp.mjs')

/**
 * 이 픽스처들은 shebang이 달린 .mjs 파일이고, e2e가 실행 파일로 직접 spawn한다.
 * Windows에는 실행 비트도 shebang 실행도 없어 두 검사 모두 성립하지 않는다.
 * e2e(`pnpm test:e2e`)는 개발 장비에서만 도는 것이 전제이므로 여기서 스킵한다.
 */
const POSIX_ONLY = process.platform === 'win32'

describe.skipIf(POSIX_ONLY)('fake-claude-mcp.mjs', () => {
  it('실행 권한을 갖는다', () => {
    // 앱은 이 파일을 executable로 spawn한다. preflight의 access(X_OK)가 먼저 막는다.
    expect(statSync(FAKE_MCP).mode & 0o111).toBeGreaterThan(0)
  })
})

describe.skipIf(POSIX_ONLY)('fake-claude.mjs', () => {
  it('실행 권한을 갖는다', () => {
    // 앱은 이 파일을 executable로 spawn한다. preflight의 access(X_OK)가 먼저 막는다.
    expect(statSync(FAKE).mode & 0o111).toBeGreaterThan(0)
  })

  it('직접 실행하면 stream-json을 낸다', () => {
    const out = execFileSync(FAKE, [], { input: '', encoding: 'utf8' })
    const lines = out.trim().split('\n')
    expect(lines.length).toBeGreaterThan(1)
    expect(JSON.parse(lines[0]!)).toMatchObject({ type: 'system', subtype: 'init' })
  })

  it('ONE_DESK_FAKE_DELAY_MS만큼 결과를 늦춘다', () => {
    // e2e가 running 상태를 관찰하려면 즉시 끝나면 안 된다.
    const started = Date.now()
    execFileSync(FAKE, [], {
      input: '', encoding: 'utf8',
      env: { ...process.env, ONE_DESK_FAKE_DELAY_MS: '300' }
    })
    expect(Date.now() - started).toBeGreaterThanOrEqual(300)
  })
})
