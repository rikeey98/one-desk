#!/usr/bin/env node
// --mcp-config로 받은 설정 파일을 읽어 실제 MCP 호출로 이슈를 만든다.
// 진짜 Claude Code가 하는 일 중 우리가 검증하고 싶은 부분만 흉내낸다.
import { readFileSync } from 'node:fs'

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

process.stdin.resume()
process.stdin.on('data', () => {})

// indexOf가 못 찾으면 -1을 주는데 +1을 그대로 더하면 0이 되어 argv[0](node
// 실행 파일 경로)을 집어온다 — 그 값은 항상 참(truthy)이라 아래 !configPath
// 가드가 무력해지고, 그 "경로"를 JSON으로 읽으려다 알아보기 힘든 파싱 에러로
// 죽는다. 플래그가 없는 경우를 명시적으로 null로 떨어뜨려야 방어가 산다.
const mcpConfigFlagIndex = process.argv.indexOf('--mcp-config')
const configPath = mcpConfigFlagIndex === -1 ? null : process.argv[mcpConfigFlagIndex + 1]

emit({ type: 'system', subtype: 'init', session_id: 'fake-mcp-session' })

async function main() {
  if (!configPath) {
    emit({ type: 'result', subtype: 'error', is_error: true, result: '--mcp-config가 없다', session_id: 'fake-mcp-session' })
    process.exitCode = 1
    process.stdin.pause()
    return
  }

  // 서버 이름을 리터럴로 쓰지 않는다. writeMcpConfig는 항상 서버 하나만 쓰므로
  // 유일한 값을 집는다 — 이름을 'onedesk'로 박아 뒀다가 MCP_SERVER_NAME이
  // 바뀌자 cfg가 undefined가 되어 e2e가 통째로 깨진 적이 있다.
  const cfg = Object.values(JSON.parse(readFileSync(configPath, 'utf8')).mcpServers)[0]
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...cfg.headers
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'create_issue', arguments: { title: 'agent가 만든 이슈', body: 'MCP 경유' } }
    })
  })

  const text = await res.text()
  const line = text.split('\n').find((l) => l.startsWith('data:'))
  const message = JSON.parse(line ? line.slice(5).trim() : text)
  const ok = res.status === 200 && message.result && message.result.isError !== true

  emit({
    type: 'result', subtype: ok ? 'success' : 'error', is_error: !ok,
    result: ok ? 'MCP로 이슈를 만들었다' : `MCP 실패: ${res.status} ${text.slice(0, 200)}`,
    session_id: 'fake-mcp-session'
  })
  process.exitCode = ok ? 0 : 1
  process.stdin.pause()
}

void main()
