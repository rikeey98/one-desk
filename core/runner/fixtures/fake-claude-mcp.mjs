#!/usr/bin/env node
// --mcp-config로 받은 설정 파일을 읽어 실제 MCP 호출로 이슈를 만든다.
// 진짜 Claude Code가 하는 일 중 우리가 검증하고 싶은 부분만 흉내낸다.
//
// `ONE_DESK_FAKE_MCP_CALL`(JSON `{ name, arguments }`)이 있으면 그 도구를 부른다 — 없으면 지금의 create_issue 그대로다
// (mcp.e2e가 기댄다). `{ "name": "propose_issue", "existing": "first", ... }`이면 list_issues를 먼저 불러 첫 열린 이슈를
// existingIssueId로 준다(e2e가 이슈 id를 환경변수로 미리 넣을 수 없다 — docs/sdlc/agent-proposals/ plan 9단계).
// `ONE_DESK_PROMPT_CAPTURE`가 있으면 받은 프롬프트를 남긴다(fake-claude.mjs와 같다).
import { readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

process.stdin.resume()
let receivedPrompt = ''
process.stdin.on('data', (chunk) => { receivedPrompt += chunk.toString() })
process.stdin.on('end', () => {
  if (process.env.ONE_DESK_PROMPT_CAPTURE) writeFileSync(process.env.ONE_DESK_PROMPT_CAPTURE, receivedPrompt)
})

const custom = process.env.ONE_DESK_FAKE_MCP_CALL ? JSON.parse(process.env.ONE_DESK_FAKE_MCP_CALL) : null

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

  // **진짜 claude가 하는 그대로 한다** — 브리지를 자식 프로세스로 띄우고
  // stdio로 JSON-RPC를 주고받는다. HTTP로 직접 부르면 브리지가 통째로
  // 검증에서 빠지는데, 지금은 그게 실행 경로의 전부다.
  const callTool = (name, args) => new Promise((done, fail) => {
    const child = spawn(cfg.command, cfg.args, { env: { ...process.env, ...cfg.env } })
    let buf = ''
    const timer = setTimeout(() => fail(new Error('브리지가 응답하지 않았다')), 15000)
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      const nl = buf.indexOf('\n')
      if (nl === -1) return
      clearTimeout(timer)
      const line = buf.slice(0, nl)
      child.kill()
      try { done(JSON.parse(line)) } catch (err) { fail(err) }
    })
    child.on('error', fail)
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name, arguments: args }
    })}\n`)
  })

  let message
  if (custom) {
    const args = { ...(custom.arguments ?? {}) }
    if (custom.existing === 'first') {
      const listed = await callTool('list_issues', {})
      const open = JSON.parse(listed.result.content[0].text).find((i) => i.status !== 'done')
      args.existingIssueId = open.id
    }
    message = await callTool(custom.name, args)
  } else {
    message = await callTool('create_issue', { title: 'agent가 만든 이슈', body: 'MCP 경유' })
  }

  const ok = Boolean(message.result) && message.result.isError !== true

  emit({
    type: 'result', subtype: ok ? 'success' : 'error', is_error: !ok,
    result: ok ? (custom ? `MCP로 ${custom.name}을 불렀다` : 'MCP로 이슈를 만들었다') : `MCP 실패: ${JSON.stringify(message).slice(0, 200)}`,
    session_id: 'fake-mcp-session'
  })
  process.exitCode = ok ? 0 : 1
  process.stdin.pause()
}

void main()
