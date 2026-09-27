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
 * **멍청한 파이프다.** 줄을 받아 그대로 넘기고 응답을 그대로 돌려준다. 권한·도구
 * 등록은 전부 서버가 한다. JSON-RPC를 들여다보는 것은 SSE 본문에서 **요청 id에 맞는
 * 응답을 고를 때** 하나뿐이다(`pickResponse`).
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

/**
 * SSE 본문을 이벤트별 data로 가른다. 한 이벤트의 data 줄이 여럿이면 줄바꿈으로 잇고
 * (SSE 규칙), 빈 줄이 이벤트를 끝낸다. CRLF도 받는다.
 */
function sseData(text) {
  const out = []
  let lines = []
  for (const raw of text.split(/\r?\n/)) {
    if (raw === '') {
      if (lines.length > 0) out.push(lines.join('\n'))
      lines = []
      continue
    }
    if (!raw.startsWith('data:')) continue
    // "data:" 뒤의 공백 한 칸은 구분자다(SSE 규칙).
    lines.push(raw.slice(5).replace(/^ /, ''))
  }
  if (lines.length > 0) out.push(lines.join('\n'))
  return out
}

/**
 * 요청 id에 대한 응답을 SSE data들 중에서 고른다 (`docs/sdlc/conversation-fixes/` spec
 * FR-20). **첫 data 줄이 응답이라는 보장이 없다** — 스트림은 응답 전에 알림(진행 상황·
 * 로그)이나 서버발 요청을 흘릴 수 있고, 그것을 응답으로 돌려주면 claude는 진짜 답을 영영
 * 못 받는다. 응답은 `id`가 같고 `method`가 없는 메시지다 — 서버발 요청은 id를 서버가
 * 매기므로 숫자가 겹칠 수 있다. 맞는 것이 없으면 undefined.
 *
 * 고른 메시지는 **다시 직렬화해** 돌려준다. stdio 쪽은 줄 하나가 메시지 하나인데, SSE는
 * data를 여러 줄에 걸쳐 실을 수 있어 원문을 그대로 쓰면 메시지가 줄 중간에서 끊긴다.
 *
 * 브리지가 JSON-RPC를 들여다보는 유일한 자리다. 권한·도구는 여전히 서버의 몫이다.
 */
function pickResponse(datas, id) {
  for (const data of datas) {
    let msg
    try {
      msg = JSON.parse(data)
    } catch {
      continue
    }
    if (msg && typeof msg === 'object' && !('method' in msg) && msg.id === id) return JSON.stringify(msg)
  }
  return undefined
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
  const datas = sseData(text)
  if (datas.length === 0) return text.trim()
  // id 없는 요청(알림)은 돌려받을 응답이 없다 — 지금대로 첫 메시지를 넘긴다.
  if (id === undefined || id === null) return datas[0].trim()
  return pickResponse(datas, id)
    ?? errorFor(id, `one-desk의 응답에서 요청 id ${JSON.stringify(id)}에 맞는 메시지를 찾지 못했습니다.`)
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
