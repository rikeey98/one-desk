/**
 * 본문 맨 앞의 YAML frontmatter(`---` … `---`)를 떼어 낸다 (docs/sdlc/item-windows/ FR-20).
 *
 * SKILL.md·agent 파일은 frontmatter로 시작하는데, 마크다운으로 그대로 그리면 첫 `---`는 가로줄이 되고 그 안의
 * `name: …`·`description: …`는 닫는 `---` 때문에 setext 제목(h2)이 된다 — 읽기 화면 맨 위에 큰 제목 한 줄로
 * 뭉개진다. 읽기 화면은 그것을 따로 평문 칸에 둔다. **표시만이다** — 저장하는 값은 손대지 않는다.
 */
export function splitFrontmatter(text: string): { front: string | null; rest: string } {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (!m) return { front: null, rest: text }
  return { front: m[1] ?? '', rest: text.slice(m[0].length) }
}
