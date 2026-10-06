/**
 * 추가 칸에 쓴 글을 제목과 본문으로 가른다 — **첫 줄이 제목, 나머지가 본문**이다(Apple 메모 방식, 2026-10-03 결정).
 *
 * 제목을 먼저 짓기 어려워 내용부터 쓰는 사람을 위한 것이다. 한 줄만 쓰면 지금처럼 제목만 있는 항목이다.
 * 제목을 비워 두지 않는다 — 목록 줄·훑기·대화 제목(할당된 이슈)·MCP `list_issues`가 제목만 본다.
 *
 * - 첫 줄이 길어도 자르지 않는다. 자르면 글이 잘리거나 본문에 같은 글이 두 번 들어간다. 목록은 말줄임으로 보인다.
 * - 첫 줄 앞의 마크다운 제목 표시(`# `)는 뗀다 — 본문은 마크다운으로 읽히므로 `# 제목`으로 시작하는 사람이 있다.
 * - 본문 앞의 빈 줄은 걷는다. 본문 안의 줄바꿈·들여쓰기는 그대로다.
 */
export function splitTitleBody(text: string): { title: string; body: string } {
  const trimmed = text.replace(/\r\n?/g, '\n').trim()
  const at = trimmed.indexOf('\n')
  const firstLine = (at < 0 ? trimmed : trimmed.slice(0, at)).trim()
  const rest = at < 0 ? '' : trimmed.slice(at + 1)
  const title = firstLine.replace(/^#{1,6}[ \t]+/, '').trim() || firstLine
  const body = rest.replace(/^(?:[ \t]*\n)+/, '')
  return { title, body }
}
