#!/usr/bin/env node
/**
 * MCP stdio ↔ HTTP 브리지.
 *
 * claude가 이 파일을 자식 프로세스로 띄우고 stdin/stdout으로 JSON-RPC를
 * 주고받는다. 우리는 그것을 앱 안의 MCP 서버로 HTTP로 중계한다.
 *
 * **왜 있는가:** 사내 프록시가 잡힌 환경에서 claude의 HTTP 클라이언트가
 * 루프백 요청까지 프록시로 보내 403으로 막혔다. Node의 http/fetch는
 * HTTP_PROXY를 자동으로 쓰지 않으므로(명시적으로 에이전트를 붙여야 탄다)
 * 같은 주소인데도 여기서는 통한다. stdio 구간에는 네트워크가 아예 없다.
 *
 * **멍청한 파이프다.** JSON-RPC를 해석하지 않는다 — 줄을 받아 그대로 넘기고
 * 응답을 그대로 돌려준다. 권한·도구 등록은 전부 서버가 한다.
 */
import { createInterface } from 'node:readline'

const url = process.env.ONE_DESK_MCP_URL
const token = process.env.ONE_DESK_MCP_TOKEN

if (!url || !token) {
  process.stderr.write('[one-desk] ONE_DESK_MCP_URL과 ONE_DESK_MCP_TOKEN이 필요합니다.\n')
  process.exit(1)
}

/** JSON-RPC 오류 한 건. id가 없으면(알림) 돌려줄 곳이 없으므로 null을 준다. */
function errorFor(id, message) {
  if (id === undefined || id === null) return null
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } })
}

async function forward(line) {
  let id
  try {
    id = JSON.parse(line).id
  } catch {
    // 파싱조차 안 되면 어느 요청의 응답인지 알 수 없다. 조용히 버린다.
    return null
  }

  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // 서버(StreamableHTTPServerTransport)는 이 두 가지를 모두 요구한다.
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`
      },
      body: line
    })
  } catch (err) {
    // 앱이 닫혔거나 포트가 죽었다. 매달리게 두지 않고 오류로 끝낸다.
    return errorFor(id, `one-desk에 연결하지 못했습니다: ${err.message}`)
  }

  // 알림은 202와 빈 본문으로 온다 — 돌려줄 것이 없다.
  if (res.status === 202) return null
  const text = await res.text()
  if (!res.ok) return errorFor(id, `one-desk가 ${res.status}를 돌려줬습니다: ${text.slice(0, 200)}`)

  // 응답은 SSE로 온다. data: 줄에 JSON-RPC 메시지가 들어 있다.
  // 순수 JSON으로 오는 경우도 대비해 둘 다 받는다.
  const data = text.split('\n').find((l) => l.startsWith('data:'))
  return data ? data.slice(5).trim() : text.trim()
}

// 요청은 순서대로 처리한다. 동시에 흘리면 stdout에서 줄이 섞일 수 있고,
// 얻는 것(약간의 지연 감소)이 잃는 것보다 작다.
let chain = Promise.resolve()
createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return
  chain = chain.then(async () => {
    const out = await forward(line)
    if (out) process.stdout.write(`${out}\n`)
  })
})
