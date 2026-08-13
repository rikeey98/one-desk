import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { MCP_SERVER_NAME, writeMcpConfig, removeMcpConfig, clearMcpConfigs } from './configFile'

let dir: string

beforeEach(() => { dir = mkdtempSync(resolve(tmpdir(), 'one-desk-mcpcfg-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('writeMcpConfig', () => {
  it('소유자만 읽을 수 있는 파일을 만든다', () => {
    // 이 파일에 토큰이 그대로 들어 있다. 다른 사용자가 읽으면 workspace가 열린다.
    const file = writeMcpConfig(join(dir, 'mcp'), 'run-1', 'http://127.0.0.1:1/mcp', 'tok')
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('CLI가 읽는 형식으로 토큰을 담는다', () => {
    const file = writeMcpConfig(join(dir, 'mcp'), 'run-1', 'http://127.0.0.1:9/mcp', 'tok-abc')
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    // MCP_SERVER_NAME으로 접근한다 — 리터럴 'onedesk'를 쓰면 상수가 바뀌어도
    // 이 테스트는 여전히 초록이라 설정 파일의 키와 --allowedTools의 접두사가
    // 갈라지는 것을 못 잡는다 (전 브랜치 리뷰 I-1).
    expect(parsed.mcpServers[MCP_SERVER_NAME]).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:9/mcp',
      headers: { Authorization: 'Bearer tok-abc' }
    })
    // mcpServers에 다른 키가 섞여 있지 않은지도 함께 본다.
    expect(Object.keys(parsed.mcpServers)).toEqual([MCP_SERVER_NAME])
  })

  it('mode 옵션만으로는 안 되는 경우까지 chmodSync로 0600을 강제한다', () => {
    // writeFileSync의 mode는 파일을 "새로" 만들 때만 적용된다. 이미 존재하는
    // (예: 이전 비정상 종료가 남긴) 파일을 다시 쓰면 mode 옵션은 무시되고
    // 기존 권한이 그대로 남는다 — chmodSync가 없으면 이 테스트가 빨개진다.
    const mcpDir = join(dir, 'mcp')
    const file = join(mcpDir, 'run-2.json')
    mkdirSync(mcpDir, { recursive: true })
    writeFileSync(file, '{}', { mode: 0o644 })
    chmodSync(file, 0o644)
    expect(statSync(file).mode & 0o777).toBe(0o644)

    writeMcpConfig(mcpDir, 'run-2', 'http://127.0.0.1:1/mcp', 'tok')
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('removeMcpConfig가 지우고, 없어도 던지지 않는다', () => {
    const mcpDir = join(dir, 'mcp')
    const file = writeMcpConfig(mcpDir, 'run-1', 'http://127.0.0.1:1/mcp', 'tok')
    removeMcpConfig(mcpDir, 'run-1')
    expect(existsSync(file)).toBe(false)
    expect(() => removeMcpConfig(mcpDir, 'run-1')).not.toThrow()
  })

  it('clearMcpConfigs가 디렉토리째 치운다', () => {
    const mcpDir = join(dir, 'mcp')
    writeMcpConfig(mcpDir, 'a', 'http://127.0.0.1:1/mcp', 't')
    writeMcpConfig(mcpDir, 'b', 'http://127.0.0.1:1/mcp', 't')
    clearMcpConfigs(mcpDir)
    expect(existsSync(mcpDir)).toBe(false)
  })
})
