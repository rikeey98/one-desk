import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, statSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { writeMcpConfig, removeMcpConfig, clearMcpConfigs } from './configFile'

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
    expect(parsed.mcpServers.onedesk).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:9/mcp',
      headers: { Authorization: 'Bearer tok-abc' }
    })
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
