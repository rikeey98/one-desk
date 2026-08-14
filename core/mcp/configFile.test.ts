import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { MCP_SERVER_NAME, writeMcpConfig, removeMcpConfig, clearMcpConfigs } from './configFile'

let dir: string

/**
 * Windows에는 POSIX 권한 비트가 없다. chmod는 읽기 전용 플래그만 건드리고
 * statSync().mode는 늘 0o666 계열을 돌려주므로 0600 단언이 성립하지 않는다.
 *
 * **이 스킵은 Windows에서 토큰 파일이 권한으로 보호되지 않는다는 뜻이다.**
 * 그곳에서는 사용자별 임시 디렉토리의 ACL에 기대고 있다.
 */
const POSIX_ONLY = process.platform === 'win32'

/** stdio 설정의 고정 부분. 테스트마다 url/token만 바꾼다. */
function target(over: { url?: string; token?: string } = {}) {
  return {
    execPath: '/fake/electron',
    bridgePath: '/fake/bridge.mjs',
    url: over.url ?? 'http://127.0.0.1:1/mcp',
    token: over.token ?? 'tok'
  }
}

beforeEach(() => { dir = mkdtempSync(resolve(tmpdir(), 'one-desk-mcpcfg-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('writeMcpConfig', () => {
  it.skipIf(POSIX_ONLY)('소유자만 읽을 수 있는 파일을 만든다', () => {
    // 이 파일에 토큰이 그대로 들어 있다. 다른 사용자가 읽으면 workspace가 열린다.
    const file = writeMcpConfig(join(dir, 'mcp'), 'run-1', target({ url: 'http://127.0.0.1:1/mcp', token: 'tok' }))
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('CLI가 읽는 형식으로 토큰을 담는다', () => {
    const file = writeMcpConfig(join(dir, 'mcp'), 'run-1', target({ url: 'http://127.0.0.1:9/mcp', token: 'tok-abc' }))
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    // MCP_SERVER_NAME으로 접근한다 — 리터럴 'onedesk'를 쓰면 상수가 바뀌어도
    // 이 테스트는 여전히 초록이라 설정 파일의 키와 --allowedTools의 접두사가
    // 갈라지는 것을 못 잡는다 (전 브랜치 리뷰 I-1).
    // stdio 전송이다 — claude가 브리지를 자식 프로세스로 띄운다. HTTP였을 때는
    // 사내 프록시가 루프백 요청을 403으로 막아 이 환경에서 아예 붙지 못했다.
    expect(parsed.mcpServers[MCP_SERVER_NAME]).toEqual({
      command: '/fake/electron',
      args: ['/fake/bridge.mjs'],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        ONE_DESK_MCP_URL: 'http://127.0.0.1:9/mcp',
        ONE_DESK_MCP_TOKEN: 'tok-abc'
      }
    })
    // mcpServers에 다른 키가 섞여 있지 않은지도 함께 본다.
    expect(Object.keys(parsed.mcpServers)).toEqual([MCP_SERVER_NAME])
  })

  it.skipIf(POSIX_ONLY)('mode 옵션만으로는 안 되는 경우까지 chmodSync로 0600을 강제한다', () => {
    // writeFileSync의 mode는 파일을 "새로" 만들 때만 적용된다. 이미 존재하는
    // (예: 이전 비정상 종료가 남긴) 파일을 다시 쓰면 mode 옵션은 무시되고
    // 기존 권한이 그대로 남는다 — chmodSync가 없으면 이 테스트가 빨개진다.
    const mcpDir = join(dir, 'mcp')
    const file = join(mcpDir, 'run-2.json')
    mkdirSync(mcpDir, { recursive: true })
    writeFileSync(file, '{}', { mode: 0o644 })
    chmodSync(file, 0o644)
    expect(statSync(file).mode & 0o777).toBe(0o644)

    writeMcpConfig(mcpDir, 'run-2', target({ url: 'http://127.0.0.1:1/mcp', token: 'tok' }))
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('removeMcpConfig가 지우고, 없어도 던지지 않는다', () => {
    const mcpDir = join(dir, 'mcp')
    const file = writeMcpConfig(mcpDir, 'run-1', target({ url: 'http://127.0.0.1:1/mcp', token: 'tok' }))
    removeMcpConfig(mcpDir, 'run-1')
    expect(existsSync(file)).toBe(false)
    expect(() => removeMcpConfig(mcpDir, 'run-1')).not.toThrow()
  })

  it('clearMcpConfigs가 디렉토리째 치운다', () => {
    const mcpDir = join(dir, 'mcp')
    writeMcpConfig(mcpDir, 'a', target({ url: 'http://127.0.0.1:1/mcp', token: 't' }))
    writeMcpConfig(mcpDir, 'b', target({ url: 'http://127.0.0.1:1/mcp', token: 't' }))
    clearMcpConfigs(mcpDir)
    expect(existsSync(mcpDir)).toBe(false)
  })
})
