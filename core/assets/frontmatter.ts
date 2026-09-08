/**
 * SKILL.md / agent 파일 머리의 `---` 블록에서 `name`과 `description`만 뽑는다.
 *
 * **YAML 파서가 아니다.** 두 필드를 읽자고 의존성을 더하지 않기로 했다(설계 §4).
 * 실측한 네 모양만 다룬다 — 한 줄, 따옴표 한 줄, 들여쓰기로 이어지는 여러 줄,
 * `>`/`|` 블록 지시자. 나머지 키와 중첩 구조는 무시한다.
 *
 * 못 읽으면 null을 준다. 호출자가 파일명으로 대신한다(설계 §4).
 */
export function parseFrontmatter(
  text: string
): { name: string | null; description: string | null } {
  const empty = { name: null, description: null }
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return empty

  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  if (end === -1) return empty
  const block = lines.slice(1, end)

  const read = (key: string): string | null => {
    const at = block.findIndex((l) => l.startsWith(`${key}:`))
    if (at === -1) return null

    // `key: 값` — 값이 있으면 그 자리에서 끝난다.
    let head = block[at]!.slice(key.length + 1).trim()
    // `>` `|` `>-` 같은 블록 지시자는 다음 줄부터 읽으라는 표시다.
    if (/^[>|][-+]?$/.test(head)) head = ''

    const parts = head === '' ? [] : [head]
    // 값이 비었으면 들여쓴 줄들이 값이다.
    if (head === '') {
      for (let i = at + 1; i < block.length; i++) {
        const line = block[i]!
        if (line.trim() === '') continue
        if (!/^\s/.test(line)) break
        parts.push(line.trim())
      }
    }
    if (parts.length === 0) return null
    return unquote(parts.join(' '))
  }

  return { name: read('name'), description: read('description') }
}

/** 값 전체를 감싼 따옴표만 벗긴다. 안쪽 따옴표는 건드리지 않는다. */
function unquote(value: string): string {
  const quoted = /^"([\s\S]*)"$/.exec(value) ?? /^'([\s\S]*)'$/.exec(value)
  return quoted ? quoted[1]! : value
}
