/**
 * MCP 서버에 JSON-RPC 요청 하나를 보낸다.
 *
 * 응답은 SSE(text/event-stream)로 온다 — 실측 확인됨. `data:` 줄에서 JSON-RPC
 * 메시지를 꺼낸다. 순수 JSON으로 오는 경우도 대비해 둘 다 받아들인다.
 */
export async function rpc(
  url: string, token: string | null, body: unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 테스트 헬퍼: JSON-RPC 응답 모양이 호출부마다 다르다
): Promise<{ status: number; json: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  })
  if (res.status !== 200) return { status: res.status, json: null }
  const text = await res.text()
  const line = text.split('\n').find((l) => l.startsWith('data:'))
  return { status: 200, json: JSON.parse(line ? line.slice(5).trim() : text) }
}
